import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { quotePrefix, riyadhDate } from '@mmc/domain';
import { ADMIN_SQL, Client, signInOrUp, startServer, stopServer } from './helpers.js';

/**
 * Phase 5 → ERPNext readiness (fake back office) and the finance / project-profitability insights.
 * Creates a supplier, a SAR purchase order with an import-style shipment (landed cost), a receipt,
 * a supplier bill, a transfer through transit, an issue + return against a project, an open project
 * PO, a paid advance and two labour hours; then pushes everything with /api/erp-sync/run (twice:
 * the second run is a no-op) and checks the insights numbers against the created data.
 *
 * Own database when run alone: E2E_DB=mmc_e2e_erp. Order-independent in the full suite (deltas only,
 * gives back the daily quote number it used, archives its products).
 */
let base = '';
let owner: Client;
let buyer: Client;
let store: Client;
const S: Record<string, any> = {};
const today = riyadhDate();
const myProducts: string[] = [];
const myQuotes: string[] = [];
const tag = Date.now().toString(36).slice(-5).toUpperCase();

async function invite(email: string, roleKeys: string[]) {
  let users = await owner.get('/api/users');
  if (!users.some((u: any) => u.email === email)) await owner.post('/api/users/invite', { email, nameAr: email.split('@')[0], roleKeys });
  users = await owner.get('/api/users');
  return { c: await signInOrUp(base, email), id: users.find((u: any) => u.email === email).id as string };
}

const h = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);

beforeAll(async () => {
  base = await startServer();
  owner = await signInOrUp(base, 'owner@e2e.test');
  buyer = (await invite('erp-buyer@e2e.test', ['purchaser'])).c;
  store = (await invite('erp-store@e2e.test', ['storekeeper'])).c;
  S.ownerId = (await owner.get('/api/users')).find((u: any) => u.email === 'owner@e2e.test').id;
  S.financeBefore = await owner.get('/api/insights/finance');

  S.supplier = await owner.post('/api/parties', { nameAr: `مورد المزامنة ${tag}`, isSupplier: true, isCustomer: false, vatNumber: `3${String(Date.now()).slice(-13)}3`, sites: [{ type: 'billing', name: 'المقر', buildingNumber: '1234', street: 'طريق الملك', district: 'الروضة', city: 'جدة', postalCode: '23435' }] });
  const cust = await owner.post('/api/parties', { nameAr: `عميل المزامنة ${tag}`, sites: [{ type: 'project', name: 'فيلا المزامنة', city: 'جدة' }] });
  S.customer = await owner.get(`/api/parties/${cust.id}`);
  for (const code of ['A', 'B']) {
    const p = await owner.put('/api/products/new', { code: `ERP-${tag}-${code}`, nameAr: `منتج ${code}`, listPrice: '200' });
    myProducts.push(p.id);
    S[`p${code}`] = p;
  }
  S.main = (await owner.get('/api/inventory/warehouses')).find((w: any) => w.code === 'MAIN');
  S.w2 = await owner.post('/api/inventory/warehouses', { code: `ERP-${tag}`, nameAr: 'مستودع فرعي', kind: 'main' });
});

afterAll(async () => {
  try {
    const sql = ADMIN_SQL();
    if (myProducts.length) await sql`update product set archived_at = now() where id in ${sql(myProducts)}`;
    if (myQuotes.length) {
      const prefix = quotePrefix();
      await sql`update quote set number = 'ES-' || number where id in ${sql(myQuotes)} and number like ${`${prefix}%`}`;
      await sql`update numbering_counter nc set last_value = coalesce((select max(substring(q.number from ${prefix.length + 1}::int)::int) from quote q where q.number like ${`${prefix}%`}), 0)
        from numbering_series s where s.id = nc.series_id and s.document_type = 'quote' and nc.period_key = ${today}`;
    }
    await sql.end();
  } finally {
    await stopServer();
  }
});

describe('operational records to push', () => {
  it('PO (SAR, approved by another user) → shipment charges → receipt → landed cost → supplier bill', async () => {
    const po = await buyer.post('/api/inventory/purchase-orders', { supplierId: S.supplier.id, currency: 'SAR', lines: [{ productId: S.pA.id, qty: 10, unitPrice: '50' }] });
    await buyer.post(`/api/inventory/purchase-orders/${po.id}/submit`);
    expect((await owner.post(`/api/inventory/purchase-orders/${po.id}/approve`, { acknowledgeCompliance: true, note: 'e2e' })).status).toBe('approved');
    const sh = await buyer.post('/api/inventory/shipments', { supplierId: S.supplier.id, orderIds: [po.id], mode: 'land' });
    await buyer.put(`/api/inventory/shipments/${sh.id}/charges`, { charges: [{ kind: 'clearance', amountSar: '100', note: 'نقل' }] });
    const line = (await owner.get(`/api/inventory/purchase-orders/${po.id}`)).lines[0];
    S.gr = await owner.post(`/api/inventory/purchase-orders/${po.id}/receipts`, { shipmentId: sh.id, receivedOn: today, lines: [{ orderLineId: line.id, qty: 10 }] });
    const lc = await buyer.post(`/api/inventory/shipments/${sh.id}/landed-cost`, { basis: 'value' });
    expect(lc.chargeSar).toBe('100.00');
    expect((await owner.get(`/api/inventory/stock/${S.pA.id}`)).product.avgCostSar).toBe('60.0000');
    const bill = await buyer.post('/api/inventory/bills', { supplierId: S.supplier.id, orderId: po.id, supplierInvoiceNo: `SUP-${tag}`, billDate: today, currency: 'SAR', lines: [{ orderLineId: line.id, qty: 10, unitPrice: '50' }], vat: '75' });
    expect(bill.status).toBe('approved');
    Object.assign(S, { po, sh, bill });
  });

  it('transfer MAIN → branch store through transit', async () => {
    const t = await owner.post('/api/inventory/transfers', { fromWarehouseId: S.main.id, toWarehouseId: S.w2.id, lines: [{ productId: S.pA.id, qty: 3 }] });
    await owner.post(`/api/inventory/transfers/${t.id}/ship`);
    await owner.post(`/api/inventory/transfers/${t.id}/receive`);
    S.transfer = t;
  });

  it('signed contract → project; issue 2, return 1; an open project PO; two labour hours; the 50% advance paid', async () => {
    const q = await owner.post('/api/quotes', { partyId: S.customer.id, siteId: S.customer.sites[0].id, clientName: S.customer.nameAr, projectName: 'فيلا المزامنة', discountType: 'amount', discountValue: '0', vatOn: true, lines: [{ code: S.pA.code, description: 'جهاز', unitPrice: '200', qty: '4' }, { code: 'SVC', description: 'تركيب', unitPrice: '1000', qty: '1' }] });
    myQuotes.push(q.id);
    await owner.post(`/api/quotes/${q.id}/submit`);
    const c = await owner.post(`/api/contracts/from-quote/${q.id}`);
    await owner.post(`/api/contracts/${c.id}/status`, { status: 'signed' });
    S.contract = await owner.get(`/api/contracts/${c.id}`);
    S.project = (await owner.get(`/api/projects?q=${encodeURIComponent(c.number)}`)).rows[0];
    expect(S.project).toBeTruthy();

    const iss = await owner.post('/api/inventory/issue', { fromWarehouseId: S.main.id, projectId: S.project.id, lines: [{ productId: S.pA.id, qty: 2 }] });
    expect(iss.moves[0].unitCostSar).toBe('60.0000');
    await owner.post('/api/inventory/returns', { projectId: S.project.id, toWarehouseId: S.main.id, lines: [{ productId: S.pA.id, qty: 1 }] });

    const po2 = await buyer.post('/api/inventory/purchase-orders', { supplierId: S.supplier.id, currency: 'SAR', projectId: S.project.id, lines: [{ productId: S.pB.id, qty: 4, unitPrice: '25' }] });
    await buyer.post(`/api/inventory/purchase-orders/${po2.id}/submit`);
    await owner.post(`/api/inventory/purchase-orders/${po2.id}/approve`, { acknowledgeCompliance: true, note: 'e2e' });
    S.po2 = po2;

    const sql = ADMIN_SQL();
    const [wo] = await sql`insert into work_order (tenant_id, number, type, title, project_id, status) select tenant_id, ${`WO-ES-${tag}`}, 'installation', 'تركيب', id, 'completed' from project where id = ${S.project.id} returning id, tenant_id`;
    await sql`insert into time_entry (tenant_id, work_order_id, user_id, kind, started_at, ended_at, hours) values (${wo!.tenant_id}, ${wo!.id}, ${S.ownerId}, 'work', now() - interval '2 hours', now(), '2')`;
    await sql.end();

    const bill = await owner.get(`/api/finance/contracts/${c.id}`);
    const m1 = bill.milestones[0];
    const pr = await owner.post(`/api/finance/milestones/${m1.id}/request`, {});
    await owner.post(`/api/finance/payment-requests/${pr.id}/payments`, { amount: pr.amount, paidOn: today, method: 'bank_transfer', reference: `ES-${tag}` });
    S.paid = pr.amount;
    S.invoices = (await owner.get(`/api/finance/contracts/${c.id}`)).invoices;
    expect(S.invoices.some((i: any) => i.typeCode === '386')).toBe(true);
  });
});

describe('ERP sync (fake back office)', () => {
  it('only admins see the status; pending counts include the new records', async () => {
    await store.get('/api/erp-sync/status', { expect: 403 });
    await store.post('/api/erp-sync/run', {}, { expect: 403 });
    const st = await owner.get('/api/erp-sync/status');
    expect(st.backOffice).toBe('fake');
    expect(st.scheduled).toBe(false);
    expect(st.pending.purchase_order).toBeGreaterThanOrEqual(2);
    expect(st.pending.goods_receipt).toBeGreaterThanOrEqual(1);
    expect(st.pending.supplier_bill).toBeGreaterThanOrEqual(1);
    expect(st.pending.stock_entry).toBeGreaterThanOrEqual(4); // ship, receive, issue, return
    expect(st.pending.landed_cost).toBeGreaterThanOrEqual(1);
    expect(st.pending.supplier).toBeGreaterThanOrEqual(1);
  });

  it('pushes everything in dependency order and writes the ERP names back', async () => {
    const r = await owner.post('/api/erp-sync/run', { limit: 500 });
    expect(r.errors).toEqual([]);
    expect(r.backOffice).toBe('fake');
    expect(r.pushed.purchase_order).toBeGreaterThanOrEqual(2);
    expect(r.pushed.landed_cost).toBeGreaterThanOrEqual(1);

    const sql = ADMIN_SQL();
    const [po] = await sql`select erp_name from purchase_order where id = ${S.po.id}`;
    const [po2] = await sql`select erp_name from purchase_order where id = ${S.po2.id}`;
    const [gr] = await sql`select erp_name from goods_receipt where id = ${S.gr.id}`;
    const [bill] = await sql`select erp_name from supplier_bill where id = ${S.bill.id}`;
    const [w2] = await sql`select erp_name from warehouse where id = ${S.w2.id}`;
    const [prod] = await sql`select erp_name from product where id = ${S.pA.id}`;
    const [sup] = await sql`select erp_name from erp_link where entity_type = 'party' and erp_doctype = 'Supplier' and entity_id = ${S.supplier.id}`;
    const [lcv] = await sql`select erp_name from erp_link where entity_type = 'import_shipment' and erp_doctype = 'Landed Cost Voucher' and entity_id = ${S.sh.id}`;
    const transferMoves = await sql`select m.id, l.erp_name, l.sync_status from stock_move m left join erp_link l on l.entity_type = 'stock_move' and l.entity_id = m.id where m.ref_type = 'stock_transfer' and m.ref_id = ${S.transfer.id}`;
    const projectMoves = await sql`select m.kind, l.erp_name from stock_move m join erp_link l on l.entity_type = 'stock_move' and l.entity_id = m.id where m.project_id = ${S.project.id}`;
    const [customer] = await sql`select erp_name from party where id = ${S.supplier.id}`;
    await sql.end();

    expect(po!.erp_name).toMatch(/^PO-FAKE-\d{4}$/);
    expect(po2!.erp_name).toMatch(/^PO-FAKE-\d{4}$/);
    expect(gr!.erp_name).toMatch(/^PREC-FAKE-\d{4}$/);
    expect(bill!.erp_name).toMatch(/^PINV-FAKE-\d{4}$/);
    expect(w2!.erp_name).toBe(`ERP-${tag} - FAKE`);
    expect(prod!.erp_name).toBe(S.pA.code);
    expect(sup!.erp_name).toMatch(/^SUP-/);
    expect(customer!.erp_name).toBeNull(); // party.erp_name stays the ERPNext *Customer* link
    expect(lcv!.erp_name).toMatch(/^LCV-FAKE-\d{4}$/);
    // ship + receive of one transfer on one day → one Material Transfer
    expect(transferMoves).toHaveLength(2);
    expect(new Set(transferMoves.map((m: any) => m.erp_name)).size).toBe(1);
    expect(transferMoves[0]!.erp_name).toMatch(/^STE-FAKE-\d{4}$/);
    expect(transferMoves.every((m: any) => m.sync_status === 'synced')).toBe(true);
    // issue (Material Issue) and return (Material Receipt) are separate entries
    const byKind = Object.fromEntries(projectMoves.map((m: any) => [m.kind, m.erp_name]));
    expect(byKind.issue_project).toMatch(/^STE-FAKE-/);
    expect(byKind.return).toMatch(/^STE-FAKE-/);
    expect(byKind.issue_project).not.toBe(byKind.return);
  });

  it('a second run is a no-op and nothing is pending any more', async () => {
    const r = await owner.post('/api/erp-sync/run', {});
    expect(r.errors).toEqual([]);
    expect(Object.values(r.pushed).every((n) => n === 0)).toBe(true);
    const st = await owner.get('/api/erp-sync/status');
    expect(st.pendingTotal).toBe(0);
    expect(Object.values(st.pending).every((n) => n === 0)).toBe(true);
    expect(st.lastRun.status).toBe('ok');
    expect(st.errors).toEqual([]);
  });
});

describe('insights', () => {
  it('finance: collections, commitments, AP and stock value move by exactly what this file created', async () => {
    await store.get('/api/insights/finance', { expect: 403 });
    const before = S.financeBefore;
    const after = await owner.get('/api/insights/finance');
    expect(after.source.en).toBe('From MMC Core data — the books live in ERPNext');
    expect(after.costVisible).toBe(true);
    const month = today.slice(0, 7);
    const m = (x: any) => x.months.find((r: any) => r.month === month);
    expect(h(m(after).collected) - h(m(before).collected)).toBe(h(S.paid));
    const adv = S.invoices.filter((i: any) => i.typeCode === '386').reduce((s: number, i: any) => s + h(i.taxable), 0);
    expect(h(m(after).invoicedNet) - h(m(before).invoicedNet)).toBe(adv);
    expect(h(after.ap.open) - h(before.ap.open)).toBe(h('575.00'));
    expect(h(after.commitments.open) - h(before.commitments.open)).toBe(h('100.00'));
    // A: 10 received, 1 net to the project → 9 on hand at the 60.00 average
    expect(h(after.stock.value) - h(before.stock.value)).toBe(h('540.00'));
    expect(after.ar.buckets).toHaveProperty('90_plus');
    expect(after.dso.days === null || typeof after.dso.days === 'number').toBe(true);
    expect(after.paymentRequests).toHaveProperty('open');
  });

  it('project profitability: contract value, invoiced, collected, material, committed, labour and margin', async () => {
    const p = await owner.get(`/api/insights/projects/${S.project.id}`);
    const value = h(S.contract.total) - h(S.contract.vatAmount);
    expect(h(p.contractValue)).toBe(value);
    expect(h(p.invoiced)).toBe(S.invoices.filter((i: any) => i.typeCode === '386').reduce((s: number, i: any) => s + h(i.taxable), 0));
    expect(h(p.collected)).toBe(h(S.paid));
    expect(p.materialCost).toBe('60.00'); // (2 − 1) × 60
    expect(p.committedCost).toBe('100.00');
    expect(p.labourHours).toBe('2.00');
    expect(p.labourCost).toBe('240.00');
    expect(p.costAtCompletion).toBe('400.00');
    expect(h(p.margin)).toBe(value - 40000);
    expect(p.marginPct).toBeCloseTo(((value - 40000) / value) * 100, 1);
    expect(p.flags.includes('low_margin')).toBe(p.marginPct < 20);
    expect(p.materials).toEqual([expect.objectContaining({ code: S.pA.code, issuedQty: '2.000', returnedQty: '1.000', netQty: '1', cost: '60.00' })]);
    expect(p.committedLines.map((l: any) => [l.number, l.openQty, l.valueSar])).toEqual([[S.po2.number, '4.000', '100.00']]);

    const list = await owner.get('/api/insights/projects?status=all');
    const row = list.rows.find((r: any) => r.id === S.project.id);
    expect(row).toMatchObject({ contractValue: p.contractValue, margin: p.margin, costVisible: true });
    expect(list.assumptions.labourRateSar).toBe('120.00');

    // without purchase.cost.read: no cost fields
    const seen = await store.get(`/api/insights/projects/${S.project.id}`);
    expect(seen.costVisible).toBe(false);
    expect(seen.contractValue).toBe(p.contractValue);
    expect(seen).not.toHaveProperty('materialCost');
    expect(seen).not.toHaveProperty('margin');
    expect(seen).not.toHaveProperty('materials');
  });
});
