import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { amount, audit, id, tenantId } from './_common.js';
import { appUser, branch } from './platform.js';
import { contact, party } from './parties.js';
import { workOrder } from './ops.js';

/**
 * Phase 7b — service agreements (AMC), preventive visits and the customer portal (modules 06 §2.4,
 * 11 §3.2). Portal accounts are separate from staff users: customers never get a staff session.
 */

/** Annual maintenance contract (FSM-61): coverage, tier, SLA, visits, price and billing. */
export const serviceAgreement = pgTable('service_agreement', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  partyId: uuid('party_id').notNull().references(() => party.id),
  /** sites covered (all their active devices unless assetIds narrows it) */
  siteIds: jsonb('site_ids').$type<string[]>().notNull().default([]),
  /** optional explicit device list; empty = every active device on the sites */
  assetIds: jsonb('asset_ids').$type<string[]>().notNull().default([]),
  /** basic | standard | premium */
  tier: text('tier').notNull().default('standard'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  visitsPerYear: integer('visits_per_year').notNull().default(4),
  responseHours: integer('response_hours').notNull().default(8),
  resolutionHours: integer('resolution_hours').notNull().default(48),
  /** business | 24x7 */
  coverage: text('coverage').notNull().default('business'),
  /** parts included (else labour only) */
  partsIncluded: boolean('parts_included').notNull().default(false),
  price: amount('price').notNull(),
  /** annual | semiannual | quarterly | monthly */
  billingFrequency: text('billing_frequency').notNull().default('annual'),
  vatOn: boolean('vat_on').notNull().default(true),
  /** draft | active | expired | cancelled | renewed */
  status: text('status').notNull().default('draft'),
  autoRenew: boolean('auto_renew').notNull().default(false),
  upliftPercent: integer('uplift_percent').notNull().default(0),
  renewalOfId: uuid('renewal_of_id'),
  /** renewal reminder already sent for this term */
  renewalNotifiedAt: timestamp('renewal_notified_at', { withTimezone: true }),
  cancelledAt: date('cancelled_at'),
  notes: text('notes'),
  ownerId: uuid('owner_id').references(() => appUser.id),
  teamId: uuid('team_id'),
  branchId: uuid('branch_id').references(() => branch.id),
  ...audit,
}, (t) => [uniqueIndex('service_agreement_number_uq').on(t.tenantId, t.number), index('service_agreement_party_idx').on(t.tenantId, t.partyId)]);

/** Planned preventive visits; a work order is generated ahead of the due date (FSM-62). */
export const agreementVisit = pgTable('agreement_visit', {
  id: id(),
  tenantId: tenantId(),
  agreementId: uuid('agreement_id').notNull().references(() => serviceAgreement.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id'),
  dueDate: date('due_date').notNull(),
  /** planned | generated | done | skipped */
  status: text('status').notNull().default('planned'),
  workOrderId: uuid('work_order_id').references(() => workOrder.id),
  ...audit,
}, (t) => [index('agreement_visit_due_idx').on(t.tenantId, t.status, t.dueDate)]);

/** Customer portal account (POR-01): one per contact phone, bound to one customer party. */
export const portalAccount = pgTable('portal_account', {
  id: id(),
  tenantId: tenantId(),
  partyId: uuid('party_id').notNull().references(() => party.id),
  contactId: uuid('contact_id').references(() => contact.id),
  /** E.164 Saudi mobile */
  phone: text('phone').notNull(),
  name: text('name'),
  /** active | disabled */
  status: text('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex('portal_account_phone_uq').on(t.tenantId, t.phone, t.partyId)]);

/** WhatsApp one-time codes for portal sign-in (hashed; attempts limited). */
export const portalOtp = pgTable('portal_otp', {
  id: id(),
  tenantId: tenantId(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('portal_otp_phone_idx').on(t.tenantId, t.phone, t.createdAt)]);

/** Portal sessions: opaque token (hash stored), httpOnly cookie, short life. */
export const portalSession = pgTable('portal_session', {
  id: id(),
  tenantId: tenantId(),
  accountId: uuid('account_id').notNull().references(() => portalAccount.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('portal_session_token_uq').on(t.tokenHash)]);
