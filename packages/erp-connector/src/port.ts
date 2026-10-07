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
  /** unit prices include VAT (advances: the 386 must equal the cash received exactly) */
  taxInclusive?: boolean;
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

// ───────────────────────── Phase 5: procurement & stock (module 07 → ERPNext) ─────────────────────────
// Core keeps the operational records (POs, receipts, bills, stock moves, landed cost); the back office
// owns the ledger. Each push carries an idempotency key, so a retry after a timeout never posts twice.
// Money is in the document currency with `conversionRate` = SAR per 1 unit (SAR documents: 1).

export interface NationalAddress {
  buildingNumber?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  postalCode?: string | null;
  additionalNumber?: string | null;
  country?: string | null;
}

export interface SupplierPayload {
  idempotencyKey: string;
  coreId: string;
  name: string;
  nameEn?: string | null;
  /** 700 unified number (preferred) or CR */
  unifiedNumber?: string | null;
  crNumber?: string | null;
  vatNumber?: string | null;
  address?: NationalAddress | null;
  /** default purchasing currency (ISO 4217) */
  currency: string;
  paymentTermsDays?: number | null;
  email?: string | null;
  phone?: string | null;
}

export interface WarehousePayload {
  idempotencyKey: string;
  coreId: string;
  code: string;
  name: string;
  /** main | van | site | transit | quarantine */
  kind: string;
}

export interface PurchaseOrderPayload {
  idempotencyKey: string;
  coreId: string;
  /** Core number (PO-00001), kept on the ERP document */
  number: string;
  supplierErpName: string;
  orderDate: string;
  scheduleDate: string;
  currency: string;
  conversionRate: string;
  incoterm?: string | null;
  /** ERP Project name (Core project number) when the PO is for a project */
  project?: string | null;
  warehouseErpName?: string | null;
  /** VAT on the PO (local VAT-registered suppliers only) — selects the purchase tax template */
  vatAmount?: string;
  remarks?: string | null;
  lines: { coreLineId: string; itemCode: string; description?: string | null; qty: string; rate: string; project?: string | null }[];
}

export interface ReceiptPayload {
  idempotencyKey: string;
  coreId: string;
  number: string;
  supplierErpName: string;
  postingDate: string;
  warehouseErpName: string;
  purchaseOrderErpName?: string | null;
  /** the PO currency (ERPNext requires a receipt against a PO to keep its currency) */
  currency: string;
  conversionRate: string;
  project?: string | null;
  remarks?: string | null;
  lines: {
    coreLineId: string;
    /** Core PO line id — mapped to the ERP PO row via the core-line custom field */
    poLineCoreId?: string | null;
    itemCode: string;
    qty: string;
    /** in the document currency */
    rate: string;
    /** the same, in SAR (before landed cost) */
    rateSar: string;
    serials: string[];
    warehouseErpName?: string | null;
  }[];
}

export interface SupplierBillPayload {
  idempotencyKey: string;
  coreId: string;
  number: string;
  supplierErpName: string;
  /** the supplier's own invoice number */
  billNo: string;
  billDate: string;
  dueDate?: string | null;
  currency: string;
  conversionRate: string;
  purchaseOrderErpName?: string | null;
  purchaseReceiptErpNames?: string[];
  vatAmount: string;
  total: string;
  /** supplier's ZATCA XML / PDF kept in Core (file id or URL) — referenced, not uploaded */
  zatcaXmlRef?: string | null;
  lines: { poLineCoreId?: string | null; itemCode: string; qty: string; rate: string }[];
}

export type StockEntryPurpose = 'Material Transfer' | 'Material Issue' | 'Material Receipt';

export interface StockEntryPayload {
  idempotencyKey: string;
  purpose: StockEntryPurpose;
  postingDate: string;
  project?: string | null;
  remarks?: string | null;
  /** the Core document that caused the moves */
  core: { refType: string | null; refId: string | null; moveIds: string[] };
  lines: { itemCode: string; qty: string; sourceWarehouse?: string | null; targetWarehouse?: string | null; basicRateSar?: string | null; serials: string[]; project?: string | null }[];
}

export interface LandedCostPayload {
  idempotencyKey: string;
  coreId: string;
  /** Core shipment number */
  number: string;
  postingDate: string;
  receipts: { receiptErpName: string; supplierErpName: string; grandTotalSar?: string | null }[];
  /** duty and charges in SAR; `kind` selects the expense account (duty, freight, clearance…) */
  charges: { kind: string; description: string; amountSar: string }[];
  /** value | qty | weight | volume (Core basis) */
  basis: string;
}

/** ERPNext Project, so stock entries / POs / receipts can carry `project` (upserted by Core id). */
export interface ProjectPayload {
  coreId: string;
  /** Project name in ERPNext (Core project number, e.g. PRJ-0001) */
  name: string;
  /** human title (kept in the Project notes) */
  title?: string | null;
  /** ERPNext Customer name of the project's customer, when synced */
  customerErpName?: string | null;
  /** Core status: active | on_hold | closed | cancelled */
  status: string;
  expectedStart?: string | null;
  expectedEnd?: string | null;
}

export interface DocResult {
  erpName: string;
  /** ERP document number (in ERPNext the name is the number) */
  docNumber: string;
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
  // Phase 5 — procurement & stock
  upsertSupplier(s: SupplierPayload): Promise<{ erpName: string }>;
  upsertWarehouse(w: WarehousePayload): Promise<{ erpName: string }>;
  upsertProject(p: ProjectPayload): Promise<{ erpName: string }>;
  createPurchaseOrder(p: PurchaseOrderPayload): Promise<DocResult>;
  createPurchaseReceipt(p: ReceiptPayload): Promise<DocResult>;
  createPurchaseInvoice(p: SupplierBillPayload): Promise<DocResult>;
  createStockEntry(p: StockEntryPayload): Promise<DocResult>;
  createLandedCostVoucher(p: LandedCostPayload): Promise<DocResult>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export class BackOfficeError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false, readonly body?: unknown) {
    super(message);
    this.name = 'BackOfficeError';
  }
}
