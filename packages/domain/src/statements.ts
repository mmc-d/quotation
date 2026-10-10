import type { Halalas } from './money.js';
import type { AccountType } from './ledger.js';
import { byCode, naturalBalance } from './ledger.js';
import type { PostLine } from './gl-posting.js';

/**
 * Supporting statements built from the ledger (Phase 6C): year-end closing lines, cash-flow
 * statement (indirect), statement of changes in equity, receivable/payable aging and the Zakat-base
 * working schedule. All amounts are integer halalas; net debit = debit − credit.
 */

// ─────────────────────────────── year-end closing ───────────────────────────────

/**
 * Closing entry: every income/expense account with a balance is brought to zero against retained
 * earnings. `nets` are net debits of the year's income/expense accounts (closing entries excluded).
 * Returns concrete account lines (`accountId`) plus the profit (credit-heavy = profit).
 */
export function buildClosingLines(nets: readonly { accountId: string; net: Halalas }[], retainedAccountId: string): { lines: (PostLine & { accountId: string })[]; profit: Halalas } {
  const lines: (PostLine & { accountId: string })[] = [];
  let sum = 0;
  for (const n of nets) {
    if (n.net === 0) continue;
    sum += n.net;
    lines.push(n.net > 0 ? { accountId: n.accountId, debit: 0, credit: n.net } : { accountId: n.accountId, debit: -n.net, credit: 0 });
  }
  // sum > 0 = net expense (loss): retained earnings is debited; sum < 0 = profit: credited
  if (sum > 0) lines.push({ accountId: retainedAccountId, debit: sum, credit: 0 });
  else if (sum < 0) lines.push({ accountId: retainedAccountId, debit: 0, credit: -sum });
  return { lines, profit: -sum };
}

// ─────────────────────────────── cash flow ───────────────────────────────

export type CashFlowClass = 'cash' | 'profit' | 'depreciation' | 'provision' | 'working_capital' | 'investing' | 'financing';

export const CASH_FLOW_SECTIONS: { key: 'operating' | 'investing' | 'financing'; ar: string; en: string }[] = [
  { key: 'operating', ar: 'الأنشطة التشغيلية', en: 'Operating activities' },
  { key: 'investing', ar: 'الأنشطة الاستثمارية', en: 'Investing activities' },
  { key: 'financing', ar: 'الأنشطة التمويلية', en: 'Financing activities' },
];

/** Where an account's movement goes in the cash-flow statement, by type and chart code. */
export function cashFlowClass(acc: { code: string; type: AccountType }): CashFlowClass {
  if (acc.type === 'income' || acc.type === 'expense') return 'profit';
  if (acc.type === 'equity') return 'financing';
  if (acc.code.startsWith('110') && acc.type === 'asset') return 'cash'; // 1101–1104
  if (acc.code === '1209') return 'depreciation';
  if (acc.code === '2201') return 'provision';
  if (acc.code.startsWith('12')) return 'investing';
  if (acc.code.startsWith('22')) return 'financing';
  return 'working_capital';
}

export interface CashFlowAccount { id: string; code: string; nameAr: string; nameEn: string | null; type: AccountType; isGroup: boolean }
export interface CashFlowRow { accountId: string | null; code: string; nameAr: string; amount: Halalas }
export interface CashFlowStatement {
  operating: { profit: Halalas; adjustments: CashFlowRow[]; workingCapital: CashFlowRow[]; total: Halalas };
  investing: { rows: CashFlowRow[]; total: Halalas };
  financing: { rows: CashFlowRow[]; total: Halalas };
  netChange: Halalas;
  openingCash: Halalas;
  closingCash: Halalas;
  /** closing − opening − net change; 0 means the statement ties to the ledger */
  difference: Halalas;
}

/**
 * Indirect cash flow. `deltas` = change in net debit of every account over the period (opening and
 * closing entries excluded); `profit` = net profit of the period. By the double-entry identity the
 * non-cash balance-sheet movements plus profit equal the change in cash.
 */
export function buildCashFlow(accounts: readonly CashFlowAccount[], deltas: ReadonlyMap<string, Halalas>, profit: Halalas, openingCash: Halalas, closingCash: Halalas): CashFlowStatement {
  const adjustments: CashFlowRow[] = [];
  const workingCapital: CashFlowRow[] = [];
  const investing: CashFlowRow[] = [];
  const financing: CashFlowRow[] = [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const acc of byCode([...byId.values()])) {
    if (acc.isGroup) continue;
    const delta = deltas.get(acc.id) ?? 0;
    if (delta === 0) continue;
    const cls = cashFlowClass(acc);
    const row: CashFlowRow = { accountId: acc.id, code: acc.code, nameAr: acc.nameAr, amount: -delta };
    if (cls === 'depreciation' || cls === 'provision') adjustments.push(row);
    else if (cls === 'working_capital') workingCapital.push(row);
    else if (cls === 'investing') investing.push(row);
    else if (cls === 'financing') financing.push(row);
  }
  const sum = (r: CashFlowRow[]) => r.reduce((s, x) => s + x.amount, 0);
  const operatingTotal = profit + sum(adjustments) + sum(workingCapital);
  const netChange = operatingTotal + sum(investing) + sum(financing);
  return {
    operating: { profit, adjustments, workingCapital, total: operatingTotal },
    investing: { rows: investing, total: sum(investing) },
    financing: { rows: financing, total: sum(financing) },
    netChange, openingCash, closingCash, difference: closingCash - openingCash - netChange,
  };
}

// ─────────────────────────────── changes in equity ───────────────────────────────

export interface EquityColumn { key: string; nameAr: string; accountIds: string[] }
export interface EquityChanges {
  columns: { key: string; nameAr: string }[];
  rows: { key: 'opening' | 'profit' | 'movements' | 'closing'; ar: string; values: Record<string, Halalas>; total: Halalas }[];
}

/**
 * Statement of changes in equity. `opening`/`movement` are net debits per equity account; the
 * retained-earnings column also carries earlier years' unclosed profit and the period profit.
 */
export function buildEquityChanges(
  accounts: readonly { id: string; code: string; nameAr: string }[],
  opening: ReadonlyMap<string, Halalas>, movement: ReadonlyMap<string, Halalas>,
  profit: Halalas, openingProfit: Halalas,
): EquityChanges {
  const RETAINED = 'retained';
  const colOf = (code: string) => (code === '3201' ? RETAINED : code);
  const columns = new Map<string, string>();
  const open: Record<string, Halalas> = {};
  const mov: Record<string, Halalas> = {};
  for (const a of byCode([...accounts])) {
    const k = colOf(a.code);
    const o = -(opening.get(a.id) ?? 0);
    const m = -(movement.get(a.id) ?? 0);
    if (!columns.has(k) && (o !== 0 || m !== 0 || k === RETAINED)) columns.set(k, k === RETAINED ? 'الأرباح المبقاة (المرحّلة)' : a.nameAr);
    if (!columns.has(k)) continue;
    open[k] = (open[k] ?? 0) + o;
    mov[k] = (mov[k] ?? 0) + m;
  }
  open[RETAINED] = (open[RETAINED] ?? 0) + openingProfit;
  const keys = [...columns.keys()];
  const vals = (f: (k: string) => Halalas) => Object.fromEntries(keys.map((k) => [k, f(k)])) as Record<string, Halalas>;
  const total = (v: Record<string, Halalas>) => Object.values(v).reduce((s, x) => s + x, 0);
  const openRow = vals((k) => open[k] ?? 0);
  const profitRow = vals((k) => (k === RETAINED ? profit : 0));
  const movRow = vals((k) => mov[k] ?? 0);
  const closeRow = vals((k) => (openRow[k] ?? 0) + (profitRow[k] ?? 0) + (movRow[k] ?? 0));
  return {
    columns: keys.map((k) => ({ key: k, nameAr: columns.get(k)! })),
    rows: [
      { key: 'opening', ar: 'الرصيد في بداية الفترة', values: openRow, total: total(openRow) },
      { key: 'profit', ar: 'صافي ربح (خسارة) الفترة', values: profitRow, total: total(profitRow) },
      { key: 'movements', ar: 'حركات أخرى (مساهمات / مسحوبات)', values: movRow, total: total(movRow) },
      { key: 'closing', ar: 'الرصيد في نهاية الفترة', values: closeRow, total: total(closeRow) },
    ],
  };
}

// ─────────────────────────────── aging ───────────────────────────────

export const AGING_BUCKETS = [
  { key: 'b0', label: '0–30', from: 0, to: 30 },
  { key: 'b1', label: '31–60', from: 31, to: 60 },
  { key: 'b2', label: '61–90', from: 61, to: 90 },
  { key: 'b3', label: '91–180', from: 91, to: 180 },
  { key: 'b4', label: 'أكثر من 180', from: 181, to: Number.POSITIVE_INFINITY },
] as const;

export interface AgingLine { partyId: string; date: string; debit: Halalas; credit: Halalas }
export interface AgingParty { partyId: string; total: Halalas; buckets: Halalas[]; /** credits not matched to a charge (advances), a negative amount */ unapplied: Halalas }

const dayNo = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * Open items by age from ledger lines of a receivable (`side: 'ar'`, charges = debits) or payable
 * (`'ap'`, charges = credits) account. Settlements are applied to the oldest charges first; a
 * settlement that arrives before a charge waits as an unapplied credit and absorbs the next charge.
 */
export function agingFifo(lines: readonly AgingLine[], asOf: string, side: 'ar' | 'ap'): AgingParty[] {
  const by = new Map<string, AgingLine[]>();
  for (const l of lines) if (l.date <= asOf) by.set(l.partyId, [...(by.get(l.partyId) ?? []), l]);
  const out: AgingParty[] = [];
  for (const [partyId, ls] of by) {
    ls.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const open: { date: string; amount: Halalas }[] = [];
    let pool = 0;
    for (const l of ls) {
      const charge = side === 'ar' ? l.debit - l.credit : l.credit - l.debit;
      if (charge > 0) {
        const use = Math.min(pool, charge);
        pool -= use;
        if (charge - use > 0) open.push({ date: l.date, amount: charge - use });
      } else if (charge < 0) {
        let settle = -charge;
        while (settle > 0 && open.length) {
          const o = open[0]!;
          const take = Math.min(o.amount, settle);
          o.amount -= take;
          settle -= take;
          if (o.amount === 0) open.shift();
        }
        pool += settle;
      }
    }
    const buckets = AGING_BUCKETS.map(() => 0);
    for (const o of open) {
      const age = Math.max(0, dayNo(asOf) - dayNo(o.date));
      const i = AGING_BUCKETS.findIndex((b) => age >= b.from && age <= b.to);
      buckets[i < 0 ? buckets.length - 1 : i]! += o.amount;
    }
    const outstanding = buckets.reduce((s, v) => s + v, 0);
    if (outstanding === 0 && pool === 0) continue;
    out.push({ partyId, total: outstanding - pool, buckets, unapplied: -pool });
  }
  return out;
}

// ─────────────────────────────── Zakat base ───────────────────────────────

/** Zakat rate on a lunar (Hijri) year; a Gregorian year is scaled by 365/354 (ZATCA practice — confirm each year). */
export const ZAKAT_RATE_HIJRI = 0.025;
export const ZAKAT_RATE_GREGORIAN = 0.025775;

export interface ZakatInputs {
  /** natural-side balances at the year end (positive = normal) */
  capital: Halalas;
  retainedAndReserves: Halalas;
  ownerCurrent: Halalas;
  otherEquity: Halalas;
  /** net profit of the year per books */
  netProfit: Halalas;
  eosProvision: Halalas;
  longTermLoans: Halalas;
  /** cost and accumulated depreciation of non-current assets */
  fixedAssetsCost: Halalas;
  accumulatedDepreciation: Halalas;
  /** book adjustments to profit for tax purposes (non-deductible expenses − non-taxable income), entered by the accountant */
  profitAdjustments?: Halalas;
  /** 0.025 (Hijri) or 0.025775 (Gregorian) */
  rate?: number;
}

export interface ZakatSchedule {
  additions: { label: string; amount: Halalas }[];
  deductions: { label: string; amount: Halalas }[];
  totalAdditions: Halalas;
  totalDeductions: Halalas;
  base: Halalas;
  adjustedProfit: Halalas;
  /** ZATCA: the base is the greater of the Zakat base and the adjusted net profit */
  chargeable: Halalas;
  rate: number;
  zakat: Halalas;
}

export function zakatSchedule(i: ZakatInputs): ZakatSchedule {
  const adjustedProfit = i.netProfit + (i.profitAdjustments ?? 0);
  const additions = [
    { label: 'رأس المال', amount: i.capital },
    { label: 'الأرباح المبقاة والاحتياطيات', amount: i.retainedAndReserves },
    { label: 'جاري المالك / الشركاء', amount: i.ownerCurrent },
    { label: 'حقوق ملكية أخرى', amount: i.otherEquity },
    { label: 'صافي الربح المعدّل للعام', amount: adjustedProfit },
    { label: 'مخصص مكافأة نهاية الخدمة', amount: i.eosProvision },
    { label: 'قروض طويلة الأجل', amount: i.longTermLoans },
  ].filter((r) => r.amount !== 0);
  const net = i.fixedAssetsCost - i.accumulatedDepreciation;
  const deductions = [{ label: 'صافي الأصول الثابتة (التكلفة − مجمع الإهلاك)', amount: net }].filter((r) => r.amount !== 0);
  const totalAdditions = additions.reduce((s, r) => s + r.amount, 0);
  const totalDeductions = deductions.reduce((s, r) => s + r.amount, 0);
  const base = totalAdditions - totalDeductions;
  const chargeable = Math.max(0, Math.max(base, adjustedProfit));
  const rate = i.rate ?? ZAKAT_RATE_GREGORIAN;
  return { additions, deductions, totalAdditions, totalDeductions, base, adjustedProfit, chargeable, rate, zakat: Math.round(chargeable * rate) };
}

/** Convenience: a balance on its account type's natural side. */
export const natural = naturalBalance;
