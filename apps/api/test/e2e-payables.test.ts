import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { riyadhDate } from '@mmc/domain';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Opening stock (preview, pasted sheet, serials, cost source, cost hiding), supplier bills entered
 * without a PO (stock + moving average + expense lines + serials + VAT), supplier payments
 * (partial, over-payment, void), the payables list filters and aging.
 */
let base = '';
let owner: Client;
let store: Client;
let buyer: Client;
let accountant: Client;
const S: Record<string, any> = {};
const today = riyadhDate();
const myProducts: string[] = [];

async function invite(email: string, roleKeys: string[]) {
  const users = await owner.get('/api/users');
  if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
  return signInOrUp(base, email);
}

async function product(code: string, extra: Record<string, unknown> = {}) {
  const p = await owner.put('/api/products/new', { code, nameAr: `منتج ${code}`, listPrice: '100', ...extra });
  myProducts.push(p.id);
  return p;
}

const qtyIn = async (productId: string, warehouseId: string) => {
  const s = await owner.get(`/api/inventory/stock/${productId}`);
  return Number(s.balances.find((w: any) => w.warehouseId === warehouseId)?.qty ?? 0);
};

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  store = await invite('pay-store@e2e.test', ['storekeeper']);
  buyer = await invite('pay-buyer@e2e.test', ['purchaser']);
  accountant = await invite('pay-acct@e2e.test', ['accountant']);
  S.wh = await owner.post('/api/inventory/warehouses', { code: `OPN-${Date.now() % 100000}`, nameAr: 'مستودع الرصيد الافتتاحي', kind: 'main' });
  S.cam = await product('PAY-CAM', { serialTracked: true, warrantyMonths: 12 });
  S.cable = await product('PAY-CABLE', { costPrice: '10', costCurrency: 'USD' });
  S.svc = await product('PAY-SVC', { type: 'service' });
  S.vatSupplier = await owner.post('/api/parties', { nameAr: 'مورد محلي مسجل', isSupplier: true, isCustomer: false, vatNumber: '311122233300003' });
  S.cashSupplier = await owner.post('/api/parties', { nameAr: 'محل أدوات', isSupplier: true, isCustomer: false });
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

describe('opening stock', () => {
  it('previews a pasted sheet with errors and warnings without writing anything', async () => {
    const sheet = ['code,qty,cost', 'pay-cable, 100, 2.5', 'PAY-CAM,2,300,SN-A SN-B', 'PAY-SVC,1,5', 'NOPE-1,3,1', 'PAY-CABLE,1,1'].join('\n');
    const r = await owner.post('/api/inventory/opening-balances', { warehouseId: S.wh.id, sheet, preview: true });
    expect(r.posted).toBeNull();
    expect(r.lines.map((l: any) => l.code)).toEqual(['PAY-CABLE', 'PAY-CAM']);
    expect(r.totalSar).toBe('850.00'); // 100 × 2.5 + 2 × 300
    expect(r.errors.map((e: any) => e.en).join('|')).toMatch(/service item holds no stock.*no product with this code.*duplicate code/);
    expect(await qtyIn(S.cable.id, S.wh.id)).toBe(0);
    // posting with errors is refused
    await owner.post('/api/inventory/opening-balances', { warehouseId: S.wh.id, sheet }, { expect: 400 });
  });

  it('checks serial counts and posts opening moves that set the average cost', async () => {
    await owner.post('/api/inventory/opening-balances', { warehouseId: S.wh.id, lines: [{ productId: S.cam.id, qty: '2', unitCostSar: '300', serials: ['SN-A'] }] }, { expect: 400 });
    const r = await owner.post('/api/inventory/opening-balances', {
      warehouseId: S.wh.id, openedOn: today, notes: 'جرد بداية التشغيل',
      lines: [{ code: 'pay-cable', qty: '100', unitCostSar: '2.5' }, { productId: S.cam.id, qty: '2', unitCostSar: '300', serials: ['sn-a', 'SN-B'] }],
    });
    expect(r.posted.number).toMatch(/^OPN-\d{4}$/);
    S.opening = r.posted;
    expect(await qtyIn(S.cable.id, S.wh.id)).toBe(100);
    expect(await qtyIn(S.cam.id, S.wh.id)).toBe(2);
    expect(Number((await owner.get(`/api/inventory/stock/${S.cable.id}`)).product.avgCostSar)).toBe(2.5);
    const moves = await owner.get(`/api/inventory/moves?productId=${S.cam.id}`);
    expect(moves.rows[0]).toMatchObject({ kind: 'opening', refType: 'stock_opening', refId: S.opening.id });
    const cam = await owner.get(`/api/inventory/stock/${S.cam.id}`);
    expect(cam.serials.map((x: any) => x.serial).sort()).toEqual(['SN-A', 'SN-B']);
    // the same serials cannot open twice
    const again = await owner.post('/api/inventory/opening-balances', { warehouseId: S.wh.id, lines: [{ productId: S.cam.id, qty: '1', unitCostSar: '1', serials: ['SN-A'] }], preview: true });
    expect(again.errors[0].en).toMatch(/already in stock/);
    const list = await owner.get('/api/inventory/opening-balances');
    expect(list.find((o: any) => o.id === S.opening.id)).toMatchObject({ lines: 2, totalSar: '850.00' });
  });

  it('lets a storekeeper post quantities without seeing or typing costs (cost from the catalogue)', async () => {
    await store.post('/api/inventory/opening-balances', { warehouseId: S.wh.id, lines: [{ productId: S.cable.id, qty: '1', unitCostSar: '9' }] }, { expect: 403 });
    const pre = await store.post('/api/inventory/opening-balances', { warehouseId: S.wh.id, lines: [{ productId: S.cable.id, qty: '10' }], preview: true });
    expect(pre.lines[0]).toMatchObject({ costSource: 'average', unitCostSar: null, valueSar: null });
    expect(pre.totalSar).toBeNull();
    expect(pre.warnings[0].en).toMatch(/already on hand/);
    await buyer.post('/api/inventory/opening-balances', { warehouseId: S.wh.id, lines: [{ productId: S.cable.id, qty: '1' }] }, { expect: 403 }); // no inventory.count
    const view = await store.get(`/api/inventory/opening-balances/${S.opening.id}`);
    expect(view.lines[0].unitCostSar).toBeNull();
  });
});

describe('supplier bills without a purchase order', () => {
  it('receives products into stock at the bill price, adds expense lines and computes VAT', async () => {
    const r = await buyer.post('/api/inventory/bills/direct', {
      supplierId: S.vatSupplier.id, supplierInvoiceNo: 'INV-7781', billDate: today, dueDate: today, currency: 'SAR', warehouseId: S.wh.id,
      lines: [
        { productId: S.cable.id, qty: '100', unitPrice: '4.5' },
        { productId: S.cam.id, qty: '1', unitPrice: '360', serials: ['SN-C'] },
        { description: 'أجور توصيل', qty: '1', unitPrice: '50' },
      ],
    });
    S.bill = r;
    expect(r).toMatchObject({ kind: 'direct', matchStatus: 'direct', status: 'approved', subtotal: '860.00', vat: '129.00', total: '989.00', owed: '989.00' });
    expect(r.number).toMatch(/^BILL-\d{5}$/);
    expect(r.moves).toHaveLength(2);
    expect(await qtyIn(S.cable.id, S.wh.id)).toBe(200);
    const st = await owner.get(`/api/inventory/stock/${S.cable.id}`);
    expect(Number(st.product.avgCostSar)).toBe(3.5); // (100 × 2.5 + 100 × 4.5) / 200 — VAT is not cost
    const cam = await owner.get(`/api/inventory/stock/${S.cam.id}`);
    expect(cam.serials.map((x: any) => x.serial).sort()).toEqual(['SN-A', 'SN-B', 'SN-C']);
  });

  it('refuses duplicates, wrong serial counts, VAT that does not match and storekeepers', async () => {
    const base = { supplierId: S.vatSupplier.id, supplierInvoiceNo: 'INV-7781', billDate: today, warehouseId: S.wh.id, lines: [{ productId: S.cable.id, qty: '1', unitPrice: '1' }] };
    await buyer.post('/api/inventory/bills/direct', base, { expect: 409 });
    await buyer.post('/api/inventory/bills/direct', { ...base, supplierInvoiceNo: 'X-2', lines: [{ productId: S.cam.id, qty: '2', unitPrice: '1', serials: ['ZZ-1'] }] }, { expect: 400 });
    await buyer.post('/api/inventory/bills/direct', { ...base, supplierInvoiceNo: 'X-3', vat: '5' }, { expect: 400 });
    await buyer.post('/api/inventory/bills/direct', { ...base, supplierInvoiceNo: 'X-4', currency: 'CNY' }, { expect: 400 }); // no rate
    await store.post('/api/inventory/bills/direct', { ...base, supplierInvoiceNo: 'X-5' }, { expect: 403 });
    await buyer.post('/api/inventory/bills/direct', { ...base, supplierInvoiceNo: 'X-6', lines: [{ qty: '1', unitPrice: '1' }] }, { expect: 400 }); // no product, no description
  });

  it('records a cash purchase paid at once, with no VAT from an unregistered shop and no stock', async () => {
    const r = await buyer.post('/api/inventory/bills/direct', {
      supplierId: S.cashSupplier.id, supplierInvoiceNo: 'C-19', billDate: today, receive: false, paidNow: { method: 'cash' },
      lines: [{ description: 'مفكات وعدد', qty: '2', unitPrice: '35' }],
    });
    expect(r).toMatchObject({ status: 'paid', vat: '0.00', total: '70.00', paidAmount: '70.00', owed: '0.00', warehouse: null, moves: [] });
    expect(r.payments[0]).toMatchObject({ method: 'cash', amount: '70.00' });
  });
});

describe('payments to suppliers and payables', () => {
  it('records partial payments, refuses over-payment and voids a mistaken payment', async () => {
    await buyer.post(`/api/inventory/bills/${S.bill.id}/payments`, { amount: '2000' }, { expect: 400 });
    await store.post(`/api/inventory/bills/${S.bill.id}/payments`, { amount: '1' }, { expect: 403 });
    const p1 = await accountant.post(`/api/inventory/bills/${S.bill.id}/payments`, { amount: '500', method: 'bank_transfer', reference: 'TRX-1' });
    expect(p1).toMatchObject({ status: 'partially_paid', paidAmount: '500.00', owed: '489.00' });
    const p2 = await accountant.post(`/api/inventory/bills/${S.bill.id}/payments`, { amount: '489' });
    expect(p2).toMatchObject({ status: 'paid', owed: '0.00' });
    const v = await accountant.post(`/api/inventory/bills/${S.bill.id}/payments/${p2.payments[1].id}/void`, { reason: 'مبلغ خاطئ' });
    expect(v).toMatchObject({ status: 'partially_paid', paidAmount: '500.00' });
    expect(v.payments).toHaveLength(1);
  });

  it('lists, filters and ages what is owed; hides amounts without the cost permission', async () => {
    const unpaid = await owner.get(`/api/inventory/bills?unpaid=true&supplierId=${S.vatSupplier.id}`);
    expect(unpaid.rows.map((r: any) => r.number)).toContain(S.bill.number);
    const direct = await owner.get('/api/inventory/bills?kind=direct&q=C-19');
    expect(direct.rows).toHaveLength(1);
    const aging = await accountant.get('/api/inventory/bills/aging');
    const sup = aging.suppliers.find((s: any) => s.supplierId === S.vatSupplier.id);
    expect(sup).toMatchObject({ current: '489.00', total: '489.00', bills: 1 });
    await store.get('/api/inventory/bills/aging', { expect: 403 });
    const hidden = await store.get(`/api/inventory/bills/${S.bill.id}`);
    expect(hidden).toMatchObject({ total: null, owed: null });
    expect(hidden.lines[0].unitPrice).toBeNull();
  });

  it('keeps the bill and its payments in the audit log', async () => {
    const sql = ADMIN_SQL();
    const rows = await sql`select action from audit_log where entity_type = 'supplier_bill' and entity_id = ${S.bill.id} order by id`;
    await sql.end();
    expect(rows.map((r) => r.action)).toEqual(['create', 'supplier_payment', 'supplier_payment', 'supplier_payment_void']);
  });
});

describe('product photos', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  it('uploads a photo that customers can load without a session, and removes it', async () => {
    await owner.post(`/api/products/${S.cable.id}/image`, { name: 'x.png', contentType: 'image/jpeg', data: PNG }, { expect: 400 }); // content ≠ declared type
    await store.post(`/api/products/${S.cable.id}/image`, { name: 'x.png', contentType: 'image/png', data: PNG }, { expect: 403 });
    const p = await owner.post(`/api/products/${S.cable.id}/image`, { name: 'cable.png', contentType: 'image/png', data: PNG });
    expect(p.imageUrl).toMatch(/^\/api\/public\/product-images\/[0-9a-f-]{36}$/);
    const res = await fetch(base + p.imageUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    // a staff upload that is not a product image is not public
    const other = await owner.post('/api/files', { name: 'doc.png', contentType: 'image/png', data: PNG });
    expect((await fetch(`${base}/api/public/product-images/${other.id}`)).status).toBe(404);
    await owner.req('DELETE', `/api/products/${S.cable.id}/image`);
    expect((await fetch(base + p.imageUrl)).status).toBe(404);
  });

  it('keeps exchange rates with 6 decimals editable', async () => {
    const p = await owner.get(`/api/products/${S.cable.id}`);
    const saved = await owner.put(`/api/products/${S.cable.id}`, { code: p.code, nameAr: p.nameAr, listPrice: '100', costPrice: '10', costCurrency: 'CNY', costRateToSar: '0.523456' });
    expect(saved.costRateToSar).toBe('0.523456');
  });
});

