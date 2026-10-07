import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { amount, audit, id, rate, tenantId } from './_common.js';
import { appUser } from './platform.js';
import { installedAsset, ticket } from './ops.js';

/**
 * Phase 7a/7c in MMC Core: IoT alarms (module 12 §2), the AI gateway log and approval drafts
 * (module 12 §3.1), and sales commissions (module 09 §3.4). Payroll stays in Frappe HR.
 */

/** ThingsBoard alarm mirrored into Core; one active row per device + alarm type (IOT-03/04). */
export const iotAlarm = pgTable('iot_alarm', {
  id: id(),
  tenantId: tenantId(),
  /** ThingsBoard alarm id (idempotency) */
  externalId: text('external_id').notNull(),
  deviceId: text('device_id').notNull(),
  dedupKey: text('dedup_key').notNull(),
  alarmType: text('alarm_type').notNull(),
  severity: text('severity').notNull(),
  /** active | acknowledged | cleared */
  status: text('status').notNull().default('active'),
  assetId: uuid('asset_id').references(() => installedAsset.id),
  ticketId: uuid('ticket_id').references(() => ticket.id),
  occurrences: integer('occurrences').notNull().default(1),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  clearedAt: timestamp('cleared_at', { withTimezone: true }),
  /** ack/clear pushed back to ThingsBoard */
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
  ...audit,
}, (t) => [uniqueIndex('iot_alarm_external_uq').on(t.tenantId, t.externalId), index('iot_alarm_dedup_idx').on(t.tenantId, t.dedupKey, t.status)]);

/** Every model call through the AI gateway: who, which feature, cost, outcome (module 12 §3.1). */
export const aiCall = pgTable('ai_call', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').references(() => appUser.id),
  feature: text('feature').notNull(),
  provider: text('provider').notNull().default('anthropic'),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: rate('cost_usd'),
  /** ok | error | blocked | sandbox */
  status: text('status').notNull(),
  /** redacted prompt summary (never raw personal data) */
  inputSummary: text('input_summary'),
  output: jsonb('output').$type<unknown>(),
  error: text('error'),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ai_call_feature_idx').on(t.tenantId, t.feature, t.createdAt)]);

/** AI output that would write data waits here for a human decision (no AI write without approval). */
export const aiDraft = pgTable('ai_draft', {
  id: id(),
  tenantId: tenantId(),
  feature: text('feature').notNull(),
  callId: uuid('call_id').references(() => aiCall.id),
  /** what it would create/change, e.g. quote | message | ticket */
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  /** pending | approved | rejected | applied */
  status: text('status').notNull().default('pending'),
  decidedBy: uuid('decided_by').references(() => appUser.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  appliedEntityId: uuid('applied_entity_id'),
  ...audit,
}, (t) => [index('ai_draft_status_idx').on(t.tenantId, t.status)]);

/** Commission plans by product line (HR-50/52). */
export const commissionPlan = pgTable('commission_plan', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  /** revenue | margin */
  basis: text('basis').notNull().default('revenue'),
  ratePercent: rate('rate_percent').notNull(),
  /** product categories; empty = catch-all */
  categoryIds: jsonb('category_ids').$type<string[]>().notNull().default([]),
  /** sales reps on the plan; empty = every user owning a contract */
  userIds: jsonb('user_ids').$type<string[]>().notNull().default([]),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  /** tiers on quota attainment (HR-53): above `fromPercent` of the monthly quota the rate is multiplied */
  tiers: jsonb('tiers').$type<{ fromPercent: number; multiplier: number }[]>().notNull().default([]),
  ...audit,
});

/** Commission ledger per rep and invoice: earned on invoice, payable on collection, paid via payroll (HR-51/53/54). */
export const commissionEntry = pgTable('commission_entry', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull().references(() => appUser.id),
  planId: uuid('plan_id').references(() => commissionPlan.id),
  /** invoice_mirror id (388/386 earn, 381 claws back) */
  invoiceId: uuid('invoice_id').notNull(),
  contractId: uuid('contract_id'),
  earned: amount('earned').notNull(),
  payable: amount('payable').notNull().default('0'),
  paid: amount('paid').notNull().default('0'),
  /** month (YYYY-MM) the payable amount was last recalculated for payroll export */
  period: text('period'),
  /** open | payable | paid */
  status: text('status').notNull().default('open'),
  ...audit,
}, (t) => [uniqueIndex('commission_entry_uq').on(t.tenantId, t.userId, t.invoiceId, t.planId), index('commission_entry_user_idx').on(t.tenantId, t.userId, t.status)]);

/**
 * Personal access tokens for the read-only MCP server (AI-06): an assistant acts as the user, with the
 * user's own permissions. Only the SHA-256 of the token is stored; the token is shown once.
 */
export const apiToken = pgTable('api_token', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull().references(() => appUser.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  /** e.g. ["mcp:read"] */
  scopes: jsonb('scopes').$type<string[]>().notNull().default(['mcp:read']),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('api_token_hash_uq').on(t.tokenHash), index('api_token_user_idx').on(t.tenantId, t.userId)]);
