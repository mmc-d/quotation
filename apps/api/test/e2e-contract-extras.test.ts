import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextBusinessDay, quotePrefix, riyadhDate } from '@mmc/domain';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Contract extras: template sets, change orders (deltas, approval, billing → separate 388 / 381),
 * and the company calendar (working days, holidays, business-day due dates).
 *
 * The file is order-independent from e2e.test.ts: it restores the company's VAT mode and gives back
 * the daily quote numbers it used, because that suite asserts the first quote number of the day.
 */
let base = '';
let owner: Client;
let gm: Client;
let acct: Client;
let rep: Client;
let company0: any;
const S: Record<string, any> = {};
const myQuotes: string[] = [];
const today = riyadhDate();
const year = Number(today.slice(0, 4));

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

async function setVat(registered: boolean) {
  const co = await owner.get('/api/settings/company');
  const body = registered
    ? { ...co, vatRegistered: true, vatNumber: '399999999900003', bankName: co.bankName ?? 'مصرف الراجحي', iban: co.iban ?? 'SA0380000000608010167519', email: co.email ?? null }
    : { ...co, vatRegistered: false, vatNumber: null, email: co.email ?? null };
  await owner.put('/api/settings/company', body);
}

async function signedReadyQuote(lines: any[], partyId: string) {
  const q = await owner.post('/api/quotes', { partyId, clientName: 'عميل الإضافات', clientPhone: '0551234567', discountType: 'amount', discountValue: '0', vatOn: true, lines });
  myQuotes.push(q.id);
  const sub = await owner.post(`/api/quotes/${q.id}/submit`);
  expect(sub.status).toBe('approved');
  return q;
}

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  company0 = await owner.get('/api/settings/company');
  const invite = async (email: string, roleKeys: string[]) => {
    const users = await owner.get('/api/users');
    if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
    return signInOrUp(base, email);
  };
  gm = await invite('cx-gm@e2e.test', ['general_manager']);
  acct = await invite('cx-acct@e2e.test', ['accountant']);
  rep = await invite('cx-rep@e2e.test', ['sales_rep']);
  // Payment terms that land "today + terms" on a Friday (due-date test below).
  let n = 0;
  while (weekday(addDays(today, n)) !== 5) n++;
  S.terms = n;
  S.party = await owner.post('/api/parties', { nameAr: 'مؤسسة الإضافات التجريبية', paymentTermsDays: n, contacts: [{ name: 'خالد', mobile: '0559876543', isPrimary: true }] });
});

afterAll(async () => {
  try {
    if (company0) await owner.put('/api/settings/company', { ...company0, email: company0.email ?? null });
    if (myQuotes.length) {
      // Give the day's quote sequence back (e2e.test.ts expects its first quote to be …1).
      const sql = ADMIN_SQL();
      const prefix = quotePrefix();
      await sql`update quote set number = 'CX-' || number where id in ${sql(myQuotes)} and number like ${`${prefix}%`}`;
      await sql`update numbering_counter nc set last_value = coalesce((select max(substring(q.number from ${prefix.length + 1}::int)::int) from quote q where q.number like ${`${prefix}%`}), 0)
        from numbering_series s where s.id = nc.series_id and s.document_type = 'quote' and nc.period_key = ${today}`;
      await sql.end();
    }
  } finally {
    await stopServer();
  }
});

describe('Contract template sets', () => {
  it('seeds and filters clause libraries per template set', async () => {
    const supply = await owner.get('/api/settings/clauses?templateSet=supply_only');
    const maint = await owner.get('/api/settings/clauses?templateSet=maintenance');
    const install = await owner.get('/api/settings/clauses?templateSet=supply_install');
    expect(supply.length).toBeGreaterThanOrEqual(8);
    expect(supply.every((c: any) => c.templateSet === 'supply_only')).toBe(true);
    expect(supply.some((c: any) => c.key === 'acceptance')).toBe(true);
    expect(supply.find((c: any) => c.key === 'scope').bodyAr).toContain('لا يشمل أعمال التركيب');
    expect(maint.some((c: any) => c.key === 'response')).toBe(true);
    expect(maint.find((c: any) => c.key === 'duration').bodyAr).toContain('(12)');
    expect(install.some((c: any) => c.key === 'warranty')).toBe(true);
    expect((await owner.get('/api/settings/clauses')).length).toBe(supply.length + maint.length + install.length);
    await owner.get('/api/settings/clauses?templateSet=nope', { expect: 400 });
    S.supplyClauses = supply.filter((c: any) => c.active);
    S.maintClauses = maint.filter((c: any) => c.active);
  });

  it('creates a supply-only contract from a quote and re-applies another set while draft', async () => {
    const q = await signedReadyQuote([{ code: 'IP-IN7', description: 'شاشة داخلية', unitPrice: '850', qty: '2' }], S.party.id);
    const c = await owner.post(`/api/contracts/from-quote/${q.id}`, { templateSet: 'supply_only' });
    expect(c).toMatchObject({ templateSet: 'supply_only', title: 'عقد توريد', status: 'draft' });
    expect(c.clauses.map((x: any) => x.templateId)).toEqual(S.supplyClauses.map((x: any) => x.id));
    expect(c.milestones.map((m: any) => Number(m.percent))).toEqual([50, 50]);
    // the quote now links to its contract (the editor shows it instead of «إنشاء عقد»)
    expect((await owner.get(`/api/quotes/${q.id}`)).contract).toMatchObject({ id: c.id, number: c.number });
    // Change orders only apply after signing.
    await owner.post('/api/change-orders', { contractId: c.id, description: 'x', lines: [{ code: 'A', description: 'a', qty: 1, unitPrice: '1' }] }, { expect: 400 });

    const m = await owner.post(`/api/contracts/${c.id}/template`, { templateSet: 'maintenance' });
    expect(m).toMatchObject({ templateSet: 'maintenance', title: 'عقد صيانة سنوي', deliveryDaysMin: null });
    expect(m.clauses.map((x: any) => x.templateId)).toEqual(S.maintClauses.map((x: any) => x.id));
    expect(m.milestones.map((x: any) => Number(x.percent))).toEqual([25, 25, 25, 25]);
    expect(m.version).toBe(c.version + 1);
    await owner.post(`/api/contracts/${c.id}/template`, { templateSet: 'bogus' }, { expect: 400 });

    const back = await owner.post(`/api/contracts/${c.id}/template`, { templateSet: 'supply_only' });
    expect(back.clauses.length).toBe(S.supplyClauses.length);
    await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
    await owner.post(`/api/contracts/${c.id}/template`, { templateSet: 'maintenance' }, { expect: 409 });
    S.supplyContract = c;
  });

  it('keeps clause edits inside their template set', async () => {
    const created = await owner.put('/api/settings/clauses/new', { key: 'cx_extra', category: 'other', titleAr: 'بند إضافي', bodyAr: 'نص', templateSet: 'maintenance', active: false, sort: 99 });
    expect(created.templateSet).toBe('maintenance');
    await owner.put('/api/settings/clauses/new', { key: 'cx_extra', category: 'other', titleAr: 'مكرر', bodyAr: 'نص', templateSet: 'maintenance' }, { expect: 409 });
    const edited = await owner.put(`/api/settings/clauses/${created.id}`, { key: 'cx_extra', category: 'other', titleAr: 'بند إضافي', bodyAr: 'نص معدل', active: false, sort: 99 });
    expect(edited).toMatchObject({ templateSet: 'maintenance', clauseVersion: 2 });
  });
});

describe('Company calendar', () => {
  it('returns working days and seeded fixed holidays; admins manage holidays', async () => {
    const cal = await rep.get('/api/calendar');
    expect(cal.workingDays).toEqual([0, 1, 2, 3, 4]);
    const dates = cal.holidays.map((h: any) => h.date);
    expect(dates).toContain(`${year}-09-23`);
    expect(dates).toContain(`${year + 1}-02-22`);
    await rep.put('/api/calendar/working-days', { workingDays: [0, 1, 2, 3, 4] }, { expect: 403 });
    await owner.put('/api/calendar/working-days', { workingDays: [] }, { expect: 400 });
    expect((await owner.put('/api/calendar/working-days', { workingDays: [4, 0, 1, 2, 3, 3] })).workingDays).toEqual([0, 1, 2, 3, 4]);

    const first = await owner.post('/api/calendar/holidays/seed-fixed', { year: year + 3 });
    expect(first.added).toEqual([`${year + 3}-02-22`, `${year + 3}-09-23`]);
    expect((await owner.post('/api/calendar/holidays/seed-fixed', { year: year + 3 })).added).toEqual([]);

    const h = await owner.put('/api/calendar/holidays/new', { date: `${year + 1}-03-20`, nameAr: 'عيد الفطر', nameEn: 'Eid al-Fitr' });
    await owner.put('/api/calendar/holidays/new', { date: `${year + 1}-03-20`, nameAr: 'مكرر' }, { expect: 409 });
    expect((await owner.put(`/api/calendar/holidays/${h.id}`, { date: `${year + 1}-03-21`, nameAr: 'عيد الفطر المبارك' })).date).toBe(`${year + 1}-03-21`);
    await owner.req('DELETE', `/api/calendar/holidays/${h.id}`);
    await owner.req('DELETE', `/api/calendar/holidays/${h.id}`, undefined, { expect: 404 });
  });
});

describe('Change orders', () => {
  it('builds a VAT contract (default supply & install set) and signs it', async () => {
    await setVat(true);
    const q = await signedReadyQuote([{ code: 'SYS', description: 'نظام انتركوم', unitPrice: '10000', qty: '1' }], S.party.id);
    const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
    expect(c).toMatchObject({ templateSet: 'supply_install', title: 'عقد توريد وتركيب', total: '11500.00' });
    expect(c.milestones.map((m: any) => Number(m.percent))).toEqual([50, 40, 10]);
    await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
    S.contract = c;
  });

  it('numbers change orders and computes signed deltas with 15% VAT', async () => {
    const co1 = await owner.post('/api/change-orders', {
      contractId: S.contract.id, description: 'إضافة كاميرات وإزالة سويتش', reason: 'طلب العميل',
      lines: [{ code: 'CAM', description: 'كاميرا إضافية', qty: 2, unitPrice: '500' }, { code: 'POE', description: 'إزالة سويتش', qty: '-1', unitPrice: '200' }],
    });
    expect(co1.number).toMatch(/^MMC-CO-\d{4}$/);
    expect(co1).toMatchObject({ status: 'draft', subtotalDelta: '800.00', vatDelta: '120.00', amountDelta: '920.00' });
    const co2 = await gm.post('/api/change-orders', { contractId: S.contract.id, description: 'توسعة', lines: [{ code: 'MON', description: 'شاشة', qty: 1, unitPrice: '300' }] });
    expect(Number(co2.number.slice(-4))).toBe(Number(co1.number.slice(-4)) + 1);
    await owner.post('/api/change-orders', { contractId: S.contract.id, description: 'صفر', lines: [{ code: 'X', description: 'x', qty: 0, unitPrice: '1' }] }, { expect: 400 });
    // Editing a draft recomputes.
    const ed = await gm.put(`/api/change-orders/${co2.id}`, { description: 'توسعة', lines: [{ code: 'MON', description: 'شاشة', qty: 2, unitPrice: '300' }], version: co2.version });
    expect(ed.amountDelta).toBe('690.00');
    const list = await owner.get(`/api/change-orders?contractId=${S.contract.id}`);
    expect(list.rows.length).toBe(2);
    S.co1 = co1;
    S.co2 = ed;
  });

  it('enforces the approval rules (approver ≠ creator unless owner; needs contract.sign or quote.approve)', async () => {
    await owner.post(`/api/change-orders/${S.co1.id}/approve`, {}, { expect: 400 }); // still draft
    await owner.post(`/api/change-orders/${S.co1.id}/submit`);
    await rep.post(`/api/change-orders/${S.co1.id}/approve`, {}, { expect: 403 });
    await acct.post(`/api/change-orders/${S.co1.id}/approve`, {}, { expect: 403 });
    await owner.put(`/api/change-orders/${S.co1.id}`, { description: 'x', lines: [{ code: 'A', description: 'a', qty: 1, unitPrice: '1' }] }, { expect: 409 });
    const ok = await gm.post(`/api/change-orders/${S.co1.id}/approve`, { comment: 'موافق' });
    expect(ok.status).toBe('approved');
    expect(ok.approvedByName).toBeTruthy();

    await gm.post(`/api/change-orders/${S.co2.id}/submit`);
    await gm.post(`/api/change-orders/${S.co2.id}/approve`, {}, { expect: 403 }); // own change order
    const rej = await owner.post(`/api/change-orders/${S.co2.id}/reject`, { reason: 'السعر غير متفق عليه' });
    expect(rej.status).toBe('rejected');
    const redo = await gm.put(`/api/change-orders/${S.co2.id}`, { description: 'توسعة', lines: [{ code: 'MON', description: 'شاشة', qty: 1, unitPrice: '300' }] });
    expect(redo.status).toBe('draft');
    expect((await gm.post(`/api/change-orders/${S.co2.id}/cancel`, { reason: 'أُلغي' })).status).toBe('cancelled');
  });

  it('bills a positive change order: own milestone + payment request, contract schedule untouched', async () => {
    await rep.post(`/api/change-orders/${S.co1.id}/bill`, {}, { expect: 403 });
    const r = await owner.post(`/api/change-orders/${S.co1.id}/bill`, {});
    expect(r.paymentRequest.amount).toBe('920.00');
    expect(r.changeOrder.status).toBe('billed');
    expect(r.changeOrder.milestone).toMatchObject({ trigger: 'change_order', amount: '920.00', nameAr: `أمر تغيير ${S.co1.number}` });
    await owner.post(`/api/change-orders/${S.co1.id}/bill`, {}, { expect: 400 }); // already billed
    const bill = await owner.get(`/api/finance/contracts/${S.contract.id}`);
    expect(bill.milestones.length).toBe(3);
    expect(bill.changeOrderMilestones).toHaveLength(1);
    expect(bill.changeOrderMilestones[0].changeOrder).toBe(S.co1.number);
    expect(bill.summary).toMatchObject({ total: '11500.00', adjustedTotal: '12420.00' });
    expect(bill.changeOrders.approvedTotal).toBe('920.00');
    expect((await owner.get(`/api/contracts/${S.contract.id}`)).milestones).toHaveLength(3);
    S.coPr = r.paymentRequest;
  });

  it('invoices the change-order payment as a separate 388 for its lines', async () => {
    const paid = await acct.post(`/api/finance/payment-requests/${S.coPr.id}/payments`, { amount: '920.00', paidOn: today, method: 'bank_transfer', reference: 'CX-CO-1' });
    expect(paid.invoice).toBeNull(); // no 386
    expect(paid.changeOrderInvoice).toMatchObject({ typeCode: '388', total: '920.00', vatAmount: '120.00', taxable: '800.00' });
    const bill = await owner.get(`/api/finance/contracts/${S.contract.id}`);
    const coInv = bill.invoices.find((i: any) => i.typeCode === '388');
    expect(coInv.milestoneId).toBe(bill.changeOrderMilestones[0].id);
    expect(coInv.lines.map((l: any) => l.code)).toEqual(['CAM']);
    expect(coInv.balanceDue).toBe('0.00');
    expect(bill.invoices.some((i: any) => i.typeCode === '386')).toBe(false);
    expect(bill.milestones.every((m: any) => m.status === 'pending')).toBe(true);
    expect(bill.changeOrders.paid).toBe('920.00');
    expect(bill.summary.paid).toBe('0.00'); // contract collections exclude change orders
    expect((await owner.get(`/api/contracts/${S.contract.id}`)).status).toBe('signed');
  });

  it("defaults a payment request's due date to the next business day after the customer's terms", async () => {
    const friday = addDays(today, S.terms);
    const sunday = addDays(friday, 2);
    const cal0 = await owner.get('/api/calendar');
    const had = cal0.holidays.find((h: any) => h.date === sunday);
    const hol = had ?? (await owner.put('/api/calendar/holidays/new', { date: sunday, nameAr: 'عطلة اختبار' }));
    const cal = await owner.get('/api/calendar');
    const expected = nextBusinessDay(friday, { workingDays: cal.workingDays, holidays: cal.holidays.map((h: any) => h.date) });
    expect(expected > sunday).toBe(true);
    const pr1 = await owner.post(`/api/finance/milestones/${S.contract.milestones[0].id}/request`, {});
    expect(pr1.dueDate).toBe(expected);
    expect([5, 6]).not.toContain(weekday(pr1.dueDate));
    if (!had) await owner.req('DELETE', `/api/calendar/holidays/${hol.id}`);
    S.pr1 = pr1;
  });

  it('runs 50/40/10 — negative change order credits the latest 386, final 388 excludes change orders', async () => {
    await acct.post(`/api/finance/payment-requests/${S.pr1.id}/payments`, { amount: '5750.00', paidOn: today, method: 'bank_transfer', reference: 'CX-1' });
    const pr2 = await owner.post(`/api/finance/milestones/${S.contract.milestones[1].id}/request`, { dueDate: today });
    expect(pr2.dueDate).toBe(today);
    await acct.post(`/api/finance/payment-requests/${pr2.id}/payments`, { amount: '4600.00', paidOn: today, method: 'bank_transfer', reference: 'CX-2' });
    let bill = await owner.get(`/api/finance/contracts/${S.contract.id}`);
    const adv = bill.invoices.filter((i: any) => i.typeCode === '386');
    expect(adv).toHaveLength(2);

    // Negative change order (owner may approve their own) before the final invoice → 381 on the latest 386.
    const neg = await owner.post('/api/change-orders', { contractId: S.contract.id, description: 'إلغاء بند', lines: [{ code: 'POE-X', description: 'إزالة ملحق', qty: -1, unitPrice: '100' }] });
    expect(neg).toMatchObject({ subtotalDelta: '-100.00', vatDelta: '-15.00', amountDelta: '-115.00' });
    await owner.post(`/api/change-orders/${neg.id}/submit`);
    await owner.post(`/api/change-orders/${neg.id}/approve`, {});
    const credited = await owner.post(`/api/change-orders/${neg.id}/bill`, {});
    expect(credited.paymentRequest).toBeNull();
    expect(credited.invoice).toMatchObject({ typeCode: '381', total: '-115.00', vatAmount: '-15.00' });
    const latest386 = adv.sort((a: any, b: any) => (a.number < b.number ? 1 : -1))[0];
    expect(credited.invoice.originalInvoiceId).toBe(latest386.id);
    expect(credited.changeOrder.status).toBe('billed');

    // Final milestone → 388 for the original contract only, deducting the two 386s; the request nets the 381.
    const pr3 = await owner.post(`/api/finance/milestones/${S.contract.milestones[2].id}/request`, {});
    bill = await owner.get(`/api/finance/contracts/${S.contract.id}`);
    const finals = bill.invoices.filter((i: any) => i.typeCode === '388' && !i.milestoneId);
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ total: '11500.00', vatAmount: '1500.00', prepaidAmount: '10350.00', balanceDue: '1150.00' });
    expect(finals[0].lines.map((l: any) => l.code)).toEqual(['SYS']);
    expect(pr3.amount).toBe('1035.00'); // 388 balance 1150 − credit 115 on the 386
    expect(bill.invoices.filter((i: any) => i.typeCode === '388')).toHaveLength(2);
    await acct.post(`/api/finance/payment-requests/${pr3.id}/payments`, { amount: '1035.00', paidOn: today, method: 'mada', reference: 'CX-3' });
    bill = await owner.get(`/api/finance/contracts/${S.contract.id}`);
    expect(bill.summary).toMatchObject({ credited: '115.00', remaining: '0.00' });
    expect(bill.milestones.every((m: any) => m.status === 'paid')).toBe(true);
    expect(bill.summary.adjustedTotal).toBe('12305.00'); // 11500 + 920 − 115
    S.final = finals[0];
  });

  it('records client acceptance, then credits a negative change order against the final 388', async () => {
    const neg = await owner.post('/api/change-orders', { contractId: S.contract.id, description: 'تخفيض كاميرا', lines: [{ code: 'CAM', description: 'إزالة كاميرا', qty: -1, unitPrice: '500' }] });
    await owner.post(`/api/change-orders/${neg.id}/submit`);
    await owner.post(`/api/change-orders/${neg.id}/sign`, {}, { expect: 400 }); // not approved yet
    await gm.post(`/api/change-orders/${neg.id}/approve`, {});
    const signed = await owner.post(`/api/change-orders/${neg.id}/sign`, { signedOn: today });
    expect(signed.status).toBe('signed');
    expect(signed.signedAt).toBeTruthy();
    const r = await owner.post(`/api/change-orders/${neg.id}/bill`, {});
    expect(r.invoice).toMatchObject({ typeCode: '381', total: '-575.00', vatAmount: '-75.00', originalInvoiceId: S.final.id });
    // The final 388 is still the only contract-level final invoice and was not changed.
    const fin = await owner.post(`/api/finance/contracts/${S.contract.id}/final-invoice`);
    expect(fin.id).toBe(S.final.id);
  });

  it('refuses to credit a reduction before anything is invoiced', async () => {
    const neg = await owner.post('/api/change-orders', { contractId: S.supplyContract.id, description: 'تخفيض', lines: [{ code: 'IP-IN7', description: 'إزالة شاشة', qty: -1, unitPrice: '850' }] });
    await owner.post(`/api/change-orders/${neg.id}/submit`);
    await owner.post(`/api/change-orders/${neg.id}/approve`, {});
    await owner.post(`/api/change-orders/${neg.id}/bill`, {}, { expect: 400 });
  });

  it('computes deltas without VAT when the company is not VAT-registered', async () => {
    await setVat(false);
    const co = await owner.post('/api/change-orders', { contractId: S.contract.id, description: 'بدون ضريبة', lines: [{ code: 'MON', description: 'شاشة', qty: 3, unitPrice: '333.335' }] });
    expect(co).toMatchObject({ subtotalDelta: '1000.01', vatDelta: '0.00', amountDelta: '1000.01' });
    const log = await owner.get('/api/audit/verify');
    expect(log.intact).toBe(true);
  });
});
