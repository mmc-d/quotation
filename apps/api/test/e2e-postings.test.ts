import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fiscalYearOf, riyadhDate } from '@mmc/domain';
import { ADMIN_SQL, Client, gotenbergUp, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Phase 6B (batch a): sales invoices, customer payments and cash vouchers are posted to the ledger
 * automatically — once, balanced, with exactly one reversal on cancellation.
 * Runs after e2e-ledger.test.ts, which sets the go-live date.
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
const days = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Run SQL inside the first tenant (FORCE RLS applies to the owner role too). */
async function db<T>(fn: (t: any) => Promise<T>): Promise<T> {
  const sql = ADMIN_SQL();
  try {
    const [t] = await sql`select id from tenant limit 1`;
    let out!: T;
    await sql.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${t!.id}, true)`; out = await fn(tx); });
    return out;
  } finally { await sql.end(); }
}

interface Row { number: string; kind: string; status: string; entry_date: string; memo: string | null; source_event: string | null; reversed_by_id: string | null; code: string; debit: string; credit: string; party_id: string | null; vat_code: string | null }
/** All journal lines of a source document (by its human number or id), ordered by entry then line. */
const linesOf = (ref: string) => db<Row[]>((t) => t`
  select e.number, e.kind, e.status, e.entry_date::text, e.memo, e.source_event, e.reversed_by_id, a.code, l.debit::text, l.credit::text, l.party_id, l.vat_code
  from journal_entry e join journal_line l on l.entry_id = e.id join account a on a.id = l.account_id
  where e.source_ref = ${ref} order by e.created_at, l.line_no`);
const entriesOf = (ref: string) => db<{ number: string; kind: string; source_event: string | null; reversed_by_id: string | null }[]>((t) => t`select number, kind, source_event, reversed_by_id from journal_entry where source_ref = ${ref} order by created_at`);
const net = (rows: Row[], code: string) => rows.filter((r) => r.code === code).reduce((s, r) => s + Math.round((Number(r.debit) - Number(r.credit)) * 100), 0) / 100;
const partyBalance = (partyId: string, code: string) => db<number>(async (t) => {
  const [r] = await t`select coalesce(sum(l.debit - l.credit), 0)::text as n from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id where e.status = 'posted' and a.code = ${code} and l.party_id = ${partyId}`;
  return Number(r.n);
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
});

/** e2e.test.ts (last in the run) expects the seeded company to be not VAT-registered — put it back. */
afterAll(async () => {
  try {
    if (S.company) await owner.put('/api/settings/company', { ...S.company, vatRegistered: false, vatNumber: null, address: S.company.address, quoteDefaults: S.company.quoteDefaults, approvalPolicy: S.company.approvalPolicy });
  } finally { await stopServer(); }
});

describe('Go-live', () => {
  it('has a go-live date (set by the ledger tests, or here)', async () => {
    let state = await owner.get('/api/accounting/opening');
    if (!state.goLiveDate) {
      const accounts = await acct.get('/api/accounting/accounts');
      const id = (c: string) => accounts.find((a: any) => a.code === c).id;
      const o = await owner.post('/api/accounting/opening', { goLiveDate: yearStart, lines: [{ accountId: id('1103'), debit: '1000', credit: '0' }] });
      await acct.post(`/api/accounting/journal/${o.id}/post`, {});
      state = await owner.get('/api/accounting/opening');
    }
    expect(state.goLiveDate).toBeTruthy();
    S.accounts = Object.fromEntries((await acct.get('/api/accounting/accounts')).map((a: any) => [a.code, a]));
  });

  it('keeps the posting endpoints behind ledger permissions', async () => {
    await rep.post('/api/accounting/posting/run', {}, { expect: 403 });
    await rep.get('/api/accounting/posting/exceptions', { expect: 403 });
    await rep.get('/api/accounting/reports/reconciliation', { expect: 403 });
  });
});

describe('Invoices and customer payments post themselves', () => {
  it('runs a VAT contract through 386 → 386 → 388 and posts every document', async () => {
    if (!pdfs) return;
    const co = await owner.get('/api/settings/company');
    S.company = co;
    await owner.put('/api/settings/company', { ...co, vatRegistered: true, vatNumber: '399999999900003', bankName: 'مصرف الراجحي', iban: 'SA0380000000608010167519', address: co.address, quoteDefaults: co.quoteDefaults, approvalPolicy: co.approvalPolicy }, { expect: 200 });
    const p = await owner.post('/api/parties', { nameAr: 'شركة الترحيل التلقائي', vatNumber: '311111111100003', b2b: true, contacts: [{ name: 'سالم', mobile: '0551112233', isPrimary: true }] });
    S.party = p;
    const q = await owner.post('/api/quotes', { partyId: p.id, clientName: 'شركة الترحيل التلقائي', clientPhone: '0551112233', discountType: 'amount', discountValue: '0', vatOn: true, lines: [{ code: 'SYS', description: 'نظام انتركوم', unitPrice: '10000', qty: '1' }] });
    await owner.post(`/api/quotes/${q.id}/submit`);
    const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
    await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
    const [m1, m2, m3] = c.milestones;

    const pr1 = await owner.post(`/api/finance/milestones/${m1.id}/request`, { send: 'whatsapp' });
    await new Client(base).post(`/api/public/pay/${pr1.publicToken}/sandbox`, {}, { expect: 200 });
    const pr2 = await owner.post(`/api/finance/milestones/${m2.id}/request`, {});
    await owner.post(`/api/finance/payment-requests/${pr2.id}/payments`, { amount: '4600.00', paidOn: today, method: 'bank_transfer', reference: 'AP-TRX-2' });
    const pr3 = await owner.post(`/api/finance/milestones/${m3.id}/request`, {});
    await owner.post(`/api/finance/payment-requests/${pr3.id}/payments`, { amount: '1150.00', paidOn: today, method: 'mada', reference: 'AP-POS-9' });

    const bill = await owner.get(`/api/finance/contracts/${c.id}`);
    S.inv386 = bill.invoices.filter((i: any) => i.typeCode === '386');
    S.inv388 = bill.invoices.find((i: any) => i.typeCode === '388');
    expect(S.inv386).toHaveLength(2);

    // 386: Dr AR · Cr customer advances + output VAT
    const a1 = await linesOf(S.inv386.find((i: any) => i.total === '5750.00').number);
    expect(a1.every((r) => r.kind === 'auto' && r.status === 'posted')).toBe(true);
    expect(net(a1, '1110')).toBe(5750);
    expect(net(a1, '2102')).toBe(-5000);
    expect(net(a1, '2110')).toBe(-750);
    expect(a1.find((r) => r.code === '2110')!.vat_code).toBe('S');

    // 388: revenue, VAT, and the advances cleared in the same entry
    const fin = await linesOf(S.inv388.number);
    expect(net(fin, '4101')).toBe(-10000);
    expect(net(fin, '1110')).toBe(1150); // 11,500 − 10,350 already invoiced
    expect(net(fin, '2102')).toBe(9000);
    expect(net(fin, '2110')).toBe(-150); // 1,500 − 1,350 of VAT already declared on the advances
    expect(fin.every((r) => r.party_id === null || r.party_id === p.id)).toBe(true);

    // The customer ends at zero everywhere, advances are consumed, VAT and revenue are right.
    expect(await partyBalance(p.id, '1110')).toBe(0);
    expect(await partyBalance(p.id, '2102')).toBe(0);
  });

  it('records each customer payment against the method account', async () => {
    if (!pdfs) return;
    const rows = await db<{ code: string; debit: string; credit: string; n: string }[]>((t) => t`
      select a.code, l.debit::text, l.credit::text, e.source_ref as n from journal_entry e join journal_line l on l.entry_id = e.id join account a on a.id = l.account_id
      where e.source_type = 'payment' and e.kind = 'auto' and e.memo like '%AP-%' order by e.created_at, l.line_no`);
    const bank = rows.filter((r) => r.code === '1103' && Number(r.debit) === 4600);
    const gateway = rows.filter((r) => r.code === '1104' && Number(r.debit) === 1150);
    expect(bank).toHaveLength(1); // bank transfer → bank
    expect(gateway).toHaveLength(1); // mada → payment-gateway clearing
    expect(rows.filter((r) => r.code === '1110').reduce((s, r) => s + Number(r.credit), 0)).toBe(5750);
  });

  it('posts nothing twice — running the engine again changes nothing', async () => {
    if (!pdfs) return;
    const before = (await entriesOf(S.inv388.number)).length;
    const run = await acct.post('/api/accounting/posting/run', {});
    expect(run).toMatchObject({ live: true, errors: 0 });
    await acct.post('/api/accounting/posting/run', {});
    expect((await entriesOf(S.inv388.number)).length).toBe(before);
    expect(before).toBe(1);
  });

  it('posts a 381 credit note as the reverse of the sale', async () => {
    if (!pdfs) return;
    const cn = await owner.post(`/api/finance/invoices/${S.inv388.id}/credit-note`, { reason: 'خصم لاحق', amount: '115.00' });
    const rows = await linesOf(cn.number);
    expect(net(rows, '4101')).toBe(100);
    expect(net(rows, '2110')).toBe(15);
    expect(net(rows, '1110')).toBe(-115);
    S.cn = cn;
  });

  it('reverses exactly once when the back office cancels an invoice', async () => {
    if (!pdfs) return;
    await db((t) => t`update invoice_mirror set status = 'cancelled' where id = ${S.cn.id}`);
    expect((await acct.post('/api/accounting/posting/run', {})).reversed).toBe(1);
    await acct.post('/api/accounting/posting/run', {});
    const es = await entriesOf(S.cn.number);
    expect(es.map((e) => e.kind)).toEqual(['auto', 'reversal']);
    expect(es[1]!.source_event).toMatch(/^cancel:/);
    expect(es[0]!.reversed_by_id).toBeTruthy();
    expect(net(await linesOf(S.cn.number), '4101')).toBe(0);
  });

  it('flags an amount that changed after posting instead of re-posting', async () => {
    if (!pdfs) return;
    await db((t) => t`update invoice_mirror set total = total + 1, taxable = taxable + 1 where id = ${S.inv386[0].id}`);
    await acct.post('/api/accounting/posting/run', {});
    const ex = await acct.get('/api/accounting/posting/exceptions');
    expect(ex.changed.map((c: any) => c.ref)).toContain(S.inv386[0].number);
    expect((await entriesOf(S.inv386[0].number)).length).toBe(1);
    await db((t) => t`update invoice_mirror set total = total - 1, taxable = taxable - 1 where id = ${S.inv386[0].id}`);
  });
});

describe('Cash vouchers', () => {
  const voucher = (over: Record<string, unknown> = {}) => ({
    kind: 'payment', voucherDate: today, counterpartyName: 'مورد نقدي', amount: '300.00', purpose: 'مصروف ضيافة', method: 'cash', ...over,
  });

  it('refuses a counter account that needs a party when none is chosen', async () => {
    await acct.post('/api/vouchers', voucher({ accountId: S.accounts['1110'].id }), { expect: 400 });
    await acct.post('/api/vouchers', voucher({ accountId: S.accounts['1'].id }), { expect: 400 }); // group account
  });

  it('posts on approval: counter account vs the cash side, with project/cost-centre carried', async () => {
    const v = await acct.post('/api/vouchers', voucher({ accountId: S.accounts['6207'].id, costCenter: 'المبيعات' }));
    expect(v.account).toMatchObject({ code: '6207' });
    expect((await entriesOf(v.number)).length).toBe(0); // a draft posts nothing
    await gm.post(`/api/vouchers/${v.id}/approve`);
    const rows = await linesOf(v.number);
    expect(net(rows, '6207')).toBe(300);
    expect(net(rows, '1101')).toBe(-300);
    S.v = v;
  });

  it('cancelling an approved voucher reverses its entry once', async () => {
    await gm.post(`/api/vouchers/${S.v.id}/cancel`, { reason: 'تكرار' });
    await acct.post('/api/accounting/posting/run', {});
    const es = await entriesOf(S.v.number);
    expect(es.map((e) => e.kind)).toEqual(['auto', 'reversal']);
    expect(net(await linesOf(S.v.number), '6207')).toBe(0);
  });

  it('a receipt from a customer lowers their AR balance', async () => {
    if (!pdfs) return;
    const before = await partyBalance(S.party.id, '1110');
    const r = await acct.post('/api/vouchers', voucher({ kind: 'receipt', partyId: S.party.id, counterpartyName: 'شركة الترحيل التلقائي', amount: '500.00', method: 'transfer', purpose: 'دفعة على الحساب' }));
    await gm.post(`/api/vouchers/${r.id}/approve`);
    const rows = await linesOf(r.number);
    expect(net(rows, '1103')).toBe(500);
    expect(net(rows, '1110')).toBe(-500);
    expect(await partyBalance(S.party.id, '1110')).toBe(before - 500);
  });
});

describe('Suspense, reclassification and the locked period', () => {
  it('sends an unclassified voucher to suspense and lists it', async () => {
    const v = await acct.post('/api/vouchers', { kind: 'payment', voucherDate: today, counterpartyName: 'غير معروف', amount: '75.00', purpose: 'مصروف غير مصنف', method: 'cash' });
    await gm.post(`/api/vouchers/${v.id}/approve`);
    expect(net(await linesOf(v.number), '9101')).toBe(75);
    const ex = await acct.get('/api/accounting/posting/exceptions');
    const item = ex.suspense.find((s: any) => s.sourceRef === v.number);
    expect(item).toMatchObject({ amount: '75.00', side: 'debit', canReclassify: true });
    S.susp = { v, item };
    const checks = await acct.get('/api/accounting/reports/reconciliation');
    expect(checks.find((c: any) => c.key === 'suspense').ok).toBe(false);
    expect(checks.find((c: any) => c.key === 'trial_balance').ok).toBe(true);
  });

  it('reclassifies the line: the old entry is reversed and a new one posted, both linked', async () => {
    await acct.post('/api/accounting/posting/reclassify', { entryId: S.susp.item.entryId, lineId: S.susp.item.lineId, accountId: S.accounts['6207'].id }, { expect: 201 });
    await acct.post('/api/accounting/posting/reclassify', { entryId: S.susp.item.entryId, lineId: S.susp.item.lineId, accountId: S.accounts['6207'].id }, { expect: 409 });
    const rows = await linesOf(S.susp.v.number);
    expect(net(rows, '9101')).toBe(0);
    expect(net(rows, '6207')).toBe(75);
    expect((await entriesOf(S.susp.v.number)).map((e) => e.kind)).toEqual(['auto', 'reversal', 'auto']);
    const ex = await acct.get('/api/accounting/posting/exceptions');
    expect(ex.suspense.find((s: any) => s.sourceRef === S.susp.v.number)).toBeUndefined();
    // a later cancellation still reverses the live (reclassified) entry exactly once
    await gm.post(`/api/vouchers/${S.susp.v.id}/cancel`, { reason: 'اختبار' });
    await acct.post('/api/accounting/posting/run', {});
    expect(net(await linesOf(S.susp.v.number), '6207')).toBe(0);
  });

  it('posts a document dated inside a locked period on the first open day', async () => {
    await owner.post('/api/accounting/periods/lock', { through: days(-2) });
    try {
      const v = await acct.post('/api/vouchers', { kind: 'payment', voucherDate: days(-3), counterpartyName: 'مورد', amount: '40.00', purpose: 'مصروف قديم', method: 'cash' });
      await gm.post(`/api/vouchers/${v.id}/approve`);
      const rows = await linesOf(v.number);
      expect(rows[0]!.entry_date).toBe(days(-1));
      expect(rows[0]!.memo).toContain(`التاريخ الأصلي ${days(-3)}`);
      const ex = await acct.get('/api/accounting/posting/exceptions');
      expect(ex.shifted.some((s: any) => s.memo.includes(v.number))).toBe(true);
    } finally {
      await owner.post('/api/accounting/periods/unlock', { through: null, reason: 'اختبار' });
    }
  });
});

describe('Nothing is posted before go-live', () => {
  it('skips documents dated before the go-live date', async () => {
    // a voucher cannot be future-dated but can be old: it is covered by the opening balances
    const v = await acct.post('/api/vouchers', { kind: 'payment', voucherDate: days(-4000), counterpartyName: 'قديم', amount: '10.00', purpose: 'قبل التشغيل', method: 'cash' });
    await gm.post(`/api/vouchers/${v.id}/approve`);
    await acct.post('/api/accounting/posting/run', {});
    expect((await entriesOf(v.number)).length).toBe(0);
  });
});
