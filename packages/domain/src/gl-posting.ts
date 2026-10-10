import type { Halalas } from './money.js';

/**
 * Auto-posting rules (Phase 6B, spec §6.1) as pure builders. A builder returns lines keyed by
 * posting key (`ar`, `vat_output` …) or by `method:<payment method>`; the API resolves keys to
 * accounts. Amounts are integer halalas, always positive; every builder returns balanced lines.
 */

export interface PostLine {
  /** posting key, or `method:<m>` for the account a payment method lands in */
  key?: string;
  /** a concrete account chosen by a person (voucher counter account) */
  accountId?: string;
  debit: Halalas;
  credit: Halalas;
  partyId?: string | null;
  employeeId?: string | null;
  projectId?: string | null;
  costCenter?: string | null;
  vatCode?: string | null;
  vatBase?: Halalas | null;
  memo?: string | null;
}

export interface Built {
  lines: PostLine[];
  /** things the accountant should look at (the entry is still posted) */
  warnings: string[];
}

const dr = (key: string, amount: Halalas, extra: Partial<PostLine> = {}): PostLine => ({ key, debit: amount, credit: 0, ...extra });
const cr = (key: string, amount: Halalas, extra: Partial<PostLine> = {}): PostLine => ({ key, debit: 0, credit: amount, ...extra });

/** Split `total` across `weights` proportionally; the parts always sum to `total` (largest remainder). */
export function allocateProportional(total: Halalas, weights: readonly number[]): Halalas[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.floor(r));
  let left = total - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k]!.i]! += 1;
  return out;
}

export type RevenueKind = 'devices' | 'installation' | 'service';
export const REVENUE_KEYS: Record<RevenueKind, string> = { devices: 'sales_devices', installation: 'sales_installation', service: 'sales_service' };

/** Which revenue account a sold line belongs to (spec §6.1: INS → installation; AMC/service items → service). */
export function revenueKind(code: string, opts: { isAmc?: boolean; serviceCodes?: ReadonlySet<string> } = {}): RevenueKind {
  if (code === 'INS') return 'installation';
  if (opts.isAmc || code === 'AMC' || opts.serviceCodes?.has(code)) return 'service';
  return 'devices';
}

export interface InvoiceFacts {
  /** 386 advance · 388 tax invoice · 381 credit note · 383 debit note */
  typeCode: string;
  /** halalas; credit notes are stored negative — the builder uses absolute values */
  taxable: Halalas;
  vat: Halalas;
  partyId: string | null;
  projectId: string | null;
  /** net amount of each invoice line, with its revenue kind (gross of any document discount) */
  lines: { net: Halalas; kind: RevenueKind }[];
  /** 388 only: the contract's non-cancelled 386 advances being cleared by this invoice */
  advances?: { taxable: Halalas; vat: Halalas }[];
  /** 381 only: the credited invoice was a 386 advance, so the credit goes back to customer advances */
  creditsAdvance?: boolean;
  /** invoice.prepaid for a 388 (halalas) — compared with the advances for a warning */
  prepaid?: Halalas;
  /** the company was VAT-registered on the invoice date but charged no VAT: the supply is zero-rated (return code Z) */
  zeroRated?: boolean;
}

export function buildInvoiceLines(f: InvoiceFacts): Built {
  const warnings: string[] = [];
  const taxable = Math.abs(f.taxable);
  const vat = Math.abs(f.vat);
  const total = taxable + vat;
  const party = { partyId: f.partyId };
  const lines: PostLine[] = [];
  if (total === 0) return { lines, warnings };

  // Revenue per account: line nets scaled so the parts add up to the invoice's taxable amount (document discount, D5).
  const revenue = (): PostLine[] => {
    const kinds: RevenueKind[] = ['devices', 'installation', 'service'];
    const sums = kinds.map((k) => f.lines.filter((l) => l.kind === k).reduce((s, l) => s + Math.abs(l.net), 0));
    const parts = allocateProportional(taxable, sums);
    const z = !!f.zeroRated && vat === 0;
    return kinds.flatMap((k, i) => (parts[i] ? [{ key: REVENUE_KEYS[k], debit: 0, credit: parts[i]!, projectId: f.projectId, ...(z ? { vatCode: 'Z', vatBase: parts[i]! } : {}) } as PostLine] : []));
  };

  if (f.typeCode === '386') {
    lines.push(dr('ar', total, party));
    if (taxable) lines.push(cr('customer_advances', taxable, party));
    if (vat) lines.push(cr('vat_output', vat, { vatCode: 'S', vatBase: taxable }));
  } else if (f.typeCode === '381') {
    if (f.creditsAdvance) { if (taxable) lines.push(dr('customer_advances', taxable, party)); } else for (const r of revenue()) lines.push({ ...r, debit: r.credit, credit: 0, ...(r.vatBase != null ? { vatBase: -r.vatBase } : {}) });
    if (vat) lines.push(dr('vat_output', vat, { vatCode: 'S', vatBase: -taxable }));
    lines.push(cr('ar', total, party));
  } else {
    // 388 and 383
    lines.push(dr('ar', total, party));
    lines.push(...revenue());
    if (vat) lines.push(cr('vat_output', vat, { vatCode: 'S', vatBase: taxable }));
    const adv = f.advances ?? [];
    if (f.typeCode === '388' && adv.length) {
      const aTax = adv.reduce((s, a) => s + Math.abs(a.taxable), 0);
      const aVat = adv.reduce((s, a) => s + Math.abs(a.vat), 0);
      if (f.prepaid !== undefined && Math.abs(f.prepaid) !== aTax + aVat) warnings.push(`prepaid ${f.prepaid} ≠ Σ advances ${aTax + aVat}`);
      if (aTax) lines.push(dr('customer_advances', aTax, party));
      if (aVat) lines.push(dr('vat_output', aVat, { vatCode: 'S', vatBase: -aTax }));
      lines.push(cr('ar', aTax + aVat, party));
    }
  }
  return { lines, warnings };
}

/** Customer receipt: the money lands in the method's account and the customer's balance drops. */
export function buildPaymentLines(p: { amount: Halalas; method: string; partyId: string | null; memo?: string | null }): Built {
  const amount = Math.abs(p.amount);
  if (!amount) return { lines: [], warnings: [] };
  return { lines: [dr(`method:${p.method}`, amount, { memo: p.memo ?? null }), cr('ar', amount, { partyId: p.partyId })], warnings: [] };
}

export interface VoucherFacts {
  /** payment (صرف) | receipt (قبض) */
  kind: 'payment' | 'receipt';
  amount: Halalas;
  method: string;
  partyId: string | null;
  /** the counter account chosen by finance ("الحساب المقابل") */
  accountId: string | null;
  projectId: string | null;
  costCenter: string | null;
  /** an HR bonus paid at once by voucher: the employee it belongs to */
  bonusEmployeeId?: string | null;
  purpose?: string | null;
}

/** سند قبض / سند صرف (spec §6.1): cash side by method, counter side by account → party → bonus → suspense. */
export function buildVoucherLines(v: VoucherFacts): Built {
  const amount = Math.abs(v.amount);
  if (!amount) return { lines: [], warnings: [] };
  const counter: Partial<PostLine> = { partyId: v.partyId, projectId: v.projectId, costCenter: v.costCenter, memo: v.purpose ?? null };
  let counterLine: PostLine;
  const side = v.kind === 'receipt' ? cr : dr;
  if (v.accountId) counterLine = { ...side('', amount, counter), key: undefined, accountId: v.accountId };
  else if (v.bonusEmployeeId) counterLine = side('bonuses', amount, { ...counter, employeeId: v.bonusEmployeeId });
  else if (v.partyId) counterLine = side(v.kind === 'receipt' ? 'ar' : 'ap', amount, counter);
  else counterLine = side('suspense', amount, counter);
  const cash = v.kind === 'receipt' ? dr : cr;
  return { lines: [cash(`method:${v.method}`, amount, { memo: v.purpose ?? null }), counterLine], warnings: [] };
}

// ─────────────────────────────── purchases, stock, import ───────────────────────────────

const sideSum = (lines: PostLine[], f: (l: PostLine) => number) => lines.reduce((s, l) => s + f(l), 0);

/** Merge lines that hit the same account/dimensions on the same side (keeps big entries readable). */
export function mergeLines(lines: PostLine[]): PostLine[] {
  const out = new Map<string, PostLine>();
  for (const l of lines) {
    const side = l.debit > 0 ? 'd' : 'c';
    const k = [side, l.key ?? '', l.accountId ?? '', l.partyId ?? '', l.projectId ?? '', l.employeeId ?? '', l.costCenter ?? '', l.vatCode ?? ''].join('|');
    const cur = out.get(k);
    if (cur) { cur.debit += l.debit; cur.credit += l.credit; if (l.vatBase != null) cur.vatBase = (cur.vatBase ?? 0) + l.vatBase; } else out.set(k, { ...l });
  }
  return [...out.values()].filter((l) => l.debit !== 0 || l.credit !== 0);
}

const varianceLine = (amount: Halalas): PostLine[] => (amount > 0 ? [dr('price_fx_variance', amount)] : amount < 0 ? [cr('price_fx_variance', -amount)] : []);

/**
 * Supplier bill against a purchase order (3-way match): the received-not-invoiced liability is
 * cleared at the receipt cost, the difference to what the supplier billed is a price/FX variance.
 * Amounts are SAR (bill currency × rate).
 */
export function buildPoBillLines(b: { supplierId: string; subtotalSar: Halalas; vatSar: Halalas; grniValue: Halalas }): Built {
  const lines: PostLine[] = [];
  if (b.grniValue) lines.push(dr('grni', b.grniValue));
  lines.push(...varianceLine(b.subtotalSar - b.grniValue));
  if (b.vatSar) lines.push(dr('vat_input', b.vatSar, { vatCode: 'S', vatBase: b.subtotalSar }));
  lines.push(cr('ap', b.subtotalSar + b.vatSar, { partyId: b.supplierId }));
  return { lines: mergeLines(lines), warnings: [] };
}

/**
 * Direct (local) supplier bill: goods received on the bill go to inventory at their stock-move cost,
 * everything else to purchase expenses — or to the project's work-in-progress when the project
 * policy is `wip` (decision D4). Rounding left over goes to the variance account.
 */
export function buildDirectBillLines(b: {
  supplierId: string; subtotalSar: Halalas; vatSar: Halalas; inventoryValue: Halalas; wip: boolean; projectId: string | null;
  expenses: { sar: Halalas; projectId?: string | null }[];
}): Built {
  const lines: PostLine[] = [];
  if (b.inventoryValue) lines.push(dr('inventory', b.inventoryValue, { projectId: b.projectId }));
  let exp = 0;
  for (const e of b.expenses) {
    if (!e.sar) continue;
    exp += e.sar;
    const pid = e.projectId ?? b.projectId;
    lines.push(b.wip && pid ? dr('wip', e.sar, { projectId: pid }) : dr('purchase_expenses', e.sar, { projectId: pid }));
  }
  lines.push(...varianceLine(b.subtotalSar - b.inventoryValue - exp));
  if (b.vatSar) lines.push(dr('vat_input', b.vatSar, { vatCode: 'S', vatBase: b.subtotalSar }));
  lines.push(cr('ap', b.subtotalSar + b.vatSar, { partyId: b.supplierId }));
  return { lines: mergeLines(lines), warnings: [] };
}

export function buildBillPaymentLines(p: { amountSar: Halalas; method: string; supplierId: string; memo?: string | null }): Built {
  const amount = Math.abs(p.amountSar);
  if (!amount) return { lines: [], warnings: [] };
  return { lines: [dr('ap', amount, { partyId: p.supplierId, memo: p.memo ?? null }), cr(`method:${p.method}`, amount)], warnings: [] };
}

export interface MoveFacts {
  /** receipt | opening | transfer | issue_project | consume_wo | return | adjust | count | rma_out | scrap */
  kind: string;
  refType: string | null;
  /** qty × unit cost, halalas */
  value: Halalas;
  hasFrom: boolean;
  hasTo: boolean;
  projectId: string | null;
  /** consume_wo: the work order's coverage — project | warranty | amc | chargeable */
  coverage?: string | null;
  /** wip | expense (decision D4) */
  wipPolicy: string;
}

/** The ledger effect of one stock move (spec §6.1 stock table). Transfers and bill-received goods post nothing here. */
export function buildStockMoveLines(m: MoveFacts): PostLine[] {
  const v = Math.abs(m.value);
  if (!v || (m.hasFrom && m.hasTo)) return [];
  const inflow = m.hasTo && !m.hasFrom;
  const toProject = (): PostLine => (m.wipPolicy === 'wip' && m.projectId ? { key: 'wip', projectId: m.projectId, debit: 0, credit: 0 } : { key: 'cogs', projectId: m.projectId, debit: 0, credit: 0 });
  const withAmount = (l: PostLine, debit: Halalas, credit: Halalas): PostLine => ({ ...l, debit, credit });
  switch (m.kind) {
    case 'receipt':
      if (m.refType === 'supplier_bill') return [];
      return m.refType === 'goods_receipt' ? [dr('inventory', v), cr('grni', v)] : [dr('inventory', v), cr('suspense', v)];
    case 'opening':
      return [dr('inventory', v), cr('opening_balance_equity', v)];
    case 'issue_project':
      return [withAmount(toProject(), v, 0), cr('inventory', v)];
    case 'consume_wo': {
      const target = m.coverage && m.coverage !== 'project' ? { key: 'cogs', projectId: m.projectId, debit: 0, credit: 0 } : toProject();
      return [withAmount(target, v, 0), cr('inventory', v)];
    }
    case 'return':
      return [dr('inventory', v), withAmount(m.coverage && m.coverage !== 'project' ? { key: 'cogs', projectId: m.projectId, debit: 0, credit: 0 } : toProject(), 0, v)];
    case 'count': case 'adjust': case 'rma_out': case 'scrap':
      return inflow ? [dr('inventory', v), cr('stock_adjustments', v)] : [dr('stock_adjustments', v), cr('inventory', v)];
    default:
      return inflow ? [dr('inventory', v), cr('suspense', v)] : [dr('suspense', v), cr('inventory', v)];
  }
}

/** Import VAT from the customs declaration: recoverable input VAT owed to customs / the broker. */
export function buildImportVatLines(p: { vatSar: Halalas; baseSar: Halalas; customsPartyId: string | null }): Built {
  if (!p.vatSar) return { lines: [], warnings: [] };
  return { lines: [dr('vat_input', p.vatSar, { vatCode: 'IM', vatBase: p.baseSar }), cr('customs_payable', p.vatSar, { partyId: p.customsPartyId })], warnings: [] };
}

/** Landed cost (duty + clearing charges): the part on stock still on hand is capitalised, the rest is cost of sales. */
export function buildLandedLines(p: { capitalised: Halalas; expensed: Halalas; customsPartyId: string | null }): Built {
  const lines: PostLine[] = [];
  if (p.capitalised) lines.push(dr('inventory', p.capitalised));
  if (p.expensed) lines.push(dr('cogs', p.expensed));
  const total = p.capitalised + p.expensed;
  if (total) lines.push(cr('customs_payable', total, { partyId: p.customsPartyId }));
  return { lines, warnings: [] };
}

// ─────────────────────────────── payroll & commissions ───────────────────────────────

export interface PayrollEmployeeFacts {
  employeeId: string;
  department: string | null;
  basic: Halalas; housing: Halalas; transport: Halalas; other: Halalas; bonuses: Halalas;
  unpaidLeave: Halalas; sickDeduction: Halalas; deductions: Halalas; gosi: Halalas; net: Halalas;
  /** the part of `deductions` per category (advance | penalty | other); missing = all "other" */
  deductionSplit?: { advance: Halalas; penalty: Halalas; other: Halalas };
  saudi: boolean;
}

/** GOSI contribution wage cap (basic + housing), SAR 45,000. */
export const GOSI_WAGE_CAP: Halalas = 4_500_000;

/** Employer's GOSI share, halalas (decision D7). */
export function employerGosi(basicPlusHousing: Halalas, saudi: boolean, saudiPct: number, otherPct: number): Halalas {
  const wage = Math.min(Math.max(basicPlusHousing, 0), GOSI_WAGE_CAP);
  return Math.round((wage * (saudi ? saudiPct : otherPct)) / 100);
}

/**
 * Payroll run approved: wages and allowances as expense by department, deductions that reduce the
 * wage expense, employee GOSI and the net payable per employee, plus the employer's GOSI share.
 * When a payslip's deductions were capped at gross the credits are scaled to fit and a warning is raised.
 */
export function buildPayrollLines(emps: PayrollEmployeeFacts[], o: { gosiSaudiPct: number; gosiOtherPct: number }): Built {
  const lines: PostLine[] = [];
  const warnings: string[] = [];
  for (const e of emps) {
    const cc = e.department;
    const gross = e.basic + e.housing + e.transport + e.other + e.bonuses;
    const expected = gross - e.net;
    let [unpaid, sick, ded, gosi] = [e.unpaidLeave, e.sickDeduction, e.deductions, e.gosi];
    let split = e.deductionSplit ?? { advance: 0, penalty: 0, other: e.deductions };
    if (unpaid + sick + ded + gosi !== expected) {
      [unpaid, sick, ded, gosi] = allocateProportional(Math.max(expected, 0), [unpaid, sick, ded, gosi]) as [number, number, number, number];
      warnings.push(`خصومات الموظف ${e.employeeId} أُعيد توزيعها لتطابق الصافي`);
    }
    if (split.advance + split.penalty + split.other !== ded) {
      const parts = allocateProportional(ded, [split.advance, split.penalty, split.other]);
      split = { advance: parts[0]!, penalty: parts[1]!, other: parts[2]! };
    }
    if (e.basic) lines.push(dr('salaries', e.basic, { costCenter: cc }));
    const allow = e.housing + e.transport + e.other;
    if (allow) lines.push(dr('allowances', allow, { costCenter: cc }));
    if (e.bonuses) lines.push(dr('bonuses', e.bonuses, { costCenter: cc }));
    if (unpaid + sick) lines.push(cr('salaries', unpaid + sick, { costCenter: cc }));
    if (gosi) lines.push(cr('gosi_payable', gosi));
    if (split.advance) lines.push(cr('employee_advances', split.advance, { employeeId: e.employeeId }));
    if (split.penalty + split.other) lines.push(cr('other_income', split.penalty + split.other, { costCenter: cc }));
    if (e.net) lines.push(cr('salaries_payable', e.net, { employeeId: e.employeeId, costCenter: cc }));
    const share = employerGosi(e.basic + e.housing, e.saudi, o.gosiSaudiPct, o.gosiOtherPct);
    if (share) { lines.push(dr('gosi_expense', share, { costCenter: cc })); lines.push(cr('gosi_payable', share)); }
  }
  const merged = mergeLines(lines);
  if (sideSum(merged, (l) => l.debit) !== sideSum(merged, (l) => l.credit)) warnings.push('قيد الرواتب غير متوازن');
  return { lines: merged, warnings };
}

/** Salaries paid out of the bank: settles each employee's payable. */
export function buildPayrollPaidLines(emps: { employeeId: string; net: Halalas }[], method = 'bank_transfer'): Built {
  const lines = emps.filter((e) => e.net).map((e) => dr('salaries_payable', e.net, { employeeId: e.employeeId }));
  const total = sideSum(lines, (l) => l.debit);
  if (!total) return { lines: [], warnings: [] };
  return { lines: [...lines, cr(`method:${method}`, total)], warnings: [] };
}

/** Commission accrual: the change in a rep's payable commission since it was last posted. */
export function buildCommissionDelta(p: { delta: Halalas; employeeId: string | null; memo?: string | null }): Built {
  if (!p.delta) return { lines: [], warnings: [] };
  const a = Math.abs(p.delta);
  const ex = { employeeId: p.employeeId, memo: p.memo ?? null };
  return { lines: p.delta > 0 ? [dr('commissions', a, ex), cr('commissions_payable', a, ex)] : [dr('commissions_payable', a, ex), cr('commissions', a, ex)], warnings: [] };
}
