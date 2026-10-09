import { describe, expect, it } from 'vitest';
import { accruedLeave, computePayslip, daysBetween, monthRange, overlapDays, sickDayBands } from '../src/index.js';

const pay = { basicSalary: '6000', housingAllowance: '1500', transportAllowance: '600', otherAllowances: [] };

describe('dates', () => {
  it('counts inclusive calendar days and month ranges', () => {
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-10-05', '2026-10-01')).toBe(0);
    expect(overlapDays('2026-09-28', '2026-10-03', '2026-10-01', '2026-10-31')).toBe(3);
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28', days: 28 });
  });
});

describe('annual leave accrual (Art. 109)', () => {
  it('accrues 21 days a year, 30 after five years', () => {
    expect(accruedLeave('2026-01-01', '2026-12-31', 21)).toBe(21);
    expect(accruedLeave('2020-01-01', '2026-01-01', 21)).toBe(Math.floor(((5 * 365 * 21) / 365 + ((daysBetween('2020-01-01', '2026-01-01') - 5 * 365) * 30) / 365) * 100) / 100);
  });
});

describe('sick leave bands (Art. 117)', () => {
  it('pays 30 days full, 60 at 75 %, then unpaid, within 12 months', () => {
    const history = [{ type: 'sick', startDate: '2026-01-01', endDate: '2026-03-31' }]; // 90 days
    expect(sickDayBands(history, '2026-01-01', '2026-03-31')).toEqual({ full: 30, threeQuarter: 60, unpaid: 0 });
    const more = [...history, { type: 'sick', startDate: '2026-04-01', endDate: '2026-04-10' }];
    expect(sickDayBands(more, '2026-04-01', '2026-04-30')).toEqual({ full: 0, threeQuarter: 0, unpaid: 10 });
    // a year later the counter has cleared
    expect(sickDayBands([...history, { type: 'sick', startDate: '2027-06-01', endDate: '2027-06-03' }], '2027-06-01', '2027-06-30').full).toBe(3);
  });
});

describe('payslip', () => {
  it('pays a full month with bonus, deduction and GOSI', () => {
    const p = computePayslip({ month: '2026-10', hireDate: '2025-01-01', pay, gosiEmployeePercent: '9.75', leaves: [],
      adjustments: [{ kind: 'bonus', amount: '500' }, { kind: 'deduction', amount: '200' }] });
    expect(p).toMatchObject({ workedDays: 30, gross: 860000, deductions: 20000, gosi: 73125, net: 860000 - 20000 - 73125, warnings: [] });
  });
  it('deducts unpaid days and sick days in the 75 % band at the daily wage', () => {
    const p = computePayslip({ month: '2026-10', hireDate: '2025-01-01', pay, leaves: [
      { type: 'unpaid', startDate: '2026-10-05', endDate: '2026-10-07' },
      { type: 'sick', startDate: '2026-09-01', endDate: '2026-10-04' }, // 30 in Sep, 4 in Oct → band 2
      { type: 'annual', startDate: '2026-10-20', endDate: '2026-10-22' },
    ], adjustments: [] });
    const daily = 810000 / 30;
    expect(p.unpaidLeave).toBe(Math.round(daily * 3));
    expect(p.sickDays).toEqual({ full: 0, threeQuarter: 4, unpaid: 0 });
    expect(p.sickDeduction).toBe(Math.round(daily * 4 * 0.25));
    expect(p.leaveDays).toEqual({ unpaid: 3, sick: 4, annual: 3 });
  });
  it('prorates a mid-month hire and flags heavy deductions', () => {
    const p = computePayslip({ month: '2026-10', hireDate: '2026-10-17', pay, leaves: [], adjustments: [{ kind: 'deduction', amount: '3000' }] });
    expect(p.workedDays).toBe(15);
    expect(p.basic).toBe(300000);
    expect(p.warnings).toEqual(['deductions_over_half', 'partial_month']);
  });
  it('stops at the last working day', () => {
    const p = computePayslip({ month: '2026-10', hireDate: '2024-01-01', terminationDate: '2026-10-09', pay, leaves: [], adjustments: [] });
    expect(p.workedDays).toBe(9);
  });
});
