import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid , bigint, primaryKey } from 'drizzle-orm/pg-core';
import { archivedAt, audit, custom, id, tenantId } from './_common.js';

/** Tenant: one today (Al-Mada Al-Mubarak); schema stays SaaS-ready (D3). Not RLS-scoped itself. */
export const tenant = pgTable('tenant', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: audit.createdAt,
});

export const company = pgTable('company', {
  id: id(),
  tenantId: tenantId(),
  legalNameAr: text('legal_name_ar').notNull(),
  legalNameEn: text('legal_name_en'),
  tradeNameAr: text('trade_name_ar'),
  unifiedNumber: text('unified_number'),
  crNumber: text('cr_number'),
  vatRegistered: boolean('vat_registered').notNull().default(false),
  vatEffectiveFrom: date('vat_effective_from'),
  vatNumber: text('vat_number'),
  address: jsonb('address').$type<{ buildingNumber?: string; street?: string; district?: string; city?: string; postalCode?: string; additionalNumber?: string; country?: string }>().notNull().default({}),
  phone: text('phone'),
  email: text('email'),
  website: text('website'),
  bankName: text('bank_name'),
  iban: text('iban'),
  bankAccountName: text('bank_account_name'),
  bankAccountNumber: text('bank_account_number'),
  /** optional QR image from the bank's app; without it documents print a QR of the IBAN */
  bankQrFileId: uuid('bank_qr_file_id'),
  representativeName: text('representative_name'),
  representativeTitle: text('representative_title'),
  representativeMobile: text('representative_mobile'),
  logoFileId: uuid('logo_file_id'),
  stampFileId: uuid('stamp_file_id'),
  baseCurrency: text('base_currency').notNull().default('SAR'),
  /** quote defaults carried over from the legacy tool (notes/terms text, validity days) */
  quoteDefaults: jsonb('quote_defaults').$type<{ validityDays?: number; notesAr?: string; termsAr?: string; termsEn?: string; warrantyText?: string }>().notNull().default({}),
  /** company calendar: working weekdays (0 = Sunday … 6 = Saturday); KSA default Sun–Thu */
  workingDays: jsonb('working_days').$type<number[]>().notNull().default([0, 1, 2, 3, 4]),
  /** Ramadan date ranges (Umm al-Qura, entered per year) — 6-hour day rule for bookings (module 05 §4) */
  ramadanRanges: jsonb('ramadan_ranges').$type<{ from: string; to: string }[]>().notNull().default([]),
  /** technician incentive rules (module 09 HR-55); null = DEFAULT_TECH_INCENTIVES */
  techIncentiveRules: jsonb('tech_incentive_rules').$type<{ perDeviceHalalas: number; firstTimeFixHalalas: number; callbackPenaltyHalalas: number; callbackWindowDays: number; happyCustomerHalalas: number }>(),
  approvalPolicy: jsonb('approval_policy').$type<{ maxDiscountPercent: number; minMarginPercent: number }>().notNull().default({ maxDiscountPercent: 10, minMarginPercent: 20 }),
  ...audit,
});

export const branch = pgTable('branch', {
  id: id(),
  tenantId: tenantId(),
  companyId: uuid('company_id').notNull().references(() => company.id),
  code: text('code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  isHeadOffice: boolean('is_head_office').notNull().default(false),
  address: jsonb('address').$type<Record<string, string>>().notNull().default({}),
  zatcaEgsUnit: text('zatca_egs_unit'),
  archivedAt: archivedAt(),
  ...audit,
}, (t) => [uniqueIndex('branch_code_uq').on(t.tenantId, t.code)]);

/** Application user — linked 1:1 to the Better Auth identity (auth_user). */
export const appUser = pgTable('app_user', {
  id: id(),
  tenantId: tenantId(),
  authUserId: text('auth_user_id').unique(),
  email: text('email').notNull(),
  mobile: text('mobile'),
  nameAr: text('name_ar'),
  nameEn: text('name_en'),
  locale: text('locale').notNull().default('ar'),
  /** invited → active → suspended (never deleted) */
  status: text('status').notNull().default('invited'),
  /** legacy numeric user code (the old tool's admin gate / issuedBy) */
  userCode: text('user_code'),
  branchId: uuid('branch_id').references(() => branch.id),
  managerId: uuid('manager_id'),
  invitedBy: uuid('invited_by'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex('app_user_email_uq').on(t.tenantId, t.email)]);

export const role = pgTable('role', {
  id: id(),
  tenantId: tenantId(),
  key: text('key').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  /** { "quote.read": "team", ... } */
  grants: jsonb('grants').$type<Record<string, string>>().notNull().default({}),
  maxDiscountPercent: integer('max_discount_percent').notNull().default(0),
  isSystem: boolean('is_system').notNull().default(false),
  ...audit,
}, (t) => [uniqueIndex('role_key_uq').on(t.tenantId, t.key)]);

export const userRole = pgTable('user_role', {
  tenantId: tenantId(),
  userId: uuid('user_id').notNull().references(() => appUser.id),
  roleId: uuid('role_id').notNull().references(() => role.id),
  grantedBy: uuid('granted_by'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

export const team = pgTable('team', {
  id: id(),
  tenantId: tenantId(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  kind: text('kind').notNull().default('sales'),
  managerId: uuid('manager_id').references(() => appUser.id),
  ...audit,
});

export const teamMember = pgTable('team_member', {
  tenantId: tenantId(),
  teamId: uuid('team_id').notNull().references(() => team.id),
  userId: uuid('user_id').notNull().references(() => appUser.id),
}, (t) => [primaryKey({ columns: [t.teamId, t.userId] })]);

/** Numbering series (legacy formats preserved); counters per period bucket, allocated under a row lock. */
export const numberingSeries = pgTable('numbering_series', {
  id: id(),
  tenantId: tenantId(),
  documentType: text('document_type').notNull(),
  pattern: text('pattern').notNull(),
  reset: text('reset').notNull().default('never'),
  /** first value when a bucket starts (lets the series continue the legacy numbers) */
  startAt: integer('start_at').notNull().default(1),
  ...audit,
}, (t) => [uniqueIndex('numbering_series_type_uq').on(t.tenantId, t.documentType)]);

export const numberingCounter = pgTable('numbering_counter', {
  tenantId: tenantId(),
  seriesId: uuid('series_id').notNull().references(() => numberingSeries.id),
  periodKey: text('period_key').notNull().default(''),
  lastValue: integer('last_value').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.seriesId, t.periodKey] })]);

/** Append-only, hash-chained audit log (insert-only for the app role). */
export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: tenantId(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  reason: text('reason'),
  prevHash: text('prev_hash'),
  hash: text('hash').notNull(),
}, (t) => [index('audit_entity_idx').on(t.tenantId, t.entityType, t.entityId)]);

export const loginEvent = pgTable('login_event', {
  id: id(),
  tenantId: uuid('tenant_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  email: text('email'),
  userId: uuid('user_id'),
  method: text('method'),
  result: text('result').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
});

export const file = pgTable('file', {
  id: id(),
  tenantId: tenantId(),
  storageKey: text('storage_key').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  ...audit,
});

export const attachment = pgTable('attachment', {
  id: id(),
  tenantId: tenantId(),
  fileId: uuid('file_id').notNull().references(() => file.id),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  label: text('label'),
  ...audit,
}, (t) => [index('attachment_entity_idx').on(t.tenantId, t.entityType, t.entityId)]);

/** Issued-document archive: every PDF sent/issued, immutable, with hash. */
export const issuedDocument = pgTable('issued_document', {
  id: id(),
  tenantId: tenantId(),
  documentType: text('document_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  number: text('number').notNull(),
  revision: integer('revision').notNull().default(0),
  language: text('language').notNull().default('ar'),
  fileId: uuid('file_id').notNull().references(() => file.id),
  sha256: text('sha256').notNull(),
  issuedBy: uuid('issued_by'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('issued_doc_entity_idx').on(t.tenantId, t.documentType, t.entityId)]);

export const approvalRequest = pgTable('approval_request', {
  id: id(),
  tenantId: tenantId(),
  documentType: text('document_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
  requestedBy: uuid('requested_by'),
  status: text('status').notNull().default('pending'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  comment: text('comment'),
  ...audit,
}, (t) => [index('approval_entity_idx').on(t.tenantId, t.documentType, t.entityId)]);

export const notification = pgTable('notification', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull().references(() => appUser.id),
  kind: text('kind').notNull(),
  titleAr: text('title_ar').notNull(),
  titleEn: text('title_en'),
  link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: audit.createdAt,
}, (t) => [index('notification_user_idx').on(t.tenantId, t.userId, t.readAt)]);

/** Transactional outbox (written in the same transaction as the change). */
export const outboxEvent = pgTable('outbox_event', {
  id: id(),
  tenantId: tenantId(),
  aggregate: text('aggregate').notNull(),
  aggregateId: uuid('aggregate_id'),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: audit.createdAt,
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
}, (t) => [index('outbox_pending_idx').on(t.deliveredAt, t.createdAt)]);

/** Idempotent inbox for webhooks (ERPNext, WhatsApp, payments, e-sign). */
export const inboxEvent = pgTable('inbox_event', {
  id: id(),
  tenantId: uuid('tenant_id'),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
}, (t) => [uniqueIndex('inbox_source_ext_uq').on(t.source, t.externalId)]);

export const customFieldDef = pgTable('custom_field_def', {
  id: id(),
  tenantId: tenantId(),
  entity: text('entity').notNull(),
  key: text('key').notNull(),
  labelAr: text('label_ar').notNull(),
  labelEn: text('label_en'),
  type: text('type').notNull(),
  options: jsonb('options'),
  required: boolean('required').notNull().default(false),
  custom: custom(),
  ...audit,
});


/** Public holidays and company closures (Eid al-Fitr, Eid al-Adha, Founding Day, National Day…). */
export const businessHoliday = pgTable('business_holiday', {
  id: id(),
  tenantId: tenantId(),
  date: date('date').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  ...audit,
}, (t) => [uniqueIndex('business_holiday_date_uq').on(t.tenantId, t.date)]);
