import { describe, expect, it } from 'vitest';
import { BackOfficeError, ErpNextBackOffice, FakeBackOffice } from '../src/index.js';

/**
 * Phase 5 (procurement & stock) mappings. There is no live ERPNext to test against, so these pin the
 * exact Frappe REST requests each port method sends (doctype, body, submit), with a mocked fetch.
 */
type Call = { method: string; url: string; body?: Record<string, unknown> };

function erp(handlers: { get?: (url: string) => unknown } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method: String(init.method), url: decodeURIComponent(url), body });
    const respond = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
    if (init.method === 'GET') {
      const custom = handlers.get?.(decodeURIComponent(url));
      return respond(custom ?? []);
    }
    if (init.method === 'POST') return respond({ name: `DOC-${++n}` });
    if (init.method === 'PUT') return respond({ name: decodeURIComponent(url).split('/').pop() });
    throw new Error(`unexpected ${init.method} ${url}`);
  }) as unknown as typeof fetch;
  const bo = new ErpNextBackOffice({
    url: 'https://erp.example/', apiKey: 'k', apiSecret: 's', company: 'MMC', fetchImpl,
    phase5: { purchaseTaxTemplate: 'KSA Purchase VAT 15%', landedCostAccounts: { duty: 'Customs Duty - MMC', freight: 'Freight - MMC' } },
  });
  return { bo, calls, posts: () => calls.filter((c) => c.method === 'POST'), puts: () => calls.filter((c) => c.method === 'PUT') };
}

describe('ErpNextBackOffice — Phase 5 request bodies', () => {
  it('upsertSupplier: Supplier + KSA billing Address, keyed by mmc_core_id', async () => {
    const { bo, posts } = erp();
    const r = await bo.upsertSupplier({
      idempotencyKey: 'sup:1', coreId: 'party-1', name: 'موزع محلي', unifiedNumber: '7001234567', crNumber: '4030000000', vatNumber: '300000000000003', currency: 'SAR', paymentTermsDays: 30,
      address: { buildingNumber: '1234', street: 'طريق الملك', district: 'الروضة', city: 'جدة', postalCode: '23435', additionalNumber: '5678' },
    });
    expect(r.erpName).toBe('DOC-1');
    const [sup, addr] = posts();
    expect(sup!.url).toBe('https://erp.example/api/resource/Supplier');
    expect(sup!.body).toEqual({
      supplier_name: 'موزع محلي', supplier_type: 'Company', supplier_group: 'All Supplier Groups', default_currency: 'SAR', tax_id: '300000000000003',
      mmc_unified_number: '7001234567', mmc_cr_number: '4030000000', mmc_payment_terms_days: 30, mmc_core_id: 'party-1',
    });
    expect(addr!.url).toBe('https://erp.example/api/resource/Address');
    expect(addr!.body).toEqual({
      address_title: 'موزع محلي', address_type: 'Billing', address_line1: '1234 طريق الملك', address_line2: 'الروضة', city: 'جدة', pincode: '23435', country: 'Saudi Arabia', is_primary_address: 1,
      custom_building_number: '1234', custom_additional_number: '5678', links: [{ link_doctype: 'Supplier', link_name: 'DOC-1' }], mmc_core_id: 'party-1:billing',
    });
  });

  it('upsertSupplier updates the existing record found by mmc_core_id', async () => {
    const { bo, calls, posts } = erp({ get: (u) => (u.includes('/Supplier?') ? [{ name: 'SUP-0007' }] : []) });
    const r = await bo.upsertSupplier({ idempotencyKey: 'sup:1', coreId: 'party-1', name: 'Factory', currency: 'USD' });
    expect(r.erpName).toBe('SUP-0007');
    expect(posts()).toHaveLength(0);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('https://erp.example/api/resource/Supplier/SUP-0007');
    expect(put.body).toEqual({ supplier_name: 'Factory', supplier_type: 'Company', supplier_group: 'All Supplier Groups', default_currency: 'USD' });
  });

  it('upsertWarehouse: transit kind → Warehouse Type "Transit"', async () => {
    const { bo, posts } = erp();
    await bo.upsertWarehouse({ idempotencyKey: 'wh:1', coreId: 'wh-1', code: 'TRANSIT', name: 'In transit', kind: 'transit' });
    expect(posts()[0]!.url).toBe('https://erp.example/api/resource/Warehouse');
    expect(posts()[0]!.body).toEqual({ warehouse_name: 'TRANSIT In transit', company: 'MMC', is_group: 0, warehouse_type: 'Transit', mmc_core_id: 'wh-1' });
  });

  it('createPurchaseOrder: insert + submit, line ids in mmc_core_line, VAT template only with VAT', async () => {
    const { bo, posts, puts } = erp();
    const r = await bo.createPurchaseOrder({
      idempotencyKey: 'po:1', coreId: 'po-1', number: 'PO-00001', supplierErpName: 'SUP-1', orderDate: '2026-10-01', scheduleDate: '2026-11-15', currency: 'USD', conversionRate: '3.75', incoterm: 'FOB',
      project: 'PRJ-1', warehouseErpName: 'MAIN - MMC', vatAmount: '0.00', lines: [{ coreLineId: 'l1', itemCode: 'INV-PANEL', description: 'Panel', qty: '3', rate: '2000' }],
    });
    expect(r).toEqual({ erpName: 'DOC-1', docNumber: 'DOC-1' });
    expect(posts()[0]!.url).toBe('https://erp.example/api/resource/Purchase Order');
    expect(posts()[0]!.body).toEqual({
      supplier: 'SUP-1', transaction_date: '2026-10-01', schedule_date: '2026-11-15', currency: 'USD', conversion_rate: 3.75, incoterm: 'FOB', project: 'PRJ-1', set_warehouse: 'MAIN - MMC',
      mmc_core_number: 'PO-00001', company: 'MMC', mmc_idempotency_key: 'po:1',
      items: [{ item_code: 'INV-PANEL', description: 'Panel', qty: 3, rate: 2000, schedule_date: '2026-11-15', warehouse: 'MAIN - MMC', project: 'PRJ-1', mmc_core_line: 'l1' }],
    });
    expect(puts()).toEqual([{ method: 'PUT', url: 'https://erp.example/api/resource/Purchase Order/DOC-1', body: { docstatus: 1 } }]);
  });

  it('createPurchaseOrder is idempotent: an existing submitted doc with the key is returned untouched; a draft is submitted', async () => {
    const done = erp({ get: (u) => (u.includes('mmc_idempotency_key') ? [{ name: 'PUR-ORD-9', docstatus: 1 }] : []) });
    const base = { idempotencyKey: 'po:1', coreId: 'po-1', number: 'PO-1', supplierErpName: 'S', orderDate: '2026-10-01', scheduleDate: '2026-10-01', currency: 'SAR', conversionRate: '1', lines: [] };
    expect(await done.bo.createPurchaseOrder(base)).toEqual({ erpName: 'PUR-ORD-9', docNumber: 'PUR-ORD-9' });
    expect(done.posts()).toHaveLength(0);
    expect(done.puts()).toHaveLength(0);
    const draft = erp({ get: (u) => (u.includes('mmc_idempotency_key') ? [{ name: 'PUR-ORD-9', docstatus: 0 }] : []) });
    await draft.bo.createPurchaseOrder({ ...base, vatAmount: '30.00' });
    expect(draft.posts()).toHaveLength(0);
    expect(draft.puts()[0]!.body).toEqual({ docstatus: 1 });
  });

  it('createPurchaseReceipt: PO currency, purchase_order_item via mmc_core_line, serials as text', async () => {
    const { bo, posts } = erp({ get: (u) => (u.endsWith('/Purchase Order/PUR-ORD-1') ? { name: 'PUR-ORD-1', items: [{ name: 'poi-a', mmc_core_line: 'l1' }] } : undefined) });
    await bo.createPurchaseReceipt({
      idempotencyKey: 'gr:1', coreId: 'gr-1', number: 'GRN-00001', supplierErpName: 'SUP-1', postingDate: '2026-11-20', warehouseErpName: 'MAIN - MMC', purchaseOrderErpName: 'PUR-ORD-1',
      currency: 'USD', conversionRate: '3.75', lines: [{ coreLineId: 'grl1', poLineCoreId: 'l1', itemCode: 'INV-PANEL', qty: '2', rate: '2000', rateSar: '7500', serials: ['SN1', 'SN2'] }],
    });
    expect(posts()[0]!.url).toBe('https://erp.example/api/resource/Purchase Receipt');
    expect(posts()[0]!.body).toEqual({
      supplier: 'SUP-1', posting_date: '2026-11-20', set_posting_time: 1, currency: 'USD', conversion_rate: 3.75, set_warehouse: 'MAIN - MMC', mmc_core_number: 'GRN-00001', company: 'MMC', mmc_idempotency_key: 'gr:1',
      items: [{ item_code: 'INV-PANEL', qty: 2, received_qty: 2, rate: 2000, warehouse: 'MAIN - MMC', purchase_order: 'PUR-ORD-1', purchase_order_item: 'poi-a', use_serial_batch_fields: 1, serial_no: 'SN1\nSN2' }],
    });
  });

  it('createPurchaseInvoice: bill_no, po_detail, single receipt link, ZATCA XML reference, VAT template', async () => {
    const { bo, posts } = erp({ get: (u) => (u.endsWith('/Purchase Order/PUR-ORD-1') ? { items: [{ name: 'poi-a', mmc_core_line: 'l1' }] } : undefined) });
    await bo.createPurchaseInvoice({
      idempotencyKey: 'bill:1', coreId: 'b1', number: 'BILL-00001', supplierErpName: 'SUP-1', billNo: 'INV-77', billDate: '2026-11-21', currency: 'SAR', conversionRate: '1', purchaseOrderErpName: 'PUR-ORD-1',
      purchaseReceiptErpNames: ['MAT-PRE-1'], vatAmount: '30.00', total: '230.00', zatcaXmlRef: 'core-file:abc', lines: [{ poLineCoreId: 'l1', itemCode: 'INV-PSU', qty: '10', rate: '20' }],
    });
    expect(posts()[0]!.url).toBe('https://erp.example/api/resource/Purchase Invoice');
    expect(posts()[0]!.body).toEqual({
      supplier: 'SUP-1', bill_no: 'INV-77', bill_date: '2026-11-21', posting_date: '2026-11-21', set_posting_time: 1, currency: 'SAR', conversion_rate: 1, update_stock: 0, taxes_and_charges: 'KSA Purchase VAT 15%',
      mmc_core_number: 'BILL-00001', mmc_supplier_zatca_xml: 'core-file:abc', company: 'MMC', mmc_idempotency_key: 'bill:1',
      items: [{ item_code: 'INV-PSU', qty: 10, rate: 20, purchase_order: 'PUR-ORD-1', po_detail: 'poi-a', purchase_receipt: 'MAT-PRE-1' }],
    });
  });

  it('createStockEntry: transfer / issue against a project / receipt with rate', async () => {
    const { bo, posts } = erp();
    await bo.createStockEntry({ idempotencyKey: 'se:1', purpose: 'Material Transfer', postingDate: '2026-11-22', core: { refType: 'stock_transfer', refId: 't1', moveIds: ['m1'] }, lines: [{ itemCode: 'INV-PSU', qty: '5', sourceWarehouse: 'MAIN - MMC', targetWarehouse: 'TRANSIT - MMC', serials: [] }] });
    await bo.createStockEntry({ idempotencyKey: 'se:2', purpose: 'Material Issue', postingDate: '2026-11-22', project: 'PRJ-1', core: { refType: 'project', refId: 'p1', moveIds: ['m2'] }, lines: [{ itemCode: 'INV-PANEL', qty: '1', sourceWarehouse: 'MAIN - MMC', serials: ['SN1'], basicRateSar: '7500' }] });
    await bo.createStockEntry({ idempotencyKey: 'se:3', purpose: 'Material Receipt', postingDate: '2026-11-22', core: { refType: 'stock_count', refId: 'c1', moveIds: ['m3'] }, lines: [{ itemCode: 'INV-PSU', qty: '1', targetWarehouse: 'MAIN - MMC', basicRateSar: '20.0000', serials: [] }] });
    const [a, b, c] = posts();
    expect(a!.url).toBe('https://erp.example/api/resource/Stock Entry');
    expect(a!.body).toEqual({ stock_entry_type: 'Material Transfer', purpose: 'Material Transfer', posting_date: '2026-11-22', set_posting_time: 1, mmc_core_ref: 'stock_transfer:t1', company: 'MMC', mmc_idempotency_key: 'se:1', items: [{ item_code: 'INV-PSU', qty: 5, s_warehouse: 'MAIN - MMC', t_warehouse: 'TRANSIT - MMC', use_serial_batch_fields: 0 }] });
    expect(b!.body).toEqual({ stock_entry_type: 'Material Issue', purpose: 'Material Issue', posting_date: '2026-11-22', set_posting_time: 1, project: 'PRJ-1', mmc_core_ref: 'project:p1', company: 'MMC', mmc_idempotency_key: 'se:2', items: [{ item_code: 'INV-PANEL', qty: 1, s_warehouse: 'MAIN - MMC', project: 'PRJ-1', use_serial_batch_fields: 1, serial_no: 'SN1' }] });
    expect(c!.body).toEqual({ stock_entry_type: 'Material Receipt', purpose: 'Material Receipt', posting_date: '2026-11-22', set_posting_time: 1, mmc_core_ref: 'stock_count:c1', company: 'MMC', mmc_idempotency_key: 'se:3', items: [{ item_code: 'INV-PSU', qty: 1, t_warehouse: 'MAIN - MMC', basic_rate: 20, use_serial_batch_fields: 0 }] });
  });

  it('createLandedCostVoucher: receipt rows read back, charges by account, basis mapped', async () => {
    const { bo, posts } = erp({ get: (u) => (u.endsWith('/Purchase Receipt/MAT-PRE-1') ? { name: 'MAT-PRE-1', items: [{ name: 'pri-1', item_code: 'INV-PANEL', item_name: 'Panel', qty: 3, base_rate: 7500, base_amount: 22500, cost_center: 'Main - MMC' }] } : undefined) });
    await bo.createLandedCostVoucher({
      idempotencyKey: 'lcv:1', coreId: 'sh1', number: 'SHP-00001', postingDate: '2026-11-25', basis: 'value', receipts: [{ receiptErpName: 'MAT-PRE-1', supplierErpName: 'SUP-1', grandTotalSar: '22500.00' }],
      charges: [{ kind: 'duty', description: 'Customs duty', amountSar: '1125.00' }, { kind: 'port', description: 'Port charges', amountSar: '300.00' }],
    });
    expect(posts()[0]!.url).toBe('https://erp.example/api/resource/Landed Cost Voucher');
    expect(posts()[0]!.body).toEqual({
      posting_date: '2026-11-25', distribute_charges_based_on: 'Amount', mmc_core_number: 'SHP-00001', company: 'MMC', mmc_idempotency_key: 'lcv:1',
      purchase_receipts: [{ receipt_document_type: 'Purchase Receipt', receipt_document: 'MAT-PRE-1', supplier: 'SUP-1', grand_total: 22500 }],
      items: [{ item_code: 'INV-PANEL', description: 'Panel', qty: 3, rate: 7500, amount: 22500, receipt_document_type: 'Purchase Receipt', receipt_document: 'MAT-PRE-1', purchase_receipt_item: 'pri-1', cost_center: 'Main - MMC' }],
      taxes: [{ description: 'Customs duty', expense_account: 'Customs Duty - MMC', amount: 1125 }, { description: 'Port charges', expense_account: 'Expenses Included In Valuation', amount: 300 }],
    });
  });
});

describe('FakeBackOffice — Phase 5', () => {
  const fake = () => new FakeBackOffice({ nextInvoiceNumber: async () => 'X', seller: async () => ({ name: 'S', vatNumber: null, vatRegistered: false }) });

  it('names documents deterministically, returns the same doc for the same key, and checks dependencies', async () => {
    const bo = fake();
    await expect(bo.createPurchaseOrder({ idempotencyKey: 'k1', coreId: 'po', number: 'PO-1', supplierErpName: 'SUP-NOPE', orderDate: '2026-10-01', scheduleDate: '2026-10-01', currency: 'SAR', conversionRate: '1', lines: [] })).rejects.toBeInstanceOf(BackOfficeError);
    const sup = await bo.upsertSupplier({ idempotencyKey: 's', coreId: '0190000000000000abcdef12', name: 'S', currency: 'SAR' });
    expect(sup.erpName).toBe('SUP-ABCDEF12');
    const wh = await bo.upsertWarehouse({ idempotencyKey: 'w', coreId: 'w1', code: 'MAIN', name: 'Main', kind: 'main' });
    await bo.upsertItem({ coreId: 'i', code: 'A', name: 'A', isStock: true, listPrice: '1' });
    const po = await bo.createPurchaseOrder({ idempotencyKey: 'k1', coreId: 'po', number: 'PO-1', supplierErpName: sup.erpName, orderDate: '2026-10-01', scheduleDate: '2026-10-01', currency: 'SAR', conversionRate: '1', lines: [{ coreLineId: 'l', itemCode: 'A', qty: '1', rate: '1' }] });
    expect(po).toEqual({ erpName: 'PO-FAKE-0001', docNumber: 'PO-FAKE-0001' });
    expect(await bo.createPurchaseOrder({ idempotencyKey: 'k1', coreId: 'po', number: 'PO-1', supplierErpName: sup.erpName, orderDate: '2026-10-01', scheduleDate: '2026-10-01', currency: 'SAR', conversionRate: '1', lines: [] })).toEqual(po);
    const po2 = await bo.createPurchaseOrder({ idempotencyKey: 'k2', coreId: 'po2', number: 'PO-2', supplierErpName: sup.erpName, orderDate: '2026-10-01', scheduleDate: '2026-10-01', currency: 'SAR', conversionRate: '1', lines: [] });
    expect(po2.erpName).toBe('PO-FAKE-0002');
    const gr = await bo.createPurchaseReceipt({ idempotencyKey: 'g', coreId: 'g', number: 'GRN-1', supplierErpName: sup.erpName, postingDate: '2026-10-02', warehouseErpName: wh.erpName, purchaseOrderErpName: po.erpName, currency: 'SAR', conversionRate: '1', lines: [{ coreLineId: 'x', itemCode: 'A', qty: '1', rate: '1', rateSar: '1', serials: [] }] });
    expect(gr.erpName).toBe('PREC-FAKE-0001');
    await expect(bo.createStockEntry({ idempotencyKey: 's1', purpose: 'Material Transfer', postingDate: '2026-10-03', core: { refType: null, refId: null, moveIds: [] }, lines: [{ itemCode: 'A', qty: '1', sourceWarehouse: wh.erpName, serials: [] }] })).rejects.toThrow(/wrong warehouses/);
    const se = await bo.createStockEntry({ idempotencyKey: 's1', purpose: 'Material Issue', postingDate: '2026-10-03', core: { refType: null, refId: null, moveIds: [] }, lines: [{ itemCode: 'A', qty: '1', sourceWarehouse: wh.erpName, serials: [] }] });
    expect(se.erpName).toBe('STE-FAKE-0001');
    expect((await bo.createLandedCostVoucher({ idempotencyKey: 'l', coreId: 'sh', number: 'SHP-1', postingDate: '2026-10-04', basis: 'value', receipts: [{ receiptErpName: gr.erpName, supplierErpName: sup.erpName }], charges: [] })).erpName).toBe('LCV-FAKE-0001');
    expect((await bo.health()).detail).toMatch(/not ZATCA/);
  });
});

describe('upsertProject', () => {
  it('ErpNext: Project keyed by mmc_core_id, named by the Core number, status mapped', async () => {
    const { bo, posts } = erp();
    const r = await bo.upsertProject({ coreId: 'prj-1', name: 'PRJ-0001', title: 'فيلا العليا', customerErpName: 'CUST-0001', status: 'active', expectedStart: '2026-10-01', expectedEnd: '2026-12-01' });
    expect(r.erpName).toBe('DOC-1');
    expect(posts()[0]!.url).toBe('https://erp.example/api/resource/Project');
    expect(posts()[0]!.body).toEqual({
      project_name: 'PRJ-0001', status: 'Open', is_active: 'Yes', company: 'MMC', customer: 'CUST-0001', expected_start_date: '2026-10-01', expected_end_date: '2026-12-01', notes: 'فيلا العليا', mmc_core_id: 'prj-1',
    });
  });

  it('ErpNext: an existing Project (found by mmc_core_id) is updated, not duplicated', async () => {
    const { bo, calls, posts } = erp({ get: (u) => (u.includes('/Project?') ? [{ name: 'PRJ-0001' }] : []) });
    const r = await bo.upsertProject({ coreId: 'prj-1', name: 'PRJ-0001', status: 'closed' });
    expect(r.erpName).toBe('PRJ-0001');
    expect(posts()).toHaveLength(0);
    const get = calls.find((c) => c.method === 'GET')!;
    expect(get.url).toContain('/api/resource/Project?filters=[["mmc_core_id","=","prj-1"]]');
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('https://erp.example/api/resource/Project/PRJ-0001');
    expect(put.body).toEqual({ project_name: 'PRJ-0001', status: 'Completed', is_active: 'No', company: 'MMC' });
  });

  it('Fake: idempotent, the ERP name is the Core number', async () => {
    const bo = new FakeBackOffice({ nextInvoiceNumber: async () => 'X', seller: async () => ({ name: 'S', vatNumber: null, vatRegistered: false }) });
    expect(await bo.upsertProject({ coreId: 'p', name: 'PRJ-0009', status: 'active' })).toEqual({ erpName: 'PRJ-0009' });
    expect(await bo.upsertProject({ coreId: 'p', name: 'PRJ-0009', status: 'cancelled' })).toEqual({ erpName: 'PRJ-0009' });
  });
});
