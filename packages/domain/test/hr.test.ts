import { describe, expect, it } from 'vitest';
import { idNumberProblem, isValidSaudiId, offerErrors, offerIssues, offerPackage, offerStatusOn, type OfferTerms } from '../src/index.js';

const terms = (over: Partial<OfferTerms> = {}): OfferTerms => ({
  nationality: 'سعودي', contractType: 'unlimited', probationDays: 90, weeklyHours: 48, annualLeaveDays: 21, noticeDays: 60,
  offerDate: '2026-10-08', startDate: '2026-11-01', validUntil: '2026-10-15',
  basicSalary: '6000', housingAllowance: '1500', transportAllowance: '500', otherAllowances: [{ amount: '250.50' }], ...over,
});
const codes = (t: OfferTerms) => offerIssues(t).map((i) => `${i.level}:${i.code}`);

describe('job offer package', () => {
  it('adds the monthly components in halalas; GOSI wage is basic + housing', () => {
    expect(offerPackage(terms())).toMatchObject({ basic: 600000, housing: 150000, transport: 50000, other: 25050, monthly: 825050, annual: 9900600, gosiWage: 750000 });
  });
});

describe('Labor Law checks', () => {
  it('passes a standard full-time offer', () => {
    expect(offerIssues(terms())).toEqual([]);
  });
  it('blocks the hard limits', () => {
    expect(codes(terms({ probationDays: 181 }))).toContain('error:probation_max');
    expect(codes(terms({ weeklyHours: 50 }))).toContain('error:hours');
    expect(codes(terms({ annualLeaveDays: 14 }))).toContain('error:leave');
    expect(codes(terms({ basicSalary: '0' }))).toContain('error:basic_salary');
    expect(codes(terms({ startDate: '2026-10-01' }))).toContain('error:start_date');
    expect(codes(terms({ validUntil: '2026-10-01' }))).toContain('error:valid_until');
    expect(codes(terms({ contractType: 'fixed', durationMonths: null }))).toContain('error:duration');
    expect(codes(terms({ contractType: 'fixed', durationMonths: 2, probationDays: 90 }))).toContain('error:probation_term');
  });
  it('warns about extended probation, short notice and a non-Saudi open-ended contract', () => {
    expect(codes(terms({ probationDays: 120 }))).toEqual(['warning:probation_ext']);
    expect(codes(terms({ noticeDays: 30 }))).toEqual(['warning:notice']);
    expect(codes(terms({ nationality: 'Egyptian' }))).toEqual(['warning:non_saudi_term']);
    expect(codes(terms({ nationality: 'Egyptian', contractType: 'fixed', durationMonths: 24, noticeDays: null }))).toEqual([]);
    expect(offerErrors(terms({ probationDays: 120, noticeDays: 0 }))).toEqual([]);
  });
});

describe('Saudi ID / iqama', () => {
  it('validates the check digit and the leading digit', () => {
    expect(isValidSaudiId('1000000008')).toBe(true);
    expect(isValidSaudiId('1000000009')).toBe(false);
    expect(isValidSaudiId('2000000006')).toBe(true);
    expect(isValidSaudiId('3000000004')).toBe(false);
    expect(idNumberProblem('national_id', '2000000006')).toBe('not_national_id');
    expect(idNumberProblem('iqama', '1000000008')).toBe('not_iqama');
    expect(idNumberProblem('passport', 'A1234567')).toBeNull();
    expect(idNumberProblem('iqama', '2000000006')).toBeNull();
  });
});

describe('offer status', () => {
  it('reads an issued offer past its validity as expired', () => {
    expect(offerStatusOn('approved', '2026-10-07', '2026-10-08')).toBe('expired');
    expect(offerStatusOn('approved', '2026-10-08', '2026-10-08')).toBe('approved');
    expect(offerStatusOn('accepted', '2026-10-01', '2026-10-08')).toBe('accepted');
  });
});
