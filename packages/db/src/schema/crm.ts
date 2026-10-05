import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { amount, archivedAt, audit, custom, id, tenantId } from './_common.js';
import { appUser } from './platform.js';
import { contact, party, site } from './parties.js';

export const campaign = pgTable('campaign', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  channel: text('channel'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  budget: amount('budget'),
  archivedAt: archivedAt(),
  ...audit,
});

export const lead = pgTable('lead', {
  id: id(),
  tenantId: tenantId(),
  number: text('number'),
  source: text('source').notNull().default('other'),
  campaignId: uuid('campaign_id').references(() => campaign.id),
  name: text('name').notNull(),
  companyName: text('company_name'),
  mobile: text('mobile'),
  waBsuid: text('wa_bsuid'),
  email: text('email'),
  city: text('city'),
  interest: text('interest'),
  projectType: text('project_type'),
  estimatedUnits: integer('estimated_units'),
  message: text('message'),
  score: integer('score').notNull().default(0),
  /** new → contacted → qualified / unqualified → converted */
  status: text('status').notNull().default('new'),
  ownerId: uuid('owner_id').references(() => appUser.id),
  teamId: uuid('team_id'),
  referredByPartyId: uuid('referred_by_party_id').references(() => party.id),
  firstContactAt: timestamp('first_contact_at', { withTimezone: true }),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  convertedPartyId: uuid('converted_party_id').references(() => party.id),
  convertedContactId: uuid('converted_contact_id').references(() => contact.id),
  convertedOpportunityId: uuid('converted_opportunity_id'),
  unqualifiedReason: text('unqualified_reason'),
  utm: jsonb('utm').$type<Record<string, string>>(),
  custom: custom(),
  ...audit,
}, (t) => [index('lead_owner_idx').on(t.tenantId, t.ownerId, t.status), index('lead_mobile_idx').on(t.tenantId, t.mobile)]);

export const pipeline = pgTable('pipeline', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  ...audit,
});

export const pipelineStage = pgTable('pipeline_stage', {
  id: id(),
  tenantId: tenantId(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipeline.id),
  key: text('key').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  probability: integer('probability').notNull(),
  kind: text('kind').notNull().default('open'),
  sort: integer('sort').notNull(),
}, (t) => [uniqueIndex('pipeline_stage_key_uq').on(t.pipelineId, t.key)]);

export const lostReason = pgTable('lost_reason', {
  id: id(),
  tenantId: tenantId(),
  key: text('key').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
});

export const opportunity = pgTable('opportunity', {
  id: id(),
  tenantId: tenantId(),
  title: text('title').notNull(),
  partyId: uuid('party_id').references(() => party.id),
  contactId: uuid('contact_id').references(() => contact.id),
  siteId: uuid('site_id').references(() => site.id),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipeline.id),
  stageId: uuid('stage_id').notNull().references(() => pipelineStage.id),
  amount: amount('amount').notNull().default('0'),
  probability: integer('probability').notNull().default(10),
  expectedClose: date('expected_close'),
  projectType: text('project_type'),
  competitors: jsonb('competitors').$type<string[]>().notNull().default([]),
  lostReasonKey: text('lost_reason_key'),
  lostNote: text('lost_note'),
  wonAt: timestamp('won_at', { withTimezone: true }),
  lostAt: timestamp('lost_at', { withTimezone: true }),
  ownerId: uuid('owner_id').references(() => appUser.id),
  teamId: uuid('team_id'),
  leadId: uuid('lead_id'),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  custom: custom(),
  ...audit,
}, (t) => [index('opp_stage_idx').on(t.tenantId, t.pipelineId, t.stageId), index('opp_owner_idx').on(t.tenantId, t.ownerId)]);

/** Polymorphic timeline entries: calls, meetings, site visits, tasks, notes, system events. */
export const activity = pgTable('activity', {
  id: id(),
  tenantId: tenantId(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  type: text('type').notNull(),
  subject: text('subject').notNull(),
  body: text('body'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
  outcome: text('outcome'),
  ownerId: uuid('owner_id').references(() => appUser.id),
  /** automation rule that created it (follow-ups); unique per entity to avoid duplicates */
  ruleKey: text('rule_key'),
  ...audit,
}, (t) => [
  index('activity_entity_idx').on(t.tenantId, t.entityType, t.entityId),
  index('activity_owner_due_idx').on(t.tenantId, t.ownerId, t.doneAt, t.dueAt),
  uniqueIndex('activity_rule_uq').on(t.tenantId, t.entityId, t.ruleKey),
]);

export const salesTarget = pgTable('sales_target', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').references(() => appUser.id),
  teamId: uuid('team_id'),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  amount: amount('amount').notNull(),
  ...audit,
});

/** WhatsApp/SMS/e-mail templates (WhatsApp: provider-approved template name + language). */
export const messageTemplate = pgTable('message_template', {
  id: id(),
  tenantId: tenantId(),
  key: text('key').notNull(),
  channel: text('channel').notNull(),
  category: text('category').notNull().default('utility'),
  language: text('language').notNull().default('ar'),
  providerTemplateName: text('provider_template_name'),
  body: text('body').notNull(),
  variables: jsonb('variables').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  ...audit,
}, (t) => [uniqueIndex('message_template_key_uq').on(t.tenantId, t.key, t.channel, t.language)]);

/** Shared inbox conversation per contact/phone/BSUID and channel. */
export const conversation = pgTable('conversation', {
  id: id(),
  tenantId: tenantId(),
  channel: text('channel').notNull().default('whatsapp'),
  externalAddress: text('external_address').notNull(),
  contactId: uuid('contact_id').references(() => contact.id),
  leadId: uuid('lead_id').references(() => lead.id),
  partyId: uuid('party_id').references(() => party.id),
  assigneeId: uuid('assignee_id').references(() => appUser.id),
  status: text('status').notNull().default('open'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  unreadCount: integer('unread_count').notNull().default(0),
  ...audit,
}, (t) => [uniqueIndex('conversation_addr_uq').on(t.tenantId, t.channel, t.externalAddress)]);

export const message = pgTable('message', {
  id: id(),
  tenantId: tenantId(),
  conversationId: uuid('conversation_id').references(() => conversation.id),
  direction: text('direction').notNull(),
  channel: text('channel').notNull(),
  to: text('to'),
  from: text('from'),
  templateKey: text('template_key'),
  body: text('body'),
  mediaUrl: text('media_url'),
  /** queued → sent → delivered → read / failed */
  status: text('status').notNull().default('queued'),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  category: text('category'),
  costHalalas: integer('cost_halalas'),
  relatedType: text('related_type'),
  relatedId: uuid('related_id'),
  sentBy: uuid('sent_by'),
  createdAt: audit.createdAt,
  updatedAt: audit.updatedAt,
}, (t) => [index('message_conv_idx').on(t.conversationId, t.createdAt), uniqueIndex('message_provider_uq').on(t.channel, t.providerMessageId)]);

/** OTP-verified online acceptance of a quote (Phase 2). */
export const quoteAcceptance = pgTable('quote_acceptance', {
  id: id(),
  tenantId: tenantId(),
  quoteId: uuid('quote_id').notNull(),
  mobile: text('mobile').notNull(),
  otpHash: text('otp_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  decision: text('decision'),
  signerName: text('signer_name'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  documentSha256: text('document_sha256'),
  createdAt: audit.createdAt,
}, (t) => [index('quote_acceptance_quote_idx').on(t.quoteId)]);

/** Nafath-backed e-signature request via a licensed provider (sandbox until contracted). */
export const esignRequest = pgTable('esign_request', {
  id: id(),
  tenantId: tenantId(),
  contractId: uuid('contract_id').notNull(),
  provider: text('provider').notNull(),
  providerRequestId: text('provider_request_id'),
  signerName: text('signer_name').notNull(),
  signerNationalId: text('signer_national_id'),
  signerMobile: text('signer_mobile'),
  status: text('status').notNull().default('created'),
  signingUrl: text('signing_url'),
  documentSha256: text('document_sha256'),
  signedFileId: uuid('signed_file_id'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex('esign_provider_uq').on(t.provider, t.providerRequestId)]);
