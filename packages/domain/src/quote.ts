import { allocateHalalas, dec, lineAmountHalalas, percentOf, toHalalas, type DecimalInput, type Halalas } from './money.js';

export const VAT_RATE = 15;
export const INS_CODE = 'INS';
export const INS_DESC = 'أعمال التركيب والبرمجة | Installation & Programming';

export interface QuoteLineInput {
  /** product code; 'INS' is the installation & programming line */
  code: string;
  description: string;
  /** catalog list price at the time it was added (snapshot); drives strike-through */
  listPrice: DecimalInput;
  /** price actually quoted (≤ list price shows the list price struck through; 0 = FREE) */
  unitPrice: DecimalInput;
  qty: DecimalInput;
  /** per-unit installation cost from the catalog (feeds the INS line) */
  installCost?: DecimalInput;
  /** per-unit purchase cost in SAR (internal: margin) */
  unitCost?: DecimalInput;
  isOptional?: boolean;
  /** INS line only: price set by the user instead of the auto sum */
  manualPrice?: boolean;
  sectionKey?: string | null;
}

export interface QuoteDiscount {
  type: 'percent' | 'amount';
  value: DecimalInput;
}

export interface QuoteCalcInput {
  lines: QuoteLineInput[];
  discount?: QuoteDiscount | null;
  /** company VAT registration (Settings → "not registered for VAT" mode) */
  vatRegistered: boolean;
  /** quote's own VAT switch; forced off when the company is not registered */
  vatOn?: boolean;
  vatRate?: number;
}

export interface QuoteLineResult {
  index: number;
  code: string;
  amount: Halalas;
  listAmount: Halalas;
  isFree: boolean;
  /** show list total struck through (quoted below list price) */
  struck: boolean;
  cost: Halalas;
  /** share of document discount (allocated by amount) */
  discount: Halalas;
  net: Halalas;
  vat: Halalas;
}

export interface QuoteTotals {
  subtotal: Halalas;
  discount: Halalas;
  taxable: Halalas;
  vat: Halalas;
  total: Halalas;
  vatApplied: boolean;
  vatRate: number;
  optionalTotal: Halalas;
  cost: Halalas;
  margin: Halalas;
  /** margin as % of taxable (net revenue), 2 dp; null when no revenue */
  marginPercent: number | null;
  /** effective document discount in % of subtotal, 2 dp */
  discountPercent: number;
  /** total at catalog list prices (counted lines) */
  listTotal: Halalas;
  /** everything given away vs list prices — header discount + below-list unit prices + FREE lines — in % of listTotal, 2 dp */
  discountFromListPercent: number;
  /** subtotal per section (lines without a section are under key ''), in first-appearance order; optional lines excluded */
  sections: { key: string; subtotal: Halalas; lines: number }[];
}

export interface QuoteCalcResult {
  lines: QuoteLineResult[];
  totals: QuoteTotals;
}

function sectionTotals(rows: { key: string; amount: Halalas }[]) {
  const out: { key: string; subtotal: Halalas; lines: number }[] = [];
  for (const r of rows) {
    const s = out.find((x) => x.key === r.key);
    if (s) { s.subtotal += r.amount; s.lines++; } else out.push({ key: r.key, subtotal: r.amount, lines: 1 });
  }
  return out;
}

/** The legacy rule: discount by amount is capped at the subtotal; by percent is subtotal×pct/100. */
export function discountHalalas(subtotal: Halalas, discount?: QuoteDiscount | null): Halalas {
  if (!discount) return 0;
  const v = dec(discount.value);
  if (v.lte(0)) return 0;
  const raw = discount.type === 'amount' ? toHalalas(v) : percentOf(subtotal, v);
  return Math.min(Math.max(0, raw), subtotal);
}

export function effectiveVat(input: Pick<QuoteCalcInput, 'vatRegistered' | 'vatOn'>): boolean {
  return input.vatRegistered && input.vatOn !== false;
}

/**
 * Totals of a quotation. Optional lines are shown but excluded from totals. The document discount
 * is spread over the lines (largest remainder) and VAT is taken on the discounted total, then
 * spread the same way — the ZATCA-exact method of the legacy invoice (computeInvoiceLines), so a
 * quote and the invoice made from it always agree to the halala.
 */
export function calculateQuote(input: QuoteCalcInput): QuoteCalcResult {
  const rate = input.vatRate ?? VAT_RATE;
  const vatApplied = effectiveVat(input);
  const base = input.lines.map((l, index) => {
    const amount = lineAmountHalalas(l.unitPrice, l.qty);
    const listAmount = lineAmountHalalas(l.listPrice, l.qty);
    const cost = lineAmountHalalas(l.unitCost ?? 0, l.qty);
    return { index, l, amount, listAmount, cost };
  });
  const counted = base.filter((b) => !b.l.isOptional && dec(b.l.qty).gt(0));
  const subtotal = counted.reduce((s, b) => s + b.amount, 0);
  const discount = discountHalalas(subtotal, input.discount);
  const lineDisc = allocateHalalas(discount, counted.map((b) => b.amount));
  const nets = counted.map((b, i) => b.amount - (lineDisc[i] as number));
  const taxable = subtotal - discount;
  const vat = vatApplied ? percentOf(taxable, rate) : 0;
  const lineVat = allocateHalalas(vat, nets);
  const byIndex = new Map<number, { discount: number; net: number; vat: number }>();
  counted.forEach((b, i) => byIndex.set(b.index, { discount: lineDisc[i] as number, net: nets[i] as number, vat: lineVat[i] as number }));
  const cost = counted.reduce((s, b) => s + b.cost, 0);
  const margin = taxable - cost;
  const lines: QuoteLineResult[] = base.map((b) => {
    const alloc = byIndex.get(b.index) ?? { discount: 0, net: b.amount, vat: 0 };
    return {
      index: b.index,
      code: b.l.code,
      amount: b.amount,
      listAmount: b.listAmount,
      isFree: b.amount === 0,
      struck: dec(b.l.listPrice).gt(0) && dec(b.l.unitPrice).lt(dec(b.l.listPrice)),
      cost: b.cost,
      ...alloc,
    };
  });
  const optionalTotal = base.filter((b) => b.l.isOptional).reduce((s, b) => s + b.amount, 0);
  // INS has no catalog list price of its own (its "list" is whatever was computed), so it is excluded.
  const listTotal = counted.reduce((s, b) => s + Math.max(b.listAmount, b.amount), 0);
  const listBase = counted.filter((b) => b.l.code !== INS_CODE).reduce((s, b) => s + Math.max(b.listAmount, b.amount), 0);
  const netNonIns = counted.reduce((s, b, i) => (b.l.code === INS_CODE ? s : s + (nets[i] as number)), 0);
  return {
    lines,
    totals: {
      subtotal,
      discount,
      taxable,
      vat,
      total: taxable + vat,
      vatApplied,
      vatRate: vatApplied ? rate : 0,
      optionalTotal,
      cost,
      margin,
      marginPercent: taxable > 0 ? Math.round((margin / taxable) * 10000) / 100 : null,
      discountPercent: subtotal > 0 ? Math.round((discount / subtotal) * 10000) / 100 : 0,
      listTotal,
      sections: sectionTotals(counted.map((b) => ({ key: b.l.sectionKey ?? '', amount: b.amount }))),
      discountFromListPercent: listBase > 0 ? Math.max(0, Math.round(((listBase - netNonIns) / listBase) * 10000) / 100) : 0,
    },
  };
}

/**
 * Keeps the auto-managed INS line in sync — port of the legacy syncInsRow():
 *  - INS price = Σ(installCost × qty) over the non-INS, non-optional lines,
 *  - always the last line; removed when the sum is 0 (unless the user priced it manually),
 *  - a manual price, edited description and qty survive re-syncs,
 *  - `insDeleted` (the user removed it on purpose) stops it from coming back.
 */
export function syncInstallationLine(lines: QuoteLineInput[], opts: { insDeleted?: boolean } = {}): QuoteLineInput[] {
  if (opts.insDeleted) return lines;
  const existing = lines.find((l) => l.code === INS_CODE);
  const rest = lines.filter((l) => l.code !== INS_CODE);
  const totalInstall = rest
    .filter((l) => !l.isOptional)
    .reduce((s, l) => s.plus(dec(l.installCost ?? 0).times(dec(l.qty))), dec(0))
    .toDecimalPlaces(4);
  const wasManual = !!existing?.manualPrice;
  if (totalInstall.gt(0) || wasManual) {
    const price = wasManual ? dec(existing!.unitPrice).toString() : totalInstall.toString();
    rest.push({
      code: INS_CODE,
      description: existing?.description || INS_DESC,
      listPrice: price,
      unitPrice: price,
      qty: existing?.qty ?? 1,
      installCost: 0,
      unitCost: existing?.unitCost ?? 0,
      manualPrice: wasManual,
      sectionKey: existing?.sectionKey ?? null,
    });
  }
  return rest;
}

export interface ApprovalPolicy {
  /** discounts above this % of subtotal need approval */
  maxDiscountPercent: number;
  /** margins below this % of net revenue need approval (only checked when costs are known) */
  minMarginPercent: number;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = { maxDiscountPercent: 10, minMarginPercent: 20 };

export function approvalReasons(totals: QuoteTotals, policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY, costsKnown = true): string[] {
  const reasons: string[] = [];
  const given = Math.max(totals.discountPercent, totals.discountFromListPercent);
  if (given > policy.maxDiscountPercent) reasons.push(totals.discountFromListPercent > totals.discountPercent ? `price below list ${totals.discountFromListPercent}% > ${policy.maxDiscountPercent}%` : `discount ${totals.discountPercent}% > ${policy.maxDiscountPercent}%`);
  if (costsKnown && totals.cost > 0 && totals.marginPercent !== null && totals.marginPercent < policy.minMarginPercent) {
    reasons.push(`margin ${totals.marginPercent}% < ${policy.minMarginPercent}%`);
  }
  return reasons;
}

/** Quote lifecycle (module 03). */
export type QuoteStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired' | 'lost' | 'superseded';

const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['pending_approval', 'approved', 'sent', 'lost'],
  pending_approval: ['approved', 'draft', 'rejected'],
  approved: ['sent', 'draft', 'accepted', 'lost'],
  sent: ['viewed', 'accepted', 'rejected', 'expired', 'lost', 'superseded'],
  viewed: ['accepted', 'rejected', 'expired', 'lost', 'superseded'],
  accepted: [],
  rejected: ['superseded'],
  expired: ['superseded', 'sent'],
  lost: [],
  superseded: [],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

/** Editable only before it has been sent/accepted; afterwards changes need a new revision. */
export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === 'draft' || status === 'pending_approval' || status === 'approved';
}
