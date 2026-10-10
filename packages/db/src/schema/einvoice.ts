import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { audit, id, tenantId } from './_common.js';
import { invoiceMirror } from './finance.js';

/**
 * ZATCA Phase-2 e-invoicing (Phase 6D). Behind `ledger_settings.einvoice_enabled`; only meaningful
 * once the company is VAT-registered and ZATCA has notified it.
 *
 * `einvoice_document` carries the signed XML and its hash-chain position (ICV / PIH). A trigger
 * (migration 0039) keeps everything that is part of the signed document immutable and forbids
 * deletes — only the submission outcome (status, response, cleared XML, attempts) moves.
 */

/** One EGS unit = one certificate (CSID) and one gapless ICV / PIH chain. */
export const einvoiceEgs = pgTable('einvoice_egs', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  /** sandbox | simulation | production */
  environment: text('environment').notNull().default('sandbox'),
  /** "1-<solution>|2-<model>|3-<uuid>" — segment 3 makes a unit a unit */
  serial: text('serial'),
  /** draft | csr_generated | compliance_csid | compliance_passed | production | revoked */
  status: text('status').notNull().default('draft'),
  /** AES-256-GCM boxes (common/secret-box) — never the clear key, CSID or secret */
  privateKeyEnc: text('private_key_enc'),
  csr: text('csr'),
  complianceRequestId: text('compliance_request_id'),
  complianceCsidEnc: text('compliance_csid_enc'),
  complianceSecretEnc: text('compliance_secret_enc'),
  csidEnc: text('csid_enc'),
  csidSecretEnc: text('csid_secret_enc'),
  /** PEM of the compliance and production certificates (public — they ship inside every invoice) */
  complianceCertificate: text('compliance_certificate'),
  certificate: text('certificate'),
  /** the six compliance documents' outcome from the last run */
  complianceResults: jsonb('compliance_results').$type<{ kind: string; subtype: string; accepted: boolean; errors: string[]; warnings: string[] }[]>(),
  /** invoice counter value of the last issued document (gapless) */
  icvCounter: integer('icv_counter').notNull().default(0),
  /** hash of the last issued document (base64) — the PIH of the next one */
  lastPih: text('last_pih'),
  liveFrom: timestamp('live_from', { withTimezone: true }),
  ...audit,
});

export const einvoiceDocument = pgTable('einvoice_document', {
  id: id(),
  tenantId: tenantId(),
  egsId: uuid('egs_id').notNull().references(() => einvoiceEgs.id),
  invoiceId: uuid('invoice_id').notNull().references(() => invoiceMirror.id),
  /** the invoice number printed on the document */
  number: text('number').notNull(),
  /** 388 | 386 | 381 | 383 */
  typeCode: text('type_code').notNull(),
  /** standard | simplified */
  subtype: text('subtype').notNull(),
  icv: integer('icv').notNull(),
  uuid: text('uuid').notNull(),
  pih: text('pih').notNull(),
  invoiceHash: text('invoice_hash').notNull(),
  issueDate: date('issue_date').notNull(),
  issueTime: text('issue_time').notNull(),
  /** the signed UBL as issued */
  xml: text('xml').notNull(),
  qr: text('qr').notNull(),
  /** clearance (standard / B2B) | reporting (simplified / B2C) */
  submission: text('submission').notNull(),
  /** pending → cleared | reported | rejected (permanent) ; error = transient failure, retried */
  status: text('status').notNull().default('pending'),
  zatcaResponse: jsonb('zatca_response').$type<Record<string, unknown>>(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  /** the XML ZATCA stamped on clearance — the legal document from then on */
  clearedXml: text('cleared_xml'),
  /** a rejected document replaced by a fresh one for the same invoice */
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  ...audit,
}, (t) => [
  uniqueIndex('einvoice_document_icv_uq').on(t.tenantId, t.egsId, t.icv),
  uniqueIndex('einvoice_document_uuid_uq').on(t.tenantId, t.uuid),
  uniqueIndex('einvoice_document_invoice_uq').on(t.tenantId, t.invoiceId).where(sql`${t.supersededAt} is null`),
  index('einvoice_document_status_idx').on(t.tenantId, t.status, t.icv),
]);
