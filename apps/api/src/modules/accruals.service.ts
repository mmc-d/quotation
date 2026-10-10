import { employee, eq, fixedAsset, fixedAssetDep, glRun, sql, type Tx } from '@mmc/db';
import { depreciationDue, disposalResult, eosbLiability, eosbProvision, lastDayOfMonth, monthOf, riyadhDate, type AssetTerms } from '@mmc/domain';
import { badRequest, conflict, notFound } from '../common/errors.js';
import type { RequestActor } from '../auth/actor.js';
import { accountByKey, createPosted, loadSettings, userName, type LineInput } from './ledger.service.js';
import { H, fx } from './report-kit.js';

/**
 * Monthly accruals (Phase 6C): depreciation of the fixed-asset register and the end-of-service
 * provision. Each run is one posted entry (source_type = kind, source_id = the gl_run row) and is
 * only possible for a month that has ended and is not locked. A skipped month is caught up by the
 * next run, because both calculations are "due through the month" minus "already booked".
 */

export type AssetRow = typeof fixedAsset.$inferSelect;

export const termsOf = (a: AssetRow): AssetTerms => ({ cost: H(a.cost), salvage: H(a.salvage), lifeMonths: a.lifeMonths, startMonth: a.startMonth });

export async function bookedDepreciation(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx.execute<{ asset_id: string; s: string }>(sql`select asset_id, sum(amount)::text as s from fixed_asset_dep group by asset_id`);
  return new Map(rows.map((r) => [r.asset_id, H(r.s)]));
}

const monthEnd = (ym: string) => `${ym}-${String(lastDayOfMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)))).padStart(2, '0')}`;

async function assertRunnable(tx: Tx, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('month must be YYYY-MM');
  const s = await loadSettings(tx);
  if (!s.goLiveDate) throw conflict('لم يُحدد تاريخ بدء النظام المحاسبي بعد');
  const end = monthEnd(month);
  if (end > riyadhDate()) throw conflict('لا يمكن ترحيل شهر لم ينتهِ بعد');
  if (month < monthOf(s.goLiveDate)) throw conflict('الشهر يسبق تاريخ بدء النظام المحاسبي');
  if (s.lockedThrough && end <= s.lockedThrough) throw conflict(`الفترة مقفلة حتى ${s.lockedThrough} — يُرحَّل الإهلاك لأول شهر مفتوح وسيشمل المتأخر تلقائيًا`);
  return { end, settings: s };
}

async function nextSeq(tx: Tx, kind: string, period: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`select coalesce(max(seq), 0)::int + 1 as n from gl_run where kind = ${kind} and period = ${period}`);
  return r?.n ?? 1;
}

// ─────────────────────────────── depreciation ───────────────────────────────

export interface DepLine { assetId: string; code: string; nameAr: string; amount: number; accumulatedAfter: number }

export async function previewDepreciation(tx: Tx, month: string): Promise<{ month: string; date: string; lines: DepLine[]; total: number }> {
  const assets = await tx.select().from(fixedAsset).where(eq(fixedAsset.status, 'active'));
  const booked = await bookedDepreciation(tx);
  const lines: DepLine[] = [];
  for (const a of assets) {
    if (a.startMonth > month) continue;
    const already = H(a.openingAccumulated) + (booked.get(a.id) ?? 0);
    const due = depreciationDue(termsOf(a), month, already);
    if (due > 0) lines.push({ assetId: a.id, code: a.code, nameAr: a.nameAr, amount: due, accumulatedAfter: already + due });
  }
  return { month, date: monthEnd(month), lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

export async function runDepreciation(tx: Tx, actor: RequestActor, month: string) {
  await assertRunnable(tx, month);
  const p = await previewDepreciation(tx, month);
  if (!p.lines.length) return { entry: null, total: 0, lines: 0 };
  const assets = new Map((await tx.select().from(fixedAsset)).map((a) => [a.id, a]));
  const lines: LineInput[] = [];
  for (const l of p.lines) {
    const a = assets.get(l.assetId)!;
    const ctx = { projectId: a.projectId, costCenter: a.costCenter, memo: `${a.code} ${a.nameAr}` };
    lines.push({ accountId: a.expenseAccountId, debit: l.amount, credit: 0, ...ctx }, { accountId: a.accumAccountId, debit: 0, credit: l.amount, memo: ctx.memo });
  }
  const seq = await nextSeq(tx, 'depreciation', month);
  const [run] = await tx.insert(glRun).values({ kind: 'depreciation', period: month, seq, total: fx(p.total), createdBy: actor.userId }).returning({ id: glRun.id });
  const entry = await createPosted(tx, { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) }, {
    entryDate: p.date, kind: 'auto', memo: `إهلاك الأصول الثابتة عن شهر ${month}`, lines, sourceType: 'depreciation', sourceId: run!.id, sourceRef: month, sourceEvent: 'post',
  });
  await tx.update(glRun).set({ entryId: entry.id }).where(eq(glRun.id, run!.id));
  await tx.insert(fixedAssetDep).values(p.lines.map((l) => ({ assetId: l.assetId, runId: run!.id, month, amount: fx(l.amount) })));
  return { entry, total: p.total, lines: p.lines.length };
}

export async function disposeAsset(tx: Tx, actor: RequestActor, id: string, d: { date: string; proceeds: number; proceedsAccountId: string | null }) {
  const [a] = await tx.select().from(fixedAsset).where(eq(fixedAsset.id, id));
  if (!a) throw notFound('fixed asset');
  if (a.status !== 'active') throw conflict('الأصل مستبعد بالفعل');
  if (d.date < a.acquiredOn) throw badRequest('تاريخ الاستبعاد يسبق تاريخ الشراء');
  if (d.date > riyadhDate()) throw badRequest('لا يمكن الاستبعاد بتاريخ مستقبلي');
  const s = await loadSettings(tx);
  if (s.lockedThrough && d.date <= s.lockedThrough) throw conflict(`الفترة مقفلة حتى ${s.lockedThrough}`);
  if (d.proceeds > 0 && !d.proceedsAccountId) throw badRequest('اختر الحساب الذي استُلم فيه مقابل البيع');
  const booked = (await bookedDepreciation(tx)).get(a.id) ?? 0;
  const already = H(a.openingAccumulated) + booked;
  const due = depreciationDue(termsOf(a), monthOf(d.date), already);
  const accumulated = already + due;
  const cost = H(a.cost);
  const result = disposalResult(cost, accumulated, d.proceeds);
  const memo = `استبعاد الأصل ${a.code} ${a.nameAr}`;
  const lines: LineInput[] = [];
  if (due > 0) lines.push({ accountId: a.expenseAccountId, debit: due, credit: 0, memo: `${memo} — إهلاك حتى الاستبعاد`, projectId: a.projectId, costCenter: a.costCenter }, { accountId: a.accumAccountId, debit: 0, credit: due, memo });
  if (d.proceeds > 0) lines.push({ accountId: d.proceedsAccountId!, debit: d.proceeds, credit: 0, memo });
  if (accumulated > 0) lines.push({ accountId: a.accumAccountId, debit: accumulated, credit: 0, memo });
  lines.push({ accountId: a.accountId, debit: 0, credit: cost, memo });
  if (result > 0) lines.push({ accountId: (await accountByKey(tx, 'other_income')).id, debit: 0, credit: result, memo: `${memo} — ربح بيع أصل` });
  else if (result < 0) lines.push({ accountId: (await accountByKey(tx, 'general_expenses')).id, debit: -result, credit: 0, memo: `${memo} — خسارة استبعاد أصل` });
  const entry = await createPosted(tx, { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) }, {
    entryDate: d.date, kind: 'adjustment', memo, lines, sourceType: 'fixed_asset_disposal', sourceId: a.id, sourceRef: a.code, sourceEvent: 'dispose',
  });
  if (due > 0) {
    const seq = await nextSeq(tx, 'depreciation', monthOf(d.date));
    const [run] = await tx.insert(glRun).values({ kind: 'depreciation', period: monthOf(d.date), seq, entryId: entry.id, total: fx(due), createdBy: actor.userId }).returning({ id: glRun.id });
    await tx.insert(fixedAssetDep).values({ assetId: a.id, runId: run!.id, month: monthOf(d.date), amount: fx(due) });
  }
  await tx.update(fixedAsset).set({ status: 'disposed', disposedOn: d.date, disposalProceeds: fx(d.proceeds), disposalEntryId: entry.id, updatedAt: new Date(), updatedBy: actor.userId, version: a.version + 1 }).where(eq(fixedAsset.id, id));
  return { entry, accumulated, result, depreciationAdded: due };
}

// ─────────────────────────────── end-of-service provision ───────────────────────────────

export interface EosbRow {
  employeeId: string; number: string; nameAr: string; department: string | null; hireDate: string; terminationDate: string | null;
  years: number; wage: number; target: number; booked: number; delta: number;
}

export async function previewEosb(tx: Tx, month: string) {
  const end = monthEnd(month);
  const start = `${month}-01`;
  const emps = await tx.select().from(employee);
  const live = emps.filter((e) => e.hireDate <= end && (!e.terminationDate || e.terminationDate >= start));
  const wageOf = (e: typeof employee.$inferSelect) => H(e.basicSalary) + H(e.housingAllowance) + H(e.transportAllowance) + (e.otherAllowances ?? []).reduce((s, r) => s + H(r.amount), 0);
  const prov = await accountByKey(tx, 'eos_provision');
  const bookedRows = await tx.execute<{ employee_id: string | null; net: string }>(sql`
    select l.employee_id, coalesce(sum(l.credit - l.debit), 0)::text as net
    from journal_line l join journal_entry e on e.id = l.entry_id
    where e.status = 'posted' and l.account_id = ${prov.id} and l.entry_date <= ${end} group by l.employee_id`);
  const byEmp = new Map<string, number>();
  let balance = 0;
  for (const r of bookedRows) { balance += H(r.net); if (r.employee_id) byEmp.set(r.employee_id, H(r.net)); }
  const res = eosbProvision(live.map((e) => ({ id: e.id, hireDate: e.hireDate, terminationDate: e.terminationDate, wage: wageOf(e) })), end, byEmp, balance);
  const info = new Map(res.lines.map((l) => [l.employeeId, l]));
  const rows: EosbRow[] = live.map((e) => {
    const wage = wageOf(e);
    const l = info.get(e.id);
    const t = eosbLiability({ id: e.id, hireDate: e.hireDate, terminationDate: e.terminationDate, wage }, end);
    const booked = byEmp.get(e.id) ?? 0;
    return { employeeId: e.id, number: e.number, nameAr: e.nameAr, department: e.department, hireDate: e.hireDate, terminationDate: e.terminationDate, years: t.years, wage, target: l?.target ?? t.amount, booked, delta: (l?.delta ?? t.amount - booked) };
  }).sort((a, b) => a.number.localeCompare(b.number));
  return { month, date: end, rows, remainder: res.remainder, target: res.target, balance, toPost: rows.reduce((s, r) => s + r.delta, 0) + res.remainder };
}

export async function runEosb(tx: Tx, actor: RequestActor, month: string) {
  await assertRunnable(tx, month);
  const p = await previewEosb(tx, month);
  const expense = await accountByKey(tx, 'eos_expense');
  const prov = await accountByKey(tx, 'eos_provision');
  const lines: LineInput[] = [];
  const pair = (delta: number, extra: Partial<LineInput>) => {
    if (delta === 0) return;
    const amt = Math.abs(delta);
    lines.push(
      { accountId: expense.id, debit: delta > 0 ? amt : 0, credit: delta < 0 ? amt : 0, ...extra },
      { accountId: prov.id, debit: delta < 0 ? amt : 0, credit: delta > 0 ? amt : 0, employeeId: extra.employeeId ?? null, memo: extra.memo ?? null },
    );
  };
  for (const r of p.rows) pair(r.delta, { employeeId: r.employeeId, costCenter: r.department, memo: `${r.number} ${r.nameAr}` });
  pair(p.remainder, { memo: 'تسوية رصيد مرحّل بلا تحديد موظف' });
  if (!lines.length) return { entry: null, total: 0, lines: 0 };
  const seq = await nextSeq(tx, 'eosb', month);
  const [run] = await tx.insert(glRun).values({ kind: 'eosb', period: month, seq, total: fx(p.toPost), createdBy: actor.userId }).returning({ id: glRun.id });
  const entry = await createPosted(tx, { userId: actor.userId, name: await userName(tx, actor.userId, actor.name) }, {
    entryDate: p.date, kind: 'auto', memo: `مخصص مكافأة نهاية الخدمة عن شهر ${month}`, lines, sourceType: 'eosb', sourceId: run!.id, sourceRef: month, sourceEvent: 'post',
  });
  await tx.update(glRun).set({ entryId: entry.id }).where(eq(glRun.id, run!.id));
  return { entry, total: p.toPost, lines: lines.length };
}
