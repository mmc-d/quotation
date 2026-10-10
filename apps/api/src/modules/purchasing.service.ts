import {
  and, asc, desc, emit, eq, goodsReceipt, goodsReceiptLine, importShipment, inArray, materialRequest, materialRequestLine, nextNumber, party, product, project,
  purchaseOrder, purchaseOrderLine, serialNumber, sql, stockMove, supplierBill, warehouse, type Tx,
} from '@mmc/db';
import {
  PO_APPROVER_RANK, addMonths, allocateLandedCost, dec, halalasToFixed, lineAmountHalalas, normalizeMac, parseSerialList, percentOf, poApproverRole, riyadhDate, threeWayMatch, toHalalas,
  type Halalas, type LandedBasis,
} from '@mmc/domain';
import type { PurchaseOrderDoc } from '@mmc/doc-templates';
import type { RequestActor } from '../auth/actor.js';
import { tryPost } from './gl-posting.service.js';
import { audit } from '../common/audit.js';
import { companyBlock } from '../common/company.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { assertCan } from '../common/scope.js';
import {
  canCost, complianceFor, ensureMainWarehouse, fq, fx4, isUuid, loadWarehouse, postMove, reserve, userNameMap, valuationQty,
} from './inventory.service.js';

/**
 * Procurement (module 07 §3.5–3.6): purchase orders with approval limits, receipts with serial + MAC
 * capture, landed cost from import shipments and supplier bills with the 3-way match.
 */

export type PoRow = typeof purchaseOrder.$inferSelect;
export type PoLineRow = typeof purchaseOrderLine.$inferSelect;

export const VAT_RATE = 15;

export async function loadSupplier(tx: Tx, id: string) {
  if (!isUuid(id)) throw notFound('supplier');
  const [s] = await tx.select().from(party).where(eq(party.id, id));
  if (!s) throw notFound('supplier');
  if (!s.isSupplier) throw badRequest(`${s.nameAr} is not marked as a supplier`);
  return s;
}

export async function loadPo(tx: Tx, actor: RequestActor, id: string, perm: 'purchase.read' | 'purchase.write' | 'purchase.approve' = 'purchase.read') {
  if (!isUuid(id)) throw notFound('purchase order');
  const [po] = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.id, id));
  if (!po) throw notFound('purchase order');
  assertCan(actor, perm, { ownerId: po.ownerId });
  return po;
}

/** Default SAR rate per currency (USD is pegged at 3.75). */
export function defaultRate(currency: string): string {
  return currency === 'SAR' ? '1' : currency === 'USD' ? '3.75' : '';
}

/**
 * PO totals in the PO currency (minor units) and in SAR. VAT 15% only on local SAR purchases from a
 * VAT-registered supplier; imports pay VAT at customs (recoverable, never on the PO).
 */
export function poTotals(lines: { qty: string; unitPrice: string }[], currency: string, rateToSar: string, supplierVat: string | null | undefined) {
  const subtotal = lines.reduce((s, l) => s + lineAmountHalalas(l.unitPrice, l.qty), 0);
  const vat = currency === 'SAR' && supplierVat ? percentOf(subtotal, VAT_RATE) : 0;
  const total = subtotal + vat;
  const totalSar = dec(total).times(rateToSar).toDecimalPlaces(0).toNumber();
  return { subtotal, vat, total, totalSar };
}

export async function writePoTotals(tx: Tx, po: PoRow) {
  const lines = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id));
  const [s] = await tx.select({ vatNumber: party.vatNumber }).from(party).where(eq(party.id, po.supplierId));
  const t = poTotals(lines, po.currency, po.rateToSar, s?.vatNumber);
  await tx.update(purchaseOrder).set({ subtotal: halalasToFixed(t.subtotal), vat: halalasToFixed(t.vat), total: halalasToFixed(t.total), totalSar: halalasToFixed(t.totalSar) }).where(eq(purchaseOrder.id, po.id));
  return t;
}

/** Highest PO-approval rank among the actor's roles. */
export function approverRank(actor: RequestActor): number {
  return Math.max(0, ...actor.roleKeys.map((k) => PO_APPROVER_RANK[k] ?? 0));
}

export interface PoLineInput { productId?: string | null; code: string; description?: string | null; qty: string; unitPrice: string; materialRequestLineId?: string | null; projectId?: string | null }

/** Insert PO lines (checks products and MR lines; MR line orderedQty grows by the ordered qty). */
export async function insertPoLines(tx: Tx, actor: RequestActor, po: PoRow, lines: PoLineInput[]) {
  let sort = 0;
  for (const l of lines) {
    let code = l.code;
    let description = l.description ?? null;
    if (l.productId) {
      const [p] = await tx.select().from(product).where(eq(product.id, l.productId));
      if (!p) throw badRequest(`unknown product ${l.productId}`);
      code = code || p.code;
      description = description ?? p.nameAr;
    }
    if (l.materialRequestLineId) {
      const [ml] = await tx.select().from(materialRequestLine).where(eq(materialRequestLine.id, l.materialRequestLineId));
      if (!ml) throw badRequest('unknown material request line');
      if (l.productId && ml.productId !== l.productId) throw badRequest('the material request line is for another product');
      await tx.update(materialRequestLine).set({ orderedQty: fq(dec(ml.orderedQty).plus(l.qty)), updatedAt: new Date(), updatedBy: actor.userId }).where(eq(materialRequestLine.id, ml.id));
    }
    await tx.insert(purchaseOrderLine).values({
      orderId: po.id, sort: sort++, productId: l.productId ?? null, code, description, qty: l.qty, unitPrice: l.unitPrice,
      materialRequestLineId: l.materialRequestLineId ?? null, projectId: l.projectId ?? po.projectId ?? null, createdBy: actor.userId, updatedBy: actor.userId,
    });
  }
  await syncMrStatus(tx, lines.map((l) => l.materialRequestLineId).filter((x): x is string => !!x));
}

export interface PoCreateInput {
  supplierId: string; currency: string; rateToSar?: string; incoterm?: string | null; depositPercent: number; orderDate?: string | null; expectedOn?: string | null;
  projectId?: string | null; notes?: string | null; lines: PoLineInput[];
}

/** Create a draft purchase order with its lines and totals (manual, from an MR, or from an awarded RFQ). Returns the PO id. */
export async function createPurchaseOrder(tx: Tx, actor: RequestActor, b: PoCreateInput, materialRequestId: string | null) {
  await loadSupplier(tx, b.supplierId);
  if (b.projectId) {
    if (!isUuid(b.projectId)) throw notFound('project');
    const [prj] = await tx.select({ id: project.id }).from(project).where(eq(project.id, b.projectId));
    if (!prj) throw notFound('project');
  }
  const rate = b.rateToSar ?? defaultRate(b.currency);
  if (!rate || dec(rate).lte(0)) throw badRequest(`give the SAR rate for ${b.currency} (rateToSar)`);
  const { number } = await nextNumber(tx, 'purchase_order');
  const [po] = await tx.insert(purchaseOrder).values({
    number, supplierId: b.supplierId, status: 'draft', currency: b.currency, rateToSar: rate, incoterm: b.incoterm ?? null, depositPercent: b.depositPercent, orderDate: b.orderDate ?? riyadhDate(),
    expectedOn: b.expectedOn ?? null, projectId: b.projectId ?? null, materialRequestId, notes: b.notes ?? null, ownerId: actor.userId, createdBy: actor.userId, updatedBy: actor.userId,
  }).returning();
  await insertPoLines(tx, actor, po!, b.lines);
  const t = await writePoTotals(tx, po!);
  await audit(tx, actor, 'create', 'purchase_order', po!.id, null, { number, supplierId: b.supplierId, currency: b.currency, totalSar: halalasToFixed(t.totalSar), lines: b.lines.length });
  await emit(tx, 'purchase_order', po!.id, 'purchase_order.created', { number });
  return po!.id;
}

/** Undo the MR "ordered" quantities of PO lines (draft edit / cancel). */
export async function unlinkPoLines(tx: Tx, actor: RequestActor, poId: string) {
  const lines = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, poId));
  const mrLines: string[] = [];
  for (const l of lines) {
    if (!l.materialRequestLineId) continue;
    const [ml] = await tx.select().from(materialRequestLine).where(eq(materialRequestLine.id, l.materialRequestLineId));
    if (!ml) continue;
    const left = dec(ml.orderedQty).minus(dec(l.qty).minus(l.receivedQty));
    await tx.update(materialRequestLine).set({ orderedQty: fq(left.lt(0) ? dec(0) : left), updatedAt: new Date(), updatedBy: actor.userId }).where(eq(materialRequestLine.id, ml.id));
    mrLines.push(ml.id);
  }
  await syncMrStatus(tx, mrLines);
}

/** An approved/draft MR becomes "ordered" when every line is fully on order (and back otherwise). */
async function syncMrStatus(tx: Tx, mrLineIds: string[]) {
  if (!mrLineIds.length) return;
  const ids = await tx.selectDistinct({ id: materialRequestLine.requestId }).from(materialRequestLine).where(inArray(materialRequestLine.id, mrLineIds));
  for (const { id } of ids) {
    const [mr] = await tx.select().from(materialRequest).where(eq(materialRequest.id, id));
    if (!mr || ['cancelled', 'closed'].includes(mr.status)) continue;
    const lines = await tx.select().from(materialRequestLine).where(eq(materialRequestLine.requestId, id));
    const full = lines.length > 0 && lines.every((l) => dec(l.orderedQty).gte(l.qty));
    const status = full ? 'ordered' : mr.status === 'ordered' ? 'approved' : mr.status;
    if (status !== mr.status) await tx.update(materialRequest).set({ status, updatedAt: new Date() }).where(eq(materialRequest.id, id));
  }
}

/** PO detail: lines with received / billed, receipts, bills, 3-way match, compliance; prices only with purchase.cost.read. */
export async function poView(tx: Tx, actor: RequestActor, id: string) {
  const po = await loadPo(tx, actor, id);
  const cost = canCost(actor);
  const lines = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id)).orderBy(asc(purchaseOrderLine.sort));
  const [s] = await tx.select({ id: party.id, nameAr: party.nameAr, nameEn: party.nameEn, vatNumber: party.vatNumber, phone: party.phone, email: party.email }).from(party).where(eq(party.id, po.supplierId));
  const [prj] = po.projectId ? await tx.select({ id: project.id, number: project.number, name: project.name }).from(project).where(eq(project.id, po.projectId)) : [];
  const receipts = await tx.select({ id: goodsReceipt.id, number: goodsReceipt.number, receivedOn: goodsReceipt.receivedOn, warehouseId: goodsReceipt.warehouseId, shipmentId: goodsReceipt.shipmentId }).from(goodsReceipt).where(eq(goodsReceipt.orderId, po.id)).orderBy(asc(goodsReceipt.receivedOn));
  const bills = await tx.select().from(supplierBill).where(eq(supplierBill.orderId, po.id)).orderBy(asc(supplierBill.billDate));
  const match = threeWayMatch(lines.map((l) => ({ ordered: l.qty, received: l.receivedQty, billed: l.billedQty })));
  const compliance = await complianceFor(tx, [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))]);
  const names = await userNameMap(tx, [po.createdBy, po.approvedBy, po.ownerId]);
  const requiredRank = po.approverRole ? PO_APPROVER_RANK[po.approverRole] ?? 99 : 99;
  return {
    ...po,
    subtotal: cost ? po.subtotal : null, vat: cost ? po.vat : null, total: cost ? po.total : null, totalSar: cost ? po.totalSar : null,
    supplier: s ?? null,
    project: prj ?? null,
    createdByName: names.get(po.createdBy ?? '') ?? null,
    approvedByName: names.get(po.approvedBy ?? '') ?? null,
    canApprove: po.status === 'pending_approval' && !!actor.grants['purchase.approve'] && po.createdBy !== actor.userId && approverRank(actor) >= requiredRank,
    lines: lines.map((l) => ({
      ...l,
      unitPrice: cost ? l.unitPrice : null,
      amount: cost ? halalasToFixed(lineAmountHalalas(l.unitPrice, l.qty)) : null,
      remainingQty: fq(dec(l.qty).minus(l.receivedQty)),
      compliance: l.productId ? compliance.get(l.productId) ?? null : null,
    })),
    receipts,
    bills: bills.map((b) => ({ id: b.id, number: b.number, supplierInvoiceNo: b.supplierInvoiceNo, billDate: b.billDate, matchStatus: b.matchStatus, status: b.status, total: cost ? b.total : null, currency: b.currency })),
    match: { status: match.ok ? 'matched' : 'exception', issues: match.issues },
  };
}

export async function purchaseOrderDoc(tx: Tx, actor: RequestActor, id: string): Promise<PurchaseOrderDoc> {
  if (!canCost(actor)) throw forbidden('the purchase order document shows prices (purchase.cost.read)');
  const v = await poView(tx, actor, id);
  if (!v.supplier) throw notFound('supplier');
  const [sp] = await tx.select({ crNumber: party.crNumber }).from(party).where(eq(party.id, v.supplierId));
  const t = poTotals(v.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice ?? '0' })), v.currency, v.rateToSar, v.supplier.vatNumber);
  return {
    company: await companyBlock(tx),
    number: v.number,
    date: v.orderDate ?? riyadhDate(v.createdAt),
    expectedOn: v.expectedOn,
    status: v.status,
    supplier: { name: v.supplier.nameAr, nameEn: v.supplier.nameEn, vatNumber: v.supplier.vatNumber, crNumber: sp?.crNumber ?? null, phone: v.supplier.phone, email: v.supplier.email },
    currency: v.currency,
    rateToSar: v.rateToSar,
    incoterm: v.incoterm,
    depositPercent: v.depositPercent,
    projectRef: v.project ? `${v.project.number} — ${v.project.name}` : null,
    lines: v.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty, unitPrice: toHalalas(l.unitPrice ?? '0'), amount: lineAmountHalalas(l.unitPrice ?? '0', l.qty) })),
    totals: { ...t, deposit: percentOf(t.total, v.depositPercent) },
    approvedBy: v.approvedByName,
    notes: v.notes,
  };
}

// ───────────────────────── receiving ─────────────────────────

export interface ReceiptInput {
  warehouseId?: string | null;
  receivedOn: string;
  shipmentId?: string | null;
  notes?: string | null;
  lines: { orderLineId: string; qty: string; serialsText?: string | null; serials?: { serial: string; macs?: string[] }[] }[];
}

/**
 * Goods receipt (INV-51, INV-64): quantities within what is still open on the PO (no tolerance),
 * serial-tracked lines with exactly `qty` serials (bulk "serial,mac,mac" list or rows; bad MAC → 400,
 * serial already known → 409), receipt moves at PO price × rate, PO status, and — for project POs —
 * the received quantity reserved for that project.
 */
export async function receive(tx: Tx, actor: RequestActor, poId: string, b: ReceiptInput) {
  const po = await loadPo(tx, actor, poId, 'purchase.read');
  if (!['approved', 'sent', 'partially_received'].includes(po.status)) throw badRequest(`a ${po.status} purchase order cannot be received`);
  const wh = b.warehouseId ? await loadWarehouse(tx, b.warehouseId) : await ensureMainWarehouse(tx, actor.userId);
  if (wh.archivedAt || wh.kind === 'transit') throw badRequest('receive into a store, van, site or quarantine warehouse');
  if (b.shipmentId) {
    if (!isUuid(b.shipmentId)) throw notFound('shipment');
    const [sh] = await tx.select({ id: importShipment.id }).from(importShipment).where(eq(importShipment.id, b.shipmentId));
    if (!sh) throw notFound('shipment');
  }
  const lines = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id));
  if (!b.lines.length) throw badRequest('nothing to receive');
  const ids = b.lines.map((l) => l.orderLineId);
  if (new Set(ids).size !== ids.length) throw badRequest('an order line appears twice — one entry per line');

  // validate everything before writing
  const errors: { line: number; ar: string; en: string }[] = [];
  const plan: { line: PoLineRow; qty: ReturnType<typeof dec>; serials: { serial: string; macs: string[] }[]; serialTracked: boolean; warrantyMonths: number | null }[] = [];
  for (const [i, l] of b.lines.entries()) {
    const ol = lines.find((x) => x.id === l.orderLineId);
    if (!ol) throw badRequest(`line ${i + 1}: not a line of ${po.number}`);
    const qty = dec(l.qty);
    const open = dec(ol.qty).minus(ol.receivedQty);
    if (qty.gt(open)) throw badRequest(`line ${i + 1} (${ol.code}): ${qty.toString()} received but only ${open.toString()} still open on the order`, { line: i + 1, open: open.toString() });
    const [p] = ol.productId ? await tx.select().from(product).where(eq(product.id, ol.productId)) : [];
    let serials: { serial: string; macs: string[] }[] = [];
    if (l.serialsText) {
      const parsed = parseSerialList(l.serialsText);
      errors.push(...parsed.errors.map((e) => ({ ...e, ar: `البند ${i + 1}، السطر ${e.line}: ${e.ar}`, en: `line ${i + 1}, row ${e.line}: ${e.en}` })));
      serials = parsed.rows;
    } else if (l.serials?.length) {
      for (const [j, s] of l.serials.entries()) {
        const macs: string[] = [];
        for (const m of s.macs ?? []) {
          const n = normalizeMac(m);
          if (!n) errors.push({ line: j + 1, ar: `البند ${i + 1}: عنوان MAC غير صالح ${m}`, en: `line ${i + 1}: invalid MAC ${m}` });
          else macs.push(n);
        }
        serials.push({ serial: s.serial.trim().toUpperCase(), macs });
      }
    }
    if (p?.serialTracked) {
      if (!qty.isInteger()) throw badRequest(`line ${i + 1} (${ol.code}) is serial-tracked: whole units only`);
      if (!errors.length && serials.length !== qty.toNumber()) {
        throw badRequest(`line ${i + 1} (${ol.code}) is serial-tracked: ${qty.toString()} serial number(s) needed, ${serials.length} given`, { line: i + 1, needed: qty.toNumber(), given: serials.length });
      }
    } else if (serials.length) {
      throw badRequest(`line ${i + 1} (${ol.code}): the product is not serial-tracked — mark it serial-tracked first or send no serials`);
    }
    plan.push({ line: ol, qty, serials, serialTracked: !!p?.serialTracked, warrantyMonths: p?.warrantyMonths ?? null });
  }
  if (errors.length) throw badRequest('the serial / MAC list has errors', { errors });
  // duplicates within the receipt and against the database
  const seen = new Set<string>();
  for (const pl of plan) for (const s of pl.serials) {
    const k = `${pl.line.productId}|${s.serial}`;
    if (seen.has(k)) throw conflict(`serial ${s.serial} appears twice in this receipt`);
    seen.add(k);
  }
  for (const pl of plan) {
    if (!pl.serials.length || !pl.line.productId) continue;
    const dup = await tx.select({ serial: serialNumber.serial }).from(serialNumber).where(and(eq(serialNumber.productId, pl.line.productId), inArray(serialNumber.serial, pl.serials.map((s) => s.serial))));
    if (dup.length) throw conflict(`serial number(s) already registered: ${dup.map((d) => d.serial).join(', ')}`);
  }

  const { number } = await nextNumber(tx, 'goods_receipt');
  const [gr] = await tx.insert(goodsReceipt).values({ number, orderId: po.id, warehouseId: wh.id, shipmentId: b.shipmentId ?? null, receivedOn: b.receivedOn, notes: b.notes ?? null, createdBy: actor.userId, updatedBy: actor.userId }).returning();
  for (const pl of plan) {
    if (pl.qty.lte(0)) continue;
    const unitCostSar = fx4(dec(pl.line.unitPrice).times(po.rateToSar));
    await tx.insert(goodsReceiptLine).values({ receiptId: gr!.id, orderLineId: pl.line.id, productId: pl.line.productId, qty: fq(pl.qty), unitCostSar, serials: pl.serials, createdBy: actor.userId, updatedBy: actor.userId });
    const projectId = pl.line.projectId ?? po.projectId ?? null;
    if (pl.line.productId) {
      await postMove(tx, actor, {
        kind: 'receipt', productId: pl.line.productId, toWarehouseId: wh.id, qty: pl.qty, unitCostSar, serials: pl.serials.map((s) => s.serial), projectId,
        refType: 'goods_receipt', refId: gr!.id, note: `${number} / ${po.number}`,
        serialMeta: {
          macs: Object.fromEntries(pl.serials.map((s) => [s.serial, s.macs])), supplierId: po.supplierId, purchaseOrderId: po.id, receiptId: gr!.id,
          supplierWarrantyEnd: pl.warrantyMonths ? addMonths(b.receivedOn, pl.warrantyMonths) : null,
        },
      });
      // back-to-back purchase: what arrives for a project is held for it (INV-63)
      if (projectId) await reserve(tx, actor.userId, { projectId, productId: pl.line.productId, warehouseId: wh.id, qty: pl.qty });
    }
    await tx.update(purchaseOrderLine).set({ receivedQty: fq(dec(pl.line.receivedQty).plus(pl.qty)), updatedAt: new Date(), updatedBy: actor.userId }).where(eq(purchaseOrderLine.id, pl.line.id));
  }
  const after = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id));
  const status = after.every((l) => dec(l.receivedQty).gte(l.qty)) ? 'received' : 'partially_received';
  await tx.update(purchaseOrder).set({ status, updatedAt: new Date(), updatedBy: actor.userId, version: po.version + 1 }).where(eq(purchaseOrder.id, po.id));
  await audit(tx, actor, 'receive', 'purchase_order', po.id, { status: po.status }, { status, receipt: number, lines: plan.length });
  await emit(tx, 'purchase_order', po.id, 'purchase_order.received', { number: po.number, receipt: number, status });
  return receiptView(tx, actor, gr!.id);
}

export async function receiptView(tx: Tx, actor: RequestActor, id: string) {
  if (!isUuid(id)) throw notFound('receipt');
  const [gr] = await tx.select().from(goodsReceipt).where(eq(goodsReceipt.id, id));
  if (!gr) throw notFound('receipt');
  const cost = canCost(actor);
  const lines = await tx.select({ l: goodsReceiptLine, code: purchaseOrderLine.code, description: purchaseOrderLine.description }).from(goodsReceiptLine)
    .innerJoin(purchaseOrderLine, eq(purchaseOrderLine.id, goodsReceiptLine.orderLineId)).where(eq(goodsReceiptLine.receiptId, gr.id));
  const [po] = await tx.select({ number: purchaseOrder.number, status: purchaseOrder.status }).from(purchaseOrder).where(eq(purchaseOrder.id, gr.orderId));
  const [wh] = await tx.select({ code: warehouse.code, nameAr: warehouse.nameAr }).from(warehouse).where(eq(warehouse.id, gr.warehouseId));
  return {
    ...gr, order: po ?? null, warehouse: wh ?? null,
    lines: lines.map((r) => ({ ...r.l, code: r.code, description: r.description, unitCostSar: cost ? r.l.unitCostSar : null, landedPerUnitSar: cost ? r.l.landedPerUnitSar : null })),
  };
}

// ───────────────────────── landed cost ─────────────────────────

/**
 * Allocate a shipment's duty + charges (never import VAT — it is recoverable input VAT) over the
 * receipt lines of the receipts linked to it (INV-72), by value / qty / weight / volume.
 *
 * Valuation: the allocated amount only raises the cost of what is still on hand. Per product:
 *   share   = min(1, onHand / receivedQty)          (the part of the received goods still in stock)
 *   newAvg  = (onHand × avg + allocatedSar × share) / onHand
 * The remainder (goods already issued/consumed) belongs to cost of sales in the back office; it is
 * recorded on the ledger row's note. One zero-quantity `adjust` move per product (refType
 * 'landed_cost', unitCostSar = landed amount per received unit) keeps the trace. Posting twice → 409.
 */
export async function postLandedCost(tx: Tx, actor: RequestActor, shipmentId: string, basis: LandedBasis) {
  if (!isUuid(shipmentId)) throw notFound('shipment');
  const [sh] = await tx.select().from(importShipment).where(eq(importShipment.id, shipmentId)).for('update');
  if (!sh) throw notFound('shipment');
  if (sh.landedPostedAt) throw conflict(`the landed cost of ${sh.number} was already posted`);
  const charge: Halalas = toHalalas(sh.dutySar ?? '0') + sh.charges.reduce((s, c) => s + toHalalas(c.amountSar), 0);
  if (charge <= 0) throw badRequest('nothing to allocate — record the customs declaration (duty) or charges first');
  const rows = await tx.select({ l: goodsReceiptLine, weightKg: product.weightKg }).from(goodsReceiptLine)
    .innerJoin(goodsReceipt, eq(goodsReceipt.id, goodsReceiptLine.receiptId))
    .leftJoin(product, eq(product.id, goodsReceiptLine.productId))
    .where(eq(goodsReceipt.shipmentId, sh.id));
  const lines = rows.filter((r) => r.l.productId && dec(r.l.qty).gt(0));
  if (!lines.length) throw badRequest('no goods received against this shipment yet — receive with shipmentId first');
  const alloc = allocateLandedCost(lines.map((r) => ({
    id: r.l.id, qty: r.l.qty, valueSar: dec(r.l.qty).times(r.l.unitCostSar).toFixed(4), weightKg: r.weightKg ? dec(r.weightKg).times(r.l.qty).toString() : null, volumeM3: null,
  })), charge, basis);
  const perProduct = new Map<string, { halalas: number; qty: ReturnType<typeof dec> }>();
  for (const a of alloc) {
    const r = lines.find((x) => x.l.id === a.id)!;
    await tx.update(goodsReceiptLine).set({ landedPerUnitSar: fx4(dec(r.l.landedPerUnitSar).plus(a.perUnitSar)), updatedAt: new Date(), updatedBy: actor.userId }).where(eq(goodsReceiptLine.id, a.id));
    const cur = perProduct.get(r.l.productId!) ?? { halalas: 0, qty: dec(0) };
    cur.halalas += a.halalas;
    cur.qty = cur.qty.plus(r.l.qty);
    perProduct.set(r.l.productId!, cur);
  }
  const result: { productId: string; code: string; allocatedSar: string; perUnitSar: string; avgBefore: string | null; avgAfter: string | null }[] = [];
  let capitalisedTotal = dec(0);
  for (const [productId, a] of perProduct) {
    const [p] = await tx.select().from(product).where(eq(product.id, productId));
    const onHand = await valuationQty(tx, productId);
    const avg = dec(p!.avgCostSar ?? '0');
    const allocatedSar = dec(a.halalas).div(100);
    let newAvg = avg;
    let capitalised = dec(0);
    if (onHand.gt(0)) {
      const share = onHand.div(a.qty).gt(1) ? dec(1) : onHand.div(a.qty);
      capitalised = allocatedSar.times(share);
      capitalisedTotal = capitalisedTotal.plus(capitalised);
      newAvg = onHand.times(avg).plus(capitalised).div(onHand);
      await tx.update(product).set({ avgCostSar: fx4(newAvg) }).where(eq(product.id, productId));
    }
    const perUnit = allocatedSar.div(a.qty);
    await postMove(tx, actor, {
      kind: 'adjust', productId, qty: 0, unitCostSar: fx4(perUnit), refType: 'landed_cost', refId: sh.id,
      note: `${sh.number}: landed cost ${allocatedSar.toFixed(2)} SAR (${basis}) over ${a.qty.toString()} received; ${capitalised.toFixed(2)} SAR on ${onHand.toString()} on hand, avg ${avg.toFixed(4)} → ${newAvg.toFixed(4)}`,
    });
    result.push({ productId, code: p!.code, allocatedSar: allocatedSar.toFixed(2), perUnitSar: fx4(perUnit), avgBefore: p!.avgCostSar, avgAfter: fx4(newAvg) });
  }
  // the ledger reads this split: what raised the cost of stock still on hand vs what belongs to cost of sales
  const capitalisedH = Math.min(charge, Math.max(0, capitalisedTotal.times(100).toDecimalPlaces(0).toNumber()));
  await tx.update(importShipment).set({ landedBasis: basis, landedPostedAt: new Date(), landedCapitalisedSar: halalasToFixed(capitalisedH), landedExpensedSar: halalasToFixed(charge - capitalisedH), updatedAt: new Date(), updatedBy: actor.userId, version: sh.version + 1 }).where(eq(importShipment.id, sh.id));
  await audit(tx, actor, 'landed_cost', 'import_shipment', sh.id, null, { basis, charge: halalasToFixed(charge), products: result.length });
  await emit(tx, 'import_shipment', sh.id, 'shipment.landed_cost_posted', { number: sh.number, charge: halalasToFixed(charge) });
  await tryPost(tx, 'landed_cost', sh.id);
  return { shipmentId: sh.id, basis, chargeSar: halalasToFixed(charge), lines: alloc.map((a) => ({ receiptLineId: a.id, allocatedSar: halalasToFixed(a.halalas), perUnitSar: a.perUnitSar })), products: result };
}

// ───────────────────────── supplier bills ─────────────────────────

export interface BillInput {
  supplierId: string; orderId: string; supplierInvoiceNo: string; billDate: string; currency: string; rateToSar?: string;
  lines: { orderLineId: string; qty: string; unitPrice: string }[]; vat: string; fileId?: string | null; acceptException?: boolean;
  /** the supplier's ZATCA e-invoice XML (INV-66) — kept as the bill's file when no other file is given */
  sourceXmlFileId?: string | null;
}

/** Supplier bill with the 3-way match (INV-64): billed (existing + this bill) must not exceed received. */
export async function createBill(tx: Tx, actor: RequestActor, b: BillInput) {
  const po = await loadPo(tx, actor, b.orderId, 'purchase.write');
  if (po.supplierId !== b.supplierId) throw badRequest('the purchase order belongs to another supplier');
  await loadSupplier(tx, b.supplierId);
  const [dup] = await tx.select({ id: supplierBill.id }).from(supplierBill).where(and(eq(supplierBill.supplierId, b.supplierId), eq(supplierBill.supplierInvoiceNo, b.supplierInvoiceNo)));
  if (dup) throw conflict(`supplier invoice ${b.supplierInvoiceNo} is already recorded`);
  const lines = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id));
  const add = new Map<string, ReturnType<typeof dec>>();
  for (const l of b.lines) {
    if (!lines.some((x) => x.id === l.orderLineId)) throw badRequest(`order line ${l.orderLineId} is not on ${po.number}`);
    add.set(l.orderLineId, (add.get(l.orderLineId) ?? dec(0)).plus(l.qty));
  }
  const billed = lines.filter((l) => add.has(l.id));
  const match = threeWayMatch(billed.map((l) => ({ ordered: l.qty, received: l.receivedQty, billed: dec(l.billedQty).plus(add.get(l.id)!) })));
  const issues = match.issues.map((i) => ({ ...i, line: b.lines.findIndex((x) => x.orderLineId === billed[i.line]!.id), en: `${billed[i.line]!.code}: ${i.en}`, ar: `${billed[i.line]!.code}: ${i.ar}` }));
  if (!match.ok && b.acceptException && !actor.grants['purchase.approve']) throw forbidden('accepting a 3-way-match exception needs purchase.approve');
  const accepted = match.ok || !!b.acceptException;
  const subtotal = b.lines.reduce((s, l) => s + lineAmountHalalas(l.unitPrice, l.qty), 0);
  const vat = toHalalas(b.vat);
  const { number } = await nextNumber(tx, 'supplier_bill');
  const [row] = await tx.insert(supplierBill).values({
    number, supplierId: b.supplierId, orderId: po.id, supplierInvoiceNo: b.supplierInvoiceNo, billDate: b.billDate, currency: b.currency, rateToSar: b.rateToSar ?? (defaultRate(b.currency) || po.rateToSar),
    subtotal: halalasToFixed(subtotal), vat: halalasToFixed(vat), total: halalasToFixed(subtotal + vat), lines: b.lines,
    matchStatus: match.ok ? 'matched' : 'exception', matchIssues: issues, fileId: b.fileId ?? b.sourceXmlFileId ?? null, status: accepted ? 'approved' : 'draft', createdBy: actor.userId, updatedBy: actor.userId,
  }).returning();
  if (accepted) {
    for (const l of billed) await tx.update(purchaseOrderLine).set({ billedQty: fq(dec(l.billedQty).plus(add.get(l.id)!)), updatedAt: new Date(), updatedBy: actor.userId }).where(eq(purchaseOrderLine.id, l.id));
  }
  await audit(tx, actor, 'create', 'supplier_bill', row!.id, null, { number, order: po.number, matchStatus: row!.matchStatus, accepted, ...(b.sourceXmlFileId ? { sourceXmlFileId: b.sourceXmlFileId } : {}) });
  await emit(tx, 'supplier_bill', row!.id, match.ok ? 'supplier_bill.matched' : 'supplier_bill.exception', { number, order: po.number });
  await tryPost(tx, 'bill', row!.id);
  return row!;
}

export async function receiptsOfShipment(tx: Tx, shipmentId: string) {
  return tx.select({ id: goodsReceipt.id, number: goodsReceipt.number, receivedOn: goodsReceipt.receivedOn, orderId: goodsReceipt.orderId }).from(goodsReceipt).where(eq(goodsReceipt.shipmentId, shipmentId)).orderBy(desc(goodsReceipt.receivedOn));
}

export async function landedMoves(tx: Tx, shipmentId: string) {
  return tx.select().from(stockMove).where(and(eq(stockMove.refType, 'landed_cost'), eq(stockMove.refId, shipmentId)));
}

/** Accept a draft bill held as a 3-way-match exception (purchase.approve; not by the user who entered it). */
export async function approveBill(tx: Tx, actor: RequestActor, id: string) {
  if (!actor.grants['purchase.approve']) throw forbidden('accepting a 3-way-match exception needs purchase.approve');
  const [bill] = await tx.select().from(supplierBill).where(eq(supplierBill.id, id));
  if (!bill) throw notFound('supplier bill');
  if (bill.status !== 'draft') throw badRequest(`bill ${bill.number} is ${bill.status}`);
  if (bill.createdBy === actor.userId) throw forbidden('the user who entered the bill cannot accept its exception');
  for (const l of bill.lines) {
    if (!l.orderLineId) continue;
    const [line] = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.id, l.orderLineId));
    if (line) await tx.update(purchaseOrderLine).set({ billedQty: fq(dec(line.billedQty).plus(l.qty)), updatedAt: new Date(), updatedBy: actor.userId }).where(eq(purchaseOrderLine.id, line.id));
  }
  const [row] = await tx.update(supplierBill).set({ status: 'approved', updatedAt: new Date(), updatedBy: actor.userId }).where(eq(supplierBill.id, id)).returning();
  await audit(tx, actor, 'accept_exception', 'supplier_bill', id, { status: bill.status }, { status: 'approved', matchIssues: bill.matchIssues });
  await tryPost(tx, 'bill', id);
  return row!;
}
