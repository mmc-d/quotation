import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';
import { validateMatches } from '../src/ai/boq.js';

/**
 * Phase 7c — AI gateway (sandbox mode: no ANTHROPIC_API_KEY): BOQ → draft → human apply → quote,
 * ai.approve enforcement, daily budget, append-only ai_call log with PII redaction, reply drafting /
 * translation, usage, personal tokens and the read-only MCP server with REST-equivalent scope.
 */
let base = '';
let owner: Client;
let rep: Client;
let rep2: Client;
const S: Record<string, any> = {};
const PRODUCTS = [
  { code: 'AIT-CAM-01', nameAr: 'كاميرا قبة آي بي 4 ميجا', nameEn: 'IP dome camera 4MP', listPrice: '450', costPrice: '60' },
  { code: 'AIT-NVR-08', nameAr: 'مسجل شبكي 8 قنوات', nameEn: 'NVR 8 channel', listPrice: '1200', costPrice: '150' },
  { code: 'AIT-SW-24', nameAr: 'سويتش 24 منفذ PoE', nameEn: 'PoE switch 24 port', listPrice: '2100', costPrice: '300' },
];
const BOQ_CSV = [
  'Item,Description,Model,Qty,Unit',
  '1.1,IP dome camera 4MP,AIT-CAM-01,12,Nos',
  '1.2,Network video recorder 8 channel,AIT-NVR-08,1,Nos',
  '1.3,Unknown gadget,ZZZ-404,3,Nos',
  '1.4,Installation and testing - site contact 0551234567 ali@example.com,,1,Lot',
].join('\n');

async function sqlRun<T = any>(fn: (sql: ReturnType<typeof ADMIN_SQL>) => Promise<T>): Promise<T> {
  const sql = ADMIN_SQL();
  try { return await fn(sql); } finally { await sql.end(); }
}

async function invite(email: string, roleKeys: string[]) {
  const users = await owner.get('/api/users');
  if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
  return signInOrUp(base, email);
}

let rpcId = 1;
async function mcp(token: string | null, method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
async function tool(token: string, name: string, args: Record<string, unknown>) {
  const r = await mcp(token, 'tools/call', { name, arguments: args });
  expect(r.status).toBe(200);
  const res = r.json.result;
  return { isError: !!res.isError, text: res.content[0].text as string, data: res.isError ? null : JSON.parse(res.content[0].text) };
}

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  rep = await invite('ai-rep@e2e.test', ['sales_rep']);
  rep2 = await invite('ai-rep2@e2e.test', ['sales_rep']);
  S.products = [];
  for (const p of PRODUCTS) S.products.push(await owner.put('/api/products/new', { ...p, costCurrency: 'USD' }));
  S.party = await owner.post('/api/parties', { nameAr: 'شركة اختبار الذكاء الاصطناعي', phone: '0557000111' });
});

afterAll(async () => {
  delete process.env.AI_DAILY_USD;
  for (const p of S.products ?? []) await owner.req('DELETE', `/api/products/${p.id}`, undefined, { expect: 200 });
  await stopServer();
});

describe('AI-01 BOQ → draft quote (sandbox)', () => {
  it('parses a CSV BOQ, matches known codes, leaves unknown rows unmatched, stores a pending draft', async () => {
    const d = await rep.post('/api/ai/boq', { text: BOQ_CSV, partyId: S.party.id });
    S.draft = d;
    expect(d.status).toBe('pending');
    expect(d.entityType).toBe('quote');
    expect(d.payload.sandbox).toBe(true);
    const rows = d.payload.rows;
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ ref: '1.1', qty: 12 });
    expect(rows[0].matches[0]).toMatchObject({ productCode: 'AIT-CAM-01' });
    expect(rows[0].matches[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(rows[1].matches[0].productCode).toBe('AIT-NVR-08');
    expect(rows[2].matches).toEqual([]);
    expect(rows[3].suggestedLabour).toBe(true);
    // PII never reaches the model or the draft
    expect(rows[3].description).not.toContain('0551234567');
    expect(rows[3].description).toContain('[phone]');
    expect(rows[3].description).toContain('[email]');
    expect(d.products['AIT-CAM-01'].listPrice).toBeTruthy();
    expect(d.party.id).toBe(S.party.id);
    const list = await rep.get('/api/ai/drafts?status=pending');
    expect(list.some((x: any) => x.id === d.id)).toBe(true);
  });

  it('drops product codes that are not in the catalog (post-model validation)', () => {
    const { rows, dropped } = validateMatches(
      [{ ref: '1', description: 'x', qty: 2, notes: '', matches: [{ productCode: 'ait-cam-01', confidence: 1.4, reason: 'r' }, { productCode: 'FAKE-1', confidence: 0.9, reason: 'invented' }, { productCode: 'AIT-CAM-01', confidence: 0.5, reason: 'dup' }] }],
      PRODUCTS,
    );
    expect(dropped).toEqual(['FAKE-1']);
    expect(rows[0]!.matches).toEqual([{ productCode: 'AIT-CAM-01', confidence: 1, reason: 'r' }]);
  });

  it('XLSX upload goes through the same parser', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('BOQ');
    ws.addRow(['م', 'البيان', 'الكمية', 'الوحدة']);
    ws.addRow(['1', 'سويتش 24 منفذ PoE', 2, 'عدد']);
    ws.addRow(['', 'أعمال الكاميرات', null, null]);
    ws.addRow(['2', 'كاميرا قبة آي بي 4 ميجا', 6, 'عدد']);
    const data = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const d = await rep.post('/api/ai/boq', { file: { name: 'boq.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data } });
    expect(d.payload.rows).toHaveLength(2);
    expect(d.payload.rows[0].matches[0].productCode).toBe('AIT-SW-24');
    expect(d.payload.rows[1]).toMatchObject({ ref: '2', qty: 6 });
    expect(d.payload.rows[1].matches[0].productCode).toBe('AIT-CAM-01');
    await rep.post(`/api/ai/drafts/${d.id}/reject`, { reason: 'test' });
    expect((await rep.get(`/api/ai/drafts/${d.id}`)).status).toBe('rejected');
  });

  it('a sales rep without ai.approve cannot apply; an approver creates a draft quote with BOQ refs', async () => {
    const lines = [
      { ref: '1.1', productCode: 'AIT-CAM-01', qty: 12, include: true },
      { ref: '1.2', productCode: 'AIT-NVR-08', qty: 1, include: true },
      { ref: '1.3', productCode: 'AIT-SW-24', qty: 3, include: false },
    ];
    await rep.post(`/api/ai/drafts/${S.draft.id}/apply`, { lines, partyId: S.party.id, title: 'مشروع BOQ' }, { expect: 403 });
    await owner.post(`/api/ai/drafts/${S.draft.id}/apply`, { lines: [{ ref: 'x', productCode: 'NOPE-1', qty: 1, include: true }] }, { expect: 400 });
    const r = await owner.post(`/api/ai/drafts/${S.draft.id}/apply`, { lines, partyId: S.party.id, title: 'مشروع BOQ' });
    expect(r.quoteId).toBeTruthy();
    const q = await owner.get(`/api/quotes/${r.quoteId}`);
    expect(q.status).toBe('draft');
    expect(q.partyId).toBe(S.party.id);
    expect(q.projectName).toBe('مشروع BOQ');
    const product = q.lines.filter((l: any) => !l.isLabor);
    expect(product.map((l: any) => l.code)).toEqual(['AIT-CAM-01', 'AIT-NVR-08']);
    expect(product[0].description).toMatch(/^\[BOQ 1\.1\] /);
    expect(Number(product[0].qty)).toBe(12);
    expect(Number(product[0].unitPrice)).toBe(450);
    const d = await owner.get(`/api/ai/drafts/${S.draft.id}`);
    expect(d.status).toBe('applied');
    expect(d.appliedEntityId).toBe(r.quoteId);
    await owner.post(`/api/ai/drafts/${S.draft.id}/apply`, { lines }, { expect: 409 });
  });
});

describe('AI-02, budget and the ai_call log', () => {
  it('drafts a reply and translates (nothing is sent)', async () => {
    const r = await rep.post('/api/ai/draft-reply', { context: 'whatsapp', thread: 'Customer: كم سعر الكاميرا؟ جوالي 0559998887', tone: 'friendly', language: 'ar', dialect: 'hijazi' });
    expect(r.sandbox).toBe(true);
    expect(r.text.length).toBeGreaterThan(10);
    const t = await rep.post('/api/ai/translate', { text: 'IP dome camera 4MP', to: 'ar' });
    expect(t.text).toContain('IP dome camera 4MP');
    await rep.post('/api/ai/draft-reply', { context: 'email', tone: 'formal', language: 'en' }, { expect: 400 });
  });

  it('refuses calls once the daily budget is used up', async () => {
    process.env.AI_DAILY_USD = '0';
    try {
      await rep.post('/api/ai/translate', { text: 'hello', to: 'ar' }, { expect: 429 });
    } finally {
      delete process.env.AI_DAILY_USD;
    }
    await rep.post('/api/ai/translate', { text: 'hello', to: 'ar' });
  });

  it('logs every call, redacted, and the app role cannot UPDATE or DELETE ai_call', async () => {
    const rows = await sqlRun((sql) => sql`select c.feature, c.status, c.input_summary, c.model from ai_call c join app_user u on u.id = c.user_id where u.email = 'ai-rep@e2e.test' order by c.created_at`);
    const features = rows.map((r: any) => `${r.feature}:${r.status}`);
    expect(features).toEqual(expect.arrayContaining(['boq:sandbox', 'reply:sandbox', 'translate:sandbox', 'translate:blocked']));
    const boq = rows.find((r: any) => r.feature === 'boq')!;
    expect(boq.input_summary).toContain('[phone]');
    expect(boq.input_summary).not.toContain('0551234567');
    expect(boq.input_summary).not.toContain('ali@example.com');
    expect(boq.input_summary.length).toBeLessThanOrEqual(2048);
    const reply = rows.find((r: any) => r.feature === 'reply')!;
    expect(reply.input_summary).not.toContain('0559998887');
    const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      await expect(app`update ai_call set status = 'tampered'`).rejects.toThrow(/permission denied/);
      await expect(app`delete from ai_call`).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it('reports usage (own vs company)', async () => {
    const mine = await rep.get('/api/ai/usage');
    expect(mine.scope).toBe('own');
    expect(mine.byFeature.find((f: any) => f.feature === 'boq').calls).toBeGreaterThanOrEqual(2);
    const all = await owner.get('/api/ai/usage?days=7');
    expect(all.scope).toBe('company');
    expect(all.byUser.some((u: any) => u.email === 'ai-rep@e2e.test')).toBe(true);
  });
});

describe('AI-06 MCP server (personal tokens)', () => {
  it('creates a token shown once and lists it without the secret', async () => {
    const t = await rep.post('/api/ai/tokens', { name: 'Claude Desktop', expiresInDays: 30 });
    expect(t.token).toMatch(/^mmc_pat_/);
    S.repToken = t.token;
    S.repTokenId = t.id;
    const list = await rep.get('/api/ai/tokens');
    expect(list.find((x: any) => x.id === t.id).name).toBe('Claude Desktop');
    expect(JSON.stringify(list)).not.toContain(t.token);
    await rep.post('/api/ai/tokens', { name: 'too long', expiresInDays: 365 }, { expect: 400 });
    expect((await sqlRun((sql) => sql`select token_hash from api_token where id = ${t.id}`))[0].token_hash).not.toBe(t.token);
  });

  it('lists tools and runs them with the user permissions; another rep\'s quote stays hidden', async () => {
    expect((await mcp(null, 'tools/list')).status).toBe(401);
    expect((await mcp('mmc_pat_not-a-real-token', 'tools/list')).status).toBe(401);
    const init = await mcp(S.repToken, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
    expect(init.status).toBe(200);
    expect(init.json.result.serverInfo.name).toBe('mmc-core');
    const list = await mcp(S.repToken, 'tools/list');
    expect(list.status).toBe(200);
    expect(list.json.result.tools.map((t: any) => t.name).sort()).toEqual(['ar_balance', 'get_contract', 'get_project_status', 'get_quote', 'installed_devices', 'open_service_calls', 'search_customers', 'stock_availability']);

    const line = { productId: S.products[0].id, code: 'AIT-CAM-01', description: 'كاميرا', qty: '2' };
    const other = await rep2.post('/api/quotes', { partyId: S.party.id, discountType: 'percent', discountValue: '0', vatOn: true, lines: [line] });
    const mine = await rep.post('/api/quotes', { partyId: S.party.id, discountType: 'percent', discountValue: '0', vatOn: true, lines: [line] });

    const ok = await tool(S.repToken, 'get_quote', { idOrNumber: mine.number });
    expect(ok.isError).toBe(false);
    expect(ok.data.id).toBe(mine.id);
    expect(ok.data.lines[0].code).toBe('AIT-CAM-01');
    expect(ok.text).not.toMatch(/cost|margin/i);

    const denied = await tool(S.repToken, 'get_quote', { idOrNumber: other.id });
    expect(denied.isError).toBe(true);
    expect(denied.text).not.toContain(other.number);
    // not even findable by number
    expect((await tool(S.repToken, 'get_quote', { idOrNumber: other.number })).data?.id ?? null).not.toBe(other.id);

    const cust = await tool(S.repToken, 'search_customers', { query: 'اختبار الذكاء' });
    expect(cust.data.customers.some((c: any) => c.id === S.party.id)).toBe(true);
    // permission the rep does not have → refused like the REST endpoint
    expect((await tool(S.repToken, 'open_service_calls', {})).isError).toBe(true);

    const ownerTok = (await owner.post('/api/ai/tokens', { name: 'owner', expiresInDays: 1 })).token;
    const full = await tool(ownerTok, 'get_quote', { idOrNumber: other.id });
    expect(full.data.costTotal).toBeDefined();
    const stock = await tool(ownerTok, 'stock_availability', { codes: ['AIT-CAM-01', 'NOPE'] });
    expect(stock.data.products[0].code).toBe('AIT-CAM-01');
    expect(stock.data.unknownCodes).toEqual(['NOPE']);
    const ar = await tool(ownerTok, 'ar_balance', { partyId: S.party.id });
    expect(ar.data.balanceSar).toBe(0);

    const logs = await sqlRun((sql) => sql`select feature, status, model, provider from ai_call where feature like 'mcp:%'`);
    expect(logs.some((l: any) => l.feature === 'mcp:get_quote' && l.status === 'ok' && l.provider === 'mcp')).toBe(true);
    expect(logs.some((l: any) => l.feature === 'mcp:get_quote' && l.status === 'blocked')).toBe(true);
    const [tok] = await sqlRun((sql) => sql`select last_used_at from api_token where id = ${S.repTokenId}`);
    expect(tok.last_used_at).toBeTruthy();
  });

  it('expired and revoked tokens get 401', async () => {
    const t = await rep.post('/api/ai/tokens', { name: 'short', expiresInDays: 1 });
    expect((await mcp(t.token, 'tools/list')).status).toBe(200);
    await sqlRun((sql) => sql`update api_token set expires_at = now() - interval '1 minute' where id = ${t.id}`);
    expect((await mcp(t.token, 'tools/list')).status).toBe(401);
    await rep.req('DELETE', `/api/ai/tokens/${S.repTokenId}`, undefined, { expect: 200 });
    expect((await mcp(S.repToken, 'tools/list')).status).toBe(401);
    // another user cannot revoke someone else's token
    const t2 = await rep2.post('/api/ai/tokens', { name: 'rep2', expiresInDays: 5 });
    await rep.req('DELETE', `/api/ai/tokens/${t2.id}`, undefined, { expect: 404 });
  });
});
