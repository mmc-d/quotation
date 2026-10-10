import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { and, eq, gte, journalEntry, lte, sql, type Tx } from '@mmc/db';
import { riyadhDate, withRunningBalance, INCOME_SECTIONS, type AccountType, type BalanceRow, type IncomeStatement, type TrialBalance } from '@mmc/domain';
import type { ReportTable } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { notFound } from '../common/errors.js';
import { ZodPipe, zDate, zUuid } from '../common/zod.js';
import { defaultRange, flag, fx, H, reportFormat, send } from './report-kit.js';
import { accountRef, balanceSheet, incomeStatement, loadAccounts, trialBalance } from './ledger.service.js';

/**
 * Financial reports from the posted ledger. Every report answers JSON (default), or `?format=xlsx`
 * / `?format=pdf` — the same table is rendered to all three so exports always match the screen.
 */

const format = reportFormat;
const level = z.coerce.number().int().min(1).max(6).optional();

const range = z.object({ from: zDate.optional(), to: zDate.optional(), format }).refine((r) => !r.from || !r.to || r.from <= r.to, 'from must not be after to');

// ───────── shapes ─────────

export function trialJson(tb: TrialBalance, p: { from: string; to: string }) {
  const split = (n: number) => ({ debit: fx(n > 0 ? n : 0), credit: fx(n < 0 ? -n : 0) });
  return {
    from: p.from, to: p.to, balanced: tb.balanced,
    rows: tb.rows.map((r) => ({
      accountId: r.accountId, code: r.code, nameAr: r.nameAr, nameEn: r.nameEn, type: r.type, isGroup: r.isGroup, depth: r.depth,
      openingDebit: split(r.opening).debit, openingCredit: split(r.opening).credit, debit: fx(r.debit), credit: fx(r.credit),
      closingDebit: split(r.closing).debit, closingCredit: split(r.closing).credit,
    })),
    totals: Object.fromEntries(Object.entries(tb.totals).map(([k, v]) => [k, fx(v)])),
  };
}

export function trialTable(tb: TrialBalance, p: { from: string; to: string }): ReportTable {
  const cols: ReportTable['columns'] = [
    { key: 'code', label: 'الرمز', kind: 'text', width: 8 }, { key: 'name', label: 'اسم الحساب', kind: 'text', width: 30 },
    { key: 'od', label: 'افتتاحي مدين', kind: 'money' }, { key: 'oc', label: 'افتتاحي دائن', kind: 'money' },
    { key: 'd', label: 'حركة مدينة', kind: 'money' }, { key: 'c', label: 'حركة دائنة', kind: 'money' },
    { key: 'cd', label: 'ختامي مدين', kind: 'money' }, { key: 'cc', label: 'ختامي دائن', kind: 'money' },
  ];
  const rows: ReportTable['rows'] = tb.rows.map((r) => ({
    style: r.isGroup ? 'group' : 'normal', depth: r.depth - 1,
    cells: { code: r.code, name: r.nameAr, od: r.opening > 0 ? r.opening : 0, oc: r.opening < 0 ? -r.opening : 0, d: r.debit, c: r.credit, cd: r.closing > 0 ? r.closing : 0, cc: r.closing < 0 ? -r.closing : 0 },
  }));
  const t = tb.totals;
  rows.push({ style: 'total', cells: { code: '', name: 'الإجمالي', od: t.openingDebit, oc: t.openingCredit, d: t.debit, c: t.credit, cd: t.closingDebit, cc: t.closingCredit } });
  return { title: 'ميزان المراجعة', titleEn: 'Trial balance', subtitle: `من ${p.from} إلى ${p.to}`, columns: cols, rows, notes: tb.balanced ? [] : ['تنبيه: ميزان المراجعة غير متوازن — راجع القيود.'] };
}

const periodLabel = (c: string) => (c === '' ? 'الإجمالي' : c);

export function incomeJson(is: IncomeStatement, p: { from: string; to: string; by: string }) {
  const money = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fx(v)]));
  return {
    from: p.from, to: p.to, by: p.by, columns: is.columns,
    sections: is.sections.map((s) => ({ key: s.key, ar: s.ar, en: s.en, total: fx(s.total), values: money(s.values), rows: s.rows.map((r) => ({ accountId: r.accountId, code: r.code, nameAr: r.nameAr, nameEn: r.nameEn, total: fx(r.total), values: money(Object.fromEntries(Object.entries(r.values).filter(([k]) => k !== ''))) })) })),
    grossProfit: { total: fx(is.grossProfit.total), values: money(is.grossProfit.values) },
    operatingProfit: { total: fx(is.operatingProfit.total), values: money(is.operatingProfit.values) },
    netProfit: { total: fx(is.netProfit.total), values: money(is.netProfit.values) },
  };
}

export function incomeTable(is: IncomeStatement, p: { from: string; to: string }): ReportTable {
  const dimCols = is.columns.map((c) => ({ key: `v:${c}`, label: periodLabel(c), kind: 'money' as const }));
  const columns: ReportTable['columns'] = [{ key: 'code', label: 'الرمز', kind: 'text', width: 8 }, { key: 'name', label: 'البند', kind: 'text', width: 36 }, ...dimCols, { key: 'total', label: 'الإجمالي', kind: 'money' }];
  const line = (code: string, name: string, values: Record<string, number>, total: number, style: ReportTable['rows'][number]['style'], depth = 0): ReportTable['rows'][number] =>
    ({ style, depth, cells: { code, name, total, ...Object.fromEntries(is.columns.map((c) => [`v:${c}`, values[c] ?? 0])) } });
  const rows: ReportTable['rows'] = [];
  const sec = (key: string) => is.sections.find((s) => s.key === key)!;
  const block = (key: string, sign: 1 | -1 = 1) => {
    const s = sec(key);
    rows.push({ style: 'heading', cells: { name: INCOME_SECTIONS.find((d) => d.key === key)!.ar } });
    s.rows.forEach((r) => rows.push(line(r.code, r.nameAr, r.values, r.total, 'normal', 1)));
    rows.push(line('', `إجمالي ${s.ar}`, s.values, s.total * sign, 'subtotal'));
  };
  block('revenue'); block('cost_of_sales');
  rows.push(line('', 'مجمل الربح', is.grossProfit.values, is.grossProfit.total, 'group'));
  block('operating_expenses');
  rows.push(line('', 'الربح التشغيلي', is.operatingProfit.values, is.operatingProfit.total, 'group'));
  block('other_income');
  rows.push(line('', 'صافي الربح (الخسارة)', is.netProfit.values, is.netProfit.total, 'total'));
  return { title: 'قائمة الدخل', titleEn: 'Income statement', subtitle: `من ${p.from} إلى ${p.to}`, columns, rows };
}

export function sheetJson(b: Awaited<ReturnType<typeof balanceSheet>>, asOf: string) {
  const sec = (s: { rows: BalanceRow[]; total: number }) => ({ total: fx(s.total), rows: s.rows.map((r) => ({ ...r, amount: fx(r.amount) })) });
  const s = b.sheet;
  return { asOf, fiscalYear: b.fiscalYear, assets: sec(s.assets), liabilities: sec(s.liabilities), equity: sec(s.equity), currentYearProfit: fx(s.currentYearProfit), priorYearsProfit: fx(s.priorYearsProfit), liabilitiesAndEquity: fx(s.liabilitiesAndEquity), balanced: s.balanced };
}

export function sheetTable(b: Awaited<ReturnType<typeof balanceSheet>>, asOf: string): ReportTable {
  const s = b.sheet;
  const rows: ReportTable['rows'] = [];
  const block = (title: string, sec: { rows: BalanceRow[]; total: number }, totalLabel: string) => {
    rows.push({ style: 'heading', cells: { name: title } });
    sec.rows.forEach((r) => rows.push({ style: r.isGroup ? 'group' : 'normal', depth: r.depth - 1, cells: { code: r.code, name: r.nameAr, amount: r.amount } }));
    return sec.total;
  };
  const a = block('الأصول', s.assets, 'إجمالي الأصول');
  rows.push({ style: 'total', cells: { name: 'إجمالي الأصول', amount: a } });
  block('الخصوم', s.liabilities, 'إجمالي الخصوم');
  rows.push({ style: 'subtotal', cells: { name: 'إجمالي الخصوم', amount: s.liabilities.total } });
  block('حقوق الملكية', s.equity, 'إجمالي حقوق الملكية');
  if (s.priorYearsProfit !== 0) rows.push({ style: 'normal', depth: 1, cells: { name: 'أرباح (خسائر) سنوات سابقة غير مقفلة', amount: s.priorYearsProfit } });
  rows.push({ style: 'normal', depth: 1, cells: { name: 'صافي ربح (خسارة) العام الحالي', amount: s.currentYearProfit } });
  rows.push({ style: 'subtotal', cells: { name: 'إجمالي حقوق الملكية', amount: s.equity.total + s.priorYearsProfit + s.currentYearProfit } });
  rows.push({ style: 'total', cells: { name: 'إجمالي الخصوم وحقوق الملكية', amount: s.liabilitiesAndEquity } });
  return {
    title: 'قائمة المركز المالي', titleEn: 'Balance sheet', subtitle: `كما في ${asOf} — السنة المالية ${b.fiscalYear.label}`,
    columns: [{ key: 'code', label: 'الرمز', kind: 'text', width: 10 }, { key: 'name', label: 'البند', kind: 'text', width: 60 }, { key: 'amount', label: 'المبلغ (ر.س)', kind: 'money' }],
    rows, notes: s.balanced ? [] : ['تنبيه: قائمة المركز المالي غير متوازنة — راجع القيود.'],
  };
}

type LedgerRowDb = { entry_id: string; number: string; entry_date: string; memo: string | null; line_memo: string | null; source_ref: string | null; kind: string; debit: string; credit: string; party_name: string | null; project_number: string | null; acc_code: string; acc_name: string };

const ledgerQuery = z.object({
  account: zUuid, party: zUuid.optional(), project: zUuid.optional(), from: zDate.optional(), to: zDate.optional(), format,
});
const journalQuery = z.object({ from: zDate.optional(), to: zDate.optional(), account: zUuid.optional(), party: zUuid.optional(), project: zUuid.optional(), format });

/** دفتر اليومية as JSON + table (also used by the auditor pack). */
export async function journalReport(tx: Tx, p: { from: string; to: string; account?: string; party?: string; project?: string }) {
  const filt = and(
    eq(journalEntry.status, 'posted'), gte(journalEntry.entryDate, p.from), lte(journalEntry.entryDate, p.to),
    p.account ? sql`exists (select 1 from journal_line x where x.entry_id = ${journalEntry.id} and x.account_id = ${p.account})` : undefined,
    p.party ? sql`exists (select 1 from journal_line x where x.entry_id = ${journalEntry.id} and x.party_id = ${p.party})` : undefined,
    p.project ? sql`exists (select 1 from journal_line x where x.entry_id = ${journalEntry.id} and x.project_id = ${p.project})` : undefined,
  );
  const heads = await tx.select({ id: journalEntry.id, number: journalEntry.number, date: journalEntry.entryDate, memo: journalEntry.memo, kind: journalEntry.kind, total: journalEntry.total, sourceRef: journalEntry.sourceRef }).from(journalEntry).where(filt).orderBy(journalEntry.entryDate, journalEntry.number).limit(20000);
  type JLine = { entry_id: string; line_no: number; code: string; name: string; debit: string; credit: string; party_name: string | null; project_number: string | null; memo: string | null };
  const lines: JLine[] = heads.length ? await tx.execute<JLine>(sql`
    select l.entry_id, l.line_no, a.code, a.name_ar as name, l.debit::text, l.credit::text, pa.name_ar as party_name, pr.number as project_number, l.memo
    from journal_line l join account a on a.id = l.account_id left join party pa on pa.id = l.party_id left join project pr on pr.id = l.project_id
    where l.entry_id in (${sql.join(heads.map((h) => sql`${h.id}`), sql`, `)}) order by l.entry_id, l.line_no`) : [];
  const by = new Map<string, typeof lines>();
  for (const l of lines) by.set(l.entry_id, [...(by.get(l.entry_id) ?? []), l]);
  const entries = heads.map((h) => ({ ...h, lines: by.get(h.id) ?? [] }));
  const json = {
    from: p.from, to: p.to,
    entries: entries.map((e) => ({ id: e.id, number: e.number, date: e.date, memo: e.memo, kind: e.kind, total: e.total, sourceRef: e.sourceRef, lines: e.lines.map((l) => ({ lineNo: l.line_no, code: l.code, name: l.name, debit: l.debit, credit: l.credit, party: l.party_name, project: l.project_number, memo: l.memo })) })),
  };
  const rows: ReportTable['rows'] = [];
  for (const e of entries) {
    rows.push({ style: 'group', cells: { date: e.date, number: e.number, name: e.memo ?? '', debit: H(e.total), credit: H(e.total) } });
    for (const l of e.lines) rows.push({ cells: { code: l.code, name: l.name + (l.party_name ? ` — ${l.party_name}` : '') + (l.memo ? ` (${l.memo})` : ''), debit: H(l.debit), credit: H(l.credit) }, depth: 1 });
  }
  const table: ReportTable = {
    title: 'دفتر اليومية', titleEn: 'General journal', subtitle: `من ${p.from} إلى ${p.to}`,
    columns: [{ key: 'date', label: 'التاريخ', kind: 'date' }, { key: 'number', label: 'رقم القيد', kind: 'text' }, { key: 'code', label: 'الرمز', kind: 'text' }, { key: 'name', label: 'الحساب / البيان', kind: 'text', width: 40 }, { key: 'debit', label: 'مدين', kind: 'money' }, { key: 'credit', label: 'دائن', kind: 'money' }],
    rows,
  };
  return { json, table };
}

@Controller('accounting/reports')
export class LedgerReportsController {
  @Get('trial-balance')
  @Perm('ledger.read')
  async trial(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(range.and(z.object({ level, withZero: flag })))) q: { from?: string; to?: string; format: 'json' | 'xlsx' | 'pdf'; level?: number; withZero: boolean }) {
    const { p, tb } = await tenantTx(actor.tenantId, async (tx) => {
      const p = await defaultRange(tx, q);
      return { p, tb: await trialBalance(tx, { ...p, level: q.level, withZero: q.withZero }) };
    });
    return send(res, actor, q.format, trialJson(tb, p), trialTable(tb, p), 'trial-balance');
  }

  @Get('income-statement')
  @Perm('ledger.read')
  async income(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(range.and(z.object({ by: z.enum(['none', 'month', 'project', 'department']).default('none') })))) q: { from?: string; to?: string; format: 'json' | 'xlsx' | 'pdf'; by: 'none' | 'month' | 'project' | 'department' }) {
    const { p, is } = await tenantTx(actor.tenantId, async (tx) => {
      const p = await defaultRange(tx, q);
      return { p, is: await incomeStatement(tx, { ...p, by: q.by }) };
    });
    return send(res, actor, q.format, incomeJson(is, { ...p, by: q.by }), incomeTable(is, p), 'income-statement');
  }

  @Get('balance-sheet')
  @Perm('ledger.read')
  async balance(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(z.object({ asOf: zDate.optional(), format }))) q: { asOf?: string; format: 'json' | 'xlsx' | 'pdf' }) {
    const asOf = q.asOf ?? riyadhDate();
    const b = await tenantTx(actor.tenantId, (tx) => balanceSheet(tx, asOf));
    return send(res, actor, q.format, sheetJson(b, asOf), sheetTable(b, asOf), 'balance-sheet');
  }

  /** Statement of one account (a group account includes everything beneath it), optionally for one customer/supplier or project. */
  @Get('ledger')
  @Perm('ledger.read')
  async ledger(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(ledgerQuery)) q: z.infer<typeof ledgerQuery>) {
    const data = await tenantTx(actor.tenantId, async (tx) => {
      const p = await defaultRange(tx, q);
      const accounts = await loadAccounts(tx);
      const acc = accounts.find((a) => a.id === q.account);
      if (!acc) throw notFound('account');
      const refs = accounts.map(accountRef);
      const below = new Set<string>([acc.id]);
      for (let grew = true; grew;) { grew = false; for (const a of refs) if (a.parentId && below.has(a.parentId) && !below.has(a.id)) { below.add(a.id); grew = true; } }
      const ids = [...below];
      const inIds = sql.join(ids.map((i) => sql`${i}`), sql`, `);
      const dims = sql`${q.party ? sql`and l.party_id = ${q.party}` : sql``} ${q.project ? sql`and l.project_id = ${q.project}` : sql``}`;
      const [open] = await tx.execute<{ net: string }>(sql`select coalesce(sum(l.debit - l.credit), 0)::text as net from journal_line l join journal_entry e on e.id = l.entry_id
        where e.status = 'posted' and l.account_id in (${inIds}) and l.entry_date < ${p.from} ${dims}`);
      const rows = await tx.execute<LedgerRowDb>(sql`
        select e.id as entry_id, e.number, l.entry_date::text as entry_date, e.memo, l.memo as line_memo, e.source_ref, e.kind, l.debit::text as debit, l.credit::text as credit,
               pa.name_ar as party_name, pr.number as project_number, a.code as acc_code, a.name_ar as acc_name
        from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
        left join party pa on pa.id = l.party_id left join project pr on pr.id = l.project_id
        where e.status = 'posted' and l.account_id in (${inIds}) and l.entry_date >= ${p.from} and l.entry_date <= ${p.to} ${dims}
        order by l.entry_date, e.number, l.line_no limit 20000`);
      const run = withRunningBalance(acc.type as AccountType, H(open?.net), rows.map((r) => ({ ...r, debit: H(r.debit), credit: H(r.credit) })));
      return { p, acc, run, multi: ids.length > 1 };
    });
    const { p, acc, run, multi } = data;
    const json = {
      account: { id: acc.id, code: acc.code, nameAr: acc.nameAr, nameEn: acc.nameEn, type: acc.type, isGroup: acc.isGroup }, from: p.from, to: p.to,
      opening: fx(run.opening), totalDebit: fx(run.totalDebit), totalCredit: fx(run.totalCredit), closing: fx(run.closing),
      rows: run.rows.map((r) => ({ entryId: r.entry_id, number: r.number, date: r.entry_date, kind: r.kind, memo: r.line_memo || r.memo, sourceRef: r.source_ref, party: r.party_name, project: r.project_number, account: multi ? `${r.acc_code} ${r.acc_name}` : null, debit: fx(r.debit), credit: fx(r.credit), balance: fx(r.balance) })),
    };
    const columns: ReportTable['columns'] = [
      { key: 'date', label: 'التاريخ', kind: 'date' }, { key: 'number', label: 'رقم القيد', kind: 'text' },
      ...(multi ? [{ key: 'account', label: 'الحساب', kind: 'text' as const }] : []),
      { key: 'memo', label: 'البيان', kind: 'text', width: 30 }, { key: 'party', label: 'العميل/المورد', kind: 'text' }, { key: 'project', label: 'المشروع', kind: 'text' },
      { key: 'debit', label: 'مدين', kind: 'money' }, { key: 'credit', label: 'دائن', kind: 'money' }, { key: 'balance', label: 'الرصيد', kind: 'money' },
    ];
    const rows: ReportTable['rows'] = [
      { style: 'group', cells: { memo: 'رصيد افتتاحي', balance: run.opening } },
      ...run.rows.map((r) => ({ cells: { date: r.entry_date, number: r.number, account: `${r.acc_code} ${r.acc_name}`, memo: r.line_memo || r.memo, party: r.party_name, project: r.project_number, debit: r.debit, credit: r.credit, balance: r.balance } })),
      { style: 'total' as const, cells: { memo: 'الإجمالي / الرصيد الختامي', debit: run.totalDebit, credit: run.totalCredit, balance: run.closing } },
    ];
    const table: ReportTable = { title: `كشف حساب — ${acc.code} ${acc.nameAr}`, titleEn: 'Account statement', subtitle: `من ${p.from} إلى ${p.to}${q.party ? ' — عميل/مورد محدد' : ''}${q.project ? ' — مشروع محدد' : ''}`, columns, rows };
    return send(res, actor, q.format, json, table, `ledger-${acc.code}`);
  }

  /** دفتر اليومية — every posted entry in the range with its lines. */
  @Get('journal')
  @Perm('ledger.read')
  async journal(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(journalQuery)) q: z.infer<typeof journalQuery>) {
    const { json, table } = await tenantTx(actor.tenantId, async (tx) => journalReport(tx, { ...(await defaultRange(tx, q)), account: q.account, party: q.party, project: q.project }));
    return send(res, actor, q.format, json, table, 'journal');
  }
}
