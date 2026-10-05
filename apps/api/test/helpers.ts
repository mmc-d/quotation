import type { AddressInfo } from 'node:net';
import postgres from 'postgres';
import type { INestApplication } from '@nestjs/common';

export const ADMIN_SQL = () => postgres(process.env.DATABASE_ADMIN_URL!, { max: 2, onnotice: () => {} });

let app: INestApplication | null = null;
let base = '';

export async function startServer() {
  if (app) return base;
  const { createApp } = await import('../src/main.js');
  app = await createApp();
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  return base;
}

export async function stopServer() {
  await app?.close();
  const { closeDb } = await import('../src/common/db.js');
  await closeDb();
  app = null;
}

export class Client {
  cookie = '';
  constructor(readonly base: string) {}
  async req<T = any>(method: string, path: string, body?: unknown, opts: { raw?: boolean; expect?: number; headers?: Record<string, string> } = {}): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999', ...(this.cookie ? { Cookie: this.cookie } : {}), ...(opts.headers ?? {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [kv] = c.split(';');
      if (kv?.startsWith('mmc.session_token=')) this.cookie = kv;
    }
    const expect = opts.expect ?? (method === 'POST' ? undefined : 200);
    if (expect !== undefined && res.status !== expect) throw new Error(`${method} ${path} → ${res.status} (expected ${expect}): ${(await res.text()).slice(0, 500)}`);
    if (expect === undefined && res.status >= 400) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 500)}`);
    if (opts.raw) return Buffer.from(await res.arrayBuffer()) as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  get<T = any>(p: string, o?: { raw?: boolean; expect?: number }) { return this.req<T>('GET', p, undefined, o); }
  post<T = any>(p: string, b?: unknown, o?: { raw?: boolean; expect?: number; headers?: Record<string, string> }) { return this.req<T>('POST', p, b ?? {}, o); }
  put<T = any>(p: string, b: unknown, o?: { expect?: number }) { return this.req<T>('PUT', p, b, o); }
}

/** Sign up an invited e-mail, verify it (as the mail link would), and sign in. */
export async function signIn(base: string, email: string, password = 'correct-horse-battery-staple') {
  const c = new Client(base);
  await c.post('/api/auth/sign-up/email', { email, password, name: email.split('@')[0] }, { expect: 200 });
  const sql = ADMIN_SQL();
  await sql`update auth_user set email_verified = true where email = ${email}`;
  await sql.end();
  await c.post('/api/auth/sign-in/email', { email, password }, { expect: 200 });
  return c;
}

export async function gotenbergUp() {
  try { return (await fetch('http://localhost:3300/health')).ok; } catch { return false; }
}

/** Sign in an invited user, creating and verifying the identity on first use (order-independent test files). */
export async function signInOrUp(base: string, email: string, password = 'correct-horse-battery-staple') {
  const c = new Client(base);
  const res = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999' }, body: JSON.stringify({ email, password }) });
  if (res.ok) {
    for (const ck of res.headers.getSetCookie?.() ?? []) { const [kv] = ck.split(';'); if (kv?.startsWith('mmc.session_token=')) c.cookie = kv; }
    if (c.cookie) return c;
  }
  return signIn(base, email, password);
}
