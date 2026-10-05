import { allocateHalalas, dec, percentOf, type DecimalInput, type Halalas } from './money.js';
import { VAT_RATE } from './quote.js';

/** Contract payment schedule — default 50 / 40 / 10 (legacy contract article 4). */
export type MilestoneTrigger = 'on_signing' | 'before_delivery' | 'after_programming' | 'on_handover' | 'on_date' | 'manual';

export interface MilestoneSpec {
  name_ar: string;
  name_en: string;
  percent: number;
  trigger: MilestoneTrigger;
}

export const DEFAULT_SCHEDULE: MilestoneSpec[] = [
  { name_ar: 'دفعة مقدمة عند توقيع العقد', name_en: 'Advance on signing', percent: 50, trigger: 'on_signing' },
  { name_ar: 'دفعة قبل توريد المواد', name_en: 'Before supply of materials', percent: 40, trigger: 'before_delivery' },
  { name_ar: 'دفعة بعد الانتهاء من البرمجة والتسليم', name_en: 'After programming and handover', percent: 10, trigger: 'after_programming' },
];

export interface ScheduledMilestone extends MilestoneSpec {
  order: number;
  amount: Halalas;
}

/**
 * Amounts per milestone. Percentages must add up to 100; the halala split uses largest remainder so
 * the parts add up exactly to the contract total (the legacy tool printed grand×0.5 etc. as floats,
 * which could disagree with the total by a halala).
 */
export function buildSchedule(total: Halalas, specs: MilestoneSpec[] = DEFAULT_SCHEDULE): ScheduledMilestone[] {
  const sum = specs.reduce((s, m) => s + m.percent, 0);
  if (Math.abs(sum - 100) > 1e-9) throw new Error(`payment schedule must total 100% (got ${sum}%)`);
  const amounts = allocateHalalas(total, specs.map((s) => Math.round(s.percent * 10000)));
  return specs.map((s, i) => ({ ...s, order: i + 1, amount: amounts[i] as Halalas }));
}

/** Contract lifecycle (module 04). */
export type ContractStatus = 'draft' | 'sent_for_signature' | 'signed' | 'active' | 'completed' | 'terminated' | 'cancelled';
const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['sent_for_signature', 'signed', 'cancelled'],
  sent_for_signature: ['signed', 'draft', 'cancelled'],
  signed: ['active', 'terminated'],
  active: ['completed', 'terminated'],
  completed: [],
  terminated: [],
  cancelled: [],
};
export function canTransitionContract(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

/** Milestone lifecycle (Phase 3). */
export type MilestoneStatus = 'pending' | 'requested' | 'invoiced' | 'partially_paid' | 'paid' | 'cancelled';

/** VAT contained in a VAT-inclusive amount: gross × rate / (100 + rate), half-up. */
export function vatOfGross(gross: Halalas, rate: number = VAT_RATE): Halalas {
  if (!rate) return 0;
  return dec(gross).times(rate).div(100 + rate).toDecimalPlaces(0).toNumber();
}

export interface InvoiceLine {
  code: string;
  name: string;
  qty: number;
  unitPrice: number;
  gross: Halalas;
  discount: Halalas;
  net: Halalas;
  vatRate: number;
  vat: Halalas;
  total: Halalas;
}

export interface InvoiceTotals {
  gross: Halalas;
  discount: Halalas;
  taxable: Halalas;
  vat: Halalas;
  total: Halalas;
  /** 388 final invoices: advances already invoiced on 386s (incl. VAT) */
  prepaid?: Halalas;
  prepaidVat?: Halalas;
  /** amount still payable on this invoice */
  payable?: Halalas;
}

/**
 * Invoice lines from priced lines and a document discount — the legacy computeInvoiceLines():
 * discount spread over lines, VAT on the discounted total spread the same way.
 */
export function computeInvoiceLines(
  src: { code: string; name: string; qty: DecimalInput; unitPrice: DecimalInput }[],
  discount: Halalas,
  rate: number = VAT_RATE,
): { lines: InvoiceLine[]; totals: InvoiceTotals } {
  const items = src.filter((it) => dec(it.qty).gt(0));
  const grossH = items.map((it) => dec(it.unitPrice).times(dec(it.qty)).times(100).toDecimalPlaces(0).toNumber());
  const subH = grossH.reduce((a, b) => a + b, 0);
  const discH = Math.min(subH, Math.max(0, discount));
  const lineDisc = allocateHalalas(discH, grossH);
  const netH = grossH.map((g, i) => g - (lineDisc[i] as number));
  const taxableH = subH - discH;
  const vatH = percentOf(taxableH, rate);
  const lineVat = allocateHalalas(vatH, netH);
  return {
    lines: items.map((it, i) => ({
      code: it.code,
      name: it.name,
      qty: dec(it.qty).toNumber(),
      unitPrice: dec(it.unitPrice).toDecimalPlaces(2).toNumber(),
      gross: grossH[i] as number,
      discount: lineDisc[i] as number,
      net: netH[i] as number,
      vatRate: rate,
      vat: lineVat[i] as number,
      total: (netH[i] as number) + (lineVat[i] as number),
    })),
    totals: { gross: subH, discount: discH, taxable: taxableH, vat: vatH, total: taxableH + vatH },
  };
}

/**
 * 386 prepayment invoice for an advance received (VAT is due when the advance is received). The
 * advance is VAT-inclusive (milestone amounts are shares of the contract total incl. VAT).
 */
export function prepaymentInvoice(advanceGross: Halalas, description: string, rate: number = VAT_RATE): { lines: InvoiceLine[]; totals: InvoiceTotals } {
  const vat = vatOfGross(advanceGross, rate);
  const net = advanceGross - vat;
  return {
    lines: [{ code: 'ADV', name: description, qty: 1, unitPrice: net / 100, gross: net, discount: 0, net, vatRate: rate, vat, total: advanceGross }],
    totals: { gross: net, discount: 0, taxable: net, vat, total: advanceGross },
  };
}

/**
 * 388 final tax invoice for the full contract with the advances (386s) deducted as PrepaidAmount.
 * The invoice still shows full lines and full VAT; `payable` = total − prepaid.
 */
export function finalInvoiceWithPrepayments(
  full: { lines: InvoiceLine[]; totals: InvoiceTotals },
  prepayments: { total: Halalas; vat: Halalas }[],
): { lines: InvoiceLine[]; totals: InvoiceTotals } {
  const prepaid = prepayments.reduce((s, p) => s + p.total, 0);
  const prepaidVat = prepayments.reduce((s, p) => s + p.vat, 0);
  if (prepaid > full.totals.total) throw new Error('advances exceed the invoice total — issue a credit note instead');
  return { lines: full.lines, totals: { ...full.totals, prepaid, prepaidVat, payable: full.totals.total - prepaid } };
}

/** Receivables aging buckets by days past due. */
export type AgingBucket = 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
export function agingBucket(dueDate: string, asOf: string): AgingBucket {
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000);
  if (days <= 0) return 'current';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return '90_plus';
}

/** Reminder cadence for unpaid payment requests: days relative to due date. */
export const REMINDER_OFFSETS = [-3, 0, 3, 7, 14, 30] as const;
export function remindersDue(dueDate: string, asOf: string, alreadySent: number[]): number[] {
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000);
  return REMINDER_OFFSETS.filter((o) => o <= days && !alreadySent.includes(o));
}
