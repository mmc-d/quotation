import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { amount, archivedAt, audit, custom, id, tenantId } from './_common.js';
import { appUser } from './platform.js';

/** One table for every organisation/person; customer fields inline (customer_profile in the plan). */
export const party = pgTable('party', {
  id: id(),
  tenantId: tenantId(),
  kind: text('kind').notNull().default('organization'),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  /** normalised for Arabic search (normalizeArabic) */
  searchText: text('search_text').notNull().default(''),
  unifiedNumber: text('unified_number'),
  crNumber: text('cr_number'),
  vatNumber: text('vat_number'),
  segment: text('segment'),
  source: text('source'),
  ownerId: uuid('owner_id').references(() => appUser.id),
  parentPartyId: uuid('parent_party_id'),
  phone: text('phone'),
  email: text('email'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  isCustomer: boolean('is_customer').notNull().default(true),
  isSupplier: boolean('is_supplier').notNull().default(false),
  isPartner: boolean('is_partner').notNull().default(false),
  /** B2B (standard tax invoice) vs B2C (simplified) — drives ZATCA invoice subtype */
  b2b: boolean('b2b').notNull().default(true),
  paymentTermsDays: integer('payment_terms_days').notNull().default(0),
  /** segment price list applied when quoting this customer (null = list prices) */
  priceListId: uuid('price_list_id'),
  creditLimit: amount('credit_limit'),
  notes: text('notes'),
  /** link to the back office Customer (ERPNext name) */
  erpName: text('erp_name'),
  custom: custom(),
  archivedAt: archivedAt(),
  ...audit,
}, (t) => [index('party_search_idx').on(t.tenantId, t.searchText), index('party_owner_idx').on(t.tenantId, t.ownerId)]);

export const contact = pgTable('contact', {
  id: id(),
  tenantId: tenantId(),
  partyId: uuid('party_id').references(() => party.id),
  name: text('name').notNull(),
  jobTitle: text('job_title'),
  mobile: text('mobile'),
  whatsapp: text('whatsapp'),
  waBsuid: text('wa_bsuid'),
  email: text('email'),
  preferredLanguage: text('preferred_language').notNull().default('ar'),
  preferredChannel: text('preferred_channel').notNull().default('whatsapp'),
  isPrimary: boolean('is_primary').notNull().default(false),
  archivedAt: archivedAt(),
  ...audit,
}, (t) => [index('contact_party_idx').on(t.tenantId, t.partyId), index('contact_mobile_idx').on(t.tenantId, t.mobile)]);

/** PDPL consent evidence per contact × channel × purpose. */
export const consent = pgTable('consent', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull().references(() => contact.id),
  channel: text('channel').notNull(),
  purpose: text('purpose').notNull(),
  status: text('status').notNull(),
  source: text('source'),
  wordingVersion: text('wording_version'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  ...audit,
}, (t) => [index('consent_contact_idx').on(t.tenantId, t.contactId)]);

export const site = pgTable('site', {
  id: id(),
  tenantId: tenantId(),
  partyId: uuid('party_id').notNull().references(() => party.id),
  type: text('type').notNull().default('project'),
  name: text('name').notNull(),
  buildingNumber: text('building_number'),
  street: text('street'),
  district: text('district'),
  city: text('city'),
  postalCode: text('postal_code'),
  additionalNumber: text('additional_number'),
  lat: text('lat'),
  lng: text('lng'),
  mapLink: text('map_link'),
  accessNotes: text('access_notes'),
  archivedAt: archivedAt(),
  ...audit,
}, (t) => [index('site_party_idx').on(t.tenantId, t.partyId)]);
