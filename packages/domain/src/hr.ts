import { toHalalas, type DecimalInput, type Halalas } from './money.js';

/**
 * HR — employees and job offers (عرض وظيفي). The offer checks follow the Saudi Labor Law as
 * amended in 2021: probation up to 90 days, extendable in writing to 180 (Art. 53); at most 8 hours
 * a day / 48 a week (Art. 98); at least 21 days' annual leave, 30 after five years (Art. 109);
 * notice for an open-ended contract of at least 60 days when paid monthly (Art. 75); a non-Saudi's
 * contract is fixed-term (Art. 37). Hard limits block issuing an offer; the rest are warnings.
 */

export const CONTRACT_TYPES = ['unlimited', 'fixed'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'temporary'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const ID_TYPES = ['national_id', 'iqama', 'passport'] as const;
export type IdType = (typeof ID_TYPES)[number];

export const LABOR_LAW = {
  probationDays: 90,
  probationMaxDays: 180,
  weeklyHoursMax: 48,
  dailyHoursMax: 8,
  annualLeaveMin: 21,
  noticeDaysMonthlyPaid: 60,
} as const;

/** Defaults for a new offer — the common full-time package in KSA. */
export const OFFER_DEFAULTS = {
  contractType: 'unlimited' as ContractType,
  employmentType: 'full_time' as EmploymentType,
  probationDays: 90,
  weeklyHours: 48,
  workDays: 'الأحد – الخميس',
  annualLeaveDays: 21,
  noticeDays: 60,
  validityDays: 7,
};

export interface Allowance { label: string; amount: string }

export interface OfferPackageInput {
  basicSalary: DecimalInput;
  housingAllowance?: DecimalInput | null;
  transportAllowance?: DecimalInput | null;
  otherAllowances?: { amount: DecimalInput }[] | null;
}

/** Monthly and annual totals in halalas. The GOSI wage is basic + housing (cash). */
export function offerPackage(p: OfferPackageInput): { basic: Halalas; housing: Halalas; transport: Halalas; other: Halalas; monthly: Halalas; annual: Halalas; gosiWage: Halalas } {
  const basic = toHalalas(p.basicSalary);
  const housing = toHalalas(p.housingAllowance ?? 0);
  const transport = toHalalas(p.transportAllowance ?? 0);
  const other = (p.otherAllowances ?? []).reduce((s, a) => s + toHalalas(a.amount), 0);
  const monthly = basic + housing + transport + other;
  return { basic, housing, transport, other, monthly, annual: monthly * 12, gosiWage: basic + housing };
}

export interface OfferTerms extends OfferPackageInput {
  nationality?: string | null;
  contractType: ContractType;
  durationMonths?: number | null;
  probationDays: number;
  weeklyHours: number;
  annualLeaveDays: number;
  noticeDays?: number | null;
  offerDate: string;
  startDate: string;
  validUntil: string;
}

export interface OfferIssue { code: string; level: 'error' | 'warning'; ar: string; en: string }

/** Saudi nationality as entered on the form: the ISO code or the Arabic/English name. */
export function isSaudiNationality(n: string | null | undefined): boolean {
  const v = (n ?? '').trim().toLowerCase();
  return v === 'sa' || v === 'sau' || v === 'saudi' || v === 'saudi arabia' || v === 'سعودي' || v === 'سعودية' || v === 'السعودية';
}

export function offerIssues(t: OfferTerms): OfferIssue[] {
  const out: OfferIssue[] = [];
  const err = (code: string, ar: string, en: string) => out.push({ code, level: 'error', ar, en });
  const warn = (code: string, ar: string, en: string) => out.push({ code, level: 'warning', ar, en });
  const pkg = offerPackage(t);
  if (pkg.basic <= 0) err('basic_salary', 'الراتب الأساسي مطلوب', 'The basic salary is required');
  if (t.startDate < t.offerDate) err('start_date', 'تاريخ المباشرة قبل تاريخ العرض', 'The start date is before the offer date');
  if (t.validUntil < t.offerDate) err('valid_until', 'صلاحية العرض تنتهي قبل تاريخه', 'The offer expires before its date');
  if (t.contractType === 'fixed' && !(t.durationMonths && t.durationMonths > 0)) err('duration', 'حدد مدة العقد محدد المدة بالأشهر', 'Enter the fixed-term duration in months');
  if (t.probationDays < 0 || t.probationDays > LABOR_LAW.probationMaxDays) err('probation_max', 'فترة التجربة لا تتجاوز 180 يومًا (المادة 53)', 'Probation cannot exceed 180 days (Art. 53)');
  else if (t.probationDays > LABOR_LAW.probationDays) warn('probation_ext', 'تجربة أكثر من 90 يومًا تتطلب اتفاقًا مكتوبًا على التمديد (المادة 53)', 'Probation over 90 days needs a written extension agreement (Art. 53)');
  if (t.contractType === 'fixed' && t.durationMonths && t.probationDays > t.durationMonths * 30) err('probation_term', 'فترة التجربة أطول من مدة العقد', 'Probation is longer than the contract');
  if (t.weeklyHours <= 0 || t.weeklyHours > LABOR_LAW.weeklyHoursMax) err('hours', 'ساعات العمل لا تتجاوز 48 ساعة أسبوعيًا (المادة 98)', 'Working hours cannot exceed 48 a week (Art. 98)');
  if (t.annualLeaveDays < LABOR_LAW.annualLeaveMin) err('leave', 'الإجازة السنوية لا تقل عن 21 يومًا (المادة 109)', 'Annual leave must be at least 21 days (Art. 109)');
  if (t.contractType === 'unlimited' && (t.noticeDays ?? 0) < LABOR_LAW.noticeDaysMonthlyPaid) warn('notice', 'مدة الإشعار للعقد غير محدد المدة لا تقل عن 60 يومًا لمن يتقاضى أجرًا شهريًا (المادة 75)', 'Notice for an open-ended contract is at least 60 days for monthly-paid staff (Art. 75)');
  if (t.contractType === 'unlimited' && t.nationality && !isSaudiNationality(t.nationality)) warn('non_saudi_term', 'عقد غير السعودي يكون محدد المدة (المادة 37)', "A non-Saudi's contract is fixed-term (Art. 37)");
  return out;
}

export const offerErrors = (t: OfferTerms) => offerIssues(t).filter((i) => i.level === 'error');

/**
 * Saudi national ID (starts with 1) / iqama (starts with 2): 10 digits with the Luhn-style check
 * digit used by the NIC.
 */
export function isValidSaudiId(v: string | null | undefined): boolean {
  if (!v || !/^[12]\d{9}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = Number(v[i]);
    if (i % 2 === 0) { const x = d * 2; sum += x > 9 ? x - 9 : x; } else sum += d;
  }
  return sum % 10 === 0;
}

/** National ID / iqama must pass the check digit and match the type; passports are free text. */
export function idNumberProblem(type: IdType | null | undefined, num: string | null | undefined): string | null {
  if (!num || !type || type === 'passport') return null;
  if (!isValidSaudiId(num)) return 'invalid';
  if (type === 'national_id' && num[0] !== '1') return 'not_national_id';
  if (type === 'iqama' && num[0] !== '2') return 'not_iqama';
  return null;
}

/** Offer status on a given day: an issued offer past its validity date reads as expired. */
export function offerStatusOn(status: string, validUntil: string, day: string): string {
  return status === 'approved' && validUntil < day ? 'expired' : status;
}
