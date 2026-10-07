import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * FSM-84/85 — knowledge base (Arabic search normalisation, publish/archive, portal shows only
 * published + public, helpful counters, device suggestions), canned replies with placeholders,
 * and the ticket conversation (reply stored + delivered + first response, internal notes hidden
 * from the portal, a customer message reopens a recently resolved ticket).
 */
let base = '';
let owner: Client;
let tech: Client;
const S: Record<string, any> = {};
const PORTAL_PHONE = '0557880001';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function sqlRun<T = any>(fn: (sql: ReturnType<typeof ADMIN_SQL>) => Promise<T>): Promise<T> {
  const sql = ADMIN_SQL();
  try { return await fn(sql); } finally { await sql.end(); }
}

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; expect?: number } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  if (opts.expect !== undefined && res.status !== opts.expect) throw new Error(`${method} ${path} → ${res.status} (expected ${opts.expect}): ${text.slice(0, 400)}`);
  return { status: res.status, json: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null, headers: res.headers };
}
const portal = async (method: string, path: string, body?: unknown, expect = 200) => (await call(method, `/api/portal${path}`, { cookie: S.portalCookie, body, expect })).json;

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  const t = await owner.post('/api/users/invite', { email: 'kb-tech@e2e.test', nameAr: 'فني المعرفة', roleKeys: ['technician'] });
  S.techId = t.id;
  tech = await signInOrUp(base, 'kb-tech@e2e.test');
  S.product = await owner.put('/api/products/new', { code: 'KBT-LOCK-01', nameAr: 'قفل ذكي بالبصمة', nameEn: 'Smart fingerprint lock', listPrice: '900', costPrice: '100', costCurrency: 'USD' });
  S.product2 = await owner.put('/api/products/new', { code: 'KBT-GATE-01', nameAr: 'محرك بوابة', nameEn: 'Gate motor', listPrice: '2500', costPrice: '300', costCurrency: 'USD' });
  S.party = await owner.post('/api/parties', {
    nameAr: 'مجمع قاعدة المعرفة', phone: '0557880009',
    contacts: [{ name: 'أبو فهد', mobile: PORTAL_PHONE, isPrimary: true }],
    sites: [{ type: 'project', name: 'فيلا المعرفة', city: 'الرياض' }],
  });
  S.site = (await owner.get(`/api/parties/${S.party.id}`)).sites[0];
  S.asset = await owner.post('/api/field/assets', { code: 'KBT-LOCK-01', serial: 'KBT-SN-1', siteId: S.site.id });
  S.asset2 = await owner.post('/api/field/assets', { code: 'KBT-GATE-01', serial: 'KBT-SN-2', siteId: S.site.id });
  // portal sign-in
  const acc = await owner.post('/api/portal/accounts', { partyId: S.party.id, phone: PORTAL_PHONE, name: 'أبو فهد' });
  S.account = acc;
  await call('POST', '/api/portal/login/request', { body: { phone: PORTAL_PHONE }, expect: 200 });
  const rows = await sqlRun((sql) => sql`select body from message where template_key = 'portal_otp' and "to" = '+966557880001' order by created_at desc limit 1`);
  const code = /(\d{6})/.exec(rows[0]?.body ?? '')![1]!;
  const ok = await call('POST', '/api/portal/login/verify', { body: { phone: PORTAL_PHONE, code }, expect: 200 });
  S.portalCookie = ok.headers.getSetCookie().find((c) => c.startsWith('mmc_portal='))!.split(';')[0];
});

afterAll(async () => {
  try {
    for (const p of [S.product, S.product2]) if (p?.id) await owner.req('DELETE', `/api/products/${p.id}`, undefined, { expect: 200 });
  } finally {
    await stopServer();
  }
});

describe('knowledge base articles (FSM-85)', () => {
  it('creates drafts with an auto slug, search text and validation', async () => {
    const a = await owner.post('/api/kb/articles', {
      titleAr: 'إعادة ضبط القفل الذكي', titleEn: 'Reset the smart lock',
      bodyAr: '## الخطوات\n- افتح غطاء البطارية\n- اضغط زر **الإعادة** لمدة 5 ثوانٍ\n\nللمزيد [الدليل](https://example.com/manual)',
      bodyEn: 'Open the battery cover and hold **reset** for 5 seconds.', visibility: 'public', productIds: [S.product.id], tags: ['قفل', 'lock'], videoUrl: 'https://youtu.be/xyz',
    });
    expect(a.status).toBe('draft');
    expect(a.slug).toBe('reset-the-smart-lock');
    expect(a.products.map((p: any) => p.code)).toEqual(['KBT-LOCK-01']);
    expect(a.searchText).toBeUndefined();
    S.a1 = a;
    // same title → a different slug; Arabic-only title → Arabic slug
    const dup = await owner.post('/api/kb/articles', { titleAr: 'إعادة ضبط القفل الذكي', titleEn: 'Reset the smart lock', bodyAr: 'نسخة', visibility: 'internal' });
    expect(dup.slug).toBe('reset-the-smart-lock-2');
    S.dup = dup;
    const internal = await owner.post('/api/kb/articles', {
      titleAr: 'صيانة مُحرِّك البوابة', bodyAr: 'تُفحص المسنّنات وتُشحّم كل ستة أشهر — للفنيين فقط.', visibility: 'internal', productIds: [S.product2.id, S.product.id], tags: ['بوابة'],
    });
    expect(internal.slug).toBe('صيانه-محرك-البوابه');
    S.internal = internal;
    S.publicDraft = await owner.post('/api/kb/articles', { titleAr: 'مسودة عامة للقفل', bodyAr: 'لم تنشر بعد', visibility: 'public', productIds: [S.product.id] });
    await owner.post('/api/kb/articles', { titleAr: 'رابط', bodyAr: 'x', videoUrl: 'javascript:alert(1)' }, { expect: 400 });
    await owner.post('/api/kb/articles', { titleAr: 'منتج', bodyAr: 'x', productIds: ['00000000-0000-4000-8000-000000000000'] }, { expect: 400 });
  });

  it('edits with optimistic locking, publishes and archives', async () => {
    const upd = await owner.put(`/api/kb/articles/${S.a1.id}`, { ...pick(S.a1), tags: ['قفل', 'lock', 'بطارية'], version: S.a1.version });
    expect(upd.version).toBe(S.a1.version + 1);
    expect(upd.tags).toContain('بطارية');
    await owner.put(`/api/kb/articles/${S.a1.id}`, { ...pick(S.a1), version: S.a1.version }, { expect: 409 });
    const pub = await owner.post(`/api/kb/articles/${S.a1.id}/publish`);
    expect(pub.status).toBe('published');
    await owner.post(`/api/kb/articles/${S.a1.id}/publish`, undefined, { expect: 400 });
    expect((await owner.post(`/api/kb/articles/${S.internal.id}/publish`)).status).toBe('published');
    expect((await owner.post(`/api/kb/articles/${S.dup.id}/archive`)).status).toBe('archived');
    const audit = await sqlRun((sql) => sql`select action from audit_log where entity_type = 'kb_article' and entity_id = ${S.a1.id} order by at`);
    expect(audit.map((r: any) => r.action)).toEqual(['create', 'update', 'status_published']);
  });

  it('search normalises Arabic: hamza forms, taa marbuta / haa, alef maqsura and tashkeel', async () => {
    const find = async (q: string) => (await owner.get(`/api/kb/articles?q=${encodeURIComponent(q)}`)).rows.map((r: any) => r.id);
    expect(await find('اعادة ضبط')).toContain(S.a1.id); // أ → ا
    expect(await find('اعاده')).toContain(S.a1.id); // ة → ه
    expect(await find('القفل الذكى')).toContain(S.a1.id); // ي ↔ ى
    expect(await find('القُفْلُ')).toContain(S.a1.id); // tashkeel in the query
    expect(await find('محرك')).toContain(S.internal.id); // tashkeel in the article
    expect(await find('البطاريه')).toContain(S.a1.id); // body text
    expect(await find('RESET')).toContain(S.a1.id); // English, case-insensitive
    expect(await find('بوابة')).not.toContain(S.a1.id);
    expect(await find('100%')).toEqual([]);
    // filters
    const pubPublic = (await owner.get('/api/kb/articles?status=published&visibility=public')).rows.map((r: any) => r.id);
    expect(pubPublic).toContain(S.a1.id);
    expect(pubPublic).not.toContain(S.internal.id);
    const byProduct = (await owner.get(`/api/kb/articles?productId=${S.product2.id}`)).rows.map((r: any) => r.id);
    expect(byProduct).toEqual([S.internal.id]);
    const byAsset = (await owner.get(`/api/kb/articles?assetId=${S.asset.id}&status=published`)).rows.map((r: any) => r.id).sort();
    expect(byAsset).toEqual([S.a1.id, S.internal.id].sort());
  });

  it('kb.read without kb.write sees only published articles and cannot edit', async () => {
    const ids = (await tech.get('/api/kb/articles')).rows.map((r: any) => r.id);
    expect(ids).toContain(S.a1.id);
    expect(ids).toContain(S.internal.id);
    expect(ids).not.toContain(S.publicDraft.id);
    expect(ids).not.toContain(S.dup.id);
    await tech.get(`/api/kb/articles/${S.publicDraft.id}`, { expect: 404 });
    await tech.post('/api/kb/articles', { titleAr: 'محاولة', bodyAr: 'x' }, { expect: 403 });
    await tech.post(`/api/kb/articles/${S.a1.id}/archive`, undefined, { expect: 403 });
  });

  it('counts views and helpful feedback', async () => {
    const v1 = await owner.get(`/api/kb/articles/${S.a1.id}`);
    const v2 = await tech.get(`/api/kb/articles/${S.a1.id}`);
    expect(v2.views).toBe(v1.views + 1);
    expect(await tech.post(`/api/kb/articles/${S.a1.id}/feedback`, { helpful: true })).toMatchObject({ helpfulYes: 1, helpfulNo: 0 });
    expect(await owner.post(`/api/kb/articles/${S.a1.id}/feedback`, { helpful: false })).toMatchObject({ helpfulYes: 1, helpfulNo: 1 });
    await tech.post(`/api/kb/articles/${S.publicDraft.id}/feedback`, { helpful: true }, { expect: 404 });
  });
});

describe('portal knowledge base', () => {
  it('lists only published + public articles', async () => {
    const r = await portal('GET', '/kb');
    const ids = r.rows.map((x: any) => x.id);
    expect(ids).toEqual([S.a1.id]);
    expect(Object.keys(r.rows[0])).not.toContain('views');
    expect((await portal('GET', `/kb?q=${encodeURIComponent('اعاده الضبط')}`)).rows).toHaveLength(0);
    expect((await portal('GET', `/kb?q=${encodeURIComponent('اعاده ضبط')}`)).rows.map((x: any) => x.id)).toEqual([S.a1.id]);
    expect((await portal('GET', `/kb?productId=${S.product2.id}`)).rows).toEqual([]);
    // no cookie → 401
    await call('GET', '/api/portal/kb', { expect: 401 });
  });

  it('opens an article by slug (views++), hides internal/draft ones, takes feedback', async () => {
    const before = (await owner.get(`/api/kb/articles/${S.a1.id}`)).views;
    const a = await portal('GET', `/kb/${S.a1.slug}`);
    expect(a.bodyAr).toContain('**الإعادة**');
    expect(a.videoUrl).toBe('https://youtu.be/xyz');
    expect(a).not.toHaveProperty('helpfulYes');
    expect(a).not.toHaveProperty('createdBy');
    expect((await owner.get(`/api/kb/articles/${S.a1.id}`)).views).toBe(before + 2);
    await portal('GET', `/kb/${encodeURIComponent(S.internal.slug)}`, undefined, 404);
    await portal('GET', `/kb/${S.publicDraft.slug}`, undefined, 404);
    await portal('POST', `/kb/${S.a1.slug}/feedback`, { helpful: true });
    expect((await owner.get(`/api/kb/articles/${S.a1.id}`)).helpfulYes).toBe(2);
    await portal('POST', `/kb/${encodeURIComponent(S.internal.slug)}/feedback`, { helpful: true }, 404);
  });

  it('suggests up to 3 public articles for the customer device', async () => {
    const s = await portal('GET', `/kb/suggest?assetId=${S.asset.id}`);
    expect(s.rows.map((x: any) => x.id)).toEqual([S.a1.id]);
    expect((await portal('GET', `/kb/suggest?assetId=${S.asset2.id}`)).rows).toEqual([]);
    // a device of another customer is not found
    const otherParty = await owner.post('/api/parties', { nameAr: 'عميل آخر للمعرفة', phone: '0557880019', sites: [{ type: 'project', name: 'موقع آخر', city: 'جدة' }] });
    const otherSite = (await owner.get(`/api/parties/${otherParty.id}`)).sites[0];
    const other = await owner.post('/api/field/assets', { code: 'KBT-LOCK-01', serial: 'KBT-SN-OTHER', siteId: otherSite.id });
    await portal('GET', `/kb/suggest?assetId=${other.id}`, undefined, 404);
  });
});

describe('canned replies (FSM-84)', () => {
  it('shared replies need kb.write; personal ones belong to their owner; shortcuts are unique', async () => {
    const r = await owner.post('/api/kb/replies', {
      shortcut: 'visit', title: 'موعد زيارة', bodyAr: 'مرحبًا {customer_name}، بخصوص طلبكم {ticket_number} سيزوركم الفني {technician_name}. {unknown}', bodyEn: 'Hi {customer_name}, {technician_name} will visit for {ticket_number}.', shared: true,
    });
    expect(r).toMatchObject({ shared: true, shortcut: 'visit' });
    S.reply = r;
    await tech.post('/api/kb/replies', { shortcut: 'tech-shared', title: 'x', bodyAr: 'x', shared: true }, { expect: 403 });
    const mine = await tech.post('/api/kb/replies', { shortcut: 'onway', title: 'في الطريق', bodyAr: 'أنا في الطريق إليكم' });
    expect(mine).toMatchObject({ shared: false, mine: true });
    S.techReply = mine;
    await owner.post('/api/kb/replies', { shortcut: 'onway', title: 'dup', bodyAr: 'x' }, { expect: 409 });
    expect((await owner.get('/api/kb/replies')).rows.map((x: any) => x.id)).not.toContain(mine.id);
    expect((await tech.get('/api/kb/replies')).rows.map((x: any) => x.id).sort()).toEqual([r.id, mine.id].sort());
    await tech.put(`/api/kb/replies/${r.id}`, { shortcut: 'visit', title: 'x', bodyAr: 'x', shared: true }, { expect: 403 });
    await owner.put(`/api/kb/replies/${mine.id}`, { shortcut: 'onway', title: 'x', bodyAr: 'x' }, { expect: 404 });
    const edited = await tech.put(`/api/kb/replies/${mine.id}`, { shortcut: 'onway', title: 'في الطريق', bodyAr: 'أنا في الطريق إليكم الآن' });
    expect(edited.bodyAr).toContain('الآن');
    await tech.req('DELETE', `/api/kb/replies/${r.id}`, undefined, { expect: 403 });
    await tech.req('DELETE', `/api/kb/replies/${mine.id}`, undefined, { expect: 200 });
  });

  it('renders placeholders from a ticket', async () => {
    const t = await owner.post('/api/field/tickets', { partyId: S.party.id, assetId: S.asset.id, contactName: 'أبو فهد', contactPhone: PORTAL_PHONE, subject: 'القفل لا يستجيب' });
    S.staffTicket = t;
    const wo = await owner.post(`/api/field/tickets/${t.id}/work-order`, {});
    await sqlRun((sql) => sql`update work_order set technician_id = ${S.techId} where id = ${wo.id}`);
    await sqlRun((sql) => sql`update app_user set name_ar = 'فني المعرفة' where id = ${S.techId}`);
    const out = await owner.post(`/api/kb/replies/${S.reply.id}/render`, { ticketId: t.id });
    expect(out.body).toBe(`مرحبًا أبو فهد، بخصوص طلبكم ${t.number} سيزوركم الفني فني المعرفة. {unknown}`);
    const en = await owner.post(`/api/kb/replies/${S.reply.id}/render`, { ticketId: t.id, locale: 'en' });
    expect(en.body).toBe(`Hi أبو فهد, فني المعرفة will visit for ${t.number}.`);
    const plain = await owner.post(`/api/kb/replies/${S.reply.id}/render`, {});
    expect(plain.body).toContain('مرحبًا ، بخصوص طلبكم  سيزوركم');
  });
});

describe('ticket conversation', () => {
  it('a staff reply is stored, delivered (portal + WhatsApp) and stops the response clock', async () => {
    const t = await portal('POST', '/tickets', { assetId: S.asset.id, subject: 'البصمة لا تعمل', description: 'منذ أمس' }, 201);
    S.portalTicket = t;
    expect(t.messages).toEqual([]);
    const before = await owner.get(`/api/field/tickets/${t.id}`);
    expect(before.firstResponseAt).toBeNull();
    const r = await owner.post(`/api/field/tickets/${t.id}/respond`, { note: 'جرّبوا تبديل البطارية\nثم أعيدوا التجربة' });
    expect(r.firstResponseAt).toBeTruthy();
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ author: 'staff', internal: false, deliveredVia: 'portal,whatsapp', authorName: expect.any(String) });
    const [wa] = await sqlRun((sql) => sql`select body, "to", related_type, related_id from message where template_key = 'ticket_reply' and related_id = ${t.id}`);
    expect(wa.to).toBe('+966557880001');
    expect(wa.body).toContain(t.number);
    expect(wa.body).toContain('جرّبوا تبديل البطارية ثم أعيدوا التجربة');
    const first = r.firstResponseAt;
    const again = await owner.post(`/api/field/tickets/${t.id}/respond`, { note: 'تذكير' });
    expect(again.firstResponseAt).toBe(first);
    const p = await portal('GET', `/tickets/${t.id}`);
    expect(p.messages.map((m: any) => m.body)).toEqual(['جرّبوا تبديل البطارية\nثم أعيدوا التجربة', 'تذكير']);
    expect(p.messages[0].author).toBe('staff');
    // the legacy timeline still carries the reply
    expect(p.timeline.some((e: any) => e.kind === 'reply')).toBe(true);
  });

  it('a staff ticket without a portal account goes out by WhatsApp only', async () => {
    const r = await owner.post(`/api/field/tickets/${S.staffTicket.id}/respond`, { note: 'سيصلكم الفني' });
    expect(r.messages.at(-1).deliveredVia).toBe('whatsapp');
  });

  it('internal notes are staff-only and do not stop the response clock', async () => {
    const t = await owner.post('/api/field/tickets', { partyId: S.party.id, subject: 'ملاحظة داخلية فقط' });
    const n = await owner.post(`/api/field/tickets/${t.id}/notes`, { note: 'سري: العميل متأخر في السداد' });
    expect(n.messages[0]).toMatchObject({ internal: true, deliveredVia: 'none' });
    expect(n.firstResponseAt).toBeNull();
    const viaRespond = await owner.post(`/api/field/tickets/${S.portalTicket.id}/respond`, { note: 'سري: قطعة الغيار غير متوفرة', internal: true });
    expect(viaRespond.messages.at(-1).internal).toBe(true);
    const p = await call('GET', `/api/portal/tickets/${S.portalTicket.id}`, { cookie: S.portalCookie, expect: 200 });
    expect(JSON.stringify(p.json)).not.toContain('سري');
    expect(p.json.messages.every((m: any) => !('internal' in m))).toBe(true);
    const staff = await owner.get(`/api/field/tickets/${S.portalTicket.id}`);
    expect(staff.messages.filter((m: any) => m.internal)).toHaveLength(1);
    const wa = await sqlRun((sql) => sql`select count(*)::int as n from message where body like '%سري%'`);
    expect(wa[0].n).toBe(0);
    // technicians (no ticket.write) cannot add notes
    await tech.post(`/api/field/tickets/${t.id}/notes`, { note: 'x' }, { expect: 403 });
  });

  it('a customer message (with a photo) reopens a ticket resolved within 7 days and notifies staff', async () => {
    const id = S.portalTicket.id;
    await owner.post(`/api/field/tickets/${id}/status`, { status: 'resolved' });
    const p = await portal('POST', `/tickets/${id}/messages`, { body: 'ما زالت المشكلة قائمة', photos: [{ name: 'lock.png', contentType: 'image/png', data: PNG_1PX }] }, 201);
    expect(p.status).toBe('open');
    expect(p.resolvedAt).toBeNull();
    const last = p.messages.at(-1);
    expect(last).toMatchObject({ author: 'customer', body: 'ما زالت المشكلة قائمة' });
    expect(last.files).toHaveLength(1);
    await call('GET', last.files[0].url, { cookie: S.portalCookie, expect: 200 });
    const staff = await owner.get(`/api/field/tickets/${id}`);
    expect(staff.status).toBe('open');
    expect(staff.messages.at(-1).author).toBe('customer');
    const notes = await sqlRun((sql) => sql`select title_ar from notification where link = ${`/field/tickets/${id}`} and title_ar like '%أعاد العميل%'`);
    expect(notes.length).toBeGreaterThan(0);
    const log = await sqlRun((sql) => sql`select action from audit_log where entity_type = 'ticket' and entity_id = ${id} and action in ('customer_message', 'status_open')`);
    expect(log.map((l: any) => l.action).sort()).toEqual(['customer_message', 'status_open']);
  });

  it('refuses messages on old resolved or closed tickets and on other customers’ tickets', async () => {
    const id = S.portalTicket.id;
    await owner.post(`/api/field/tickets/${id}/status`, { status: 'resolved' });
    await sqlRun((sql) => sql`update ticket set resolved_at = now() - interval '8 days' where id = ${id}`);
    expect((await portal('GET', `/tickets/${id}`)).canMessage).toBe(false);
    await portal('POST', `/tickets/${id}/messages`, { body: 'مرحبا' }, 400);
    await owner.post(`/api/field/tickets/${id}/status`, { status: 'closed' });
    await portal('POST', `/tickets/${id}/messages`, { body: 'مرحبا' }, 400);
    const other = await owner.post('/api/field/tickets', { subject: 'تذكرة عميل آخر' });
    await portal('POST', `/tickets/${other.id}/messages`, { body: 'مرحبا' }, 404);
    // a closed ticket cannot be replied to by staff either
    await owner.post(`/api/field/tickets/${id}/respond`, { note: 'x' }, { expect: 400 });
  });
});

function pick(a: any) {
  return { titleAr: a.titleAr, titleEn: a.titleEn, bodyAr: a.bodyAr, bodyEn: a.bodyEn, visibility: a.visibility, productIds: a.productIds, tags: a.tags, fileIds: a.fileIds, videoUrl: a.videoUrl, categoryId: a.categoryId };
}
