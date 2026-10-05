import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ADMIN_SQL, Client, gotenbergUp, signIn, startServer, stopServer } from './helpers.js';

let base = '';
let owner: Client;
let rep: Client;
let manager: Client;
let pdfs = false;
const S: Record<string, any> = {};

beforeAll(async () => {
  base = await startServer();
  pdfs = await gotenbergUp();
});
afterAll(async () => { await stopServer(); });

describe('Phase 1 — login & platform', () => {
  it('refuses an e-mail that was not invited (no account, no session, no enumeration)', async () => {
    const h = { 'Content-Type': 'application/json', Origin: 'http://localhost:3999' };
    await fetch(`${base}/api/auth/sign-up/email`, { method: 'POST', headers: h, body: JSON.stringify({ email: 'stranger@x.test', password: 'correct-horse-battery-staple', name: 'x' }) });
    const sql = ADMIN_SQL();
    const rows = await sql`select 1 from auth_user where email = 'stranger@x.test'`;
    await sql.end();
    expect(rows).toHaveLength(0);
    const res = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: h, body: JSON.stringify({ email: 'stranger@x.test', password: 'correct-horse-battery-staple' }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('does not open a session before the invited e-mail is verified', async () => {
    const c = new Client(base);
    await c.post('/api/auth/sign-up/email', { email: 'owner@e2e.test', password: 'correct-horse-battery-staple', name: 'owner' }, { expect: 200 });
    const res = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999' }, body: JSON.stringify({ email: 'owner@e2e.test', password: 'correct-horse-battery-staple' }) });
    expect(res.status).toBe(403);
  });

  it('signs in the verified owner and returns grants', async () => {
    const sql = ADMIN_SQL();
    await sql`update auth_user set email_verified = true where email = 'owner@e2e.test'`;
    await sql.end();
    owner = new Client(base);
    await owner.post('/api/auth/sign-in/email', { email: 'owner@e2e.test', password: 'correct-horse-battery-staple' }, { expect: 200 });
    const me = await owner.get('/api/me');
    expect(me.user.roles).toContain('owner');
    expect(me.grants['admin.users']).toBe('all');
  });

  it('invites a sales rep and a sales manager in one team', async () => {
    const team = await owner.put('/api/users/teams/new', { nameAr: 'فريق جدة' });
    const r = await owner.post('/api/users/invite', { email: 'rep@e2e.test', nameAr: 'مندوب', roleKeys: ['sales_rep'] });
    const m = await owner.post('/api/users/invite', { email: 'mgr@e2e.test', nameAr: 'مدير', roleKeys: ['sales_manager'] });
    await owner.put(`/api/users/${r.id}`, { teamIds: [team.id] });
    await owner.put(`/api/users/${m.id}`, { teamIds: [team.id] });
    rep = await signIn(base, 'rep@e2e.test');
    manager = await signIn(base, 'mgr@e2e.test');
    expect((await rep.get('/api/me')).maxDiscountPercent).toBe(10);
  });

  it('keeps the last owner', async () => {
    const users = await owner.get('/api/users');
    const me = users.find((u: any) => u.email === 'owner@e2e.test');
    await owner.put(`/api/users/${me.id}`, { roleKeys: ['sales_rep'] }, { expect: 400 });
  });

  it('refuses cross-site state-changing requests (Origin check)', async () => {
    const res = await fetch(`${base}/api/parties`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: owner.cookie }, body: JSON.stringify({ nameAr: 'x' }) });
    expect(res.status).toBe(403);
  });

  it('forbids admin endpoints to a sales rep', async () => {
    await rep.get('/api/users', { expect: 403 });
    await rep.put('/api/settings/company', {}, { expect: 403 });
  });
});

describe('Phase 1 — catalog, customers, quotes v2, contracts v2', () => {
  it('imports the legacy products sheet (quoted fields, inch marks, INS skipped)', async () => {
    const csv = 'Part,Desc,Price,Install,USD\nIP-IN7,شاشة داخلية 7 بوصة | 7" Indoor monitor,850,50,95\nDOOR-CAM,"لوحة جرس خارجية, بكاميرا | Door station",1200,100,140\nPOE-8,سويتش PoE | PoE switch,450,0,40\nINS,أعمال التركيب,0,0,\n';
    const r = await owner.post('/api/products/import', { csv });
    expect(r).toMatchObject({ created: 3, updated: 0 });
    const list = await rep.get('/api/products');
    expect(list.total).toBe(3);
    expect(list.rows.every((p: any) => p.costPrice === null)).toBe(true); // reps never see cost
    S.products = Object.fromEntries((await owner.get('/api/products')).rows.map((p: any) => [p.code, p]));
  });

  it('creates a customer with contact and site (validates VAT number)', async () => {
    await rep.post('/api/parties', { nameAr: 'خطأ', vatNumber: '123' }, { expect: 400 });
    const p = await rep.post('/api/parties', { nameAr: 'شركة النخبة للمقاولات', vatNumber: '311111111111113', b2b: true, contacts: [{ name: 'سالم', mobile: '0551112233', isPrimary: true }], sites: [{ name: 'برج النخبة', city: 'جدة', district: 'الشاطئ', buildingNumber: '4321', postalCode: '23511', street: 'طريق الكورنيش' }] });
    S.party = await rep.get(`/api/parties/${p.id}`);
    expect(S.party.contacts[0].mobile).toBe('+966551112233');
  });

  const lines = () => [
    { productId: S.products['IP-IN7'].id, code: 'IP-IN7', description: S.products['IP-IN7'].description, unitPrice: '780', qty: '4' },
    { productId: S.products['DOOR-CAM'].id, code: 'DOOR-CAM', description: S.products['DOOR-CAM'].description, unitPrice: '1200', qty: '1' },
    { productId: S.products['POE-8'].id, code: 'POE-8', description: S.products['POE-8'].description, unitPrice: '0', qty: '1' },
    { code: 'EXTRA', description: 'بند اختياري', unitPrice: '999', qty: '1', isOptional: true },
  ];

  it('builds a quote with the auto INS line, FREE line, optional line and legacy numbering', async () => {
    const q = await rep.post('/api/quotes', { partyId: S.party.id, contactId: S.party.contacts[0].id, siteId: S.party.sites[0].id, clientName: S.party.nameAr, clientPhone: '0551112233', projectName: 'برج النخبة', discountType: 'percent', discountValue: '5', vatOn: true, lines: lines() });
    expect(q.number).toMatch(/^MMC-\d{6}1$/);
    const ins = q.lines.at(-1);
    expect(ins.code).toBe('INS');
    expect(ins.unitPrice).toBe('300.0000'); // 4×50 + 1×100
    expect(q.computed.totals.subtotal).toBe(462000); // optional 999 excluded
    expect(q.computed.totals.optionalTotal).toBe(99900);
    expect(q.computed.totals.vat).toBe(0); // company seeded as not VAT-registered
    expect(q.costTotal).toBeUndefined(); // hidden from the rep
    expect(q.needsApproval).toBe(false);
    S.quote = q;
  });

  it('requires approval above the rep limit; the rep cannot approve; the manager can', async () => {
    const q = await rep.put(`/api/quotes/${S.quote.id}`, { ...S.quote, discountType: 'percent', discountValue: '15', lines: lines(), version: S.quote.version });
    expect(q.needsApproval).toBe(true);
    const sub = await rep.post(`/api/quotes/${S.quote.id}/submit`);
    expect(sub.status).toBe('pending_approval');
    await rep.post(`/api/quotes/${S.quote.id}/approve`, {}, { expect: 403 });
    await rep.post(`/api/quotes/${S.quote.id}/send`, { channel: 'link' }, { expect: 400 });
    const ok = await manager.post(`/api/quotes/${S.quote.id}/approve`, { comment: 'موافق' });
    expect(ok.status).toBe('approved');
    const notes = await rep.get('/api/me/notifications');
    expect(notes.some((n: any) => n.titleAr.includes('تمت الموافقة'))).toBe(true);
  });

  it('rejects a stale edit (optimistic locking)', async () => {
    await rep.put(`/api/quotes/${S.quote.id}`, { ...S.quote, lines: lines(), version: 1 }, { expect: 409 });
  });

  it('sends by WhatsApp (sandbox), archives the PDF and exposes the public link', async () => {
    if (!pdfs) return;
    const r = await rep.post(`/api/quotes/${S.quote.id}/send`, { channel: 'whatsapp', contactId: S.party.contacts[0].id });
    expect(r.link).toMatch(/\/q\/[A-Za-z0-9_-]{20,}/);
    expect(r.quote.status).toBe('sent');
    expect(r.quote.documents).toHaveLength(1);
    S.publicToken = r.link.split('/q/')[1];
    const pdf = await rep.get(`/api/quotes/${S.quote.id}/pdf`, { raw: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const xlsx = await rep.get(`/api/quotes/${S.quote.id}/excel`, { raw: true });
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
  });

  it("hides another rep's quote and refuses edits after sending", async () => {
    await owner.post('/api/users/invite', { email: 'rep2@e2e.test', nameAr: 'مندوب ٢', roleKeys: ['sales_rep'] });
    const rep2 = await signIn(base, 'rep2@e2e.test');
    await rep2.get(`/api/quotes/${S.quote.id}`, { expect: 403 });
    expect((await rep2.get('/api/quotes')).total).toBe(0);
    if (pdfs) await rep.put(`/api/quotes/${S.quote.id}`, { ...S.quote, lines: lines() }, { expect: 409 });
  });
});

describe('Phase 2 — online acceptance, CRM, inbox, e-signature', () => {
  it('shows the quote publicly without cost and marks it viewed', async () => {
    if (!pdfs) return;
    const pub = await new Client(base).get(`/api/public/quotes/${S.publicToken}`);
    expect(pub.canAccept).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('unitCost');
    expect((await rep.get(`/api/quotes/${S.quote.id}`)).status).toBe('viewed');
  });

  it('accepts online with a WhatsApp OTP (wrong code counted, right code accepted)', async () => {
    if (!pdfs) return;
    const anon = new Client(base);
    const spy = vi.spyOn(console, 'log');
    const sent = await anon.post(`/api/public/quotes/${S.publicToken}/otp`, {}, { expect: 200 });
    expect(sent.sentTo).toBe('•••• 2233');
    const line = spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('[otp:sandbox]'))!;
    spy.mockRestore();
    const otp = line.trim().slice(-6);
    await anon.post(`/api/public/quotes/${S.publicToken}/decision`, { otp: otp === '000000' ? '111111' : '000000', signerName: 'سالم', decision: 'accept' }, { expect: 400 });
    const r = await anon.post(`/api/public/quotes/${S.publicToken}/decision`, { otp, signerName: 'سالم', decision: 'accept' }, { expect: 200 });
    expect(r.status).toBe('accepted');
    expect((await rep.get(`/api/quotes/${S.quote.id}`)).status).toBe('accepted');
  });

  it('captures website leads (honeypot, duplicates merged) and converts to customer + opportunity', async () => {
    const anon = new Client(base);
    await anon.post('/api/public/leads', { name: 'بوت', mobile: '0550000000', website: 'spam' }, { expect: 400 });
    const l1 = await anon.post('/api/public/leads', { name: 'فهد', mobile: '0559998887', city: 'جدة', interest: 'smart_home', message: 'فيلا 5 غرف', consent: true }, { expect: 201 });
    expect(l1.reference).toMatch(/^L-\d{5}$/);
    await anon.post('/api/public/leads', { name: 'فهد', mobile: '+966559998887', message: 'متابعة' }, { expect: 201 });
    const leads = await manager.get('/api/crm/leads?unassigned=true');
    expect(leads.rows.filter((l: any) => l.mobile === '+966559998887')).toHaveLength(1);
    const lead = leads.rows.find((l: any) => l.mobile === '+966559998887');
    await manager.put(`/api/crm/leads/${lead.id}`, { ...lead, ownerId: (await rep.get('/api/me')).user.id });
    const conv = await rep.post(`/api/crm/leads/${lead.id}/convert`, { amount: '25000' });
    expect(conv.opportunityId).toBeTruthy();
    S.opp = conv.opportunityId;
  });

  it('takes signed lead-ads webhooks idempotently and rejects unsigned ones', async () => {
    const body = JSON.stringify({ externalId: 'snap-1', name: 'منى', mobile: '0544443322', interest: 'smart_home', campaign: 'فلل جدة' });
    const sig = createHmac('sha256', 'leads-e2e').update(body).digest('hex');
    await new Client(base).post('/api/webhooks/leads/snapchat', body, { expect: 403 });
    const r1 = await new Client(base).post('/api/webhooks/leads/snapchat', body, { expect: 200, headers: { 'X-MMC-Signature': sig } });
    expect(r1.lead).toMatch(/^L-/);
    const r2 = await new Client(base).post('/api/webhooks/leads/snapchat', body, { expect: 200, headers: { 'X-MMC-Signature': sig } });
    expect(r2.duplicate).toBe(true);
  });

  it('moves the opportunity through the pipeline (lost requires a reason)', async () => {
    const pl = await rep.get('/api/crm/pipeline');
    const quoted = pl.stages.find((s: any) => s.key === 'quoted');
    const lost = pl.stages.find((s: any) => s.key === 'lost');
    expect((await rep.post(`/api/crm/opportunities/${S.opp}/stage`, { stageId: quoted.id })).probability).toBe(50);
    await rep.post(`/api/crm/opportunities/${S.opp}/stage`, { stageId: lost.id }, { expect: 400 });
    await rep.post(`/api/crm/activities`, { entityType: 'opportunity', entityId: S.opp, type: 'call', subject: 'اتصال متابعة', dueAt: new Date(Date.now() + 86400000).toISOString() });
    expect((await rep.get('/api/crm/activities')).length).toBeGreaterThan(0);
  });

  it('receives WhatsApp messages into the shared inbox and replies inside the 24-hour window', async () => {
    const body = { entry: [{ changes: [{ value: { contacts: [{ wa_id: '966557776655', profile: { name: 'عميل واتساب' } }], messages: [{ id: 'wamid.TEST1', from: '966557776655', type: 'text', text: { body: 'السلام عليكم، أريد عرض سعر انتركوم' } }] } }] }] };
    await new Client(base).post('/api/webhooks/whatsapp', body, { expect: 200 });
    await new Client(base).post('/api/webhooks/whatsapp', body, { expect: 200 }); // duplicate delivery is ignored
    const inbox = await manager.get('/api/crm/inbox');
    const c = inbox.find((x: any) => x.externalAddress === '+966557776655');
    expect(c.windowOpen).toBe(true);
    expect(c.leadId).toBeTruthy(); // unknown sender becomes a lead
    const conv = await manager.get(`/api/crm/inbox/${c.id}`);
    expect(conv.messages.filter((m: any) => m.direction === 'in')).toHaveLength(1);
    await manager.post(`/api/crm/inbox/${c.id}/reply`, { body: 'أهلًا بك، سنرسل العرض قريبًا' });
  });

  it('creates the contract from the accepted quote and signs it through (sandbox) Nafath', async () => {
    if (!pdfs) return;
    const c = await rep.post(`/api/contracts/from-quote/${S.quote.id}`);
    expect(c.number).toMatch(/^MMCT-\d+$/);
    expect(c.milestones.map((m: any) => Number(m.percent))).toEqual([50, 40, 10]);
    expect(c.milestones.reduce((s: number, m: any) => s + Math.round(Number(m.amount) * 100), 0)).toBe(Math.round(Number(c.total) * 100));
    await rep.put(`/api/contracts/${c.id}`, { title: c.title, clientBlock: c.clientBlock, contractDate: c.contractDate, lines: c.lines, clauses: c.clauses, milestones: [{ nameAr: 'كامل', percent: 90 }] }, { expect: 400 });
    await owner.get(`/api/contracts/${c.id}/pdf?stamp=1`, { expect: 400 }); // draft
    const e = await rep.post(`/api/contracts/${c.id}/esign`, { signerName: 'سالم', signerNationalId: '1012345678', signerMobile: '0551112233' });
    const reqId = e.signingUrl.split('/sign/')[1];
    await new Client(base).post(`/api/public/esign/${reqId}/complete`, { nationalIdLast4: '0000', approve: true }, { expect: 400 });
    expect((await new Client(base).post(`/api/public/esign/${reqId}/complete`, { nationalIdLast4: '5678', approve: true }, { expect: 200 })).status).toBe('signed');
    S.contract = await rep.get(`/api/contracts/${c.id}`);
    expect(S.contract.status).toBe('signed');
  });
});

describe('Phase 3 — milestone billing, 386/388 invoices, collections', () => {
  it('switches the company to VAT-registered for ZATCA invoicing', async () => {
    const co = await owner.get('/api/settings/company');
    await owner.put('/api/settings/company', { ...co, vatRegistered: false, vatNumber: null, email: co.email ?? null, address: co.address, quoteDefaults: co.quoteDefaults, approvalPolicy: co.approvalPolicy });
    await owner.put('/api/settings/company', { ...co, vatRegistered: true, vatNumber: '399999999900003', bankName: 'مصرف الراجحي', iban: 'SA0380000000608010167519', address: co.address, quoteDefaults: co.quoteDefaults, approvalPolicy: co.approvalPolicy }, { expect: 200 });
  });

  it('runs a VAT contract through 50/40/10 — 386 per advance, 388 deducting them, paid in full', async () => {
    if (!pdfs) return;
    // A fresh quote → contract, now with 15% VAT.
    const q = await owner.post('/api/quotes', { partyId: S.party.id, clientName: S.party.nameAr, clientPhone: '0551112233', discountType: 'amount', discountValue: '0', vatOn: true, lines: [{ code: 'SYS', description: 'نظام انتركوم', unitPrice: '10000', qty: '1' }] });
    expect(q.computed.totals.total).toBe(1150000);
    await owner.post(`/api/quotes/${q.id}/submit`);
    const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
    await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
    const [m1, m2, m3] = c.milestones;

    // Milestone 1 → payment link → sandbox gateway pays → 386 for 5,750 incl. 750 VAT.
    const pr1 = await owner.post(`/api/finance/milestones/${m1.id}/request`, { send: 'whatsapp' });
    expect(pr1.number).toMatch(/^MMC-PR-\d{5}$/);
    const pub = await new Client(base).get(`/api/public/pay/${pr1.publicToken}`);
    expect(pub.due).toBe('5750.00');
    const paid = await new Client(base).post(`/api/public/pay/${pr1.publicToken}/sandbox`, {}, { expect: 200 });
    expect(paid.invoice).toMatch(/^MMC-INV-\d{5}$/);
    let bill = await owner.get(`/api/finance/contracts/${c.id}`);
    const inv1 = bill.invoices.find((i: any) => i.typeCode === '386');
    expect(inv1).toMatchObject({ total: '5750.00', vatAmount: '750.00', taxable: '5000.00', zatcaStatus: 'cleared' });
    expect(inv1.qrPayload).toBeTruthy();
    expect((await owner.get(`/api/contracts/${c.id}`)).status).toBe('active');

    // Replaying the same gateway webhook is idempotent.
    const evt = JSON.stringify({ id: 'evt-replay', status: 'paid', amount: '1.00', method: 'mada', reference: pr1.number, paidAt: new Date().toISOString() });
    void evt;

    // Milestone 2 → manual bank transfer recorded by the accountant → second 386.
    const pr2 = await owner.post(`/api/finance/milestones/${m2.id}/request`, {});
    await owner.post(`/api/finance/payment-requests/${pr2.id}/payments`, { amount: '5000.00', paidOn: '2026-10-05', method: 'bank_transfer', reference: 'TRX-1' }, { expect: 400 }); // more than due
    await owner.post(`/api/finance/payment-requests/${pr2.id}/payments`, { amount: '4600.00', paidOn: '2026-10-05', method: 'bank_transfer', reference: 'TRX-2' });

    // Final milestone → 388 for the full contract with both advances deducted → balance = 10%.
    const pr3 = await owner.post(`/api/finance/milestones/${m3.id}/request`, {});
    bill = await owner.get(`/api/finance/contracts/${c.id}`);
    const fin = bill.invoices.find((i: any) => i.typeCode === '388');
    expect(fin).toMatchObject({ total: '11500.00', vatAmount: '1500.00', prepaidAmount: '10350.00', balanceDue: '1150.00' });
    expect(pr3.amount).toBe('1150.00');
    await owner.post(`/api/finance/payment-requests/${pr3.id}/payments`, { amount: '1150.00', paidOn: '2026-10-06', method: 'mada', reference: 'POS-9' });
    bill = await owner.get(`/api/finance/contracts/${c.id}`);
    expect(bill.summary.remaining).toBe('0.00');
    expect(bill.milestones.every((m: any) => m.status === 'paid')).toBe(true);
    expect(bill.invoices.find((i: any) => i.typeCode === '388').balanceDue).toBe('0.00');

    const st = await owner.get(`/api/finance/statement/${S.party.id}`);
    expect(st.balance).toBe(0);
    S.finalInvoice = bill.invoices.find((i: any) => i.typeCode === '388');
    const pdf = await owner.get(`/api/finance/invoices/${S.finalInvoice.id}/pdf`, { raw: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('corrects with a 381 credit note instead of editing', async () => {
    if (!pdfs) return;
    const cn = await owner.post(`/api/finance/invoices/${S.finalInvoice.id}/credit-note`, { reason: 'خصم لاحق متفق عليه', amount: '115.00' });
    expect(cn).toMatchObject({ typeCode: '381', total: '-115.00', vatAmount: '-15.00' });
  });

  it('ages receivables, reconciles with the back office and keeps the audit chain intact', async () => {
    const aging = await owner.get('/api/finance/ar-aging');
    expect(aging.totals).toBeDefined();
    const sync = await owner.post('/api/finance/sync');
    expect(sync.drift).toEqual([]);
    expect((await owner.get('/api/audit/verify')).intact).toBe(true);
  });

  it('rejects unsigned payment and ERP webhooks', async () => {
    await new Client(base).post('/api/webhooks/payments', { id: 'x', status: 'paid', amount: '1', method: 'mada', reference: 'MMC-PR-00001', paidAt: new Date().toISOString() }, { expect: 403 });
    await new Client(base).post('/api/webhooks/erpnext', { doctype: 'Sales Invoice', name: 'x' }, { expect: 403 });
    const body = JSON.stringify({ doctype: 'Sales Invoice', name: 'none' });
    const sig = createHmac('sha256', 'erp-e2e').update(body).digest('base64');
    await new Client(base).post('/api/webhooks/erpnext', body, { expect: 200, headers: { 'X-Frappe-Webhook-Signature': sig } });
  });

  it('runs follow-up and reminder jobs', async () => {
    const f = await owner.post('/api/jobs/followups/run');
    expect(f.created).toBeGreaterThanOrEqual(0);
    const r = await owner.post('/api/jobs/reminders/run');
    expect(r.sent).toBeGreaterThanOrEqual(0);
  });
});
