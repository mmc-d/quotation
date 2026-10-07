import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { amount, audit, id, rate, tenantId } from './_common.js';
import { appUser, file } from './platform.js';
import { party } from './parties.js';
import { productCategory } from './catalog.js';
import { contract } from './sales.js';
import { ticket } from './ops.js';
import { materialRequest, purchaseOrder } from './inventory.js';

/** Knowledge base (FSM-85): Arabic-first how-to articles, internal or published to the portal. */
export const kbArticle = pgTable('kb_article', {
  id: id(),
  tenantId: tenantId(),
  slug: text('slug').notNull(),
  titleAr: text('title_ar').notNull(),
  titleEn: text('title_en'),
  bodyAr: text('body_ar').notNull(),
  bodyEn: text('body_en'),
  /** internal | public (shown in the customer portal) */
  visibility: text('visibility').notNull().default('internal'),
  /** draft | published | archived */
  status: text('status').notNull().default('draft'),
  categoryId: uuid('category_id').references(() => productCategory.id),
  productIds: jsonb('product_ids').$type<string[]>().notNull().default([]),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  fileIds: jsonb('file_ids').$type<string[]>().notNull().default([]),
  /** video link (YouTube/Drive) for how-to clips */
  videoUrl: text('video_url'),
  views: integer('views').notNull().default(0),
  helpfulYes: integer('helpful_yes').notNull().default(0),
  helpfulNo: integer('helpful_no').notNull().default(0),
  searchText: text('search_text').notNull().default(''),
  ...audit,
}, (t) => [uniqueIndex('kb_article_slug_uq').on(t.tenantId, t.slug), index('kb_article_search_idx').on(t.tenantId, t.searchText)]);

/** Canned replies (FSM-84) usable in the WhatsApp inbox and on tickets. */
export const cannedReply = pgTable('canned_reply', {
  id: id(),
  tenantId: tenantId(),
  shortcut: text('shortcut').notNull(),
  title: text('title').notNull(),
  bodyAr: text('body_ar').notNull(),
  bodyEn: text('body_en'),
  /** inbox | ticket | both */
  scope: text('scope').notNull().default('both'),
  /** null = shared; else personal */
  ownerId: uuid('owner_id').references(() => appUser.id),
  ...audit,
}, (t) => [uniqueIndex('canned_reply_shortcut_uq').on(t.tenantId, t.shortcut)]);

/** Conversation on a service call: staff replies, customer messages (portal/WhatsApp), internal notes. */
export const ticketMessage = pgTable('ticket_message', {
  id: id(),
  tenantId: tenantId(),
  ticketId: uuid('ticket_id').notNull().references(() => ticket.id, { onDelete: 'cascade' }),
  /** staff | customer | system */
  author: text('author').notNull(),
  authorUserId: uuid('author_user_id').references(() => appUser.id),
  portalAccountId: uuid('portal_account_id'),
  body: text('body').notNull(),
  /** internal notes are never shown to the customer */
  internal: boolean('internal').notNull().default(false),
  fileIds: jsonb('file_ids').$type<string[]>().notNull().default([]),
  /** whatsapp | portal | email | none — where the reply was delivered */
  deliveredVia: text('delivered_via'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ticket_message_ticket_idx').on(t.tenantId, t.ticketId, t.createdAt)]);

/** Request for quotation to several suppliers (INV-65). */
export const rfq = pgTable('rfq', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  materialRequestId: uuid('material_request_id').references(() => materialRequest.id),
  /** draft | sent | closed | cancelled */
  status: text('status').notNull().default('draft'),
  dueDate: date('due_date'),
  lines: jsonb('lines').$type<{ productId: string | null; code: string; description?: string | null; qty: string }[]>().notNull().default([]),
  supplierIds: jsonb('supplier_ids').$type<string[]>().notNull().default([]),
  /** chosen supplier quotation → PO */
  awardedQuoteId: uuid('awarded_quote_id'),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrder.id),
  notes: text('notes'),
  ...audit,
}, (t) => [uniqueIndex('rfq_number_uq').on(t.tenantId, t.number)]);

/** A supplier's answer to an RFQ, compared on landed cost and lead time. */
export const supplierQuote = pgTable('supplier_quote', {
  id: id(),
  tenantId: tenantId(),
  rfqId: uuid('rfq_id').notNull().references(() => rfq.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').notNull().references(() => party.id),
  currency: text('currency').notNull().default('USD'),
  rateToSar: rate('rate_to_sar').notNull().default('3.75'),
  incoterm: text('incoterm'),
  leadTimeDays: integer('lead_time_days'),
  validUntil: date('valid_until'),
  /** estimated freight + duty + clearance as % of goods value, for landed comparison */
  landedPercent: rate('landed_percent').notNull().default('0'),
  lines: jsonb('lines').$type<{ code: string; qty: string; unitPrice: string | null; note?: string | null }[]>().notNull().default([]),
  fileId: uuid('file_id').references(() => file.id),
  notes: text('notes'),
  ...audit,
}, (t) => [uniqueIndex('supplier_quote_uq').on(t.tenantId, t.rfqId, t.supplierId)]);

/** Commission split between reps on a contract (HR-53), shares in percent summing to 100. */
export const commissionSplit = pgTable('commission_split', {
  id: id(),
  tenantId: tenantId(),
  contractId: uuid('contract_id').notNull().references(() => contract.id),
  userId: uuid('user_id').notNull().references(() => appUser.id),
  sharePercent: rate('share_percent').notNull(),
  ...audit,
}, (t) => [uniqueIndex('commission_split_uq').on(t.tenantId, t.contractId, t.userId)]);

/** Monthly sales quota per rep (HR-53 accelerators) — revenue excl. VAT in SAR. */
export const salesQuota = pgTable('sales_quota', {
  id: id(),
  tenantId: tenantId(),
  userId: uuid('user_id').notNull().references(() => appUser.id),
  /** YYYY-MM */
  period: text('period').notNull(),
  amount: amount('amount').notNull(),
  ...audit,
}, (t) => [uniqueIndex('sales_quota_uq').on(t.tenantId, t.userId, t.period)]);

