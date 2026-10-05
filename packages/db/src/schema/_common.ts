import { sql } from 'drizzle-orm';
import { integer, jsonb, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Conventions (docs/erp-plan/04 §1): UUIDv7 keys, tenant_id on every row (RLS), audit columns,
 * optimistic-lock version, NUMERIC money. `uuidv7()` is created by the first migration.
 */
export const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
export const tenantId = () => uuid('tenant_id').notNull().default(sql`nullif(current_setting('app.tenant_id', true), '')::uuid`);

export const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

export const archivedAt = () => timestamp('archived_at', { withTimezone: true });
export const custom = () => jsonb('custom').$type<Record<string, unknown>>().notNull().default({});

/** NUMERIC(18,2) amounts, (18,4) unit prices, (18,6) rates — read as strings, computed with @mmc/domain. */
export const amount = (name: string) => numeric(name, { precision: 18, scale: 2 });
export const unitPrice = (name: string) => numeric(name, { precision: 18, scale: 4 });
export const rate = (name: string) => numeric(name, { precision: 18, scale: 6 });
export const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
