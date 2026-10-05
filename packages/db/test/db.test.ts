import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/schema/index.js';
import { createDb, nextNumber, withTenant, writeAudit, type Db } from '../src/index.js';
import { seed } from '../src/seed.js';

const ADMIN = 'postgres://mmc:mmc_dev_only@localhost:5433/mmc_test';
const APP = 'postgres://mmc_app:mmc_app_dev_only@localhost:5433/mmc_test';
let adminClient: postgres.Sql;
let app: { db: Db; client: postgres.Sql };
let t1 = '';
let t2 = '';

beforeAll(async () => {
  adminClient = postgres(ADMIN, { max: 2, onnotice: () => {} });
  const adminDb = drizzle(adminClient, { schema: s, casing: 'snake_case' }) as unknown as Db;
  t1 = await seed(adminDb, { ownerEmail: 'a@one.test', tenantSlug: 'one' });
  t2 = await seed(adminDb, { ownerEmail: 'b@two.test', tenantSlug: 'two' });
  app = createDb(APP, { max: 10 });
});
afterAll(async () => {
  await app.client.end();
  await adminClient.end();
});

describe('row-level security (runtime role)', () => {
  it('sees only the current tenant', async () => {
    const users1 = await withTenant(app.db, t1, (tx) => tx.select().from(s.appUser));
    const users2 = await withTenant(app.db, t2, (tx) => tx.select().from(s.appUser));
    expect(users1.map((u) => u.email)).toEqual(['a@one.test']);
    expect(users2.map((u) => u.email)).toEqual(['b@two.test']);
  });
  it('sees nothing without a tenant', async () => {
    const rows = await app.db.select().from(s.appUser);
    expect(rows).toHaveLength(0);
  });
  it('refuses writes into another tenant', async () => {
    await expect(withTenant(app.db, t1, (tx) => tx.insert(s.party).values({ tenantId: t2, nameAr: 'تسلل' }))).rejects.toThrow();
  });
  it('fills tenant_id from the session setting', async () => {
    const [p] = await withTenant(app.db, t1, (tx) => tx.insert(s.party).values({ nameAr: 'عميل' }).returning());
    expect(p!.tenantId).toBe(t1);
  });
  it('resolves an auth user to its tenant through the definer function only', async () => {
    await withTenant(app.db, t2, (tx) => tx.update(s.appUser).set({ authUserId: 'auth-b' }).where(eq(s.appUser.email, 'b@two.test')));
    const rows = await app.db.execute<{ tenant_id: string }>(sql`select * from tenant_for_auth_user('auth-b')`);
    expect(rows[0]?.tenant_id).toBe(t2);
  });
});

describe('numbering', () => {
  it('never hands out the same number twice under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => withTenant(app.db, t1, (tx) => nextNumber(tx, 'contract'))));
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(20);
    expect(seqs[0]).toBe(1);
    expect(seqs[19]).toBe(20);
    expect(results.find((r) => r.seq === 7)?.number).toBe('MMCT-7');
  });
  it('keeps counters per tenant', async () => {
    const r = await withTenant(app.db, t2, (tx) => nextNumber(tx, 'contract'));
    expect(r.number).toBe('MMCT-1');
  });
  it('formats invoice numbers with 5 digits', async () => {
    const r = await withTenant(app.db, t1, (tx) => nextNumber(tx, 'invoice'));
    expect(r.number).toBe('MMC-INV-00001');
  });
});

describe('audit log', () => {
  it('chains hashes and is append-only', async () => {
    await withTenant(app.db, t1, async (tx) => {
      await writeAudit(tx, { action: 'create', entityType: 'party', entityId: 'x', after: { a: 1 } });
      await writeAudit(tx, { action: 'update', entityType: 'party', entityId: 'x', before: { a: 1 }, after: { a: 2 } });
    });
    const rows = await withTenant(app.db, t1, (tx) => tx.select().from(s.auditLog).orderBy(s.auditLog.id));
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    await expect(withTenant(app.db, t1, (tx) => tx.update(s.auditLog).set({ action: 'tampered' }))).rejects.toThrow();
    await expect(withTenant(app.db, t1, (tx) => tx.delete(s.auditLog))).rejects.toThrow();
  });
});
