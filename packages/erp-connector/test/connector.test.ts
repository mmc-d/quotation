import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { ErpNextBackOffice, FakeBackOffice, verifyFrappeWebhook } from '../src/index.js';

function fake(vatRegistered = true) {
  let n = 0;
  return new FakeBackOffice({
    nextInvoiceNumber: async () => `MMC-INV-${String(++n).padStart(5, '0')}`,
    seller: async () => ({ name: 'المدى المبارك', vatNumber: '310122393500003', vatRegistered }),
  });
}

describe('FakeBackOffice', () => {
  it('issues a 386 then a 388 that deducts it, idempotently', async () => {
    const bo = fake();
    const cust = await bo.upsertCustomer({ coreId: 'c1', name: 'عميل', b2b: true });
    const adv = await bo.createInvoice({ idempotencyKey: 'm1', typeCode: '386', customer: { erpName: cust.erpName, b2b: true }, issueDate: '2026-10-05', lines: [{ code: 'ADV', description: 'Advance', qty: '1', unitPrice: '1000' }], vatRate: 15, core: {} });
    const again = await bo.createInvoice({ idempotencyKey: 'm1', typeCode: '386', customer: { erpName: cust.erpName, b2b: true }, issueDate: '2026-10-05', lines: [{ code: 'ADV', description: 'Advance', qty: '1', unitPrice: '1000' }], vatRate: 15, core: {} });
    expect(again.number).toBe(adv.number);
    expect(adv.total).toBe('1150.00');
    expect(adv.qrPayload).toBeTruthy();
    const fin = await bo.createInvoice({ idempotencyKey: 'final', typeCode: '388', customer: { erpName: cust.erpName, b2b: true }, issueDate: '2026-11-01', lines: [{ code: 'X', description: 'System', qty: '2', unitPrice: '1000' }], vatRate: 15, prepayments: [{ erpName: adv.erpName, total: adv.total, vat: adv.vat }], core: {} });
    expect(fin.number).toBe('MMC-INV-00002');
    expect(fin.total).toBe('2300.00');
    expect(fin.prepaid).toBe('1150.00');
    expect(fin.balanceDue).toBe('1150.00');
    const pay = await bo.recordPayment({ idempotencyKey: 'p1', customerErpName: cust.erpName, amount: '1150.00', paidOn: '2026-11-02', method: 'bank_transfer', allocations: [{ invoiceErpName: fin.erpName, amount: '1150.00' }] });
    expect(pay.erpName).toMatch(/^PE-/);
    expect((await bo.getInvoice(fin.erpName))?.status).toBe('paid');
  });

  it('issues plain invoices without VAT or QR when not registered', async () => {
    const bo = fake(false);
    const inv = await bo.createInvoice({ idempotencyKey: 'x', typeCode: '388', customer: { erpName: 'C', b2b: false }, issueDate: '2026-10-05', lines: [{ code: 'A', description: 'A', qty: '1', unitPrice: '100' }], vatRate: 15, core: {} });
    expect(inv.vat).toBe('0.00');
    expect(inv.qrPayload).toBeNull();
    expect(inv.zatcaStatus).toBe('not_applicable');
  });
});

describe('ErpNextBackOffice', () => {
  it('creates and submits a Sales Invoice with idempotency key and maps the result', async () => {
    const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method: String(init.method), url, body });
      const respond = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
      if (init.method === 'GET' && url.includes('/api/resource/Sales%20Invoice?')) return respond([]);
      if (init.method === 'POST') return respond({ name: 'ACC-SINV-0001' });
      if (init.method === 'PUT') return respond({ name: 'ACC-SINV-0001', posting_date: '2026-10-05', grand_total: 1150, total_taxes_and_charges: 150, net_total: 1000, outstanding_amount: 1150, status: 'Unpaid', mmc_is_prepayment: 1, custom_zatca_status: 'CLEARED', items: [] });
      throw new Error(`unexpected ${init.method} ${url}`);
    }) as unknown as typeof fetch;
    const bo = new ErpNextBackOffice({ url: 'https://erp.example', apiKey: 'k', apiSecret: 's', company: 'MMC', fetchImpl });
    const inv = await bo.createInvoice({ idempotencyKey: 'idem-1', typeCode: '386', customer: { erpName: 'CUST-1', b2b: true }, issueDate: '2026-10-05', lines: [{ code: 'ADV', description: 'Advance', qty: '1', unitPrice: '1000' }], vatRate: 15, core: { contractNumber: 'MMCT-1' } });
    expect(inv.total).toBe('1150.00');
    expect(inv.zatcaStatus).toBe('cleared');
    expect(inv.typeCode).toBe('386');
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body?.mmc_idempotency_key).toBe('idem-1');
    expect(post?.body?.mmc_is_prepayment).toBe(1);
    expect(calls.some((c) => c.method === 'PUT' && c.body?.docstatus === 1)).toBe(true);
  });

  it('verifies Frappe webhook signatures', () => {
    const body = '{"name":"ACC-SINV-0001"}';
    const sig = createHmac('sha256', 'sec').update(body).digest('base64');
    expect(verifyFrappeWebhook(body, sig, 'sec')).toBe(true);
    expect(verifyFrappeWebhook(body, sig, 'wrong')).toBe(false);
    expect(verifyFrappeWebhook(body, undefined, 'sec')).toBe(false);
  });
});
