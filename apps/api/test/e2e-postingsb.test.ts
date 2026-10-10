import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { employerGosi, fiscalYearOf, isSaudiNationality, riyadhDate, toHalalas } from '@mmc/domain';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Phase 6B (batches b + c): purchase orders → goods receipt → supplier bill → payment (and void /
 * cancel), local bills, opening stock, import VAT + landed cost, payroll (with employer GOSI and
 * deduction categories), commission deltas, and the AP / inventory / GRNI reconciliation.
 * Runs after e2e-ledger / e2e-postings, which set the go-live date.
 */
let base = '';
let owner: Client;
let gm: Client;
let acct: Client;
let hr: Client;
const S: Record<string, any> = {};
const today = riyadhDate();
const yearStart = fiscalYearOf(today, 1).start;
const month = today.slice(0, 7);
const stamp = Date.now().toString(36);
const myProducts: string[] = [];

async function db<T>(fn: (t: any) => Promise<T>): Promise<T> {
  const sql = ADMIN_SQL();
  try {
    const [t] = await sql`select id from tenant limit 1`;
    let out!: T;
    await sql.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${t!.id}, true)`; out = await fn(tx); });
    return out;
  } finally { await sql.end(); }
}

interface Row { number: string; kind: string; memo: string | null; source_event: string | null; code: string; debit: string; credit: string; party_id: string | null; employee_id: string | null; vat_code: string | null }
const linesOf = (type: string, ref: string) => db<Row[]>((t) => t`
  select e.number, e.kind, e.memo, e.source_event, a.code, l.debit::text, l.credit::text, l.party_id, l.employee_id, l.vat_code
  from journal_entry e join journal_line l on l.entry_id = e.id join account a on a.id = l.account_id
  where e.source_type = ${type} and e.source_ref = ${ref} order by e.created_at, l.line_no`);
const net = (rows: Row[], code: string) => rows.filter((r) => r.code === code).reduce((s, r) => s + Math.round((Number(r.debit) - Number(r.credit)) * 100), 0) / 100;
const balance = (code: string) => db<number>(async (t) => {
  const [r] = await t`select coalesce(sum(l.debit - l.credit), 0)::text as n from journal_line l join journal_entry e on e.id = l.entry_id join account a on a.id = l.account_id where e.status = 'posted' and a.code = ${code}`;
  return Number(r.n);
});
const run = () => acct.post('/api/accounting/posting/run', {});

async function product(code: string, extra: Record<string, unknown> = {}) {
  const p = await owner.put('/api/products/new', { code, nameAr: `منتج ${code}`, listPrice: '100', ...extra });
  myProducts.push(p.id);
  return p;
}

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const invite = async (email: string, roleKeys: string[]) => {
    const users = await owner.get('/api/users');
    if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
    return signInOrUp(base, email);
  };
  gm = await invite('pb-gm@e2e.test', ['general_manager']);
  acct = await invite('pb-acct@e2e.test', ['accountant']);
  hr = await invite('pb-hr@e2e.test', ['hr_officer']);
  // the ledger must be open (go-live set) — create the opening entry when the ledger tests did not run first
  let state = await owner.get('/api/accounting/opening');
  if (!state.goLiveDate) {
    const accounts = await acct.get('/api/accounting/accounts');
    const id = (c: string) => accounts.find((a: any) => a.code === c).id;
    const o = await owner.post('/api/accounting/opening', { goLiveDate: yearStart, lines: [{ accountId: id('1103'), debit: '1000', credit: '0' }] });
    await acct.post(`/api/accounting/journal/${o.id}/post`, {});
    state = await owner.get('/api/accounting/opening');
  }
  S.accounts = Object.fromEntries((await acct.get('/api/accounting/accounts')).map((a: any) => [a.code, a]));
  S.sup = await owner.post('/api/parties', { nameAr: `مورد الترحيل ${stamp}`, isSupplier: true, isCustomer: false, vatNumber: '300075588700003' });
  S.broker = await owner.post('/api/parties', { nameAr: `مخلص جمركي ${stamp}`, isSupplier: true, isCustomer: false });
  S.p1 = await product(`PB-P1-${stamp}`);
  S.p2 = await product(`PB-P2-${stamp}`);
  S.p3 = await product(`PB-P3-${stamp}`);
  await run(); // post whatever earlier test files left behind, so the checks below start from a clean base
});

afterAll(async () => {
  try {
    if (myProducts.length) {
      const sql = ADMIN_SQL();
      await sql`update product set archived_at = now() where id in ${sql(myProducts)}`;
      await sql.end();
    }
  } finally { await stopServer(); }
});

describe('Purchase order → receipt → bill → payment', () => {
  it('posts the goods receipt to inventory against GRNI', async () => {
    const po = await owner.post('/api/inventory/purchase-orders', { supplierId: S.sup.id, currency: 'SAR', lines: [{ productId: S.p1.id, qty: 10, unitPrice: '20' }] });
    await owner.post(`/api/inventory/purchase-orders/${po.id}/submit`);
    await gm.post(`/api/inventory/purchase-orders/${po.id}/approve`, { acknowledgeCompliance: true });
    const seen = await owner.get(`/api/inventory/purchase-orders/${po.id}`);
    const inv0 = await balance('1130');
    const grni0 = await balance('2103');
    await owner.post(`/api/inventory/purchase-orders/${po.id}/receipts`, { receivedOn: today, lines: [{ orderLineId: seen.lines[0].id, qty: 10 }] });
    const r = await run();
    expect(r.errors).toBe(0);
    expect(await balance('1130')).toBeCloseTo(inv0 + 200, 2);
    expect(await balance('2103')).toBeCloseTo(grni0 - 200, 2); // credit side
    S.po = seen;
    S.grni0 = grni0;
    // received and not billed: shows in the GRNI report
    const g = await acct.get('/api/accounting/reports/grni');
    expect(g.rows.find((x: any) => x.order === po.number)).toMatchObject({ received: '10.000', billed: '0.000', valueSar: '200.00' });
  });

  it('posts the bill: GRNI cleared at receipt cost, price variance, input VAT, payable to the supplier', async () => {
    const bill = await owner.post('/api/inventory/bills', {
      supplierId: S.sup.id, orderId: S.po.id, supplierInvoiceNo: `PB-${stamp}-1`, billDate: today, currency: 'SAR',
      lines: [{ orderLineId: S.po.lines[0].id, qty: '10', unitPrice: '21' }], vat: '31.50',
    });
    expect(bill.status).toBe('approved');
    const rows = await linesOf('bill', bill.number);
    expect(net(rows, '2103')).toBe(200); // GRNI debited at the 20.00 receipt cost
    expect(net(rows, '5105')).toBe(10); // 210 billed − 200 received
    expect(net(rows, '1140')).toBe(31.5);
    expect(net(rows, '2101')).toBe(-241.5);
    expect(rows.find((r) => r.code === '2101')!.party_id).toBe(S.sup.id);
    expect(rows.find((r) => r.code === '1140')!.vat_code).toBe('S');
    S.bill = bill;
    const g = await acct.get('/api/accounting/reports/grni');
    expect(g.rows.find((x: any) => x.order === S.po.number)).toBeUndefined();
  });

  it('posts a supplier payment once and reverses it when the payment is voided', async () => {
    const paid = await owner.post(`/api/inventory/bills/${S.bill.id}/payments`, { paidOn: today, amount: '100.00', method: 'bank_transfer', reference: 'PB-TRX' });
    const rows = await linesOf('bill_payment', S.bill.number);
    expect(net(rows, '2101')).toBe(100);
    expect(net(rows, '1103')).toBe(-100);
    await run();
    expect((await linesOf('bill_payment', S.bill.number)).filter((r) => r.kind === 'auto')).toHaveLength(2); // nothing re-posted
    await owner.post(`/api/inventory/bills/${S.bill.id}/payments/${paid.payments[0].id}/void`, { reason: 'خطأ إدخال' });
    const after = await linesOf('bill_payment', S.bill.number);
    expect(after.map((r) => r.kind)).toEqual(['auto', 'auto', 'reversal', 'reversal']);
    expect(net(after, '2101')).toBe(0);
    expect(after.at(-1)!.source_event).toMatch(/^void:/);
    await owner.post(`/api/inventory/bills/${S.bill.id}/payments`, { paidOn: today, amount: '241.50', method: 'cash' });
    const now = await linesOf('bill_payment', S.bill.number);
    expect(net(now, '2101')).toBe(241.5);
    expect(net(now, '1101')).toBe(-241.5);
  });

  it('cancels an unpaid bill with exactly one reversal; a paid one is refused', async () => {
    await owner.post(`/api/inventory/bills/${S.bill.id}/cancel`, { reason: 'x' }, { expect: 400 }); // has payments
    const d = await owner.post('/api/inventory/bills/direct', { supplierId: S.sup.id, supplierInvoiceNo: `PB-${stamp}-X`, billDate: today, currency: 'SAR', receive: false, lines: [{ description: 'خدمة اختبار', qty: '1', unitPrice: '100' }] });
    expect(d.total).toBe('115.00');
    const rows = await linesOf('bill', d.number);
    expect(net(rows, '5103')).toBe(100); // expense-only bill → direct purchase expenses
    expect(net(rows, '1140')).toBe(15);
    expect(net(rows, '2101')).toBe(-115);
    await owner.post(`/api/inventory/bills/${d.id}/cancel`, { reason: 'فاتورة مكررة' });
    await owner.post(`/api/inventory/bills/${d.id}/cancel`, { reason: 'again' }, { expect: 409 });
    await run();
    const after = await linesOf('bill', d.number);
    expect(after.filter((r) => r.kind === 'reversal').length).toBe(rows.length);
    expect(net(after, '2101')).toBe(0);
  });
});

describe('Local bills and opening stock', () => {
  it('posts a direct bill: received goods to inventory at their move cost, the rest to expenses', async () => {
    const wh = (await owner.get('/api/inventory/warehouses')).find((w: any) => w.kind === 'main');
    const inv0 = await balance('1130');
    const d = await owner.post('/api/inventory/bills/direct', {
      supplierId: S.sup.id, supplierInvoiceNo: `PB-${stamp}-2`, billDate: today, currency: 'SAR', warehouseId: wh.id,
      lines: [{ productId: S.p2.id, qty: '10', unitPrice: '5' }, { description: 'أجور توصيل', qty: '1', unitPrice: '20' }],
    });
    expect(d).toMatchObject({ subtotal: '70.00', vat: '10.50', total: '80.50' });
    const rows = await linesOf('bill', d.number);
    expect(net(rows, '1130')).toBe(50);
    expect(net(rows, '5103')).toBe(20);
    expect(net(rows, '1140')).toBe(10.5);
    expect(net(rows, '2101')).toBe(-80.5);
    await run();
    expect(await balance('1130')).toBeCloseTo(inv0 + 50, 2); // the receipt move itself posts nothing (no double count)
  });

  it('posts opening stock against opening balance equity', async () => {
    const wh = (await owner.get('/api/inventory/warehouses')).find((w: any) => w.kind === 'main');
    const eq0 = await balance('3301');
    const inv0 = await balance('1130');
    await owner.post('/api/inventory/opening-balances', { warehouseId: wh.id, openedOn: today, lines: [{ productId: S.p3.id, qty: '4', unitCostSar: '25' }] });
    await run();
    expect(await balance('1130')).toBeCloseTo(inv0 + 100, 2);
    expect(await balance('3301')).toBeCloseTo(eq0 - 100, 2);
  });
});

describe('Imports: customs declaration and landed cost', () => {
  it('posts import VAT and landed cost against customs payable, capitalising what is still on hand', async () => {
    const po = await owner.post('/api/inventory/purchase-orders', { supplierId: S.sup.id, currency: 'SAR', lines: [{ productId: S.p1.id, qty: 5, unitPrice: '100' }] });
    await owner.post(`/api/inventory/purchase-orders/${po.id}/submit`);
    await gm.post(`/api/inventory/purchase-orders/${po.id}/approve`, { acknowledgeCompliance: true });
    const seen = await owner.get(`/api/inventory/purchase-orders/${po.id}`);
    const sh = await owner.post('/api/inventory/shipments', { supplierId: S.sup.id, orderIds: [po.id], mode: 'land', blNumber: `BL-${stamp}`, etd: today, eta: today, broker: 'مخلص' });
    const dec = await owner.put(`/api/inventory/shipments/${sh.id}/declaration`, { fasahNumber: `FSH-${stamp}`, fasahDate: today, cifSar: '1000', dutyRatePercent: '5', customsPayablePartyId: S.broker.id });
    expect(dec).toMatchObject({ dutySar: '50.00', importVatSar: '157.50' });
    await owner.put(`/api/inventory/shipments/${sh.id}/charges`, { charges: [{ kind: 'clearance', amountSar: '100' }] });
    await owner.post(`/api/inventory/shipments/${sh.id}/status`, { status: 'clearing', force: true });
    await owner.post(`/api/inventory/purchase-orders/${po.id}/receipts`, { shipmentId: sh.id, receivedOn: today, lines: [{ orderLineId: seen.lines[0].id, qty: 5 }] });
    const lc = await owner.post(`/api/inventory/shipments/${sh.id}/landed-cost`, { basis: 'value' });
    expect(lc.chargeSar).toBe('150.00');
    await run();

    const vat = await linesOf('import_vat', sh.number);
    expect(net(vat, '1140')).toBe(157.5);
    expect(net(vat, '2104')).toBe(-157.5);
    expect(vat.find((r) => r.code === '1140')!.vat_code).toBe('IM');
    expect(vat.find((r) => r.code === '2104')!.party_id).toBe(S.broker.id);

    const landed = await linesOf('landed_cost', sh.number);
    expect(net(landed, '2104')).toBe(-150);
    expect(net(landed, '1130')).toBe(150); // all five units still on hand
    expect(net(landed, '5101')).toBe(0);
    const row = await db<any[]>((t) => t`select landed_capitalised_sar::text as c, landed_expensed_sar::text as e from import_shipment where id = ${sh.id}`);
    expect(row[0]).toEqual({ c: '150.00', e: '0.00' });
    await run();
    expect((await linesOf('import_vat', sh.number)).length).toBe(vat.length); // once
  });
});

describe('Payroll', () => {
  it('posts the approved payroll with employer GOSI and deduction categories, then the payment', async () => {
    const stampEmail = (n: string) => `pb-${n}-${stamp}@e2e.test`;
    const user = await invite(stampEmail('emp'), ['sales_rep']);
    void user;
    const users = await owner.get('/api/users');
    const uid = users.find((u: any) => u.email === stampEmail('emp')).id;
    const emp = await owner.post('/api/hr/employees', {
      hireDate: `${Number(today.slice(0, 4)) - 1}-01-01`, contractType: 'unlimited', employmentType: 'full_time', annualLeaveDays: 21, nationality: 'سعودي',
      nameAr: `موظف الترحيل ${stamp}`, jobTitleAr: 'مندوب', basicSalary: '6000', housingAllowance: '1500', transportAllowance: '600', userId: uid, department: 'المبيعات',
      iban: 'SA0380000000608010167519', bankName: 'الراجحي',
    });
    S.emp = emp;
    await hr.post(`/api/hr/employees/${emp.id}/adjustments`, { month, kind: 'deduction', amount: '200', reason: 'سلفة', category: 'advance' });
    await hr.post(`/api/hr/employees/${emp.id}/adjustments`, { month, kind: 'deduction', amount: '50', reason: 'جزاء تأخير', category: 'penalty' });
    await hr.post(`/api/hr/employees/${emp.id}/adjustments`, { month, kind: 'bonus', amount: '300', reason: 'حافز' });
    const r = await hr.post('/api/hr/payroll', { month });
    const line = r.lines.find((l: any) => l.employeeId === emp.id);
    expect(line).toMatchObject({ bonuses: '300.00', deductions: '250.00' });
    await gm.post(`/api/hr/payroll/${r.id}/approve`, { expectedNet: r.net });

    const rows = await linesOf('payroll', month);
    expect(rows.every((x) => x.kind === 'auto')).toBe(true);
    expect(rows.find((x) => x.code === '2120' && x.employee_id === emp.id)!.credit).toBe(line.net);
    expect(net(rows.filter((x) => x.employee_id === emp.id), '1120')).toBe(-200); // advance recovered
    expect(net(rows, '4201')).toBe(-50); // penalty → other income
    expect(net(rows, '6104')).toBeGreaterThanOrEqual(300);
    // employer GOSI share: every employee in the run, Saudi 11.75 % / other 2 % of basic + housing (cap 45,000)
    const people = (await hr.get('/api/hr/employees')).rows ?? (await hr.get('/api/hr/employees'));
    const expected = r.lines.reduce((s: number, l: any) => {
      const p = people.find((x: any) => x.id === l.employeeId);
      return s + employerGosi(toHalalas(l.basic) + toHalalas(l.housing), isSaudiNationality(p?.nationality), 11.75, 2);
    }, 0);
    expect(Math.round(net(rows, '6103') * 100)).toBe(expected);
    expect(await linesOf('payroll_paid', month)).toHaveLength(0);

    await gm.post(`/api/hr/payroll/${r.id}/paid`, { date: today, ref: 'WPS-PB' });
    const paid = await linesOf('payroll_paid', month);
    expect(net(paid, '1103')).toBe(-Number(r.net));
    expect(net(paid.filter((x) => x.employee_id === emp.id), '2120')).toBe(Number(line.net));
    await run();
    expect((await linesOf('payroll', month)).length).toBe(rows.length); // once
    S.run = r;
  });

  async function invite(email: string, roleKeys: string[]) {
    const users = await owner.get('/api/users');
    if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
    return signInOrUp(base, email);
  }
});

describe('Commissions', () => {
  it('accrues the change in payable commission: up, then a clawback', async () => {
    const [inv] = await db<any[]>((t) => t`select id, number from invoice_mirror where issue_date >= ${yearStart} and status not in ('legacy', 'cancelled') order by created_at limit 1`);
    expect(inv, 'an invoice dated after go-live exists from the earlier tests').toBeTruthy();
    const [row] = await db<any[]>((t) => t`insert into commission_entry (user_id, invoice_id, earned, payable, period, status) values (${S.emp.userId}, ${inv.id}, '200.00', '120.00', ${month}, 'payable') returning id`);
    await run();
    let rows = await linesOf('commission', inv.number);
    expect(net(rows, '6105')).toBe(120);
    expect(net(rows, '2122')).toBe(-120);
    await run();
    expect((await linesOf('commission', inv.number)).length).toBe(rows.length); // nothing new without a change
    await db((t) => t`update commission_entry set payable = '170.00' where id = ${row.id}`);
    await run();
    rows = await linesOf('commission', inv.number);
    expect(net(rows, '6105')).toBe(170);
    await db((t) => t`update commission_entry set payable = '100.00' where id = ${row.id}`);
    await run();
    rows = await linesOf('commission', inv.number);
    expect(net(rows, '6105')).toBe(100);
    expect(net(rows, '2122')).toBe(-100);
    expect(rows.find((r) => r.employee_id === S.emp.id)).toBeTruthy();
  });
});

describe('Reconciliation', () => {
  it('keeps the trial balance balanced and reports AP / inventory / GRNI against their documents', async () => {
    const checks = await acct.get('/api/accounting/reports/reconciliation');
    const by = Object.fromEntries(checks.map((c: any) => [c.key, c]));
    expect(by.trial_balance.ok).toBe(true);
    expect(Object.keys(by)).toEqual(expect.arrayContaining(['ar', 'ap', 'inventory', 'grni', 'suspense']));
    expect(by.ap.ledger).toBeDefined();
    expect(by.grni.source).toBeDefined();
    // the payable of the bills made here matches what is still owed on them
    const open = await db<any[]>((t) => t`select coalesce(sum(round((total - paid_amount) * rate_to_sar, 2)), 0)::text as s from supplier_bill where status in ('approved', 'partially_paid') and supplier_id = ${S.sup.id}`);
    const ap = await db<any[]>((t) => t`select coalesce(sum(l.credit - l.debit), 0)::text as s from journal_line l join journal_entry e on e.id = l.entry_id where e.status = 'posted' and l.party_id = ${S.sup.id} and l.account_id = ${S.accounts['2101'].id}`);
    expect(Number(ap[0].s)).toBeCloseTo(Number(open[0].s), 2);
  });

  it('shows the engine errors and warnings on the exceptions screen, and nothing posts twice', async () => {
    const ex = await acct.get('/api/accounting/posting/exceptions');
    expect(Array.isArray(ex.errors)).toBe(true);
    const before = await db<any[]>((t) => t`select count(*)::int as n from journal_entry`);
    await run();
    await run();
    const after = await db<any[]>((t) => t`select count(*)::int as n from journal_entry`);
    expect(after[0].n).toBe(before[0].n);
  });
});
