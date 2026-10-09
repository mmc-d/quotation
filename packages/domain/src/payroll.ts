import { offerPackage, type OfferPackageInput } from './hr.js';
import { percentOf, toHalalas, type Halalas } from './money.js';

/**
 * Leave and payroll rules (Saudi Labor Law). Days are calendar days, inclusive. A month's daily
 * wage is the full monthly package ÷ 30, the usual Saudi practice.
 *  - Annual leave (Art. 109): the employee's yearly days, at least 30 a year after five years of
 *    service; it accrues day by day. Emergency leave is paid and taken from the same balance.
 *  - Sick leave (Art. 117): within any 12 months, the first 30 days at full pay, the next 60 at
 *    three-quarters, the next 30 unpaid (later days are unpaid too).
 *  - Unpaid leave is deducted at the daily wage.
 *  - Deductions for loans, fines and damage may not exceed half the wage (Art. 92/93) — flagged.
 */

export const LEAVE_TYPES = ['annual', 'emergency', 'sick', 'unpaid'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
/** Leave types taken from the annual balance. */
export const BALANCE_LEAVE: readonly LeaveType[] = ['annual', 'emergency'];

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDaysIso = (d: string, n: number) => iso(ms(d) + n * DAY);

/** Calendar days from → to inclusive (0 when to < from). */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((ms(to) - ms(from)) / DAY) + 1);
}

/** Overlap of [from,to] with [a,b], in days. */
export function overlapDays(from: string, to: string, a: string, b: string): number {
  const s = from > a ? from : a;
  const e = to < b ? to : b;
  return daysBetween(s, e);
}

/** First and last day of a YYYY-MM month. */
export function monthRange(month: string): { start: string; end: string; days: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const start = `${month}-01`;
  const end = iso(Date.UTC(y, m, 0));
  return { start, end, days: daysBetween(start, end) };
}

/**
 * Annual leave accrued from the hire date up to `asOf` (inclusive), in days with two decimals.
 * The first five years accrue at `yearlyDays`, later years at max(yearlyDays, 30).
 */
export function accruedLeave(hireDate: string, asOf: string, yearlyDays: number): number {
  const served = daysBetween(hireDate, asOf);
  const first = Math.min(served, 5 * 365);
  const later = served - first;
  const v = (first * yearlyDays) / 365 + (later * Math.max(yearlyDays, 30)) / 365;
  return Math.floor(v * 100) / 100;
}

export interface LeaveSpan { type: string; startDate: string; endDate: string }

/** Pay band for each sick day of [from,to], given all of the employee's approved sick leave. */
export function sickDayBands(allSick: LeaveSpan[], from: string, to: string): { full: number; threeQuarter: number; unpaid: number } {
  const days = new Set<string>();
  for (const l of allSick) for (let t = ms(l.startDate); t <= ms(l.endDate); t += DAY) days.add(iso(t));
  const sorted = [...days].sort();
  const out = { full: 0, threeQuarter: 0, unpaid: 0 };
  for (const d of sorted) {
    if (d < from || d > to) continue;
    const yearAgo = addDaysIso(d, -364);
    const before = sorted.filter((x) => x >= yearAgo && x < d).length;
    if (before < 30) out.full++;
    else if (before < 90) out.threeQuarter++;
    else out.unpaid++;
  }
  return out;
}

export interface PayslipInput {
  month: string;
  hireDate: string;
  terminationDate?: string | null;
  pay: OfferPackageInput;
  /** employee GOSI share, percent of basic + housing (0 when not registered / non-Saudi) */
  gosiEmployeePercent?: string | number | null;
  adjustments: { kind: 'bonus' | 'deduction'; amount: string }[];
  /** every approved leave of the employee (sick history matters across months) */
  leaves: LeaveSpan[];
}

export interface Payslip {
  workedDays: number;
  basic: Halalas; housing: Halalas; transport: Halalas; other: Halalas; bonuses: Halalas;
  gross: Halalas;
  unpaidLeaveDays: number; unpaidLeave: Halalas;
  sickDays: { full: number; threeQuarter: number; unpaid: number }; sickDeduction: Halalas;
  deductions: Halalas; gosi: Halalas;
  totalDeductions: Halalas; net: Halalas;
  leaveDays: Record<string, number>;
  warnings: string[];
}

const GOSI_WAGE_CAP: Halalas = 4_500_000; // 45,000 SAR

/** One employee's pay for one month. Partial months (hire / last day) are prorated on a 30-day month. */
export function computePayslip(i: PayslipInput): Payslip {
  const { start, end, days: monthDays } = monthRange(i.month);
  const from = i.hireDate > start ? i.hireDate : start;
  const to = i.terminationDate && i.terminationDate < end ? i.terminationDate : end;
  const employed = daysBetween(from, to);
  const workedDays = employed >= monthDays ? 30 : Math.min(30, employed);
  const pkg = offerPackage(i.pay);
  const pro = (h: Halalas) => Math.round((h * workedDays) / 30);
  const basic = pro(pkg.basic), housing = pro(pkg.housing), transport = pro(pkg.transport), other = pro(pkg.other);
  const bonuses = i.adjustments.filter((a) => a.kind === 'bonus').reduce((s, a) => s + toHalalas(a.amount), 0);
  const gross = basic + housing + transport + other + bonuses;
  const daily = pkg.monthly / 30;

  const leaveDays: Record<string, number> = {};
  for (const l of i.leaves) {
    const d = overlapDays(l.startDate, l.endDate, from, to);
    if (d > 0) leaveDays[l.type] = (leaveDays[l.type] ?? 0) + d;
  }
  const unpaidLeaveDays = Math.min(leaveDays.unpaid ?? 0, workedDays);
  const unpaidLeave = Math.round(daily * unpaidLeaveDays);
  const sickDays = employed > 0 ? sickDayBands(i.leaves.filter((l) => l.type === 'sick'), from, to) : { full: 0, threeQuarter: 0, unpaid: 0 };
  const sickDeduction = Math.round(daily * (sickDays.threeQuarter * 0.25 + sickDays.unpaid));
  const deductions = i.adjustments.filter((a) => a.kind === 'deduction').reduce((s, a) => s + toHalalas(a.amount), 0);
  const gosiWage = Math.min(pro(pkg.gosiWage), GOSI_WAGE_CAP);
  const gosi = Number(i.gosiEmployeePercent ?? 0) > 0 ? percentOf(gosiWage, String(i.gosiEmployeePercent)) : 0;
  const totalDeductions = Math.min(gross, unpaidLeave + sickDeduction + deductions + gosi);
  const warnings: string[] = [];
  const wage = gross - bonuses;
  if (deductions > wage / 2) warnings.push('deductions_over_half');
  if (unpaidLeave + sickDeduction + deductions + gosi > gross) warnings.push('deductions_exceed_pay');
  if (employed > 0 && employed < monthDays) warnings.push('partial_month');
  return {
    workedDays, basic, housing, transport, other, bonuses, gross, unpaidLeaveDays, unpaidLeave, sickDays, sickDeduction,
    deductions, gosi, totalDeductions, net: gross - totalDeductions, leaveDays, warnings,
  };
}

/** Default GOSI employee share: Saudis 9.75 % (annuities 9 % + SANED 0.75 %), others 0. Check the rate for staff registered after July 2024. */
export function defaultGosiPercent(saudi: boolean): string {
  return saudi ? '9.75' : '0';
}
