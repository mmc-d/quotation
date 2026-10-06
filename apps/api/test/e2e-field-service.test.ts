import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { riyadhDate } from '@mmc/domain';
import { ADMIN_SQL, Client, gotenbergUp, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Field service (module 06): location tree, installed base (MAC normalisation, duplicates, CSV
 * import), tickets with the coverage decision, ticket → work order, the technician flow with the
 * completion stage gate, own-scope for technicians and invalid transitions.
 */
let base = '';
let owner: Client;
let tech: Client;
let tech2: Client;
let pdfs = false;
const S: Record<string, any> = {};
const today = riyadhDate();
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  base = await startServer();
  pdfs = await gotenbergUp();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const t1 = await owner.post('/api/users/invite', { email: 'tech1@e2e.test', nameAr: 'فني أول', roleKeys: ['technician'] });
  const t2 = await owner.post('/api/users/invite', { email: 'tech2@e2e.test', nameAr: 'فني ثاني', roleKeys: ['technician'] });
  S.tech1 = t1.id;
  S.tech2 = t2.id;
  tech = await signInOrUp(base, 'tech1@e2e.test');
  tech2 = await signInOrUp(base, 'tech2@e2e.test');
  const p = await owner.post('/api/parties', {
    nameAr: 'برج الخدمة الميدانية', phone: '0550001111',
    contacts: [{ name: 'أبو فهد', mobile: '0559998877', isPrimary: true }],
    sites: [{ type: 'project', name: 'برج النخيل', city: 'جدة', lat: '21.5', lng: '39.2' }, { type: 'project', name: 'فيلا قيد التنفيذ', city: 'جدة' }],
  });
  const full = await owner.get(`/api/parties/${p.id}`);
  S.party = p;
  S.site = full.sites.find((s: any) => s.name === 'برج النخيل');
  S.site2 = full.sites.find((s: any) => s.name === 'فيلا قيد التنفيذ');
});

afterAll(async () => {
  await stopServer();
});

describe('locations (FSM-01)', () => {
  it('generates building → floors → units in bulk, idempotently', async () => {
    const r = await owner.post(`/api/field/sites/${S.site.id}/locations/bulk`, { building: 'B1', floors: 3, unitsPerFloor: 4, unitPrefix: 'U' });
    expect(r.created).toBe(1 + 3 + 12);
    const b1 = r.tree.find((n: any) => n.name === 'B1');
    expect(b1.kind).toBe('building');
    expect(b1.children.map((f: any) => f.name)).toEqual(['F1', 'F2', 'F3']);
    expect(b1.children[1].children.map((u: any) => u.name)).toEqual(['U201', 'U202', 'U203', 'U204']);
    const again = await owner.post(`/api/field/sites/${S.site.id}/locations/bulk`, { building: 'B1', floors: 3, unitsPerFloor: 4, unitPrefix: 'U' });
    expect(again.created).toBe(0);
    S.u203 = b1.children[1].children[2];
    S.u101 = b1.children[0].children[0];
  });

  it('adds, renames and archives a location; refuses archiving while devices are attached', async () => {
    const tree = (await owner.get(`/api/field/sites/${S.site.id}/locations`)).tree;
    const b1 = tree.find((n: any) => n.name === 'B1');
    const room = await owner.post(`/api/field/sites/${S.site.id}/locations`, { parentId: b1.id, kind: 'rack', name: 'Rack-A' });
    const renamed = await owner.put(`/api/field/locations/${room.id}`, { parentId: b1.id, kind: 'rack', name: 'Rack-Main' });
    expect(renamed.name).toBe('Rack-Main');
    await owner.put(`/api/field/locations/${b1.id}`, { parentId: room.id, kind: 'building', name: 'B1' }, { expect: 400 }); // cycle
    S.rack = room;
    const a = await owner.post('/api/field/assets', { code: 'SW-POE', serial: 'RACK-SW-1', siteId: S.site.id, locationId: room.id });
    await owner.req('DELETE', `/api/field/locations/${room.id}`, undefined, { expect: 409 });
    await owner.put(`/api/field/assets/${a.id}`, { code: 'SW-POE', serial: 'RACK-SW-1', siteId: S.site.id, locationId: S.u101.id, attributes: {} });
    const del = await owner.req('DELETE', `/api/field/locations/${room.id}`, undefined, { expect: 200 });
    expect(del.archived).toBe(1);
  });
});

describe('installed base (FSM-03..05)', () => {
  it('registers a device with a normalised MAC and the location path; duplicates → 409; bad MAC → 400', async () => {
    const a = await owner.post('/api/field/assets', { code: 'DP-100', serial: 'SN-0001', mac: 'aa-bb-cc-dd-ee-01', ip: '10.0.0.11', firmware: '1.2.3', siteId: S.site.id, locationId: S.u203.id, installedOn: today, attributes: { sip: '203' } });
    expect(a.mac).toBe('AA:BB:CC:DD:EE:01');
    expect(a.locationPath).toBe('B1/F2/U203');
    expect(a.partyId).toBe(S.party.id);
    S.asset = a;
    await owner.post('/api/field/assets', { code: 'DP-100', serial: 'SN-0001', siteId: S.site.id }, { expect: 409 });
    await owner.post('/api/field/assets', { code: 'DP-100', serial: 'SN-0002', mac: 'not-a-mac', siteId: S.site.id }, { expect: 400 });
    const found = await owner.get('/api/field/assets?q=aabbccddee01');
    expect(found.rows.map((r: any) => r.id)).toContain(a.id);
  });

  it('records a commissioning test (passed only when all checks pass)', async () => {
    const r = await owner.post(`/api/field/assets/${S.asset.id}/test`, { results: [{ key: 'call', ok: true }, { key: 'unlock', ok: false, note: 'relay' }] });
    expect(r.testPassed).toBe(false);
    expect(r.testedOn).toBe(today);
    const r2 = await owner.post(`/api/field/assets/${S.asset.id}/test`, { results: [{ key: 'call', ok: true }, { key: 'unlock', ok: true }] });
    expect(r2.testPassed).toBe(true);
  });

  it('imports a device schedule from CSV: dry run first, then for real (locations created, errors per row)', async () => {
    const csv = [
      'code,serial,mac,ip,firmware,location',
      'IM-7,IMP-1,001122334455,10.0.1.1,2.0,B1/F3/U301',
      'IM-7,IMP-2,00:11:22:33:44:56,10.0.1.2,2.0,B2/F1/U101',
      'IM-7,IMP-2,00:11:22:33:44:57,,,B2/F1/U102',
      'IM-7,IMP-3,zz,,,B2/F1/U103',
      ',IMP-4,,,,B2/F1/U104',
      'DP-100,SN-0001,,,,B1/F2/U203',
    ].join('\n');
    const dry = await owner.post('/api/field/assets/import', { siteId: S.site.id, csv, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.valid).toBe(2);
    expect(dry.created).toBe(0);
    expect(dry.errors.map((e: any) => e.row)).toEqual([4, 5, 6, 7]);
    expect(dry.locationsCreated).toBe(3); // B2, B2/F1, B2/F1/U101 (B1/F3/U301 exists; rows with errors create nothing)
    expect((await owner.get('/api/field/assets?q=IMP-')).total).toBe(0);
    const real = await owner.post('/api/field/assets/import', { siteId: S.site.id, csv, dryRun: false });
    expect(real.created).toBe(2);
    const rows = (await owner.get('/api/field/assets?q=IMP-')).rows;
    expect(rows.map((r: any) => r.locationPath).sort()).toEqual(['B1/F3/U301', 'B2/F1/U101']);
    expect(rows.find((r: any) => r.serial === 'IMP-1').mac).toBe('00:11:22:33:44:55');
  });
});

describe('tickets with coverage (FSM-60, 80..82)', () => {
  it('decides warranty vs chargeable from the device warranty dates', async () => {
    await owner.put(`/api/field/assets/${S.asset.id}`, { ...pick(S.asset), labourWarrantyEnd: addDays(today, 200), partsWarrantyEnd: addDays(today, 500) });
    const t = await owner.post('/api/field/tickets', { channel: 'whatsapp', assetId: S.asset.id, contactName: 'ساكن 203', contactPhone: '0551112222', subject: 'الشاشة لا تعمل' });
    expect(t.coverage).toBe('warranty');
    expect(t.coverageReason).toContain('ضمان التركيب ساري');
    expect(t.siteId).toBe(S.site.id);
    expect(t.locationPath).toBe('B1/F2/U203');
    expect(t.partyId).toBe(S.party.id);
    expect(t.number).toMatch(/^TCK-\d{5}$/);
    S.ticket = t;

    const old = await owner.post('/api/field/assets', { code: 'DP-100', serial: 'SN-OLD', siteId: S.site.id, locationId: S.u101.id, labourWarrantyEnd: addDays(today, -1), partsWarrantyEnd: addDays(today, -1) });
    const t2 = await owner.post('/api/field/tickets', { channel: 'phone', assetId: old.id, contactPhone: '0551112222', subject: 'الجرس معطل' });
    expect(t2.coverage).toBe('chargeable');
    expect(t2.coverageReason).toContain('انتهى الضمان');

    const detail = await owner.get(`/api/field/assets/${old.id}`);
    expect(detail.coverageToday.coverage).toBe('chargeable');
    expect(detail.tickets.map((x: any) => x.id)).toContain(t2.id);
  });

  it('matches the caller by phone to a customer (FSM-81) and covers a project in progress', async () => {
    const t = await owner.post('/api/field/tickets', { channel: 'phone', contactPhone: '+966 55 999 8877', subject: 'استفسار' });
    expect(t.partyId).toBe(S.party.id);
    expect(t.matchedBy).toBe('phone');
    expect(t.contactName).toBe('أبو فهد');
    expect(t.coverage).toBe('chargeable');

    const sql = ADMIN_SQL();
    const [tn] = await sql`select id from tenant limit 1`;
    await sql`insert into project (tenant_id, number, name, party_id, site_id, stage) values (${tn!.id}, 'PRJ-FSM-T1', 'فيلا', ${S.party.id}, ${S.site2.id}, 'installation')`;
    await sql.end();
    const tp = await owner.post('/api/field/tickets', { channel: 'phone', siteId: S.site2.id, subject: 'تأخير في التركيب' });
    expect(tp.coverage).toBe('project');
    const list = await owner.get(`/api/field/tickets?partyId=${S.party.id}&status=open`);
    expect(list.total).toBeGreaterThanOrEqual(3);
  });

  it('turns a ticket into a work order (warranty type, same site / device / coverage) and moves it to in_progress', async () => {
    const wo = await owner.post(`/api/field/tickets/${S.ticket.id}/work-order`, {});
    expect(wo.type).toBe('warranty');
    expect(wo.status).toBe('new');
    expect(wo.coverage).toBe('warranty');
    expect(wo.assetId).toBe(S.asset.id);
    expect(wo.siteId).toBe(S.site.id);
    expect(wo.ticket.id).toBe(S.ticket.id);
    expect(wo.ticket.status).toBe('in_progress');
    expect(wo.checklist.map((c: any) => c.key)).toEqual(['diagnosis', 'fixed', 'tested']);
    expect(wo.number).toMatch(/^WO-\d{5}$/);
    S.wo = wo;
  });
});

describe('work orders — dispatch and the technician flow (FSM-22, 40..47)', () => {
  it('rejects invalid transitions', async () => {
    await tech.post(`/api/field/work-orders/${S.wo.id}/start-travel`, {}, { expect: 403 }); // not assigned yet
    await owner.post(`/api/field/work-orders/${S.wo.id}/dispatch`, {}, { expect: 400 }); // no technician
    await owner.post(`/api/field/work-orders/${S.wo.id}/start-travel`, {}, { expect: 400 }); // new → en_route
    await owner.post(`/api/field/work-orders/${S.wo.id}/close`, {}, { expect: 400 });
  });

  it('schedules and dispatches to a technician (notification), shows on the board and in my-day', async () => {
    const start = new Date(`${today}T09:00:00+03:00`).toISOString();
    const end = new Date(`${today}T12:00:00+03:00`).toISOString();
    await tech.post(`/api/field/work-orders/${S.wo.id}/schedule`, { technicianId: S.tech1, scheduledStart: start, scheduledEnd: end }, { expect: 403 });
    const s = await owner.post(`/api/field/work-orders/${S.wo.id}/schedule`, { technicianId: S.tech1, crewIds: [], scheduledStart: start, scheduledEnd: end });
    expect(s.status).toBe('scheduled');
    expect(s.technicianName).toBeTruthy();
    const d = await owner.post(`/api/field/work-orders/${S.wo.id}/dispatch`, {});
    expect(d.status).toBe('dispatched');

    const sql = ADMIN_SQL();
    const notes = await sql`select title_ar from notification where user_id = ${S.tech1} and kind = 'work_order'`;
    await sql.end();
    expect(notes.some((n: any) => n.title_ar.includes(S.wo.number))).toBe(true);

    const board = await owner.get(`/api/field/dispatch-board?from=${today}&to=${today}`);
    const lane = board.technicians.find((t: any) => t.id === S.tech1);
    expect(lane.isTechnician).toBe(true);
    expect(lane.workOrders.map((w: any) => w.id)).toContain(S.wo.id);
    expect(board.technicians.some((t: any) => t.id === S.tech2)).toBe(true);

    const day = await tech.get(`/api/field/my-day?date=${today}`);
    expect(day.today.map((w: any) => w.id)).toEqual([S.wo.id]);
    expect(day.today[0].contactPhone).toBe('+966551112222');
    expect(day.today[0].navUrl).toContain('21.5');
  });

  it('keeps technicians to their own work orders', async () => {
    const other = await owner.post('/api/field/work-orders', { type: 'inspection', title: 'فحص دوري', siteId: S.site.id });
    expect(other.coverage).toBe('chargeable');
    S.other = other;
    const mine = await tech.get('/api/field/work-orders');
    expect(mine.rows.map((w: any) => w.id)).toEqual([S.wo.id]);
    expect((await tech2.get('/api/field/work-orders')).total).toBe(0);
    await tech.get(`/api/field/work-orders/${other.id}`, { expect: 403 });
    await tech2.get(`/api/field/work-orders/${S.wo.id}`, { expect: 403 });
    await tech2.post(`/api/field/work-orders/${S.wo.id}/start-travel`, {}, { expect: 403 });
    // a technician may open a work order (workorder.write own) — it is theirs as owner
    const own = await tech.post('/api/field/work-orders', { type: 'survey', title: 'معاينة سريعة', siteId: S.site.id });
    expect(own.ownerId).toBe(S.tech1);
    expect(own.checklist.map((c: any) => c.key)).toEqual(['door_hand', 'cable_route', 'rack_position', 'measurements']);
  });

  it('runs travel → check-in → blocked completion → evidence → completion (ticket resolved, report stored)', async () => {
    const tr = await tech.post(`/api/field/work-orders/${S.wo.id}/start-travel`, {});
    expect(tr.status).toBe('en_route');
    expect(tr.timeEntries.map((t: any) => t.kind)).toEqual(['travel']);
    const ci = await tech.post(`/api/field/work-orders/${S.wo.id}/check-in`, { lat: 21.5001, lng: 39.2001 });
    expect(ci.status).toBe('on_site');
    expect(ci.checkInLat).toBe('21.5001');
    // geofence (FSM-49): ~15 m from the site pin → inside
    expect(ci.checkInDistanceM).toBeLessThan(300);
    expect(ci.checkInOutsideGeofence).toBe(false);
    expect(ci.timeEntries.find((t: any) => t.kind === 'travel').endedAt).toBeTruthy();
    expect(ci.timeEntries.find((t: any) => t.kind === 'work').endedAt).toBeNull();

    const res = await fetch(`${base}/api/field/work-orders/${S.wo.id}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999', Cookie: tech.cookie }, body: '{}' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.missing.map((m: any) => m.key)).toEqual(['check:diagnosis', 'check:fixed', 'check:tested', 'photos', 'signature']);

    await tech.put(`/api/field/work-orders/${S.wo.id}/checklist`, { items: [{ key: 'nope', done: true }] }, { expect: 400 });
    await tech.put(`/api/field/work-orders/${S.wo.id}/checklist`, { items: [{ key: 'diagnosis', done: true, value: 'تلف في الشاشة' }, { key: 'fixed', done: true }, { key: 'tested', done: true }] });
    const ph = await tech.post(`/api/field/work-orders/${S.wo.id}/photos`, { name: 'before.png', contentType: 'image/png', data: PNG_1PX });
    expect(ph.photos).toHaveLength(1);
    expect(ph.photos[0].url).toBe(`/api/files/${ph.photos[0].fileId}`);
    await tech.put(`/api/field/work-orders/${S.wo.id}/parts`, { parts: [{ code: 'IM-7', description: 'شاشة داخلية', qty: 1, serial: 'NEW-77' }] });
    await tech.put(`/api/field/work-orders/${S.wo.id}/findings`, { findings: 'تم استبدال الشاشة الداخلية.' });
    await tech.post(`/api/field/work-orders/${S.wo.id}/sign`, { signatureName: 'ساكن 203', signatureImage: 'data:image/jpeg;base64,AAAA' }, { expect: 400 });
    const signed = await tech.post(`/api/field/work-orders/${S.wo.id}/sign`, { signatureName: 'ساكن 203', signatureImage: `data:image/png;base64,${PNG_1PX}` });
    expect(signed.signatureFileId).toBeTruthy();
    expect(signed.missing).toEqual([]);

    const done = await tech.post(`/api/field/work-orders/${S.wo.id}/complete`, {});
    expect(done.status).toBe('completed');
    expect(done.checkOutAt).toBeTruthy();
    expect(done.ticket.status).toBe('resolved');
    expect(done.timeEntries.every((t: any) => t.endedAt && t.hours !== null)).toBe(true);
    if (pdfs) {
      expect(done.reportError).toBeNull();
      expect(done.reportFileId).toBeTruthy();
      const pdf = await tech.get(`/api/files/${done.reportFileId}`, { raw: true });
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      const sent = await tech.post(`/api/field/work-orders/${S.wo.id}/send-report`, {});
      expect(sent.status).toBe('sandboxed');
      expect(sent.to).toBe('+966551112222');
      const pub = await fetch(sent.link.replace('http://localhost:3999', base));
      expect(pub.status).toBe(200);
      expect(pub.headers.get('content-type')).toContain('application/pdf');
      const bad = await fetch(`${base}/api/field/public/reports/${encodeURIComponent(sent.link.split('/').pop()!.slice(0, -2))}xx`);
      expect(bad.status).toBe(404);
    } else {
      expect(done.reportError).toBeTruthy();
      await tech.post(`/api/field/work-orders/${S.wo.id}/send-report`, {}, { expect: 400 });
    }
    // evidence is frozen after completion; the technician cannot close (dispatch only)
    await tech.put(`/api/field/work-orders/${S.wo.id}/findings`, { findings: 'x' }, { expect: 400 });
    await tech.post(`/api/field/work-orders/${S.wo.id}/close`, {}, { expect: 403 });
    const closed = await owner.post(`/api/field/work-orders/${S.wo.id}/close`, {});
    expect(closed.status).toBe('closed');
    await owner.post(`/api/field/work-orders/${S.wo.id}/reopen`, { reason: 'x' }, { expect: 400 });
  });

  it('installation work orders need registered devices; devices registered on site inherit the work order site/project', async () => {
    const wo = await owner.post('/api/field/work-orders', { type: 'installation', title: 'تركيب الوحدات', siteId: S.site.id, locationId: S.u101.id });
    const start = new Date(`${today}T13:00:00+03:00`).toISOString();
    const end = new Date(`${today}T17:00:00+03:00`).toISOString();
    await owner.post(`/api/field/work-orders/${wo.id}/schedule`, { technicianId: S.tech2, crewIds: [S.tech1], scheduledStart: start, scheduledEnd: end });
    await owner.post(`/api/field/work-orders/${wo.id}/dispatch`, {});
    // crew member may work on it too
    expect((await tech.get(`/api/field/work-orders/${wo.id}`)).id).toBe(wo.id);
    await tech2.post(`/api/field/work-orders/${wo.id}/check-in`, {}); // dispatched → on_site directly
    await tech2.put(`/api/field/work-orders/${wo.id}/checklist`, { items: ['mounted', 'cabled', 'labelled', 'site_clean'].map((key) => ({ key, done: true })) });
    await tech2.post(`/api/field/work-orders/${wo.id}/photos`, { name: 'after.png', contentType: 'image/png', data: PNG_1PX });
    await tech2.post(`/api/field/work-orders/${wo.id}/sign`, { signatureName: 'المالك' });
    const r = await fetch(`${base}/api/field/work-orders/${wo.id}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999', Cookie: tech2.cookie }, body: '{}' });
    expect(r.status).toBe(400);
    expect((await r.json()).missing.map((m: any) => m.key)).toEqual(['assets']);
    const a = await tech2.post('/api/field/assets', { code: 'IM-7', serial: 'INST-1', mac: '0a0b0c0d0e0f', workOrderId: wo.id });
    expect(a.siteId).toBe(S.site.id);
    expect(a.locationPath).toBe('B1/F1/U101');
    expect(a.installedOn).toBe(today);
    // a technician cannot edit a device registered by someone else outside their work orders
    await tech2.put(`/api/field/assets/${S.asset.id}`, { ...pick(S.asset), firmware: '9' }, { expect: 403 });
    const done = await tech2.post(`/api/field/work-orders/${wo.id}/complete`, {});
    expect(done.status).toBe('completed');
    expect(done.assets.map((x: any) => x.serial)).toEqual(['INST-1']);
  });

  it('awaiting parts → reschedule, and cancellation rules', async () => {
    const wo = S.other;
    const start = new Date(`${addDays(today, 1)}T09:00:00+03:00`).toISOString();
    const end = new Date(`${addDays(today, 1)}T10:00:00+03:00`).toISOString();
    await owner.post(`/api/field/work-orders/${wo.id}/schedule`, { technicianId: S.tech1, scheduledStart: start, scheduledEnd: end });
    await owner.post(`/api/field/work-orders/${wo.id}/dispatch`, {});
    await tech.post(`/api/field/work-orders/${wo.id}/check-in`, {});
    const ap = await tech.post(`/api/field/work-orders/${wo.id}/awaiting-parts`, { note: 'قفل مغناطيسي' });
    expect(ap.status).toBe('awaiting_parts');
    expect(ap.findings).toContain('قفل مغناطيسي');
    await owner.post(`/api/field/work-orders/${wo.id}/cancel`, { reason: 'x' }, { expect: 400 }); // awaiting_parts → cancelled not allowed
    const re = await owner.post(`/api/field/work-orders/${wo.id}/schedule`, { technicianId: S.tech1, scheduledStart: start, scheduledEnd: end });
    expect(re.status).toBe('scheduled');
    const c = await owner.post(`/api/field/work-orders/${wo.id}/cancel`, { reason: 'العميل ألغى' });
    expect(c.status).toBe('cancelled');
  });

  it('shows the device timeline with its work orders and tickets', async () => {
    const d = await owner.get(`/api/field/assets/${S.asset.id}`);
    expect(d.coverageToday.coverage).toBe('warranty');
    expect(d.workOrders.map((w: any) => w.id)).toContain(S.wo.id);
    expect(d.timeline.some((x: any) => x.kind === 'ticket' && x.id === S.ticket.id)).toBe(true);
    expect(d.timeline.some((x: any) => x.kind === 'test' && x.passed === true)).toBe(true);
  });
});

describe('KSA scheduling rules and geofence (FSM-27, FSM-49)', () => {
  it('stores soft warnings with the booking: Friday → non-business day; outdoor July 13:00 → heat ban', async () => {
    const wo = await owner.post('/api/field/work-orders', { type: 'installation', title: 'تركيب وحدة خارجية', siteId: S.site.id });
    expect(wo.outdoor).toBe(false);
    expect(wo.scheduleWarnings).toEqual([]);
    // 2026-10-16 is a Friday
    const fri = await owner.post(`/api/field/work-orders/${wo.id}/schedule`, { technicianId: S.tech1, scheduledStart: '2026-10-16T09:00:00+03:00', scheduledEnd: '2026-10-16T10:00:00+03:00' });
    expect(fri.status).toBe('scheduled');
    expect(fri.scheduleWarnings.map((w: any) => w.key)).toContain('non_business_day');
    expect(fri.scheduleWarnings[0].ar).toBeTruthy();
    expect(fri.scheduleWarnings[0].en).toBeTruthy();
    // re-book outdoors on Monday 2027-07-12 13:00–14:00 (inside the 15 Jun–15 Sep midday ban)
    const july = await owner.post(`/api/field/work-orders/${wo.id}/schedule`, { technicianId: S.tech1, scheduledStart: '2027-07-12T13:00:00+03:00', scheduledEnd: '2027-07-12T14:00:00+03:00', outdoor: true });
    const keys = july.scheduleWarnings.map((w: any) => w.key);
    expect(july.outdoor).toBe(true);
    expect(keys).toContain('heat_ban');
    expect(keys).not.toContain('non_business_day');
    // the same slot indoors → no heat warning (re-computed when the outdoor flag changes)
    const indoor = await owner.put(`/api/field/work-orders/${wo.id}`, { title: wo.title, siteId: S.site.id, outdoor: false });
    expect(indoor.scheduleWarnings.map((w: any) => w.key)).not.toContain('heat_ban');
    await owner.put(`/api/field/work-orders/${wo.id}`, { title: wo.title, siteId: S.site.id, outdoor: true });
    const board = await owner.get('/api/field/dispatch-board?from=2027-07-12&to=2027-07-12');
    const card = board.technicians.find((t: any) => t.id === S.tech1).workOrders.find((w: any) => w.id === wo.id);
    expect(card.scheduleWarnings.map((w: any) => w.key)).toContain('heat_ban');
    S.ksa = wo;
  });

  it('flags a check-in far from the site pin without blocking it', async () => {
    await owner.post(`/api/field/work-orders/${S.ksa.id}/dispatch`, {});
    const ci = await tech.post(`/api/field/work-orders/${S.ksa.id}/check-in`, { lat: 21.51, lng: 39.2 }); // ≈ 1.1 km north
    expect(ci.status).toBe('on_site');
    expect(ci.checkInDistanceM).toBeGreaterThan(1000);
    expect(ci.checkInDistanceM).toBeLessThan(1200);
    expect(ci.checkInOutsideGeofence).toBe(true);
    // no GPS → nothing to compare, nothing flagged
    const other = await owner.post('/api/field/work-orders', { type: 'inspection', title: 'فحص بدون موقع', siteId: S.site.id });
    await owner.post(`/api/field/work-orders/${other.id}/schedule`, { technicianId: S.tech1, scheduledStart: '2027-07-13T08:00:00+03:00', scheduledEnd: '2027-07-13T09:00:00+03:00' });
    await owner.post(`/api/field/work-orders/${other.id}/dispatch`, {});
    const none = await tech.post(`/api/field/work-orders/${other.id}/check-in`, {});
    expect(none.checkInDistanceM).toBeNull();
    expect(none.checkInOutsideGeofence).toBeNull();
  });
});

describe('staff file upload (POST /api/files)', () => {
  it('stores images and PDFs for any signed-in user and serves them back', async () => {
    const img = await tech.post('/api/files', { name: 'snag.png', contentType: 'image/png', data: PNG_1PX });
    expect(img.id).toBeTruthy();
    expect(img.url).toBe(`/api/files/${img.id}`);
    const back = await tech.get(img.url, { raw: true }) as Buffer;
    expect(back.equals(Buffer.from(PNG_1PX, 'base64'))).toBe(true);
    const pdf = await owner.post('/api/files', { name: 'acceptance.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64') });
    expect(pdf.mime).toBe('application/pdf');
  });

  it('refuses other types, mismatched content, oversize files and anonymous callers', async () => {
    await owner.post('/api/files', { name: 'x.txt', contentType: 'text/plain', data: Buffer.from('hello').toString('base64') }, { expect: 400 });
    await owner.post('/api/files', { name: 'fake.png', contentType: 'image/png', data: Buffer.from('MZ not a png').toString('base64') }, { expect: 400 });
    const big = Buffer.alloc(8 * 1024 * 1024 + 10);
    big.write('%PDF-1.4');
    await owner.post('/api/files', { name: 'big.pdf', contentType: 'application/pdf', data: big.toString('base64') }, { expect: 400 });
    await new Client(base).post('/api/files', { name: 'a.png', contentType: 'image/png', data: PNG_1PX }, { expect: 401 });
  });
});

function pick(a: any) {
  return { code: a.code, serial: a.serial, mac: a.mac, ip: a.ip, firmware: a.firmware, siteId: a.siteId, locationId: a.locationId, installedOn: a.installedOn, attributes: a.attributes ?? {} };
}
