import { createHmac, timingSafeEqual } from 'node:crypto';
import { halalasToFixed, toHalalas } from '@mmc/domain';
import {
  BackOfficeError, type BackOfficePort, type CreateInvoicePayload, type CustomerPayload, type DocResult, type InvoiceResult, type ItemPayload, type LandedCostPayload, type PaymentResult,
  type PurchaseOrderPayload, type ReceiptPayload, type RecordPaymentPayload, type StockEntryPayload, type SupplierBillPayload, type SupplierPayload, type WarehousePayload, type ZatcaStatus,
} from './port.js';

/**
 * ERPNext v15+ adapter (Frappe REST, token auth). Field names of the KSA compliance app vary by
 * app/version, so they are configurable — confirm them in the Phase-1 "KSA-app capability spike"
 * (386 + PrepaidAmount, EGS per branch, webhooks) before go-live.
 */
export interface ErpNextOptions {
  url: string;
  apiKey: string;
  apiSecret: string;
  company: string;
  /** income/receivable defaults the implementer configures */
  defaultIncomeAccount?: string;
  costCenter?: string;
  taxTemplate?: string;
  /** custom fields on Sales Invoice used by the KSA app / our mmc_ksa extension */
  fields?: Partial<{
    coreIdempotencyKey: string;
    coreContract: string;
    coreMilestone: string;
    prepaymentFlag: string;
    prepaymentRefs: string;
    zatcaStatus: string;
    zatcaUuid: string;
    qr: string;
  }>;
  /** Phase 5 (procurement & stock) — see PHASE5_DEFAULTS below */
  phase5?: Partial<Phase5Options>;
  fetchImpl?: typeof fetch;
}

/**
 * Phase 5 mapping settings (procurement & stock → ERPNext). Everything ERPNext-specific that the
 * implementer may need to change lives here; the defaults are what we will ask them to create.
 *
 * Custom fields to create (Customize Form), all `Data` unless noted:
 *  - `mmc_core_id`            on Supplier, Warehouse, Address — Core UUID (upsert key)
 *  - `mmc_idempotency_key`    on Purchase Order, Purchase Receipt, Purchase Invoice, Stock Entry,
 *                             Landed Cost Voucher (unique) — the retry-safe create key
 *  - `mmc_core_number`        on the same five doctypes — Core document number (PO-00001, GRN-…, SHP-…)
 *  - `mmc_core_line`          on Purchase Order Item — Core PO line id; receipts/bills find
 *                             `purchase_order_item` / `po_detail` through it
 *  - `mmc_unified_number`, `mmc_cr_number`, `mmc_payment_terms_days` (Int) on Supplier
 *  - `mmc_supplier_zatca_xml` on Purchase Invoice — reference to the supplier's ZATCA XML kept in Core
 *  - `mmc_core_ref`           on Stock Entry — "<refType>:<refId>" of the Core document
 */
export interface Phase5Options {
  fields: {
    coreId: string;
    coreNumber: string;
    coreLine: string;
    coreRef: string;
    unifiedNumber: string;
    crNumber: string;
    paymentTermsDays: string;
    supplierZatcaXml: string;
    /** KSA address fields of the compliance app (building no., additional no.) */
    addressBuildingNumber: string;
    addressAdditionalNumber: string;
  };
  supplierGroup: string;
  /** Payment Terms Template per Core payment-terms days (e.g. { 30: 'Net 30' }); unmapped → only the custom Int field */
  paymentTermsTemplates: Record<number, string>;
  /** parent group warehouse for Core warehouses (null = company root) */
  warehouseParent: string | null;
  /** ERPNext Warehouse Type per Core kind (ERPNext ships "Transit") */
  warehouseTypes: Record<string, string>;
  /** Purchase Taxes and Charges Template applied when the document carries VAT */
  purchaseTaxTemplate: string | null;
  /** Expense account per landed-cost charge kind (duty, freight, clearance, port, transport, insurance…) */
  landedCostAccounts: Record<string, string>;
  /** account for unmapped charge kinds */
  defaultLandedCostAccount: string;
  /** Core basis → distribute_charges_based_on */
  landedBasis: Record<string, 'Qty' | 'Amount' | 'Distribute Manually'>;
}

export const PHASE5_DEFAULTS: Phase5Options = {
  fields: {
    coreId: 'mmc_core_id',
    coreNumber: 'mmc_core_number',
    coreLine: 'mmc_core_line',
    coreRef: 'mmc_core_ref',
    unifiedNumber: 'mmc_unified_number',
    crNumber: 'mmc_cr_number',
    paymentTermsDays: 'mmc_payment_terms_days',
    supplierZatcaXml: 'mmc_supplier_zatca_xml',
    addressBuildingNumber: 'custom_building_number',
    addressAdditionalNumber: 'custom_additional_number',
  },
  supplierGroup: 'All Supplier Groups',
  paymentTermsTemplates: {},
  warehouseParent: null,
  warehouseTypes: { transit: 'Transit' },
  purchaseTaxTemplate: null,
  landedCostAccounts: {},
  defaultLandedCostAccount: 'Expenses Included In Valuation',
  // ERPNext has no weight/volume basis: those are distributed by amount (Core keeps its own allocation).
  landedBasis: { qty: 'Qty', value: 'Amount', weight: 'Amount', volume: 'Amount' },
};

const DEFAULT_FIELDS = {
  coreIdempotencyKey: 'mmc_idempotency_key',
  coreContract: 'mmc_contract',
  coreMilestone: 'mmc_milestone',
  prepaymentFlag: 'mmc_is_prepayment',
  prepaymentRefs: 'mmc_prepayment_invoices',
  zatcaStatus: 'custom_zatca_status',
  zatcaUuid: 'custom_zatca_uuid',
  qr: 'custom_zatca_qr',
};

type Doc = Record<string, unknown>;

export class ErpNextBackOffice implements BackOfficePort {
  readonly kind = 'erpnext' as const;
  private f: typeof DEFAULT_FIELDS;
  private p5: Phase5Options;
  private fetch: typeof fetch;
  constructor(private readonly o: ErpNextOptions) {
    this.f = { ...DEFAULT_FIELDS, ...(o.fields ?? {}) };
    this.p5 = { ...PHASE5_DEFAULTS, ...(o.phase5 ?? {}), fields: { ...PHASE5_DEFAULTS.fields, ...(o.phase5?.fields ?? {}) } };
    this.fetch = o.fetchImpl ?? fetch;
  }

  private async req<T = Doc>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(`${this.o.url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `token ${this.o.apiKey}:${this.o.apiSecret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Doc) : {};
    if (!res.ok) throw new BackOfficeError(`ERPNext ${method} ${path} → ${res.status}`, res.status, res.status >= 500 || res.status === 429, json);
    return ((json.data ?? json.message ?? json) as T);
  }

  private async findOne(doctype: string, filters: unknown[][]): Promise<Doc | null> {
    const q = new URLSearchParams({ filters: JSON.stringify(filters), fields: JSON.stringify(['name']), limit_page_length: '1' });
    const rows = await this.req<Doc[]>('GET', `/api/resource/${encodeURIComponent(doctype)}?${q}`);
    return rows[0] ?? null;
  }

  async upsertCustomer(c: CustomerPayload) {
    const doc: Doc = {
      customer_name: c.name,
      customer_type: c.b2b ? 'Company' : 'Individual',
      customer_group: 'All Customer Groups',
      territory: 'Saudi Arabia',
      tax_id: c.vatNumber ?? undefined,
      mmc_core_id: c.coreId,
      email_id: c.email ?? undefined,
      mobile_no: c.phone ?? undefined,
    };
    const existing = await this.findOne('Customer', [['mmc_core_id', '=', c.coreId]]);
    if (existing) {
      await this.req('PUT', `/api/resource/Customer/${encodeURIComponent(String(existing.name))}`, doc);
      return { erpName: String(existing.name) };
    }
    const created = await this.req<Doc>('POST', '/api/resource/Customer', doc);
    return { erpName: String(created.name) };
  }

  async upsertItem(i: ItemPayload) {
    const doc: Doc = { item_code: i.code, item_name: i.name.slice(0, 140), description: i.description ?? i.name, item_group: 'All Item Groups', stock_uom: 'Nos', is_stock_item: i.isStock ? 1 : 0, standard_rate: i.listPrice };
    const existing = await this.findOne('Item', [['item_code', '=', i.code]]);
    if (existing) {
      await this.req('PUT', `/api/resource/Item/${encodeURIComponent(i.code)}`, doc);
      return { erpName: i.code };
    }
    const created = await this.req<Doc>('POST', '/api/resource/Item', doc);
    return { erpName: String(created.name) };
  }

  async createInvoice(p: CreateInvoicePayload): Promise<InvoiceResult> {
    const prior = await this.findOne('Sales Invoice', [[this.f.coreIdempotencyKey, '=', p.idempotencyKey]]);
    if (prior) return (await this.getInvoice(String(prior.name)))!;
    const doc: Doc = {
      customer: p.customer.erpName,
      company: this.o.company,
      posting_date: p.issueDate,
      set_posting_time: 1,
      due_date: p.dueDate ?? p.issueDate,
      currency: 'SAR',
      is_return: p.typeCode === '381' ? 1 : 0,
      return_against: p.typeCode === '381' ? p.originalErpName : undefined,
      is_debit_note: p.typeCode === '383' ? 1 : 0,
      remarks: p.remarks ?? p.reason ?? undefined,
      apply_discount_on: 'Net Total',
      discount_amount: p.discount ? Number(p.discount) : 0,
      taxes_and_charges: this.o.taxTemplate,
      // VAT-inclusive pricing (advances): the tax template's rows must use included_in_print_rate.
      mmc_tax_inclusive: p.taxInclusive ? 1 : 0,
      items: p.lines.map((l) => ({
        item_code: l.code,
        description: l.description,
        qty: (p.typeCode === '381' ? -1 : 1) * Number(l.qty),
        rate: Number(l.unitPrice),
        discount_amount: l.discount ? Number(l.discount) / Number(l.qty) : 0,
        income_account: this.o.defaultIncomeAccount,
        cost_center: this.o.costCenter,
      })),
      [this.f.coreIdempotencyKey]: p.idempotencyKey,
      [this.f.coreContract]: p.core.contractNumber ?? undefined,
      [this.f.coreMilestone]: p.core.milestoneId ?? undefined,
      [this.f.prepaymentFlag]: p.typeCode === '386' ? 1 : 0,
      [this.f.prepaymentRefs]: p.prepayments?.length ? JSON.stringify(p.prepayments.map((x) => x.erpName)) : undefined,
    };
    const created = await this.req<Doc>('POST', '/api/resource/Sales Invoice', doc);
    // Submit (docstatus 1): the KSA compliance app signs and clears/reports on submit.
    const submitted = await this.req<Doc>('PUT', `/api/resource/Sales Invoice/${encodeURIComponent(String(created.name))}`, { docstatus: 1 });
    return this.toResult(submitted, p.typeCode);
  }

  async getInvoice(erpName: string) {
    try {
      const d = await this.req<Doc>('GET', `/api/resource/Sales Invoice/${encodeURIComponent(erpName)}`);
      return this.toResult(d);
    } catch (e) {
      if (e instanceof BackOfficeError && e.status === 404) return null;
      throw e;
    }
  }

  private toResult(d: Doc, typeHint?: InvoiceResult['typeCode']): InvoiceResult {
    const typeCode = typeHint ?? (Number(d.is_return) ? '381' : Number(d.is_debit_note) ? '383' : Number(d[this.f.prepaymentFlag]) ? '386' : '388');
    const items = (d.items as Doc[] | undefined) ?? [];
    const total = toHalalas(String(d.grand_total ?? 0));
    const vat = toHalalas(String(d.total_taxes_and_charges ?? 0));
    const outstanding = toHalalas(String(d.outstanding_amount ?? d.grand_total ?? 0));
    const prepaid = toHalalas(String(d.total_advance ?? 0));
    const status = String(d.status ?? '');
    return {
      erpName: String(d.name),
      number: String(d.name),
      typeCode,
      subtype: d.customer_type === 'Individual' ? 'simplified' : 'standard',
      issueDate: String(d.posting_date),
      dueDate: d.due_date ? String(d.due_date) : null,
      taxable: halalasToFixed(toHalalas(String(d.net_total ?? 0))),
      vat: halalasToFixed(vat),
      total: halalasToFixed(total),
      prepaid: halalasToFixed(prepaid),
      balanceDue: halalasToFixed(outstanding),
      lines: items.map((it) => ({ code: String(it.item_code), description: String(it.description ?? it.item_name ?? ''), qty: String(it.qty), unitPrice: String(it.rate), net: halalasToFixed(toHalalas(String(it.net_amount ?? it.amount ?? 0))), vat: '0.00', total: halalasToFixed(toHalalas(String(it.amount ?? 0))) })),
      zatcaUuid: (d[this.f.zatcaUuid] as string) ?? null,
      zatcaStatus: mapZatca(d[this.f.zatcaStatus]),
      qrPayload: (d[this.f.qr] as string) ?? null,
      pdfUrl: `${this.o.url.replace(/\/$/, '')}/api/method/frappe.utils.print_format.download_pdf?doctype=Sales%20Invoice&name=${encodeURIComponent(String(d.name))}`,
      status: status === 'Paid' ? 'paid' : status === 'Partly Paid' ? 'partially_paid' : status === 'Cancelled' ? 'cancelled' : 'issued',
    };
  }

  async recordPayment(p: RecordPaymentPayload): Promise<PaymentResult> {
    const prior = await this.findOne('Payment Entry', [['reference_no', '=', p.idempotencyKey]]);
    const toResult = (d: Doc): PaymentResult => ({ erpName: String(d.name), amount: String(d.paid_amount), paidOn: String(d.posting_date), method: String(d.mode_of_payment ?? p.method), reference: (d.reference_no as string) ?? null, allocations: p.allocations });
    if (prior) return toResult(await this.req<Doc>('GET', `/api/resource/Payment Entry/${encodeURIComponent(String(prior.name))}`));
    const doc: Doc = {
      payment_type: 'Receive',
      party_type: 'Customer',
      party: p.customerErpName,
      company: this.o.company,
      posting_date: p.paidOn,
      paid_amount: Number(p.amount),
      received_amount: Number(p.amount),
      mode_of_payment: p.method,
      reference_no: p.idempotencyKey,
      reference_date: p.paidOn,
      remarks: p.reference ?? undefined,
      references: p.allocations.map((a) => ({ reference_doctype: 'Sales Invoice', reference_name: a.invoiceErpName, allocated_amount: Number(a.amount) })),
    };
    const created = await this.req<Doc>('POST', '/api/resource/Payment Entry', doc);
    const submitted = await this.req<Doc>('PUT', `/api/resource/Payment Entry/${encodeURIComponent(String(created.name))}`, { docstatus: 1 });
    return toResult(submitted);
  }

  async listInvoicesSince(since: string) {
    const q = new URLSearchParams({ filters: JSON.stringify([['posting_date', '>=', since], ['docstatus', '=', 1]]), fields: JSON.stringify(['name']), limit_page_length: '500' });
    const rows = await this.req<Doc[]>('GET', `/api/resource/Sales Invoice?${q}`);
    const out: InvoiceResult[] = [];
    for (const r of rows) {
      const inv = await this.getInvoice(String(r.name));
      if (inv) out.push(inv);
    }
    return out;
  }

  async listPaymentsSince(since: string) {
    const q = new URLSearchParams({ filters: JSON.stringify([['posting_date', '>=', since], ['docstatus', '=', 1], ['payment_type', '=', 'Receive']]), fields: JSON.stringify(['name', 'paid_amount', 'posting_date', 'mode_of_payment', 'reference_no']), limit_page_length: '500' });
    const rows = await this.req<Doc[]>('GET', `/api/resource/Payment Entry?${q}`);
    return rows.map((d) => ({ erpName: String(d.name), amount: String(d.paid_amount), paidOn: String(d.posting_date), method: String(d.mode_of_payment ?? ''), reference: (d.reference_no as string) ?? null, allocations: [] }));
  }

  // ───────────────────────── Phase 5: procurement & stock ─────────────────────────

  /** Create-or-update a master by its Core id (custom field `mmc_core_id`). */
  private async upsertByCoreId(doctype: string, coreId: string, doc: Doc): Promise<string> {
    const existing = await this.findOne(doctype, [[this.p5.fields.coreId, '=', coreId]]);
    if (existing) {
      await this.req('PUT', `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(String(existing.name))}`, doc);
      return String(existing.name);
    }
    const created = await this.req<Doc>('POST', `/api/resource/${encodeURIComponent(doctype)}`, { ...doc, [this.p5.fields.coreId]: coreId });
    return String(created.name);
  }

  /**
   * Idempotent create + submit: a document already carrying this key is returned (and submitted if a
   * previous attempt stopped at draft); otherwise it is inserted and submitted (docstatus 1).
   */
  private async createAndSubmit(doctype: string, idempotencyKey: string, doc: Doc): Promise<DocResult> {
    const path = `/api/resource/${encodeURIComponent(doctype)}`;
    const q = new URLSearchParams({ filters: JSON.stringify([[this.f.coreIdempotencyKey, '=', idempotencyKey]]), fields: JSON.stringify(['name', 'docstatus']), limit_page_length: '1' });
    const [prior] = await this.req<Doc[]>('GET', `${path}?${q}`);
    let name: string;
    if (prior && Number(prior.docstatus) !== 2) {
      name = String(prior.name);
      if (Number(prior.docstatus) === 1) return { erpName: name, docNumber: name };
    } else {
      const created = await this.req<Doc>('POST', path, { ...doc, company: this.o.company, [this.f.coreIdempotencyKey]: idempotencyKey });
      name = String(created.name);
    }
    const submitted = await this.req<Doc>('PUT', `${path}/${encodeURIComponent(name)}`, { docstatus: 1 });
    const n = String(submitted.name ?? name);
    return { erpName: n, docNumber: n };
  }

  /** Map Core PO line ids → ERP Purchase Order Item row names (via the `mmc_core_line` field). */
  private async poRows(poErpName: string | null | undefined): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!poErpName) return out;
    const po = await this.req<Doc>('GET', `/api/resource/Purchase%20Order/${encodeURIComponent(poErpName)}`);
    for (const it of (po.items as Doc[] | undefined) ?? []) {
      const core = it[this.p5.fields.coreLine];
      if (core) out.set(String(core), String(it.name));
    }
    return out;
  }

  async upsertSupplier(s: SupplierPayload) {
    const F = this.p5.fields;
    const terms = s.paymentTermsDays != null ? this.p5.paymentTermsTemplates[s.paymentTermsDays] : undefined;
    const doc: Doc = {
      supplier_name: s.name,
      supplier_type: 'Company',
      supplier_group: this.p5.supplierGroup,
      country: s.address?.country ?? undefined,
      default_currency: s.currency,
      tax_id: s.vatNumber ?? undefined,
      email_id: s.email ?? undefined,
      mobile_no: s.phone ?? undefined,
      payment_terms: terms,
      [F.unifiedNumber]: s.unifiedNumber ?? undefined,
      [F.crNumber]: s.crNumber ?? undefined,
      [F.paymentTermsDays]: s.paymentTermsDays ?? undefined,
    };
    const erpName = await this.upsertByCoreId('Supplier', s.coreId, doc);
    const a = s.address;
    if (a && (a.street || a.city || a.buildingNumber)) {
      await this.upsertByCoreId('Address', `${s.coreId}:billing`, {
        address_title: s.name,
        address_type: 'Billing',
        address_line1: [a.buildingNumber, a.street].filter(Boolean).join(' ') || a.city,
        address_line2: a.district ?? undefined,
        city: a.city ?? '-',
        pincode: a.postalCode ?? undefined,
        country: a.country ?? 'Saudi Arabia',
        is_primary_address: 1,
        [F.addressBuildingNumber]: a.buildingNumber ?? undefined,
        [F.addressAdditionalNumber]: a.additionalNumber ?? undefined,
        links: [{ link_doctype: 'Supplier', link_name: erpName }],
      });
    }
    return { erpName };
  }

  async upsertWarehouse(w: WarehousePayload) {
    const doc: Doc = {
      warehouse_name: `${w.code} ${w.name}`.slice(0, 140),
      company: this.o.company,
      is_group: 0,
      parent_warehouse: this.p5.warehouseParent ?? undefined,
      warehouse_type: this.p5.warehouseTypes[w.kind],
    };
    return { erpName: await this.upsertByCoreId('Warehouse', w.coreId, doc) };
  }

  async createPurchaseOrder(p: PurchaseOrderPayload) {
    const F = this.p5.fields;
    return this.createAndSubmit('Purchase Order', p.idempotencyKey, {
      supplier: p.supplierErpName,
      transaction_date: p.orderDate,
      schedule_date: p.scheduleDate,
      currency: p.currency,
      conversion_rate: Number(p.conversionRate),
      incoterm: p.incoterm ?? undefined,
      project: p.project ?? undefined,
      set_warehouse: p.warehouseErpName ?? undefined,
      taxes_and_charges: p.vatAmount && Number(p.vatAmount) > 0 ? this.p5.purchaseTaxTemplate ?? undefined : undefined,
      remarks: p.remarks ?? undefined,
      [F.coreNumber]: p.number,
      items: p.lines.map((l) => ({
        item_code: l.itemCode,
        description: l.description ?? undefined,
        qty: Number(l.qty),
        rate: Number(l.rate),
        schedule_date: p.scheduleDate,
        warehouse: p.warehouseErpName ?? undefined,
        project: l.project ?? p.project ?? undefined,
        [F.coreLine]: l.coreLineId,
      })),
    });
  }

  async createPurchaseReceipt(p: ReceiptPayload) {
    const F = this.p5.fields;
    const rows = await this.poRows(p.purchaseOrderErpName);
    return this.createAndSubmit('Purchase Receipt', p.idempotencyKey, {
      supplier: p.supplierErpName,
      posting_date: p.postingDate,
      set_posting_time: 1,
      currency: p.currency,
      conversion_rate: Number(p.conversionRate),
      set_warehouse: p.warehouseErpName,
      project: p.project ?? undefined,
      remarks: p.remarks ?? undefined,
      [F.coreNumber]: p.number,
      items: p.lines.map((l) => ({
        item_code: l.itemCode,
        qty: Number(l.qty),
        received_qty: Number(l.qty),
        rate: Number(l.rate),
        warehouse: l.warehouseErpName ?? p.warehouseErpName,
        purchase_order: p.purchaseOrderErpName ?? undefined,
        purchase_order_item: (l.poLineCoreId && rows.get(l.poLineCoreId)) || undefined,
        project: p.project ?? undefined,
        // v15: let the plain serial_no text create the Serial and Batch Bundle
        use_serial_batch_fields: l.serials.length ? 1 : 0,
        serial_no: l.serials.length ? l.serials.join('\n') : undefined,
      })),
    });
  }

  async createPurchaseInvoice(p: SupplierBillPayload) {
    const F = this.p5.fields;
    const rows = await this.poRows(p.purchaseOrderErpName);
    return this.createAndSubmit('Purchase Invoice', p.idempotencyKey, {
      supplier: p.supplierErpName,
      bill_no: p.billNo,
      bill_date: p.billDate,
      posting_date: p.billDate,
      set_posting_time: 1,
      due_date: p.dueDate ?? undefined,
      currency: p.currency,
      conversion_rate: Number(p.conversionRate),
      update_stock: 0,
      taxes_and_charges: Number(p.vatAmount) > 0 ? this.p5.purchaseTaxTemplate ?? undefined : undefined,
      [F.coreNumber]: p.number,
      [F.supplierZatcaXml]: p.zatcaXmlRef ?? undefined,
      items: p.lines.map((l) => ({
        item_code: l.itemCode,
        qty: Number(l.qty),
        rate: Number(l.rate),
        purchase_order: p.purchaseOrderErpName ?? undefined,
        po_detail: (l.poLineCoreId && rows.get(l.poLineCoreId)) || undefined,
        purchase_receipt: p.purchaseReceiptErpNames?.length === 1 ? p.purchaseReceiptErpNames[0] : undefined,
      })),
    });
  }

  async createStockEntry(p: StockEntryPayload) {
    const F = this.p5.fields;
    return this.createAndSubmit('Stock Entry', p.idempotencyKey, {
      stock_entry_type: p.purpose,
      purpose: p.purpose,
      posting_date: p.postingDate,
      set_posting_time: 1,
      project: p.project ?? undefined,
      remarks: p.remarks ?? undefined,
      [F.coreRef]: p.core.refType && p.core.refId ? `${p.core.refType}:${p.core.refId}` : undefined,
      items: p.lines.map((l) => ({
        item_code: l.itemCode,
        qty: Number(l.qty),
        s_warehouse: l.sourceWarehouse ?? undefined,
        t_warehouse: l.targetWarehouse ?? undefined,
        // only receipts (returns, count gains) carry a rate; issues/transfers use ERPNext's valuation
        basic_rate: p.purpose === 'Material Receipt' && l.basicRateSar != null ? Number(l.basicRateSar) : undefined,
        project: l.project ?? p.project ?? undefined,
        use_serial_batch_fields: l.serials.length ? 1 : 0,
        serial_no: l.serials.length ? l.serials.join('\n') : undefined,
      })),
    });
  }

  async createLandedCostVoucher(p: LandedCostPayload) {
    const F = this.p5.fields;
    // The voucher's item rows must point at the receipt rows (purchase_receipt_item); read them back.
    const items: Doc[] = [];
    for (const r of p.receipts) {
      const pr = await this.req<Doc>('GET', `/api/resource/Purchase%20Receipt/${encodeURIComponent(r.receiptErpName)}`);
      for (const it of (pr.items as Doc[] | undefined) ?? []) {
        items.push({
          item_code: it.item_code,
          description: it.description ?? it.item_name,
          qty: it.qty,
          rate: it.base_rate ?? it.rate,
          amount: it.base_amount ?? it.amount,
          receipt_document_type: 'Purchase Receipt',
          receipt_document: r.receiptErpName,
          purchase_receipt_item: it.name,
          cost_center: it.cost_center,
        });
      }
    }
    return this.createAndSubmit('Landed Cost Voucher', p.idempotencyKey, {
      posting_date: p.postingDate,
      distribute_charges_based_on: this.p5.landedBasis[p.basis] ?? 'Amount',
      [F.coreNumber]: p.number,
      purchase_receipts: p.receipts.map((r) => ({ receipt_document_type: 'Purchase Receipt', receipt_document: r.receiptErpName, supplier: r.supplierErpName, grand_total: r.grandTotalSar != null ? Number(r.grandTotalSar) : undefined })),
      items,
      taxes: p.charges.map((c) => ({ description: c.description, expense_account: this.p5.landedCostAccounts[c.kind] ?? this.p5.defaultLandedCostAccount, amount: Number(c.amountSar) })),
    });
  }

  async health() {
    try {
      await this.req('GET', '/api/method/frappe.auth.get_logged_user');
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}

function mapZatca(v: unknown): ZatcaStatus {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('clear')) return 'cleared';
  if (s.includes('report')) return 'reported';
  if (s.includes('warn')) return 'warning';
  if (s.includes('reject')) return 'rejected';
  if (s.includes('error') || s.includes('fail')) return 'error';
  return 'pending';
}

/** Frappe webhook signature: base64(HMAC-SHA256(secret, raw body)) in X-Frappe-Webhook-Signature. */
export function verifyFrappeWebhook(rawBody: Buffer | string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
