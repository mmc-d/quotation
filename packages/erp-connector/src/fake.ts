import { randomUUID } from 'node:crypto';
import { computeInvoiceLines, dec, finalInvoiceWithPrepayments, halalasToFixed, phase1QrPayload, prepaymentInvoice, riyadhTime, toHalalas } from '@mmc/domain';
import {
  BackOfficeError, type BackOfficePort, type CreateInvoicePayload, type CustomerPayload, type DocResult, type InvoiceResult, type ItemPayload, type LandedCostPayload, type PaymentResult,
  type PurchaseOrderPayload, type ReceiptPayload, type RecordPaymentPayload, type StockEntryPayload, type SupplierBillPayload, type SupplierPayload, type WarehousePayload,
} from './port.js';

/** Storage kinds of the fake (one folder each in the API's file store). */
export type FakeKind = 'invoice' | 'payment' | 'customer' | 'item' | 'supplier' | 'warehouse' | 'purchase_order' | 'purchase_receipt' | 'purchase_invoice' | 'stock_entry' | 'landed_cost' | 'seq';

/** Deterministic fake document names: PO-FAKE-0001 … (development only). */
const DOC_PREFIX = {
  purchase_order: 'PO-FAKE',
  purchase_receipt: 'PREC-FAKE',
  purchase_invoice: 'PINV-FAKE',
  stock_entry: 'STE-FAKE',
  landed_cost: 'LCV-FAKE',
} as const;
type DocKind = keyof typeof DOC_PREFIX;

/**
 * In-process back office for development and tests: computes invoices with @mmc/domain (the same
 * rules the ERPNext integration is verified against), numbers them through the caller's series
 * allocator, and produces a Phase-1 QR when the seller is VAT-registered. It is NOT a ZATCA Phase-2
 * system — production must use the ERPNext adapter with the KSA compliance app.
 */
export interface FakeBackOfficeOptions {
  nextInvoiceNumber: () => Promise<string>;
  seller: () => Promise<{ name: string; vatNumber: string | null; vatRegistered: boolean }>;
  /** optional persistence; defaults to in-memory maps */
  store?: {
    load(kind: FakeKind, key: string): Promise<unknown | null>;
    save(kind: FakeKind, key: string, value: unknown): Promise<void>;
    list(kind: FakeKind): Promise<unknown[]>;
  };
}

export class FakeBackOffice implements BackOfficePort {
  readonly kind = 'fake' as const;
  private mem = new Map<string, unknown>();
  private byIdem = new Map<string, string>();
  constructor(private readonly opts: FakeBackOfficeOptions) {}

  private async load<T>(kind: FakeKind, key: string): Promise<T | null> {
    if (this.opts.store) return (await this.opts.store.load(kind, key)) as T | null;
    return (this.mem.get(`${kind}:${key}`) as T) ?? null;
  }
  private async save(kind: FakeKind, key: string, value: unknown) {
    if (this.opts.store) return this.opts.store.save(kind, key, value);
    this.mem.set(`${kind}:${key}`, value);
  }
  private async list<T>(kind: FakeKind): Promise<T[]> {
    if (this.opts.store) return (await this.opts.store.list(kind)) as T[];
    return [...this.mem.entries()].filter(([k]) => k.startsWith(`${kind}:`) && !k.includes(':idem:')).map(([, v]) => v as T);
  }

  async upsertCustomer(c: CustomerPayload) {
    const erpName = `CUST-${c.coreId.slice(-8).toUpperCase()}`;
    await this.save('customer', erpName, c);
    return { erpName };
  }

  async upsertItem(i: ItemPayload) {
    await this.save('item', i.code, i);
    return { erpName: i.code };
  }

  async createInvoice(p: CreateInvoicePayload): Promise<InvoiceResult> {
    const existing = this.byIdem.get(p.idempotencyKey) ?? (await this.load<string>('invoice', `idem:${p.idempotencyKey}`));
    if (existing) {
      const inv = await this.load<InvoiceResult>('invoice', existing);
      if (inv) return inv;
    }
    const seller = await this.opts.seller();
    const rate = seller.vatRegistered ? p.vatRate : 0;
    const base = p.taxInclusive
      ? prepaymentInvoice(p.lines.reduce((s, l) => s + dec(l.unitPrice).times(l.qty).times(100).toDecimalPlaces(0).toNumber(), 0), p.lines[0]?.description ?? '', rate)
      : computeInvoiceLines(
        p.lines.map((l) => ({ code: l.code, name: l.description, qty: l.qty, unitPrice: l.unitPrice })),
        toHalalas(p.discount ?? '0'),
        rate,
      );
    const priced = p.typeCode === '388' && p.prepayments?.length
      ? finalInvoiceWithPrepayments(base, p.prepayments.map((x) => ({ total: toHalalas(x.total), vat: toHalalas(x.vat) })))
      : base;
    const sign = p.typeCode === '381' ? -1 : 1;
    const number = await this.opts.nextInvoiceNumber();
    const t = priced.totals;
    const total = t.total * sign;
    const vat = t.vat * sign;
    const qr = seller.vatRegistered && seller.vatNumber
      ? phase1QrPayload({ sellerName: seller.name, vatNumber: seller.vatNumber, issueDate: p.issueDate, issueTime: riyadhTime(), total: total / 100, vat: vat / 100 })
      : null;
    const inv: InvoiceResult = {
      erpName: number,
      number,
      typeCode: p.typeCode,
      subtype: p.customer.b2b ? 'standard' : 'simplified',
      issueDate: p.issueDate,
      dueDate: p.dueDate ?? null,
      taxable: halalasToFixed(t.taxable * sign),
      vat: halalasToFixed(vat),
      total: halalasToFixed(total),
      prepaid: halalasToFixed(t.prepaid ?? 0),
      balanceDue: halalasToFixed(t.payable ?? total),
      lines: priced.lines.map((l) => ({ code: l.code, description: l.name, qty: String(l.qty), unitPrice: String(l.unitPrice), net: halalasToFixed(l.net * sign), vat: halalasToFixed(l.vat * sign), total: halalasToFixed(l.total * sign) })),
      zatcaUuid: randomUUID(),
      zatcaStatus: seller.vatRegistered ? (p.customer.b2b ? 'cleared' : 'reported') : 'not_applicable',
      qrPayload: qr,
      pdfUrl: null,
      status: 'issued',
    };
    await this.save('invoice', number, inv);
    await this.save('invoice', `idem:${p.idempotencyKey}`, number);
    this.byIdem.set(p.idempotencyKey, number);
    return inv;
  }

  async getInvoice(erpName: string) {
    return this.load<InvoiceResult>('invoice', erpName);
  }

  async recordPayment(p: RecordPaymentPayload): Promise<PaymentResult> {
    const prior = await this.load<PaymentResult>('payment', `idem:${p.idempotencyKey}`);
    if (prior) return prior;
    const pay: PaymentResult = { erpName: `PE-${randomUUID().slice(0, 8).toUpperCase()}`, amount: p.amount, paidOn: p.paidOn, method: p.method, reference: p.reference ?? null, allocations: p.allocations };
    for (const a of p.allocations) {
      const inv = await this.load<InvoiceResult>('invoice', a.invoiceErpName);
      if (!inv) continue;
      const bal = toHalalas(inv.balanceDue) - toHalalas(a.amount);
      inv.balanceDue = halalasToFixed(Math.max(0, bal));
      inv.status = bal <= 0 ? 'paid' : 'partially_paid';
      await this.save('invoice', inv.erpName, inv);
    }
    await this.save('payment', pay.erpName, pay);
    await this.save('payment', `idem:${p.idempotencyKey}`, pay);
    return pay;
  }

  async listInvoicesSince(since: string) {
    return (await this.list<InvoiceResult>('invoice')).filter((i) => typeof i === 'object' && i && i.issueDate >= since);
  }

  async listPaymentsSince(since: string) {
    return (await this.list<PaymentResult>('payment')).filter((p) => typeof p === 'object' && p && 'paidOn' in p && p.paidOn >= since);
  }

  // ───────────── Phase 5: procurement & stock (in memory / file store; no ledger, no ZATCA) ─────────────

  private async must(kind: FakeKind, key: string | null | undefined, what: string) {
    if (!key || !(await this.load(kind, key))) throw new BackOfficeError(`fake back office: ${what} ${key ?? '(none)'} does not exist — push it first`, 417, false);
  }

  /** Same idempotency key → the same document; otherwise the next deterministic name of that kind. */
  private async createDoc(kind: DocKind, idempotencyKey: string, value: object): Promise<DocResult> {
    const prior = await this.load<string>(kind, `idem:${idempotencyKey}`);
    if (prior) return { erpName: prior, docNumber: prior };
    const n = ((await this.load<number>('seq', kind)) ?? 0) + 1;
    await this.save('seq', kind, n);
    const name = `${DOC_PREFIX[kind]}-${String(n).padStart(4, '0')}`;
    await this.save(kind, name, { name, docstatus: 1, ...value });
    await this.save(kind, `idem:${idempotencyKey}`, name);
    return { erpName: name, docNumber: name };
  }

  async upsertSupplier(s: SupplierPayload) {
    const erpName = `SUP-${s.coreId.slice(-8).toUpperCase()}`;
    await this.save('supplier', erpName, s);
    return { erpName };
  }

  async upsertWarehouse(w: WarehousePayload) {
    const erpName = `${w.code} - FAKE`;
    await this.save('warehouse', erpName, w);
    return { erpName };
  }

  async createPurchaseOrder(p: PurchaseOrderPayload) {
    await this.must('supplier', p.supplierErpName, 'supplier');
    for (const l of p.lines) await this.must('item', l.itemCode, 'item');
    return this.createDoc('purchase_order', p.idempotencyKey, p);
  }

  async createPurchaseReceipt(p: ReceiptPayload) {
    await this.must('supplier', p.supplierErpName, 'supplier');
    await this.must('warehouse', p.warehouseErpName, 'warehouse');
    if (p.purchaseOrderErpName) await this.must('purchase_order', p.purchaseOrderErpName, 'purchase order');
    for (const l of p.lines) await this.must('item', l.itemCode, 'item');
    return this.createDoc('purchase_receipt', p.idempotencyKey, p);
  }

  async createPurchaseInvoice(p: SupplierBillPayload) {
    await this.must('supplier', p.supplierErpName, 'supplier');
    if (p.purchaseOrderErpName) await this.must('purchase_order', p.purchaseOrderErpName, 'purchase order');
    for (const r of p.purchaseReceiptErpNames ?? []) await this.must('purchase_receipt', r, 'purchase receipt');
    return this.createDoc('purchase_invoice', p.idempotencyKey, p);
  }

  async createStockEntry(p: StockEntryPayload) {
    if (!p.lines.length) throw new BackOfficeError('fake back office: a stock entry needs at least one line', 417, false);
    for (const l of p.lines) {
      await this.must('item', l.itemCode, 'item');
      if (l.sourceWarehouse) await this.must('warehouse', l.sourceWarehouse, 'warehouse');
      if (l.targetWarehouse) await this.must('warehouse', l.targetWarehouse, 'warehouse');
      const okShape = p.purpose === 'Material Transfer' ? !!(l.sourceWarehouse && l.targetWarehouse) : p.purpose === 'Material Issue' ? !!l.sourceWarehouse : !!l.targetWarehouse;
      if (!okShape) throw new BackOfficeError(`fake back office: ${p.purpose} line ${l.itemCode} has the wrong warehouses`, 417, false);
    }
    return this.createDoc('stock_entry', p.idempotencyKey, p);
  }

  async createLandedCostVoucher(p: LandedCostPayload) {
    for (const r of p.receipts) await this.must('purchase_receipt', r.receiptErpName, 'purchase receipt');
    return this.createDoc('landed_cost', p.idempotencyKey, p);
  }

  async health() {
    return { ok: true, detail: 'fake back office (development only — not ZATCA Phase 2)' };
  }
}
