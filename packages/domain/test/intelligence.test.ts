import { describe, expect, it } from 'vitest';
import { alarmAction, alarmDedupKey, commissionEarned, commissionPayable, redactPii, technicianIncentive } from '../src/index.js';

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

describe('AI gateway', () => {
  it('redacts personal data before text leaves Core', () => {
    expect(redactPii('اتصل 0551234567 أو +966551234567، هوية 1012345678، a.b@x.sa، SA0380000000608010167519'))
      .toBe('اتصل [phone] أو [phone]، هوية [national-id]، [email]، [iban]');
  });
});
