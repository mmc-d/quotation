import { describe, expect, it } from 'vitest';
import {
  buildBalanceSheet, buildIncomeStatement, buildTrialBalance, CHART_OF_ACCOUNTS, depthMap, fiscalYearOf, journalProblems, parentCode, POSTING_KEYS,
  reverseLines, withRunningBalance, type AccountInfo, type AccountRef, type AccountType,
} from '../src/index.js';

/** Chart rows as DB-shaped accounts (id = code) with parents derived from the prefix. */
const groups = CHART_OF_ACCOUNTS.filter((c) => c.isGroup).map((c) => c.code);
const refs: AccountRef[] = CHART_OF_ACCOUNTS.map((c) => ({ id: c.code, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, type: c.type, isGroup: !!c.isGroup, parentId: parentCode(c.code, groups) }));
const info = new Map<string, AccountInfo>(CHART_OF_ACCOUNTS.map((c) => [c.code, { id: c.code, code: c.code, isGroup: !!c.isGroup, isActive: true, requiresParty: !!c.requiresParty }]));

describe('chart of accounts', () => {
  it('has unique codes and posting keys, and every account hangs under a group of its own type', () => {
    expect(new Set(CHART_OF_ACCOUNTS.map((c) => c.code)).size).toBe(CHART_OF_ACCOUNTS.length);
    expect(new Set(POSTING_KEYS).size).toBe(POSTING_KEYS.length);
    const type = new Map(CHART_OF_ACCOUNTS.map((c) => [c.code, c.type] as const));
    for (const r of refs.filter((x) => x.code.length > 1)) {
      expect(r.parentId, r.code).not.toBeNull();
      expect(type.get(r.parentId!), r.code).toBe(r.type);
    }
  });
  it('contains every posting key auto-posting will need', () => {
    for (const k of ['ar', 'ap', 'cash', 'bank', 'inventory', 'grni', 'wip', 'cogs', 'vat_input', 'vat_output', 'customer_advances', 'sales_devices', 'sales_installation', 'sales_service', 'salaries_payable', 'gosi_payable', 'suspense', 'opening_balance_equity', 'retained_earnings']) expect(POSTING_KEYS).toContain(k);
  });
  it('nests by code prefix', () => {
    expect(parentCode('1101', groups)).toBe('11');
    expect(parentCode('11', groups)).toBe('1');
    expect(parentCode('9101', groups)).toBe('9');
    expect(depthMap(refs).get('1101')).toBe(3);
  });
});

describe('fiscal years', () => {
  it('uses the calendar year for a January start', () => {
    expect(fiscalYearOf('2026-10-10')).toEqual({ label: '2026', start: '2026-01-01', end: '2026-12-31' });
  });
  it('spans two calendar years for other start months', () => {
    expect(fiscalYearOf('2026-02-10', 7)).toEqual({ label: '2025/2026', start: '2025-07-01', end: '2026-06-30' });
    expect(fiscalYearOf('2026-07-01', 7)).toEqual({ label: '2026/2027', start: '2026-07-01', end: '2027-06-30' });
  });
});

describe('journalProblems', () => {
  const ok = [{ accountId: '1101', debit: 11500, credit: 0 }, { accountId: '4101', debit: 0, credit: 11500 }];
  const check = (lines: Parameters<typeof journalProblems>[0]['lines'], extra: Partial<Parameters<typeof journalProblems>[0]> = {}) => journalProblems({ entryDate: '2026-10-10', lines, accounts: info, ...extra }).map((p) => p.code);
  it('accepts a balanced entry', () => expect(check(ok)).toEqual([]));
  it('rejects an unbalanced entry', () => expect(check([ok[0]!, { accountId: '4101', debit: 0, credit: 11000 }])).toEqual(['unbalanced']));
  it('needs two lines, one side per line, an amount', () => {
    expect(check([ok[0]!])).toContain('too_few_lines');
    expect(check([{ accountId: '1101', debit: 5, credit: 5 }, { accountId: '4101', debit: 0, credit: 0 }])).toEqual(expect.arrayContaining(['both_sides', 'no_amount']));
    expect(check([{ accountId: '1101', debit: -5, credit: 0 }, { accountId: '4101', debit: 0, credit: -5 }])).toContain('bad_amount');
    expect(check([{ accountId: '1101', debit: 1.5, credit: 0 }, { accountId: '4101', debit: 0, credit: 1.5 }])).toContain('bad_amount');
  });
  it('refuses group, inactive, unknown accounts and a missing party', () => {
    expect(check([{ accountId: '11', debit: 5, credit: 0 }, { accountId: '4101', debit: 0, credit: 5 }])).toContain('group_account');
    expect(check([{ accountId: 'nope', debit: 5, credit: 0 }, { accountId: '4101', debit: 0, credit: 5 }])).toContain('unknown_account');
    const inactive = new Map(info).set('1101', { ...info.get('1101')!, isActive: false });
    expect(journalProblems({ entryDate: '2026-10-10', lines: ok, accounts: inactive }).map((p) => p.code)).toContain('inactive_account');
    expect(check([{ accountId: '1110', debit: 5, credit: 0 }, { accountId: '4101', debit: 0, credit: 5 }])).toContain('party_required');
    expect(check([{ accountId: '1110', debit: 5, credit: 0, partyId: 'p1' }, { accountId: '4101', debit: 0, credit: 5 }])).toEqual([]);
  });
  it('refuses a locked period and, unless allowed, a date before go-live', () => {
    expect(check(ok, { lockedThrough: '2026-10-10' })).toContain('period_locked');
    expect(check(ok, { lockedThrough: '2026-09-30' })).toEqual([]);
    expect(check(ok, { goLiveDate: '2026-11-01' })).toContain('before_go_live');
    expect(check(ok, { goLiveDate: '2026-11-01', allowBeforeGoLive: true })).toEqual([]);
    expect(journalProblems({ entryDate: '2026-13-45', lines: ok, accounts: info }).map((p) => p.code)).toContain('bad_date');
  });
  it('reverses by swapping sides', () => {
    expect(reverseLines(ok)).toEqual([{ accountId: '1101', debit: 0, credit: 11500 }, { accountId: '4101', debit: 11500, credit: 0 }]);
  });
});

/** A small set of books: capital 100,000 → cash; sale 11,500 (10,000 + VAT) on credit; salary 3,000 paid; ink 200 bought on credit. */
const ledger = [
  { accountId: '1103', debit: 10000000, credit: 0 }, { accountId: '3101', debit: 0, credit: 10000000 },
  { accountId: '1110', debit: 1150000, credit: 0 }, { accountId: '4101', debit: 0, credit: 1000000 }, { accountId: '2110', debit: 0, credit: 150000 },
  { accountId: '6101', debit: 300000, credit: 0 }, { accountId: '1103', debit: 0, credit: 300000 },
  { accountId: '6207', debit: 20000, credit: 0 }, { accountId: '2101', debit: 0, credit: 20000 },
];
const sumsOf = (lines: typeof ledger) => {
  const m = new Map<string, { openDebit: number; openCredit: number; debit: number; credit: number }>();
  for (const l of lines) {
    const s = m.get(l.accountId) ?? { openDebit: 0, openCredit: 0, debit: 0, credit: 0 };
    s.debit += l.debit; s.credit += l.credit;
    m.set(l.accountId, s);
  }
  return [...m].map(([accountId, s]) => ({ accountId, ...s }));
};

describe('trial balance', () => {
  it('balances and rolls group accounts up', () => {
    const tb = buildTrialBalance(refs, sumsOf(ledger));
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    const row = (code: string) => tb.rows.find((r) => r.code === code)!;
    expect(row('1103').closing).toBe(9700000);
    expect(row('11').closing).toBe(9700000 + 1150000); // cash + receivables
    expect(row('1').closing).toBe(9700000 + 1150000);
    expect(row('2').closing).toBe(-(150000 + 20000));
  });
  it('limits depth and hides empty accounts unless asked', () => {
    const top = buildTrialBalance(refs, sumsOf(ledger), { level: 1 });
    expect(top.rows.map((r) => r.code)).toEqual(['1', '2', '3', '4', '6']);
    expect(buildTrialBalance(refs, sumsOf(ledger)).rows.some((r) => r.code === '1102')).toBe(false);
    expect(buildTrialBalance(refs, sumsOf(ledger), { withZero: true }).rows.some((r) => r.code === '1102')).toBe(true);
  });
  it('carries opening balances', () => {
    const tb = buildTrialBalance(refs, [{ accountId: '1103', openDebit: 500, openCredit: 0, debit: 100, credit: 0 }, { accountId: '3101', openDebit: 0, openCredit: 500, debit: 0, credit: 100 }]);
    const r = tb.rows.find((x) => x.code === '1103')!;
    expect([r.opening, r.debit, r.closing]).toEqual([500, 100, 600]);
    expect(tb.balanced).toBe(true);
  });
});

describe('statement of account', () => {
  it('runs the balance on the natural side', () => {
    const lines = [{ debit: 100, credit: 0 }, { debit: 0, credit: 30 }];
    const dr = withRunningBalance('asset', 50, lines);
    expect(dr.rows.map((r) => r.balance)).toEqual([150, 120]);
    expect([dr.opening, dr.closing, dr.totalDebit, dr.totalCredit]).toEqual([50, 120, 100, 30]);
    const cr = withRunningBalance('liability', -50, [{ debit: 0, credit: 70 }]);
    expect([cr.opening, cr.rows[0]!.balance]).toEqual([50, 120]);
  });
});

describe('income statement', () => {
  const sums = ledger.map((l) => ({ ...l, dim: '' }));
  it('derives gross, operating and net profit', () => {
    const is = buildIncomeStatement(refs, sums);
    const s = (k: string) => is.sections.find((x) => x.key === k)!;
    expect(s('revenue').total).toBe(1000000);
    expect(s('operating_expenses').total).toBe(320000);
    expect(is.grossProfit.total).toBe(1000000);
    expect(is.netProfit.total).toBe(680000);
  });
  it('splits by a dimension and the columns add up to the total', () => {
    const by = [
      { accountId: '4101', dim: '2026-09', debit: 0, credit: 600000 }, { accountId: '4101', dim: '2026-10', debit: 0, credit: 400000 },
      { accountId: '5101', dim: '2026-10', debit: 100000, credit: 0 }, { accountId: '4201', dim: '2026-10', debit: 0, credit: 5000 },
    ];
    const is = buildIncomeStatement(refs, by);
    expect(is.columns).toEqual(['2026-09', '2026-10']);
    expect(is.netProfit.values).toEqual({ '2026-09': 600000, '2026-10': 400000 - 100000 + 5000 });
    expect(is.netProfit.total).toBe(905000);
    expect(is.sections.find((x) => x.key === 'cost_of_sales')!.total).toBe(100000);
  });
});

describe('balance sheet', () => {
  const cumulative = new Map<string, number>();
  for (const l of ledger) cumulative.set(l.accountId, (cumulative.get(l.accountId) ?? 0) + l.debit - l.credit);
  it('balances with the open profit in equity', () => {
    const bs = buildBalanceSheet(refs, cumulative, cumulative);
    expect(bs.assets.total).toBe(9700000 + 1150000);
    expect(bs.liabilities.total).toBe(170000);
    expect(bs.equity.total).toBe(10000000);
    expect(bs.currentYearProfit).toBe(680000);
    expect(bs.priorYearsProfit).toBe(0);
    expect(bs.balanced).toBe(true);
  });
  it('splits earlier years from the current year', () => {
    const current = new Map<string, number>([['4101', -400000]]);
    const bs = buildBalanceSheet(refs, cumulative, current);
    expect(bs.currentYearProfit).toBe(400000);
    expect(bs.priorYearsProfit).toBe(280000);
    expect(bs.balanced).toBe(true);
  });
  it('still balances after profit was closed into retained earnings', () => {
    const closed = new Map(cumulative);
    for (const k of ['4101', '6101', '6207']) closed.delete(k);
    closed.set('3201', -680000);
    const bs = buildBalanceSheet(refs, closed, new Map());
    expect(bs.equity.total).toBe(10000000 + 680000);
    expect(bs.balanced).toBe(true);
  });
  it('types are exhaustive', () => {
    const t: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];
    expect(new Set(refs.map((r) => r.type))).toEqual(new Set(t));
  });
});
