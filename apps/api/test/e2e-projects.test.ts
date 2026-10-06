import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businessDaysBetween, quotePrefix, riyadhDate, warrantyEnds } from '@mmc/domain';
import { ADMIN_SQL, Client, gotenbergUp, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Projects (module 05): auto-creation on signing, stage gates (advance + approvals, 40% + materials,
 * devices, tests + final invoice, snags + acceptance), logged overrides, the delivery clock with
 * pauses/extensions, warranty dates on acceptance and the handover package.
 *
 * Order-independent from e2e.test.ts: gives back the daily quote numbers it used.
 */
let base = '';
let owner: Client;
let pm: Client;
let rep: Client;
const S: Record<string, any> = {};
const myQuotes: string[] = [];
const today = riyadhDate();

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function signedContract(lines: any[]) {
  const q = await owner.post('/api/quotes', { partyId: S.party.id, clientName: 'عميل المشاريع', clientPhone: '0551234567', projectName: 'فيلا الاختبار', discountType: 'amount', discountValue: '0', vatOn: true, lines });
  myQuotes.push(q.id);
  expect((await owner.post(`/api/quotes/${q.id}/submit`)).status).toBe('approved');
  const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
  await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
  return owner.get(`/api/contracts/${c.id}`);
}

async function pay(milestoneId: string, ref: string) {
  const pr = await owner.post(`/api/finance/milestones/${milestoneId}/request`, { dueDate: today });
  await owner.post(`/api/finance/payment-requests/${pr.id}/payments`, { amount: pr.amount, paidOn: today, method: 'bank_transfer', reference: ref });
  return pr;
}

const failedKeys = async (path: string, body: unknown, who: Client = owner) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999', Cookie: who.cookie }, body: JSON.stringify(body) });
  expect(res.status).toBe(400);
  const j = await res.json();
  return (j.details?.failed ?? []).map((c: any) => c.key);
};

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const invite = async (email: string, roleKeys: string[]) => {
    const users = await owner.get('/api/users');
    if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
    return signInOrUp(base, email);
  };
  pm = await invite('prj-pm@e2e.test', ['project_manager']);
  rep = await invite('prj-rep@e2e.test', ['sales_rep']);
  S.party = await owner.post('/api/parties', { nameAr: 'شركة المشاريع التجريبية', contacts: [{ name: 'سالم', mobile: '0559876500', isPrimary: true }] });
  const cal = await owner.get('/api/calendar');
  S.cal = { workingDays: cal.workingDays, holidays: cal.holidays.map((h: any) => h.date) };
});

afterAll(async () => {
  try {
    if (myQuotes.length) {
      const sql = ADMIN_SQL();
      const prefix = quotePrefix();
      await sql`update quote set number = 'PJ-' || number where id in ${sql(myQuotes)} and number like ${`${prefix}%`}`;
      await sql`update numbering_counter nc set last_value = coalesce((select max(substring(q.number from ${prefix.length + 1}::int)::int) from quote q where q.number like ${`${prefix}%`}), 0)
        from numbering_series s where s.id = nc.series_id and s.document_type = 'quote' and nc.period_key = ${today}`;
      await sql.end();
    }
  } finally {
    await stopServer();
  }
});

describe('Project creation', () => {
  it('creates the project when the contract is signed (idempotent) and seeds template tasks', async () => {
    const c = await signedContract([{ code: 'SYS', description: 'نظام انتركوم فيلا', unitPrice: '10000', qty: '1' }]);
    expect(c.milestones).toHaveLength(3);
    const list = await owner.get(`/api/projects?q=${encodeURIComponent(c.number)}`);
    expect(list.total).toBe(1);
    const row = list.rows[0];
    expect(row).toMatchObject({ contractId: c.id, stage: 'kickoff', status: 'active', name: 'فيلا الاختبار', customerName: 'شركة المشاريع التجريبية', templateKey: 'villa_intercom' });
    expect(row.number).toMatch(/^PRJ-\d{4}$/);
    expect(row.clock.level).toBe('not_started');

    const p = await owner.post(`/api/projects/from-contract/${c.id}`, { templateKey: 'building_intercom' });
    expect(p.id).toBe(row.id);
    expect(p.templateKey).toBe('building_intercom');
    expect(p.tasks.some((t: any) => t.title.includes('ترقيم الشقق'))).toBe(true);
    expect(p.tasks.some((t: any) => t.title === 'تركيب الشاشات الداخلية')).toBe(false);
    expect(p.contract).toMatchObject({ number: c.number, total: c.total });
    expect(p.milestones.map((m: any) => Number(m.percent))).toEqual([50, 40, 10]);
    expect(p.gate).toMatchObject({ from: 'kickoff', to: 'procurement', ok: false });
    expect(p.stageLog).toHaveLength(1);

    // A draft contract cannot become a project.
    const q = await owner.post('/api/quotes', { partyId: S.party.id, clientName: 'مسودة', discountType: 'amount', discountValue: '0', vatOn: true, lines: [{ code: 'X', description: 'x', unitPrice: '10', qty: '1' }] });
    myQuotes.push(q.id);
    await owner.post(`/api/quotes/${q.id}/submit`);
    const draft = await owner.post(`/api/contracts/from-quote/${q.id}`);
    await owner.post(`/api/projects/from-contract/${draft.id}`, {}, { expect: 400 });
    S.c1 = c;
    S.p1 = p;
  });

  it('manages tasks', async () => {
    const t = await owner.post(`/api/projects/${S.p1.id}/tasks`, { title: 'مهمة إضافية', dueDate: today });
    expect(t.stage).toBe('kickoff');
    const done = await owner.put(`/api/projects/tasks/${t.id}`, { status: 'done' });
    expect(done.doneAt).toBeTruthy();
    expect((await owner.put(`/api/projects/tasks/${t.id}`, { status: 'todo' })).doneAt).toBeNull();
    await owner.req('DELETE', `/api/projects/tasks/${t.id}`);
    await owner.req('DELETE', `/api/projects/tasks/${t.id}`, undefined, { expect: 404 });
  });
});

describe('Stage gates', () => {
  it('blocks kick-off until the advance is paid and every client approval is signed', async () => {
    await rep.post(`/api/projects/${S.p1.id}/advance`, {}, { expect: 403 });
    expect(await failedKeys(`/api/projects/${S.p1.id}/advance`, {})).toEqual(['advance', 'approval:specs', 'approval:door_directions', 'approval:room_numbers', 'approval:design']);

    await pay(S.c1.milestones[0].id, 'PRJ-ADV');
    let p = await owner.get(`/api/projects/${S.p1.id}`);
    expect(p.facts.advancePaidOn).toBe(today);
    expect(p.gate.checks.find((c: any) => c.key === 'advance').ok).toBe(true);
    expect(p.clock.started).toBe(false);

    const ids: Record<string, string> = {};
    for (const kind of ['specs', 'door_directions', 'room_numbers', 'design']) ids[kind] = (await owner.post(`/api/projects/${S.p1.id}/approvals`, { kind, title: `اعتماد ${kind}` })).id;
    await owner.post(`/api/projects/${S.p1.id}/approvals`, { kind: 'specs', title: 'مكرر' }, { expect: 409 });
    expect((await owner.post(`/api/projects/approvals/${ids.specs}/send`)).status).toBe('sent');
    expect((await owner.post(`/api/projects/approvals/${ids.specs}/reject`, { reason: 'تعديل الموديل' })).status).toBe('rejected');
    const rev = await owner.post(`/api/projects/approvals/${ids.specs}/revise`, { notes: 'بعد التعديل' });
    expect(rev).toMatchObject({ kind: 'specs', revision: 1, status: 'draft' });
    await owner.post(`/api/projects/approvals/${ids.specs}/approve`, { approvedByName: 'x' }, { expect: 400 }); // superseded
    await owner.post(`/api/projects/approvals/${rev.id}/approve`, { approvedByName: 'م. سالم', approvedOn: addDays(today, 1) }, { expect: 400 }); // future
    for (const id of [rev.id, ids.door_directions, ids.room_numbers]) await owner.post(`/api/projects/approvals/${id}/approve`, { approvedByName: 'م. سالم' });
    expect(await failedKeys(`/api/projects/${S.p1.id}/advance`, {})).toEqual(['approval:design']);
    await owner.post(`/api/projects/approvals/${ids.design}/approve`, { approvedByName: 'م. سالم', approvedOn: today });

    // Approving the last one doesn't move the stage — but the gate is open and the clock runs.
    p = await owner.get(`/api/projects/${S.p1.id}`);
    expect(p.stage).toBe('kickoff');
    expect(p.gate.ok).toBe(true);
    expect(p.clock).toMatchObject({ started: true, startDate: today, level: 'ok', maxDays: 60 });
    const specs = p.approvals.find((g: any) => g.kind === 'specs');
    expect(specs.latest).toMatchObject({ revision: 1, status: 'approved' });
    expect(specs.history.map((h: any) => h.status)).toEqual(['approved', 'superseded']);

    p = await owner.post(`/api/projects/${S.p1.id}/advance`, {});
    expect(p).toMatchObject({ stage: 'procurement', clockStartedOn: today });
    expect(p.stageLog[0]).toMatchObject({ fromStage: 'kickoff', toStage: 'procurement', overriddenChecks: [] });
  });

  it('needs the 40% payment and materials before delivery, devices before commissioning', async () => {
    expect(await failedKeys(`/api/projects/${S.p1.id}/advance`, {})).toEqual(['delivery_payment', 'materials']);
    await pay(S.c1.milestones[1].id, 'PRJ-40');
    expect(await failedKeys(`/api/projects/${S.p1.id}/advance`, {})).toEqual(['materials']);
    expect((await owner.put(`/api/projects/${S.p1.id}`, { materialsReady: true, managerId: null, notes: 'جاهز' })).materialsReady).toBe(true);
    expect((await owner.post(`/api/projects/${S.p1.id}/advance`, {})).stage).toBe('delivery');
    expect((await owner.post(`/api/projects/${S.p1.id}/advance`, {})).stage).toBe('installation');
    expect(await failedKeys(`/api/projects/${S.p1.id}/advance`, {})).toEqual(['assets']);

    // Register devices directly (the field-service API owns registration).
    const sql = ADMIN_SQL();
    const [p] = await sql`select tenant_id, party_id from project where id = ${S.p1.id}`;
    const [st] = await sql`insert into site (tenant_id, party_id, name, city) values (${p!.tenant_id}, ${p!.party_id}, 'موقع الفيلا', 'جدة') returning id`;
    await sql`update project set site_id = ${st!.id} where id = ${S.p1.id}`;
    const [bld] = await sql`insert into site_location (tenant_id, site_id, kind, name) values (${p!.tenant_id}, ${st!.id}, 'building', 'Tower A') returning id`;
    const [unit] = await sql`insert into site_location (tenant_id, site_id, parent_id, kind, name) values (${p!.tenant_id}, ${st!.id}, ${bld!.id}, 'unit', 'Unit 101') returning id`;
    const serial = `SN-PRJ-${Date.now()}`;
    const [a1] = await sql`insert into installed_asset (tenant_id, site_id, party_id, location_id, project_id, code, description, serial, mac, ip, firmware, attributes, installed_on)
      values (${p!.tenant_id}, ${st!.id}, ${p!.party_id}, ${unit!.id}, ${S.p1.id}, 'DS-OUT', 'وحدة خارجية', ${serial}, 'AA:BB:CC:DD:EE:01', '10.0.0.21', 'v2.1.0', ${sql.json({ password: 'S3cretPass!', sip: '101' })}, ${today}) returning id`;
    const [a2] = await sql`insert into installed_asset (tenant_id, site_id, party_id, project_id, code, serial, installed_on)
      values (${p!.tenant_id}, ${st!.id}, ${p!.party_id}, ${S.p1.id}, 'DS-IN', ${`${serial}-2`}, ${today}) returning id`;
    await sql.end();
    S.serial = serial;
    S.assets = [a1!.id, a2!.id];

    const view = await owner.get(`/api/projects/${S.p1.id}`);
    expect(view.assets).toHaveLength(2);
    expect(view.assets.find((x: any) => x.code === 'DS-OUT').locationPath).toBe('Tower A / Unit 101');
    expect(view.facts).toMatchObject({ assetCount: 2, assetsUntested: 2 });
    await rep.get(`/api/projects/${S.p1.id}`, { expect: 403 });
    expect((await owner.post(`/api/projects/${S.p1.id}/advance`, {})).stage).toBe('commissioning');
  });

  it('needs passed tests and the final payment request before handover', async () => {
    expect(await failedKeys(`/api/projects/${S.p1.id}/advance`, {})).toEqual(['tests', 'final_invoice']);
    const sql = ADMIN_SQL();
    await sql`update installed_asset set test_passed = true, tested_on = ${today} where id = ${S.assets[0]}`;
    expect(await failedKeys(`/api/projects/${S.p1.id}/advance`, {})).toEqual(['tests', 'final_invoice']);
    await sql`update installed_asset set test_passed = true, tested_on = ${today} where id = ${S.assets[1]}`;
    await sql.end();
    await owner.post(`/api/finance/milestones/${S.c1.milestones[2].id}/request`, {}); // issues the final 388
    const p = await owner.post(`/api/projects/${S.p1.id}/advance`, {});
    expect(p).toMatchObject({ stage: 'handover', deliveredOn: today });
    expect(p.clock.level).toBe('stopped');
  });

  it('closes snags and records acceptance → warranty dates on every device', async () => {
    await owner.post(`/api/projects/${S.p1.id}/accept`, { acceptedOn: addDays(today, 1), acceptedByName: 'سالم' }, { expect: 400 });
    const s = await owner.post(`/api/projects/${S.p1.id}/snags`, { description: 'تعديل زاوية الكاميرا', dueDate: today });
    expect(s.status).toBe('open');
    expect(await failedKeys(`/api/projects/${S.p1.id}/advance`, {})).toEqual(['snags', 'acceptance']);
    await owner.post(`/api/projects/snags/${s.id}/verify`, {}, { expect: 400 }); // not fixed yet
    await rep.post(`/api/projects/snags/${s.id}/fix`, {}, { expect: 403 });
    expect((await owner.post(`/api/projects/snags/${s.id}/fix`)).status).toBe('fixed');
    expect((await owner.post(`/api/projects/snags/${s.id}/reopen`, { reason: 'لم يُصلح' })).status).toBe('open');
    await owner.post(`/api/projects/snags/${s.id}/fix`);
    const v = await pm.post(`/api/projects/snags/${s.id}/verify`);
    expect(v.status).toBe('verified');
    expect(v.verifiedBy).toBeTruthy();

    const acc = await owner.post(`/api/projects/${S.p1.id}/accept`, { acceptedOn: today, acceptedByName: 'سالم العميل' });
    expect(acc).toMatchObject({ acceptedOn: today, acceptedByName: 'سالم العميل', stage: 'handover' });
    expect(acc.gate.ok).toBe(true);
    const p = await owner.post(`/api/projects/${S.p1.id}/advance`, {});
    expect(p.stage).toBe('warranty');
    const ends = warrantyEnds(today, p.warrantyLabourMonths, p.warrantyPartsMonths);
    expect(p.assets.every((a: any) => a.labourWarrantyEnd === ends.labourEnd && a.partsWarrantyEnd === ends.partsEnd)).toBe(true);
    await owner.post(`/api/projects/${S.p1.id}/accept`, { acceptedOn: today, acceptedByName: 'x' }, { expect: 400 }); // not in handover any more
  });

  it('builds the handover package with the device schedule and never prints credentials', async () => {
    const res = await fetch(`${base}/api/projects/${S.p1.id}/handover`, { headers: { Cookie: owner.cookie, Origin: 'http://localhost:3999' } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(S.serial);
    expect(html).toContain('AA:BB:CC:DD:EE:01');
    expect(html).toContain('Tower A / Unit 101');
    expect(html).toContain('Project Handover Package');
    expect(html).toContain('سالم العميل');
    expect(html).not.toContain('S3cretPass');
    expect(html.toLowerCase()).not.toContain('password');
    await rep.get(`/api/projects/${S.p1.id}/handover`, { expect: 403 });
    if (await gotenbergUp()) {
      const pdf = await owner.get<Buffer>(`/api/projects/${S.p1.id}/handover.pdf`, { raw: true });
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});

describe('Overrides and the delivery clock', () => {
  it('overrides a failed gate only with project.override and a reason, and logs it', async () => {
    const c = await signedContract([{ code: 'LOCK', description: 'قفل ذكي', unitPrice: '2000', qty: '3' }]);
    const p0 = (await owner.get(`/api/projects?q=${encodeURIComponent(c.number)}`)).rows[0];
    await rep.post(`/api/projects/${p0.id}/advance`, { override: true, reason: 'x' }, { expect: 403 });
    await failedKeys(`/api/projects/${p0.id}/advance`, {}, pm);
    await pm.post(`/api/projects/${p0.id}/advance`, { override: true }, { expect: 400 }); // no reason
    const p = await pm.post(`/api/projects/${p0.id}/advance`, { override: true, reason: 'تعليمات المدير العام لبدء التوريد' });
    expect(p).toMatchObject({ stage: 'procurement', clockStartedOn: today });
    expect(p.stageLog[0]).toMatchObject({ fromStage: 'kickoff', toStage: 'procurement', reason: 'تعليمات المدير العام لبدء التوريد' });
    expect(p.stageLog[0].overriddenChecks).toEqual(['advance', 'approval:specs', 'approval:door_directions', 'approval:room_numbers', 'approval:design']);
    expect(p.stageLog[0].byName).toBeTruthy();

    // Moving back needs project.override and resets the clock start on kick-off.
    await owner.post(`/api/projects/${p0.id}/stage`, { to: 'delivery', reason: 'x' }, { expect: 400 });
    const back = await pm.post(`/api/projects/${p0.id}/stage`, { to: 'kickoff', reason: 'خطأ في النقل' });
    expect(back).toMatchObject({ stage: 'kickoff', clockStartedOn: null });
    S.p2 = (await pm.post(`/api/projects/${p0.id}/advance`, { override: true, reason: 'إعادة' }));
  });

  it('excludes pauses from the elapsed working days and extends the window', async () => {
    const start = addDays(today, -40);
    const sql = ADMIN_SQL();
    await sql`update project set clock_started_on = ${start} where id = ${S.p2.id}`;
    await sql.end();
    let p = await owner.get(`/api/projects/${S.p2.id}`);
    const total = businessDaysBetween(start, today, S.cal);
    expect(p.clock).toMatchObject({ started: true, startDate: start, elapsed: total, pausedDays: 0 });

    const from = addDays(start, 7);
    const to = addDays(start, 21);
    p = await owner.post(`/api/projects/${S.p2.id}/pauses`, { fromDate: from, toDate: to, kind: 'client_delay', reason: 'العميل لم يجهز الموقع' });
    const paused = businessDaysBetween(from, to, S.cal);
    expect(paused).toBeGreaterThan(0);
    expect(p.clock).toMatchObject({ elapsed: total - paused, pausedDays: paused, paused: false });

    p = await owner.post(`/api/projects/${S.p2.id}/pauses`, { fromDate: addDays(today, -3), kind: 'consultant_delay', reason: 'بانتظار الاستشاري' });
    expect(p.clock.paused).toBe(true);
    await owner.post(`/api/projects/${S.p2.id}/pauses`, { fromDate: today, reason: 'مكرر' }, { expect: 409 });
    const open = p.pauses.find((x: any) => !x.toDate);
    p = await owner.post(`/api/projects/pauses/${open.id}/end`, { toDate: today });
    expect(p.clock.paused).toBe(false);
    expect(p.clock.pausedDays).toBe(paused + businessDaysBetween(addDays(today, -3), today, S.cal));

    const max0 = p.clock.maxDays;
    p = await owner.post(`/api/projects/${S.p2.id}/extend`, { days: 5, reason: 'أمر تغيير معتمد' });
    expect(p.clockExtensionDays).toBe(5);
    expect(p.clock.maxDays).toBe(max0 + 5);
    await owner.post(`/api/projects/${S.p2.id}/extend`, { days: 0, reason: 'x' }, { expect: 400 });
  });

  it('lists projects with clock summaries and a dashboard summary', async () => {
    const list = await pm.get('/api/projects?stage=procurement,warranty');
    const ids = list.rows.map((r: any) => r.id);
    expect(ids).toContain(S.p1.id);
    expect(ids).toContain(S.p2.id);
    const r2 = list.rows.find((r: any) => r.id === S.p2.id);
    expect(r2.clock).toMatchObject({ startDate: addDays(today, -40), maxDays: 65 });
    expect(r2.customerName).toBe('شركة المشاريع التجريبية');
    const sum = await pm.get('/api/projects/dashboard/summary');
    expect(sum.byStage.procurement).toBeGreaterThanOrEqual(1);
    expect(sum.byStage.warranty).toBeGreaterThanOrEqual(1);
    expect(sum.total).toBeGreaterThanOrEqual(2);
    expect(sum.openSnags).toBeGreaterThanOrEqual(0);
    // A sales rep only sees the projects of contracts they own.
    expect((await rep.get('/api/projects')).rows.some((r: any) => r.id === S.p1.id)).toBe(false);
    const log = await owner.get('/api/audit/verify');
    expect(log.intact).toBe(true);
  });
});
