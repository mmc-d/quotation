import { createHmac, timingSafeEqual } from 'node:crypto';
import { halalasToFixed, toHalalas } from '@mmc/domain';
import { BackOfficeError, type BackOfficePort, type CreateInvoicePayload, type CustomerPayload, type InvoiceResult, type ItemPayload, type PaymentResult, type RecordPaymentPayload, type ZatcaStatus } from './port.js';

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
  fetchImpl?: typeof fetch;
}

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
  private fetch: typeof fetch;
  constructor(private readonly o: ErpNextOptions) {
    this.f = { ...DEFAULT_FIELDS, ...(o.fields ?? {}) };
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
