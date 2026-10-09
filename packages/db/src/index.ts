import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DEFAULT_SERIES, formatSeries, seriesPeriodKey, type SeriesReset } from '@mmc/domain';
import * as schema from './schema/index.js';

export { schema };
export * from './schema/index.js';
export type { SQL } from 'drizzle-orm';
export type { AnyPgColumn } from 'drizzle-orm/pg-core';
export { alias } from 'drizzle-orm/pg-core';
export { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, isNotNull, lt, lte, ne, or, sql, count, sum } from 'drizzle-orm';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url = process.env.DATABASE_URL, opts: { max?: number } = {}): { db: Db; client: postgres.Sql } {
  if (!url) throw new Error('DATABASE_URL is not set');
  // NUMERIC stays a string (exact); computed with @mmc/domain.
  const client = postgres(url, { max: opts.max ?? 10, prepare: false });
  return { db: drizzle(client, { schema, casing: 'snake_case' }), client };
}

/**
 * Run `fn` in a transaction scoped to one tenant: sets app.tenant_id (transaction-local, safe behind
 * PgBouncer transaction pooling) so row-level security applies, plus the acting user for triggers.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>, actorId?: string | null): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.actor_id', ${actorId ?? ''}, true)`);
    return fn(tx);
  });
}

/** Allocate the next number of a series under a row lock (never reused, gap-free per bucket). */
export async function nextNumber(tx: Tx, documentType: string, at: Date = new Date()): Promise<{ number: string; seq: number }> {
  let [series] = await tx.select().from(schema.numberingSeries).where(eq(schema.numberingSeries.documentType, documentType)).limit(1);
  if (!series) {
    const def = DEFAULT_SERIES[documentType];
    if (!def) throw new Error(`no numbering series for ${documentType}`);
    [series] = await tx.insert(schema.numberingSeries).values({ documentType, pattern: def.pattern, reset: def.reset }).returning();
  }
  const s = series!;
  const periodKey = seriesPeriodKey(s.reset as SeriesReset, at);
  await tx
    .insert(schema.numberingCounter)
    .values({ seriesId: s.id, periodKey, lastValue: s.startAt - 1 })
    .onConflictDoNothing();
  const [row] = await tx.execute<{ last_value: number }>(sql`
    update numbering_counter set last_value = last_value + 1
    where series_id = ${s.id} and period_key = ${periodKey}
    returning last_value`);
  const seq = Number(row!.last_value);
  return { number: formatSeries(s.pattern, seq, at), seq };
}

/** Make sure a number allocated elsewhere (legacy import) is not handed out again. */
export async function bumpCounterTo(tx: Tx, documentType: string, seq: number, at: Date = new Date()): Promise<void> {
  await nextNumber(tx, documentType, at).catch(() => undefined);
  const [series] = await tx.select().from(schema.numberingSeries).where(eq(schema.numberingSeries.documentType, documentType)).limit(1);
  if (!series) return;
  const periodKey = seriesPeriodKey(series.reset as SeriesReset, at);
  await tx.execute(sql`update numbering_counter set last_value = greatest(last_value, ${seq}) where series_id = ${series.id} and period_key = ${periodKey}`);
}

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  reason?: string | null;
}

/** Append to the hash-chained audit log (each row hashes the previous row's hash). */
export async function writeAudit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('audit_log:' || current_setting('app.tenant_id', true)))`);
  const [prev] = await tx.select({ hash: schema.auditLog.hash }).from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(1);
  const at = new Date().toISOString();
  const body = JSON.stringify({ at, actor: e.actorId ?? null, action: e.action, type: e.entityType, id: e.entityId ?? null, before: e.before ?? null, after: e.after ?? null });
  const hash = createHash('sha256').update((prev?.hash ?? '') + body).digest('hex');
  await tx.insert(schema.auditLog).values({
    actorId: e.actorId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before: (e.before ?? null) as never,
    after: (e.after ?? null) as never,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
    reason: e.reason ?? null,
    prevHash: prev?.hash ?? null,
    hash,
    at: new Date(at),
  });
}

/** Queue an outbox event in the caller's transaction. */
export async function emit(tx: Tx, aggregate: string, aggregateId: string | null, eventType: string, payload: Record<string, unknown> = {}): Promise<void> {
  await tx.insert(schema.outboxEvent).values({ aggregate, aggregateId, eventType, payload });
}

export async function tenantBySlug(db: Db, slug: string) {
  const [t] = await db.select().from(schema.tenant).where(eq(schema.tenant.slug, slug)).limit(1);
  return t ?? null;
}

export { createHash };
export const _internal = { and };
