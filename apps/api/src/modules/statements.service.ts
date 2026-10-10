import { party, sql, inArray, type Tx } from '@mmc/db';
import {
  agingFifo, AGING_BUCKETS, buildCashFlow, buildEquityChanges, cashFlowClass, fiscalYearOf, zakatSchedule, ZAKAT_RATE_GREGORIAN, ZAKAT_RATE_HIJRI,
  type AccountType, type AgingParty, type CashFlowStatement, type EquityChanges, type ZakatSchedule,
} from '@mmc/domain';
import type { ReportTable } from '@mmc/doc-templates';
import { loadAccounts, loadSettings } from './ledger.service.js';
import { H, fx } from './report-kit.js';

/** Cash flow, equity changes, aging and the Zakat-base schedule from the posted ledger (Phase 6C). */

const inList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

async function netMap(tx: Tx, where: ReturnType<typeof sql>): Promise<Map<string, number>> {
  const rows = await tx.execute<{ account_id: string; net: string }>(sql`
    select l.account_id, coalesce(sum(l.debit - l.credit), 0)::text as net
    from journal_line l join journal_entry e on e.id = l.entry_id
    where e.status = 'posted' and ${where} group by l.account_id`);
  return new Map(rows.map((r) => [r.account_id, H(r.net)]));
}

// ─────────────────────────────── cash flow ───────────────────────────────

export async function cashFlow(tx: Tx, from: string, to: string): Promise<CashFlowStatement> {
  const accounts = await loadAccounts(tx);
  const deltas = await netMap(tx, sql`e.kind not in ('opening', 'closing') and l.entry_date >= ${from} and l.entry_date <= ${to}`);
  const cashIds = accounts.filter((a) => !a.isGroup && cashFlowClass({ code: a.code, type: a.type as AccountType }) === 'cash').map((a) => a.id);
  let opening = 0, closing = 0;
  if (cashIds.length) {
    const before = await netMap(tx, sql`l.entry_date < ${from} and l.account_id in (${inList(cashIds)})`);
    const seeded = await netMap(tx, sql`e.kind = 'opening' and l.entry_date >= ${from} and l.entry_date <= ${to} and l.account_id in (${inList(cashIds)})`);
    const upTo = await netMap(tx, sql`l.entry_date <= ${to} and l.account_id in (${inList(cashIds)})`);
    for (const v of before.values()) opening += v;
    for (const v of seeded.values()) opening += v;
    for (const v of upTo.values()) closing += v;
  }
  let profit = 0;
  for (const a of accounts) if (!a.isGroup && (a.type === 'income' || a.type === 'expense')) profit -= deltas.get(a.id) ?? 0;
  return buildCashFlow(accounts.map((a) => ({ id: a.id, code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, type: a.type as AccountType, isGroup: a.isGroup })), deltas, profit, opening, closing);
}

export function cashFlowJson(c: CashFlowStatement, p: { from: string; to: string }) {
  const rows = (r: { accountId: string | null; code: string; nameAr: string; amount: number }[]) => r.map((x) => ({ ...x, amount: fx(x.amount) }));
  return {
    from: p.from, to: p.to,
    operating: { profit: fx(c.operating.profit), adjustments: rows(c.operating.adjustments), workingCapital: rows(c.operating.workingCapital), total: fx(c.operating.total) },
    investing: { rows: rows(c.investing.rows), total: fx(c.investing.total) }, financing: { rows: rows(c.financing.rows), total: fx(c.financing.total) },
    netChange: fx(c.netChange), openingCash: fx(c.openingCash), closingCash: fx(c.closingCash), difference: fx(c.difference), tiesToLedger: c.difference === 0,
  };
}

export function cashFlowTable(c: CashFlowStatement, p: { from: string; to: string }): ReportTable {
  const rows: ReportTable['rows'] = [];
  const line = (name: string, amount: number, style: ReportTable['rows'][number]['style'] = 'normal', depth = 1, code = '') => rows.push({ style, depth, cells: { code, name, amount } });
  rows.push({ style: 'heading', cells: { name: 'الأنشطة التشغيلية' } });
  line('صافي ربح (خسارة) الفترة', c.operating.profit);
  if (c.operating.adjustments.length) rows.push({ style: 'normal', depth: 1, cells: { name: 'تسويات لبنود غير نقدية:' } });
  c.operating.adjustments.forEach((r) => line(r.nameAr, r.amount, 'normal', 2, r.code));
  if (c.operating.workingCapital.length) rows.push({ style: 'normal', depth: 1, cells: { name: 'التغير في رأس المال العامل:' } });
  c.operating.workingCapital.forEach((r) => line(r.nameAr, r.amount, 'normal', 2, r.code));
  line('صافي النقد من الأنشطة التشغيلية', c.operating.total, 'subtotal', 0);
  rows.push({ style: 'heading', cells: { name: 'الأنشطة الاستثمارية' } });
  c.investing.rows.forEach((r) => line(r.nameAr, r.amount, 'normal', 1, r.code));
  line('صافي النقد من الأنشطة الاستثمارية', c.investing.total, 'subtotal', 0);
  rows.push({ style: 'heading', cells: { name: 'الأنشطة التمويلية' } });
  c.financing.rows.forEach((r) => line(r.nameAr, r.amount, 'normal', 1, r.code));
  line('صافي النقد من الأنشطة التمويلية', c.financing.total, 'subtotal', 0);
  line('صافي التغير في النقد وما يعادله', c.netChange, 'group', 0);
  line('النقد وما يعادله في بداية الفترة', c.openingCash, 'normal', 0);
  line('النقد وما يعادله في نهاية الفترة', c.closingCash, 'total', 0);
  return {
    title: 'قائمة التدفقات النقدية', titleEn: 'Cash flow statement (indirect)', subtitle: `من ${p.from} إلى ${p.to}`,
    columns: [{ key: 'code', label: 'الرمز', kind: 'text', width: 8 }, { key: 'name', label: 'البند', kind: 'text', width: 60 }, { key: 'amount', label: 'المبلغ (ر.س)', kind: 'money' }],
    rows, notes: c.difference === 0 ? [] : [`تنبيه: الفرق بين التغير في النقد والحركات = ${fx(c.difference)}`],
  };
}

// ─────────────────────────────── changes in equity ───────────────────────────────

export async function equityChanges(tx: Tx, from: string, to: string): Promise<EquityChanges & { from: string; to: string }> {
  const accounts = await loadAccounts(tx);
  const equity = accounts.filter((a) => !a.isGroup && a.type === 'equity');
  const pl = accounts.filter((a) => !a.isGroup && (a.type === 'income' || a.type === 'expense'));
  const eqIds = equity.map((a) => a.id);
  const plIds = pl.map((a) => a.id);
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  const opening = eqIds.length ? await netMap(tx, sql`l.account_id in (${inList(eqIds)}) and (l.entry_date < ${from} or (e.kind = 'opening' and l.entry_date <= ${to}))`) : new Map<string, number>();
  const movement = eqIds.length ? await netMap(tx, sql`l.account_id in (${inList(eqIds)}) and e.kind not in ('opening', 'closing') and l.entry_date >= ${from} and l.entry_date <= ${to}`) : new Map<string, number>();
  // earlier years' profit not yet closed into retained earnings (closed years net to zero because their closing entry is included)
  const earlier = plIds.length ? sum(await netMap(tx, sql`l.account_id in (${inList(plIds)}) and l.entry_date < ${from}`)) : 0;
  const profit = plIds.length ? -sum(await netMap(tx, sql`l.account_id in (${inList(plIds)}) and e.kind not in ('opening', 'closing') and l.entry_date >= ${from} and l.entry_date <= ${to}`)) : 0;
  const openingEntryProfit = plIds.length ? sum(await netMap(tx, sql`l.account_id in (${inList(plIds)}) and e.kind = 'opening' and l.entry_date >= ${from} and l.entry_date <= ${to}`)) : 0;
  const r = buildEquityChanges(equity.map((a) => ({ id: a.id, code: a.code, nameAr: a.nameAr })), opening, movement, profit, -(earlier + openingEntryProfit));
  return { ...r, from, to };
}

export function equityJson(r: EquityChanges & { from: string; to: string }) {
  return { from: r.from, to: r.to, columns: r.columns, rows: r.rows.map((x) => ({ key: x.key, ar: x.ar, values: Object.fromEntries(Object.entries(x.values).map(([k, v]) => [k, fx(v)])), total: fx(x.total) })) };
}

export function equityTable(r: EquityChanges & { from: string; to: string }): ReportTable {
  const columns: ReportTable['columns'] = [{ key: 'name', label: 'البند', kind: 'text', width: 36 }, ...r.columns.map((c) => ({ key: `c:${c.key}`, label: c.nameAr, kind: 'money' as const })), { key: 'total', label: 'الإجمالي', kind: 'money' }];
  const rows: ReportTable['rows'] = r.rows.map((x) => ({
    style: x.key === 'closing' ? 'total' : x.key === 'opening' ? 'group' : 'normal',
    cells: { name: x.ar, total: x.total, ...Object.fromEntries(r.columns.map((c) => [`c:${c.key}`, x.values[c.key] ?? 0])) },
  }));
  return { title: 'قائمة التغيرات في حقوق الملكية', titleEn: 'Statement of changes in equity', subtitle: `من ${r.from} إلى ${r.to}`, columns, rows };
}

// ─────────────────────────────── aging ───────────────────────────────

export async function aging(tx: Tx, side: 'ar' | 'ap', asOf: string) {
  const rows = await tx.execute<{ party_id: string | null; d: string; debit: string; credit: string }>(sql`
    select l.party_id, l.entry_date::text as d, l.debit::text, l.credit::text
    from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
    where e.status = 'posted' and a.posting_key = ${side} and l.entry_date <= ${asOf}`);
  const NONE = '__none__';
  const lines = rows.map((r) => ({ partyId: r.party_id ?? NONE, date: r.d, debit: H(r.debit), credit: H(r.credit) }));
  const result = agingFifo(lines, asOf, side);
  const ids = result.map((r) => r.partyId).filter((i) => i !== NONE);
  const names = new Map<string, string>();
  if (ids.length) for (const p of await tx.select({ id: party.id, nameAr: party.nameAr }).from(party).where(inArray(party.id, ids))) names.set(p.id, p.nameAr);
  const items = result.map((r) => ({ ...r, name: r.partyId === NONE ? 'بدون تحديد عميل/مورد' : names.get(r.partyId) ?? r.partyId })).sort((a, b) => b.total - a.total);
  const totals = AGING_BUCKETS.map((_, i) => items.reduce((s, r) => s + (r.buckets[i] ?? 0), 0));
  const unapplied = items.reduce((s, r) => s + r.unapplied, 0);
  const total = items.reduce((s, r) => s + r.total, 0);
  return { asOf, side, items, totals, unapplied, total };
}

type AgingResult = Awaited<ReturnType<typeof aging>>;

export function agingJson(a: AgingResult) {
  const row = (r: AgingParty & { name: string }) => ({ partyId: r.partyId === '__none__' ? null : r.partyId, name: r.name, total: fx(r.total), buckets: r.buckets.map(fx), unapplied: fx(r.unapplied) });
  return {
    asOf: a.asOf, side: a.side, buckets: AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label })), items: a.items.map(row),
    totals: { buckets: a.totals.map(fx), unapplied: fx(a.unapplied), total: fx(a.total) },
  };
}

export function agingTable(a: AgingResult): ReportTable {
  const cols: ReportTable['columns'] = [
    { key: 'name', label: a.side === 'ar' ? 'العميل' : 'المورد', kind: 'text', width: 32 },
    ...AGING_BUCKETS.map((b) => ({ key: b.key, label: `${b.label} يوم`, kind: 'money' as const })),
    { key: 'unapplied', label: 'دفعات غير مخصصة', kind: 'money' }, { key: 'total', label: 'الإجمالي', kind: 'money' },
  ];
  const rows: ReportTable['rows'] = a.items.map((r) => ({ cells: { name: r.name, unapplied: r.unapplied, total: r.total, ...Object.fromEntries(AGING_BUCKETS.map((b, i) => [b.key, r.buckets[i] ?? 0])) } }));
  rows.push({ style: 'total', cells: { name: 'الإجمالي', unapplied: a.unapplied, total: a.total, ...Object.fromEntries(AGING_BUCKETS.map((b, i) => [b.key, a.totals[i] ?? 0])) } });
  return {
    title: a.side === 'ar' ? 'أعمار الذمم المدينة (العملاء)' : 'أعمار الذمم الدائنة (الموردون)', titleEn: a.side === 'ar' ? 'Receivables aging' : 'Payables aging',
    subtitle: `كما في ${a.asOf} — حسب تاريخ المستند، وتُسدَّد الأقدم أولًا من الدفتر`, columns: cols, rows,
  };
}

// ─────────────────────────────── Zakat base ───────────────────────────────

export async function zakat(tx: Tx, asOf: string, opts: { rate: 'hijri' | 'gregorian'; profitAdjustments: number }) {
  const [accounts, settings] = await Promise.all([loadAccounts(tx), loadSettings(tx)]);
  const fy = fiscalYearOf(asOf, settings.fiscalYearStartMonth);
  // equity as it stands before this year's closing entry, so the year's profit is counted once
  const nets = await netMap(tx, sql`l.entry_date <= ${asOf} and not (e.kind = 'closing' and l.entry_date >= ${fy.start} and l.entry_date <= ${fy.end})`);
  const natural = (a: { id: string; type: string }) => { const n = nets.get(a.id) ?? 0; return a.type === 'asset' || a.type === 'expense' ? n : -n; };
  const live = accounts.filter((a) => !a.isGroup);
  const byKey = (k: string) => live.find((a) => a.postingKey === k);
  const capital = byKey('capital'), owner = byKey('owner_current'), re = byKey('retained_earnings'), eos = byKey('eos_provision'), accum = byKey('accumulated_depreciation');
  const used = new Set([capital?.id, owner?.id, re?.id, eos?.id, accum?.id]);
  const otherEquity = live.filter((a) => a.type === 'equity' && !used.has(a.id)).reduce((s, a) => s + natural(a), 0);
  const loans = live.filter((a) => a.type === 'liability' && a.code.startsWith('22') && a.id !== eos?.id).reduce((s, a) => s + natural(a), 0);
  const fixedCost = live.filter((a) => a.type === 'asset' && a.code.startsWith('12') && a.id !== accum?.id).reduce((s, a) => s + natural(a), 0);
  const cumulativeProfit = -live.filter((a) => a.type === 'income' || a.type === 'expense').reduce((s, a) => s + ((nets.get(a.id) ?? 0)), 0);
  // cumulative profit (this year's closing excluded) = earlier unclosed profit + this year's profit
  const yearNets = await netMap(tx, sql`e.kind <> 'closing' and l.entry_date >= ${fy.start} and l.entry_date <= ${asOf}`);
  const yearProfit = -live.filter((a) => a.type === 'income' || a.type === 'expense').reduce((s, a) => s + (yearNets.get(a.id) ?? 0), 0);
  const schedule: ZakatSchedule = zakatSchedule({
    capital: capital ? natural(capital) : 0,
    retainedAndReserves: (re ? natural(re) : 0) + (cumulativeProfit - yearProfit),
    ownerCurrent: owner ? natural(owner) : 0,
    otherEquity,
    netProfit: yearProfit,
    eosProvision: eos ? natural(eos) : 0,
    longTermLoans: loans,
    fixedAssetsCost: fixedCost,
    accumulatedDepreciation: accum ? -(nets.get(accum.id) ?? 0) : 0,
    profitAdjustments: opts.profitAdjustments,
    rate: opts.rate === 'hijri' ? ZAKAT_RATE_HIJRI : ZAKAT_RATE_GREGORIAN,
  });
  return { asOf, fiscalYear: fy, schedule };
}

type ZakatResult = Awaited<ReturnType<typeof zakat>>;

export function zakatJson(z: ZakatResult) {
  const s = z.schedule;
  const l = (r: { label: string; amount: number }[]) => r.map((x) => ({ label: x.label, amount: fx(x.amount) }));
  return {
    asOf: z.asOf, fiscalYear: z.fiscalYear, additions: l(s.additions), deductions: l(s.deductions), totalAdditions: fx(s.totalAdditions), totalDeductions: fx(s.totalDeductions),
    base: fx(s.base), adjustedProfit: fx(s.adjustedProfit), chargeable: fx(s.chargeable), rate: s.rate, zakat: fx(s.zakat),
    note: 'ورقة عمل تقديرية من الدفاتر — يعتمدها المحاسب القانوني ولا تُغني عن الإقرار الفعلي لدى الهيئة (نسبة 2.5٪ هجري / 2.5775٪ ميلادي، وتراجع كل عام).',
  };
}

export function zakatTable(z: ZakatResult): ReportTable {
  const s = z.schedule;
  const rows: ReportTable['rows'] = [{ style: 'heading', cells: { item: 'الإضافات' } }];
  s.additions.forEach((r) => rows.push({ depth: 1, cells: { item: r.label, amount: r.amount } }));
  rows.push({ style: 'subtotal', cells: { item: 'إجمالي الإضافات', amount: s.totalAdditions } });
  rows.push({ style: 'heading', cells: { item: 'الحسميات' } });
  s.deductions.forEach((r) => rows.push({ depth: 1, cells: { item: r.label, amount: r.amount } }));
  rows.push({ style: 'subtotal', cells: { item: 'إجمالي الحسميات', amount: s.totalDeductions } });
  rows.push({ style: 'group', cells: { item: 'الوعاء الزكوي', amount: s.base } });
  rows.push({ cells: { item: 'صافي الربح المعدّل', amount: s.adjustedProfit } });
  rows.push({ cells: { item: 'الوعاء الخاضع (الأكبر من الوعاء والربح المعدّل)', amount: s.chargeable } });
  rows.push({ style: 'total', cells: { item: `الزكاة المقدّرة (${(s.rate * 100).toFixed(4).replace(/0+$/, '')}٪)`, amount: s.zakat } });
  return {
    title: 'ورقة عمل الوعاء الزكوي', titleEn: 'Zakat base working schedule', subtitle: `السنة المالية ${z.fiscalYear.label} — كما في ${z.asOf}`,
    columns: [{ key: 'item', label: 'البند', kind: 'text', width: 60 }, { key: 'amount', label: 'المبلغ (ر.س)', kind: 'money' }],
    rows, notes: ['ورقة عمل تقديرية من الدفاتر يعتمدها المحاسب القانوني — لا تُغني عن إقرار الزكاة لدى الهيئة.'],
  };
}
