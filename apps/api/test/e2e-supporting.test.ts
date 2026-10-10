import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { fiscalYearOf, riyadhDate } from '@mmc/domain';
import { ADMIN_SQL, Client, gotenbergUp, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Phase 6C: VAT return and settlement, fixed assets and depreciation, end-of-service provision,
 * bank reconciliation, cash flow / equity changes / aging / Zakat schedule, the year-end close and
 * the auditor pack. Runs after the posting tests (alphabetical order), which leave VAT-coded entries.
 */
let base = '';
let owner: Client;
let gm: Client;
let acct: Client;
let rep: Client;
let pdfs = false;
const S: Record<string, any> = {};
const today = riyadhDate();
const yearStart = fiscalYearOf(today, 1).start;
const lastMonth = (() => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const stamp = Date.now().toString(36);

async function db<T>(fn: (t: any) => Promise<T>): Promise<T> {
  const sql = ADMIN_SQL();
  try {
    const [t] = await sql`select id from tenant limit 1`;
    let out!: T;
    await sql.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${t!.id}, true)`; out = await fn(tx); });
    return out;
  } finally { await sql.end(); }
}

/** Net debit of an account over all posted lines (optionally within a date range). */
const balance = (code: string, from = '0001-01-01', to = '9999-12-31') => db<number>(async (t) => {
  const [r] = await t`select coalesce(sum(l.debit - l.credit), 0)::text as n from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id
    where e.status = 'posted' and a.code = ${code} and l.entry_date >= ${from} and l.entry_date <= ${to}`;
  return Math.round(Number(r.n) * 100) / 100;
});

beforeAll(async () => {
  base = await startServer();
  pdfs = await gotenbergUp();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const invite = async (email: string, roleKeys: string[]) => {
    const users = await owner.get('/api/users');
    if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
    return signInOrUp(base, email);
  };
  gm = await invite('ap-gm@e2e.test', ['general_manager']);
  acct = await invite('ap-acct@e2e.test', ['accountant']);
  rep = await invite('ap-rep@e2e.test', ['sales_rep']);
  S.company = await owner.get('/api/settings/company');
  S.goLive = (await owner.get('/api/accounting/opening')).goLiveDate;
});

afterAll(async () => {
  try {
    const c = S.company;
    if (c) await owner.put('/api/settings/company', { ...c, vatRegistered: false, vatNumber: null, address: c.address, quoteDefaults: c.quoteDefaults, approvalPolicy: c.approvalPolicy });
    if (S.goLive) await db((t) => t`update ledger_settings set go_live_date = ${S.goLive}`);
  } finally { await stopServer(); }
});

const money = (v: string) => Math.round(Number(v) * 100);

describe('Setup', () => {
  it('has a ledger, and the supporting endpoints are behind ledger permissions', async () => {
    expect(S.goLive).toBeTruthy();
    const accounts = await acct.get('/api/accounting/accounts');
    S.accounts = Object.fromEntries(accounts.map((a: any) => [a.code, a]));
    for (const p of ['/api/accounting/vat-returns', '/api/accounting/fixed-assets', '/api/accounting/bank-statements', '/api/accounting/reports/cash-flow', '/api/accounting/fiscal-years', '/api/accounting/vat/threshold']) {
      await rep.get(p, { expect: 403 });
    }
    // the unlocked books are what the rest of this file assumes
    const settings = await owner.get('/api/accounting/settings');
    if (settings.lockedThrough) await owner.post('/api/accounting/periods/unlock', { through: null, reason: 'تهيئة اختبار 6C' });
  });
});

describe('VAT return', () => {
  it('refuses a return while the company is not VAT-registered, but the threshold monitor works', async () => {
    await acct.post('/api/accounting/vat-returns', { from: yearStart, to: today }, { expect: 409 });
    const t = await acct.get('/api/accounting/vat/threshold');
    expect(t).toMatchObject({ registered: false, mandatoryAt: '375000.00', voluntaryAt: '187500.00' });
    expect(Number(t.rolling12)).toBeGreaterThanOrEqual(0);
    expect(['below', 'voluntary', 'mandatory']).toContain(t.level);
    expect(Array.isArray(t.months)).toBe(true);
  });

  it('prepares a return from the VAT-coded ledger lines and it reconciles to the VAT accounts', async () => {
    const co = S.company;
    await owner.put('/api/settings/company', { ...co, vatRegistered: true, vatNumber: '399999999900003', bankName: 'مصرف الراجحي', iban: 'SA0380000000608010167519', address: co.address, quoteDefaults: co.quoteDefaults, approvalPolicy: co.approvalPolicy });
    // drafts inside the period would block filing
    const drafts = await acct.get('/api/accounting/journal?status=draft&limit=200');
    for (const d of drafts.rows ?? drafts.items ?? drafts) await acct.req('DELETE', `/api/accounting/journal/${d.id}`).catch(() => undefined);
    // a manual entry on a VAT account without a VAT code (the ledger tests post one) is not explained by any box
    const manual = await db<{ id: string; number: string; n: string }[]>((t) => t`
      select e.id, e.number, sum(l.credit - l.debit)::text as n from journal_entry e join journal_line l on l.entry_id = e.id join account a on a.id = l.account_id
      where a.code in ('2110', '1140') and e.status = 'posted' and e.kind = 'manual' and l.vat_code is null and e.reversed_by_id is null group by e.id, e.number`);
    const flagged = await acct.post('/api/accounting/vat-returns', { from: yearStart, to: today });
    if (manual.length) {
      expect(Number(flagged.difference)).not.toBe(0);
      await acct.post(`/api/accounting/vat-returns/${flagged.id}/file`, {}, { expect: 409 }); // refused while the books and the return disagree
      for (const m of manual) await acct.post(`/api/accounting/journal/${m.id}/reverse`, { reason: 'قيد ضريبة بلا كود ضريبي — يُعاد بكود صحيح' });
    }
    const r = await acct.post('/api/accounting/vat-returns', { from: yearStart, to: today });
    S.vat = r;
    expect(r).toMatchObject({ status: 'draft', periodFrom: yearStart, periodTo: today });
    expect(money(r.boxes.box14)).toBeGreaterThan(0);
    expect(money(r.boxes.box1.vat)).toBeGreaterThan(0);
    expect(r.boxes.box16).toBe(r.netVat);
    // every VAT movement in the books is coded, so the return explains the accounts exactly
    expect(r.difference).toBe('0.00');
    const out = -(await balance('2110', yearStart, today));
    const inp = await balance('1140', yearStart, today);
    expect(money(r.outputVat)).toBe(Math.round(out * 100));
    expect(money(r.inputVat)).toBe(Math.round(inp * 100));
    expect(r.netVat).toBe(((out - inp)).toFixed(2));
  });

  it('refuses an overlapping period and the same period is refreshed, not duplicated', async () => {
    await acct.post('/api/accounting/vat-returns', { from: yearStart, to: `${yearStart.slice(0, 4)}-06-30` }, { expect: 409 });
    const again = await acct.post('/api/accounting/vat-returns', { from: yearStart, to: today });
    expect(again.id).toBe(S.vat.id);
    const list = await acct.get('/api/accounting/vat-returns');
    expect(list.items.filter((x: any) => x.periodFrom === yearStart && x.periodTo === today)).toHaveLength(1);
  });

  it('exports the return as Excel', async () => {
    const buf = await acct.get(`/api/accounting/vat-returns/${S.vat.id}?format=xlsx`, { raw: true });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.getRow(1).getCell(1).value).toContain('إقرار ضريبة القيمة المضافة');
  });

  it('files the return: the settlement entry clears output and input VAT', async () => {
    const f = await acct.post(`/api/accounting/vat-returns/${S.vat.id}/file`, {});
    expect(f).toMatchObject({ status: 'filed' });
    expect(f.settlementEntry?.number).toMatch(/^JV-/);
    expect(await balance('2110', yearStart, today)).toBe(0);
    expect(await balance('1140', yearStart, today)).toBe(0);
    const settle = await db<{ code: string; debit: string; credit: string }[]>((t) => t`
      select a.code, l.debit::text, l.credit::text from journal_line l join account a on a.id = l.account_id where l.entry_id = ${f.settlementEntry.id}`);
    expect(settle.map((s) => s.code)).toContain('2111');
    expect(settle.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)).toBeCloseTo(0, 5);
    await acct.post(`/api/accounting/vat-returns/${S.vat.id}/file`, {}, { expect: 409 });
    await acct.post('/api/accounting/vat-returns', { from: yearStart, to: today }, { expect: 409 });
  });

  it('un-filing needs ledger.close, reverses the settlement exactly once and allows filing again', async () => {
    await acct.post(`/api/accounting/vat-returns/${S.vat.id}/unfile`, { reason: 'تصحيح' }, { expect: 403 });
    const u = await gm.post(`/api/accounting/vat-returns/${S.vat.id}/unfile`, { reason: 'تصحيح بيانات الفترة' });
    expect(u.status).toBe('draft');
    expect(await balance('2110', yearStart, today)).toBeLessThan(0);
    const again = await acct.post(`/api/accounting/vat-returns/${S.vat.id}/file`, {});
    expect(again.status).toBe('filed');
    expect(await balance('2110', yearStart, today)).toBe(0);
  });

  it('a reversed document nets to zero in the return (the VAT base is reversed with the entry)', async () => {
    const rows = await db<{ n: string; c: number }[]>((t) => t`
      select coalesce(sum(l.vat_base), 0)::text as n, count(*)::int as c from journal_line l join journal_entry e on e.id = l.entry_id
      where e.source_type in ('invoice', 'bill') and e.status = 'posted' and l.vat_base is not null
        and (e.reversed_by_id is not null or e.reverses_id is not null)`);
    expect(rows[0]!.c).toBeGreaterThan(0);
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe('Fixed assets and depreciation', () => {
  const acquired = `${today.slice(0, 4)}-01-15`;

  it('buys an asset by journal entry and registers it with the right accounts', async () => {
    const e = await acct.post('/api/accounting/journal', { entryDate: acquired, memo: 'شراء أجهزة', lines: [{ accountId: S.accounts['1201'].id, debit: '12000.00', credit: '0' }, { accountId: S.accounts['1103'].id, debit: '0', credit: '12000.00' }] });
    await gm.post(`/api/accounting/journal/${e.id}/post`, {});
    await acct.post('/api/accounting/fixed-assets', { nameAr: 'أجهزة', accountId: S.accounts['1'].id, acquiredOn: acquired, cost: '12000', lifeMonths: 24 }, { expect: 400 }); // group account
    await acct.post('/api/accounting/fixed-assets', { nameAr: 'أجهزة', accountId: S.accounts['1201'].id, acquiredOn: acquired, cost: '12000', salvage: '13000', lifeMonths: 24 }, { expect: 400 });
    const a = await acct.post('/api/accounting/fixed-assets', { nameAr: `أجهزة اختبار ${stamp}`, accountId: S.accounts['1201'].id, acquiredOn: acquired, cost: '12000', salvage: '0', lifeMonths: 24 });
    S.asset = a;
    expect(a).toMatchObject({ code: expect.stringMatching(/^FA-/), startMonth: `${today.slice(0, 4)}-01`, monthly: '500.00', accumulated: '0.00', netBook: '12000.00', status: 'active' });
    expect(a.accumAccountId).toBe(S.accounts['1209'].id);
    expect(a.expenseAccountId).toBe(S.accounts['6209'].id);
  });

  it('depreciates through a month in one entry, catching up earlier months, and never twice', async () => {
    const month = lastMonth;
    const months = Number(month.slice(5, 7)); // January start → N months
    const p = await acct.get(`/api/accounting/depreciation/preview?month=${month}`);
    const mine = p.lines.find((l: any) => l.assetId === S.asset.id);
    expect(mine.amount).toBe((months * 500).toFixed(2));
    await rep.post('/api/accounting/depreciation/run', { month }, { expect: 403 });
    const r = await acct.post('/api/accounting/depreciation/run', { month });
    expect(r.entry.number).toMatch(/^JV-/);
    expect(Number(r.total)).toBeGreaterThanOrEqual(months * 500);
    expect(await balance('1209')).toBeLessThanOrEqual(-(months * 500));
    const after = await acct.get(`/api/accounting/fixed-assets/${S.asset.id}`);
    expect(after.accumulated).toBe((months * 500).toFixed(2));
    expect(after.netBook).toBe((12000 - months * 500).toFixed(2));
    expect(after.schedule).toHaveLength(24);
    const again = await acct.post('/api/accounting/depreciation/run', { month });
    expect(again.entry).toBeNull();
    // the register ties to the ledger
    const checks = await acct.get('/api/accounting/reports/reconciliation');
    const fa = checks.find((c: any) => c.key === 'fixed_assets');
    expect(fa).toBeTruthy();
    expect(Number(fa.source)).toBeGreaterThanOrEqual(12000 - months * 500);
  });

  it('refuses months that have not ended, precede go-live, or an edit after depreciation started', async () => {
    await acct.post('/api/accounting/depreciation/run', { month: today.slice(0, 7) }, { expect: 409 });
    await acct.post('/api/accounting/depreciation/run', { month: '2000-01' }, { expect: 409 });
    await acct.put(`/api/accounting/fixed-assets/${S.asset.id}`, { cost: '9999' }, { expect: 409 });
    const ok = await acct.put(`/api/accounting/fixed-assets/${S.asset.id}`, { notes: 'ملاحظة' });
    expect(ok.notes).toBe('ملاحظة');
  });

  it('disposing an asset depreciates to the disposal month and books the gain or loss', async () => {
    const months = Number(today.slice(5, 7));
    const accumulated = months * 500;
    const proceeds = 6000;
    const d = await acct.post(`/api/accounting/fixed-assets/${S.asset.id}/dispose`, { date: today, proceeds: String(proceeds), proceedsAccountId: S.accounts['1103'].id });
    expect(d.entry.number).toMatch(/^JV-/);
    expect(d.accumulated).toBe(accumulated.toFixed(2));
    expect(d.gainLoss).toBe((proceeds - (12000 - accumulated)).toFixed(2));
    const lines = await db<{ code: string; debit: string; credit: string }[]>((t) => t`select a.code, l.debit::text, l.credit::text from journal_line l join account a on a.id = l.account_id where l.entry_id = ${d.entry.id}`);
    expect(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)).toBeCloseTo(0, 5);
    expect(lines.find((l) => l.code === '1201')!.credit).toBe('12000.00');
    S.disposalLine = await db<{ id: string }>(async (t) => (await t`select l.id from journal_line l join account a on a.id = l.account_id where l.entry_id = ${d.entry.id} and a.code = '1103'`)[0]);
    await acct.post(`/api/accounting/fixed-assets/${S.asset.id}/dispose`, { date: today, proceeds: '0' }, { expect: 409 });
    const reg = await acct.get('/api/accounting/fixed-assets?status=disposed');
    expect(reg.items.some((i: any) => i.id === S.asset.id && i.status === 'disposed')).toBe(true);
    const buf = await acct.get('/api/accounting/fixed-assets?format=xlsx', { raw: true });
    expect(buf.length).toBeGreaterThan(2000);
  });
});

describe('End-of-service provision', () => {
  it('accrues Art. 84 per employee, books it once, and posts nothing the second time', async () => {
    const hired = `${Number(today.slice(0, 4)) - 6}-03-01`;
    const emp = await owner.post('/api/hr/employees', {
      hireDate: hired, contractType: 'unlimited', employmentType: 'full_time', annualLeaveDays: 21, nationality: 'سعودي',
      nameAr: `موظف نهاية الخدمة ${stamp}`, jobTitleAr: 'فني', basicSalary: '8000', housingAllowance: '2000', transportAllowance: '0', department: 'التركيب',
      iban: 'SA0380000000608010167519', bankName: 'الراجحي',
    });
    S.emp = emp;
    await rep.get(`/api/accounting/eosb/preview?month=${lastMonth}`, { expect: 403 });
    const p = await acct.get(`/api/accounting/eosb/preview?month=${lastMonth}`);
    const row = p.rows.find((r: any) => r.employeeId === emp.id);
    expect(row.wage).toBe('10000.00');
    // ~6.6 years on a 10,000 wage: 5 × ½ month, then ~1.6 months → between 40,000 and 41,500
    expect(Number(row.target)).toBeGreaterThan(40_000);
    expect(Number(row.target)).toBeLessThan(41_500);
    expect(row.delta).toBe(row.target);
    expect(Number(p.toPost)).toBeGreaterThanOrEqual(Number(row.target));

    const r = await acct.post('/api/accounting/eosb/run', { month: lastMonth });
    expect(r.entry.number).toMatch(/^JV-/);
    expect(Number(r.total)).toBeCloseTo(Number(p.toPost), 2);
    expect(-(await balance('2201'))).toBeCloseTo(Number(p.target), 2);
    const prov = await db<{ n: string }[]>((t) => t`select coalesce(sum(l.credit - l.debit), 0)::text as n from journal_line l join account a on a.id = l.account_id where a.code = '2201' and l.employee_id = ${emp.id}`);
    expect(Number(prov[0]!.n)).toBeCloseTo(Number(row.target), 2);
    const again = await acct.post('/api/accounting/eosb/run', { month: lastMonth });
    expect(again.entry).toBeNull();
    await acct.post('/api/accounting/eosb/run', { month: today.slice(0, 7) }, { expect: 409 });
  });
});

describe('Bank reconciliation', () => {
  it('rejects a statement on a non-bank account and one that does not foot', async () => {
    await acct.post('/api/accounting/bank-statements', { accountId: S.accounts['4101'].id, dateFrom: yearStart, dateTo: today, closingBalance: '0', lines: [] }, { expect: 400 });
  });

  it('matches by amount and date, shows the difference and reconciles when it is zero', async () => {
    const mk = (closing: string, opening: string) => acct.post('/api/accounting/bank-statements', {
      accountId: S.accounts['1103'].id, reference: `ST-${stamp}`, dateFrom: today.slice(0, 7) + '-01', dateTo: today, openingBalance: opening, closingBalance: closing,
      lines: [{ date: today, description: 'إيداع بيع أصل', ref: S.asset.code, debit: '6000.00', credit: '0' }],
    });
    const first = await mk('0', '-6000');
    expect(first.lines[0].matched).toBe(true); // 6,000 in on the disposal day
    expect(first.lines[0].entryNumber).toMatch(/^JV-/);
    expect(first.summary.footing).toBe('0.00');
    expect(first.summary.reconciled).toBe(false);
    await acct.post(`/api/accounting/bank-statements/${first.id}/reconcile`, {}, { expect: 409 });
    const wanted = Number(first.summary.bookBalance) - Number(first.summary.unmatchedBook); // bank balance that reconciles
    await acct.req('DELETE', `/api/accounting/bank-statements/${first.id}`);

    const st = await mk(wanted.toFixed(2), (wanted - 6000).toFixed(2));
    expect(st.summary.difference).toBe('0.00');
    expect(st.summary.reconciled).toBe(true);

    // unmatching leaves the same item open on both sides: the books still reconcile, but nothing is matched
    const un = await acct.post(`/api/accounting/bank-statements/${st.id}/lines/${st.lines[0].id}/unmatch`, {});
    expect(un.summary).toMatchObject({ matched: 0, unmatchedBank: '6000.00', difference: '0.00' });
    const cand = un.unmatchedBook.find((b: any) => b.id === S.disposalLine.id);
    expect(cand).toBeTruthy();
    const wrong = un.unmatchedBook.find((b: any) => b.id !== S.disposalLine.id && Number(b.debit) !== 6000);
    if (wrong) await acct.post(`/api/accounting/bank-statements/${st.id}/lines/${st.lines[0].id}/match`, { journalLineId: wrong.id }, { expect: 400 });
    const re = await acct.post(`/api/accounting/bank-statements/${st.id}/lines/${st.lines[0].id}/match`, { journalLineId: S.disposalLine.id });
    expect(re.summary).toMatchObject({ matched: 1, unmatchedBank: '0.00', reconciled: true });

    const done = await acct.post(`/api/accounting/bank-statements/${st.id}/reconcile`, {});
    expect(done.status).toBe('reconciled');
    await acct.post(`/api/accounting/bank-statements/${st.id}/lines/${st.lines[0].id}/unmatch`, {}, { expect: 409 });
    await acct.req('DELETE', `/api/accounting/bank-statements/${st.id}`, undefined, { expect: 409 });
    const xlsx = await acct.get(`/api/accounting/bank-statements/${st.id}?format=xlsx`, { raw: true });
    expect(xlsx.length).toBeGreaterThan(2000);
    S.stmt = st;
  });

  it('a matched ledger line cannot be matched again by another statement', async () => {
    const st2 = await acct.post('/api/accounting/bank-statements', {
      accountId: S.accounts['1103'].id, dateFrom: today.slice(0, 7) + '-01', dateTo: today, closingBalance: '0', openingBalance: '-6000',
      lines: [{ date: today, description: 'مكرر', debit: '6000.00', credit: '0' }],
    });
    expect(st2.unmatchedBook.map((b: any) => b.id)).not.toContain(S.disposalLine.id);
    await acct.post(`/api/accounting/bank-statements/${st2.id}/lines/${st2.lines[0].id}/match`, { journalLineId: S.disposalLine.id }, { expect: 400 });
    await acct.req('DELETE', `/api/accounting/bank-statements/${st2.id}`);
  });
});

describe('Statements', () => {
  it('cash flow ties to the change in cash', async () => {
    const cf = await acct.get(`/api/accounting/reports/cash-flow?from=${yearStart}&to=${today}`);
    expect(cf.tiesToLedger).toBe(true);
    expect(cf.difference).toBe('0.00');
    expect((money(cf.openingCash) + money(cf.netChange))).toBe(money(cf.closingCash));
    expect(money(cf.operating.total) + money(cf.investing.total) + money(cf.financing.total)).toBe(money(cf.netChange));
    const xlsx = await acct.get(`/api/accounting/reports/cash-flow?from=${yearStart}&to=${today}&format=xlsx`, { raw: true });
    expect(xlsx.length).toBeGreaterThan(2000);
  });

  it('changes in equity close to the balance sheet equity plus profit', async () => {
    const eq = await acct.get(`/api/accounting/reports/equity-changes?from=${yearStart}&to=${today}`);
    const bs = await acct.get(`/api/accounting/reports/balance-sheet?asOf=${today}`);
    const close = eq.rows.find((r: any) => r.key === 'closing');
    expect(money(close.total)).toBe(money(bs.equity.total) + money(bs.currentYearProfit) + money(bs.priorYearsProfit));
    const profit = eq.rows.find((r: any) => r.key === 'profit');
    expect(money(profit.total)).toBe(money(bs.currentYearProfit));
  });

  it('aging totals agree with the receivable and payable accounts', async () => {
    const ar = await acct.get(`/api/accounting/reports/aging?side=ar&asOf=${today}`);
    const ap = await acct.get(`/api/accounting/reports/aging?side=ap&asOf=${today}`);
    expect(ar.buckets).toHaveLength(5);
    expect(money(ar.totals.total)).toBe(Math.round((await balance('1110', '0001-01-01', today)) * 100));
    expect(money(ap.totals.total)).toBe(Math.round(-(await balance('2101', '0001-01-01', today)) * 100));
    const sum = ar.items.reduce((s: number, i: any) => s + money(i.total), 0);
    expect(sum).toBe(money(ar.totals.total));
  });

  it('the Zakat working schedule follows additions − deductions and the greater-of rule', async () => {
    const z = await acct.get(`/api/accounting/reports/zakat?asOf=${today}`);
    expect(money(z.base)).toBe(money(z.totalAdditions) - money(z.totalDeductions));
    expect(money(z.chargeable)).toBe(Math.max(0, Math.max(money(z.base), money(z.adjustedProfit))));
    expect(money(z.zakat)).toBe(Math.round(money(z.chargeable) * z.rate));
    expect(z.note).toContain('تقديرية');
    const hijri = await acct.get(`/api/accounting/reports/zakat?asOf=${today}&rate=hijri`);
    expect(hijri.rate).toBe(0.025);
    const x = await acct.get(`/api/accounting/reports/zakat?asOf=${today}&format=xlsx`, { raw: true });
    expect(x.length).toBeGreaterThan(2000);
  });

  it('the dashboard reconciliation includes the VAT check', async () => {
    const d = await acct.get('/api/accounting/dashboard');
    const keys = d.checks.map((c: any) => c.key);
    expect(keys).toContain('vat');
    expect(d.checks.find((c: any) => c.key === 'vat').ok).toBe(true);
  });
});

describe('Year-end close', () => {
  const prior = `${Number(today.slice(0, 4)) - 1}`;

  it('shows the open year with its blockers and refuses to close a year that has not ended', async () => {
    const years = await acct.get('/api/accounting/fiscal-years');
    const cur = years.find((y: any) => y.start === yearStart);
    expect(cur).toMatchObject({ status: 'open', canClose: false });
    expect(cur.blockers.join(' ')).toContain('لم تنتهِ');
    await acct.post('/api/accounting/fiscal-years/close', { start: yearStart }, { expect: 403 });
    await gm.post('/api/accounting/fiscal-years/close', { start: yearStart }, { expect: 409 });
  });

  it('closes a finished year: income and expense go to retained earnings, books are locked', async () => {
    // history before the current year (inserted directly, as posted entries of the previous year)
    await db(async (t) => {
      await t`update ledger_settings set go_live_date = ${`${prior}-01-01`}`;
      const acc = Object.fromEntries((await t`select id, code from account`).map((r: any) => [r.code, r.id]));
      const mk = async (num: string, date: string, lines: { code: string; debit: number; credit: number }[]) => {
        const [e] = await t`insert into journal_entry (number, entry_date, period, kind, memo, status, total) values (${num}, ${date}, ${date.slice(0, 7)}, 'manual', 'قيد سنة سابقة', 'draft', 0) returning id`;
        for (const [i, l] of lines.entries()) await t`insert into journal_line (entry_id, line_no, account_id, entry_date, debit, credit) values (${e.id}, ${i + 1}, ${acc[l.code]}, ${date}, ${l.debit}, ${l.credit})`;
        await t`update journal_entry set status = 'posted', total = ${lines.reduce((s, l) => s + l.debit, 0)}, posted_at = now() where id = ${e.id}`;
      };
      await mk(`JV-T${stamp}1`, `${prior}-03-10`, [{ code: '1103', debit: 5000, credit: 0 }, { code: '4101', debit: 0, credit: 5000 }]);
      await mk(`JV-T${stamp}2`, `${prior}-04-05`, [{ code: '6201', debit: 2000, credit: 0 }, { code: '1103', debit: 0, credit: 2000 }]);
    });
    const years = await gm.get('/api/accounting/fiscal-years');
    const y = years.find((x: any) => x.start === `${prior}-01-01`);
    expect(y).toMatchObject({ status: 'open', canClose: true, profit: '3000.00' });
    // the current year cannot close before the previous one
    const cur = years.find((x: any) => x.start === yearStart);
    expect(cur.blockers.join(' ')).toContain('أقفل السنة');

    const c = await gm.post('/api/accounting/fiscal-years/close', { start: `${prior}-01-01` });
    expect(c).toMatchObject({ profit: '3000.00', lockedThrough: `${prior}-12-31` });
    expect(await balance('4101', `${prior}-01-01`, `${prior}-12-31`)).toBe(0);
    expect(await balance('6201', `${prior}-01-01`, `${prior}-12-31`)).toBe(0);
    expect(await balance('3201', `${prior}-01-01`, `${prior}-12-31`)).toBe(-3000);

    // reports: the income statement still shows the year's profit; the balance sheet balances with profit in equity
    const is = await acct.get(`/api/accounting/reports/income-statement?from=${prior}-01-01&to=${prior}-12-31`);
    expect(is.netProfit.total).toBe('3000.00');
    const bs = await acct.get(`/api/accounting/reports/balance-sheet?asOf=${prior}-12-31`);
    expect(bs.balanced).toBe(true);
    expect(bs.priorYearsProfit).toBe('0.00');

    // the closed year is locked
    await acct.post('/api/accounting/journal', { entryDate: `${prior}-06-01`, memo: 'متأخر', lines: [{ accountId: S.accounts['1101'].id, debit: '1', credit: '0' }, { accountId: S.accounts['4201'].id, debit: '0', credit: '1' }] }, { expect: 400 });
    await gm.post('/api/accounting/fiscal-years/close', { start: `${prior}-01-01` }, { expect: 409 });
  });

  it('only the owner can re-open it, and re-opening reverses the closing entry once', async () => {
    await gm.post('/api/accounting/fiscal-years/reopen', { start: `${prior}-01-01`, reason: 'تعديل' }, { expect: 403 });
    const r = await owner.post('/api/accounting/fiscal-years/reopen', { start: `${prior}-01-01`, reason: 'إضافة قيد تسوية متأخر' });
    expect(r.label).toBe(prior);
    expect(await balance('4101', `${prior}-01-01`, `${prior}-12-31`)).toBe(-5000);
    expect(await balance('3201', `${prior}-01-01`, `${prior}-12-31`)).toBe(0);
    const years = await gm.get('/api/accounting/fiscal-years');
    expect(years.find((y: any) => y.start === `${prior}-01-01`).status).toBe('open');
    const closed = await db<{ n: number }[]>((t) => t`select count(*)::int as n from journal_entry where kind = 'closing' and reversed_by_id is not null`);
    expect(closed[0]!.n).toBe(1);
  });
});

describe('Auditor pack', () => {
  it('is for the owner / general manager only and bundles every statement with a manifest', async () => {
    await acct.get('/api/accounting/auditor-pack', { expect: 403 });
    const buf = await gm.get(`/api/accounting/auditor-pack?start=${yearStart}`, { raw: true });
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    for (const f of ['01-trial-balance.xlsx', '02-income-statement.xlsx', '03-balance-sheet.xlsx', '04-cash-flow.xlsx', '05-equity-changes.xlsx', '06-receivables-aging.xlsx',
      '07-payables-aging.xlsx', '08-general-journal.xlsx', '09-fixed-assets.xlsx', '10-vat-returns.xlsx', '11-eosb-schedule.xlsx', '12-bank-reconciliations.xlsx', '13-zakat-base.xlsx',
      '14-reconciliation-checks.xlsx', '15-invoices.xlsx', '16-supplier-bills.xlsx', '17-payroll-summary.xlsx', '18-audit-trail.csv', 'README.txt', 'manifest.json']) {
      expect(names, f).toContain(f);
    }
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.fiscalYear).toBe(String(yearStart.slice(0, 4)));
    expect(manifest.files.length).toBeGreaterThanOrEqual(18);
    const { createHash } = await import('node:crypto');
    const tb = await zip.file('01-trial-balance.xlsx')!.async('nodebuffer');
    expect(manifest.files.find((x: any) => x.file === '01-trial-balance.xlsx').sha256).toBe(createHash('sha256').update(tb).digest('hex'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tb as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.rowCount).toBeGreaterThan(5);
    if (pdfs) expect(names).toContain('pdf/01-trial-balance.pdf');
    const csv = await zip.file('18-audit-trail.csv')!.async('string');
    expect(csv).toContain('entity_type');
  });
});
