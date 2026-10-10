import { describe, expect, it } from 'vitest';
import {
  accumulatedAt, agingFifo, buildCashFlow, buildClosingLines, buildEquityChanges, buildVatReturn, cashFlowClass, depreciationDue, depreciationFor, depreciationSchedule, disposalResult,
  eosbAward, eosbLiability, eosbProvision, resignationShare, reverseLines, serviceYears, vatPeriodOf, vatSettlementLines, vatThreshold, zakatSchedule, buildInvoiceLines,
} from '../src/index.js';

describe('VAT return', () => {
  it('nets credit notes and cleared advances into the boxes', () => {
    const r = buildVatReturn([
      { code: 'S', side: 'vat_output', base: 100_000, vat: 15_000 }, // 388
      { code: 'S', side: 'vat_output', base: -20_000, vat: -3_000 }, // 381
      { code: 'Z', side: 'sales', base: 50_000, vat: 0 },
      { code: 'X', side: 'sales', base: 10_000, vat: 0 },
      { code: 'E', side: 'sales', base: 5_000, vat: 0 },
      { code: 'S', side: 'vat_input', base: 40_000, vat: 6_000 },
      { code: 'IM', side: 'vat_input', base: 30_000, vat: 4_500 },
      { code: 'RC', side: 'vat_input', base: 10_000, vat: 1_500 },
      { code: 'RC', side: 'vat_output', base: 10_000, vat: 1_500 },
      { code: 'O', side: 'sales', base: 999, vat: 0 },
    ]);
    expect(r.box1).toEqual({ base: 80_000, vat: 12_000 });
    expect(r.box7).toEqual({ base: 145_000, vat: 12_000 });
    expect(r.box8.vat).toBe(6_000);
    expect(r.box9.base).toBe(30_000);
    expect(r.box10.vat).toBe(1_500);
    expect(r.box13.vat).toBe(12_000);
    expect(r.box14).toBe(13_500); // sales VAT + reverse-charge VAT
    expect(r.box15).toBe(12_000);
    expect(r.box16).toBe(1_500);
  });

  it('settlement entry balances both when payable and when reclaimable', () => {
    for (const [out, inp] of [[13_500, 12_000], [3_000, 8_000], [0, 5_000], [-1_000, 2_000]] as const) {
      const l = vatSettlementLines(out, inp);
      expect(l.reduce((s, x) => s + x.debit - x.credit, 0)).toBe(0);
    }
    expect(vatSettlementLines(1_500, 0)).toEqual([{ key: 'vat_output', debit: 1_500, credit: 0 }, { key: 'vat_settlement', debit: 0, credit: 1_500 }]);
  });

  it('threshold levels and return periods', () => {
    expect(vatThreshold(10_000_000).level).toBe('below');
    expect(vatThreshold(18_750_000).level).toBe('voluntary');
    expect(vatThreshold(37_500_000).level).toBe('voluntary');
    expect(vatThreshold(37_500_001).level).toBe('mandatory');
    expect(vatThreshold(20_000_000).pctOfMandatory).toBe(53.3);
    expect(vatPeriodOf('2026-05-17', 'quarterly')).toEqual({ from: '2026-04-01', to: '2026-06-30', label: '2026-Q2' });
    expect(vatPeriodOf('2026-02-10', 'monthly')).toEqual({ from: '2026-02-01', to: '2026-02-28', label: '2026-02' });
  });

  it('reversing lines negates the VAT base so the return nets to zero', () => {
    const rev = reverseLines([{ debit: 0, credit: 15_000, vatCode: 'S', vatBase: 100_000 }]);
    expect(rev[0]).toMatchObject({ debit: 15_000, credit: 0, vatBase: -100_000 });
  });

  it('a zero-rated invoice (registered, no VAT) tags revenue with code Z and the credit note negates it', () => {
    const f = { typeCode: '388', taxable: 100_000, vat: 0, partyId: 'p', projectId: null, lines: [{ net: 100_000, kind: 'devices' as const }], zeroRated: true };
    const inv = buildInvoiceLines(f).lines.find((l) => l.key === 'sales_devices')!;
    expect(inv).toMatchObject({ vatCode: 'Z', vatBase: 100_000 });
    const cn = buildInvoiceLines({ ...f, typeCode: '381' }).lines.find((l) => l.key === 'sales_devices')!;
    expect(cn).toMatchObject({ debit: 100_000, vatCode: 'Z', vatBase: -100_000 });
    expect(buildInvoiceLines({ ...f, zeroRated: false }).lines.find((l) => l.key === 'sales_devices')!.vatCode).toBeUndefined();
  });
});

describe('fixed assets', () => {
  const a = { cost: 1_000_000, salvage: 100_000, lifeMonths: 36, startMonth: '2026-03' };
  it('adds up to cost − salvage and never exceeds it', () => {
    const rows = depreciationSchedule(a);
    expect(rows).toHaveLength(36);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(900_000);
    expect(rows[35]!.netBook).toBe(100_000);
    expect(accumulatedAt(a, '2030-01')).toBe(900_000);
    expect(accumulatedAt(a, '2026-02')).toBe(0);
  });
  it('catches up missed months and is idempotent once booked', () => {
    expect(depreciationFor(a, '2026-03')).toBe(25_000);
    expect(depreciationDue(a, '2026-05', 25_000)).toBe(50_000); // two months due on top of March
    expect(depreciationDue(a, '2026-05', 75_000)).toBe(0);
  });
  it('odd amounts still sum exactly', () => {
    const b = { cost: 100_001, salvage: 0, lifeMonths: 7, startMonth: '2026-01' };
    expect(depreciationSchedule(b).reduce((s, r) => s + r.amount, 0)).toBe(100_001);
  });
  it('disposal gain and loss', () => {
    expect(disposalResult(1_000_000, 600_000, 500_000)).toBe(100_000);
    expect(disposalResult(1_000_000, 600_000, 300_000)).toBe(-100_000);
  });
});

describe('end of service', () => {
  it('Art. 84: half a month for five years, a month after', () => {
    expect(eosbAward(5, 1_000_000).amount).toBe(2_500_000);
    expect(eosbAward(8, 1_000_000).amount).toBe(2_500_000 + 3_000_000);
    expect(eosbAward(2.5, 1_000_000).amount).toBe(1_250_000);
    expect(eosbAward(0, 1_000_000).amount).toBe(0);
  });
  it('service years count both ends and freeze at termination', () => {
    expect(serviceYears('2025-01-01', '2025-12-31')).toBeCloseTo(1, 5);
    const e = { id: 'e', hireDate: '2020-01-01', terminationDate: '2023-12-31', wage: 1_000_000 };
    expect(eosbLiability(e, '2026-06-30').years).toBeCloseTo(4, 1);
    expect(eosbLiability({ ...e, hireDate: '2027-01-01', terminationDate: null }, '2026-06-30').amount).toBe(0);
  });
  it('Art. 85 resignation shares', () => {
    expect([1, 3, 7, 12].map(resignationShare)).toEqual([0, 1 / 3, 2 / 3, 1]);
  });
  it('provision delta is target − booked, with the brought-forward lump netted out', () => {
    const emps = [{ id: 'a', hireDate: '2020-01-01', wage: 1_000_000 }, { id: 'b', hireDate: '2024-01-01', wage: 600_000 }];
    const first = eosbProvision(emps, '2026-01-31', new Map(), 0);
    const total = first.target;
    expect(first.lines.reduce((s, l) => s + l.delta, 0)).toBe(total);
    expect(first.remainder).toBe(0);
    // an opening balance of 1,000.00 kept without an employee tag: the run books target − lump
    const lumped = eosbProvision(emps, '2026-01-31', new Map(), 100_000);
    expect(lumped.lines.reduce((s, l) => s + l.delta, 0) + lumped.remainder).toBe(total - 100_000);
    expect(lumped.remainder).toBe(-100_000);
    // steady state: nothing to do
    const again = eosbProvision(emps, '2026-01-31', new Map(first.lines.map((l) => [l.employeeId, l.target])), total);
    expect(again.lines).toEqual([]);
    expect(again.remainder).toBe(0);
  });
});

describe('closing', () => {
  it('zeroes income/expense into retained earnings, profit or loss', () => {
    const p = buildClosingLines([{ accountId: 'rev', net: -500_000 }, { accountId: 'cogs', net: 300_000 }, { accountId: 'rent', net: 50_000 }, { accountId: 'x', net: 0 }], 'ret');
    expect(p.profit).toBe(150_000);
    expect(p.lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
    expect(p.lines.find((l) => l.accountId === 'ret')).toMatchObject({ credit: 150_000, debit: 0 });
    const loss = buildClosingLines([{ accountId: 'rev', net: -100_000 }, { accountId: 'rent', net: 160_000 }], 'ret');
    expect(loss.profit).toBe(-60_000);
    expect(loss.lines.find((l) => l.accountId === 'ret')).toMatchObject({ debit: 60_000 });
  });
});

describe('cash flow', () => {
  const accounts = [
    { id: 'cash', code: '1101', nameAr: 'الصندوق', nameEn: null, type: 'asset' as const, isGroup: false },
    { id: 'bank', code: '1103', nameAr: 'البنك', nameEn: null, type: 'asset' as const, isGroup: false },
    { id: 'ar', code: '1110', nameAr: 'العملاء', nameEn: null, type: 'asset' as const, isGroup: false },
    { id: 'inv', code: '1130', nameAr: 'المخزون', nameEn: null, type: 'asset' as const, isGroup: false },
    { id: 'fa', code: '1201', nameAr: 'معدات', nameEn: null, type: 'asset' as const, isGroup: false },
    { id: 'acc', code: '1209', nameAr: 'مجمع', nameEn: null, type: 'asset' as const, isGroup: false },
    { id: 'ap', code: '2101', nameAr: 'الموردون', nameEn: null, type: 'liability' as const, isGroup: false },
    { id: 'eos', code: '2201', nameAr: 'نهاية الخدمة', nameEn: null, type: 'liability' as const, isGroup: false },
    { id: 'cap', code: '3101', nameAr: 'رأس المال', nameEn: null, type: 'equity' as const, isGroup: false },
    { id: 'rev', code: '4101', nameAr: 'مبيعات', nameEn: null, type: 'income' as const, isGroup: false },
    { id: 'exp', code: '6101', nameAr: 'رواتب', nameEn: null, type: 'expense' as const, isGroup: false },
  ];
  it('classifies accounts', () => {
    expect(accounts.map((a) => cashFlowClass(a))).toEqual(['cash', 'cash', 'working_capital', 'working_capital', 'investing', 'depreciation', 'working_capital', 'provision', 'financing', 'profit', 'profit']);
  });
  it('ties to the change in cash', () => {
    // capital 1,000 in; sale 600 on credit; buy equipment 200 cash; pay salary 100 + accrue EOS 20; depreciate 10; inventory 150 on credit
    const d = new Map<string, number>([
      ['cash', 0], ['bank', 100_000 - 20_000 - 10_000 + 0 - 0],
      ['ar', 60_000], ['inv', 15_000], ['fa', 20_000], ['acc', -1_000],
      ['ap', -15_000], ['eos', -2_000], ['cap', -100_000], ['rev', -60_000], ['exp', 10_000 + 2_000 + 1_000],
    ]);
    // balance check of the fabricated movements: debits − credits must be zero
    const net = [...d.values()].reduce((s, v) => s + v, 0);
    d.set('bank', (d.get('bank') ?? 0) - net);
    const profit = 60_000 - 13_000;
    const cf = buildCashFlow(accounts, d, profit, 0, d.get('bank')!);
    expect(cf.difference).toBe(0);
    expect(cf.operating.adjustments.map((r) => r.amount)).toEqual([1_000, 2_000]);
    expect(cf.investing.total).toBe(-20_000);
    expect(cf.financing.total).toBe(100_000);
  });
});

describe('equity changes', () => {
  it('opening + profit + movements = closing, retained earnings carries profit', () => {
    const accs = [{ id: 'cap', code: '3101', nameAr: 'رأس المال' }, { id: 'own', code: '3102', nameAr: 'جاري المالك' }, { id: 're', code: '3201', nameAr: 'الأرباح المبقاة' }];
    const r = buildEquityChanges(accs, new Map([['cap', -1_000_000], ['re', -200_000]]), new Map([['own', 50_000]]), 300_000, 40_000);
    const close = r.rows.find((x) => x.key === 'closing')!;
    expect(close.values.retained).toBe(200_000 + 40_000 + 300_000);
    expect(close.values['3102']).toBe(-50_000);
    expect(close.total).toBe(1_000_000 + 540_000 - 50_000);
  });
});

describe('aging', () => {
  it('applies settlements to the oldest charges first and keeps advances unapplied', () => {
    const r = agingFifo([
      { partyId: 'a', date: '2026-01-01', debit: 100_000, credit: 0 },
      { partyId: 'a', date: '2026-02-15', debit: 50_000, credit: 0 },
      { partyId: 'a', date: '2026-03-01', debit: 0, credit: 120_000 },
      { partyId: 'b', date: '2026-03-10', debit: 0, credit: 30_000 }, // advance
      { partyId: 'c', date: '2026-03-10', debit: 10_000, credit: 10_000 }, // settled
    ], '2026-04-01', 'ar');
    const a = r.find((x) => x.partyId === 'a')!;
    expect(a.total).toBe(30_000);
    expect(a.buckets[1]).toBe(30_000); // the Feb 15 invoice is 45 days old
    const b = r.find((x) => x.partyId === 'b')!;
    expect(b.total).toBe(-30_000);
    expect(b.unapplied).toBe(-30_000);
    expect(r.find((x) => x.partyId === 'c')).toBeUndefined();
  });
  it('payables flip the sides', () => {
    const r = agingFifo([{ partyId: 's', date: '2025-06-01', debit: 0, credit: 70_000 }], '2026-04-01', 'ap');
    expect(r[0]!.buckets[4]).toBe(70_000);
  });
});

describe('zakat', () => {
  it('base = equity + provisions + loans − net fixed assets; chargeable is the greater of base and profit', () => {
    const z = zakatSchedule({ capital: 1_000_000, retainedAndReserves: 200_000, ownerCurrent: 0, otherEquity: 0, netProfit: 150_000, eosProvision: 50_000, longTermLoans: 0, fixedAssetsCost: 300_000, accumulatedDepreciation: 100_000, rate: 0.025 });
    expect(z.base).toBe(1_000_000 + 200_000 + 150_000 + 50_000 - 200_000);
    expect(z.chargeable).toBe(z.base);
    expect(z.zakat).toBe(Math.round(1_200_000 * 0.025));
    const small = zakatSchedule({ capital: 0, retainedAndReserves: 0, ownerCurrent: 0, otherEquity: 0, netProfit: 500_000, eosProvision: 0, longTermLoans: 0, fixedAssetsCost: 900_000, accumulatedDepreciation: 0, rate: 0.025 });
    expect(small.base).toBe(-400_000);
    expect(small.chargeable).toBe(500_000);
  });
});
