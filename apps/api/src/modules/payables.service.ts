import { randomUUID } from 'node:crypto';
import {
  and, desc, emit, eq, ilike, inArray, isNull, nextNumber, or, party, product, project, purchaseOrder, serialNumber, sql, stockBalance, stockMove, stockOpening, supplierBill, warehouse, purchaseOrderLine,
  type SQL, type SupplierBillLine, type SupplierPayment, type Tx,
} from '@mmc/db';
import { addMonths, billPaymentStatus, dec, directBillTotals, halalasToFixed, parseOpeningSheet, payableBucket, riyadhDate, toHalalas } from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { NON_STOCK_TYPES, canCost, ensureMainWarehouse, fq, fx4, isUuid, loadWarehouse, postMove, reserve } from './inventory.service.js';
import { VAT_RATE, defaultRate, loadSupplier } from './purchasing.service.js';
import { tryPost } from './gl-posting.service.js';

/**
 * Local purchases entered straight from the supplier's invoice (no purchase order), payments to
 * suppliers, the payables list/aging and opening stock. Stock always moves through `postMove`.
 */

export type BillRow = typeof supplierBill.$inferSelect;

// ───────────────────────── direct supplier bills ─────────────────────────

export interface DirectBillInput {
  supplierId: string; supplierInvoiceNo: string; billDate: string; dueDate?: string | null; currency: string; rateToSar?: string;
  /** receive the product lines into this warehouse (null = main store); `receive: false` = expense-only bill */
  receive: boolean; warehouseId?: string | null; projectId?: string | null; notes?: string | null; fileId?: string | null;
  lines: { productId?: string | null; code?: string | null; description?: string | null; qty: string; unitPrice: string; vatPercent?: string | null; serials?: string[] }[];
  /** the VAT printed on the supplier's invoice when it differs by rounding from the computed one */
  vat?: string | null;
  /** cash purchase: record the full payment at once */
  paidNow?: { method: string; reference?: string | null } | null;
}

/**
 * Supplier bill without a purchase order (cash / local purchases). Posted at once: product lines are
 * received into stock at the bill's unit price × rate (VAT excluded — input VAT is recoverable), which
 * updates the moving-average cost; free-text lines (freight, services) are expense only.
 */
export async function createDirectBill(tx: Tx, actor: RequestActor, b: DirectBillInput) {
  if (b.receive && !actor.grants['inventory.write'] && !actor.grants['purchase.approve']) throw forbidden('receiving goods needs inventory.write or purchase.approve');
  const supplier = await loadSupplier(tx, b.supplierId);
  const [dup] = await tx.select({ id: supplierBill.id, number: supplierBill.number }).from(supplierBill).where(and(eq(supplierBill.supplierId, b.supplierId), eq(supplierBill.supplierInvoiceNo, b.supplierInvoiceNo)));
  if (dup) throw conflict(`supplier invoice ${b.supplierInvoiceNo} is already recorded as ${dup.number}`);
  const rate = b.rateToSar ?? defaultRate(b.currency);
  if (!rate || !(Number(rate) > 0)) throw badRequest(`enter the SAR exchange rate for ${b.currency}`);
  if (b.dueDate && b.dueDate < b.billDate) throw badRequest('the due date is before the invoice date');
  if (b.projectId) {
    if (!isUuid(b.projectId)) throw notFound('project');
    const [p] = await tx.select({ id: project.id }).from(project).where(eq(project.id, b.projectId));
    if (!p) throw notFound('project');
  }
  const wh = b.receive ? (b.warehouseId ? await loadWarehouse(tx, b.warehouseId) : await ensureMainWarehouse(tx, actor.userId)) : null;
  if (wh && (wh.archivedAt || wh.kind === 'transit')) throw badRequest('receive into a store, van, site or quarantine warehouse');

  const defVat = b.currency === 'SAR' && supplier.vatNumber ? String(VAT_RATE) : '0';
  const lines: SupplierBillLine[] = [];
  const products = new Map<string, typeof product.$inferSelect>();
  for (const [i, l] of b.lines.entries()) {
    const n = i + 1;
    const serials = [...new Set((l.serials ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if ((l.serials ?? []).filter((s) => s.trim()).length !== serials.length) throw badRequest(`line ${n}: a serial number appears twice`);
    if (l.productId) {
      if (!isUuid(l.productId)) throw notFound('product');
      const [p] = await tx.select().from(product).where(eq(product.id, l.productId));
      if (!p) throw badRequest(`line ${n}: product not found`);
      products.set(p.id, p);
      const stock = !NON_STOCK_TYPES.includes(p.type);
      if (b.receive && stock && p.serialTracked) {
        const q = dec(l.qty);
        if (!q.isInteger()) throw badRequest(`line ${n} (${p.code}) is serial-tracked: whole units only`);
        if (serials.length !== q.toNumber()) throw badRequest(`line ${n} (${p.code}) is serial-tracked: ${q.toString()} serial number(s) needed, ${serials.length} given`, { line: n, needed: q.toNumber(), given: serials.length });
      } else if (serials.length && !p.serialTracked) {
        throw badRequest(`line ${n} (${p.code}): the product is not serial-tracked — mark it serial-tracked first or send no serials`);
      }
      lines.push({ productId: p.id, code: p.code, description: l.description ?? p.nameAr, qty: l.qty, unitPrice: l.unitPrice, vatPercent: l.vatPercent ?? defVat, ...(serials.length ? { serials } : {}) });
    } else {
      if (!l.code?.trim() && !l.description?.trim()) throw badRequest(`line ${n}: choose a product or describe the expense`);
      if (serials.length) throw badRequest(`line ${n}: serial numbers need a product`);
      lines.push({ productId: null, code: l.code?.trim() || '', description: l.description?.trim() || null, qty: l.qty, unitPrice: l.unitPrice, vatPercent: l.vatPercent ?? defVat });
    }
  }
  const t = directBillTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, vatPercent: l.vatPercent })));
  let vat = t.vat;
  if (b.vat !== undefined && b.vat !== null && b.vat !== '') {
    vat = toHalalas(b.vat);
    // the printed VAT may differ from ours by rounding only (1 halala per line)
    if (Math.abs(vat - t.vat) > Math.max(1, lines.length)) throw badRequest(`the VAT ${halalasToFixed(vat)} does not match the lines (${halalasToFixed(t.vat)})`);
  }
  const total = t.subtotal + vat;
  if (total <= 0) throw badRequest('the bill total must be above zero');

  const { number } = await nextNumber(tx, 'supplier_bill');
  const payments: SupplierPayment[] = b.paidNow ? [{ id: randomUUID(), paidOn: b.billDate, amount: halalasToFixed(total), method: b.paidNow.method, reference: b.paidNow.reference ?? null, by: actor.userId, at: new Date().toISOString() }] : [];
  const [row] = await tx.insert(supplierBill).values({
    number, supplierId: supplier.id, orderId: null, kind: 'direct', supplierInvoiceNo: b.supplierInvoiceNo, billDate: b.billDate, dueDate: b.dueDate ?? null, currency: b.currency, rateToSar: rate,
    subtotal: halalasToFixed(t.subtotal), vat: halalasToFixed(vat), total: halalasToFixed(total), lines, matchStatus: 'direct', matchIssues: [],
    warehouseId: wh?.id ?? null, projectId: b.projectId ?? null, notes: b.notes ?? null, fileId: b.fileId ?? null,
    paidAmount: b.paidNow ? halalasToFixed(total) : '0', payments, status: b.paidNow ? 'paid' : 'approved', createdBy: actor.userId, updatedBy: actor.userId,
  }).returning();

  let received = 0;
  if (wh) {
    for (const l of lines) {
      const p = l.productId ? products.get(l.productId) : null;
      if (!p || NON_STOCK_TYPES.includes(p.type)) continue;
      const qty = dec(l.qty);
      const unitCostSar = fx4(dec(l.unitPrice).times(rate));
      await postMove(tx, actor, {
        kind: 'receipt', productId: p.id, toWarehouseId: wh.id, qty, unitCostSar, serials: l.serials ?? [], projectId: b.projectId ?? null,
        refType: 'supplier_bill', refId: row!.id, note: `${number} / ${b.supplierInvoiceNo}`,
        serialMeta: { supplierId: supplier.id, supplierWarrantyEnd: p.warrantyMonths ? addMonths(b.billDate, p.warrantyMonths) : null },
      });
      if (b.projectId) await reserve(tx, actor.userId, { projectId: b.projectId, productId: p.id, warehouseId: wh.id, qty });
      received++;
    }
  }
  await audit(tx, actor, 'create', 'supplier_bill', row!.id, null, { number, kind: 'direct', supplierInvoiceNo: b.supplierInvoiceNo, total: row!.total, received, warehouse: wh?.code ?? null, paidNow: !!b.paidNow });
  await emit(tx, 'supplier_bill', row!.id, 'supplier_bill.posted', { number, kind: 'direct', received });
  await tryPost(tx, 'bill', row!.id);
  if (b.paidNow) await tryPost(tx, 'bill_payment', row!.id);
  return billView(tx, actor, row!.id);
}

// ───────────────────────── payments to suppliers ─────────────────────────

export const PAYMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'card', 'other'] as const;

function assertCanPay(actor: RequestActor) {
  if (!actor.grants['payment.record'] && !actor.grants['purchase.approve']) throw forbidden('recording supplier payments needs payment.record or purchase.approve');
}

async function loadBill(tx: Tx, id: string): Promise<BillRow> {
  if (!isUuid(id)) throw notFound('supplier bill');
  const [bill] = await tx.select().from(supplierBill).where(eq(supplierBill.id, id));
  if (!bill) throw notFound('supplier bill');
  return bill;
}

/** Record a payment against an approved bill (in the bill currency, never above what is still owed). */
export async function addSupplierPayment(tx: Tx, actor: RequestActor, id: string, p: { paidOn: string; amount: string; method: string; reference?: string | null; note?: string | null }) {
  assertCanPay(actor);
  const bill = await loadBill(tx, id);
  if (!['approved', 'partially_paid'].includes(bill.status)) throw badRequest(bill.status === 'draft' ? `bill ${bill.number} is waiting for approval of its match exception` : `bill ${bill.number} is ${bill.status}`);
  const amount = toHalalas(p.amount);
  if (amount <= 0) throw badRequest('the amount must be above zero');
  const owed = toHalalas(bill.total) - toHalalas(bill.paidAmount);
  if (amount > owed) throw badRequest(`only ${halalasToFixed(owed)} ${bill.currency} is still owed on ${bill.number}`, { owed: halalasToFixed(owed) });
  if (p.paidOn > riyadhDate()) throw badRequest('the payment date is in the future');
  const pay: SupplierPayment = { id: randomUUID(), paidOn: p.paidOn, amount: halalasToFixed(amount), method: p.method, reference: p.reference ?? null, note: p.note ?? null, by: actor.userId, at: new Date().toISOString() };
  const paid = toHalalas(bill.paidAmount) + amount;
  const status = billPaymentStatus(toHalalas(bill.total), paid);
  await tx.update(supplierBill).set({ payments: [...bill.payments, pay], paidAmount: halalasToFixed(paid), status, updatedAt: new Date(), updatedBy: actor.userId, version: bill.version + 1 }).where(eq(supplierBill.id, bill.id));
  await audit(tx, actor, 'supplier_payment', 'supplier_bill', bill.id, { paidAmount: bill.paidAmount, status: bill.status }, { paidAmount: halalasToFixed(paid), status, payment: pay });
  await emit(tx, 'supplier_bill', bill.id, 'supplier_bill.paid', { number: bill.number, amount: pay.amount, status });
  await tryPost(tx, 'bill', bill.id); // a bill approved before its first payment is posted first
  await tryPost(tx, 'bill_payment', bill.id);
  return billView(tx, actor, bill.id);
}

/** Remove a payment entered by mistake (kept in the audit log). */
export async function voidSupplierPayment(tx: Tx, actor: RequestActor, id: string, paymentId: string, reason: string) {
  assertCanPay(actor);
  const bill = await loadBill(tx, id);
  const pay = bill.payments.find((x) => x.id === paymentId);
  if (!pay) throw notFound('payment');
  const rest = bill.payments.filter((x) => x.id !== paymentId);
  const paid = rest.reduce((s, x) => s + toHalalas(x.amount), 0);
  const status = billPaymentStatus(toHalalas(bill.total), paid);
  await tx.update(supplierBill).set({ payments: rest, paidAmount: halalasToFixed(paid), status, updatedAt: new Date(), updatedBy: actor.userId, version: bill.version + 1 }).where(eq(supplierBill.id, bill.id));
  await audit(tx, actor, 'supplier_payment_void', 'supplier_bill', bill.id, { payment: pay, status: bill.status }, { status, reason });
  await tryPost(tx, 'bill_payment', bill.id); // reverses the entry of the removed payment
  return billView(tx, actor, bill.id);
}

/**
 * Cancel a bill that has not been paid (reason required, audited) so the ledger can reverse it.
 * A PO bill gives its billed quantities back to the order; a bill that received goods into stock
 * cannot be cancelled here — return the goods or correct the stock first.
 */
export async function cancelBill(tx: Tx, actor: RequestActor, id: string, reason: string) {
  if (!actor.grants['purchase.approve'] && !actor.grants['payment.record']) throw forbidden('cancelling a supplier bill needs purchase.approve');
  const bill = await loadBill(tx, id);
  if (bill.status === 'cancelled') throw conflict(`bill ${bill.number} is already cancelled`);
  if (toHalalas(bill.paidAmount) > 0 || bill.payments.length) throw badRequest(`bill ${bill.number} has payments — void them first`);
  const moves = await tx.select({ id: stockMove.id }).from(stockMove).where(and(eq(stockMove.refType, 'supplier_bill'), eq(stockMove.refId, bill.id))).limit(1);
  if (moves.length) throw badRequest(`bill ${bill.number} received goods into stock — return or correct the stock first`);
  if (bill.status === 'approved' && bill.kind === 'po') {
    for (const l of bill.lines) {
      if (!l.orderLineId) continue;
      const [line] = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.id, l.orderLineId));
      if (line) await tx.update(purchaseOrderLine).set({ billedQty: fq(dec(line.billedQty).minus(l.qty).lt(0) ? dec(0) : dec(line.billedQty).minus(l.qty)), updatedAt: new Date(), updatedBy: actor.userId }).where(eq(purchaseOrderLine.id, line.id));
    }
  }
  await tx.update(supplierBill).set({ status: 'cancelled', updatedAt: new Date(), updatedBy: actor.userId, version: bill.version + 1 }).where(eq(supplierBill.id, bill.id));
  await audit(tx, actor, 'cancel', 'supplier_bill', bill.id, { status: bill.status }, { status: 'cancelled' }, reason);
  await emit(tx, 'supplier_bill', bill.id, 'supplier_bill.cancelled', { number: bill.number });
  await tryPost(tx, 'bill', bill.id); // reverses the posted entry, once
  return billView(tx, actor, bill.id);
}

// ───────────────────────── bill list, detail, aging ─────────────────────────

const OPEN_BILL = ['approved', 'partially_paid'];

export interface BillQuery { q?: string; limit: number; offset: number; orderId?: string; supplierId?: string; matchStatus?: string; status?: string; kind?: string; unpaid?: boolean; overdue?: boolean; from?: string; to?: string }

function billWhere(q: BillQuery, today: string): SQL | undefined {
  const c: (SQL | undefined)[] = [
    q.orderId ? eq(supplierBill.orderId, q.orderId) : undefined,
    q.supplierId ? eq(supplierBill.supplierId, q.supplierId) : undefined,
    q.matchStatus ? eq(supplierBill.matchStatus, q.matchStatus) : undefined,
    q.status ? inArray(supplierBill.status, q.status.split(',').filter(Boolean)) : undefined,
    q.kind ? eq(supplierBill.kind, q.kind) : undefined,
    q.unpaid || q.overdue ? inArray(supplierBill.status, OPEN_BILL) : undefined,
    q.overdue ? sql`coalesce(${supplierBill.dueDate}, ${supplierBill.billDate}) < ${today}::date` : undefined,
    q.from ? sql`${supplierBill.billDate} >= ${q.from}::date` : undefined,
    q.to ? sql`${supplierBill.billDate} <= ${q.to}::date` : undefined,
    q.q ? or(ilike(supplierBill.number, `%${q.q}%`), ilike(supplierBill.supplierInvoiceNo, `%${q.q}%`), ilike(party.nameAr, `%${q.q}%`), ilike(party.nameEn, `%${q.q}%`)) : undefined,
  ];
  const f = c.filter((x): x is SQL => !!x);
  return f.length ? and(...f) : undefined;
}

/** SAR value still owed on a bill (halalas). */
function owedSar(b: Pick<BillRow, 'total' | 'paidAmount' | 'rateToSar'>): number {
  return dec(toHalalas(b.total) - toHalalas(b.paidAmount)).times(b.rateToSar).toDecimalPlaces(0).toNumber();
}

function hideCost<T extends BillRow>(actor: RequestActor, b: T) {
  if (canCost(actor)) return b;
  return { ...b, subtotal: null, vat: null, total: null, paidAmount: null, payments: b.payments.map((p) => ({ ...p, amount: null })), lines: b.lines.map((l) => ({ ...l, unitPrice: null })) };
}

export async function listBills(tx: Tx, actor: RequestActor, q: BillQuery) {
  const today = riyadhDate();
  const where = billWhere(q, today);
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(supplierBill).innerJoin(party, eq(party.id, supplierBill.supplierId)).where(where)) as [{ n: number }];
  const rows = await tx.select({ b: supplierBill, supplierName: party.nameAr, supplierNameEn: party.nameEn, orderNumber: purchaseOrder.number }).from(supplierBill)
    .innerJoin(party, eq(party.id, supplierBill.supplierId)).leftJoin(purchaseOrder, eq(purchaseOrder.id, supplierBill.orderId))
    .where(where).orderBy(desc(supplierBill.billDate), desc(supplierBill.number)).limit(q.limit).offset(q.offset);
  const cost = canCost(actor);
  return {
    rows: rows.map((r) => ({
      ...hideCost(actor, r.b), supplierName: r.supplierName, supplierNameEn: r.supplierNameEn, orderNumber: r.orderNumber,
      owedSar: cost && OPEN_BILL.includes(r.b.status) ? halalasToFixed(owedSar(r.b)) : cost ? '0.00' : null,
      overdue: OPEN_BILL.includes(r.b.status) && (r.b.dueDate ?? r.b.billDate) < today,
    })),
    total: n,
  };
}

/** Accounts payable: what is owed per supplier in SAR, by days past due. */
export async function payablesAging(tx: Tx, actor: RequestActor) {
  if (!canCost(actor)) throw forbidden('the payables summary needs purchase.cost.read');
  const today = riyadhDate();
  const rows = await tx.select({ b: supplierBill, supplierName: party.nameAr, supplierNameEn: party.nameEn }).from(supplierBill)
    .innerJoin(party, eq(party.id, supplierBill.supplierId)).where(inArray(supplierBill.status, OPEN_BILL));
  const empty = () => ({ current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, total: 0, bills: 0 });
  const bySupplier = new Map<string, { supplierId: string; supplierName: string; supplierNameEn: string | null } & ReturnType<typeof empty>>();
  const totals = empty();
  let dueThisWeek = 0;
  const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  for (const r of rows) {
    const owed = owedSar(r.b);
    if (owed <= 0) continue;
    const k = payableBucket(r.b.dueDate, r.b.billDate, today);
    const s = bySupplier.get(r.b.supplierId) ?? { supplierId: r.b.supplierId, supplierName: r.supplierName, supplierNameEn: r.supplierNameEn, ...empty() };
    s[k] += owed; s.total += owed; s.bills++;
    totals[k] += owed; totals.total += owed; totals.bills++;
    const due = r.b.dueDate ?? r.b.billDate;
    if (due >= today && due <= week) dueThisWeek += owed;
    bySupplier.set(r.b.supplierId, s);
  }
  const fmt = <T extends ReturnType<typeof empty>>(x: T) => ({ ...x, current: halalasToFixed(x.current), '1_30': halalasToFixed(x['1_30']), '31_60': halalasToFixed(x['31_60']), '61_90': halalasToFixed(x['61_90']), '90_plus': halalasToFixed(x['90_plus']), total: halalasToFixed(x.total) });
  return {
    asOf: today,
    totals: { ...fmt(totals), overdue: halalasToFixed(totals.total - totals.current), dueThisWeek: halalasToFixed(dueThisWeek) },
    suppliers: [...bySupplier.values()].sort((a, b) => b.total - a.total).map(fmt),
  };
}

export async function billView(tx: Tx, actor: RequestActor, id: string) {
  const bill = await loadBill(tx, id);
  const [sup] = await tx.select({ id: party.id, nameAr: party.nameAr, nameEn: party.nameEn, vatNumber: party.vatNumber, phone: party.phone }).from(party).where(eq(party.id, bill.supplierId));
  const [po] = bill.orderId ? await tx.select({ id: purchaseOrder.id, number: purchaseOrder.number }).from(purchaseOrder).where(eq(purchaseOrder.id, bill.orderId)) : [];
  const [wh] = bill.warehouseId ? await tx.select({ id: warehouse.id, code: warehouse.code, nameAr: warehouse.nameAr, nameEn: warehouse.nameEn }).from(warehouse).where(eq(warehouse.id, bill.warehouseId)) : [];
  const [prj] = bill.projectId ? await tx.select({ id: project.id, number: project.number, name: project.name }).from(project).where(eq(project.id, bill.projectId)) : [];
  const moves = await tx.select({ id: stockMove.id, productId: stockMove.productId, qty: stockMove.qty, unitCostSar: stockMove.unitCostSar, serials: stockMove.serials, postedAt: stockMove.postedAt, code: product.code })
    .from(stockMove).innerJoin(product, eq(product.id, stockMove.productId)).where(and(eq(stockMove.refType, 'supplier_bill'), eq(stockMove.refId, bill.id)));
  const cost = canCost(actor);
  const today = riyadhDate();
  return {
    ...hideCost(actor, bill),
    supplier: sup ?? null, order: po ?? null, warehouse: wh ?? null, project: prj ?? null,
    owed: cost ? halalasToFixed(Math.max(0, toHalalas(bill.total) - toHalalas(bill.paidAmount))) : null,
    owedSar: cost ? halalasToFixed(Math.max(0, OPEN_BILL.includes(bill.status) ? owedSar(bill) : 0)) : null,
    overdue: OPEN_BILL.includes(bill.status) && (bill.dueDate ?? bill.billDate) < today,
    moves: moves.map((m) => ({ ...m, unitCostSar: cost ? m.unitCostSar : null })),
  };
}

// ───────────────────────── opening stock ─────────────────────────

export interface OpeningInput {
  warehouseId?: string | null; openedOn: string; notes?: string | null;
  lines?: { productId?: string | null; code?: string | null; qty: string; unitCostSar?: string | null; serials?: string[] }[];
  /** pasted sheet: "code, qty, unit cost [, serials…]" — used when `lines` is empty */
  sheet?: string | null;
  preview?: boolean;
}

interface OpeningPlanLine { line: number; productId: string; code: string; name: string; qty: string; unitCostSar: string; costSource: 'entered' | 'average' | 'catalog' | 'none'; serials: string[]; serialTracked: boolean; onHand: string; valueSar: string }

/**
 * Opening stock (رصيد افتتاحي): validate every line first (unknown codes, service items, serial counts,
 * serials already in stock), return a preview, and on confirm post one `opening` move per line, which
 * sets the moving-average cost. Without purchase.cost.read the unit cost comes from the average or the
 * catalogue purchase price and cannot be typed.
 */
export async function openingStock(tx: Tx, actor: RequestActor, b: OpeningInput) {
  const cost = canCost(actor);
  const wh = b.warehouseId ? await loadWarehouse(tx, b.warehouseId) : await ensureMainWarehouse(tx, actor.userId);
  if (wh.archivedAt || wh.kind === 'transit') throw badRequest('opening stock goes into a store, van, site or quarantine warehouse');
  if (b.openedOn > riyadhDate()) throw badRequest('the opening date is in the future');

  const errors: { line: number; ar: string; en: string }[] = [];
  let input: { line: number; productId?: string | null; code?: string | null; qty: string; unitCostSar?: string | null; serials: string[] }[];
  if (b.lines?.length) {
    input = b.lines.map((l, i) => ({ line: i + 1, productId: l.productId, code: l.code, qty: l.qty, unitCostSar: l.unitCostSar, serials: l.serials ?? [] }));
  } else if (b.sheet?.trim()) {
    const parsed = parseOpeningSheet(b.sheet);
    errors.push(...parsed.errors);
    input = parsed.rows.map((r) => ({ line: r.line, code: r.code, qty: r.qty, unitCostSar: r.unitCost, serials: r.serials }));
  } else throw badRequest('add at least one line');
  if (input.length > 2000) throw badRequest('at most 2,000 lines per opening document');
  if (!cost && input.some((l) => l.unitCostSar && Number(l.unitCostSar) > 0)) throw forbidden('typing unit costs needs purchase.cost.read');

  // resolve products by id or code in one go
  const ids = input.map((l) => l.productId).filter((x): x is string => !!x && isUuid(x));
  const codes = input.filter((l) => !l.productId && l.code).map((l) => l.code!.trim().toUpperCase());
  const found = ids.length || codes.length
    ? await tx.select().from(product).where(and(isNull(product.archivedAt), or(ids.length ? inArray(product.id, ids) : sql`false`, codes.length ? inArray(sql`upper(${product.code})`, codes) : sql`false`)))
    : [];
  const byId = new Map(found.map((p) => [p.id, p]));
  const byCode = new Map(found.map((p) => [p.code.toUpperCase(), p]));
  const balances = found.length ? await tx.select({ productId: stockBalance.productId, qty: stockBalance.qty }).from(stockBalance).where(and(eq(stockBalance.warehouseId, wh.id), inArray(stockBalance.productId, found.map((p) => p.id)))) : [];
  const onHand = new Map(balances.map((x) => [x.productId, x.qty]));

  const plan: OpeningPlanLine[] = [];
  const warnings: { line: number; ar: string; en: string }[] = [];
  const seenProduct = new Set<string>();
  const seenSerial = new Set<string>();
  for (const l of input) {
    const p = l.productId ? byId.get(l.productId) : byCode.get((l.code ?? '').trim().toUpperCase());
    const label = l.code?.trim() || p?.code || `#${l.line}`;
    if (!p) { errors.push({ line: l.line, ar: `${label}: لا يوجد منتج بهذا الكود — أضفه في المنتجات أولًا`, en: `${label}: no product with this code — add it under Products first` }); continue; }
    if (NON_STOCK_TYPES.includes(p.type)) { errors.push({ line: l.line, ar: `${p.code}: صنف خدمة/باقة لا يُخزَّن`, en: `${p.code}: a ${p.type} item holds no stock` }); continue; }
    if (seenProduct.has(p.id)) { errors.push({ line: l.line, ar: `${p.code}: مكرر في القائمة`, en: `${p.code}: listed twice` }); continue; }
    seenProduct.add(p.id);
    const qty = dec(l.qty);
    if (!(qty.gt(0))) { errors.push({ line: l.line, ar: `${p.code}: الكمية يجب أن تكون أكبر من صفر`, en: `${p.code}: quantity must be above zero` }); continue; }
    const serials = [...new Set(l.serials.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (p.serialTracked) {
      if (!qty.isInteger()) { errors.push({ line: l.line, ar: `${p.code}: صنف بأرقام تسلسلية — أعداد صحيحة فقط`, en: `${p.code}: serial-tracked — whole units only` }); continue; }
      if (serials.length !== qty.toNumber()) { errors.push({ line: l.line, ar: `${p.code}: مطلوب ${qty.toString()} رقم تسلسلي، أُدخل ${serials.length}`, en: `${p.code}: ${qty.toString()} serial number(s) needed, ${serials.length} given` }); continue; }
    } else if (serials.length) {
      errors.push({ line: l.line, ar: `${p.code}: المنتج لا يُتتبع بالرقم التسلسلي`, en: `${p.code}: the product is not serial-tracked` }); continue;
    }
    for (const s of serials) {
      const k = `${p.id}|${s}`;
      if (seenSerial.has(k)) errors.push({ line: l.line, ar: `${p.code}: الرقم التسلسلي ${s} مكرر`, en: `${p.code}: serial ${s} appears twice` });
      seenSerial.add(k);
    }
    let unitCostSar: string; let costSource: OpeningPlanLine['costSource'];
    if (l.unitCostSar && Number(l.unitCostSar) > 0) { unitCostSar = dec(l.unitCostSar).toFixed(4); costSource = 'entered'; }
    else if (p.avgCostSar && Number(p.avgCostSar) > 0) { unitCostSar = dec(p.avgCostSar).toFixed(4); costSource = 'average'; }
    else if (p.costPrice && Number(p.costPrice) > 0) { unitCostSar = dec(p.costPrice).times(p.costCurrency === 'SAR' ? 1 : p.costRateToSar).toFixed(4); costSource = 'catalog'; }
    else { unitCostSar = '0.0000'; costSource = 'none'; warnings.push({ line: l.line, ar: `${p.code}: بدون تكلفة — ستكون قيمته صفرًا`, en: `${p.code}: no cost — it will be valued at zero` }); }
    const have = onHand.get(p.id);
    if (have && Number(have) !== 0) warnings.push({ line: l.line, ar: `${p.code}: يوجد رصيد ${dec(have).toString()} في المستودع — ستُضاف الكمية إليه`, en: `${p.code}: ${dec(have).toString()} already on hand — the quantity is added to it` });
    plan.push({
      line: l.line, productId: p.id, code: p.code, name: p.nameAr, qty: fq(qty), unitCostSar, costSource, serials, serialTracked: p.serialTracked,
      onHand: have ?? '0', valueSar: halalasToFixed(qty.times(unitCostSar).times(100).toDecimalPlaces(0).toNumber()),
    });
  }
  // serials already in stock anywhere
  for (const pl of plan) {
    if (!pl.serials.length) continue;
    const dup = await tx.select({ serial: serialNumber.serial }).from(serialNumber).where(and(eq(serialNumber.productId, pl.productId), inArray(serialNumber.serial, pl.serials), inArray(serialNumber.status, ['in_stock', 'reserved', 'in_transit'])));
    if (dup.length) errors.push({ line: pl.line, ar: `${pl.code}: أرقام مسجلة بالمخزون مسبقًا: ${dup.map((d) => d.serial).join(', ')}`, en: `${pl.code}: already in stock: ${dup.map((d) => d.serial).join(', ')}` });
  }
  const totalSar = plan.reduce((s, l) => s + toHalalas(l.valueSar), 0);
  const view = (l: OpeningPlanLine) => (cost ? l : { ...l, unitCostSar: null, valueSar: null });
  const summary = {
    warehouse: { id: wh.id, code: wh.code, nameAr: wh.nameAr, nameEn: wh.nameEn }, lines: plan.map(view), errors: errors.sort((a, b) => a.line - b.line), warnings,
    totalQtyLines: plan.length, totalSar: cost ? halalasToFixed(totalSar) : null,
  };
  if (b.preview) return { ...summary, posted: null };
  if (errors.length) throw badRequest('the opening stock has errors — fix them and try again', { errors: summary.errors });
  if (!plan.length) throw badRequest('add at least one line');

  const { number } = await nextNumber(tx, 'stock_opening');
  const [doc] = await tx.insert(stockOpening).values({
    number, warehouseId: wh.id, openedOn: b.openedOn, notes: b.notes ?? null, totalSar: halalasToFixed(totalSar),
    lines: plan.map((l) => ({ productId: l.productId, code: l.code, qty: l.qty, unitCostSar: l.unitCostSar, ...(l.serials.length ? { serials: l.serials } : {}) })),
    createdBy: actor.userId, updatedBy: actor.userId,
  }).returning();
  for (const l of plan) {
    await postMove(tx, actor, { kind: 'opening', productId: l.productId, toWarehouseId: wh.id, qty: l.qty, unitCostSar: l.unitCostSar, serials: l.serials, refType: 'stock_opening', refId: doc!.id, note: `${number} — ${b.openedOn}` });
  }
  await audit(tx, actor, 'create', 'stock_opening', doc!.id, null, { number, warehouse: wh.code, lines: plan.length, totalSar: halalasToFixed(totalSar) });
  await emit(tx, 'stock_opening', doc!.id, 'stock.opening_posted', { number, lines: plan.length });
  return { ...summary, posted: { id: doc!.id, number } };
}

export async function listOpenings(tx: Tx, actor: RequestActor) {
  const rows = await tx.select({ o: stockOpening, whCode: warehouse.code, whName: warehouse.nameAr }).from(stockOpening).innerJoin(warehouse, eq(warehouse.id, stockOpening.warehouseId)).orderBy(desc(stockOpening.createdAt)).limit(200);
  const cost = canCost(actor);
  return rows.map((r) => ({ id: r.o.id, number: r.o.number, openedOn: r.o.openedOn, warehouseCode: r.whCode, warehouseName: r.whName, lines: r.o.lines.length, totalSar: cost ? r.o.totalSar : null, notes: r.o.notes, createdAt: r.o.createdAt }));
}

export async function openingView(tx: Tx, actor: RequestActor, id: string) {
  if (!isUuid(id)) throw notFound('opening stock');
  const [o] = await tx.select().from(stockOpening).where(eq(stockOpening.id, id));
  if (!o) throw notFound('opening stock');
  const [wh] = await tx.select({ id: warehouse.id, code: warehouse.code, nameAr: warehouse.nameAr, nameEn: warehouse.nameEn }).from(warehouse).where(eq(warehouse.id, o.warehouseId));
  const names = o.lines.length ? await tx.select({ id: product.id, nameAr: product.nameAr }).from(product).where(inArray(product.id, o.lines.map((l) => l.productId))) : [];
  const nm = new Map(names.map((n) => [n.id, n.nameAr]));
  const cost = canCost(actor);
  return {
    ...o, totalSar: cost ? o.totalSar : null, warehouse: wh ?? null,
    lines: o.lines.map((l) => ({ ...l, name: nm.get(l.productId) ?? '', unitCostSar: cost ? l.unitCostSar : null, valueSar: cost ? halalasToFixed(dec(l.qty).times(l.unitCostSar).times(100).toDecimalPlaces(0).toNumber()) : null })),
  };
}
