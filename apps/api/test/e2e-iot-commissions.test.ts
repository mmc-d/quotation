import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { halalasToFixed, riyadhDate, toHalalas } from '@mmc/domain';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Phase 7c IoT-connected service (module 12 §2) and Phase 7a commissions & technician incentives
 * (module 09 §3.4). Run on its own DB: E2E_DB=mmc_e2e_iot pnpm --filter @mmc/api test e2e-iot-commissions
 */
const TB_SECRET = 'tb-e2e-secret';
process.env.THINGSBOARD_WEBHOOK_SECRET = TB_SECRET;
delete process.env.THINGSBOARD_URL; // sandbox client

let base = '';
let owner: Client;
const S: Record<string, any> = {};
const today = riyadhDate();
const period = today.slice(0, 7);
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const myProducts: string[] = [];

async function sqlRun<T = any>(fn: (sql: ReturnType<typeof ADMIN_SQL>) => Promise<T>): Promise<T> {
  const sql = ADMIN_SQL();
  try { return await fn(sql); } finally { await sql.end(); }
}

async function invite(email: string, roleKeys: string[]) {
  let users = await owner.get('/api/users');
  if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
  users = await owner.get('/api/users');
  const c = await signInOrUp(base, email);
  return { c, id: users.find((u: any) => u.email === email).id as string };
}

/** Raw POST to a ThingsBoard endpoint, signed unless `sig` is given (null = unsigned). */
async function tb(path: string, payload: unknown, sig?: string | null) {
  const body = JSON.stringify(payload);
  const signature = sig === undefined ? createHmac('sha256', TB_SECRET).update(body).digest('hex') : sig;
  const res = await fetch(`${base}/api/iot/thingsboard/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-MMC-Signature': signature } : {}) }, body });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const alarm = (alarmId: string, deviceName: string, extra: Record<string, unknown> = {}) => ({ alarmId, deviceName, type: 'Device offline', severity: 'CRITICAL', status: 'ACTIVE_UNACK', ts: Date.now(), ...extra });

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  S.ownerId = (await owner.get('/api/me')).user.id;
  const p = await owner.post('/api/parties', {
    nameAr: 'برج المراقبة الذكية', phone: '0558880001',
    contacts: [{ name: 'مدير المرفق', mobile: '0558880002', isPrimary: true }],
    sites: [{ type: 'project', name: 'برج المراقبة', city: 'الرياض' }],
  });
  S.party = await owner.get(`/api/parties/${p.id}`);
  S.site = S.party.sites[0];
  const future = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  S.cam = await owner.post('/api/field/assets', { code: 'IOT-CAM', serial: 'IOT-SN-1', siteId: S.site.id, installedOn: today, labourWarrantyEnd: future, partsWarrantyEnd: future });
  S.lock = await owner.post('/api/field/assets', { code: 'IOT-LCK', serial: 'IOT-SN-2', mac: 'aa-bb-cc-00-11-22', siteId: S.site.id });
  S.gate = await owner.post('/api/field/assets', { code: 'IOT-GATE', serial: 'IOT-SN-3', siteId: S.site.id });
});

afterAll(async () => {
  try {
    if (myProducts.length) await sqlRun((sql) => sql`update product set archived_at = now() where id in ${sql(myProducts)}`);
  } finally {
    await stopServer();
  }
});

describe('IoT-connected service (IOT-01..07)', () => {
  it('binds a ThingsBoard device to an installed asset (unique per tenant)', async () => {
    const r = await owner.put(`/api/field/assets/${S.cam.id}/iot`, { iotDeviceId: 'tb-cam-1' });
    expect(r.iotDeviceId).toBe('tb-cam-1');
    await owner.put(`/api/field/assets/${S.gate.id}/iot`, { iotDeviceId: 'TB-CAM-1' }, { expect: 409 });
    await owner.put(`/api/field/assets/${S.gate.id}/iot`, { iotDeviceId: 'tb-gate-3' });
  });

  it('rejects unsigned or wrongly signed webhooks with 401', async () => {
    expect((await tb('webhook', alarm('x-1', 'tb-cam-1'), null)).status).toBe(401);
    expect((await tb('webhook', alarm('x-1', 'tb-cam-1'), 'deadbeef')).status).toBe(401);
    expect((await tb('heartbeat', { deviceName: 'tb-cam-1', online: true }, null)).status).toBe(401);
  });

  it('a critical alarm on a bound device opens one ticket + corrective work order with coverage and SLA', async () => {
    const r = await tb('webhook', alarm('tb-alarm-1', 'tb-cam-1'));
    expect(r.status).toBe(200);
    expect(r.json.action).toBe('ticket');
    const t = await owner.get(`/api/field/tickets/${r.json.ticketId}`);
    expect(t).toMatchObject({ channel: 'iot', priority: 'urgent', coverage: 'warranty', assetId: S.cam.id, siteId: S.site.id, partyId: S.party.id, status: 'open' });
    expect(t.subject).toBe('تنبيه جهاز: Device offline');
    expect(t.slaResponseDue).toBeTruthy();
    expect(t.workOrders).toHaveLength(1);
    expect(t.workOrders[0]).toMatchObject({ type: 'warranty', status: 'new', assetId: S.cam.id, technicianId: null });
    S.alarm1 = r.json;
    S.ticket1 = t;
    const [n] = await sqlRun((sql) => sql`select count(*)::int as n from notification where kind = 'ticket' and link = ${`/field/tickets/${t.id}`}`);
    expect(n.n).toBeGreaterThan(0);
    const [msg] = await sqlRun((sql) => sql`select template_key from message where related_id = ${t.id}`);
    expect(msg?.template_key).toBe('iot_alert');
  });

  it('deduplicates: a repeat of the same device + type does not open another ticket; the same alarm id is idempotent', async () => {
    const again = await tb('webhook', alarm('tb-alarm-2', 'tb-cam-1'));
    expect(again.json).toMatchObject({ action: 'merged', alarmId: S.alarm1.alarmId, ticketId: S.alarm1.ticketId });
    const same = await tb('webhook', alarm('tb-alarm-1', 'tb-cam-1'));
    expect(same.json.duplicate).toBe(true);
    const tickets = await owner.get(`/api/field/tickets?assetId=${S.cam.id}`);
    expect(tickets.total).toBe(1);
    const list = await owner.get(`/api/iot/alarms?siteId=${S.site.id}`);
    const a = list.rows.find((x: any) => x.id === S.alarm1.alarmId);
    expect(a).toMatchObject({ occurrences: 2, status: 'active', ticketNumber: S.ticket1.number, assetCode: 'IOT-CAM' });
  });

  it('maps by serial / MAC, logs minor alarms without a ticket and stores unknown devices', async () => {
    const bySerial = await tb('webhook', alarm('tb-lock-1', 'IOT-SN-2', { severity: 'MINOR', type: 'Battery low' }));
    expect(bySerial.json.action).toBe('logged');
    const byMac = await tb('webhook', alarm('tb-lock-2', 'AA:BB:CC:00:11:22', { severity: 'WARNING', type: 'Door ajar' }));
    expect(byMac.json.action).toBe('logged');
    const rows = await sqlRun((sql) => sql`select external_id, asset_id, ticket_id from iot_alarm where external_id in ('tb-lock-1', 'tb-lock-2')`);
    expect(rows.every((r: any) => r.asset_id === S.lock.id && r.ticket_id === null)).toBe(true);
    const ghost = await tb('webhook', alarm('tb-ghost-1', 'ghost-device-9'));
    expect(ghost.json.action).toBe('unknown_device');
    const unbound = await owner.get('/api/iot/alarms?status=unbound');
    expect(unbound.rows.some((x: any) => x.externalId === 'tb-ghost-1' && x.assetId === null)).toBe(true);
    const [n] = await sqlRun((sql) => sql`select count(*)::int as n from notification where kind = 'iot'`);
    expect(n.n).toBeGreaterThan(0);
  });

  it('a cleared alarm is marked cleared and notes the untouched ticket', async () => {
    const opened = await tb('webhook', alarm('tb-gate-1', 'tb-gate-3', { severity: 'MAJOR', type: 'Gate jammed' }));
    expect(opened.json.action).toBe('ticket');
    expect((await owner.get(`/api/field/tickets/${opened.json.ticketId}`)).priority).toBe('high');
    const cleared = await tb('webhook', alarm('tb-gate-1', 'tb-gate-3', { severity: 'MAJOR', type: 'Gate jammed', status: 'CLEARED_UNACK' }));
    expect(cleared.json).toMatchObject({ action: 'cleared', noted: true });
    const [row] = await sqlRun((sql) => sql`select status, cleared_at from iot_alarm where external_id = 'tb-gate-1'`);
    expect(row.status).toBe('cleared');
    expect(row.cleared_at).toBeTruthy();
    const [note] = await sqlRun((sql) => sql`select action from audit_log where entity_type = 'ticket' and entity_id = ${opened.json.ticketId} and action = 'note'`);
    expect(note?.action).toBe('note');
  });

  it('completing the linked work order acks + clears the alarm in ThingsBoard (sandbox) and marks it synced', async () => {
    const woId = S.ticket1.workOrders[0].id;
    const start = new Date(Date.now() + 3600_000);
    await owner.post(`/api/field/work-orders/${woId}/schedule`, { technicianId: S.ownerId, scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3600_000).toISOString() });
    await owner.post(`/api/field/work-orders/${woId}/dispatch`);
    const wo = await owner.post(`/api/field/work-orders/${woId}/check-in`, {});
    await owner.put(`/api/field/work-orders/${woId}/checklist`, { items: wo.checklist.map((c: any) => ({ key: c.key, done: true, value: 'ok' })) });
    await owner.post(`/api/field/work-orders/${woId}/photos`, { name: 'after.png', contentType: 'image/png', data: PNG_1PX });
    await owner.post(`/api/field/work-orders/${woId}/sign`, { signatureName: 'مدير المرفق' });
    const spy = vi.spyOn(console, 'log');
    const done = await owner.post(`/api/field/work-orders/${woId}/complete`, {});
    const logs = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(done.status).toBe('completed');
    expect(logs.filter((l) => l.includes('[thingsboard:sandbox]'))).toEqual(expect.arrayContaining([expect.stringContaining('tb-alarm-1'), expect.stringContaining('tb-alarm-2')]));
    const [row] = await sqlRun((sql) => sql`select status, synced_at from iot_alarm where external_id = 'tb-alarm-1'`);
    expect(row.status).toBe('cleared');
    expect(row.synced_at).toBeTruthy();
  });

  it('heartbeats update the device online state and the site health', async () => {
    expect((await tb('heartbeat', { deviceName: 'tb-cam-1', online: true, ts: Date.now() })).json).toMatchObject({ matched: true, online: true });
    expect((await tb('heartbeat', { deviceName: 'tb-gate-3', online: false, ts: Date.now() })).json.matched).toBe(true);
    expect((await tb('heartbeat', { deviceName: 'nobody', online: true })).json.matched).toBe(false);
    const a = await owner.get(`/api/field/assets/${S.cam.id}`);
    expect(a.iotOnline).toBe(true);
    expect(a.iotLastSeenAt).toBeTruthy();
    const h = await owner.get(`/api/iot/sites/${S.site.id}/health`);
    expect(h).toMatchObject({ devicesBound: 2, online: 1, offline: 1, onlinePercent: 50 });
    expect(h.devices.find((d: any) => d.id === S.cam.id).online).toBe(true);
  });

  it('simulates an alarm for demos (iot.manage)', async () => {
    const r = await owner.post('/api/iot/test-alarm', { assetId: S.gate.id, type: 'Tamper', severity: 'MINOR' });
    expect(r.action).toBe('logged');
    expect(r.externalId).toMatch(/^test-/);
    const h = await owner.get(`/api/iot/sites/${S.site.id}/health`);
    expect(h.activeAlarms).toBeGreaterThanOrEqual(1);
  });
});

describe('commissions (HR-50..54) and technician incentives (HR-55)', () => {
  it('sets up a rep, categories, products and two plans (revenue by category, margin catch-all)', async () => {
    const rep = await invite('iot-rep@e2e.test', ['sales_rep']);
    S.rep = rep.c; S.repId = rep.id;
    const catA = await owner.put('/api/products/meta/categories/new', { nameAr: 'كاميرات العمولة' });
    const catB = await owner.put('/api/products/meta/categories/new', { nameAr: 'أقفال العمولة' });
    S.catA = catA.id; S.catB = catB.id;
    for (const [code, categoryId] of [['CMX-CAM', catA.id], ['CMX-LCK', catB.id]] as const) {
      const pr = await owner.put('/api/products/new', { code, nameAr: `منتج ${code}`, listPrice: '100', categoryId });
      myProducts.push(pr.id);
    }
    expect((await owner.get('/api/products/meta')).categories.some((c: any) => c.id === catA.id)).toBe(true);
    S.planRev = await owner.post('/api/commissions/plans', { name: 'كاميرات 5٪', basis: 'revenue', ratePercent: '5', categoryIds: [catA.id], userIds: [rep.id], sort: 1 });
    S.planMargin = await owner.post('/api/commissions/plans', { name: 'هامش 10٪', basis: 'margin', ratePercent: 10, categoryIds: [], userIds: [rep.id], sort: 2 });
    await owner.post('/api/commissions/plans', { name: 'bad', basis: 'revenue', ratePercent: '150' }, { expect: 400 });
    await S.rep.get('/api/commissions/plans', { expect: 403 });
    const upd = await owner.put(`/api/commissions/plans/${S.planMargin.id}`, { name: 'هامش 10٪ (كل الفئات)', basis: 'margin', ratePercent: '10', categoryIds: [], userIds: [rep.id], sort: 2 });
    expect(upd.name).toContain('كل الفئات');
  });

  it('earns on the contract final 388 (revenue + margin plans); half paid → half payable', async () => {
    const q = await owner.post('/api/quotes', {
      partyId: S.party.id, clientName: S.party.nameAr, clientPhone: '0558880002', discountType: 'amount', discountValue: '0', vatOn: true,
      lines: [{ code: 'CMX-CAM', description: 'كاميرا', unitPrice: '1000', qty: '2', unitCost: '600' }, { code: 'CMX-LCK', description: 'قفل', unitPrice: '500', qty: '1', unitCost: '200' }],
    });
    await owner.post(`/api/quotes/${q.id}/submit`);
    const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
    await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
    await sqlRun((sql) => sql`update contract set owner_id = ${S.repId} where id = ${c.id}`);
    S.contract = c;
    const final = c.milestones[c.milestones.length - 1];
    const pr = await owner.post(`/api/finance/milestones/${final.id}/request`, {});
    const bill = await owner.get(`/api/finance/contracts/${c.id}`);
    const inv = bill.invoices.find((i: any) => i.typeCode === '388');
    S.invoice = inv;
    const [mirror] = await sqlRun((sql) => sql`select lines from invoice_mirror where id = ${inv.id}`);
    const cost: Record<string, number> = { 'CMX-CAM': 60000, 'CMX-LCK': 20000 };
    let rev = 0; let margin = 0;
    for (const l of mirror.lines as { code: string; qty: string; net: string }[]) {
      const net = toHalalas(l.net);
      if (l.code === 'CMX-CAM') rev += net * 0.05;
      else margin += Math.max(0, net - (cost[l.code] ?? 0) * Number(l.qty)) * 0.1;
    }
    const mine = await S.rep.get('/api/commissions/entries');
    const ofInv = mine.rows.filter((r: any) => r.invoiceId === inv.id);
    expect(ofInv).toHaveLength(2);
    const byPlan = (id: string) => ofInv.find((r: any) => r.planId === id);
    expect(toHalalas(byPlan(S.planRev.id).earned)).toBe(Math.round(rev));
    expect(toHalalas(byPlan(S.planMargin.id).earned)).toBe(Math.round(margin));
    expect(byPlan(S.planRev.id)).toMatchObject({ status: 'open', payable: '0.00', invoiceNumber: inv.number, contractNumber: c.number, period });

    // the customer pays half of the 388 → half of the commission becomes payable
    const half = halalasToFixed(Math.floor(toHalalas(pr.amount) / 2));
    await owner.post(`/api/finance/payment-requests/${pr.id}/payments`, { amount: half, paidOn: today, method: 'bank_transfer', reference: 'CMX-HALF' });
    const after = (await S.rep.get('/api/commissions/entries')).rows.filter((r: any) => r.invoiceId === inv.id);
    for (const e of after) {
      const want = Math.floor((toHalalas(e.earned) * toHalalas(half)) / toHalalas(inv.total));
      expect(Math.abs(toHalalas(e.payable) - want)).toBeLessThanOrEqual(1);
      expect(e.status).toBe('payable');
    }
    S.entries = after;
  });

  it('a 381 credit note claws back', async () => {
    const cn = await owner.post(`/api/finance/invoices/${S.invoice.id}/credit-note`, { reason: 'خصم لاحق على العمولة', amount: '115.00' });
    const rows = (await owner.get(`/api/commissions/entries?userId=${S.repId}`)).rows.filter((r: any) => r.invoiceId === cn.id);
    expect(rows).toHaveLength(1);
    const [mirror] = await sqlRun((sql) => sql`select lines from invoice_mirror where id = ${cn.id}`);
    const net = (mirror.lines as { net: string }[]).reduce((s, l) => s + toHalalas(l.net), 0);
    expect(toHalalas(rows[0].earned)).toBe(Math.round(net * 0.1));
    expect(toHalalas(rows[0].earned)).toBeLessThan(0);
    expect(rows[0].payable).toBe(rows[0].earned); // claw-back is due at once
    expect(rows[0].planId).toBe(S.planMargin.id);
  });

  it('scopes the ledger: a rep sees only own entries; the summary adds up', async () => {
    const [tenant] = await sqlRun((sql) => sql`select id from tenant limit 1`);
    await sqlRun((sql) => sql`insert into commission_entry (tenant_id, user_id, invoice_id, earned, payable, period, status) values (${tenant.id}, ${S.ownerId}, gen_random_uuid(), '50.00', '20.00', ${period}, 'payable')`);
    const repView = await S.rep.get('/api/commissions/entries');
    expect(repView.rows.length).toBeGreaterThan(0);
    expect(repView.rows.every((r: any) => r.userId === S.repId)).toBe(true);
    expect((await S.rep.get(`/api/commissions/entries?userId=${S.ownerId}`)).rows).toHaveLength(0);
    expect((await owner.get('/api/commissions/entries')).rows.some((r: any) => r.userId === S.ownerId)).toBe(true);
    const sum = await S.rep.get(`/api/commissions/summary?period=${period}`);
    expect(sum.reps).toHaveLength(1);
    const own = (await S.rep.get(`/api/commissions/entries?period=${period}`)).rows;
    expect(toHalalas(sum.reps[0].earned)).toBe(own.reduce((s: number, r: any) => s + toHalalas(r.earned), 0));
    await S.rep.post('/api/commissions/mark-paid', { entryIds: [own[0].id], period }, { expect: 403 });
    await S.rep.get(`/api/commissions/export?period=${period}`, { expect: 403 });
  });

  it('exports the payroll CSV and marks entries paid', async () => {
    const csv = (await owner.get(`/api/commissions/export?period=${period}`, { raw: true })).toString('utf8');
    expect(csv.split('\r\n')[0]).toContain('employee,email,amount');
    const repLine = csv.split('\r\n').find((l: string) => l.includes('iot-rep@e2e.test'))!;
    const repRows = (await owner.get(`/api/commissions/entries?userId=${S.repId}&status=payable`)).rows;
    const outstanding = repRows.reduce((s: number, r: any) => s + toHalalas(r.outstanding), 0);
    expect(repLine.split(',')[2]).toBe(halalasToFixed(outstanding));
    const paid = await owner.post('/api/commissions/mark-paid', { entryIds: repRows.map((r: any) => r.id), period });
    expect(paid.amount).toBe(halalasToFixed(outstanding));
    const csv2 = (await owner.get(`/api/commissions/export?period=${period}`, { raw: true })).toString('utf8');
    expect(csv2).not.toContain('iot-rep@e2e.test');
    const sum = await owner.get(`/api/commissions/summary?period=${period}`);
    const r = sum.reps.find((x: any) => x.userId === S.repId);
    expect(r.outstanding).toBe('0.00');
  });

  it('computes technician incentives from crafted work orders', async () => {
    const tech = await invite('iot-tech@e2e.test', ['technician']);
    const day = '2026-01-12';
    const at = (d: string, h = 12) => `${d}T${String(h).padStart(2, '0')}:00:00+03:00`;
    await sqlRun(async (sql) => {
      const [t] = await sql`select id from tenant limit 1`;
      const wo = async (n: string, type: string, status: string, extra: Record<string, unknown>) => (await sql`insert into work_order ${sql({ tenant_id: t.id, number: n, type, status, title: n, site_id: S.site.id, ...extra })} returning id`)[0]!.id as string;
      const asset = async (serial: string, woId: string | null) => (await sql`insert into installed_asset ${sql({ tenant_id: t.id, site_id: S.site.id, code: 'TI-DEV', serial, work_order_id: woId })} returning id`)[0]!.id as string;
      const inst = await wo('TI-WO-1', 'installation', 'completed', { technician_id: tech.id, completed_at: at(day), signature_name: 'عميل', csat_score: 5 });
      for (const s of ['TI-1', 'TI-2', 'TI-3']) await asset(s, inst);
      const a1 = await asset('TI-A1', null);
      const a2 = await asset('TI-A2', null);
      await wo('TI-WO-2', 'corrective', 'closed', { technician_id: tech.id, completed_at: at(day, 14), asset_id: a1, signature_name: 'عميل', csat_score: 3 });
      await wo('TI-WO-3', 'warranty', 'completed', { technician_id: tech.id, completed_at: at(day, 16), asset_id: a2 });
      // the same asset needs another corrective visit five days later → callback on TI-WO-3
      await wo('TI-WO-4', 'corrective', 'new', { asset_id: a2, created_at: at('2026-01-17') });
      // outside the period: ignored
      await wo('TI-WO-5', 'installation', 'completed', { technician_id: tech.id, completed_at: at('2026-02-20') });
    });
    const r = await owner.get('/api/commissions/technicians?from=2026-01-01&to=2026-01-31');
    const row = r.rows.find((x: any) => x.userId === tech.id);
    expect(row).toMatchObject({ jobs: 3, devices: 3, firstTimeFixes: 1, callbacks: 1, happyCustomers: 1 });
    expect(row.totalHalalas).toBe(3 * r.rules.perDeviceHalalas + r.rules.firstTimeFixHalalas - r.rules.callbackPenaltyHalalas + r.rules.happyCustomerHalalas);
    // a technician without commission.read cannot see the incentive table
    await tech.c.get('/api/commissions/technicians', { expect: 403 });
  });
});
