import {
  and, appUser, asc, changeOrder, complianceCert, contract, desc, eq, inArray, installedAsset, kitComponent, ne, product, purchaseOrder, purchaseOrderLine, serialNumber, sql,
  stockBalance, stockMove, stockReservation, warehouse, workOrder, type SQL, type Tx,
} from '@mmc/db';
import { STOCK_MOVE_KINDS, complianceStatus, dec, movingAverageCost, riyadhDate, type StockMoveKind } from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';

/**
 * Inventory ledger (module 07). MMC Core keeps the stock ledger until the ERPNext back office is
 * connected: every stock change goes through `postMove`, which appends one `stock_move` row (the app
 * role can only INSERT/SELECT that table), keeps `stock_balance` in step, refuses negative stock,
 * moves serial numbers and maintains the moving-weighted-average cost on receipts (INV-73).
 */

export type ProductRow = typeof product.$inferSelect;
export type WarehouseRow = typeof warehouse.$inferSelect;
type D = ReturnType<typeof dec>;

export const MAIN_CODE = 'MAIN';
export const TRANSIT_CODE = 'TRANSIT';
/** Open PO statuses whose unreceived quantity counts as incoming. */
export const OPEN_PO = ['approved', 'sent', 'partially_received'];
/** Product types that never hold stock. */
export const NON_STOCK_TYPES = ['service', 'labor', 'non_stock', 'kit'];

export const canCost = (actor: RequestActor) => !!actor.grants['purchase.cost.read'];
export const fx4 = (v: D) => v.toFixed(4);
export const fq = (v: D) => v.toDecimalPlaces(3).toString();

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ───────────────────────── warehouses ─────────────────────────

/** The Jeddah main store (code MAIN), created on first use. */
export async function ensureMainWarehouse(tx: Tx, actorId: string | null = null): Promise<WarehouseRow> {
  const [w] = await tx.select().from(warehouse).where(eq(warehouse.code, MAIN_CODE));
  if (w) return w;
  await tx.insert(warehouse).values({ code: MAIN_CODE, nameAr: 'المستودع الرئيسي – جدة', nameEn: 'Main store – Jeddah', kind: 'main', createdBy: actorId, updatedBy: actorId }).onConflictDoNothing();
  const [row] = await tx.select().from(warehouse).where(eq(warehouse.code, MAIN_CODE));
  return row!;
}

/** The in-transit warehouse used by transfers (INV-31). */
export async function ensureTransitWarehouse(tx: Tx, actorId: string | null = null): Promise<WarehouseRow> {
  const [w] = await tx.select().from(warehouse).where(and(eq(warehouse.kind, 'transit'), sql`${warehouse.archivedAt} is null`)).orderBy(asc(warehouse.createdAt)).limit(1);
  if (w) return w;
  await tx.insert(warehouse).values({ code: TRANSIT_CODE, nameAr: 'بضاعة في الطريق', nameEn: 'In transit', kind: 'transit', createdBy: actorId, updatedBy: actorId }).onConflictDoNothing();
  const [row] = await tx.select().from(warehouse).where(eq(warehouse.code, TRANSIT_CODE));
  return row!;
}

export async function loadWarehouse(tx: Tx, id: string): Promise<WarehouseRow> {
  if (!isUuid(id)) throw notFound('warehouse');
  const [w] = await tx.select().from(warehouse).where(eq(warehouse.id, id));
  if (!w) throw notFound('warehouse');
  return w;
}

export async function loadProduct(tx: Tx, id: string): Promise<ProductRow> {
  if (!isUuid(id)) throw notFound('product');
  const [p] = await tx.select().from(product).where(eq(product.id, id));
  if (!p) throw notFound('product');
  return p;
}

/**
 * Warehouses an actor may read: `inventory.read` with scope "own" (technicians) = the vans they hold
 * (warehouse.custodianId); any wider scope = all. Returns null for "all".
 */
export async function visibleWarehouseIds(tx: Tx, actor: RequestActor): Promise<string[] | null> {
  const scope = actor.grants['inventory.read'];
  if (!scope) throw forbidden('missing permission: inventory.read');
  if (scope !== 'own') return null;
  const rows = await tx.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.custodianId, actor.userId));
  return rows.map((r) => r.id);
}

export async function assertWarehouseVisible(tx: Tx, actor: RequestActor, warehouseId: string) {
  const ids = await visibleWarehouseIds(tx, actor);
  if (ids && !ids.includes(warehouseId)) throw forbidden('not your warehouse');
}

// ───────────────────────── quantities ─────────────────────────

/** Company-wide on-hand quantity used for valuation: every warehouse except quarantine. */
export async function valuationQty(tx: Tx, productId: string): Promise<D> {
  const [r] = await tx.select({ q: sql<string>`coalesce(sum(${stockBalance.qty}), 0)::text` }).from(stockBalance)
    .innerJoin(warehouse, eq(warehouse.id, stockBalance.warehouseId))
    .where(and(eq(stockBalance.productId, productId), ne(warehouse.kind, 'quarantine')));
  return dec(r?.q ?? '0');
}

/** On hand / reserved / incoming per product (company-wide, or limited to some warehouses). */
export async function quantities(tx: Tx, productIds: string[], warehouseIds?: string[] | null) {
  const out = new Map<string, { onHand: D; reserved: D; incoming: D }>();
  for (const id of productIds) out.set(id, { onHand: dec(0), reserved: dec(0), incoming: dec(0) });
  if (!productIds.length) return out;
  const conds: SQL[] = [inArray(stockBalance.productId, productIds)];
  if (warehouseIds) conds.push(warehouseIds.length ? inArray(stockBalance.warehouseId, warehouseIds) : sql`false`);
  const bal = await tx.select({ productId: stockBalance.productId, q: sql<string>`sum(${stockBalance.qty})::text`, r: sql<string>`sum(${stockBalance.reservedQty})::text` })
    .from(stockBalance).innerJoin(warehouse, eq(warehouse.id, stockBalance.warehouseId))
    .where(and(...conds, ne(warehouse.kind, 'quarantine'))).groupBy(stockBalance.productId);
  for (const b of bal) { const o = out.get(b.productId)!; o.onHand = dec(b.q); o.reserved = dec(b.r); }
  {
    const inc = await tx.select({ productId: purchaseOrderLine.productId, q: sql<string>`sum(greatest(${purchaseOrderLine.qty} - ${purchaseOrderLine.receivedQty}, 0))::text` })
      .from(purchaseOrderLine).innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId))
      .where(and(inArray(purchaseOrderLine.productId, productIds), inArray(purchaseOrder.status, OPEN_PO))).groupBy(purchaseOrderLine.productId);
    for (const i of inc) if (i.productId) out.get(i.productId)!.incoming = dec(i.q);
  }
  return out;
}

/** stock_balance.reservedQty = Σ active reservations of that warehouse/product (kept in step). */
export async function syncReserved(tx: Tx, warehouseId: string, productId: string) {
  const [r] = await tx.select({ q: sql<string>`coalesce(sum(${stockReservation.qty}), 0)::text` }).from(stockReservation)
    .where(and(eq(stockReservation.warehouseId, warehouseId), eq(stockReservation.productId, productId), eq(stockReservation.status, 'active')));
  await tx.insert(stockBalance).values({ warehouseId, productId, qty: '0', reservedQty: r?.q ?? '0' })
    .onConflictDoUpdate({ target: [stockBalance.tenantId, stockBalance.warehouseId, stockBalance.productId], set: { reservedQty: r?.q ?? '0', updatedAt: new Date() } });
}

/** Reserve stock for a project in one warehouse (INV-21). */
export async function reserve(tx: Tx, actorId: string | null, input: { projectId: string | null; contractId?: string | null; productId: string; warehouseId: string; qty: D }) {
  if (input.qty.lte(0)) return null;
  const [row] = await tx.insert(stockReservation).values({
    projectId: input.projectId, contractId: input.contractId ?? null, productId: input.productId, warehouseId: input.warehouseId, qty: fq(input.qty), status: 'active', createdBy: actorId, updatedBy: actorId,
  }).returning();
  await syncReserved(tx, input.warehouseId, input.productId);
  return row!;
}

/**
 * Take up to `qty` of a project's active reservations of a product in a warehouse: the taken part
 * becomes `consumed` (stock left for the project) or `released`, or moves to another warehouse.
 * Splits a reservation row when only part of it is taken. Returns the quantity taken.
 */
export async function takeReservation(tx: Tx, actorId: string | null, projectId: string, productId: string, warehouseId: string, qty: D, to: { status: 'consumed' | 'released' } | { warehouseId: string }): Promise<D> {
  if (qty.lte(0)) return dec(0);
  const rows = await tx.select().from(stockReservation)
    .where(and(eq(stockReservation.projectId, projectId), eq(stockReservation.productId, productId), eq(stockReservation.warehouseId, warehouseId), eq(stockReservation.status, 'active')))
    .orderBy(asc(stockReservation.createdAt));
  let left = qty;
  for (const r of rows) {
    if (left.lte(0)) break;
    const rq = dec(r.qty);
    const take = rq.lte(left) ? rq : left;
    const set = 'status' in to ? { status: to.status } : { warehouseId: to.warehouseId };
    if (take.eq(rq)) {
      await tx.update(stockReservation).set({ ...set, updatedAt: new Date(), updatedBy: actorId, version: r.version + 1 }).where(eq(stockReservation.id, r.id));
    } else {
      await tx.update(stockReservation).set({ qty: fq(rq.minus(take)), updatedAt: new Date(), updatedBy: actorId, version: r.version + 1 }).where(eq(stockReservation.id, r.id));
      await tx.insert(stockReservation).values({ projectId, contractId: r.contractId, productId, warehouseId: 'warehouseId' in to ? to.warehouseId : warehouseId, qty: fq(take), status: 'status' in to ? to.status : 'active', createdBy: actorId, updatedBy: actorId });
    }
    left = left.minus(take);
  }
  await syncReserved(tx, warehouseId, productId);
  if ('warehouseId' in to) await syncReserved(tx, to.warehouseId, productId);
  return qty.minus(left);
}

// ───────────────────────── the ledger ─────────────────────────

export interface MoveInput {
  kind: StockMoveKind;
  productId: string;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  qty: string | number | D;
  /** required for receipts (SAR, 4 dp); other moves post at the current average cost */
  unitCostSar?: string | null;
  serials?: string[];
  projectId?: string | null;
  workOrderId?: string | null;
  refType: string;
  refId?: string | null;
  note?: string | null;
  /** receipts: data for the new serial_number rows */
  serialMeta?: { macs?: Record<string, string[]>; supplierId?: string | null; purchaseOrderId?: string | null; receiptId?: string | null; supplierWarrantyEnd?: string | null };
}

/** What happens to a serial that leaves stock without a destination warehouse. */
const SERIAL_OUT_STATUS: Partial<Record<StockMoveKind, string>> = { issue_project: 'consumed', consume_wo: 'consumed', rma_out: 'rma', scrap: 'scrapped', adjust: 'scrapped', count: 'scrapped' };

/**
 * Post one stock move — the ONLY way stock changes. Appends the ledger row, updates the balances of
 * the source/destination warehouses, refuses negative stock (400; counts and adjustments by a user
 * with inventory.count may go below zero), moves serials (serial-tracked products must carry exactly
 * `qty` serials) and, on receipts, updates the product's moving-average cost.
 *
 * A zero-quantity `adjust` without warehouses is a value-only entry (landed cost) and touches no balance.
 */
export async function postMove(tx: Tx, actor: RequestActor | null, m: MoveInput) {
  if (!(STOCK_MOVE_KINDS as readonly string[]).includes(m.kind)) throw badRequest(`unknown move kind ${m.kind}`);
  const qty = dec(m.qty);
  const from = m.fromWarehouseId ?? null;
  const to = m.toWarehouseId ?? null;
  const actorId = actor?.userId ?? null;
  const p = await loadProduct(tx, m.productId);
  const valueOnly = qty.eq(0) && m.kind === 'adjust' && !from && !to;
  if (!valueOnly) {
    if (qty.lte(0)) throw badRequest('quantity must be positive');
    if (!from && !to) throw badRequest('a move needs a source or a destination warehouse');
    if (from && to && from === to) throw badRequest('source and destination are the same warehouse');
    if (NON_STOCK_TYPES.includes(p.type)) throw badRequest(`${p.code} is a ${p.type} item and holds no stock`);
  }
  const whs = new Map<string, WarehouseRow>();
  for (const id of [from, to].filter((x): x is string => !!x)) {
    const w = await loadWarehouse(tx, id);
    if (w.archivedAt) throw badRequest(`warehouse ${w.code} is archived`);
    whs.set(id, w);
  }

  // serials
  const serials = [...new Set((m.serials ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if ((m.serials ?? []).filter((s) => s.trim()).length !== serials.length) throw badRequest(`${p.code}: a serial number appears twice`);
  if (p.serialTracked && !valueOnly) {
    if (!qty.isInteger()) throw badRequest(`${p.code} is serial-tracked: the quantity must be a whole number`);
    if (serials.length !== qty.toNumber()) throw badRequest(`${p.code} is serial-tracked: ${qty.toString()} serial number(s) needed, ${serials.length} given`, { productId: p.id, code: p.code, needed: qty.toNumber(), given: serials.length });
  }
  const existing = serials.length ? await tx.select().from(serialNumber).where(and(eq(serialNumber.productId, p.id), inArray(serialNumber.serial, serials))) : [];
  if (p.serialTracked && serials.length) {
    for (const s of serials) {
      const row = existing.find((e) => e.serial === s);
      if (from) {
        if (!row || row.warehouseId !== from || !['in_stock', 'reserved', 'in_transit'].includes(row.status)) {
          throw badRequest(`serial ${s} (${p.code}) is not in stock in ${whs.get(from)!.code}`, { serial: s, status: row?.status ?? null });
        }
      } else if (row && ['in_stock', 'reserved', 'in_transit'].includes(row.status)) {
        throw conflict(`serial ${s} (${p.code}) is already in stock`);
      }
    }
  }

  // balances (row-locked)
  const avg = dec(p.avgCostSar ?? '0');
  if (!valueOnly && from) {
    const [b] = await tx.select().from(stockBalance).where(and(eq(stockBalance.warehouseId, from), eq(stockBalance.productId, p.id))).for('update');
    const have = dec(b?.qty ?? '0');
    const after = have.minus(qty);
    const mayGoNegative = (m.kind === 'count' || m.kind === 'adjust') && !!actor?.grants['inventory.count'];
    if (after.lt(0) && !mayGoNegative) {
      throw badRequest(`not enough stock of ${p.code} in ${whs.get(from)!.code}: ${have.toString()} on hand, ${qty.toString()} needed`, { productId: p.id, code: p.code, warehouseId: from, onHand: have.toString(), needed: qty.toString() });
    }
    if (b) await tx.update(stockBalance).set({ qty: fq(after), updatedAt: new Date() }).where(eq(stockBalance.id, b.id));
    else await tx.insert(stockBalance).values({ warehouseId: from, productId: p.id, qty: fq(after) });
  }
  let unitCost = avg;
  if (m.kind === 'receipt') {
    if (m.unitCostSar === undefined || m.unitCostSar === null) throw badRequest('a receipt needs a unit cost');
    unitCost = dec(m.unitCostSar);
    const onHand = await valuationQty(tx, p.id);
    const newAvg = movingAverageCost(onHand.toString(), avg.toString(), qty.toString(), unitCost.toString());
    await tx.update(product).set({ avgCostSar: newAvg }).where(eq(product.id, p.id));
  } else if (m.unitCostSar !== undefined && m.unitCostSar !== null) {
    unitCost = dec(m.unitCostSar);
  }
  if (!valueOnly && to) {
    await tx.insert(stockBalance).values({ warehouseId: to, productId: p.id, qty: fq(qty) })
      .onConflictDoUpdate({ target: [stockBalance.tenantId, stockBalance.warehouseId, stockBalance.productId], set: { qty: sql`${stockBalance.qty} + ${fq(qty)}::numeric`, updatedAt: new Date() } });
  }

  // serial rows follow the goods
  if (serials.length && !valueOnly) {
    const toWh = to ? whs.get(to)! : null;
    const status = toWh ? (toWh.kind === 'transit' ? 'in_transit' : 'in_stock') : SERIAL_OUT_STATUS[m.kind] ?? 'consumed';
    const projectId = m.projectId ?? undefined;
    for (const s of serials) {
      const row = existing.find((e) => e.serial === s);
      if (row) {
        await tx.update(serialNumber).set({ warehouseId: to, status, ...(projectId ? { projectId } : {}), updatedAt: new Date(), updatedBy: actorId, version: row.version + 1 }).where(eq(serialNumber.id, row.id));
      } else {
        const meta = m.serialMeta ?? {};
        await tx.insert(serialNumber).values({
          productId: p.id, serial: s, macs: meta.macs?.[s] ?? [], status, warehouseId: to, projectId: m.projectId ?? null,
          purchaseOrderId: meta.purchaseOrderId ?? null, receiptId: meta.receiptId ?? null, supplierId: meta.supplierId ?? null, supplierWarrantyEnd: meta.supplierWarrantyEnd ?? null,
          createdBy: actorId, updatedBy: actorId,
        });
      }
    }
  }

  const [row] = await tx.insert(stockMove).values({
    kind: m.kind, productId: p.id, fromWarehouseId: from, toWarehouseId: to, qty: fq(qty), unitCostSar: fx4(unitCost), serials,
    projectId: m.projectId ?? null, workOrderId: m.workOrderId ?? null, refType: m.refType, refId: m.refId ?? null, note: m.note ?? null, postedBy: actorId,
  }).returning();
  return row!;
}

// ───────────────────────── BOQ explosion ─────────────────────────

export interface BoqLine { productId: string; code: string; description: string | null; qty: D }

/**
 * Contract BOQ = contract lines + effective change orders, matched to the catalog by code; kits are
 * exploded into their (non-optional) components; INS / labour / service lines are skipped.
 */
export async function contractBoq(tx: Tx, contractId: string): Promise<{ lines: BoqLine[]; unmatched: string[] }> {
  const [c] = await tx.select().from(contract).where(eq(contract.id, contractId));
  if (!c) throw notFound('contract');
  const cos = await tx.select({ lines: changeOrder.lines }).from(changeOrder).where(and(eq(changeOrder.contractId, contractId), inArray(changeOrder.status, ['approved', 'signed', 'billed'])));
  const raw = [...c.lines, ...cos.flatMap((x) => x.lines)].filter((l) => l.code && l.code.trim().toUpperCase() !== 'INS');
  const codes = [...new Set(raw.map((l) => l.code.trim()))];
  const prods = codes.length ? await tx.select().from(product).where(inArray(product.code, codes)) : [];
  const byCode = new Map(prods.map((p) => [p.code, p]));
  const out: BoqLine[] = [];
  const unmatched = new Set<string>();
  const add = async (p: ProductRow, qty: D, depth: number): Promise<void> => {
    if (p.type === 'kit') {
      if (depth > 6) return;
      const comps = await tx.select({ k: kitComponent, p: product }).from(kitComponent).innerJoin(product, eq(product.id, kitComponent.componentId)).where(eq(kitComponent.kitId, p.id));
      for (const k of comps) if (!k.k.optional) await add(k.p, qty.times(k.k.qty), depth + 1);
      return;
    }
    if (NON_STOCK_TYPES.includes(p.type)) return;
    out.push({ productId: p.id, code: p.code, description: p.nameAr, qty });
  };
  for (const l of raw) {
    const p = byCode.get(l.code.trim());
    if (!p) { unmatched.add(l.code.trim()); continue; }
    await add(p, dec(l.qty), 0);
  }
  return { lines: out, unmatched: [...unmatched] };
}

/** BOQ merged per product. */
export function mergeBoq(lines: BoqLine[]): Map<string, BoqLine> {
  const m = new Map<string, BoqLine>();
  for (const l of lines) {
    const cur = m.get(l.productId);
    if (cur) cur.qty = cur.qty.plus(l.qty);
    else m.set(l.productId, { ...l });
  }
  return m;
}

// ───────────────────────── compliance ─────────────────────────

export async function complianceFor(tx: Tx, productIds: string[], today = riyadhDate()) {
  const out = new Map<string, ReturnType<typeof complianceStatus>>();
  if (!productIds.length) return out;
  const prods = await tx.select({ id: product.id, radio: product.radio }).from(product).where(inArray(product.id, productIds));
  const certs = await tx.select({ productId: complianceCert.productId, kind: complianceCert.kind, expiresOn: complianceCert.expiresOn }).from(complianceCert).where(inArray(complianceCert.productId, productIds));
  for (const p of prods) out.set(p.id, complianceStatus(certs.filter((c) => c.productId === p.id), p.radio, today));
  return out;
}

// ───────────────────────── technician consumption (Phase 4 hook) ─────────────────────────

/**
 * Post what a work order used (INV-33): parts in `partsUsed` (matched to the catalog by code) and
 * devices registered on the work order whose serial was received into stock (INV-53: the serial is
 * marked installed and linked to the installed asset). Stock comes from the technician's van
 * (warehouse.custodianId = technician), else the project's site warehouse, else MAIN. Matching
 * project reservations are marked consumed.
 *
 * Serial-tracked products are consumed by serial only (serials of the registered devices plus serials
 * typed on part lines); a part line of a serial-tracked product without a serial is reported, not posted.
 * Idempotent: what was already posted for the work order is not posted again. Each line runs in its own
 * savepoint, so one missing part never blocks the others; problems come back in `warnings`.
 */
export async function consumeForWorkOrder(tx: Tx, actor: RequestActor | null, workOrderId: string) {
  const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, workOrderId));
  if (!wo) throw notFound('work order');
  const warnings: string[] = [];
  const posted: { productId: string; code: string; qty: string; warehouseId: string; serials: string[] }[] = [];

  // candidate warehouses, in order
  const cands: WarehouseRow[] = [];
  if (wo.technicianId) cands.push(...await tx.select().from(warehouse).where(and(eq(warehouse.custodianId, wo.technicianId), eq(warehouse.kind, 'van'), sql`${warehouse.archivedAt} is null`)).orderBy(asc(warehouse.code)));
  if (wo.projectId) cands.push(...await tx.select().from(warehouse).where(and(eq(warehouse.projectId, wo.projectId), sql`${warehouse.archivedAt} is null`)).orderBy(asc(warehouse.code)));
  cands.push(await ensureMainWarehouse(tx, actor?.userId ?? null));
  const candIds = [...new Set(cands.map((w) => w.id))];

  // what was already posted for this work order (net of returns)
  const prior = await tx.select().from(stockMove).where(and(eq(stockMove.workOrderId, wo.id), inArray(stockMove.kind, ['consume_wo', 'return'])));
  const doneQty = new Map<string, D>();
  const doneSerials = new Set<string>();
  for (const mv of prior) {
    const sign = mv.kind === 'consume_wo' ? 1 : -1;
    doneQty.set(mv.productId, (doneQty.get(mv.productId) ?? dec(0)).plus(dec(mv.qty).times(sign)));
    for (const s of mv.serials) { if (sign > 0) doneSerials.add(`${mv.productId}|${s}`); else doneSerials.delete(`${mv.productId}|${s}`); }
  }

  // demand: serial-tracked → serial set; others → quantity
  const assets = await tx.select().from(installedAsset).where(eq(installedAsset.workOrderId, wo.id));
  const codes = [...new Set([...wo.partsUsed.map((p) => p.code.trim()), ...assets.map((a) => a.code)])];
  const prods = codes.length ? await tx.select().from(product).where(inArray(product.code, codes)) : [];
  const byCode = new Map(prods.map((p) => [p.code, p]));
  const byId = new Map(prods.map((p) => [p.id, p]));
  const serialWant = new Map<string, Map<string, string | null>>(); // productId → serial → assetId
  const qtyWant = new Map<string, D>();
  for (const a of assets) {
    if (!a.serial) continue;
    const p = (a.productId ? byId.get(a.productId) : undefined) ?? byCode.get(a.code);
    if (!p?.serialTracked) continue;
    const s = a.serial.trim().toUpperCase();
    const [sn] = await tx.select({ id: serialNumber.id }).from(serialNumber).where(and(eq(serialNumber.productId, p.id), eq(serialNumber.serial, s)));
    if (!sn) continue; // a device not bought through the system (e.g. customer-supplied)
    if (!serialWant.has(p.id)) serialWant.set(p.id, new Map());
    serialWant.get(p.id)!.set(s, a.id);
  }
  for (const part of wo.partsUsed) {
    const p = byCode.get(part.code.trim());
    if (!p) { warnings.push(`${part.code}: not in the catalog — not posted`); continue; }
    if (NON_STOCK_TYPES.includes(p.type)) continue;
    if (p.serialTracked) {
      if (part.serial) {
        if (!serialWant.has(p.id)) serialWant.set(p.id, new Map());
        const s = part.serial.trim().toUpperCase();
        if (!serialWant.get(p.id)!.has(s)) serialWant.get(p.id)!.set(s, null);
      } else if (!assets.some((a) => a.code === p.code && a.serial)) {
        warnings.push(`${p.code}: serial-tracked part without a serial number — not posted`);
      }
      continue;
    }
    qtyWant.set(p.id, (qtyWant.get(p.id) ?? dec(0)).plus(dec(part.qty)));
  }

  const savepoint = async (label: string, fn: (sp: Tx) => Promise<void>) => {
    try {
      await tx.transaction(async (sp) => fn(sp));
    } catch (e) {
      warnings.push(`${label}: ${(e as { response?: { message?: string } }).response?.message ?? (e as Error).message}`);
    }
  };

  // serialised devices: from wherever the serial sits among the candidate warehouses
  for (const [productId, want] of serialWant) {
    const p = byId.get(productId)!;
    for (const [s, assetId] of want) {
      if (doneSerials.has(`${productId}|${s}`)) {
        if (assetId) await tx.update(serialNumber).set({ status: 'installed', installedAssetId: assetId }).where(and(eq(serialNumber.productId, productId), eq(serialNumber.serial, s)));
        continue;
      }
      await savepoint(`${p.code} ${s}`, async (sp) => {
        const [sn] = await sp.select().from(serialNumber).where(and(eq(serialNumber.productId, productId), eq(serialNumber.serial, s)));
        if (!sn || !sn.warehouseId || !['in_stock', 'reserved'].includes(sn.status)) throw new Error(`serial ${s} is not in stock`);
        if (!candIds.includes(sn.warehouseId)) throw new Error(`serial ${s} is in another warehouse — transfer it to the van first`);
        await postMove(sp, actor, { kind: 'consume_wo', productId, fromWarehouseId: sn.warehouseId, qty: 1, serials: [s], projectId: wo.projectId, workOrderId: wo.id, refType: 'work_order', refId: wo.id, note: wo.number });
        if (assetId) await sp.update(serialNumber).set({ status: 'installed', installedAssetId: assetId }).where(eq(serialNumber.id, sn.id));
        if (wo.projectId) await takeReservation(sp, actor?.userId ?? null, wo.projectId, productId, sn.warehouseId, dec(1), { status: 'consumed' });
        posted.push({ productId, code: p.code, qty: '1', warehouseId: sn.warehouseId, serials: [s] });
      });
    }
  }

  // plain parts: first candidate warehouse that has the quantity
  for (const [productId, want] of qtyWant) {
    const p = byId.get(productId)!;
    const need = want.minus(doneQty.get(productId) ?? dec(0));
    if (need.lte(0)) continue;
    await savepoint(p.code, async (sp) => {
      const bal = await sp.select().from(stockBalance).where(and(eq(stockBalance.productId, productId), inArray(stockBalance.warehouseId, candIds)));
      const wh = candIds.find((id) => dec(bal.find((b) => b.warehouseId === id)?.qty ?? '0').gte(need));
      if (!wh) throw new Error(`not enough stock (${need.toString()} needed) in the van, the project site or the main store`);
      await postMove(sp, actor, { kind: 'consume_wo', productId, fromWarehouseId: wh, qty: need, projectId: wo.projectId, workOrderId: wo.id, refType: 'work_order', refId: wo.id, note: wo.number });
      if (wo.projectId) await takeReservation(sp, actor?.userId ?? null, wo.projectId, productId, wh, need, { status: 'consumed' });
      posted.push({ productId, code: p.code, qty: need.toString(), warehouseId: wh, serials: [] });
    });
  }

  if (posted.length) await audit(tx, actor, 'consume', 'work_order', wo.id, null, { moves: posted.length, warnings: warnings.length });
  return { posted, warnings };
}

// ───────────────────────── small view helpers ─────────────────────────

export async function userNameMap(tx: Tx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await tx.select({ id: appUser.id, nameAr: appUser.nameAr, email: appUser.email }).from(appUser).where(inArray(appUser.id, list)) : [];
  return new Map(rows.map((r) => [r.id, r.nameAr || r.email]));
}

export async function lastMoves(tx: Tx, where: SQL, limit = 50) {
  return tx.select().from(stockMove).where(where).orderBy(desc(stockMove.postedAt)).limit(limit);
}
