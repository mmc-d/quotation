import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { amount, audit, id, tenantId } from './_common.js';
import { party } from './parties.js';
import { billingMilestone, contract } from './sales.js';

/**
 * Phase 3 — invoicing & collections. The ledger and ZATCA live in the back office (ERPNext + KSA
 * app). Core owns milestones and payment requests; invoice_mirror / payment_mirror are written
 * only by the back-office port (sync), never by users.
 */
export const paymentRequest = pgTable('payment_request', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  milestoneId: uuid('milestone_id').references(() => billingMilestone.id),
  contractId: uuid('contract_id').references(() => contract.id),
  partyId: uuid('party_id').references(() => party.id),
  amount: amount('amount').notNull(),
  dueDate: date('due_date').notNull(),
  /** draft → sent → partially_paid → paid / cancelled */
  status: text('status').notNull().default('draft'),
  paidAmount: amount('paid_amount').notNull().default('0'),
  paymentLinkUrl: text('payment_link_url'),
  paymentLinkProviderId: text('payment_link_provider_id'),
  publicToken: text('public_token'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  remindersSent: jsonb('reminders_sent').$type<number[]>().notNull().default([]),
  /** AMC billing (Phase 7b): the service agreement and the period this request covers */
  agreementId: uuid('agreement_id'),
  periodFrom: date('period_from'),
  periodTo: date('period_to'),
  ...audit,
}, (t) => [uniqueIndex('payment_request_number_uq').on(t.tenantId, t.number), uniqueIndex('payment_request_token_uq').on(t.publicToken)]);

export const invoiceMirror = pgTable('invoice_mirror', {
  id: id(),
  tenantId: tenantId(),
  erpName: text('erp_name').notNull(),
  number: text('number').notNull(),
  /** 386 prepayment / 388 tax / 381 credit / 383 debit */
  typeCode: text('type_code').notNull(),
  subtype: text('subtype').notNull().default('standard'),
  partyId: uuid('party_id').references(() => party.id),
  contractId: uuid('contract_id').references(() => contract.id),
  milestoneId: uuid('milestone_id').references(() => billingMilestone.id),
  paymentRequestId: uuid('payment_request_id').references(() => paymentRequest.id),
  originalInvoiceId: uuid('original_invoice_id'),
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date'),
  currency: text('currency').notNull().default('SAR'),
  taxable: amount('taxable').notNull(),
  vatAmount: amount('vat_amount').notNull(),
  total: amount('total').notNull(),
  prepaidAmount: amount('prepaid_amount').notNull().default('0'),
  balanceDue: amount('balance_due').notNull(),
  lines: jsonb('lines').notNull().default([]),
  zatcaUuid: text('zatca_uuid'),
  /** pending / cleared / reported / warning / rejected / error / not_applicable */
  zatcaStatus: text('zatca_status').notNull().default('pending'),
  qrPayload: text('qr_payload'),
  pdfFileId: uuid('pdf_file_id'),
  status: text('status').notNull().default('issued'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  ...audit,
}, (t) => [uniqueIndex('invoice_mirror_erp_uq').on(t.tenantId, t.erpName), index('invoice_mirror_party_idx').on(t.tenantId, t.partyId)]);

export const paymentMirror = pgTable('payment_mirror', {
  id: id(),
  tenantId: tenantId(),
  erpName: text('erp_name').notNull(),
  partyId: uuid('party_id').references(() => party.id),
  paymentRequestId: uuid('payment_request_id').references(() => paymentRequest.id),
  amount: amount('amount').notNull(),
  paidOn: date('paid_on').notNull(),
  method: text('method').notNull(),
  reference: text('reference'),
  allocations: jsonb('allocations').$type<{ invoiceErpName: string; amount: string }[]>().notNull().default([]),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  ...audit,
}, (t) => [uniqueIndex('payment_mirror_erp_uq').on(t.tenantId, t.erpName)]);

/** Core entity ↔ back-office document link. */
export const erpLink = pgTable('erp_link', {
  id: id(),
  tenantId: tenantId(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  erpDoctype: text('erp_doctype').notNull(),
  erpName: text('erp_name').notNull(),
  checksum: text('checksum'),
  syncStatus: text('sync_status').notNull().default('synced'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
}, (t) => [uniqueIndex('erp_link_entity_uq').on(t.tenantId, t.entityType, t.entityId, t.erpDoctype)]);

export const syncReconciliationRun = pgTable('sync_reconciliation_run', {
  id: id(),
  tenantId: tenantId(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  entity: text('entity').notNull(),
  coreCount: integer('core_count').notNull(),
  erpCount: integer('erp_count').notNull(),
  coreTotal: amount('core_total'),
  erpTotal: amount('erp_total'),
  status: text('status').notNull(),
  drift: jsonb('drift'),
});

/**
 * Cash vouchers — سند صرف (payment) / سند قبض (receipt), entered by finance staff. A voucher is a
 * draft until a second person with voucher.approve stamps it (the stamp is the approval); approved
 * vouchers are read-only and can only be cancelled with a reason. These are office documents, not
 * ledger postings — the ledger stays behind the back-office port.
 */
export const cashVoucher = pgTable('cash_voucher', {
  id: id(),
  tenantId: tenantId(),
  /** payment (صرف) | receipt (قبض) */
  kind: text('kind').notNull(),
  number: text('number').notNull(),
  voucherDate: date('voucher_date').notNull(),
  partyId: uuid('party_id').references(() => party.id),
  /** paid to / received from — free text so walk-in payees work without a party record */
  counterpartyName: text('counterparty_name').notNull(),
  counterpartyIdNumber: text('counterparty_id_number'),
  counterpartyMobile: text('counterparty_mobile'),
  amount: amount('amount').notNull(),
  purpose: text('purpose').notNull(),
  /** cash | cheque | transfer | card | other */
  method: text('method').notNull().default('cash'),
  /** cheque or transfer number */
  methodRef: text('method_ref'),
  bankName: text('bank_name'),
  methodDate: date('method_date'),
  projectId: uuid('project_id'),
  costCenter: text('cost_center'),
  /** PO / invoice / bill number this voucher settles */
  docRef: text('doc_ref'),
  notes: text('notes'),
  /** draft | approved | cancelled */
  status: text('status').notNull().default('draft'),
  approvedBy: uuid('approved_by'),
  approvedByName: text('approved_by_name'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  cancelledBy: uuid('cancelled_by'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  ...audit,
}, (t) => [
  uniqueIndex('cash_voucher_number_uq').on(t.tenantId, t.number),
  index('cash_voucher_kind_date_idx').on(t.tenantId, t.kind, t.voucherDate),
]);
