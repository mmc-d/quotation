import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import {
  account, and, appUser, desc, employee, eq, gte, ilike, journalEntry, journalLine, ledgerSettings, lte, ne, or, party, project, sql, type Tx,
} from '@mmc/db';
import {
  ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, POSTING_KEYS, buildTrialBalance, fiscalYearOf, halalasToFixed, isDate, naturalBalance, parentCode, riyadhDate, toHalalas,
  type AccountType,
} from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { postingExceptions, reconciliationChecks } from './gl-posting.service.js';
import { ZodPipe, zDate, zPage, zUuid } from '../common/zod.js';
import {
  accountByKey, accountRef, accountSums, BEGINNING, incomeStatement, insertDraft, loadAccounts, loadEntry, loadSettings, netByAccount, postByActor,
  replaceDraft, reverseEntry, type AccountRow, type LineInput,
} from './ledger.service.js';

/**
 * General ledger (Phase 6A): chart of accounts, manual journal (draft → posted by a second person →
 * reversed), opening balances, ledger settings and the period lock. Reports are in
 * ledger-reports.controller.ts. Posted entries are never edited: the DB refuses it.
 */

const fx = halalasToFixed;
const H = (v: string | number | null | undefined) => toHalalas(String(v ?? '0'));
const zText = (max = 1000) => z.string().trim().max(max);
const zAmount = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'invalid amount (max 2 decimals)');

// ─────────────────────────────── accounts ───────────────────────────────

const accountBody = z.object({
  code: z.string().trim().regex(/^[0-9A-Za-z.\-]{1,20}$/, 'letters, digits, . or - (max 20)'),
  nameAr: zText(200).min(1),
  nameEn: zText(200).nullish(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  parentId: zUuid.nullish(),
  isGroup: z.boolean().default(false),
  requiresParty: z.boolean().default(false),
  description: zText(1000).nullish(),
  postingKey: z.string().regex(/^[a-z_]+$/).nullish(),
});
type AccountBody = z.infer<typeof accountBody>;
const accountList = zPage.extend({ type: z.enum(ACCOUNT_TYPES).optional(), active: z.enum(['true', 'false']).optional(), postable: z.enum(['true']).optional() }).extend({ limit: z.coerce.number().int().min(1).max(1000).default(1000) });

async function usage(tx: Tx, id: string) {
  const [l] = await tx.select({ n: sql<number>`count(*)::int` }).from(journalLine).where(eq(journalLine.accountId, id));
  const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(account).where(eq(account.parentId, id));
  return { lines: l!.n, children: c!.n };
}

async function loadAccount(tx: Tx, id: string): Promise<AccountRow> {
  const [a] = await tx.select().from(account).where(eq(account.id, id));
  if (!a) throw notFound('account');
  return a;
}

async function checkPostingKey(tx: Tx, key: string | null | undefined, selfId: string | null) {
  if (!key) return;
  if (!POSTING_KEYS.includes(key)) throw badRequest(`unknown posting role “${key}”`);
  const [other] = await tx.select({ id: account.id, code: account.code }).from(account).where(eq(account.postingKey, key));
  if (other && other.id !== selfId) throw conflict(`the role “${key}” is already used by account ${other.code} — clear it there first`);
}

async function resolveParent(tx: Tx, b: Pick<AccountBody, 'parentId' | 'type'>): Promise<{ parentId: string | null; type: AccountType }> {
  if (!b.parentId) {
    if (!b.type) throw badRequest('choose the account type (or a parent account)');
    return { parentId: null, type: b.type };
  }
  const parent = await loadAccount(tx, b.parentId);
  if (!parent.isGroup) throw badRequest(`the parent ${parent.code} is not a group account`);
  if (b.type && b.type !== parent.type) throw badRequest('the account type must match its parent');
  return { parentId: parent.id, type: parent.type as AccountType };
}

// ─────────────────────────────── journal ───────────────────────────────

const lineBody = z.object({
  accountId: zUuid, debit: zAmount.default('0'), credit: zAmount.default('0'),
  partyId: zUuid.nullish(), employeeId: zUuid.nullish(), projectId: zUuid.nullish(), costCenter: zText(120).nullish(), memo: zText(500).nullish(),
  vatCode: z.enum(['S', 'Z', 'E', 'O', 'X', 'IM', 'RC']).nullish(), vatBase: zAmount.nullish(),
});
const journalBody = z.object({
  entryDate: zDate, memo: zText(1000).nullish(), kind: z.enum(['manual', 'adjustment']).default('manual'),
  lines: z.array(lineBody).min(1).max(500),
});
type JournalBody = z.infer<typeof journalBody>;
const toLine = (l: z.infer<typeof lineBody>): LineInput => ({
  accountId: l.accountId, debit: H(l.debit), credit: H(l.credit), partyId: l.partyId ?? null, employeeId: l.employeeId ?? null, projectId: l.projectId ?? null,
  costCenter: l.costCenter || null, memo: l.memo || null, vatCode: l.vatCode ?? null, vatBase: l.vatBase ? H(l.vatBase) : null,
});

const journalList = zPage.extend({
  from: zDate.optional(), to: zDate.optional(), account: zUuid.optional(), party: zUuid.optional(), project: zUuid.optional(),
  status: z.enum(['draft', 'posted']).optional(), kind: z.enum(['manual', 'auto', 'opening', 'reversal', 'closing', 'adjustment']).optional(), sourceType: z.string().max(40).optional(),
});

async function entryView(tx: Tx, id: string) {
  const e = await loadEntry(tx, id);
  const lines = await tx.execute<{ id: string; line_no: number; account_id: string; code: string; name_ar: string; debit: string; credit: string; party_id: string | null; party_name: string | null; employee_id: string | null; employee_name: string | null; project_id: string | null; project_number: string | null; cost_center: string | null; vat_code: string | null; vat_base: string | null; memo: string | null }>(sql`
    select l.id, l.line_no, l.account_id, a.code, a.name_ar, l.debit::text, l.credit::text, l.party_id, pa.name_ar as party_name, l.employee_id, em.name_ar as employee_name,
           l.project_id, pr.number as project_number, l.cost_center, l.vat_code, l.vat_base::text, l.memo
    from journal_line l join account a on a.id = l.account_id left join party pa on pa.id = l.party_id left join employee em on em.id = l.employee_id left join project pr on pr.id = l.project_id
    where l.entry_id = ${id} order by l.line_no`);
  const link = async (linkId: string | null) => {
    if (!linkId) return null;
    const [x] = await tx.select({ id: journalEntry.id, number: journalEntry.number }).from(journalEntry).where(eq(journalEntry.id, linkId));
    return x ?? null;
  };
  const [cu] = e.createdBy ? await tx.select({ nameAr: appUser.nameAr }).from(appUser).where(eq(appUser.id, e.createdBy)) : [];
  return {
    ...e, createdByName: cu?.nameAr ?? null, reverses: await link(e.reversesId), reversedBy: await link(e.reversedById),
    lines: lines.map((l) => ({ id: l.id, lineNo: l.line_no, accountId: l.account_id, code: l.code, nameAr: l.name_ar, debit: l.debit, credit: l.credit, partyId: l.party_id, partyName: l.party_name, employeeId: l.employee_id, employeeName: l.employee_name, projectId: l.project_id, projectNumber: l.project_number, costCenter: l.cost_center, vatCode: l.vat_code, vatBase: l.vat_base, memo: l.memo })),
  };
}

// ─────────────────────────────── settings ───────────────────────────────

const settingsBody = z.object({
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  goLiveDate: zDate.nullish(),
  wipPolicy: z.enum(['wip', 'expense']).optional(),
  employerGosiSaudiPct: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v), 'invalid percent').optional(),
  employerGosiOtherPct: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v), 'invalid percent').optional(),
  defaultCashAccountId: zUuid.nullish(),
  defaultBankAccountId: zUuid.nullish(),
  methodAccounts: z.record(z.string().regex(/^[a-z_]+$/), zUuid).optional(),
  vatReturnFrequency: z.enum(['monthly', 'quarterly']).optional(),
});

async function postedCount(tx: Tx): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(journalEntry).where(eq(journalEntry.status, 'posted'));
  return r!.n;
}

async function settingsView(tx: Tx) {
  const s = await loadSettings(tx);
  const accounts = await loadAccounts(tx);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const named = (id: string | null) => (id && byId.get(id) ? { id, code: byId.get(id)!.code, nameAr: byId.get(id)!.nameAr } : null);
  return {
    ...s, fiscalYear: fiscalYearOf(riyadhDate(), s.fiscalYearStartMonth), postedEntries: await postedCount(tx),
    defaultCashAccount: named(s.defaultCashAccountId), defaultBankAccount: named(s.defaultBankAccountId),
    methodAccountNames: Object.fromEntries(Object.entries(s.methodAccounts ?? {}).map(([m, id]) => [m, named(id)])),
  };
}

// ─────────────────────────────── chart Excel ───────────────────────────────

const TYPE_AR_TO_KEY: Record<string, AccountType> = Object.fromEntries(ACCOUNT_TYPES.flatMap((t) => [[ACCOUNT_TYPE_LABELS[t].ar, t], [t, t]]));
const YES = ['نعم', 'yes', 'true', '1', 'y'];
const CHART_COLS = ['code', 'nameAr', 'nameEn', 'type', 'parent', 'group', 'postingKey', 'requiresParty', 'active'] as const;

async function chartWorkbook(tx: Tx): Promise<Buffer> {
  const accounts = await loadAccounts(tx);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MMC Core';
  const ws = wb.addWorksheet('دليل الحسابات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 2, xSplit: 1 }] });
  const heads = ['رمز الحساب *', 'اسم الحساب (عربي) *', 'الاسم (إنجليزي)', 'النوع *', 'رمز الحساب الأب', 'حساب رئيسي (نعم/لا)', 'مفتاح الترحيل', 'يتطلب عميل/مورد', 'نشط'];
  ws.columns = [12, 38, 30, 14, 14, 14, 24, 14, 8].map((width, i) => ({ key: CHART_COLS[i]!, width }));
  const h1 = ws.getRow(1);
  heads.forEach((t, i) => { h1.getCell(i + 1).value = t; h1.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D4A2E' } }; });
  h1.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h1.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  h1.height = 30;
  const h2 = ws.getRow(2);
  CHART_COLS.forEach((k, i) => { h2.getCell(i + 1).value = k; });
  h2.font = { italic: true, size: 8, color: { argb: 'FF888888' } };
  for (const a of accounts) {
    ws.addRow([a.code, a.nameAr, a.nameEn ?? '', ACCOUNT_TYPE_LABELS[a.type as AccountType].ar, a.parentId ? byId.get(a.parentId)?.code ?? '' : '', a.isGroup ? 'نعم' : 'لا', a.postingKey ?? '', a.requiresParty ? 'نعم' : 'لا', a.isActive ? 'نعم' : 'لا']);
  }
  const help = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 110;
  [
    'يُضاف أي رمز جديد ويُحدَّث الاسم والنشاط و«يتطلب عميل/مورد» للرموز الموجودة.',
    'نوع الحساب والحساب الأب ومفتاح الترحيل لا تتغير بالاستيراد — عدّلها من شاشة دليل الحسابات.',
    'إن تُرك «رمز الحساب الأب» فارغًا لحساب جديد يُستنتج من بداية الرمز (11 ← 1101).',
    'الصفان الأول والثاني عنوانان؛ لا تحذفهما.',
  ].forEach((t) => help.addRow([t]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

interface ChartPlan { create: { code: string; nameAr: string; nameEn: string | null; type: AccountType; parentCode: string | null; isGroup: boolean; requiresParty: boolean; postingKey: string | null; isActive: boolean }[]; update: { code: string; changes: Record<string, unknown> }[]; problems: { row: number; message: string }[] }

async function planChart(tx: Tx, data: Buffer): Promise<ChartPlan> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('the workbook is empty');
  const accounts = await loadAccounts(tx);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const plan: ChartPlan = { create: [], update: [], problems: [] };
  const seen = new Set<string>();
  const text = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
    return String(v).trim();
  };
  const groups = new Set(accounts.filter((a) => a.isGroup).map((a) => a.code));
  ws.eachRow((row, n) => {
    if (n <= 2) return;
    const c = (i: number) => text(row.getCell(i).value);
    const code = c(1);
    if (!code) return;
    if (!/^[0-9A-Za-z.\-]{1,20}$/.test(code)) return void plan.problems.push({ row: n, message: `رمز غير صالح: ${code}` });
    if (seen.has(code)) return void plan.problems.push({ row: n, message: `الرمز ${code} مكرر في الملف` });
    seen.add(code);
    const nameAr = c(2); const nameEn = c(3) || null; const typeText = c(4); const parent = c(5) || null; const isGroup = YES.includes(c(6).toLowerCase()); const postingKey = c(7) || null;
    const requiresParty = YES.includes(c(8).toLowerCase()); const isActive = c(9) === '' ? true : YES.includes(c(9).toLowerCase());
    if (!nameAr) return void plan.problems.push({ row: n, message: `الحساب ${code}: الاسم العربي مطلوب` });
    const existing = byCode.get(code);
    if (existing) {
      const changes: Record<string, unknown> = {};
      if (existing.nameAr !== nameAr) changes.nameAr = nameAr;
      if ((existing.nameEn ?? null) !== nameEn) changes.nameEn = nameEn;
      if (existing.requiresParty !== requiresParty) changes.requiresParty = requiresParty;
      if (existing.isActive !== isActive) changes.isActive = isActive;
      const type = TYPE_AR_TO_KEY[typeText];
      if (type && type !== existing.type) plan.problems.push({ row: n, message: `الحساب ${code}: نوع الحساب لا يتغير بالاستيراد` });
      if (Object.keys(changes).length) plan.update.push({ code, changes });
      return;
    }
    const type = TYPE_AR_TO_KEY[typeText];
    if (!type) return void plan.problems.push({ row: n, message: `الحساب ${code}: نوع غير معروف «${typeText}»` });
    const parentResolved = parent ?? parentCode(code, [...groups]);
    if (parentResolved && !groups.has(parentResolved)) return void plan.problems.push({ row: n, message: `الحساب ${code}: الحساب الأب ${parentResolved} غير موجود أو ليس حسابًا رئيسيًا` });
    if (parentResolved && byCode.get(parentResolved)!.type !== type) return void plan.problems.push({ row: n, message: `الحساب ${code}: نوعه يخالف نوع الحساب الأب` });
    if (postingKey && (!POSTING_KEYS.includes(postingKey) || accounts.some((a) => a.postingKey === postingKey))) return void plan.problems.push({ row: n, message: `الحساب ${code}: مفتاح الترحيل «${postingKey}» غير صالح أو مستخدم` });
    plan.create.push({ code, nameAr, nameEn, type, parentCode: parentResolved, isGroup, requiresParty, postingKey, isActive });
    if (isGroup) { groups.add(code); byCode.set(code, { code, type } as AccountRow); }
  });
  return plan;
}

// ─────────────────────────────── controller ───────────────────────────────

@Controller('accounting')
export class LedgerController {
  // ───── dashboard ─────

  @Get('dashboard')
  @Perm('ledger.read')
  async dashboard(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const s = await loadSettings(tx);
      const today = riyadhDate();
      const fy = fiscalYearOf(today, s.fiscalYearStartMonth);
      const monthStart = `${today.slice(0, 7)}-01`;
      const accounts = await loadAccounts(tx);
      const tb = buildTrialBalance(accounts.map(accountRef), await accountSums(tx, BEGINNING, today), { withZero: true });
      const bal = (key: string) => {
        const a = accounts.find((x) => x.postingKey === key);
        const row = a && tb.rows.find((r) => r.accountId === a.id);
        return a ? { code: a.code, nameAr: a.nameAr, balance: fx(naturalBalance(a.type as AccountType, row?.closing ?? 0)) } : null;
      };
      const [month, year] = await Promise.all([incomeStatement(tx, { from: monthStart, to: today, by: 'none' }), incomeStatement(tx, { from: fy.start, to: today, by: 'none' })]);
      const [drafts] = await tx.select({ n: sql<number>`count(*)::int` }).from(journalEntry).where(eq(journalEntry.status, 'draft'));
      const recent = await tx.select({ id: journalEntry.id, number: journalEntry.number, date: journalEntry.entryDate, memo: journalEntry.memo, kind: journalEntry.kind, total: journalEntry.total, status: journalEntry.status }).from(journalEntry).orderBy(desc(journalEntry.createdAt)).limit(8);
      const checks = await reconciliationChecks(tx);
      const ex = await postingExceptions(tx);
      const exceptions = ex.suspense.length + ex.errors.length + ex.changed.length;
      return {
        today, fiscalYear: fy, lockedThrough: s.lockedThrough, goLiveDate: s.goLiveDate,
        balances: { cash: bal('cash'), bank: bal('bank'), ar: bal('ar'), ap: bal('ap'), inventory: bal('inventory'), vatInput: bal('vat_input'), vatOutput: bal('vat_output') },
        profit: { month: fx(month.netProfit.total), year: fx(year.netProfit.total), monthRevenue: fx(month.sections.find((x) => x.key === 'revenue')!.total), yearRevenue: fx(year.sections.find((x) => x.key === 'revenue')!.total) },
        draftEntries: drafts!.n, recent, checks, exceptions, autoPosting: ex.live,
      };
    });
  }

  // ───── accounts ─────

  @Get('accounts')
  @Perm('ledger.read')
  async accounts(@Actor() actor: RequestActor, @Query(new ZodPipe(accountList)) q: z.infer<typeof accountList>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const all = await loadAccounts(tx);
      const tb = buildTrialBalance(all.map(accountRef), await accountSums(tx, BEGINNING, riyadhDate()), { withZero: true });
      const row = new Map(tb.rows.map((r) => [r.accountId, r]));
      const withLines = new Set((await tx.selectDistinct({ id: journalLine.accountId }).from(journalLine)).map((r) => r.id));
      const term = q.q?.trim().toLowerCase();
      return all
        .filter((a) => (!q.type || a.type === q.type) && (q.active === undefined || a.isActive === (q.active === 'true')) && (!q.postable || !a.isGroup)
          && (!term || a.code.includes(term) || a.nameAr.toLowerCase().includes(term) || (a.nameEn ?? '').toLowerCase().includes(term)))
        .slice(0, q.limit)
        .map((a) => {
          const r = row.get(a.id);
          return { ...a, depth: r?.depth ?? 1, balance: fx(naturalBalance(a.type as AccountType, r?.closing ?? 0)), hasLines: withLines.has(a.id) };
        });
    });
  }

  @Get('accounts/tree')
  @Perm('ledger.read')
  async tree(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const all = await loadAccounts(tx);
      type Node = { id: string; code: string; nameAr: string; nameEn: string | null; type: string; isGroup: boolean; isActive: boolean; postingKey: string | null; children: Node[] };
      const nodes = new Map<string, Node>(all.map((a) => [a.id, { id: a.id, code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, type: a.type, isGroup: a.isGroup, isActive: a.isActive, postingKey: a.postingKey, children: [] }]));
      const roots: Node[] = [];
      for (const a of all) (a.parentId && nodes.get(a.parentId) ? nodes.get(a.parentId)!.children : roots).push(nodes.get(a.id)!);
      return roots;
    });
  }

  /** The chart as a workbook — also the template for adding accounts in bulk. */
  @Get('accounts/excel')
  @Perm('ledger.read')
  async chartExcel(@Actor() actor: RequestActor, @Res() res: Response) {
    const buf = await tenantTx(actor.tenantId, (tx) => chartWorkbook(tx));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="mmc-chart-of-accounts-${riyadhDate()}.xlsx"`);
    res.send(buf);
  }

  /** Upload the edited workbook: `apply: false` previews (new / changed / problems), `apply: true` writes it. */
  @Post('accounts/import')
  @Perm('ledger.write')
  async importChart(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ data: z.string().min(1).max(14_000_000), apply: z.boolean().default(false) }))) b: { data: string; apply: boolean }) {
    const buf = Buffer.from(b.data, 'base64');
    if (buf.length > 10 * 1024 * 1024) throw badRequest('file larger than 10 MB');
    return tenantTx(actor.tenantId, async (tx) => {
      const plan = await planChart(tx, buf);
      if (b.apply) {
        if (plan.problems.length) throw badRequest('fix the problems in the workbook first', plan.problems);
        const accounts = await loadAccounts(tx);
        const ids = new Map(accounts.map((a) => [a.code, a.id]));
        for (const c of [...plan.create].sort((x, y) => x.code.length - y.code.length || (x.code < y.code ? -1 : 1))) {
          const [row] = await tx.insert(account).values({
            code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, type: c.type, parentId: c.parentCode ? ids.get(c.parentCode) ?? null : null, isGroup: c.isGroup,
            requiresParty: c.requiresParty, postingKey: c.postingKey, isActive: c.isActive, createdBy: actor.userId, updatedBy: actor.userId,
          }).returning({ id: account.id });
          ids.set(c.code, row!.id);
        }
        for (const u of plan.update) await tx.update(account).set({ ...u.changes, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(account.id, ids.get(u.code)!));
        await audit(tx, actor, 'import_chart', 'account', null, null, { created: plan.create.length, updated: plan.update.length });
      }
      return { applied: b.apply, ...plan };
    }, actor.userId);
  }

  @Post('accounts')
  @Perm('ledger.write')
  async createAccount(@Actor() actor: RequestActor, @Body(new ZodPipe(accountBody)) b: AccountBody) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadSettings(tx);
      const [dup] = await tx.select({ id: account.id }).from(account).where(eq(account.code, b.code));
      if (dup) throw conflict(`the code ${b.code} is already used`);
      const { parentId, type } = await resolveParent(tx, b);
      if (b.isGroup && b.postingKey) throw badRequest('a group account cannot carry a posting role');
      await checkPostingKey(tx, b.postingKey, null);
      const [a] = await tx.insert(account).values({
        code: b.code, nameAr: b.nameAr, nameEn: b.nameEn || null, type, parentId, isGroup: b.isGroup, requiresParty: b.requiresParty,
        description: b.description || null, postingKey: b.postingKey || null, createdBy: actor.userId, updatedBy: actor.userId,
      }).returning();
      await audit(tx, actor, 'create', 'account', a!.id, null, { code: a!.code, nameAr: a!.nameAr, type });
      return a!;
    }, actor.userId);
  }

  @Put('accounts/:id')
  @Perm('ledger.write')
  async updateAccount(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(accountBody.extend({ version: z.number().int() }))) b: AccountBody & { version: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadAccount(tx, id);
      if (before.version !== b.version) throw conflict('the account was changed by someone else — reload');
      const u = await usage(tx, id);
      const { parentId, type } = await resolveParent(tx, b.parentId ? b : { parentId: null, type: b.type ?? (before.type as AccountType) });
      if (parentId === id) throw badRequest('an account cannot be its own parent');
      if ((type !== before.type || b.code !== before.code) && u.lines > 0) throw conflict('this account has journal lines — its code and type can no longer change');
      if (type !== before.type && u.children > 0) throw conflict('this account has sub-accounts — its type can no longer change');
      if (b.isGroup && !before.isGroup && u.lines > 0) throw conflict('an account with journal lines cannot become a group');
      if (!b.isGroup && before.isGroup && u.children > 0) throw conflict('a group with sub-accounts cannot become postable');
      if (b.isGroup && b.postingKey) throw badRequest('a group account cannot carry a posting role');
      if (b.code !== before.code) {
        const [dup] = await tx.select({ id: account.id }).from(account).where(and(eq(account.code, b.code), ne(account.id, id)));
        if (dup) throw conflict(`the code ${b.code} is already used`);
      }
      if (parentId) { // no cycles: the new parent must not be a descendant
        let cur: string | null = parentId;
        for (let i = 0; cur && i < 20; i++) {
          if (cur === id) throw badRequest('the parent would create a loop');
          const [p] = await tx.select({ parentId: account.parentId }).from(account).where(eq(account.id, cur));
          cur = p?.parentId ?? null;
        }
      }
      await checkPostingKey(tx, b.postingKey, id);
      if (before.postingKey && !b.postingKey) {
        const [used] = await tx.select({ id: ledgerSettings.id }).from(ledgerSettings).where(or(eq(ledgerSettings.defaultCashAccountId, id), eq(ledgerSettings.defaultBankAccountId, id)));
        if (used) throw conflict('the account is a default cash/bank account in the ledger settings');
      }
      const next = { code: b.code, nameAr: b.nameAr, nameEn: b.nameEn || null, type, parentId, isGroup: b.isGroup, requiresParty: b.requiresParty, description: b.description || null, postingKey: b.postingKey || null };
      await tx.update(account).set({ ...next, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(account.id, id));
      const d = diff(before as Record<string, unknown>, next as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'account', id, d.before, d.after);
      return loadAccount(tx, id);
    }, actor.userId);
  }

  @Post('accounts/:id/deactivate')
  @Perm('ledger.write')
  async deactivate(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const a = await loadAccount(tx, id);
      if (a.postingKey) throw conflict(`the account carries the “${a.postingKey}” role used by automatic posting — move the role first`);
      const [used] = await tx.select({ id: ledgerSettings.id }).from(ledgerSettings).where(or(eq(ledgerSettings.defaultCashAccountId, id), eq(ledgerSettings.defaultBankAccountId, id)));
      const [viaMethod] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from ledger_settings s, jsonb_each_text(s.method_accounts) m where m.value = ${id}`);
      if (used || (viaMethod?.n ?? 0) > 0) throw conflict('the account is used in the ledger settings (default cash/bank or a payment method)');
      const bal = (await netByAccount(tx, '9999-12-31')).get(id) ?? 0;
      if (bal !== 0) throw conflict('only an account with a zero balance can be deactivated');
      await tx.update(account).set({ isActive: false, updatedAt: new Date(), updatedBy: actor.userId, version: a.version + 1 }).where(eq(account.id, id));
      await audit(tx, actor, 'deactivate', 'account', id, { isActive: true }, { isActive: false });
      return loadAccount(tx, id);
    }, actor.userId);
  }

  @Post('accounts/:id/activate')
  @Perm('ledger.write')
  async activate(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const a = await loadAccount(tx, id);
      await tx.update(account).set({ isActive: true, updatedAt: new Date(), updatedBy: actor.userId, version: a.version + 1 }).where(eq(account.id, id));
      await audit(tx, actor, 'activate', 'account', id, { isActive: false }, { isActive: true });
      return loadAccount(tx, id);
    }, actor.userId);
  }

  /** Only an account never used: no lines, no sub-accounts, no role. Otherwise deactivate it. */
  @Delete('accounts/:id')
  @Perm('ledger.write')
  async removeAccount(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const a = await loadAccount(tx, id);
      const u = await usage(tx, id);
      if (u.lines > 0) throw conflict('the account has journal lines — deactivate it instead');
      if (u.children > 0) throw conflict('the account has sub-accounts');
      if (a.postingKey) throw conflict('the account carries a posting role');
      const [used] = await tx.select({ id: ledgerSettings.id }).from(ledgerSettings).where(or(eq(ledgerSettings.defaultCashAccountId, id), eq(ledgerSettings.defaultBankAccountId, id)));
      if (used) throw conflict('the account is a default cash/bank account in the ledger settings');
      await tx.delete(account).where(eq(account.id, id));
      await audit(tx, actor, 'delete', 'account', id, { code: a.code, nameAr: a.nameAr }, null);
      return { ok: true };
    }, actor.userId);
  }

  // ───── journal ─────

  @Get('journal')
  @Perm('ledger.read')
  async journal(@Actor() actor: RequestActor, @Query(new ZodPipe(journalList)) q: z.infer<typeof journalList>) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadSettings(tx);
      const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = and(
        q.from ? gte(journalEntry.entryDate, q.from) : undefined, q.to ? lte(journalEntry.entryDate, q.to) : undefined,
        q.status ? eq(journalEntry.status, q.status) : undefined, q.kind ? eq(journalEntry.kind, q.kind) : undefined, q.sourceType ? eq(journalEntry.sourceType, q.sourceType) : undefined,
        q.account ? sql`exists (select 1 from journal_line x where x.entry_id = ${journalEntry.id} and x.account_id = ${q.account})` : undefined,
        q.party ? sql`exists (select 1 from journal_line x where x.entry_id = ${journalEntry.id} and x.party_id = ${q.party})` : undefined,
        q.project ? sql`exists (select 1 from journal_line x where x.entry_id = ${journalEntry.id} and x.project_id = ${q.project})` : undefined,
        term ? or(ilike(journalEntry.number, term), ilike(journalEntry.memo, term), ilike(journalEntry.sourceRef, term)) : undefined,
      );
      const rows = await tx.select({
        id: journalEntry.id, number: journalEntry.number, entryDate: journalEntry.entryDate, memo: journalEntry.memo, kind: journalEntry.kind, status: journalEntry.status,
        total: journalEntry.total, sourceType: journalEntry.sourceType, sourceRef: journalEntry.sourceRef, reversedById: journalEntry.reversedById, reversesId: journalEntry.reversesId, postedByName: journalEntry.postedByName,
      }).from(journalEntry).where(where).orderBy(desc(journalEntry.entryDate), desc(journalEntry.number)).limit(q.limit).offset(q.offset);
      const [t] = await tx.select({ total: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${journalEntry.total}), 0)::text` }).from(journalEntry).where(where);
      return { rows, total: t!.total, amount: t!.amount };
    });
  }

  @Get('journal/:id')
  @Perm('ledger.read')
  async entry(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, (tx) => entryView(tx, id));
  }

  @Post('journal')
  @Perm('ledger.write')
  async createEntry(@Actor() actor: RequestActor, @Body(new ZodPipe(journalBody)) b: JournalBody) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { id, number } = await insertDraft(tx, actor.userId, { entryDate: b.entryDate, memo: b.memo, kind: b.kind, lines: b.lines.map(toLine) });
      await audit(tx, actor, 'create', 'journal_entry', id, null, { number, entryDate: b.entryDate, lines: b.lines.length });
      return entryView(tx, id);
    }, actor.userId);
  }

  @Put('journal/:id')
  @Perm('ledger.write')
  async updateEntry(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(journalBody.extend({ version: z.number().int() }))) b: JournalBody & { version: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadEntry(tx, id);
      await replaceDraft(tx, actor.userId, id, { entryDate: b.entryDate, memo: b.memo, kind: before.kind as 'manual', lines: b.lines.map(toLine) }, b.version);
      await audit(tx, actor, 'update', 'journal_entry', id, { entryDate: before.entryDate, total: before.total }, { entryDate: b.entryDate, lines: b.lines.length });
      return entryView(tx, id);
    }, actor.userId);
  }

  @Delete('journal/:id')
  @Perm('ledger.write')
  async deleteDraft(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const e = await loadEntry(tx, id);
      if (e.status !== 'draft') throw conflict('a posted entry cannot be deleted — reverse it');
      await tx.delete(journalEntry).where(eq(journalEntry.id, id));
      await audit(tx, actor, 'delete', 'journal_entry', id, { number: e.number, total: e.total }, null);
      return { ok: true };
    }, actor.userId);
  }

  /** Post a draft: complete validation, a person other than the preparer (the owner may post their own). */
  @Post('journal/:id/post')
  @Perm('ledger.post')
  async post(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      await postByActor(tx, actor, id);
      const e = await loadEntry(tx, id);
      await audit(tx, actor, 'post', 'journal_entry', id, { status: 'draft' }, { status: 'posted', number: e.number, total: e.total });
      return entryView(tx, id);
    }, actor.userId);
  }

  @Post('journal/:id/reverse')
  @Perm('ledger.post')
  async reverse(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ date: zDate.optional(), reason: zText(500).min(1) }))) b: { date?: string; reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rev = await reverseEntry(tx, actor, id, b.date ?? riyadhDate(), b.reason);
      await audit(tx, actor, 'reverse', 'journal_entry', id, null, { reversal: rev.number }, b.reason);
      return entryView(tx, rev.id);
    }, actor.userId);
  }

  // ───── opening balances ─────

  @Get('opening')
  @Perm('ledger.read')
  async opening(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const s = await loadSettings(tx);
      const [open] = await tx.select({ id: journalEntry.id, number: journalEntry.number, entryDate: journalEntry.entryDate, status: journalEntry.status, total: journalEntry.total })
        .from(journalEntry).where(and(eq(journalEntry.kind, 'opening'), sql`${journalEntry.reversedById} is null`)).limit(1);
      // stock on hand valued at cost, to reconcile against the inventory account
      const [stock] = await tx.execute<{ v: string }>(sql`select coalesce(sum(qty * unit_cost_sar), 0)::text as v from stock_move`);
      return { goLiveDate: s.goLiveDate, entry: open ?? null, stockValue: fx(H(stock?.v)), openingBalanceAccount: (await accountByKey(tx, 'opening_balance_equity').catch(() => null))?.id ?? null };
    });
  }

  /**
   * Opening balances as one `opening` entry dated the go-live date. With autoBalance any difference
   * goes to “Opening balance equity” so the accountant can clear it later. One live opening entry
   * at a time: reverse it to start again.
   */
  @Post('opening')
  @Perm('ledger.write')
  async createOpening(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ goLiveDate: zDate, memo: zText(500).nullish(), autoBalance: z.boolean().default(true), lines: z.array(lineBody).min(1).max(1000) }))) b: { goLiveDate: string; memo?: string | null; autoBalance: boolean; lines: z.infer<typeof lineBody>[] }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const s = await loadSettings(tx);
      if (!actor.grants['ledger.close']) throw forbidden('setting opening balances needs ledger.close');
      const [live] = await tx.select({ number: journalEntry.number }).from(journalEntry).where(and(eq(journalEntry.kind, 'opening'), sql`${journalEntry.reversedById} is null`, ne(journalEntry.kind, 'reversal'))).limit(1);
      if (live) throw conflict(`an opening entry (${live.number}) already exists — delete the draft or reverse it first`);
      const [early] = await tx.select({ number: journalEntry.number }).from(journalEntry).where(and(eq(journalEntry.status, 'posted'), sql`${journalEntry.entryDate} < ${b.goLiveDate}`)).limit(1);
      if (early) throw conflict(`entry ${early.number} is dated before the go-live date`);
      const lines = b.lines.map(toLine);
      const debit = lines.reduce((x, l) => x + l.debit, 0);
      const credit = lines.reduce((x, l) => x + l.credit, 0);
      if (debit !== credit) {
        if (!b.autoBalance) throw badRequest(`opening balances are not balanced: debit ${fx(debit)} vs credit ${fx(credit)}`);
        const eq3301 = await accountByKey(tx, 'opening_balance_equity');
        lines.push({ accountId: eq3301.id, debit: credit > debit ? credit - debit : 0, credit: debit > credit ? debit - credit : 0, memo: 'فرق الأرصدة الافتتاحية' });
      }
      await tx.update(ledgerSettings).set({ goLiveDate: b.goLiveDate, updatedAt: new Date(), updatedBy: actor.userId, version: s.version + 1 }).where(eq(ledgerSettings.id, s.id));
      const { id, number } = await insertDraft(tx, actor.userId, { entryDate: b.goLiveDate, kind: 'opening', memo: b.memo || 'الأرصدة الافتتاحية', lines });
      await audit(tx, actor, 'create_opening', 'journal_entry', id, { goLiveDate: s.goLiveDate }, { number, goLiveDate: b.goLiveDate, lines: lines.length });
      return entryView(tx, id);
    }, actor.userId);
  }

  // ───── settings & period lock ─────

  @Get('settings')
  @Perm('ledger.read')
  async settings(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => settingsView(tx));
  }

  @Put('settings')
  @Perm('ledger.write')
  async updateSettings(@Actor() actor: RequestActor, @Body(new ZodPipe(settingsBody)) b: z.infer<typeof settingsBody>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const s = await loadSettings(tx);
      const posted = await postedCount(tx);
      const calendar = b.fiscalYearStartMonth !== undefined && b.fiscalYearStartMonth !== s.fiscalYearStartMonth;
      const live = b.goLiveDate !== undefined && (b.goLiveDate ?? null) !== (s.goLiveDate ?? null);
      if ((calendar || live) && !actor.grants['ledger.close']) throw forbidden('changing the fiscal calendar or go-live date needs ledger.close');
      if ((calendar || live) && posted > 0) throw conflict('the fiscal year and go-live date cannot change once entries are posted');
      const accounts = await loadAccounts(tx);
      const postable = new Set(accounts.filter((a) => !a.isGroup && a.isActive).map((a) => a.id));
      for (const id of [b.defaultCashAccountId, b.defaultBankAccountId, ...Object.values(b.methodAccounts ?? {})]) if (id && !postable.has(id)) throw badRequest('the chosen account is not a postable, active account');
      const patch: Partial<typeof ledgerSettings.$inferInsert> = {};
      if (b.fiscalYearStartMonth !== undefined) patch.fiscalYearStartMonth = b.fiscalYearStartMonth;
      if (b.goLiveDate !== undefined) patch.goLiveDate = b.goLiveDate ?? null;
      if (b.wipPolicy) patch.wipPolicy = b.wipPolicy;
      if (b.employerGosiSaudiPct !== undefined) patch.employerGosiSaudiPct = b.employerGosiSaudiPct;
      if (b.employerGosiOtherPct !== undefined) patch.employerGosiOtherPct = b.employerGosiOtherPct;
      if (b.defaultCashAccountId !== undefined) patch.defaultCashAccountId = b.defaultCashAccountId ?? null;
      if (b.defaultBankAccountId !== undefined) patch.defaultBankAccountId = b.defaultBankAccountId ?? null;
      if (b.methodAccounts) patch.methodAccounts = b.methodAccounts;
      if (b.vatReturnFrequency) patch.vatReturnFrequency = b.vatReturnFrequency;
      await tx.update(ledgerSettings).set({ ...patch, updatedAt: new Date(), updatedBy: actor.userId, version: s.version + 1 }).where(eq(ledgerSettings.id, s.id));
      const d = diff(s as Record<string, unknown>, patch as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'ledger_settings', s.id, d.before, d.after);
      return settingsView(tx);
    }, actor.userId);
  }

  /** Lock the books through a date (usually a month end): nothing dated on or before it can be posted or reversed into. */
  @Post('periods/lock')
  @Perm('ledger.close')
  async lock(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ through: zDate }))) b: { through: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const s = await loadSettings(tx);
      if (!isDate(b.through)) throw badRequest('invalid date');
      if (b.through > riyadhDate()) throw badRequest('a future date cannot be locked');
      if (s.lockedThrough && b.through <= s.lockedThrough) throw badRequest(`the books are already locked through ${s.lockedThrough}`);
      const [drafts] = await tx.select({ n: sql<number>`count(*)::int` }).from(journalEntry).where(and(eq(journalEntry.status, 'draft'), lte(journalEntry.entryDate, b.through)));
      await tx.update(ledgerSettings).set({ lockedThrough: b.through, updatedAt: new Date(), updatedBy: actor.userId, version: s.version + 1 }).where(eq(ledgerSettings.id, s.id));
      await audit(tx, actor, 'lock_period', 'ledger_settings', s.id, { lockedThrough: s.lockedThrough }, { lockedThrough: b.through });
      return { lockedThrough: b.through, draftsInRange: drafts!.n };
    }, actor.userId);
  }

  /** Re-open earlier periods — the owner only, with a reason. */
  @Post('periods/unlock')
  @Perm('ledger.close')
  async unlock(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ through: zDate.nullable(), reason: zText(500).min(1) }))) b: { through: string | null; reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (!actor.roleKeys.includes('owner')) throw forbidden('only the owner can re-open a locked period');
      const s = await loadSettings(tx);
      if (!s.lockedThrough) throw conflict('no period is locked');
      if (b.through && b.through >= s.lockedThrough) throw badRequest('the new lock date must be earlier than the current one');
      await tx.update(ledgerSettings).set({ lockedThrough: b.through, updatedAt: new Date(), updatedBy: actor.userId, version: s.version + 1 }).where(eq(ledgerSettings.id, s.id));
      await audit(tx, actor, 'unlock_period', 'ledger_settings', s.id, { lockedThrough: s.lockedThrough }, { lockedThrough: b.through }, b.reason);
      return { lockedThrough: b.through };
    }, actor.userId);
  }

  // ───── lookups for the entry editor ─────

  /** Customers/suppliers, employees and projects the line editor can attach. */
  @Get('lookups')
  @Perm('ledger.read')
  async lookups(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ q: z.string().optional() }))) q: { q?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const parties = await tx.select({ id: party.id, nameAr: party.nameAr }).from(party).where(term ? ilike(party.nameAr, term) : undefined).orderBy(party.nameAr).limit(30);
      const projects = await tx.select({ id: project.id, number: project.number, name: project.name }).from(project).where(term ? or(ilike(project.number, term), ilike(project.name, term)) : undefined).orderBy(desc(project.createdAt)).limit(30);
      const employees = await tx.select({ id: employee.id, number: employee.number, nameAr: employee.nameAr }).from(employee).where(term ? or(ilike(employee.nameAr, term), ilike(employee.number, term)) : undefined).orderBy(employee.nameAr).limit(30);
      return { parties, projects, employees };
    });
  }
}
