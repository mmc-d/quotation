/**
 * Phase 7a/7c rules that live in MMC Core: IoT alarm handling (module 12 §2) and sales commissions /
 * technician incentives (module 09 §3.4). Payroll runs in Core (`payroll.ts`); the general ledger is in Core too (`ledger.ts`, `gl-posting.ts`) — an external HR/ERP system is optional.
 */
import { Decimal } from 'decimal.js';

// ───────────────────────────── IoT alarms ─────────────────────────────

export const ALARM_SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INDETERMINATE'] as const;
export type AlarmSeverity = (typeof ALARM_SEVERITIES)[number];

/** Ticket priority from a ThingsBoard alarm severity (IOT-03). Minor/warning only log, no ticket. */
export function alarmAction(severity: string): { createTicket: boolean; priority: 'urgent' | 'high' | 'normal' | null } {
  switch (severity.toUpperCase()) {
    case 'CRITICAL': return { createTicket: true, priority: 'urgent' };
    case 'MAJOR': return { createTicket: true, priority: 'high' };
    case 'MINOR': return { createTicket: false, priority: null };
    default: return { createTicket: false, priority: null };
  }
}

/** One active ticket per device + alarm type (IOT-04): the dedup key. */
export function alarmDedupKey(deviceId: string, alarmType: string): string {
  return `${deviceId.trim().toLowerCase()}|${alarmType.trim().toLowerCase()}`;
}

/** Repeats inside the window are merged into the open alarm instead of creating a new one. */
export const ALARM_DEDUP_WINDOW_MIN = 5;

// ───────────────────────────── commissions ─────────────────────────────

export type CommissionBasis = 'revenue' | 'margin';

export interface CommissionPlan {
  id: string;
  basis: CommissionBasis;
  /** percent of revenue (VAT excluded) or of gross margin */
  ratePercent: Decimal.Value;
  /** product categories the plan applies to; empty = all lines */
  categoryIds: string[];
}

export interface CommissionLine { amount: number; cost: number; categoryId: string | null }

/**
 * Commission EARNED on an invoice (HR-50/51/52): per line, the first plan matching the line's category
 * (or a catch-all plan) applies. Amounts in halalas, VAT excluded. Credit notes pass negative amounts
 * and so claw back (HR-53).
 */
export function commissionEarned(lines: CommissionLine[], plans: CommissionPlan[]): { planId: string; halalas: number }[] {
  const out = new Map<string, Decimal>();
  for (const l of lines) {
    const plan = plans.find((p) => p.categoryIds.length > 0 && l.categoryId && p.categoryIds.includes(l.categoryId)) ?? plans.find((p) => p.categoryIds.length === 0);
    if (!plan) continue;
    const base = plan.basis === 'margin' ? new Decimal(l.amount).minus(l.cost) : new Decimal(l.amount);
    // a negative margin earns nothing on a sale, but a credit note's negative amount still claws back
    const effective = plan.basis === 'margin' && l.amount > 0 && base.lt(0) ? new Decimal(0) : base;
    out.set(plan.id, (out.get(plan.id) ?? new Decimal(0)).plus(effective.times(plan.ratePercent).div(100)));
  }
  return [...out].map(([planId, v]) => ({ planId, halalas: v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber() }));
}

/**
 * PAYABLE share (pay-when-paid, HR-51): commission is released pro-rata to what the customer has paid
 * against the invoice total, never above the earned amount.
 */
export function commissionPayable(earnedHalalas: number, invoiceTotalHalalas: number, collectedHalalas: number): number {
  if (invoiceTotalHalalas <= 0 || earnedHalalas === 0) return earnedHalalas < 0 ? earnedHalalas : 0;
  const ratio = Decimal.min(1, Decimal.max(0, new Decimal(collectedHalalas).div(invoiceTotalHalalas)));
  return new Decimal(earnedHalalas).times(ratio).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
}

// ───────────── tiers / accelerators on quota attainment, splits (HR-53) ─────────────

export interface CommissionTier { fromPercent: number; multiplier: number }

/**
 * Quota attainment in percent (2 decimals) of a rep's monthly revenue (VAT excluded, credit notes
 * deducted) against the monthly quota. `null` when there is no quota (tiers then never apply).
 */
export function quotaAttainment(revenueHalalas: number, quotaHalalas: number): number | null {
  if (!(quotaHalalas > 0)) return null;
  return new Decimal(revenueHalalas).times(100).div(quotaHalalas).toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber();
}

/** Tiers ascending by threshold (input order is irrelevant). */
export function sortTiers(tiers: CommissionTier[]): CommissionTier[] {
  return [...tiers].sort((a, b) => a.fromPercent - b.fromPercent);
}

/** Multiplier of the highest tier whose `fromPercent` ≤ attainment; 1 when none applies (or no quota). */
export function tierMultiplier(attainmentPercent: number | null, tiers: CommissionTier[]): number {
  return tierStatus(attainmentPercent, tiers).multiplier;
}

/** Current tier, the next threshold to reach and the multiplier in force (rep dashboard). */
export function tierStatus(attainmentPercent: number | null, tiers: CommissionTier[]): { current: CommissionTier | null; next: CommissionTier | null; multiplier: number } {
  const sorted = sortTiers(tiers);
  if (attainmentPercent === null) return { current: null, next: sorted[0] ?? null, multiplier: 1 };
  let current: CommissionTier | null = null;
  for (const t of sorted) if (t.fromPercent <= attainmentPercent) current = t;
  const next = sorted.find((t) => t.fromPercent > attainmentPercent) ?? null;
  return { current, next, multiplier: current ? current.multiplier : 1 };
}

/** Apply an accelerator multiplier to an earned amount (halalas, half-up; sign kept for claw-backs). */
export function applyMultiplier(earnedHalalas: number, multiplier: number): number {
  if (multiplier === 1) return earnedHalalas;
  const v = new Decimal(Math.abs(earnedHalalas)).times(multiplier).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return earnedHalalas < 0 ? -v : v;
}

export interface SplitShare { userId: string; sharePercent: Decimal.Value }

/** Validation of a commission split: positive shares, one row per rep, summing to exactly 100. `null` = valid. */
export function splitSharesError(shares: SplitShare[]): string | null {
  if (!shares.length) return 'split has no reps';
  const seen = new Set<string>();
  let sum = new Decimal(0);
  for (const s of shares) {
    if (seen.has(s.userId)) return 'a rep appears twice in the split';
    seen.add(s.userId);
    let d: Decimal;
    try { d = new Decimal(s.sharePercent); } catch { return 'invalid share'; }
    if (!d.isFinite() || d.lte(0) || d.gt(100)) return 'each share must be between 0 and 100';
    sum = sum.plus(d);
  }
  return sum.eq(100) ? null : `shares must total 100 (got ${sum.toString()})`;
}

/**
 * Split an earned amount between reps exactly to the halala (largest remainder; ties go to the
 * earlier row). Negative amounts (claw-backs) split the same way as the matching positive amount.
 */
export function splitCommission(earnedHalalas: number, shares: SplitShare[]): { userId: string; halalas: number }[] {
  const err = splitSharesError(shares);
  if (err) throw new Error(err);
  const sign = earnedHalalas < 0 ? -1 : 1;
  const abs = Math.abs(earnedHalalas);
  const parts = shares.map((s, i) => {
    const exact = new Decimal(abs).times(s.sharePercent).div(100);
    const floor = exact.floor();
    return { i, userId: s.userId, halalas: floor.toNumber(), rem: exact.minus(floor) };
  });
  let left = abs - parts.reduce((s, p) => s + p.halalas, 0);
  for (const p of [...parts].sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i)) {
    if (left <= 0) break;
    p.halalas += 1; left -= 1;
  }
  return parts.map((p) => ({ userId: p.userId, halalas: p.halalas === 0 ? 0 : sign * p.halalas }));
}

export interface TechnicianIncentiveRules {
  /** per installed device on completed installation work orders */
  perDeviceHalalas: number;
  /** bonus when a corrective/warranty job is fixed on the first visit */
  firstTimeFixHalalas: number;
  /** deducted when the same asset needs another corrective visit within the window */
  callbackPenaltyHalalas: number;
  callbackWindowDays: number;
  /** bonus per job with a customer signature and CSAT ≥ 4 */
  happyCustomerHalalas: number;
}

export const DEFAULT_TECH_INCENTIVES: TechnicianIncentiveRules = {
  perDeviceHalalas: 1_000, firstTimeFixHalalas: 2_500, callbackPenaltyHalalas: 2_500, callbackWindowDays: 30, happyCustomerHalalas: 1_000,
};

/** Technician incentives for a period from work-order facts (HR-55). */
export function technicianIncentive(jobs: { type: string; devicesInstalled: number; firstTimeFix: boolean; callback: boolean; csat: number | null; signed: boolean }[], r: TechnicianIncentiveRules = DEFAULT_TECH_INCENTIVES) {
  let devices = 0; let ftf = 0; let callbacks = 0; let happy = 0;
  for (const j of jobs) {
    if (j.type === 'installation') devices += j.devicesInstalled;
    if ((j.type === 'corrective' || j.type === 'warranty') && j.firstTimeFix) ftf++;
    if (j.callback) callbacks++;
    if (j.signed && (j.csat ?? 0) >= 4) happy++;
  }
  const total = devices * r.perDeviceHalalas + ftf * r.firstTimeFixHalalas - callbacks * r.callbackPenaltyHalalas + happy * r.happyCustomerHalalas;
  return { devices, firstTimeFixes: ftf, callbacks, happyCustomers: happy, totalHalalas: Math.max(0, total) };
}

// ───────────────────────────── AI gateway ─────────────────────────────

/** Fields never sent to a model provider (PDPL minimisation, module 12 §3.1). */
const PII_PATTERNS: [RegExp, string][] = [
  [/(?:\+966|\b966|\b0)5\d{8}\b/g, '[phone]'],
  [/\b[12]\d{9}\b/g, '[national-id]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\bSA\d{22}\b/gi, '[iban]'],
];

/** Redact phone numbers, national/iqama IDs, e-mails and IBANs before text leaves Core. */
export function redactPii(text: string): string {
  return PII_PATTERNS.reduce((t, [re, label]) => t.replace(re, label), text);
}
