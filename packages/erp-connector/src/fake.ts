import { randomUUID } from 'node:crypto';
import { computeInvoiceLines, dec, finalInvoiceWithPrepayments, halalasToFixed, phase1QrPayload, prepaymentInvoice, riyadhTime, toHalalas } from '@mmc/domain';
import type { BackOfficePort, CreateInvoicePayload, CustomerPayload, InvoiceResult, ItemPayload, PaymentResult, RecordPaymentPayload } from './port.js';

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
    load(kind: 'invoice' | 'payment' | 'customer' | 'item', key: string): Promise<unknown | null>;
    save(kind: 'invoice' | 'payment' | 'customer' | 'item', key: string, value: unknown): Promise<void>;
    list(kind: 'invoice' | 'payment'): Promise<unknown[]>;
  };
}

export class FakeBackOffice implements BackOfficePort {
  readonly kind = 'fake' as const;
  private mem = new Map<string, unknown>();
  private byIdem = new Map<string, string>();
  constructor(private readonly opts: FakeBackOfficeOptions) {}

  private async load<T>(kind: 'invoice' | 'payment' | 'customer' | 'item', key: string): Promise<T | null> {
    if (this.opts.store) return (await this.opts.store.load(kind, key)) as T | null;
    return (this.mem.get(`${kind}:${key}`) as T) ?? null;
  }
  private async save(kind: 'invoice' | 'payment' | 'customer' | 'item', key: string, value: unknown) {
    if (this.opts.store) return this.opts.store.save(kind, key, value);
    this.mem.set(`${kind}:${key}`, value);
  }
  private async list<T>(kind: 'invoice' | 'payment'): Promise<T[]> {
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

  async health() {
    return { ok: true, detail: 'fake back office (development only — not ZATCA Phase 2)' };
  }
}
