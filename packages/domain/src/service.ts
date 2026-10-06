/**
 * Service agreements (AMC), SLAs and customer satisfaction — module 06 §2.4–2.5, Phase 7b.
 * Pure rules: business-hour SLA clocks on the company calendar, preventive-visit and billing schedules.
 */
import { Decimal } from 'decimal.js';
import { isBusinessDay, nextBusinessDay, type CompanyCalendar } from './calendar.js';
import { addMonths } from './projects.js';

export const AGREEMENT_TIERS = ['basic', 'standard', 'premium'] as const;
export type AgreementTier = (typeof AGREEMENT_TIERS)[number];

/** Default SLA per tier (hours) and coverage window. Agreements may override. */
export const TIER_DEFAULTS: Record<AgreementTier, { responseHours: number; resolutionHours: number; coverage: 'business' | '24x7'; visitsPerYear: number; ar: string; en: string }> = {
  basic: { responseHours: 24, resolutionHours: 72, coverage: 'business', visitsPerYear: 2, ar: 'أساسي', en: 'Basic' },
  standard: { responseHours: 8, resolutionHours: 48, coverage: 'business', visitsPerYear: 4, ar: 'قياسي', en: 'Standard' },
  premium: { responseHours: 4, resolutionHours: 24, coverage: '24x7', visitsPerYear: 6, ar: 'مميز', en: 'Premium' },
};

/** Service desk hours on business days (Asia/Riyadh). */
export const BUSINESS_HOURS = { start: 8, end: 17 } as const;

const RIYADH_OFFSET_MIN = 180;
const toRiyadh = (d: Date) => new Date(d.getTime() + RIYADH_OFFSET_MIN * 60_000);
const fromRiyadh = (d: Date) => new Date(d.getTime() - RIYADH_OFFSET_MIN * 60_000);
const dayStr = (r: Date) => r.toISOString().slice(0, 10);

/**
 * Add `hours` of service time to `from`. 24x7 = wall-clock hours. Business = only 08:00–17:00 on
 * business days of the company calendar (weekends, holidays skipped) — FSM-83.
 */
export function addServiceHours(from: Date, hours: number, coverage: 'business' | '24x7', calendar: CompanyCalendar): Date {
  if (coverage === '24x7') return new Date(from.getTime() + hours * 3_600_000);
  let r = toRiyadh(from);
  let left = hours * 60;
  const startOfDay = (x: Date) => { const y = new Date(x); y.setUTCHours(BUSINESS_HOURS.start, 0, 0, 0); return y; };
  const endOfDay = (x: Date) => { const y = new Date(x); y.setUTCHours(BUSINESS_HOURS.end, 0, 0, 0); return y; };
  for (let guard = 0; guard < 2000 && left > 0; guard++) {
    const day = dayStr(r);
    if (!isBusinessDay(day, calendar) || r >= endOfDay(r)) {
      // a non-working day moves to the next working day; after closing time, to the next one after today
      const next = nextBusinessDay(isBusinessDay(day, calendar) ? shiftDay(day, 1) : day, calendar);
      r = startOfDay(new Date(`${next}T00:00:00Z`));
      continue;
    }
    if (r < startOfDay(r)) r = startOfDay(r);
    const avail = (endOfDay(r).getTime() - r.getTime()) / 60_000;
    const take = Math.min(avail, left);
    r = new Date(r.getTime() + take * 60_000);
    left -= take;
  }
  return fromRiyadh(r);
}

function shiftDay(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** SLA targets for a ticket opened at `openedAt` (FSM-64/83). */
export function slaTargets(openedAt: Date, sla: { responseHours: number; resolutionHours: number; coverage: 'business' | '24x7' }, calendar: CompanyCalendar) {
  return {
    responseDue: addServiceHours(openedAt, sla.responseHours, sla.coverage, calendar),
    resolutionDue: addServiceHours(openedAt, sla.resolutionHours, sla.coverage, calendar),
  };
}

/** SLA state now: ok / at_risk (≥ 75% of the window used) / breached. */
export function slaState(openedAt: Date, due: Date, doneAt: Date | null, now: Date): 'ok' | 'at_risk' | 'breached' | 'met' {
  if (doneAt) return doneAt <= due ? 'met' : 'breached';
  if (now > due) return 'breached';
  const total = due.getTime() - openedAt.getTime();
  return total > 0 && (now.getTime() - openedAt.getTime()) / total >= 0.75 ? 'at_risk' : 'ok';
}

/**
 * Preventive visit due dates spread evenly over the agreement term (FSM-62), each moved to the next
 * business day. visitsPerYear is pro-rated for terms shorter or longer than a year.
 */
export function visitSchedule(start: string, end: string, visitsPerYear: number, calendar: CompanyCalendar): string[] {
  if (visitsPerYear <= 0 || end < start) return [];
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
  const n = Math.max(1, Math.round((visitsPerYear * days) / 365));
  const step = days / n;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(nextBusinessDay(shiftDay(start, Math.floor(step * i + step / 2)), calendar));
  return out;
}

export const BILLING_FREQUENCIES = { annual: 12, semiannual: 6, quarterly: 3, monthly: 1 } as const;
export type BillingFrequency = keyof typeof BILLING_FREQUENCIES;

/**
 * Billing periods for an agreement price (halalas, VAT excluded) — FSM-63. Amounts split exactly
 * (remainder on the first period); the last period ends on the agreement end date.
 */
export function billingSchedule(start: string, end: string, priceHalalas: number, frequency: BillingFrequency) {
  const months = BILLING_FREQUENCIES[frequency];
  const periods: { from: string; to: string }[] = [];
  let from = start;
  for (let guard = 0; guard < 240 && from <= end; guard++) {
    const nextFrom = addMonths(from, months);
    const to = shiftDay(nextFrom, -1) < end ? shiftDay(nextFrom, -1) : end;
    periods.push({ from, to });
    from = nextFrom;
  }
  const n = periods.length || 1;
  const base = Math.floor(priceHalalas / n);
  const rest = priceHalalas - base * n;
  return periods.map((p, i) => ({ ...p, amount: base + (i === 0 ? rest : 0) }));
}

/** Renewal price with an uplift percent (FSM-65), rounded to whole riyals. */
export function renewalPrice(priceHalalas: number, upliftPercent: number): number {
  return new Decimal(priceHalalas).times(new Decimal(100).plus(upliftPercent)).div(100).div(100).toDecimalPlaces(0).times(100).toNumber();
}

/** Agreement status on a date. */
export function agreementStatusOn(a: { startDate: string; endDate: string; cancelledAt?: string | null }, today: string): 'pending' | 'active' | 'expired' | 'cancelled' {
  if (a.cancelledAt) return 'cancelled';
  if (today < a.startDate) return 'pending';
  if (today > a.endDate) return 'expired';
  return 'active';
}

/** CSAT one-tap scores (1–5) — FSM-87. */
export function isCsatScore(v: unknown): v is 1 | 2 | 3 | 4 | 5 {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
}
