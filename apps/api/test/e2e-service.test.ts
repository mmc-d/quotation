import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_WORKING_DAYS, renewalPrice, riyadhDate, slaTargets, toHalalas } from '@mmc/domain';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Phase 7b — service agreements (AMC), SLAs, CSAT and the customer portal: agreement lifecycle
 * (visits + payment requests incl./excl. VAT, 388 per period on payment), AMC coverage on tickets,
 * business-hour SLA targets + escalation job, preventive work-order job, renewal reminders and
 * uplift, the one-tap CSAT link, and the portal (WhatsApp-code login, cookie isolation from staff
 * sessions, party-bound data without cost fields, approvals, portal tickets with SLA).
 */
let base = '';
let owner: Client;
const S: Record<string, any> = {};
const today = riyadhDate();
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PORTAL_PHONE = '0557770001';
let companyBefore: { vat_registered: boolean; vat_number: string | null } | null = null;
const portalJson: unknown[] = [];

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const yearEnd = (start: string) => { const d = new Date(`${start}T12:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const sumH = (rows: { amount: string }[]) => rows.reduce((s, r) => s + toHalalas(r.amount), 0);

async function sqlRun<T = any>(fn: (sql: ReturnType<typeof ADMIN_SQL>) => Promise<T>): Promise<T> {
  const sql = ADMIN_SQL();
  try { return await fn(sql); } finally { await sql.end(); }
}

/** Raw request with an explicit cookie (portal cookie, staff cookie or none). */
async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; expect?: number } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  if (opts.expect !== undefined && res.status !== opts.expect) throw new Error(`${method} ${path} → ${res.status} (expected ${opts.expect}): ${text.slice(0, 400)}`);
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  return { status: res.status, json, headers: res.headers };
}

async function portal(method: string, path: string, body?: unknown, expect = 200) {
  const r = await call(method, `/api/portal${path}`, { cookie: S.portalCookie, body, expect });
  portalJson.push(r.json);
  return r.json;
}

function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}

async function lastCode(phone: string): Promise<string> {
  const rows = await sqlRun((sql) => sql`select body from message where template_key = 'portal_otp' and "to" = ${phone} order by created_at desc limit 1`);
  const m = /(\d{6})/.exec(rows[0]?.body ?? '');
  if (!m) throw new Error('no OTP message');
  return m[1]!;
}

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const tech = await owner.post('/api/users/invite', { email: 'svc-tech@e2e.test', nameAr: 'فني الصيانة', roleKeys: ['technician'] });
  S.tech = tech.id;
  [companyBefore] = await sqlRun((sql) => sql`select vat_registered, vat_number from company limit 1`);
  await sqlRun((sql) => sql`update company set vat_registered = true, vat_number = coalesce(vat_number, '399999999900003')`);
  const a = await owner.post('/api/parties', {
    nameAr: 'مجمع الصيانة السنوية', phone: '0557770009',
    contacts: [{ name: 'أبو سالم', mobile: PORTAL_PHONE, isPrimary: true }],
    sites: [{ type: 'project', name: 'مجمع الياسمين', city: 'الرياض' }],
  });
  const b = await owner.post('/api/parties', {
    nameAr: 'عميل آخر للبوابة', phone: '0557770010',
    contacts: [{ name: 'عميل ب', mobile: '0557770011', isPrimary: true }],
    sites: [{ type: 'project', name: 'برج ب', city: 'جدة' }],
  });
  S.partyA = a;
  S.partyB = b;
  S.siteA = (await owner.get(`/api/parties/${a.id}`)).sites[0];
  S.siteB = (await owner.get(`/api/parties/${b.id}`)).sites[0];
  S.assetA = await owner.post('/api/field/assets', { code: 'AMC-DP', serial: 'AMC-SN-1', siteId: S.siteA.id, installedOn: addDays(today, -800) });
  S.assetB1 = await owner.post('/api/field/assets', { code: 'AMC-DP', serial: 'AMC-SN-B1', siteId: S.siteB.id });
  S.assetB2 = await owner.post('/api/field/assets', { code: 'AMC-DP', serial: 'AMC-SN-B2', siteId: S.siteB.id });
});

afterAll(async () => {
  try {
    if (companyBefore) await sqlRun((sql) => sql`update company set vat_registered = ${companyBefore!.vat_registered}, vat_number = ${companyBefore!.vat_number}`);
  } finally {
    await stopServer();
  }
});

describe('service agreements (FSM-61..65)', () => {
  it('creates a draft with tier defaults and a billing preview', async () => {
    const ag = await owner.post('/api/service/agreements', {
      partyId: S.partyA.id, siteIds: [S.siteA.id], tier: 'standard', startDate: today, endDate: yearEnd(today),
      price: '1000', billingFrequency: 'quarterly', vatOn: true, upliftPercent: 5,
    });
    expect(ag.number).toMatch(/^AMC-\d{4}$/);
    expect(ag.status).toBe('draft');
    expect(ag).toMatchObject({ responseHours: 8, resolutionHours: 48, visitsPerYear: 4, coverage: 'business' });
    expect(ag.billing.vatApplies).toBe(true);
    expect(ag.billing.schedule).toHaveLength(4);
    expect(ag.billing.schedule.reduce((s: number, p: any) => s + toHalalas(p.gross), 0)).toBe(115000);
    S.ag = ag;
    // sites must belong to the customer
    await owner.post('/api/service/agreements', { partyId: S.partyA.id, siteIds: [S.siteB.id], startDate: today, endDate: yearEnd(today), price: '10' }, { expect: 400 });
    // drafts are editable
    const upd = await owner.put(`/api/service/agreements/${ag.id}`, { partyId: S.partyA.id, siteIds: [S.siteA.id], tier: 'standard', startDate: today, endDate: yearEnd(today), price: '1000', billingFrequency: 'quarterly', vatOn: true, upliftPercent: 5, notes: 'عقد سنوي' });
    expect(upd.notes).toBe('عقد سنوي');
  });

  it('activates: preventive visits per site + one payment request per period (sum = price + VAT)', async () => {
    const r = await owner.post(`/api/service/agreements/${S.ag.id}/activate`);
    expect(r.status).toBe('active');
    expect(r.activation.visits).toBe(4);
    expect(r.visits).toHaveLength(4);
    expect(r.visits.every((v: any) => v.status === 'planned' && v.siteId === S.siteA.id)).toBe(true);
    const prs = r.billing.requests;
    expect(prs).toHaveLength(4);
    expect(sumH(prs)).toBe(115000); // 1000 + 15% VAT
    expect(prs[0].periodFrom).toBe(today);
    expect(prs[3].periodTo).toBe(yearEnd(today));
    expect(prs.every((p: any) => p.status === 'draft' && p.payUrl?.includes('/p/'))).toBe(true);
    expect(prs[0].dueDate >= today).toBe(true);
    S.prs = prs;
    await owner.post(`/api/service/agreements/${S.ag.id}/activate`, undefined, { expect: 400 });
    // active: only limited fields
    const lim = await owner.put(`/api/service/agreements/${S.ag.id}`, { autoRenew: false, notes: 'محدث' });
    expect(lim.notes).toBe('محدث');
    expect(lim.price).toBe('1000.00');
  });

  it('VAT off: requests add up to the price exactly; explicit device list', async () => {
    const ag = await owner.post('/api/service/agreements', { partyId: S.partyB.id, assetIds: [S.assetB2.id], tier: 'basic', startDate: today, endDate: yearEnd(today), price: '1000', billingFrequency: 'monthly', vatOn: false });
    const r = await owner.post(`/api/service/agreements/${ag.id}/activate`);
    expect(r.billing.requests).toHaveLength(12);
    expect(sumH(r.billing.requests)).toBe(100000);
    expect(r.visits).toHaveLength(2); // basic tier: 2 visits on the device's site
    expect(r.assets.map((x: any) => x.id)).toEqual([S.assetB2.id]);
    S.agB = r;
  });

  it('a payment on an AMC request issues the 388 for that period (= the request amount)', async () => {
    const pr = S.prs[0];
    const paid = await owner.post(`/api/finance/payment-requests/${pr.id}/payments`, { amount: pr.amount, paidOn: today, method: 'bank_transfer', reference: 'AMC-T1' });
    expect(paid.agreementInvoice.typeCode).toBe('388');
    expect(paid.agreementInvoice.total).toBe(pr.amount);
    const view = await owner.get(`/api/service/agreements/${S.ag.id}`);
    expect(view.billing.requests[0].status).toBe('paid');
    expect(view.billing.requests[0].invoices[0].number).toBe(paid.agreementInvoice.number);
    S.amcInvoice = paid.agreementInvoice;
  });

  it('lists with filters and reports', async () => {
    const list = await owner.get(`/api/service/agreements?partyId=${S.partyA.id}`);
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({ number: S.ag.number, partyName: 'مجمع الصيانة السنوية', annualValue: '1000.00' });
    expect((await owner.get('/api/service/agreements?expiring=366')).rows.map((r: any) => r.id)).toContain(S.ag.id);
    const rep = await owner.get('/api/service/reports/agreements');
    expect(rep.activeCount).toBeGreaterThanOrEqual(2);
  });
});

describe('coverage and SLA on tickets (FSM-60/64/83)', () => {
  it('a ticket on a covered device (no warranty) is AMC with business-hour SLA targets from the agreement', async () => {
    const t = await owner.post('/api/field/tickets', { channel: 'phone', assetId: S.assetA.id, subject: 'الشاشة لا تعمل' });
    expect(t.coverage).toBe('amc');
    expect(t.agreementId).toBe(S.ag.id);
    expect(t.agreementNumber).toBe(S.ag.number);
    const [co] = await sqlRun((sql) => sql`select working_days from company limit 1`);
    const hol = await sqlRun((sql) => sql`select date::text as d from business_holiday`);
    const cal = { workingDays: co.working_days?.length ? co.working_days : DEFAULT_WORKING_DAYS, holidays: new Set<string>(hol.map((h: any) => h.d)) };
    const want = slaTargets(new Date(t.createdAt), { responseHours: 8, resolutionHours: 48, coverage: 'business' }, cal);
    expect(new Date(t.slaResponseDue).toISOString()).toBe(want.responseDue.toISOString());
    expect(new Date(t.slaResolutionDue).toISOString()).toBe(want.resolutionDue.toISOString());
    expect(t.sla.response.state).toMatch(/ok|at_risk/);
    S.ticket = t;
  });

  it('a device outside the explicit list is chargeable with the company default SLA (24/72 h)', async () => {
    const t = await owner.post('/api/field/tickets', { channel: 'phone', assetId: S.assetB1.id, subject: 'عطل' });
    expect(t.coverage).toBe('chargeable');
    expect(t.agreementId).toBeNull();
    expect(new Date(t.slaResolutionDue).getTime() - new Date(t.slaResponseDue).getTime()).toBeGreaterThan(0);
    const covered = await owner.post('/api/field/tickets', { channel: 'phone', assetId: S.assetB2.id, subject: 'عطل' });
    expect(covered.coverage).toBe('amc');
    S.ticketB = covered;
  });

  it('the first staff reply stops the response clock', async () => {
    const r = await owner.post(`/api/field/tickets/${S.ticket.id}/respond`, { note: 'سيتواصل معكم الفني اليوم' });
    expect(r.firstResponseAt).toBeTruthy();
    expect(r.sla.response.state).toBe('met');
    const again = await owner.post(`/api/field/tickets/${S.ticket.id}/respond`, { note: 'تذكير' });
    expect(again.firstResponseAt).toBe(r.firstResponseAt);
  });

  it('escalation job flags a breached ticket once (owner + dispatchers notified)', async () => {
    const t = await owner.post('/api/field/tickets', { channel: 'phone', assetId: S.assetA.id, subject: 'بلاغ متأخر' });
    await sqlRun((sql) => sql`update ticket set created_at = now() - interval '3 days', sla_response_due = now() - interval '2 days', sla_resolution_due = now() - interval '1 hour' where id = ${t.id}`);
    const r = await owner.post('/api/service/jobs/run', { job: 'sla' });
    expect(r.escalated).toBeGreaterThanOrEqual(1);
    const [row] = await sqlRun((sql) => sql`select sla_escalations from ticket where id = ${t.id}`);
    expect(row.sla_escalations).toEqual(expect.arrayContaining(['response_breached', 'resolution_breached']));
    const notes = await sqlRun((sql) => sql`select count(*)::int as n from notification where kind = 'sla' and link = ${`/field/tickets/${t.id}`}`);
    expect(notes[0].n).toBeGreaterThanOrEqual(1);
    const before = notes[0].n;
    await owner.post('/api/service/jobs/run', { job: 'sla' });
    const after = await sqlRun((sql) => sql`select count(*)::int as n from notification where kind = 'sla' and link = ${`/field/tickets/${t.id}`}`);
    expect(after[0].n).toBe(before); // once per key
    const breached = await owner.get('/api/field/tickets?sla=breached');
    expect(breached.rows.map((x: any) => x.id)).toContain(t.id);
    expect(breached.rows.map((x: any) => x.id)).not.toContain(S.ticket.id);
    const view = await owner.get(`/api/field/tickets/${t.id}`);
    expect(view.sla.response.state).toBe('breached');
    const rep = await owner.get('/api/service/reports/sla');
    expect(rep.months.length).toBeGreaterThanOrEqual(1);
  });
});

describe('scheduled jobs: preventive visits and renewals', () => {
  it('generates preventive work orders for visits due within 14 days (once)', async () => {
    const view = await owner.get(`/api/service/agreements/${S.ag.id}`);
    const first = view.visits[0];
    const r = await owner.post('/api/service/jobs/run', { job: 'preventive', today: addDays(first.dueDate, -10) });
    expect(r.created).toBeGreaterThanOrEqual(1);
    const v2 = await owner.get(`/api/service/agreements/${S.ag.id}`);
    const gen = v2.visits[0];
    expect(gen.status).toBe('generated');
    expect(gen.workOrder.number).toMatch(/^WO-\d{5}$/);
    const wo = await owner.get(`/api/field/work-orders/${gen.workOrder.id}`);
    expect(wo).toMatchObject({ type: 'preventive', agreementId: S.ag.id, coverage: 'amc', siteId: S.siteA.id, status: 'new' });
    expect(wo.title).toContain(S.ag.number);
    expect(v2.visits[1].status).toBe('planned');
    const again = await owner.post('/api/service/jobs/run', { job: 'preventive', today: addDays(first.dueDate, -10) });
    expect(again.workOrders).not.toContain(gen.workOrder.number);
    S.preventiveWo = wo;
  });

  it('renewal reminder: once per term, WhatsApp amc_renewal to the customer; due AMC requests are sent', async () => {
    const r = await owner.post('/api/service/jobs/run', { job: 'renewals', today: addDays(S.ag.endDate, -20) });
    expect(r.reminded).toBeGreaterThanOrEqual(1);
    const [a] = await sqlRun((sql) => sql`select renewal_notified_at from service_agreement where id = ${S.ag.id}`);
    expect(a.renewal_notified_at).toBeTruthy();
    const msgs = await sqlRun((sql) => sql`select count(*)::int as n from message where template_key = 'amc_renewal' and related_id = ${S.ag.id}`);
    expect(msgs[0].n).toBe(1);
    await owner.post('/api/service/jobs/run', { job: 'renewals', today: addDays(S.ag.endDate, -19) });
    const msgs2 = await sqlRun((sql) => sql`select count(*)::int as n from message where template_key = 'amc_renewal' and related_id = ${S.ag.id}`);
    expect(msgs2[0].n).toBe(1);
    expect(r.requestsSent).toBeGreaterThanOrEqual(1);
  });

  it('renews at the uplifted price for the next term; activating it marks the old one renewed (coverage continues)', async () => {
    const n = await owner.post(`/api/service/agreements/${S.ag.id}/renew`);
    expect(n.status).toBe('draft');
    expect(n.renewalOfId).toBe(S.ag.id);
    expect(n.price).toBe((renewalPrice(100000, 5) / 100).toFixed(2));
    expect(n.price).toBe('1050.00');
    expect(n.startDate).toBe(addDays(S.ag.endDate, 1));
    expect(n.endDate).toBe(yearEnd(n.startDate));
    expect(n.renewalChain.map((c: any) => c.id)).toEqual([S.ag.id, n.id]);
    await owner.post(`/api/service/agreements/${S.ag.id}/renew`, undefined, { expect: 409 });
    await owner.post(`/api/service/agreements/${n.id}/activate`);
    const old = await owner.get(`/api/service/agreements/${S.ag.id}`);
    expect(old.status).toBe('renewed');
    expect(old.renewal.id).toBe(n.id);
    const t = await owner.post('/api/field/tickets', { channel: 'phone', assetId: S.assetA.id, subject: 'بعد التجديد' });
    expect(t.coverage).toBe('amc');
    expect(t.agreementId).toBe(S.ag.id);
    S.renewal = n;
  });
});

describe('CSAT (FSM-87)', () => {
  it('completing the preventive visit sends a one-tap survey; scored once; invalid scores refused', async () => {
    const id = S.preventiveWo.id;
    const start = new Date(Date.now() + 3600_000).toISOString();
    const end = new Date(Date.now() + 7200_000).toISOString();
    await owner.post(`/api/field/work-orders/${id}/schedule`, { technicianId: S.tech, scheduledStart: start, scheduledEnd: end });
    await owner.post(`/api/field/work-orders/${id}/dispatch`);
    await owner.post(`/api/field/work-orders/${id}/check-in`, {});
    await owner.put(`/api/field/work-orders/${id}/checklist`, { items: [{ key: 'inspection', done: true }] });
    await owner.post(`/api/field/work-orders/${id}/photos`, { name: 'p.png', contentType: 'image/png', data: PNG_1PX });
    await owner.post(`/api/field/work-orders/${id}/sign`, { signatureName: 'أبو سالم' });
    const done = await owner.post(`/api/field/work-orders/${id}/complete`);
    expect(done.status).toBe('completed');
    expect(['sent', 'sandboxed']).toContain(done.csatStatus);
    const visit = (await owner.get(`/api/service/agreements/${S.ag.id}`)).visits[0];
    expect(visit.status).toBe('done');
    const link = await owner.get(`/api/service/work-orders/${id}/csat`);
    expect(link.url).toContain('/csat/');
    const pub = await call('GET', `/api/service/public/csat/${link.token}`, { expect: 200 });
    expect(pub.json).toMatchObject({ number: S.preventiveWo.number, technicianName: 'فني الصيانة', rated: false });
    expect(keysDeep(pub.json).filter((k) => /cost|margin|price|amount/i.test(k))).toEqual([]);
    await call('POST', `/api/service/public/csat/${link.token}`, { body: { score: 7 }, expect: 400 });
    await call('POST', `/api/service/public/csat/${link.token}`, { body: { score: 4.5 }, expect: 400 });
    await call('POST', `/api/service/public/csat/${link.token}x`, { body: { score: 5 }, expect: 404 });
    const ok = await call('POST', `/api/service/public/csat/${link.token}`, { body: { score: 5, comment: 'ممتاز' }, expect: 200 });
    expect(ok.json.score).toBe(5);
    await call('POST', `/api/service/public/csat/${link.token}`, { body: { score: 1 }, expect: 409 });
    const rep = await owner.get('/api/service/reports/csat');
    expect(rep.count).toBeGreaterThanOrEqual(1);
    expect(rep.distribution['5']).toBeGreaterThanOrEqual(1);
    expect(rep.byTechnician.find((x: any) => x.technicianId === S.tech)).toMatchObject({ average: 5, count: 1 });
  });
});

describe('customer portal (POR-01, 05..09)', () => {
  it('staff create a portal account (normalised mobile, duplicates refused) and invite it', async () => {
    const acc = await owner.post('/api/portal/accounts', { partyId: S.partyA.id, phone: PORTAL_PHONE, name: 'أبو سالم' });
    expect(acc.phone).toBe('+966557770001');
    expect(acc.status).toBe('active');
    S.account = acc;
    await owner.post('/api/portal/accounts', { partyId: S.partyA.id, phone: '+966 55 777 0001' }, { expect: 409 });
    await owner.post('/api/portal/accounts', { partyId: S.partyA.id, phone: '12345' }, { expect: 400 });
    const inv = await owner.post(`/api/portal/accounts/${acc.id}/invite`);
    expect(inv.link).toContain('/portal');
    expect((await owner.get(`/api/portal/accounts?partyId=${S.partyA.id}`)).rows.map((r: any) => r.id)).toEqual([acc.id]);
  });

  it('login request always answers 200 — no code for an unknown phone', async () => {
    const r = await call('POST', '/api/portal/login/request', { body: { phone: '0559990000' }, expect: 200 });
    expect(r.json).toEqual({ sent: true });
    const n = await sqlRun((sql) => sql`select count(*)::int as n from portal_otp where phone = '+966559990000'`);
    expect(n[0].n).toBe(0);
  });

  it('a wrong code counts an attempt; the right code sets an httpOnly cookie', async () => {
    const r = await call('POST', '/api/portal/login/request', { body: { phone: PORTAL_PHONE }, expect: 200 });
    expect(r.json).toEqual({ sent: true });
    const code = await lastCode('+966557770001');
    const wrong = code === '000000' ? '111111' : '000000';
    await call('POST', '/api/portal/login/verify', { body: { phone: PORTAL_PHONE, code: wrong }, expect: 400 });
    const [otp] = await sqlRun((sql) => sql`select attempts from portal_otp where phone = '+966557770001' order by created_at desc limit 1`);
    expect(otp.attempts).toBe(1);
    const ok = await call('POST', '/api/portal/login/verify', { body: { phone: PORTAL_PHONE, code }, expect: 200 });
    expect(ok.json.party).toMatchObject({ id: S.partyA.id });
    const set = ok.headers.getSetCookie().find((c) => c.startsWith('mmc_portal='))!;
    expect(set).toBeTruthy();
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Path=\//);
    S.portalCookie = set.split(';')[0];
    // the code is single-use
    await call('POST', '/api/portal/login/verify', { body: { phone: PORTAL_PHONE, code }, expect: 400 });
  });

  it('the portal cookie and the staff session never stand in for each other', async () => {
    const me = await portal('GET', '/me');
    expect(me.party).toMatchObject({ id: S.partyA.id, nameAr: 'مجمع الصيانة السنوية' });
    expect(me.sites.map((s: any) => s.id)).toEqual([S.siteA.id]);
    await call('GET', '/api/portal/me', { expect: 401 });
    await call('GET', '/api/portal/me', { cookie: owner.cookie, expect: 401 });
    await call('GET', '/api/portal/devices', { cookie: owner.cookie, expect: 401 });
    await call('GET', '/api/parties', { cookie: S.portalCookie, expect: 401 });
    await call('GET', '/api/service/agreements', { cookie: S.portalCookie, expect: 401 });
    await call('GET', '/api/portal/accounts', { cookie: S.portalCookie, expect: 401 });
  });

  it('devices: only the customer’s, with warranty and AMC coverage today', async () => {
    const d = await portal('GET', '/devices');
    const ids = d.rows.map((x: any) => x.id);
    expect(ids).toContain(S.assetA.id);
    expect(ids).not.toContain(S.assetB1.id);
    expect(ids).not.toContain(S.assetB2.id);
    const a = d.rows.find((x: any) => x.id === S.assetA.id);
    expect(a.coverageToday.coverage).toBe('amc');
    expect(a).not.toHaveProperty('ip');
    await portal('GET', `/devices/${S.assetB1.id}`, undefined, 404);
    await portal('GET', `/devices?siteId=${S.siteB.id}`, undefined, 404);
    const one = await portal('GET', `/devices/${S.assetA.id}`);
    expect(one.tickets.length).toBeGreaterThanOrEqual(1);
  });

  it('portal ticket: channel portal, AMC coverage and SLA, photos; other customers’ tickets invisible', async () => {
    const t = await portal('POST', '/tickets', { assetId: S.assetA.id, subject: 'الجرس لا يرن', description: 'منذ الصباح', photos: [{ name: 'door.png', contentType: 'image/png', data: PNG_1PX }] }, 201);
    expect(t).toMatchObject({ channel: 'portal', coverage: 'amc', status: 'open' });
    expect(t.sla.response.due).toBeTruthy();
    expect(t.photos).toHaveLength(1);
    expect(t.timeline[0].kind).toBe('opened');
    const [row] = await sqlRun((sql) => sql`select portal_account_id, agreement_id, sla_response_due from ticket where id = ${t.id}`);
    expect(row.portal_account_id).toBe(S.account.id);
    expect(row.agreement_id).toBe(S.ag.id);
    const photo = await call('GET', `/api/portal/files/${t.photos[0].id}`, { cookie: S.portalCookie });
    expect(photo.status).toBe(200);
    await portal('POST', '/tickets', { assetId: S.assetB1.id, subject: 'محاولة على جهاز عميل آخر' }, 404);
    const list = await portal('GET', '/tickets');
    expect(list.rows.map((x: any) => x.id)).toContain(t.id);
    expect(list.rows.map((x: any) => x.id)).not.toContain(S.ticketB.id);
    await portal('GET', `/tickets/${S.ticketB.id}`, undefined, 404);
    const staff = await owner.get(`/api/field/tickets/${t.id}`);
    expect(staff.channel).toBe('portal');
    // staff reply shows on the customer's timeline
    await owner.post(`/api/field/tickets/${t.id}/respond`, { note: 'تم استلام البلاغ' });
    const detail = await portal('GET', `/tickets/${t.id}`);
    expect(detail.timeline.find((e: any) => e.kind === 'reply').note).toBe('تم استلام البلاغ');
  });

  it('invoices, open payment requests and agreements of the customer only', async () => {
    const inv = await portal('GET', '/invoices');
    expect(inv.rows.map((x: any) => x.number)).toContain(S.amcInvoice.number);
    const prs = await portal('GET', '/payment-requests');
    expect(prs.rows.every((p: any) => p.payUrl.includes('/p/') && ['sent', 'partially_paid'].includes(p.status))).toBe(true);
    const ags = await portal('GET', '/agreements');
    const mine = ags.rows.find((x: any) => x.id === S.ag.id);
    expect(mine).toBeTruthy();
    expect(mine.renewal.id).toBe(S.renewal.id);
    expect(ags.rows.map((x: any) => x.id)).not.toContain(S.agB.id);
  });

  it('project approvals from the portal use the same transition (status, approvedByName, via portal)', async () => {
    const [p] = await sqlRun((sql) => sql`insert into project (tenant_id, number, name, party_id, site_id) select id, 'PRJ-SVC-1', 'مشروع البوابة', ${S.partyA.id}, ${S.siteA.id} from tenant limit 1 returning id`);
    const [a] = await sqlRun((sql) => sql`insert into project_approval (tenant_id, project_id, kind, title, status) select tenant_id, id, 'specs', 'اعتماد المواصفات', 'sent' from project where id = ${p.id} returning id`);
    const [draft] = await sqlRun((sql) => sql`insert into project_approval (tenant_id, project_id, kind, title, status) select tenant_id, id, 'design', 'مسودة', 'draft' from project where id = ${p.id} returning id`);
    const list = await portal('GET', '/projects');
    expect(list.rows.find((x: any) => x.id === p.id)).toMatchObject({ approvalsPending: 1, stage: 'kickoff' });
    const detail = await portal('GET', `/projects/${p.id}`);
    expect(detail.approvals.map((x: any) => x.id)).toEqual([a.id]); // drafts are not shown
    expect(detail.nextStep.pending.length).toBeGreaterThanOrEqual(1);
    await portal('POST', `/projects/${p.id}/approvals/${draft.id}/approve`, { approvedByName: 'أبو سالم' }, 404);
    const r = await portal('POST', `/projects/${p.id}/approvals/${a.id}/approve`, { approvedByName: 'أبو سالم' });
    expect(r).toMatchObject({ status: 'approved', approvedByName: 'أبو سالم', approvedOn: today });
    await portal('POST', `/projects/${p.id}/approvals/${a.id}/approve`, { approvedByName: 'أبو سالم' }, 400);
    const log = await sqlRun((sql) => sql`select after from audit_log where entity_type = 'project_approval' and entity_id = ${a.id} and action = 'approval_approved'`);
    expect(log[0].after.via).toBe('portal');
    const staffView = await owner.get(`/api/projects/${p.id}`);
    expect(staffView.facts.approvedOn.specs).toBe(today);
    S.project = p.id;
  });

  it('no portal response carries cost, margin or average-cost fields', async () => {
    const all = portalJson.flatMap((j) => keysDeep(j));
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((k) => /cost|margin|avg/i.test(k))).toEqual([]);
  });

  it('a mobile on two customers picks the account; disabling signs the customer out', async () => {
    const accB = await owner.post('/api/portal/accounts', { partyId: S.partyB.id, phone: PORTAL_PHONE, name: 'أبو سالم' });
    await call('POST', '/api/portal/login/request', { body: { phone: PORTAL_PHONE }, expect: 200 });
    const code = await lastCode('+966557770001');
    const pick = await call('POST', '/api/portal/login/verify', { body: { phone: PORTAL_PHONE, code }, expect: 200 });
    expect(pick.json.needsSelection).toBe(true);
    expect(pick.json.accounts.map((x: any) => x.accountId).sort()).toEqual([S.account.id, accB.id].sort());
    const ok = await call('POST', '/api/portal/login/verify', { body: { phone: PORTAL_PHONE, code, accountId: accB.id }, expect: 200 });
    const cookieB = ok.headers.getSetCookie().find((c) => c.startsWith('mmc_portal='))!.split(';')[0];
    const meB = await call('GET', '/api/portal/me', { cookie: cookieB, expect: 200 });
    expect(meB.json.party.id).toBe(S.partyB.id);
    await call('GET', `/api/portal/devices/${S.assetA.id}`, { cookie: cookieB, expect: 404 });
    await owner.post(`/api/portal/accounts/${accB.id}/disable`);
    await call('GET', '/api/portal/me', { cookie: cookieB, expect: 401 });
    // logout revokes the session
    await call('POST', '/api/portal/logout', { cookie: S.portalCookie, expect: 200 });
    await call('GET', '/api/portal/me', { cookie: S.portalCookie, expect: 401 });
  });
});

describe('cancel', () => {
  it('cancelling skips planned visits and cancels unpaid future requests', async () => {
    const r = await owner.post(`/api/service/agreements/${S.agB.id}/cancel`, { reason: 'طلب العميل' });
    expect(r.status).toBe('cancelled');
    expect(r.cancellation.visitsSkipped).toBeGreaterThanOrEqual(1);
    expect(r.cancellation.requestsCancelled.length).toBe(11); // the current month stays
    const t = await owner.post('/api/field/tickets', { channel: 'phone', assetId: S.assetB2.id, subject: 'بعد الإلغاء' });
    expect(t.coverage).toBe('chargeable');
  });
});
