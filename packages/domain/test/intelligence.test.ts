import { describe, expect, it } from 'vitest';
import {
  alarmAction, alarmDedupKey, applyMultiplier, commissionEarned, commissionPayable, quotaAttainment, redactPii, splitCommission, splitSharesError, technicianIncentive, tierMultiplier, tierStatus,
} from '../src/index.js';

describe('IoT alarms', () => {
  it('maps severity to ticket priority and dedups per device + type', () => {
    expect(alarmAction('CRITICAL')).toEqual({ createTicket: true, priority: 'urgent' });
    expect(alarmAction('major')).toEqual({ createTicket: true, priority: 'high' });
    expect(alarmAction('MINOR').createTicket).toBe(false);
    expect(alarmDedupKey(' SN-1 ', 'Offline')).toBe('sn-1|offline');
  });
});

describe('commissions', () => {
  const plans = [
    { id: 'locks', basis: 'margin' as const, ratePercent: 10, categoryIds: ['cat-locks'] },
    { id: 'all', basis: 'revenue' as const, ratePercent: 2, categoryIds: [] },
  ];
  it('earns per plan on revenue or margin; credit notes claw back', () => {
    const r = commissionEarned([
      { amount: 100_000, cost: 60_000, categoryId: 'cat-locks' }, // margin 40,000 × 10% = 4,000
      { amount: 50_000, cost: 0, categoryId: null },             // 50,000 × 2% = 1,000
      { amount: 20_000, cost: 30_000, categoryId: 'cat-locks' }, // negative margin → 0
    ], plans);
    expect(r).toEqual([{ planId: 'locks', halalas: 4_000 }, { planId: 'all', halalas: 1_000 }]);
    expect(commissionEarned([{ amount: -50_000, cost: 0, categoryId: null }], plans)).toEqual([{ planId: 'all', halalas: -1_000 }]);
  });
  it('pays when paid, pro-rata and capped', () => {
    expect(commissionPayable(5_000, 115_000, 57_500)).toBe(2_500);
    expect(commissionPayable(5_000, 115_000, 200_000)).toBe(5_000);
    expect(commissionPayable(5_000, 115_000, 0)).toBe(0);
    expect(commissionPayable(-1_000, 0, 0)).toBe(-1_000);
  });
  it('computes technician incentives', () => {
    const r = technicianIncentive([
      { type: 'installation', devicesInstalled: 6, firstTimeFix: false, callback: false, csat: 5, signed: true },
      { type: 'corrective', devicesInstalled: 0, firstTimeFix: true, callback: false, csat: 3, signed: true },
      { type: 'warranty', devicesInstalled: 0, firstTimeFix: false, callback: true, csat: null, signed: true },
    ]);
    expect(r).toEqual({ devices: 6, firstTimeFixes: 1, callbacks: 1, happyCustomers: 1, totalHalalas: 6 * 1_000 + 2_500 - 2_500 + 1_000 });
  });
});

describe('commission tiers and splits (HR-53)', () => {
  const tiers = [{ fromPercent: 120, multiplier: 1.5 }, { fromPercent: 100, multiplier: 1.2 }];
  it('computes quota attainment (null without a quota)', () => {
    expect(quotaAttainment(1_200_000, 1_000_000)).toBe(120);
    expect(quotaAttainment(333_333, 1_000_000)).toBe(33.33);
    expect(quotaAttainment(-5_000, 1_000_000)).toBe(-0.5);
    expect(quotaAttainment(1_000, 0)).toBeNull();
  });
  it('picks the highest tier reached; 1 below every tier or without a quota', () => {
    expect(tierMultiplier(99.99, tiers)).toBe(1);
    expect(tierMultiplier(100, tiers)).toBe(1.2);
    expect(tierMultiplier(119.99, tiers)).toBe(1.2);
    expect(tierMultiplier(120, tiers)).toBe(1.5);
    expect(tierMultiplier(400, tiers)).toBe(1.5);
    expect(tierMultiplier(null, tiers)).toBe(1);
    expect(tierMultiplier(150, [])).toBe(1);
    expect(tierStatus(110, tiers)).toEqual({ current: { fromPercent: 100, multiplier: 1.2 }, next: { fromPercent: 120, multiplier: 1.5 }, multiplier: 1.2 });
    expect(tierStatus(null, tiers).next).toEqual({ fromPercent: 100, multiplier: 1.2 });
  });
  it('applies the multiplier half-up, keeping the sign', () => {
    expect(applyMultiplier(1_001, 1.5)).toBe(1_502);
    expect(applyMultiplier(-1_001, 1.5)).toBe(-1_502);
    expect(applyMultiplier(777, 1)).toBe(777);
  });
  it('splits to the halala with the largest remainder and validates shares', () => {
    expect(splitCommission(1_001, [{ userId: 'a', sharePercent: 50 }, { userId: 'b', sharePercent: 50 }])).toEqual([{ userId: 'a', halalas: 501 }, { userId: 'b', halalas: 500 }]);
    expect(splitCommission(-1_001, [{ userId: 'a', sharePercent: 50 }, { userId: 'b', sharePercent: 50 }])).toEqual([{ userId: 'a', halalas: -501 }, { userId: 'b', halalas: -500 }]);
    const three = splitCommission(100, [{ userId: 'a', sharePercent: '33.3333' }, { userId: 'b', sharePercent: '33.3333' }, { userId: 'c', sharePercent: '33.3334' }]);
    expect(three.reduce((s, x) => s + x.halalas, 0)).toBe(100);
    expect(three.map((x) => x.halalas)).toEqual([33, 33, 34]);
    expect(splitCommission(1_000, [{ userId: 'a', sharePercent: '70' }, { userId: 'b', sharePercent: '30' }])).toEqual([{ userId: 'a', halalas: 700 }, { userId: 'b', halalas: 300 }]);
    expect(splitSharesError([{ userId: 'a', sharePercent: 60 }, { userId: 'b', sharePercent: 30 }])).toMatch(/total 100/);
    expect(splitSharesError([{ userId: 'a', sharePercent: 50 }, { userId: 'a', sharePercent: 50 }])).toMatch(/twice/);
    expect(splitSharesError([{ userId: 'a', sharePercent: 0 }, { userId: 'b', sharePercent: 100 }])).toMatch(/between/);
    expect(splitSharesError([])).toBeTruthy();
    expect(() => splitCommission(100, [{ userId: 'a', sharePercent: 90 }])).toThrow();
  });
});

describe('AI gateway', () => {
  it('redacts personal data before text leaves Core', () => {
    expect(redactPii('اتصل 0551234567 أو +966551234567، هوية 1012345678، a.b@x.sa، SA0380000000608010167519'))
      .toBe('اتصل [phone] أو [phone]، هوية [national-id]، [email]، [iban]');
  });
});
