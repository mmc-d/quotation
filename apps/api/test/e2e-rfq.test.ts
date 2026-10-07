import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { riyadhDate } from '@mmc/domain';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * RFQ + bid comparison (INV-65), supplier ZATCA e-invoice ingestion (INV-66) and delivery of the
 * PO to the supplier. Messaging runs in the sandbox (no WhatsApp/SMTP env), Gotenberg is optional
 * (the RFQ/PO attachment falls back to HTML).
 */
let base = '';
let owner: Client;
let buyer: Client;
let store: Client;
const S: Record<string, any> = {};
const today = riyadhDate();
const myProducts: string[] = [];
const FIXTURE = readFileSync(new URL('./fixtures/zatca-supplier-invoice.xml', import.meta.url), 'utf8');

async function invite(email: string, roleKeys: string[]) {
  let users = await owner.get('/api/users');
  if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
  users = await owner.get('/api/users');
  return { c: await signInOrUp(base, email), id: users.find((u: any) => u.email === email).id as string };
}

async function status(c: Client, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3999', Cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function product(code: string) {
  const p = await owner.put('/api/products/new', { code, nameAr: `منتج ${code}`, listPrice: '100' });
  myProducts.push(p.id);
  return p;
}

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  buyer = (await invite('rfq-buyer@e2e.test', ['purchaser'])).c;
  store = (await invite('rfq-store@e2e.test', ['storekeeper'])).c;
  S.factory = await owner.post('/api/parties', { nameAr: 'مصنع الكاميرات', nameEn: 'Camera Factory Ltd', isSupplier: true, isCustomer: false, email: 'sales@camfactory.example' });
  S.local = await owner.post('/api/parties', { nameAr: 'شركة التوريدات الذكية المحدودة', isSupplier: true, isCustomer: false, vatNumber: '310122393500003', phone: '0551234567' });
  S.cam = await product('RFQ-CAM');
  S.nvr = await product('RFQ-NVR');
  S.cbl = await product('RFQ-CBL');
  // a material request (no project) with three open lines
  const sql = ADMIN_SQL();
  const [t] = await sql`select id from tenant limit 1`;
  const [mr] = await sql`insert into material_request (tenant_id, number, status) values (${t!.id}, 'MR-RFQ-T1', 'approved') returning id`;
  for (const [p, q] of [[S.cam, '10'], [S.nvr, '2'], [S.cbl, '5']] as const) {
    await sql`insert into material_request_line (tenant_id, request_id, product_id, code, description, qty) values (${t!.id}, ${mr!.id}, ${p.id}, ${p.code}, ${p.nameAr}, ${q})`;
  }
  await sql.end();
  S.mrId = mr!.id;
});

afterAll(async () => {
  try {
    if (myProducts.length) {
      const sql = ADMIN_SQL();
      await sql`update product set archived_at = now() where id in ${sql(myProducts)}`;
      await sql.end();
    }
  } finally {
    await stopServer();
  }
});

describe('RFQ → quotations → comparison → award', () => {
  it('creates an RFQ from the open MR lines and sends it to both suppliers (e-mail + WhatsApp sandbox)', async () => {
    await buyer.post('/api/inventory/rfqs', { materialRequestId: S.mrId, supplierIds: [] }, { expect: 400 });
    await buyer.post('/api/inventory/rfqs', { supplierIds: [S.factory.id] }, { expect: 400 });
    const r = await buyer.post('/api/inventory/rfqs', { materialRequestId: S.mrId, supplierIds: [S.factory.id, S.local.id], dueDate: today });
    expect(r.number).toMatch(/^RFQ-\d{4}$/);
    expect(r.status).toBe('draft');
    expect(r.lines.map((l: any) => [l.code, l.qty])).toEqual([['RFQ-CAM', '10'], ['RFQ-CBL', '5'], ['RFQ-NVR', '2']]);
    expect(r.materialRequest.number).toBe('MR-RFQ-T1');
    S.rfq = r;
    const html = await buyer.get(`/api/inventory/rfqs/${r.id}/pdf?format=html&supplierId=${S.factory.id}`, { raw: true });
    expect(html.toString()).toContain('Request for Quotation');
    expect(html.toString()).not.toContain('<script');

    const sent = await buyer.post(`/api/inventory/rfqs/${r.id}/send`, {});
    expect(sent.rfq.status).toBe('sent');
    const byId = Object.fromEntries(sent.deliveries.map((d: any) => [d.supplierId, d]));
    expect(byId[S.factory.id]).toMatchObject({ channel: 'email', to: 'sales@camfactory.example', status: 'sandboxed' });
    expect(['pdf', 'html']).toContain(byId[S.factory.id].attachment);
    expect(byId[S.local.id]).toMatchObject({ channel: 'whatsapp', to: '+966551234567', status: 'sandboxed' });
    const sql = ADMIN_SQL();
    const msgs = await sql`select channel, template_key, body from message where related_type = 'rfq' and related_id = ${r.id}`;
    await sql.end();
    expect(msgs.map((m) => `${m.channel}:${m.template_key}`).sort()).toEqual(['email:rfq_request', 'whatsapp:rfq_request']);
    expect(msgs.find((m) => m.channel === 'whatsapp')!.body).toContain(r.number);
    const list = await buyer.get('/api/inventory/rfqs?status=sent');
    expect(list.rows.some((x: any) => x.id === r.id && x.supplierCount === 2)).toBe(true);
  });

  it('records quotations in USD (+20% landed) and SAR (one line missing); only cost users see prices', async () => {
    const id = S.rfq.id;
    await buyer.post(`/api/inventory/rfqs/${id}/quotes`, { supplierId: S.factory.id, currency: 'USD', lines: [{ code: 'NOPE', unitPrice: '1' }] }, { expect: 400 });
    const a = await buyer.post(`/api/inventory/rfqs/${id}/quotes`, {
      supplierId: S.factory.id, currency: 'USD', incoterm: 'FOB', leadTimeDays: 30, validUntil: today, landedPercent: '20',
      lines: [{ code: 'RFQ-CAM', unitPrice: '50' }, { code: 'RFQ-NVR', unitPrice: '300' }, { code: 'RFQ-CBL', unitPrice: '2' }],
    });
    expect(a.rateToSar).toBe('3.750000');
    const b = await buyer.post(`/api/inventory/rfqs/${id}/quotes`, {
      supplierId: S.local.id, currency: 'SAR', leadTimeDays: 7, landedPercent: '0',
      lines: [{ code: 'RFQ-CAM', unitPrice: '240' }, { code: 'RFQ-NVR', unitPrice: '1300' }, { code: 'RFQ-CBL', unitPrice: null, note: 'غير متوفر' }],
    });
    // upsert: the same supplier again replaces its quotation
    const b2 = await buyer.post(`/api/inventory/rfqs/${id}/quotes`, {
      supplierId: S.local.id, currency: 'SAR', leadTimeDays: 7, landedPercent: '0',
      lines: [{ code: 'RFQ-CAM', unitPrice: '240' }, { code: 'RFQ-NVR', unitPrice: '1300' }, { code: 'RFQ-CBL', unitPrice: null, note: 'غير متوفر' }],
    });
    expect(b2.id).toBe(b.id);
    S.quoteA = a; S.quoteB = b;
    // the storekeeper (purchase.read, no purchase.cost.read) sees the quotes without prices and no comparison
    const seen = await store.get(`/api/inventory/rfqs/${id}`);
    expect(seen.canSeePrices).toBe(false);
    expect(seen.quotes.flatMap((q: any) => q.lines.map((l: any) => l.unitPrice)).every((x: any) => x === null)).toBe(true);
    expect((await status(store, 'GET', `/api/inventory/rfqs/${id}/comparison`)).status).toBe(403);
    const v = await buyer.get(`/api/inventory/rfqs/${id}`);
    expect(v.quotes).toHaveLength(2);
    expect(v.suppliers.every((s: any) => !!s.quoteId)).toBe(true);
  });

  it('compares on landed SAR: best per line, missing line counted, recommendation = complete + lowest landed', async () => {
    const c = await buyer.get(`/api/inventory/rfqs/${S.rfq.id}/comparison`);
    const line = (code: string) => c.lines.find((l: any) => l.code === code);
    const offer = (code: string, sid: string) => line(code).offers.find((o: any) => o.supplierId === sid);
    // CAM: 50 USD × 3.75 = 187.5 SAR → ×1.2 = 225 landed < 240 local
    expect(offer('RFQ-CAM', S.factory.id)).toMatchObject({ unitSar: '187.5000', landedUnitSar: '225.0000', landedSar: '2250.00', best: true });
    expect(offer('RFQ-CAM', S.local.id)).toMatchObject({ landedUnitSar: '240.0000', best: false });
    // NVR: 300 × 3.75 × 1.2 = 1350 > 1300 local
    expect(line('RFQ-NVR').bestSupplierId).toBe(S.local.id);
    expect(offer('RFQ-CBL', S.local.id)).toMatchObject({ quoted: false, best: false });
    expect(line('RFQ-CBL').bestSupplierId).toBe(S.factory.id);
    const tot = (sid: string) => c.totals.find((t: any) => t.supplierId === sid);
    expect(tot(S.factory.id)).toMatchObject({ landedTotalSar: '4995.00', goodsTotal: '1110.00', missingLines: 0, recommended: true, bestLines: 2 });
    expect(tot(S.local.id)).toMatchObject({ landedTotalSar: '5000.00', missingLines: 1, quotedLines: 2, recommended: false });
    expect(c.recommended).toMatchObject({ supplierId: S.factory.id, landedTotalSar: '4995.00' });
  });

  it('awards the recommended quotation → draft PO with its prices, currency and Incoterm, linked to the MR', async () => {
    const r = await buyer.post(`/api/inventory/rfqs/${S.rfq.id}/award`, { supplierQuoteId: S.quoteA.id });
    expect(r.rfq).toMatchObject({ status: 'closed', awardedQuoteId: S.quoteA.id, purchaseOrderId: r.purchaseOrder.id });
    const po = await buyer.get(`/api/inventory/purchase-orders/${r.purchaseOrder.id}`);
    expect(po).toMatchObject({ status: 'draft', supplierId: S.factory.id, currency: 'USD', rateToSar: '3.750000', incoterm: 'FOB', materialRequestId: S.mrId });
    expect(po.lines.map((l: any) => [l.code, l.qty, l.unitPrice, !!l.materialRequestLineId]).sort()).toEqual([['RFQ-CAM', '10.000', '50.0000', true], ['RFQ-CBL', '5.000', '2.0000', true], ['RFQ-NVR', '2.000', '300.0000', true]]);
    expect(po.subtotal).toBe('1110.00');
    const mr = await buyer.get(`/api/inventory/material-requests/${S.mrId}`);
    expect(mr.status).toBe('ordered');
    await buyer.post(`/api/inventory/rfqs/${S.rfq.id}/award`, { supplierQuoteId: S.quoteB.id }, { expect: 400 });
    await buyer.post(`/api/inventory/rfqs/${S.rfq.id}/cancel`, {}, { expect: 400 });
    S.poA = po;
  });

  it('cancels a manual-line RFQ', async () => {
    const r = await buyer.post('/api/inventory/rfqs', { lines: [{ productId: S.cbl.id, qty: '100' }, { code: 'FREE-1', description: 'بند حر', qty: 1 }], supplierIds: [S.local.id] });
    expect(r.lines.map((l: any) => l.code)).toEqual(['RFQ-CBL', 'FREE-1']);
    const c = await buyer.post(`/api/inventory/rfqs/${r.id}/cancel`, { reason: 'test' });
    expect(c.status).toBe('cancelled');
  });
});

describe('sending the PO to the supplier', () => {
  it('approved PO → send delivers the PDF by e-mail (sandbox) and records it in the audit', async () => {
    await buyer.post(`/api/inventory/purchase-orders/${S.poA.id}/submit`);
    await owner.post(`/api/inventory/purchase-orders/${S.poA.id}/approve`, { acknowledgeCompliance: true });
    const sent = await buyer.post(`/api/inventory/purchase-orders/${S.poA.id}/send`, {});
    expect(sent.status).toBe('sent');
    expect(sent.delivery).toMatchObject({ channel: 'email', to: 'sales@camfactory.example', status: 'sandboxed' });
    const sql = ADMIN_SQL();
    const [m] = await sql`select channel, template_key, body from message where related_type = 'purchase_order' and related_id = ${S.poA.id}`;
    const [a] = await sql`select after from audit_log where entity_type = 'purchase_order' and entity_id = ${S.poA.id} and action = 'send'`;
    await sql.end();
    expect(m).toMatchObject({ channel: 'email', template_key: 'purchase_order' });
    expect(m!.body).toContain(S.poA.number);
    expect((a!.after as any).delivery).toMatchObject({ channel: 'email', status: 'sandboxed' });
  });
});

describe('supplier ZATCA e-invoice (UBL 2.1) → bill', () => {
  it('local PO: approve, send by WhatsApp, receive', async () => {
    await buyer.post('/api/inventory/supplier-items', { supplierId: S.local.id, productId: S.nvr.id, vendorSku: 'NV-8CH-B', price: '1300', currency: 'SAR' });
    const po = await buyer.post('/api/inventory/purchase-orders', { supplierId: S.local.id, currency: 'SAR', lines: [{ productId: S.nvr.id, qty: 1, unitPrice: '1300' }, { productId: S.cam.id, qty: 4, unitPrice: '240' }] });
    expect(po).toMatchObject({ subtotal: '2260.00', vat: '339.00' });
    await buyer.post(`/api/inventory/purchase-orders/${po.id}/submit`);
    await owner.post(`/api/inventory/purchase-orders/${po.id}/approve`, { acknowledgeCompliance: true });
    const sent = await buyer.post(`/api/inventory/purchase-orders/${po.id}/send`, {});
    expect(sent.delivery).toMatchObject({ channel: 'whatsapp', to: '+966551234567', status: 'sandboxed' });
    const v = await owner.get(`/api/inventory/purchase-orders/${po.id}`);
    await owner.post(`/api/inventory/purchase-orders/${po.id}/receipts`, { receivedOn: today, lines: v.lines.map((l: any) => ({ orderLineId: l.id, qty: l.qty })) });
    S.poB = v;
  });

  it('parses the invoice: supplier by VAT, the PO, lines by vendor SKU and code, totals; then books the bill with the XML as its file', async () => {
    const p = await buyer.post('/api/inventory/bills/parse-xml', { xml: FIXTURE });
    expect(p.ok).toBe(true);
    expect(p.validation.filter((i: any) => i.level === 'error')).toEqual([]);
    expect(p.invoice).toMatchObject({ number: 'SINV-2026-00417', issueDate: '2026-10-05', typeCode: '388', currency: 'SAR', vat: '339.00', taxExclusive: '2260.00', taxInclusive: '2599.00', payable: '2599.00', hasQr: true });
    expect(p.invoice.qrFields['2']).toBe('310122393500003');
    expect(p.supplier.id).toBe(S.local.id);
    expect(p.orderId).toBe(S.poB.id);
    const lineOf = (code: string) => S.poB.lines.find((l: any) => l.code === code).id;
    expect(p.lines.map((l: any) => [l.invoiceLineId, l.orderLineId, l.matchedBy, l.qty, l.unitPrice])).toEqual([
      ['1', lineOf('RFQ-CAM'), 'code', '4', '240'],
      ['2', lineOf('RFQ-NVR'), 'vendor_sku', '1', '1300'],
    ]);
    expect(p.bill).toMatchObject({ supplierId: S.local.id, orderId: S.poB.id, supplierInvoiceNo: 'SINV-2026-00417', billDate: '2026-10-05', currency: 'SAR', vat: '339.00', sourceXmlFileId: p.fileId });
    // the same file parsed again by id
    const again = await buyer.post('/api/inventory/bills/parse-xml', { fileId: p.fileId });
    expect(again.fileId).toBe(p.fileId);
    const bill = await buyer.post('/api/inventory/bills', p.bill);
    expect(bill).toMatchObject({ matchStatus: 'matched', status: 'approved', fileId: p.fileId, subtotal: '2260.00', vat: '339.00', total: '2599.00' });
    const dup = await buyer.post('/api/inventory/bills/parse-xml', { fileId: p.fileId });
    expect(dup.ok).toBe(false);
    expect(dup.validation.map((i: any) => i.code)).toContain('duplicate');
  });

  it('a tampered invoice (VAT sum changed) is flagged as an error', async () => {
    const bad = FIXTURE.replace(/339\.00/g, '349.00').replace(/2599\.00/g, '2609.00').replace('SINV-2026-00417', 'SINV-2026-00418');
    const p = await buyer.post('/api/inventory/bills/parse-xml', { xml: bad });
    expect(p.ok).toBe(false);
    const codes = p.validation.filter((i: any) => i.level === 'error').map((i: any) => i.code);
    expect(codes).toContain('vat_total');
    expect(p.validation.map((i: any) => i.code)).toContain('qr_vat_amount');
  });

  it('identity and format checks: unknown supplier VAT, malformed VAT', async () => {
    const other = FIXTURE.replaceAll('310122393500003', '399999999900003').replace('SINV-2026-00417', 'X-1');
    const p = await buyer.post('/api/inventory/bills/parse-xml', { xml: other });
    expect(p.supplier).toBeNull();
    expect(p.validation.map((i: any) => i.code)).toContain('supplier_unknown');
    const badVat = FIXTURE.replaceAll('310122393500003', '12345');
    const q = await buyer.post('/api/inventory/bills/parse-xml', { xml: badVat });
    expect(q.validation.find((i: any) => i.code === 'supplier_vat_format')?.level).toBe('error');
  });

  it('refuses XXE / DTD payloads and non-invoice XML without expanding anything', async () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>&xxe;</cbc:ID></Invoice>`;
    const r = await status(buyer, 'POST', '/api/inventory/bills/parse-xml', { xml: xxe });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/DOCTYPE|ENTITY/);
    expect(JSON.stringify(r.body)).not.toContain('root:');
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><Invoice>&lol2;</Invoice>`;
    expect((await status(buyer, 'POST', '/api/inventory/bills/parse-xml', { xml: bomb })).status).toBe(400);
    expect((await status(buyer, 'POST', '/api/inventory/bills/parse-xml', { xml: '<Invoice><a></Invoice>' })).status).toBe(400);
    expect((await status(buyer, 'POST', '/api/inventory/bills/parse-xml', { xml: '<CreditNote xmlns="urn:x"/>' })).status).toBe(400);
    expect((await status(store, 'POST', '/api/inventory/bills/parse-xml', { xml: FIXTURE })).status).toBe(403);
  });
});
