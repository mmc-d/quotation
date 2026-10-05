import { createDb, withTenant, type Db, type Tx } from '@mmc/db';
import { config } from '../config.js';

/** One pool per process (runtime role → row-level security applies). */
let instance: { db: Db; close: () => Promise<void> } | null = null;

export function getDb(): Db {
  if (!instance) {
    const { db, client } = createDb(config.databaseUrl, { max: 15 });
    instance = { db, close: () => client.end() };
  }
  return instance.db;
}

export async function closeDb() {
  await instance?.close();
  instance = null;
}

export function tenantTx<T>(tenantId: string, fn: (tx: Tx) => Promise<T>, actorId?: string | null): Promise<T> {
  return withTenant(getDb(), tenantId, fn, actorId);
}
