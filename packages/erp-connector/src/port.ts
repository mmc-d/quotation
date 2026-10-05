import type { InvoiceTypeCode } from '@mmc/domain';

/**
 * BackOfficePort (docs/erp-plan/03 §10): Core never writes the ledger. Customers/items are pushed,
 * invoices are created in the back office (which signs/clears them with ZATCA), and the results are
 * mirrored back. Every call carries an idempotency key so retries never double-post.
 */
export interface CustomerPayload {
  coreId: string;
  name: string;
  nameEn?: string | null;
  vatNumber?: string | null;
  crNumber?: string | null;
  b2b: boolean;
  email?: string | null;
  phone?: string | null;
  address?: { buildingNumber?: string | null; street?: string | null; district?: string | null; city?: string | null; postalCode?: string | null; additionalNumber?: string | null } | null;
}

export interface ItemPayload {
  coreId: string;
  code: string;
  name: string;
  description?: string | null;
  isStock: boolean;
  listPrice: string;
}

export interface InvoiceLinePayload {
  code: string;
  description: string;
  qty: string;
  /** VAT-exclusive unit price */
  unitPrice: string;
  /** line discount amount (SAR, 2 dp) */
  discount?: string;
}

export interface CreateInvoicePayload {
  idempotencyKey: string;
  typeCode: InvoiceTypeCode;
  customer: { erpName: string; b2b: boolean };
  issueDate: string;
  dueDate?: string | null;
  lines: InvoiceLinePayload[];
  /** document-level discount (SAR, 2 dp), applied before VAT */
  discount?: string;
  vatRate: number;
  /** 388 only: 386 invoices whose amounts are deducted (PrepaidAmount) */
  prepayments?: { erpName: string; total: string; vat: string }[];
  /** 381/383: invoice being corrected and why */
  originalErpName?: string | null;
  reason?: string | null;
  remarks?: string | null;
  core: { contractId?: string | null; milestoneId?: string | null; paymentRequestId?: string | null; contractNumber?: string | null };
}

export type ZatcaStatus = 'pending' | 'cleared' | 'reported' | 'warning' | 'rejected' | 'error' | 'not_applicable';

export interface InvoiceResult {
  erpName: string;
  number: string;
  typeCode: InvoiceTypeCode;
  subtype: 'standard' | 'simplified';
  issueDate: string;
  dueDate: string | null;
  taxable: string;
  vat: string;
  total: string;
  prepaid: string;
  balanceDue: string;
  lines: { code: string; description: string; qty: string; unitPrice: string; net: string; vat: string; total: string }[];
  zatcaUuid: string | null;
  zatcaStatus: ZatcaStatus;
  qrPayload: string | null;
  pdfUrl: string | null;
  status: 'issued' | 'paid' | 'partially_paid' | 'cancelled';
}

export interface RecordPaymentPayload {
  idempotencyKey: string;
  customerErpName: string;
  amount: string;
  paidOn: string;
  method: string;
  reference?: string | null;
  allocations: { invoiceErpName: string; amount: string }[];
}

export interface PaymentResult {
  erpName: string;
  amount: string;
  paidOn: string;
  method: string;
  reference: string | null;
  allocations: { invoiceErpName: string; amount: string }[];
}

export interface BackOfficePort {
  readonly kind: 'erpnext' | 'fake';
  upsertCustomer(c: CustomerPayload): Promise<{ erpName: string }>;
  upsertItem(i: ItemPayload): Promise<{ erpName: string }>;
  createInvoice(p: CreateInvoicePayload): Promise<InvoiceResult>;
  getInvoice(erpName: string): Promise<InvoiceResult | null>;
  recordPayment(p: RecordPaymentPayload): Promise<PaymentResult>;
  listInvoicesSince(since: string): Promise<InvoiceResult[]>;
  listPaymentsSince(since: string): Promise<PaymentResult[]>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export class BackOfficeError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false, readonly body?: unknown) {
    super(message);
    this.name = 'BackOfficeError';
  }
}
