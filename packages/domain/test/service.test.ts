import { describe, expect, it } from 'vitest';
import { addServiceHours, agreementStatusOn, billingSchedule, isCsatScore, renewalPrice, slaState, slaTargets, visitSchedule } from '../src/index.js';

const cal = { workingDays: [0, 1, 2, 3, 4], holidays: ['2026-10-11'] };
// Riyadh local time → Date
const at = (s: string) => new Date(`${s}:00+03:00`);
const iso = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');

describe('SLA clocks', () => {
  it('counts 24x7 hours on the wall clock', () => {
    expect(iso(addServiceHours(at('2026-10-08T16:00'), 4, '24x7', cal))).toBe('2026-10-08 20:00');
  });
  it('counts business hours 08–17 on working days only', () => {
    // Thu 16:00 + 4 business hours → 1 h Thu, Fri/Sat off, Sun 2026-10-11 is a holiday → Mon 08:00 + 3 h
    expect(iso(addServiceHours(at('2026-10-08T16:00'), 4, 'business', cal))).toBe('2026-10-12 11:00');
    // opened before opening time starts counting at 08:00
    expect(iso(addServiceHours(at('2026-10-12T06:30'), 2, 'business', cal))).toBe('2026-10-12 10:00');
    // opened on a weekend
    expect(iso(addServiceHours(at('2026-10-09T10:00'), 1, 'business', cal))).toBe('2026-10-12 09:00');
    // a full 9-hour day rolls to the next working day
    expect(iso(addServiceHours(at('2026-10-12T08:00'), 9, 'business', cal))).toBe('2026-10-12 17:00');
    expect(iso(addServiceHours(at('2026-10-12T08:00'), 10, 'business', cal))).toBe('2026-10-13 09:00');
  });
  it('gives targets and states', () => {
    const t = slaTargets(at('2026-10-12T09:00'), { responseHours: 4, resolutionHours: 24, coverage: 'business' }, cal);
    expect(iso(t.responseDue)).toBe('2026-10-12 13:00');
    expect(slaState(at('2026-10-12T09:00'), t.responseDue, null, at('2026-10-12T10:00'))).toBe('ok');
    expect(slaState(at('2026-10-12T09:00'), t.responseDue, null, at('2026-10-12T12:30'))).toBe('at_risk');
    expect(slaState(at('2026-10-12T09:00'), t.responseDue, null, at('2026-10-12T14:00'))).toBe('breached');
    expect(slaState(at('2026-10-12T09:00'), t.responseDue, at('2026-10-12T12:00'), at('2026-10-13T12:00'))).toBe('met');
  });
});

describe('agreements', () => {
  it('spreads preventive visits over the term on business days', () => {
    const v = visitSchedule('2026-01-01', '2026-12-31', 4, cal);
    expect(v).toHaveLength(4);
    expect(v.every((d) => d >= '2026-01-01' && d <= '2026-12-31')).toBe(true);
    for (const d of v) expect([5, 6]).not.toContain(new Date(`${d}T12:00:00Z`).getUTCDay());
    expect(visitSchedule('2026-01-01', '2026-06-30', 4, cal)).toHaveLength(2);
  });
  it('splits billing into exact periods', () => {
    const q = billingSchedule('2026-01-01', '2026-12-31', 1_000_001, 'quarterly');
    expect(q.map((p) => [p.from, p.to])).toEqual([['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30'], ['2026-07-01', '2026-09-30'], ['2026-10-01', '2026-12-31']]);
    expect(q.reduce((s, p) => s + p.amount, 0)).toBe(1_000_001);
    expect(billingSchedule('2026-01-15', '2027-01-14', 120_000, 'annual')).toEqual([{ from: '2026-01-15', to: '2027-01-14', amount: 120_000 }]);
  });
  it('prices renewals and tells the status', () => {
    expect(renewalPrice(1_000_000, 5)).toBe(1_050_000);
    expect(renewalPrice(333_333, 10)).toBe(366_700);
    expect(agreementStatusOn({ startDate: '2026-01-01', endDate: '2026-12-31' }, '2026-10-06')).toBe('active');
    expect(agreementStatusOn({ startDate: '2026-01-01', endDate: '2026-12-31' }, '2027-01-01')).toBe('expired');
    expect(agreementStatusOn({ startDate: '2026-11-01', endDate: '2027-10-31' }, '2026-10-06')).toBe('pending');
    expect(isCsatScore(5)).toBe(true);
    expect(isCsatScore(0)).toBe(false);
  });
});
