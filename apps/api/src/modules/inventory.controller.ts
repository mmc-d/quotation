import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  and, appUser, asc, complianceCert, desc, emit, eq, gte, goodsReceipt, ilike, importShipment, inArray, installedAsset, isNull, lt, materialRequest, materialRequestLine, ne, nextNumber, or, party,
  product, project, purchaseOrder, purchaseOrderLine, serialNumber, sql, stockBalance, stockCount, stockMove, stockReservation, stockTransfer, supplierBill, supplierItem, warehouse, workOrder, type SQL, type Tx,
} from '@mmc/db';
import {
  CERT_KINDS, CERT_LABELS, INCOTERMS, PO_APPROVER_RANK, SHIPMENT_DOCS, SHIPMENT_STATUSES, WAREHOUSE_KINDS, WAREHOUSE_KIND_LABELS, canTransitionPo, countAccuracy, dec, halalasToFixed,
  importCharges, planMaterials, poApproverRole, projectedQty, riyadhDate, toHalalas, type PoStatus, type ShipmentStatus,
} from '@mmc/domain';
import { htmlToPdf, renderPurchaseOrderHtml } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { scopeFilter } from '../common/scope.js';
import { ZodPipe, zDate, zMoney, zPage, zQty, zUuid } from '../common/zod.js';
import { config } from '../config.js';
import {
  MAIN_CODE, assertWarehouseVisible, canCost, complianceFor, contractBoq, ensureMainWarehouse, ensureTransitWarehouse, fq, isUuid, loadProduct, loadWarehouse, mergeBoq,
  postMove, quantities, reserve, syncReserved, takeReservation, userNameMap, visibleWarehouseIds,
} from './inventory.service.js';
import {
  approverRank, approveBill, createBill, createPurchaseOrder, defaultRate, insertPoLines, landedMoves, loadPo, loadSupplier, poView, postLandedCost, purchaseOrderDoc, receiptView, receiptsOfShipment, receive, unlinkPoLines, writePoTotals,
} from './purchasing.service.js';
import { tryPost } from './gl-posting.service.js';
import { deliverPurchaseOrder } from './rfq.service.js';

/**
 * Inventory, procurement & imports (module 07) under /api/inventory. MMC Core keeps the stock ledger
 * until ERPNext is connected; every stock change goes through `postMove` (inventory.service.ts).
 * Unit costs and values are shown only with purchase.cost.read.
 */

const zText = (max = 2000) => z.string().trim().max(max);
const zQty0 = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d+(\.\d{1,3})?$/.test(v), 'invalid quantity');
const zPrice = zMoney.refine((v) => Number(v) >= 0, 'must not be negative');
const zBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const CURRENCIES = ['SAR', 'USD', 'CNY', 'EUR', 'AED'] as const;
type Currency = (typeof CURRENCIES)[number];

const warehouseSchema = z.object({
  code: zText(30).min(1).transform((v) => v.toUpperCase()), nameAr: zText(200).min(1), nameEn: zText(200).nullish(),
  kind: z.enum(WAREHOUSE_KINDS).default('main'), custodianId: zUuid.nullish(), projectId: zUuid.nullish(), branchId: zUuid.nullish(), archived: z.boolean().optional(),
});
const productSettingsSchema = z.object({
  serialTracked: z.boolean().optional(), radio: z.boolean().optional(), hsCode: zText(20).nullish(), originCountry: z.string().regex(/^[A-Z]{2}$/).nullish(),
  reorderLevel: zQty0.nullish(), reorderQty: zQty0.nullish(), weightKg: zQty0.nullish(), warrantyMonths: z.number().int().min(0).max(240).nullish(),
});
const certSchema = z.object({ kind: z.enum(CERT_KINDS), number: zText(100).min(1), issuedOn: zDate.nullish(), expiresOn: zDate.nullish(), fileId: zUuid.nullish(), notes: zText(1000).nullish() });
const supplierItemSchema = z.object({
  supplierId: zUuid, productId: zUuid, vendorSku: zText(100).nullish(), price: zPrice, currency: z.enum(CURRENCIES).default('USD'),
  moq: zQty.nullish(), leadTimeDays: z.number().int().min(0).max(720).nullish(), validUntil: zDate.nullish(), preferred: z.boolean().default(false),
});
const lineIn = z.object({ productId: zUuid, qty: zQty, serials: z.array(zText(120)).max(5000).optional() });
const poLineSchema = z.object({ productId: zUuid.nullish(), code: zText(64).default(''), description: zText(500).nullish(), qty: zQty, unitPrice: zPrice, materialRequestLineId: zUuid.nullish() })
  .refine((l) => !!l.productId || !!l.code, 'a line needs a product or a code');
const poSchema = z.object({
  supplierId: zUuid, currency: z.enum(CURRENCIES).default('USD'), rateToSar: zMoney.optional(), incoterm: z.enum(INCOTERMS).nullish(), depositPercent: z.number().int().min(0).max(100).default(0),
  orderDate: zDate.nullish(), expectedOn: zDate.nullish(), projectId: zUuid.nullish(), notes: zText(5000).nullish(), lines: z.array(poLineSchema).min(1).max(500),
});
const fromRequestSchema = z.object({
  supplierId: zUuid.optional(), currency: z.enum(CURRENCIES).optional(), rateToSar: zMoney.optional(), incoterm: z.enum(INCOTERMS).nullish(), depositPercent: z.number().int().min(0).max(100).default(0), expectedOn: zDate.nullish(),
});
const receiptSchema = z.object({
  warehouseId: zUuid.nullish(), receivedOn: zDate.default(() => riyadhDate()), shipmentId: zUuid.nullish(), notes: zText(2000).nullish(),
  lines: z.array(z.object({ orderLineId: zUuid, qty: zQty, serialsText: z.string().max(2_000_000).nullish(), serials: z.array(z.object({ serial: zText(120).min(1), macs: z.array(z.string().max(40)).max(8).optional() })).max(5000).optional() })).min(1).max(500),
});
const transferSchema = z.object({ fromWarehouseId: zUuid, toWarehouseId: zUuid, projectId: zUuid.nullish(), notes: zText(2000).nullish(), lines: z.array(lineIn).min(1).max(500) });
const issueSchema = z.object({ fromWarehouseId: zUuid, projectId: zUuid, note: zText(500).nullish(), lines: z.array(lineIn).min(1).max(500) });
const returnSchema = z.object({ projectId: zUuid.nullish(), workOrderId: zUuid.nullish(), toWarehouseId: zUuid, note: zText(500).nullish(), lines: z.array(lineIn).min(1).max(500) })
  .refine((b) => !!b.projectId || !!b.workOrderId, 'a return comes from a project or a work order');
const shipmentSchema = z.object({
  supplierId: zUuid.nullish(), orderIds: z.array(zUuid).max(50).default([]), mode: z.enum(['sea', 'air', 'land', 'courier']).default('sea'), blNumber: zText(100).nullish(),
  containers: z.array(zText(30)).max(100).default([]), vessel: zText(200).nullish(), etd: zDate.nullish(), eta: zDate.nullish(), broker: zText(200).nullish(), notes: zText(5000).nullish(),
});
const declarationSchema = z.object({ fasahNumber: zText(60).min(1), fasahDate: zDate, cifSar: zPrice, dutyRatePercent: zPrice.optional(), dutySar: zPrice.optional(), importVatSar: zPrice.optional(), customsPayablePartyId: zUuid.nullish() });
const countLinesSchema = z.object({ lines: z.array(z.object({ productId: zUuid, counted: zQty0.nullable(), serials: z.array(zText(120)).max(5000).optional() })).max(5000) });
const billSchema = z.object({
  supplierId: zUuid, orderId: zUuid, supplierInvoiceNo: zText(100).min(1), billDate: zDate, currency: z.enum(CURRENCIES).default('SAR'), rateToSar: zMoney.optional(),
  lines: z.array(z.object({ orderLineId: zUuid, qty: zQty, unitPrice: zPrice })).min(1).max(500), vat: zPrice.default('0'), fileId: zUuid.nullish(), acceptException: z.boolean().optional(), sourceXmlFileId: zUuid.nullish(),
});

type LineIn = z.infer<typeof lineIn>;
type PoInput = z.infer<typeof poSchema>;

const stockQuery = zPage.extend({ warehouseId: zUuid.optional(), productId: zUuid.optional(), belowReorder: zBool.optional() });
const movesQuery = zPage.extend({ productId: zUuid.optional(), warehouseId: zUuid.optional(), projectId: zUuid.optional(), kind: z.string().optional(), from: zDate.optional(), to: zDate.optional() });
const poQuery = zPage.extend({ status: z.string().optional(), supplierId: zUuid.optional(), projectId: zUuid.optional() });

function whereAll(conds: (SQL | undefined)[]): SQL | undefined {
  const c = conds.filter((x): x is SQL => !!x);
  return c.length ? and(...c) : undefined;
}

/** `col in (ids)` that is simply false for an empty list. */
function inIds(col: Parameters<typeof inArray>[0], ids: string[]): SQL {
  return ids.length ? inArray(col, ids) : sql`false`;
}

/** Clamp a Decimal at zero. */
function atLeast0(v: ReturnType<typeof dec>) {
  return v.lt(0) ? dec(0) : v;
}

/** Moves without cost for users without purchase.cost.read. */
function moveOut<T extends { unitCostSar: string }>(actor: RequestActor, m: T): T | (Omit<T, 'unitCostSar'> & { unitCostSar: null }) {
  return canCost(actor) ? m : { ...m, unitCostSar: null };
}

async function loadProjectRow(tx: Tx, id: string) {
  if (!isUuid(id)) throw notFound('project');
  const [p] = await tx.select().from(project).where(eq(project.id, id));
  if (!p) throw notFound('project');
  return p;
}

/** Post a list of lines as moves (issue / return legs). */
async function postLines(tx: Tx, actor: RequestActor, lines: LineIn[], m: Omit<Parameters<typeof postMove>[2], 'productId' | 'qty' | 'serials'>) {
  const out = [];
  for (const l of lines) out.push(await postMove(tx, actor, { ...m, productId: l.productId, qty: l.qty, serials: l.serials }));
  return out;
}

@Controller('inventory')
export class InventoryController {
  // ───────────────────────── warehouses ─────────────────────────

  @Get('warehouses')
  @Perm('inventory.read')
  async warehouses(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ includeArchived: zBool.optional(), kind: z.string().optional() }))) q: { includeArchived?: boolean; kind?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      await ensureMainWarehouse(tx, actor.userId);
      const vis = await visibleWarehouseIds(tx, actor);
      const rows = await tx.select().from(warehouse).where(whereAll([
        q.includeArchived ? undefined : isNull(warehouse.archivedAt), q.kind ? eq(warehouse.kind, q.kind) : undefined, vis ? inIds(warehouse.id, vis) : undefined,
      ])).orderBy(asc(warehouse.kind), asc(warehouse.code));
      const names = await userNameMap(tx, rows.map((r) => r.custodianId));
      const prjIds = rows.map((r) => r.projectId).filter((x): x is string => !!x);
      const prj = prjIds.length ? await tx.select({ id: project.id, number: project.number, name: project.name }).from(project).where(inArray(project.id, prjIds)) : [];
      const totals = rows.length ? await tx.select({ warehouseId: stockBalance.warehouseId, products: sql<number>`(count(*) filter (where ${stockBalance.qty} <> 0))::int` }).from(stockBalance).where(inArray(stockBalance.warehouseId, rows.map((r) => r.id))).groupBy(stockBalance.warehouseId) : [];
      return rows.map((r) => ({
        ...r, kindLabel: WAREHOUSE_KIND_LABELS[r.kind as keyof typeof WAREHOUSE_KIND_LABELS] ?? null, custodianName: names.get(r.custodianId ?? '') ?? null,
        project: prj.find((p) => p.id === r.projectId) ?? null, productCount: totals.find((t) => t.warehouseId === r.id)?.products ?? 0,
      }));
    }, actor.userId);
  }

  @Post('warehouses')
  @Perm('inventory.write')
  async addWarehouse(@Actor() actor: RequestActor, @Body(new ZodPipe(warehouseSchema)) b: z.infer<typeof warehouseSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      await this.checkWarehouse(tx, b);
      const [dup] = await tx.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, b.code));
      if (dup) throw conflict(`warehouse code ${b.code} is taken`);
      const [row] = await tx.insert(warehouse).values({ code: b.code, nameAr: b.nameAr, nameEn: b.nameEn ?? null, kind: b.kind, custodianId: b.custodianId ?? null, projectId: b.projectId ?? null, branchId: b.branchId ?? null, createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'warehouse', row!.id, null, { code: b.code, kind: b.kind });
      return row;
    }, actor.userId);
  }

  @Put('warehouses/:id')
  @Perm('inventory.write')
  async updateWarehouse(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(warehouseSchema)) b: z.infer<typeof warehouseSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadWarehouse(tx, id);
      await this.checkWarehouse(tx, b);
      if (before.code === MAIN_CODE && (b.code !== MAIN_CODE || b.kind !== 'main' || b.archived)) throw badRequest('the main store keeps its code and kind');
      if (b.archived && !before.archivedAt) {
        const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(stockBalance).where(and(eq(stockBalance.warehouseId, id), ne(stockBalance.qty, '0')))) as [{ n: number }];
        if (n > 0) throw conflict('the warehouse still holds stock — transfer it first');
      }
      if (b.code !== before.code) {
        const [dup] = await tx.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.code, b.code), ne(warehouse.id, id)));
        if (dup) throw conflict(`warehouse code ${b.code} is taken`);
      }
      const values = { code: b.code, nameAr: b.nameAr, nameEn: b.nameEn ?? null, kind: b.kind, custodianId: b.custodianId ?? null, projectId: b.projectId ?? null, branchId: b.branchId ?? null, archivedAt: b.archived ? before.archivedAt ?? new Date() : null };
      const [row] = await tx.update(warehouse).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(warehouse.id, id)).returning();
      const d = diff(before as Record<string, unknown>, values);
      if (d) await audit(tx, actor, 'update', 'warehouse', id, d.before, d.after);
      return row;
    }, actor.userId);
  }

  private async checkWarehouse(tx: Tx, b: z.infer<typeof warehouseSchema>) {
    if (b.kind === 'van' && !b.custodianId) throw badRequest('a van needs its technician (custodianId)');
    if (b.kind === 'site' && !b.projectId) throw badRequest('a site warehouse needs its project (projectId)');
    if (b.custodianId) {
      const [u] = await tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.id, b.custodianId));
      if (!u) throw badRequest('unknown custodian');
    }
    if (b.projectId) await loadProjectRow(tx, b.projectId);
  }

  // ───────────────────────── product inventory settings ─────────────────────────

  /** Inventory fields of a product (serial tracking, radio → CST, HS code, origin, reorder point, weight, warranty). */
  @Put('products/:productId/settings')
  @Perm('inventory.write', 'product.write', 'purchase.write')
  async productSettings(@Actor() actor: RequestActor, @Param('productId') productId: string, @Body(new ZodPipe(productSettingsSchema)) b: z.infer<typeof productSettingsSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadProduct(tx, productId);
      const values = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as Partial<typeof product.$inferInsert>;
      if (b.serialTracked !== undefined && b.serialTracked !== before.serialTracked) {
        const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(stockBalance).where(and(eq(stockBalance.productId, productId), ne(stockBalance.qty, '0')))) as [{ n: number }];
        if (n > 0) throw conflict('serial tracking can only change while the product has no stock');
      }
      const [row] = await tx.update(product).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(product.id, productId)).returning();
      const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'product', productId, d.before, d.after);
      const r = row!;
      return { id: r.id, code: r.code, serialTracked: r.serialTracked, radio: r.radio, hsCode: r.hsCode, originCountry: r.originCountry, reorderLevel: r.reorderLevel, reorderQty: r.reorderQty, weightKg: r.weightKg, warrantyMonths: r.warrantyMonths };
    }, actor.userId);
  }

  // ───────────────────────── stock ─────────────────────────

  /** Stock per product: on hand by warehouse, reserved, incoming, projected; avg cost/value with cost permission. */
  @Get('stock')
  @Perm('inventory.read')
  async stock(@Actor() actor: RequestActor, @Query(new ZodPipe(stockQuery)) q: z.infer<typeof stockQuery>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const vis = await visibleWarehouseIds(tx, actor);
      let whIds = vis;
      if (q.warehouseId) {
        if (vis && !vis.includes(q.warehouseId)) throw forbidden('not your warehouse');
        whIds = [q.warehouseId];
      }
      const hasStock = (ids: string[] | null) => sql`exists (select 1 from stock_balance b where b.product_id = ${product.id} and (b.qty <> 0 or b.reserved_qty <> 0)${
        ids ? (ids.length ? sql` and b.warehouse_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql` and false`) : sql``})`;
      const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = whereAll([
        isNull(product.archivedAt),
        q.productId ? eq(product.id, q.productId) : undefined,
        term ? or(ilike(product.code, term), ilike(product.searchText, term), ilike(product.nameAr, term)) : undefined,
        whIds ? hasStock(whIds) : or(sql`${product.type} not in ('service', 'labor', 'non_stock', 'kit')`, hasStock(null)),
        q.belowReorder ? sql`${product.reorderLevel} is not null` : undefined,
      ]);
      const cost = canCost(actor);
      const build = async (prods: (typeof product.$inferSelect)[]) => {
        const ids = prods.map((p) => p.id);
        const qs = await quantities(tx, ids, whIds);
        const bal = ids.length ? await tx.select({ b: stockBalance, code: warehouse.code, nameAr: warehouse.nameAr, kind: warehouse.kind }).from(stockBalance).innerJoin(warehouse, eq(warehouse.id, stockBalance.warehouseId))
          .where(whereAll([inArray(stockBalance.productId, ids), or(ne(stockBalance.qty, '0'), ne(stockBalance.reservedQty, '0')), whIds ? inIds(stockBalance.warehouseId, whIds) : undefined])).orderBy(asc(warehouse.code)) : [];
        return prods.map((p) => {
          const x = qs.get(p.id)!;
          const projected = projectedQty(x.onHand, x.reserved, x.incoming);
          return {
            productId: p.id, code: p.code, nameAr: p.nameAr, nameEn: p.nameEn, uom: p.uom, serialTracked: p.serialTracked, reorderLevel: p.reorderLevel, reorderQty: p.reorderQty,
            byWarehouse: bal.filter((b) => b.b.productId === p.id).map((b) => ({ warehouseId: b.b.warehouseId, code: b.code, nameAr: b.nameAr, kind: b.kind, qty: b.b.qty, reserved: b.b.reservedQty })),
            onHand: x.onHand.toString(), reserved: x.reserved.toString(), incoming: x.incoming.toString(), projected,
            avgCost: cost ? p.avgCostSar : null, value: cost ? halalasToFixed(toHalalas(x.onHand.times(p.avgCostSar ?? '0'))) : null,
            belowReorder: p.reorderLevel !== null && dec(projected).lt(p.reorderLevel),
          };
        });
      };
      if (q.belowReorder) {
        const all = await build(await tx.select().from(product).where(where).orderBy(asc(product.code)));
        const rows = all.filter((r) => r.belowReorder);
        return { rows: rows.slice(q.offset, q.offset + q.limit), total: rows.length };
      }
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(product).where(where)) as [{ n: number }];
      const prods = await tx.select().from(product).where(where).orderBy(asc(product.code)).limit(q.limit).offset(q.offset);
      return { rows: await build(prods), total: n };
    }, actor.userId);
  }

  /** One product: balances, serials in stock, last moves, reservations, open POs, compliance. */
  @Get('stock/:productId')
  @Perm('inventory.read')
  async stockOne(@Actor() actor: RequestActor, @Param('productId') productId: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProduct(tx, productId);
      const vis = await visibleWarehouseIds(tx, actor);
      const cost = canCost(actor);
      const balances = await tx.select({ b: stockBalance, code: warehouse.code, nameAr: warehouse.nameAr, kind: warehouse.kind }).from(stockBalance).innerJoin(warehouse, eq(warehouse.id, stockBalance.warehouseId))
        .where(whereAll([eq(stockBalance.productId, p.id), vis ? inIds(stockBalance.warehouseId, vis) : undefined])).orderBy(asc(warehouse.code));
      const serials = await tx.select({ s: serialNumber, warehouseCode: warehouse.code }).from(serialNumber).leftJoin(warehouse, eq(warehouse.id, serialNumber.warehouseId))
        .where(whereAll([eq(serialNumber.productId, p.id), inArray(serialNumber.status, ['in_stock', 'reserved', 'in_transit']), vis ? inIds(serialNumber.warehouseId, vis) : undefined]))
        .orderBy(asc(serialNumber.serial)).limit(1000);
      const moves = await tx.select().from(stockMove).where(whereAll([eq(stockMove.productId, p.id), vis ? or(inIds(stockMove.fromWarehouseId, vis), inIds(stockMove.toWarehouseId, vis)) : undefined]))
        .orderBy(desc(stockMove.postedAt)).limit(50);
      const reservations = vis ? [] : await tx.select({ r: stockReservation, projectNumber: project.number, projectName: project.name, warehouseCode: warehouse.code }).from(stockReservation)
        .leftJoin(project, eq(project.id, stockReservation.projectId)).innerJoin(warehouse, eq(warehouse.id, stockReservation.warehouseId))
        .where(and(eq(stockReservation.productId, p.id), eq(stockReservation.status, 'active'))).orderBy(asc(stockReservation.createdAt));
      const openPos = vis || !actor.grants['purchase.read'] ? [] : await tx.select({ l: purchaseOrderLine, number: purchaseOrder.number, status: purchaseOrder.status, expectedOn: purchaseOrder.expectedOn, supplierName: party.nameAr })
        .from(purchaseOrderLine).innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId)).innerJoin(party, eq(party.id, purchaseOrder.supplierId))
        .where(and(eq(purchaseOrderLine.productId, p.id), inArray(purchaseOrder.status, ['draft', 'pending_approval', 'approved', 'sent', 'partially_received'])));
      const certs = await tx.select().from(complianceCert).where(eq(complianceCert.productId, p.id)).orderBy(asc(complianceCert.kind));
      const compliance = (await complianceFor(tx, [p.id])).get(p.id) ?? null;
      const qs = (await quantities(tx, [p.id], vis)).get(p.id)!;
      return {
        product: { id: p.id, code: p.code, nameAr: p.nameAr, nameEn: p.nameEn, uom: p.uom, type: p.type, serialTracked: p.serialTracked, radio: p.radio, hsCode: p.hsCode, originCountry: p.originCountry, reorderLevel: p.reorderLevel, reorderQty: p.reorderQty, warrantyMonths: p.warrantyMonths, avgCostSar: cost ? p.avgCostSar : null },
        onHand: qs.onHand.toString(), reserved: qs.reserved.toString(), incoming: qs.incoming.toString(), projected: projectedQty(qs.onHand, qs.reserved, qs.incoming),
        value: cost ? halalasToFixed(toHalalas(qs.onHand.times(p.avgCostSar ?? '0'))) : null,
        balances: balances.map((b) => ({ warehouseId: b.b.warehouseId, code: b.code, nameAr: b.nameAr, kind: b.kind, qty: b.b.qty, reserved: b.b.reservedQty })),
        serials: serials.map((s) => ({ id: s.s.id, serial: s.s.serial, macs: s.s.macs, status: s.s.status, warehouseId: s.s.warehouseId, warehouseCode: s.warehouseCode, supplierWarrantyEnd: s.s.supplierWarrantyEnd })),
        moves: moves.map((m) => moveOut(actor, m)),
        reservations: reservations.map((r) => ({ ...r.r, projectNumber: r.projectNumber, projectName: r.projectName, warehouseCode: r.warehouseCode })),
        openPurchaseOrders: openPos.map((o) => ({ orderId: o.l.orderId, number: o.number, status: o.status, expectedOn: o.expectedOn, supplierName: o.supplierName, qty: o.l.qty, receivedQty: o.l.receivedQty, unitPrice: cost ? o.l.unitPrice : null })),
        certificates: certs,
        compliance,
      };
    }, actor.userId);
  }

  /** Stock ledger (I3). */
  @Get('moves')
  @Perm('inventory.read')
  async moves(@Actor() actor: RequestActor, @Query(new ZodPipe(movesQuery)) q: z.infer<typeof movesQuery>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const vis = await visibleWarehouseIds(tx, actor);
      if (q.warehouseId && vis && !vis.includes(q.warehouseId)) throw forbidden('not your warehouse');
      const where = whereAll([
        q.productId ? eq(stockMove.productId, q.productId) : undefined,
        q.warehouseId ? or(eq(stockMove.fromWarehouseId, q.warehouseId), eq(stockMove.toWarehouseId, q.warehouseId)) : undefined,
        q.projectId ? eq(stockMove.projectId, q.projectId) : undefined,
        q.kind ? inArray(stockMove.kind, q.kind.split(',')) : undefined,
        q.from ? gte(stockMove.postedAt, new Date(`${q.from}T00:00:00+03:00`)) : undefined,
        q.to ? lt(stockMove.postedAt, new Date(new Date(`${q.to}T00:00:00+03:00`).getTime() + 86_400_000)) : undefined,
        vis ? or(inIds(stockMove.fromWarehouseId, vis), inIds(stockMove.toWarehouseId, vis)) : undefined,
      ]);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(stockMove).where(where)) as [{ n: number }];
      const rows = await tx.select({ m: stockMove, code: product.code, nameAr: product.nameAr }).from(stockMove).innerJoin(product, eq(product.id, stockMove.productId))
        .where(where).orderBy(desc(stockMove.postedAt)).limit(q.limit).offset(q.offset);
      const whIds = [...new Set(rows.flatMap((r) => [r.m.fromWarehouseId, r.m.toWarehouseId]).filter((x): x is string => !!x))];
      const whs = whIds.length ? await tx.select({ id: warehouse.id, code: warehouse.code }).from(warehouse).where(inArray(warehouse.id, whIds)) : [];
      const code = (id: string | null) => (id ? whs.find((w) => w.id === id)?.code ?? null : null);
      const names = await userNameMap(tx, rows.map((r) => r.m.postedBy));
      return {
        rows: rows.map((r) => ({ ...moveOut(actor, r.m), productCode: r.code, productName: r.nameAr, fromCode: code(r.m.fromWarehouseId), toCode: code(r.m.toWarehouseId), postedByName: names.get(r.m.postedBy ?? '') ?? null })),
        total: n,
      };
    }, actor.userId);
  }

  /** Serial traceability (INV-52): serial / MAC → supplier, PO, receipt → warehouse / project → installed asset. */
  @Get('serials')
  @Perm('inventory.read')
  async serials(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ productId: zUuid.optional(), status: z.string().optional() }))) q: { q?: string; limit: number; offset: number; productId?: string; status?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const vis = await visibleWarehouseIds(tx, actor);
      const term = q.q?.trim() ? q.q.trim().toUpperCase() : null;
      const macTerm = term ? term.replace(/[^0-9A-F]/g, '') : '';
      const where = whereAll([
        term ? or(ilike(serialNumber.serial, `%${term}%`), macTerm.length >= 4 ? sql`replace(${serialNumber.macs}::text, ':', '') ilike ${`%${macTerm}%`}` : undefined) : undefined,
        q.productId ? eq(serialNumber.productId, q.productId) : undefined,
        q.status ? inArray(serialNumber.status, q.status.split(',')) : undefined,
        vis ? inIds(serialNumber.warehouseId, vis) : undefined,
      ]);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(serialNumber).where(where)) as [{ n: number }];
      const rows = await tx.select({ s: serialNumber, code: product.code, nameAr: product.nameAr, warehouseCode: warehouse.code, supplierName: party.nameAr, projectNumber: project.number, projectName: project.name })
        .from(serialNumber).innerJoin(product, eq(product.id, serialNumber.productId)).leftJoin(warehouse, eq(warehouse.id, serialNumber.warehouseId))
        .leftJoin(party, eq(party.id, serialNumber.supplierId)).leftJoin(project, eq(project.id, serialNumber.projectId))
        .where(where).orderBy(asc(serialNumber.serial)).limit(q.limit).offset(q.offset);
      const ids = (k: 'purchaseOrderId' | 'receiptId' | 'installedAssetId') => [...new Set(rows.map((r) => r.s[k]).filter((x): x is string => !!x))];
      const poIds = ids('purchaseOrderId');
      const grIds = ids('receiptId');
      const assetIds = ids('installedAssetId');
      const pos = poIds.length ? await tx.select({ id: purchaseOrder.id, number: purchaseOrder.number }).from(purchaseOrder).where(inArray(purchaseOrder.id, poIds)) : [];
      const grs = grIds.length ? await tx.select({ id: goodsReceipt.id, number: goodsReceipt.number, receivedOn: goodsReceipt.receivedOn }).from(goodsReceipt).where(inArray(goodsReceipt.id, grIds)) : [];
      const assets = assetIds.length ? await tx.select({ id: installedAsset.id, code: installedAsset.code, siteId: installedAsset.siteId, locationId: installedAsset.locationId, projectId: installedAsset.projectId, installedOn: installedAsset.installedOn, status: installedAsset.status, workOrderId: installedAsset.workOrderId })
        .from(installedAsset).where(inArray(installedAsset.id, assetIds)) : [];
      return {
        rows: rows.map((r) => ({
          ...r.s, productCode: r.code, productName: r.nameAr, warehouseCode: r.warehouseCode, supplierName: r.supplierName,
          project: r.s.projectId ? { id: r.s.projectId, number: r.projectNumber, name: r.projectName } : null,
          purchaseOrder: pos.find((p) => p.id === r.s.purchaseOrderId) ?? null,
          receipt: grs.find((g) => g.id === r.s.receiptId) ?? null,
          installedAsset: assets.find((a) => a.id === r.s.installedAssetId) ?? null,
        })),
        total: n,
      };
    }, actor.userId);
  }

  /** Projected quantity per product for the quote catalog panel (INV-22). */
  @Get('availability')
  @Perm('inventory.read', 'product.read', 'quote.read')
  async availability(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ productIds: z.string().max(20_000) }))) q: { productIds: string }) {
    const ids = [...new Set(q.productIds.split(',').map((s) => s.trim()).filter(isUuid))].slice(0, 500);
    return tenantTx(actor.tenantId, async (tx) => {
      const qs = await quantities(tx, ids, null);
      return Object.fromEntries([...qs].map(([id, x]) => [id, { onHand: x.onHand.toString(), reserved: x.reserved.toString(), incoming: x.incoming.toString(), projected: projectedQty(x.onHand, x.reserved, x.incoming), available: x.onHand.minus(x.reserved).toString() }]));
    }, actor.userId);
  }

  // ───────────────────────── compliance (INV-08) ─────────────────────────

  @Get('products/:productId/certificates')
  @Perm('inventory.read', 'purchase.read', 'product.read')
  async certificates(@Actor() actor: RequestActor, @Param('productId') productId: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProduct(tx, productId);
      const certs = await tx.select().from(complianceCert).where(eq(complianceCert.productId, p.id)).orderBy(asc(complianceCert.kind), desc(complianceCert.expiresOn));
      return { productId: p.id, code: p.code, radio: p.radio, certificates: certs.map((c) => ({ ...c, label: CERT_LABELS[c.kind as keyof typeof CERT_LABELS] ?? null })), status: (await complianceFor(tx, [p.id])).get(p.id) ?? null };
    }, actor.userId);
  }

  @Post('products/:productId/certificates')
  @Perm('inventory.write', 'purchase.write', 'product.write')
  async addCertificate(@Actor() actor: RequestActor, @Param('productId') productId: string, @Body(new ZodPipe(certSchema)) b: z.infer<typeof certSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProduct(tx, productId);
      if (b.issuedOn && b.expiresOn && b.expiresOn < b.issuedOn) throw badRequest('expires before it was issued');
      const [row] = await tx.insert(complianceCert).values({ productId: p.id, kind: b.kind, number: b.number, issuedOn: b.issuedOn ?? null, expiresOn: b.expiresOn ?? null, fileId: b.fileId ?? null, notes: b.notes ?? null, createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'compliance_cert', row!.id, null, { product: p.code, kind: b.kind, number: b.number, expiresOn: b.expiresOn ?? null });
      return { ...row!, status: (await complianceFor(tx, [p.id])).get(p.id) ?? null };
    }, actor.userId);
  }

  @Delete('certificates/:id')
  @Perm('inventory.write', 'purchase.write', 'product.write')
  async deleteCertificate(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (!isUuid(id)) throw notFound('certificate');
      const [c] = await tx.select().from(complianceCert).where(eq(complianceCert.id, id));
      if (!c) throw notFound('certificate');
      await tx.delete(complianceCert).where(eq(complianceCert.id, id));
      await audit(tx, actor, 'delete', 'compliance_cert', id, { kind: c.kind, number: c.number, productId: c.productId }, null);
      return { ok: true };
    }, actor.userId);
  }

  /** Stock models with compliance problems (block = missing/expired, warn = expiring within 30 days). */
  @Get('compliance')
  @Perm('inventory.read', 'purchase.read')
  async compliance(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ status: z.enum(['block', 'warn']).optional() }))) q: { status?: 'block' | 'warn' }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const prods = await tx.select({ id: product.id, code: product.code, nameAr: product.nameAr, radio: product.radio }).from(product)
        .where(and(isNull(product.archivedAt), eq(product.status, 'active'), sql`${product.type} not in ('service', 'labor', 'non_stock', 'kit')`)).orderBy(asc(product.code));
      const st = await complianceFor(tx, prods.map((p) => p.id));
      return prods.map((p) => ({ ...p, ...st.get(p.id)! }))
        .filter((r) => r.issues.length && (!q.status || (q.status === 'block' ? !r.ok : r.ok)));
    }, actor.userId);
  }

  // ───────────────────────── supplier catalogue (INV-04) ─────────────────────────

  @Get('supplier-items')
  @Perm('purchase.read')
  async supplierItems(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ supplierId: zUuid.optional(), productId: zUuid.optional() }))) q: { supplierId?: string; productId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({ i: supplierItem, supplierName: party.nameAr, code: product.code, nameAr: product.nameAr }).from(supplierItem)
        .innerJoin(party, eq(party.id, supplierItem.supplierId)).innerJoin(product, eq(product.id, supplierItem.productId))
        .where(whereAll([q.supplierId ? eq(supplierItem.supplierId, q.supplierId) : undefined, q.productId ? eq(supplierItem.productId, q.productId) : undefined]))
        .orderBy(asc(product.code), desc(supplierItem.preferred));
      const cost = canCost(actor);
      return rows.map((r) => ({ ...r.i, price: cost ? r.i.price : null, supplierName: r.supplierName, productCode: r.code, productName: r.nameAr }));
    }, actor.userId);
  }

  @Post('supplier-items')
  @Perm('purchase.write')
  async addSupplierItem(@Actor() actor: RequestActor, @Body(new ZodPipe(supplierItemSchema)) b: z.infer<typeof supplierItemSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadSupplier(tx, b.supplierId);
      await loadProduct(tx, b.productId);
      const [dup] = await tx.select({ id: supplierItem.id }).from(supplierItem).where(and(eq(supplierItem.supplierId, b.supplierId), eq(supplierItem.productId, b.productId)));
      if (dup) throw conflict('this supplier already lists this product — update it instead');
      if (b.preferred) await tx.update(supplierItem).set({ preferred: false }).where(eq(supplierItem.productId, b.productId));
      const [row] = await tx.insert(supplierItem).values({ ...this.itemValues(b), createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'supplier_item', row!.id, null, { supplierId: b.supplierId, productId: b.productId, price: b.price, currency: b.currency });
      return row;
    }, actor.userId);
  }

  @Put('supplier-items/:id')
  @Perm('purchase.write')
  async updateSupplierItem(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(supplierItemSchema)) b: z.infer<typeof supplierItemSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (!isUuid(id)) throw notFound('supplier item');
      const [before] = await tx.select().from(supplierItem).where(eq(supplierItem.id, id));
      if (!before) throw notFound('supplier item');
      if (before.supplierId !== b.supplierId || before.productId !== b.productId) throw badRequest('supplier and product cannot change — add a new entry');
      if (b.preferred) await tx.update(supplierItem).set({ preferred: false }).where(and(eq(supplierItem.productId, b.productId), ne(supplierItem.id, id)));
      const values = this.itemValues(b);
      const [row] = await tx.update(supplierItem).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(supplierItem.id, id)).returning();
      const d = diff(before as Record<string, unknown>, values);
      if (d) await audit(tx, actor, 'update', 'supplier_item', id, d.before, d.after);
      return row;
    }, actor.userId);
  }

  private itemValues(b: z.infer<typeof supplierItemSchema>) {
    return { supplierId: b.supplierId, productId: b.productId, vendorSku: b.vendorSku ?? null, price: b.price, currency: b.currency, moq: b.moq ?? null, leadTimeDays: b.leadTimeDays ?? null, validUntil: b.validUntil ?? null, preferred: b.preferred };
  }

  // ───────────────────────── material requests (INV-60) & reservations (INV-21) ─────────────────────────

  /**
   * Explode the project's contract BOQ (kits → components; INS / labour / services skipped), net off
   * what is already reserved, consumed or ordered for the project, reserve free stock (project site
   * warehouse first, then MAIN) and create a material request with the shortage (status `closed` when
   * nothing is short). One open (draft/approved) request per project → 409.
   */
  @Post('material-requests/from-project/:projectId')
  @Perm('purchase.write', 'inventory.write')
  async mrFromProject(@Actor() actor: RequestActor, @Param('projectId') projectId: string, @Body(new ZodPipe(z.object({ neededBy: zDate.nullish(), notes: zText(2000).nullish() }).default({}))) b: { neededBy?: string | null; notes?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const prj = await loadProjectRow(tx, projectId);
      if (!prj.contractId) throw badRequest('the project has no contract — nothing to plan from');
      const [open] = await tx.select({ id: materialRequest.id, number: materialRequest.number }).from(materialRequest)
        .where(and(eq(materialRequest.projectId, prj.id), inArray(materialRequest.status, ['draft', 'approved']))).limit(1);
      if (open) throw conflict(`material request ${open.number} is still open for this project`);
      const { lines, unmatched } = await contractBoq(tx, prj.contractId);
      const boq = mergeBoq(lines);
      // net off what the project already holds, used or has on order
      const held = await tx.select({ productId: stockReservation.productId, q: sql<string>`sum(${stockReservation.qty})::text` }).from(stockReservation)
        .where(and(eq(stockReservation.projectId, prj.id), inArray(stockReservation.status, ['active', 'consumed']))).groupBy(stockReservation.productId);
      const ordered = await tx.select({ productId: materialRequestLine.productId, q: sql<string>`sum(${materialRequestLine.orderedQty})::text` }).from(materialRequestLine)
        .innerJoin(materialRequest, eq(materialRequest.id, materialRequestLine.requestId)).where(and(eq(materialRequest.projectId, prj.id), inArray(materialRequest.status, ['ordered', 'closed']))).groupBy(materialRequestLine.productId);
      const received = await tx.select({ productId: purchaseOrderLine.productId, q: sql<string>`sum(${purchaseOrderLine.receivedQty})::text` }).from(purchaseOrderLine)
        .innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId))
        .where(and(eq(purchaseOrder.projectId, prj.id), sql`${purchaseOrderLine.materialRequestLineId} is not null`)).groupBy(purchaseOrderLine.productId);
      // ordered-but-received quantities are already in `held` (receipts reserve for the project) → count only the open part
      const onOrder = (pid: string) => atLeast0(dec(ordered.find((o) => o.productId === pid)?.q ?? '0').minus(received.find((r) => r.productId === pid)?.q ?? '0'));
      const demand = [...boq.values()].map((l) => ({
        productId: l.productId, code: l.code, description: l.description,
        qty: l.qty.minus(held.find((h) => h.productId === l.productId)?.q ?? '0').minus(onOrder(l.productId)).toString(),
      }));
      const main = await ensureMainWarehouse(tx, actor.userId);
      const sites = await tx.select().from(warehouse).where(and(eq(warehouse.projectId, prj.id), isNull(warehouse.archivedAt)));
      const whOrder = [...sites.map((s) => s.id), main.id];
      const ids = demand.map((d) => d.productId);
      const bal = ids.length ? await tx.select().from(stockBalance).where(and(inArray(stockBalance.productId, ids), inArray(stockBalance.warehouseId, whOrder))) : [];
      const free = (pid: string, wh: string) => { const r = bal.find((x) => x.productId === pid && x.warehouseId === wh); return atLeast0(r ? dec(r.qty).minus(r.reservedQty) : dec(0)); };
      const available = Object.fromEntries(ids.map((pid) => [pid, whOrder.reduce((s, wh) => s.plus(free(pid, wh)), dec(0)).toString()]));
      const plan = planMaterials(demand, available);
      const reserved = [];
      for (const r of plan.reserve) {
        let left = dec(r.qty);
        for (const wh of whOrder) {
          if (left.lte(0)) break;
          const f = free(r.productId, wh);
          const take = f.lt(left) ? f : left;
          if (take.lte(0)) continue;
          const row = await reserve(tx, actor.userId, { projectId: prj.id, contractId: prj.contractId, productId: r.productId, warehouseId: wh, qty: take });
          if (row) reserved.push({ ...row, code: r.code });
          left = left.minus(take);
        }
      }
      const { number } = await nextNumber(tx, 'material_request');
      const [mr] = await tx.insert(materialRequest).values({ number, projectId: prj.id, contractId: prj.contractId, status: plan.shortage.length ? 'draft' : 'closed', neededBy: b.neededBy ?? null, notes: b.notes ?? null, createdBy: actor.userId, updatedBy: actor.userId }).returning();
      if (plan.shortage.length) {
        await tx.insert(materialRequestLine).values(plan.shortage.map((s) => ({ requestId: mr!.id, productId: s.productId, code: s.code, description: s.description, qty: s.qty, createdBy: actor.userId, updatedBy: actor.userId })));
      }
      await audit(tx, actor, 'create', 'material_request', mr!.id, null, { number, project: prj.number, reserved: plan.reserve.length, shortage: plan.shortage.length });
      await emit(tx, 'material_request', mr!.id, 'material_request.created', { number, project: prj.number, shortage: plan.shortage.length });
      return { ...(await this.mrView(tx, mr!.id)), reserved, unmatched };
    }, actor.userId);
  }

  @Get('material-requests')
  @Perm('purchase.read', 'inventory.read')
  async mrList(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.string().optional(), projectId: zUuid.optional() }))) q: { limit: number; offset: number; status?: string; projectId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      this.assertStoreOrPurchasing(actor);
      const where = whereAll([q.status ? inArray(materialRequest.status, q.status.split(',')) : undefined, q.projectId ? eq(materialRequest.projectId, q.projectId) : undefined]);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(materialRequest).where(where)) as [{ n: number }];
      const rows = await tx.select({ m: materialRequest, projectNumber: project.number, projectName: project.name, lines: sql<number>`(select count(*)::int from material_request_line l where l.request_id = ${materialRequest.id})` })
        .from(materialRequest).leftJoin(project, eq(project.id, materialRequest.projectId)).where(where).orderBy(desc(materialRequest.createdAt)).limit(q.limit).offset(q.offset);
      return { rows: rows.map((r) => ({ ...r.m, projectNumber: r.projectNumber, projectName: r.projectName, lineCount: r.lines })), total: n };
    }, actor.userId);
  }

  @Get('material-requests/:id')
  @Perm('purchase.read', 'inventory.read')
  async mrGet(@Actor() actor: RequestActor, @Param('id') id: string) {
    this.assertStoreOrPurchasing(actor);
    return tenantTx(actor.tenantId, (tx) => this.mrView(tx, id), actor.userId);
  }

  @Post('material-requests/:id/approve')
  @Perm('purchase.approve')
  async mrApprove(@Actor() actor: RequestActor, @Param('id') id: string) {
    return this.mrStatus(actor, id, ['draft'], 'approved');
  }

  @Post('material-requests/:id/cancel')
  @Perm('purchase.write', 'inventory.write')
  async mrCancel(@Actor() actor: RequestActor, @Param('id') id: string) {
    return this.mrStatus(actor, id, ['draft', 'approved'], 'cancelled');
  }

  /** Technicians (inventory.read own) see their vans, not the purchasing pipeline. */
  private assertStoreOrPurchasing(actor: RequestActor) {
    if (actor.grants['inventory.read'] === 'own' && !actor.grants['purchase.read']) throw forbidden('material requests are for the store and purchasing');
  }

  private async mrStatus(actor: RequestActor, id: string, from: string[], to: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const mr = await this.loadMr(tx, id);
      if (!from.includes(mr.status)) throw badRequest(`a ${mr.status} material request cannot become ${to}`);
      if (to === 'cancelled') {
        const lines = await tx.select().from(materialRequestLine).where(eq(materialRequestLine.requestId, id));
        if (lines.some((l) => dec(l.orderedQty).gt(0))) throw badRequest('purchase orders were raised from this request — cancel them first');
      }
      await tx.update(materialRequest).set({ status: to, updatedAt: new Date(), updatedBy: actor.userId, version: mr.version + 1 }).where(eq(materialRequest.id, id));
      await audit(tx, actor, `status_${to}`, 'material_request', id, { status: mr.status }, { status: to });
      return this.mrView(tx, id);
    }, actor.userId);
  }

  private async loadMr(tx: Tx, id: string) {
    if (!isUuid(id)) throw notFound('material request');
    const [mr] = await tx.select().from(materialRequest).where(eq(materialRequest.id, id));
    if (!mr) throw notFound('material request');
    return mr;
  }

  private async mrView(tx: Tx, id: string) {
    const mr = await this.loadMr(tx, id);
    const lines = await tx.select().from(materialRequestLine).where(eq(materialRequestLine.requestId, id)).orderBy(asc(materialRequestLine.code));
    const [prj] = mr.projectId ? await tx.select({ id: project.id, number: project.number, name: project.name }).from(project).where(eq(project.id, mr.projectId)) : [];
    const pos = await tx.selectDistinct({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status }).from(purchaseOrder)
      .leftJoin(purchaseOrderLine, eq(purchaseOrderLine.orderId, purchaseOrder.id))
      .where(or(eq(purchaseOrder.materialRequestId, id), lines.length ? inArray(purchaseOrderLine.materialRequestLineId, lines.map((l) => l.id)) : sql`false`));
    const reservations = mr.projectId ? await tx.select({ r: stockReservation, code: product.code, warehouseCode: warehouse.code }).from(stockReservation).innerJoin(product, eq(product.id, stockReservation.productId))
      .innerJoin(warehouse, eq(warehouse.id, stockReservation.warehouseId)).where(and(eq(stockReservation.projectId, mr.projectId), eq(stockReservation.status, 'active'))) : [];
    return {
      ...mr, project: prj ?? null,
      lines: lines.map((l) => ({ ...l, openQty: fq(atLeast0(dec(l.qty).minus(l.orderedQty))) })),
      purchaseOrders: pos,
      reservations: reservations.map((r) => ({ ...r.r, code: r.code, warehouseCode: r.warehouseCode })),
    };
  }

  @Get('reservations')
  @Perm('inventory.read', 'purchase.read')
  async reservations(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ projectId: zUuid.optional(), productId: zUuid.optional(), status: z.string().default('active') }))) q: { projectId?: string; productId?: string; status: string }) {
    this.assertStoreOrPurchasing(actor);
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({ r: stockReservation, code: product.code, warehouseCode: warehouse.code, projectNumber: project.number }).from(stockReservation)
        .innerJoin(product, eq(product.id, stockReservation.productId)).innerJoin(warehouse, eq(warehouse.id, stockReservation.warehouseId)).leftJoin(project, eq(project.id, stockReservation.projectId))
        .where(whereAll([q.projectId ? eq(stockReservation.projectId, q.projectId) : undefined, q.productId ? eq(stockReservation.productId, q.productId) : undefined, q.status !== 'all' ? inArray(stockReservation.status, q.status.split(',')) : undefined]))
        .orderBy(asc(product.code));
      return rows.map((r) => ({ ...r.r, code: r.code, warehouseCode: r.warehouseCode, projectNumber: r.projectNumber }));
    }, actor.userId);
  }

  @Post('reservations/:id/release')
  @Perm('inventory.write', 'purchase.write')
  async release(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (!isUuid(id)) throw notFound('reservation');
      const [r] = await tx.select().from(stockReservation).where(eq(stockReservation.id, id));
      if (!r) throw notFound('reservation');
      if (r.status !== 'active') throw badRequest(`the reservation is already ${r.status}`);
      await tx.update(stockReservation).set({ status: 'released', updatedAt: new Date(), updatedBy: actor.userId, version: r.version + 1 }).where(eq(stockReservation.id, id));
      await syncReserved(tx, r.warehouseId, r.productId);
      await audit(tx, actor, 'release', 'stock_reservation', id, { status: 'active' }, { status: 'released', qty: r.qty });
      return { ...r, status: 'released' };
    }, actor.userId);
  }

  // ───────────────────────── purchase orders (INV-61..64) ─────────────────────────

  @Get('purchase-orders')
  @Perm('purchase.read')
  async poList(@Actor() actor: RequestActor, @Query(new ZodPipe(poQuery)) q: z.infer<typeof poQuery>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = whereAll([
        scopeFilter(actor, 'purchase.read', { owner: purchaseOrder.ownerId }),
        q.status ? inArray(purchaseOrder.status, q.status.split(',')) : undefined,
        q.supplierId ? eq(purchaseOrder.supplierId, q.supplierId) : undefined,
        q.projectId ? eq(purchaseOrder.projectId, q.projectId) : undefined,
        term ? or(ilike(purchaseOrder.number, term), ilike(party.nameAr, term)) : undefined,
      ]);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(purchaseOrder).innerJoin(party, eq(party.id, purchaseOrder.supplierId)).where(where)) as [{ n: number }];
      const rows = await tx.select({ po: purchaseOrder, supplierName: party.nameAr, projectNumber: project.number }).from(purchaseOrder).innerJoin(party, eq(party.id, purchaseOrder.supplierId))
        .leftJoin(project, eq(project.id, purchaseOrder.projectId)).where(where).orderBy(desc(purchaseOrder.createdAt)).limit(q.limit).offset(q.offset);
      const cost = canCost(actor);
      return {
        rows: rows.map((r) => ({ ...r.po, subtotal: cost ? r.po.subtotal : null, vat: cost ? r.po.vat : null, total: cost ? r.po.total : null, totalSar: cost ? r.po.totalSar : null, supplierName: r.supplierName, projectNumber: r.projectNumber })),
        total: n,
      };
    }, actor.userId);
  }

  @Post('purchase-orders')
  @Perm('purchase.write')
  async poCreate(@Actor() actor: RequestActor, @Body(new ZodPipe(poSchema)) b: PoInput) {
    return tenantTx(actor.tenantId, async (tx) => poView(tx, actor, await this.createPo(tx, actor, b, null)), actor.userId);
  }

  /** PO for the open lines of a material request at the supplier's catalogue prices (preferred supplier by default). */
  @Post('purchase-orders/from-request/:mrId')
  @Perm('purchase.write')
  async poFromRequest(@Actor() actor: RequestActor, @Param('mrId') mrId: string, @Query(new ZodPipe(z.object({ supplierId: zUuid.optional() }))) q: { supplierId?: string },
    @Body(new ZodPipe(fromRequestSchema.default({ depositPercent: 0 }))) b: z.infer<typeof fromRequestSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const mr = await this.loadMr(tx, mrId);
      if (!['draft', 'approved'].includes(mr.status)) throw badRequest(`a ${mr.status} material request cannot be ordered`);
      const lines = (await tx.select().from(materialRequestLine).where(eq(materialRequestLine.requestId, mr.id)).orderBy(asc(materialRequestLine.code))).filter((l) => dec(l.qty).gt(l.orderedQty));
      if (!lines.length) throw badRequest('every line of the request is already on order');
      const items = await tx.select().from(supplierItem).where(inArray(supplierItem.productId, lines.map((l) => l.productId)));
      const supplierId = q.supplierId ?? b.supplierId ?? items.find((i) => i.preferred)?.supplierId ?? items[0]?.supplierId;
      if (!supplierId) throw badRequest('no supplier given and none in the supplier catalogue for these products');
      const mine = items.filter((i) => i.supplierId === supplierId);
      const currency = b.currency ?? (mine[0]?.currency as Currency | undefined) ?? 'USD';
      const prods = await tx.select().from(product).where(inArray(product.id, lines.map((l) => l.productId)));
      const id = await this.createPo(tx, actor, {
        supplierId, currency, rateToSar: b.rateToSar, incoterm: b.incoterm ?? null, depositPercent: b.depositPercent, expectedOn: b.expectedOn ?? null, projectId: mr.projectId, notes: `من طلب المواد ${mr.number}`,
        lines: lines.map((l) => {
          const si = mine.find((i) => i.productId === l.productId && i.currency === currency);
          const p = prods.find((x) => x.id === l.productId);
          const price = si?.price ?? (p?.costPrice && p.costCurrency === currency ? p.costPrice : '0');
          return { productId: l.productId, code: l.code, description: l.description, qty: fq(dec(l.qty).minus(l.orderedQty)), unitPrice: price, materialRequestLineId: l.id };
        }),
      }, mr.id);
      return poView(tx, actor, id);
    }, actor.userId);
  }

  private async createPo(tx: Tx, actor: RequestActor, b: Omit<PoInput, 'orderDate'> & { orderDate?: string | null }, materialRequestId: string | null) {
    return createPurchaseOrder(tx, actor, b, materialRequestId);
  }

  @Get('purchase-orders/:id')
  @Perm('purchase.read')
  async poGet(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => poView(tx, actor, id), actor.userId);
  }

  @Put('purchase-orders/:id')
  @Perm('purchase.write')
  async poUpdate(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(poSchema)) b: PoInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      const po = await loadPo(tx, actor, id, 'purchase.write');
      if (po.status !== 'draft') throw badRequest('only a draft purchase order can be edited');
      if (b.supplierId !== po.supplierId) await loadSupplier(tx, b.supplierId);
      if (b.projectId) await loadProjectRow(tx, b.projectId);
      const rate = b.rateToSar ?? (b.currency === po.currency ? po.rateToSar : defaultRate(b.currency));
      if (!rate || dec(rate).lte(0)) throw badRequest(`give the SAR rate for ${b.currency} (rateToSar)`);
      await unlinkPoLines(tx, actor, po.id);
      await tx.delete(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id));
      const values = { supplierId: b.supplierId, currency: b.currency, rateToSar: rate, incoterm: b.incoterm ?? null, depositPercent: b.depositPercent, orderDate: b.orderDate ?? po.orderDate, expectedOn: b.expectedOn ?? null, projectId: b.projectId ?? null, notes: b.notes ?? null };
      const [row] = await tx.update(purchaseOrder).set({ ...values, approverRole: null, updatedAt: new Date(), updatedBy: actor.userId, version: po.version + 1 }).where(eq(purchaseOrder.id, id)).returning();
      await insertPoLines(tx, actor, row!, b.lines);
      await writePoTotals(tx, row!);
      const d = diff(po as Record<string, unknown>, values);
      await audit(tx, actor, 'update', 'purchase_order', id, d?.before ?? null, { ...(d?.after ?? {}), lines: b.lines.length });
      return poView(tx, actor, id);
    }, actor.userId);
  }

  /** Submit for approval: the total in SAR decides the approver role (INV-62). Always pending — the creator never approves. */
  @Post('purchase-orders/:id/submit')
  @Perm('purchase.write')
  async poSubmit(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const po = await loadPo(tx, actor, id, 'purchase.write');
      if (po.status !== 'draft') throw badRequest(`cannot submit a ${po.status} purchase order`);
      const lines = await tx.select({ id: purchaseOrderLine.id }).from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id));
      if (!lines.length) throw badRequest('the purchase order has no lines');
      const t = await writePoTotals(tx, po);
      const approverRole = poApproverRole(t.totalSar);
      await tx.update(purchaseOrder).set({ status: 'pending_approval', approverRole, updatedAt: new Date(), updatedBy: actor.userId, version: po.version + 1 }).where(eq(purchaseOrder.id, id));
      await audit(tx, actor, 'submit', 'purchase_order', id, { status: po.status }, { status: 'pending_approval', approverRole, totalSar: halalasToFixed(t.totalSar) });
      await emit(tx, 'purchase_order', id, 'purchase_order.submitted', { number: po.number, approverRole });
      return poView(tx, actor, id);
    }, actor.userId);
  }

  /**
   * Approve (purchase.approve): the approver holds the required role or a higher-ranked one, and is
   * not the creator. Models failing compliance (SABER PCoC / CST) block unless acknowledgeCompliance.
   */
  @Post('purchase-orders/:id/approve')
  @Perm('purchase.approve')
  async poApprove(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ acknowledgeCompliance: z.boolean().optional(), note: zText(1000).nullish() }).default({}))) b: { acknowledgeCompliance?: boolean; note?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const po = await loadPo(tx, actor, id, 'purchase.approve');
      if (po.status !== 'pending_approval') throw badRequest(`a ${po.status} purchase order cannot be approved`);
      if (po.createdBy === actor.userId) throw forbidden('the creator of a purchase order cannot approve it');
      const need = PO_APPROVER_RANK[po.approverRole ?? 'owner'] ?? PO_APPROVER_RANK.owner!;
      if (approverRank(actor) < need) throw forbidden(`this purchase order needs approval by ${po.approverRole}`);
      const lines = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id));
      const comp = await complianceFor(tx, [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))]);
      const notes: { productId: string; key: string; en: string }[] = [];
      const blocking: { productId: string; code: string; issues: { key: string; level: string; ar: string; en: string }[] }[] = [];
      for (const [productId, st] of comp) {
        const code = lines.find((l) => l.productId === productId)?.code ?? '';
        for (const i of st.issues) notes.push({ productId, key: i.key, en: `${code}: ${i.en}` });
        if (!st.ok) blocking.push({ productId, code, issues: st.issues });
      }
      if (blocking.length && !b.acknowledgeCompliance) throw badRequest('compliance certificates missing or expired — add them or approve with acknowledgeCompliance', { compliance: blocking });
      await tx.update(purchaseOrder).set({ status: 'approved', approvedBy: actor.userId, approvedAt: new Date(), complianceNotes: notes, updatedAt: new Date(), updatedBy: actor.userId, version: po.version + 1 }).where(eq(purchaseOrder.id, id));
      await audit(tx, actor, 'approve', 'purchase_order', id, { status: po.status }, { status: 'approved', complianceAcknowledged: blocking.length > 0, note: b.note ?? null }, b.note ?? undefined);
      await emit(tx, 'purchase_order', id, 'purchase_order.approved', { number: po.number });
      return poView(tx, actor, id);
    }, actor.userId);
  }

  @Post('purchase-orders/:id/reject')
  @Perm('purchase.approve')
  async poReject(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: zText(1000).min(1) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const po = await loadPo(tx, actor, id, 'purchase.approve');
      if (po.status !== 'pending_approval') throw badRequest(`a ${po.status} purchase order cannot be rejected`);
      await tx.update(purchaseOrder).set({ status: 'draft', approverRole: null, updatedAt: new Date(), updatedBy: actor.userId, version: po.version + 1 }).where(eq(purchaseOrder.id, id));
      await audit(tx, actor, 'reject', 'purchase_order', id, { status: po.status }, { status: 'draft' }, b.reason);
      return poView(tx, actor, id);
    }, actor.userId);
  }

  @Post('purchase-orders/:id/send')
  @Perm('purchase.write')
  async poSend(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ channel: z.enum(['auto', 'email', 'whatsapp', 'none']).optional() }).default({}))) b: { channel?: 'auto' | 'email' | 'whatsapp' | 'none' }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const po = await loadPo(tx, actor, id, 'purchase.write');
      if (po.status !== 'approved') throw badRequest(`a ${po.status} purchase order cannot be sent`);
      await tx.update(purchaseOrder).set({ status: 'sent', updatedAt: new Date(), updatedBy: actor.userId, version: po.version + 1 }).where(eq(purchaseOrder.id, id));
      const delivery = await deliverPurchaseOrder(tx, actor, id, b.channel ?? 'auto');
      await audit(tx, actor, 'send', 'purchase_order', id, { status: po.status }, { status: 'sent', delivery });
      await emit(tx, 'purchase_order', id, 'purchase_order.sent', { number: po.number, channel: delivery.channel });
      return { ...(await poView(tx, actor, id)), delivery };
    }, actor.userId);
  }

  @Post('purchase-orders/:id/cancel')
  @Perm('purchase.write')
  async poCancel(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: zText(1000).nullish() }).default({}))) b: { reason?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const po = await loadPo(tx, actor, id, 'purchase.write');
      if (!canTransitionPo(po.status as PoStatus, 'cancelled')) throw badRequest(`a ${po.status} purchase order cannot be cancelled`);
      const lines = await tx.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id));
      if (lines.some((l) => dec(l.receivedQty).gt(0))) throw badRequest('goods were received on this order — close it instead');
      await unlinkPoLines(tx, actor, po.id);
      await tx.update(purchaseOrder).set({ status: 'cancelled', updatedAt: new Date(), updatedBy: actor.userId, version: po.version + 1 }).where(eq(purchaseOrder.id, id));
      await audit(tx, actor, 'cancel', 'purchase_order', id, { status: po.status }, { status: 'cancelled' }, b.reason ?? undefined);
      return poView(tx, actor, id);
    }, actor.userId);
  }

  /** Close a partially received order (the rest will not come); its open quantity stops counting as incoming. */
  @Post('purchase-orders/:id/close')
  @Perm('purchase.write')
  async poClose(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const po = await loadPo(tx, actor, id, 'purchase.write');
      if (!canTransitionPo(po.status as PoStatus, 'closed')) throw badRequest(`a ${po.status} purchase order cannot be closed`);
      await tx.update(purchaseOrder).set({ status: 'closed', updatedAt: new Date(), updatedBy: actor.userId, version: po.version + 1 }).where(eq(purchaseOrder.id, id));
      await audit(tx, actor, 'close', 'purchase_order', id, { status: po.status }, { status: 'closed' });
      return poView(tx, actor, id);
    }, actor.userId);
  }

  /** Bilingual PO document (PDF through Gotenberg; `?format=html` returns the HTML). Needs purchase.cost.read. */
  @Get('purchase-orders/:id/pdf')
  @Perm('purchase.read')
  async poPdf(@Actor() actor: RequestActor, @Param('id') id: string, @Res() res: Response, @Query('format') format?: string) {
    const doc = await tenantTx(actor.tenantId, (tx) => purchaseOrderDoc(tx, actor, id));
    const html = renderPurchaseOrderHtml(doc);
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
      return;
    }
    const pdf = await htmlToPdf(html, config.gotenbergUrl);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.number}.pdf"`);
    res.send(pdf);
  }

  // ───────────────────────── receiving ─────────────────────────

  @Post('purchase-orders/:id/receipts')
  @Perm('inventory.write')
  async poReceive(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(receiptSchema)) b: z.infer<typeof receiptSchema>) {
    return tenantTx(actor.tenantId, (tx) => receive(tx, actor, id, b), actor.userId);
  }

  @Get('receipts/:id')
  @Perm('inventory.read', 'purchase.read')
  async receipt(@Actor() actor: RequestActor, @Param('id') id: string) {
    this.assertStoreOrPurchasing(actor);
    return tenantTx(actor.tenantId, (tx) => receiptView(tx, actor, id), actor.userId);
  }

  // ───────────────────────── transfers, issues, returns ─────────────────────────

  @Get('transfers')
  @Perm('inventory.read')
  async transfers(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.string().optional(), warehouseId: zUuid.optional() }))) q: { limit: number; offset: number; status?: string; warehouseId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const vis = await visibleWarehouseIds(tx, actor);
      const where = whereAll([
        q.status ? inArray(stockTransfer.status, q.status.split(',')) : undefined,
        q.warehouseId ? or(eq(stockTransfer.fromWarehouseId, q.warehouseId), eq(stockTransfer.toWarehouseId, q.warehouseId)) : undefined,
        vis ? or(inIds(stockTransfer.fromWarehouseId, vis), inIds(stockTransfer.toWarehouseId, vis)) : undefined,
      ]);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(stockTransfer).where(where)) as [{ n: number }];
      const rows = await tx.select().from(stockTransfer).where(where).orderBy(desc(stockTransfer.createdAt)).limit(q.limit).offset(q.offset);
      const whs = await tx.select({ id: warehouse.id, code: warehouse.code, nameAr: warehouse.nameAr }).from(warehouse);
      const wh = (id: string) => whs.find((w) => w.id === id) ?? null;
      return { rows: rows.map((r) => ({ ...r, from: wh(r.fromWarehouseId), to: wh(r.toWarehouseId) })), total: n };
    }, actor.userId);
  }

  @Get('transfers/:id')
  @Perm('inventory.read')
  async transfer(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const t = await this.loadTransfer(tx, id);
      const vis = await visibleWarehouseIds(tx, actor);
      if (vis && !vis.includes(t.fromWarehouseId) && !vis.includes(t.toWarehouseId)) throw forbidden('not your warehouse');
      return this.transferView(tx, actor, t);
    }, actor.userId);
  }

  @Post('transfers')
  @Perm('inventory.write')
  async addTransfer(@Actor() actor: RequestActor, @Body(new ZodPipe(transferSchema)) b: z.infer<typeof transferSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const from = await loadWarehouse(tx, b.fromWarehouseId);
      const to = await loadWarehouse(tx, b.toWarehouseId);
      if (from.id === to.id) throw badRequest('source and destination are the same warehouse');
      if (from.kind === 'transit' || to.kind === 'transit') throw badRequest('the transit warehouse is used by the transfer itself');
      if (from.archivedAt || to.archivedAt) throw badRequest('archived warehouse');
      if (b.projectId) await loadProjectRow(tx, b.projectId);
      const prods = await tx.select().from(product).where(inArray(product.id, b.lines.map((l) => l.productId)));
      const lines = b.lines.map((l) => {
        const p = prods.find((x) => x.id === l.productId);
        if (!p) throw badRequest(`unknown product ${l.productId}`);
        if (p.serialTracked && (l.serials?.length ?? 0) !== Number(l.qty)) throw badRequest(`${p.code} is serial-tracked: list ${l.qty} serial number(s)`);
        return { productId: p.id, code: p.code, qty: l.qty, ...(l.serials?.length ? { serials: l.serials.map((s) => s.trim().toUpperCase()) } : {}) };
      });
      const { number } = await nextNumber(tx, 'stock_transfer');
      const [row] = await tx.insert(stockTransfer).values({ number, fromWarehouseId: from.id, toWarehouseId: to.id, projectId: b.projectId ?? null, lines, notes: b.notes ?? null, createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'stock_transfer', row!.id, null, { number, from: from.code, to: to.code, lines: lines.length });
      return this.transferView(tx, actor, row!);
    }, actor.userId);
  }

  /** Ship: source → transit (INV-31). */
  @Post('transfers/:id/ship')
  @Perm('inventory.write')
  async shipTransfer(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const t = await this.loadTransfer(tx, id);
      if (t.status !== 'draft') throw badRequest(`a ${t.status} transfer cannot be shipped`);
      const transit = await ensureTransitWarehouse(tx, actor.userId);
      for (const l of t.lines) {
        await postMove(tx, actor, { kind: 'transfer', productId: l.productId, fromWarehouseId: t.fromWarehouseId, toWarehouseId: transit.id, qty: l.qty, serials: l.serials, projectId: t.projectId, refType: 'stock_transfer', refId: t.id, note: `${t.number} (ship)` });
      }
      await tx.update(stockTransfer).set({ status: 'in_transit', shippedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId, version: t.version + 1 }).where(eq(stockTransfer.id, id));
      await audit(tx, actor, 'ship', 'stock_transfer', id, { status: t.status }, { status: 'in_transit' });
      return this.transferView(tx, actor, await this.loadTransfer(tx, id));
    }, actor.userId);
  }

  /** Receive: transit → destination; the project's reservations follow the goods. */
  @Post('transfers/:id/receive')
  @Perm('inventory.write')
  async receiveTransfer(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const t = await this.loadTransfer(tx, id);
      if (t.status !== 'in_transit') throw badRequest(`a ${t.status} transfer cannot be received`);
      const transit = await ensureTransitWarehouse(tx, actor.userId);
      for (const l of t.lines) {
        await postMove(tx, actor, { kind: 'transfer', productId: l.productId, fromWarehouseId: transit.id, toWarehouseId: t.toWarehouseId, qty: l.qty, serials: l.serials, projectId: t.projectId, refType: 'stock_transfer', refId: t.id, note: `${t.number} (receive)` });
        if (t.projectId) await takeReservation(tx, actor.userId, t.projectId, l.productId, t.fromWarehouseId, dec(l.qty), { warehouseId: t.toWarehouseId });
      }
      await tx.update(stockTransfer).set({ status: 'received', receivedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId, version: t.version + 1 }).where(eq(stockTransfer.id, id));
      await audit(tx, actor, 'receive', 'stock_transfer', id, { status: t.status }, { status: 'received' });
      return this.transferView(tx, actor, await this.loadTransfer(tx, id));
    }, actor.userId);
  }

  @Post('transfers/:id/cancel')
  @Perm('inventory.write')
  async cancelTransfer(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const t = await this.loadTransfer(tx, id);
      if (t.status !== 'draft') throw badRequest('only a draft transfer can be cancelled');
      await tx.update(stockTransfer).set({ status: 'cancelled', updatedAt: new Date(), updatedBy: actor.userId, version: t.version + 1 }).where(eq(stockTransfer.id, id));
      await audit(tx, actor, 'cancel', 'stock_transfer', id, { status: t.status }, { status: 'cancelled' });
      return this.transferView(tx, actor, await this.loadTransfer(tx, id));
    }, actor.userId);
  }

  private async loadTransfer(tx: Tx, id: string) {
    if (!isUuid(id)) throw notFound('transfer');
    const [t] = await tx.select().from(stockTransfer).where(eq(stockTransfer.id, id));
    if (!t) throw notFound('transfer');
    return t;
  }

  private async transferView(tx: Tx, actor: RequestActor, t: typeof stockTransfer.$inferSelect) {
    const whs = await tx.select({ id: warehouse.id, code: warehouse.code, nameAr: warehouse.nameAr, kind: warehouse.kind }).from(warehouse).where(inArray(warehouse.id, [t.fromWarehouseId, t.toWarehouseId]));
    const moves = await tx.select().from(stockMove).where(and(eq(stockMove.refType, 'stock_transfer'), eq(stockMove.refId, t.id))).orderBy(asc(stockMove.postedAt));
    return { ...t, from: whs.find((w) => w.id === t.fromWarehouseId) ?? null, to: whs.find((w) => w.id === t.toWarehouseId) ?? null, moves: moves.map((m) => moveOut(actor, m)) };
  }

  /** Issue to a project (INV-32): stock leaves at average cost, posted to the project; its reservations there are consumed. */
  @Post('issue')
  @Perm('inventory.write')
  async issue(@Actor() actor: RequestActor, @Body(new ZodPipe(issueSchema)) b: z.infer<typeof issueSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const prj = await loadProjectRow(tx, b.projectId);
      await loadWarehouse(tx, b.fromWarehouseId);
      const moves = await postLines(tx, actor, b.lines, { kind: 'issue_project', fromWarehouseId: b.fromWarehouseId, projectId: prj.id, refType: 'project', refId: prj.id, note: b.note ?? prj.number });
      for (const l of b.lines) await takeReservation(tx, actor.userId, prj.id, l.productId, b.fromWarehouseId, dec(l.qty), { status: 'consumed' });
      await audit(tx, actor, 'issue', 'project', prj.id, null, { lines: b.lines.length, warehouseId: b.fromWarehouseId });
      return { moves: moves.map((m) => moveOut(actor, m)) };
    }, actor.userId);
  }

  /** Returns from a project site or a work order back into a warehouse (at average cost). */
  @Post('returns')
  @Perm('inventory.write')
  async returns(@Actor() actor: RequestActor, @Body(new ZodPipe(returnSchema)) b: z.infer<typeof returnSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      let projectId = b.projectId ?? null;
      let ref: { type: string; id: string; label: string };
      if (b.workOrderId) {
        const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, b.workOrderId));
        if (!wo) throw notFound('work order');
        projectId = projectId ?? wo.projectId;
        ref = { type: 'work_order', id: wo.id, label: wo.number };
      } else {
        const prj = await loadProjectRow(tx, projectId!);
        ref = { type: 'project', id: prj.id, label: prj.number };
      }
      await loadWarehouse(tx, b.toWarehouseId);
      const moves = await postLines(tx, actor, b.lines, { kind: 'return', toWarehouseId: b.toWarehouseId, projectId, workOrderId: b.workOrderId ?? null, refType: ref.type, refId: ref.id, note: b.note ?? `return ${ref.label}` });
      await audit(tx, actor, 'return', ref.type, ref.id, null, { lines: b.lines.length, warehouseId: b.toWarehouseId });
      return { moves: moves.map((m) => moveOut(actor, m)) };
    }, actor.userId);
  }

  // ───────────────────────── import shipments (INV-70..74) ─────────────────────────

  @Get('shipments')
  @Perm('purchase.read')
  async shipments(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.string().optional(), supplierId: zUuid.optional() }))) q: { q?: string; limit: number; offset: number; status?: string; supplierId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = whereAll([q.status ? inArray(importShipment.status, q.status.split(',')) : undefined, q.supplierId ? eq(importShipment.supplierId, q.supplierId) : undefined,
        term ? or(ilike(importShipment.number, term), ilike(importShipment.blNumber, term), ilike(importShipment.fasahNumber, term)) : undefined]);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(importShipment).where(where)) as [{ n: number }];
      const rows = await tx.select({ s: importShipment, supplierName: party.nameAr }).from(importShipment).leftJoin(party, eq(party.id, importShipment.supplierId)).where(where).orderBy(desc(importShipment.createdAt)).limit(q.limit).offset(q.offset);
      return { rows: rows.map((r) => ({ ...this.shipmentOut(actor, r.s), supplierName: r.supplierName })), total: n };
    }, actor.userId);
  }

  @Get('shipments/:id')
  @Perm('purchase.read')
  async shipment(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => this.shipmentView(tx, actor, id), actor.userId);
  }

  @Post('shipments')
  @Perm('purchase.write')
  async addShipment(@Actor() actor: RequestActor, @Body(new ZodPipe(shipmentSchema)) b: z.infer<typeof shipmentSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      await this.checkShipment(tx, b);
      const { number } = await nextNumber(tx, 'shipment');
      const [row] = await tx.insert(importShipment).values({ number, ...this.shipmentValues(b), createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'import_shipment', row!.id, null, { number, orders: b.orderIds.length });
      return this.shipmentView(tx, actor, row!.id);
    }, actor.userId);
  }

  @Put('shipments/:id')
  @Perm('purchase.write')
  async updateShipment(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(shipmentSchema)) b: z.infer<typeof shipmentSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await this.loadShipment(tx, id);
      await this.checkShipment(tx, b);
      const values = this.shipmentValues(b);
      await tx.update(importShipment).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(importShipment.id, id));
      const d = diff(before as Record<string, unknown>, values);
      if (d) await audit(tx, actor, 'update', 'import_shipment', id, d.before, d.after);
      return this.shipmentView(tx, actor, id);
    }, actor.userId);
  }

  /**
   * Move the shipment forward (ordered → shipped → arrived → clearing → released → received). Entering
   * clearing checks the SABER shipment certificate (and the CST certificate for radio devices) and the
   * FASAH declaration: without `force` the move is refused (400, details.warnings); with `force` it goes
   * ahead and the warnings come back in the response.
   */
  @Post('shipments/:id/status')
  @Perm('purchase.write')
  async shipmentStatus(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ status: z.enum(SHIPMENT_STATUSES), force: z.boolean().optional() }))) b: { status: ShipmentStatus; force?: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const sh = await this.loadShipment(tx, id);
      const fromIdx = SHIPMENT_STATUSES.indexOf(sh.status as ShipmentStatus);
      const toIdx = SHIPMENT_STATUSES.indexOf(b.status);
      if (toIdx <= fromIdx) throw badRequest(`a ${sh.status} shipment cannot go back to ${b.status}`);
      const warnings: { key: string; ar: string; en: string }[] = [];
      const clearing = SHIPMENT_STATUSES.indexOf('clearing');
      if (toIdx >= clearing && fromIdx < clearing) {
        const prods = sh.orderIds.length ? await tx.select({ id: product.id, code: product.code, radio: product.radio }).from(purchaseOrderLine).innerJoin(product, eq(product.id, purchaseOrderLine.productId))
          .where(inArray(purchaseOrderLine.orderId, sh.orderIds)) : [];
        if (prods.length && !sh.docs.scoc?.done) warnings.push({ key: 'scoc', ar: 'شهادة سابر للإرسالية (SCoC) غير مرفقة', en: 'SABER shipment certificate (SCoC) missing' });
        if (prods.some((p) => p.radio) && !sh.docs.cst?.done) warnings.push({ key: 'cst', ar: 'شهادة هيئة الاتصالات غير مرفقة لأجهزة لاسلكية', en: 'CST certificate missing for radio devices' });
        if (!sh.fasahNumber) warnings.push({ key: 'declaration', ar: 'البيان الجمركي (فسح) غير مسجل', en: 'FASAH declaration not recorded' });
        if (warnings.length && !b.force) throw badRequest('the shipment is not ready for clearance — complete the documents or send force: true', { warnings });
      }
      await tx.update(importShipment).set({ status: b.status, updatedAt: new Date(), updatedBy: actor.userId, version: sh.version + 1 }).where(eq(importShipment.id, id));
      await audit(tx, actor, `status_${b.status}`, 'import_shipment', id, { status: sh.status }, { status: b.status, forcedWarnings: warnings.map((w) => w.key) });
      await emit(tx, 'import_shipment', id, 'shipment.status', { number: sh.number, status: b.status });
      return { ...(await this.shipmentView(tx, actor, id)), warnings };
    }, actor.userId);
  }

  /** Customs declaration (INV-71): duty from the rate on CIF (or as given); import VAT 15% on CIF + duty — recoverable, never a cost. */
  @Put('shipments/:id/declaration')
  @Perm('purchase.write')
  async declaration(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(declarationSchema)) b: z.infer<typeof declarationSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const sh = await this.loadShipment(tx, id);
      if (sh.landedPostedAt) throw conflict('the landed cost is already posted — the declaration is locked');
      if (b.dutyRatePercent === undefined && b.dutySar === undefined) throw badRequest('give dutyRatePercent or dutySar');
      const cif = toHalalas(b.cifSar);
      const duty = b.dutySar !== undefined ? toHalalas(b.dutySar) : importCharges(cif, b.dutyRatePercent!).duty;
      const importVat = b.importVatSar !== undefined ? toHalalas(b.importVatSar) : importCharges(cif + duty, 0).importVat;
      const values = { fasahNumber: b.fasahNumber, fasahDate: b.fasahDate, cifSar: halalasToFixed(cif), dutySar: halalasToFixed(duty), importVatSar: halalasToFixed(importVat), ...(b.customsPayablePartyId !== undefined ? { customsPayablePartyId: b.customsPayablePartyId } : {}) };
      await tx.update(importShipment).set({ ...values, docs: { ...sh.docs, declaration: { done: true, fileId: sh.docs.declaration?.fileId ?? null } }, updatedAt: new Date(), updatedBy: actor.userId, version: sh.version + 1 }).where(eq(importShipment.id, id));
      const d = diff(sh as Record<string, unknown>, values);
      await audit(tx, actor, 'declaration', 'import_shipment', id, d?.before ?? null, { ...(d?.after ?? {}), dutyRatePercent: b.dutyRatePercent ?? null });
      await tryPost(tx, 'import_vat', id);
      return this.shipmentView(tx, actor, id);
    }, actor.userId);
  }

  @Put('shipments/:id/docs')
  @Perm('purchase.write')
  async shipmentDocs(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ docs: z.record(z.string(), z.object({ done: z.boolean(), fileId: zUuid.nullish() })) }))) b: { docs: Record<string, { done: boolean; fileId?: string | null }> }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const sh = await this.loadShipment(tx, id);
      const keys = SHIPMENT_DOCS.map((d) => d.key);
      const bad = Object.keys(b.docs).filter((k) => !keys.includes(k));
      if (bad.length) throw badRequest(`unknown document(s): ${bad.join(', ')}`, { allowed: keys });
      const docs = { ...sh.docs, ...Object.fromEntries(Object.entries(b.docs).map(([k, v]) => [k, { done: v.done, fileId: v.fileId ?? null }])) };
      await tx.update(importShipment).set({ docs, updatedAt: new Date(), updatedBy: actor.userId, version: sh.version + 1 }).where(eq(importShipment.id, id));
      await audit(tx, actor, 'docs', 'import_shipment', id, sh.docs, docs);
      return this.shipmentView(tx, actor, id);
    }, actor.userId);
  }

  @Put('shipments/:id/charges')
  @Perm('purchase.write')
  async shipmentCharges(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ charges: z.array(z.object({ kind: zText(60).min(1), amountSar: zPrice, note: zText(300).optional() })).max(50) }))) b: { charges: { kind: string; amountSar: string; note?: string }[] }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const sh = await this.loadShipment(tx, id);
      if (sh.landedPostedAt) throw conflict('the landed cost is already posted — charges are locked');
      const charges = b.charges.map((c) => ({ kind: c.kind, amountSar: halalasToFixed(toHalalas(c.amountSar)), ...(c.note ? { note: c.note } : {}) }));
      await tx.update(importShipment).set({ charges, updatedAt: new Date(), updatedBy: actor.userId, version: sh.version + 1 }).where(eq(importShipment.id, id));
      await audit(tx, actor, 'charges', 'import_shipment', id, sh.charges, charges);
      return this.shipmentView(tx, actor, id);
    }, actor.userId);
  }

  /** Allocate duty + charges over the receipts of the shipment and raise the average cost (posting twice → 409). */
  @Post('shipments/:id/landed-cost')
  @Perm('purchase.write')
  async landedCost(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ basis: z.enum(['value', 'qty', 'weight', 'volume']).default('value') }))) b: { basis: 'value' | 'qty' | 'weight' | 'volume' }) {
    if (!canCost(actor)) throw forbidden('landed cost needs purchase.cost.read');
    return tenantTx(actor.tenantId, (tx) => postLandedCost(tx, actor, id, b.basis), actor.userId);
  }

  private async loadShipment(tx: Tx, id: string) {
    if (!isUuid(id)) throw notFound('shipment');
    const [s] = await tx.select().from(importShipment).where(eq(importShipment.id, id));
    if (!s) throw notFound('shipment');
    return s;
  }

  private async checkShipment(tx: Tx, b: z.infer<typeof shipmentSchema>) {
    if (b.supplierId) await loadSupplier(tx, b.supplierId);
    if (b.orderIds.length) {
      const pos = await tx.select({ id: purchaseOrder.id, supplierId: purchaseOrder.supplierId }).from(purchaseOrder).where(inArray(purchaseOrder.id, b.orderIds));
      if (pos.length !== new Set(b.orderIds).size) throw badRequest('unknown purchase order in orderIds');
      if (b.supplierId && pos.some((p) => p.supplierId !== b.supplierId)) throw badRequest('a purchase order belongs to another supplier');
    }
    if (b.etd && b.eta && b.eta < b.etd) throw badRequest('ETA is before ETD');
  }

  private shipmentValues(b: z.infer<typeof shipmentSchema>) {
    return { supplierId: b.supplierId ?? null, orderIds: [...new Set(b.orderIds)], mode: b.mode, blNumber: b.blNumber ?? null, containers: b.containers, vessel: b.vessel ?? null, etd: b.etd ?? null, eta: b.eta ?? null, broker: b.broker ?? null, notes: b.notes ?? null };
  }

  private shipmentOut(actor: RequestActor, s: typeof importShipment.$inferSelect) {
    const cost = canCost(actor);
    return { ...s, cifSar: cost ? s.cifSar : null, dutySar: cost ? s.dutySar : null, importVatSar: cost ? s.importVatSar : null, charges: s.charges.map((c) => ({ ...c, amountSar: cost ? c.amountSar : null })) };
  }

  private async shipmentView(tx: Tx, actor: RequestActor, id: string) {
    const sh = await this.loadShipment(tx, id);
    const [s] = sh.supplierId ? await tx.select({ id: party.id, nameAr: party.nameAr }).from(party).where(eq(party.id, sh.supplierId)) : [];
    const orders = sh.orderIds.length ? await tx.select({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status, currency: purchaseOrder.currency }).from(purchaseOrder).where(inArray(purchaseOrder.id, sh.orderIds)) : [];
    const receipts = await receiptsOfShipment(tx, sh.id);
    const landed = canCost(actor) ? await landedMoves(tx, sh.id) : [];
    return {
      ...this.shipmentOut(actor, sh), supplier: s ?? null, orders, receipts,
      checklist: SHIPMENT_DOCS.map((d) => ({ ...d, done: !!sh.docs[d.key]?.done, fileId: sh.docs[d.key]?.fileId ?? null })),
      landedMoves: landed,
    };
  }

  // ───────────────────────── stock counts (INV-35/37) ─────────────────────────

  @Get('counts')
  @Perm('inventory.read')
  async counts(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.string().optional(), warehouseId: zUuid.optional() }))) q: { limit: number; offset: number; status?: string; warehouseId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const vis = await visibleWarehouseIds(tx, actor);
      const where = whereAll([q.status ? inArray(stockCount.status, q.status.split(',')) : undefined, q.warehouseId ? eq(stockCount.warehouseId, q.warehouseId) : undefined, vis ? inIds(stockCount.warehouseId, vis) : undefined]);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(stockCount).where(where)) as [{ n: number }];
      const rows = await tx.select({ c: stockCount, code: warehouse.code, nameAr: warehouse.nameAr }).from(stockCount).innerJoin(warehouse, eq(warehouse.id, stockCount.warehouseId)).where(where).orderBy(desc(stockCount.createdAt)).limit(q.limit).offset(q.offset);
      return { rows: rows.map((r) => { const { lines, ...rest } = r.c; return { ...rest, lineCount: lines.length, warehouseCode: r.code, warehouseName: r.nameAr }; }), total: n };
    }, actor.userId);
  }

  @Get('counts/:id')
  @Perm('inventory.read')
  async count(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const c = await this.loadCount(tx, id);
      await assertWarehouseVisible(tx, actor, c.warehouseId);
      return this.countView(tx, c);
    }, actor.userId);
  }

  /** Snapshot the expected quantity of every product with stock in the warehouse. */
  @Post('counts')
  @Perm('inventory.count', 'inventory.write')
  async addCount(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ warehouseId: zUuid }))) b: { warehouseId: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wh = await loadWarehouse(tx, b.warehouseId);
      const [open] = await tx.select({ number: stockCount.number }).from(stockCount).where(and(eq(stockCount.warehouseId, wh.id), inArray(stockCount.status, ['open', 'submitted'])));
      if (open) throw conflict(`count ${open.number} is still open for this warehouse`);
      const bal = await tx.select({ productId: stockBalance.productId, qty: stockBalance.qty, code: product.code }).from(stockBalance).innerJoin(product, eq(product.id, stockBalance.productId))
        .where(and(eq(stockBalance.warehouseId, wh.id), ne(stockBalance.qty, '0'))).orderBy(asc(product.code));
      const { number } = await nextNumber(tx, 'stock_count');
      const [row] = await tx.insert(stockCount).values({ number, warehouseId: wh.id, lines: bal.map((x) => ({ productId: x.productId, code: x.code, expected: fq(dec(x.qty)), counted: null })), createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'stock_count', row!.id, null, { number, warehouse: wh.code, lines: bal.length });
      return this.countView(tx, row!);
    }, actor.userId);
  }

  /** Enter counted quantities (a product found but not expected is added with expected 0). Serial-tracked lines may carry the counted serials. */
  @Put('counts/:id')
  @Perm('inventory.count', 'inventory.write')
  async updateCount(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(countLinesSchema)) b: z.infer<typeof countLinesSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const c = await this.loadCount(tx, id);
      if (!['open', 'submitted'].includes(c.status)) throw badRequest(`a ${c.status} count cannot change`);
      type CountLine = (typeof c.lines)[number] & { serials?: string[] };
      const lines: CountLine[] = c.lines.map((l) => ({ ...l }));
      for (const l of b.lines) {
        let line = lines.find((x) => x.productId === l.productId);
        if (!line) {
          const p = await loadProduct(tx, l.productId);
          line = { productId: p.id, code: p.code, expected: '0', counted: null };
          lines.push(line);
        }
        line.counted = l.counted;
        if (l.serials) line.serials = [...new Set(l.serials.map((s) => s.trim().toUpperCase()).filter(Boolean))];
      }
      await tx.update(stockCount).set({ lines, updatedAt: new Date(), updatedBy: actor.userId, version: c.version + 1 }).where(eq(stockCount.id, id));
      return this.countView(tx, await this.loadCount(tx, id));
    }, actor.userId);
  }

  /**
   * Post the count (inventory.count): every line must be counted; accuracy = share of lines that match
   * the snapshot; each difference becomes a 'count' move (shortage out of / surplus into the warehouse)
   * at average cost. Serial-tracked differences need the counted serial list.
   */
  @Post('counts/:id/post')
  @Perm('inventory.count')
  async postCount(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const c = await this.loadCount(tx, id);
      if (!['open', 'submitted'].includes(c.status)) throw badRequest(`a ${c.status} count cannot be posted`);
      const lines = c.lines as ((typeof c.lines)[number] & { serials?: string[] })[];
      const missing = lines.filter((l) => l.counted === null);
      if (missing.length) throw badRequest(`${missing.length} line(s) not counted yet`, { codes: missing.map((l) => l.code) });
      const accuracy = countAccuracy(lines.map((l) => ({ expected: l.expected, counted: l.counted! })));
      const moves = [];
      for (const l of lines) {
        const d = dec(l.counted!).minus(l.expected);
        if (d.eq(0)) continue;
        const p = await loadProduct(tx, l.productId);
        let serials: string[] | undefined;
        if (p.serialTracked) {
          if (!l.serials) throw badRequest(`${p.code} is serial-tracked: list the counted serial numbers to post the difference`);
          const inStock = (await tx.select({ serial: serialNumber.serial }).from(serialNumber).where(and(eq(serialNumber.productId, p.id), eq(serialNumber.warehouseId, c.warehouseId), inArray(serialNumber.status, ['in_stock', 'reserved'])))).map((s) => s.serial);
          serials = d.lt(0) ? inStock.filter((s) => !l.serials!.includes(s)) : l.serials.filter((s) => !inStock.includes(s));
        }
        moves.push(await postMove(tx, actor, {
          kind: 'count', productId: l.productId, ...(d.lt(0) ? { fromWarehouseId: c.warehouseId } : { toWarehouseId: c.warehouseId }), qty: d.abs(), serials,
          refType: 'stock_count', refId: c.id, note: `${c.number}: expected ${l.expected}, counted ${l.counted}`,
        }));
      }
      await tx.update(stockCount).set({ status: 'posted', accuracy: String(accuracy), postedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId, version: c.version + 1 }).where(eq(stockCount.id, id));
      await audit(tx, actor, 'post', 'stock_count', id, { status: c.status }, { status: 'posted', accuracy, adjustments: moves.length });
      await emit(tx, 'stock_count', id, 'stock_count.posted', { number: c.number, accuracy });
      return { ...(await this.countView(tx, await this.loadCount(tx, id))), moves: moves.map((m) => moveOut(actor, m)) };
    }, actor.userId);
  }

  private async loadCount(tx: Tx, id: string) {
    if (!isUuid(id)) throw notFound('count');
    const [c] = await tx.select().from(stockCount).where(eq(stockCount.id, id));
    if (!c) throw notFound('count');
    return c;
  }

  private async countView(tx: Tx, c: typeof stockCount.$inferSelect) {
    const [wh] = await tx.select({ code: warehouse.code, nameAr: warehouse.nameAr }).from(warehouse).where(eq(warehouse.id, c.warehouseId));
    const counted = c.lines.filter((l) => l.counted !== null);
    return {
      ...c, warehouse: wh ?? null,
      lines: c.lines.map((l) => ({ ...l, difference: l.counted === null ? null : dec(l.counted).minus(l.expected).toString() })),
      progress: { counted: counted.length, total: c.lines.length, accuracySoFar: countAccuracy(counted.map((l) => ({ expected: l.expected, counted: l.counted! }))) },
    };
  }

  // ───────────────────────── supplier bills (INV-64) ─────────────────────────

  @Post('bills/:id/approve')
  @Perm('purchase.approve')
  async approveBill(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => approveBill(tx, actor, id), actor.userId);
  }

  @Post('bills')
  @Perm('purchase.write')
  async addBill(@Actor() actor: RequestActor, @Body(new ZodPipe(billSchema)) b: z.infer<typeof billSchema>) {
    return tenantTx(actor.tenantId, (tx) => createBill(tx, actor, b), actor.userId);
  }

  // ───────────────────────── reports-lite ─────────────────────────

  /** I1 stock valuation: per product qty (excluding quarantine) × moving-average cost. */
  @Get('reports/stock-valuation')
  @Perm('purchase.cost.read')
  async valuation(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({ productId: product.id, code: product.code, nameAr: product.nameAr, avg: product.avgCostSar, qty: sql<string>`sum(${stockBalance.qty})::text` })
        .from(stockBalance).innerJoin(product, eq(product.id, stockBalance.productId)).innerJoin(warehouse, eq(warehouse.id, stockBalance.warehouseId))
        .where(ne(warehouse.kind, 'quarantine')).groupBy(product.id, product.code, product.nameAr, product.avgCostSar).orderBy(asc(product.code));
      const out = rows.filter((r) => !dec(r.qty).eq(0)).map((r) => ({ productId: r.productId, code: r.code, nameAr: r.nameAr, qty: dec(r.qty).toString(), avgCostSar: r.avg ?? '0.0000', value: halalasToFixed(toHalalas(dec(r.qty).times(r.avg ?? '0'))) }));
      return { rows: out, totalValue: halalasToFixed(out.reduce((s, r) => s + toHalalas(r.value), 0)) };
    }, actor.userId);
  }

  /** I2 reorder: projected (on hand − reserved + incoming) below the reorder level → suggest the reorder quantity. */
  @Get('reports/reorder')
  @Perm('inventory.read', 'purchase.read')
  async reorder(@Actor() actor: RequestActor) {
    this.assertStoreOrPurchasing(actor);
    return tenantTx(actor.tenantId, async (tx) => {
      const prods = await tx.select().from(product).where(and(isNull(product.archivedAt), sql`${product.reorderLevel} is not null`)).orderBy(asc(product.code));
      const qs = await quantities(tx, prods.map((p) => p.id), null);
      const items = await tx.select({ i: supplierItem, supplierName: party.nameAr }).from(supplierItem).innerJoin(party, eq(party.id, supplierItem.supplierId)).where(eq(supplierItem.preferred, true));
      return prods.flatMap((p) => {
        const x = qs.get(p.id)!;
        const projected = dec(projectedQty(x.onHand, x.reserved, x.incoming));
        if (!projected.lt(p.reorderLevel!)) return [];
        const pref = items.find((i) => i.i.productId === p.id);
        const suggest = p.reorderQty && dec(p.reorderQty).gt(0) ? dec(p.reorderQty) : dec(p.reorderLevel!).minus(projected);
        return [{ productId: p.id, code: p.code, nameAr: p.nameAr, onHand: x.onHand.toString(), reserved: x.reserved.toString(), incoming: x.incoming.toString(), projected: projected.toString(), reorderLevel: p.reorderLevel, suggestQty: suggest.toString(), preferredSupplier: pref ? { id: pref.i.supplierId, name: pref.supplierName, leadTimeDays: pref.i.leadTimeDays } : null }];
      });
    }, actor.userId);
  }

  /** Consumption vs BOQ per project: contract quantity vs issued + consumed − returned, plus what is still reserved. */
  @Get('reports/project-consumption/:projectId')
  @Perm('inventory.read', 'project.read')
  async projectConsumption(@Actor() actor: RequestActor, @Param('projectId') projectId: string) {
    this.assertStoreOrPurchasing(actor);
    return tenantTx(actor.tenantId, async (tx) => {
      const prj = await loadProjectRow(tx, projectId);
      const boq = prj.contractId ? mergeBoq((await contractBoq(tx, prj.contractId)).lines) : new Map<string, never>();
      const mv = await tx.select({ productId: stockMove.productId, kind: stockMove.kind, q: sql<string>`sum(${stockMove.qty})::text`, v: sql<string>`sum(${stockMove.qty} * ${stockMove.unitCostSar})::text` })
        .from(stockMove).where(and(eq(stockMove.projectId, prj.id), inArray(stockMove.kind, ['issue_project', 'consume_wo', 'return']))).groupBy(stockMove.productId, stockMove.kind);
      const res = await tx.select({ productId: stockReservation.productId, q: sql<string>`sum(${stockReservation.qty})::text` }).from(stockReservation)
        .where(and(eq(stockReservation.projectId, prj.id), eq(stockReservation.status, 'active'))).groupBy(stockReservation.productId);
      const ids = [...new Set<string>([...boq.keys(), ...mv.map((m) => m.productId), ...res.map((r) => r.productId)])];
      const prods = ids.length ? await tx.select({ id: product.id, code: product.code, nameAr: product.nameAr, serialTracked: product.serialTracked }).from(product).where(inArray(product.id, ids)) : [];
      const cost = canCost(actor);
      const rows = ids.map((id) => {
        const get = (k: string) => dec(mv.find((m) => m.productId === id && m.kind === k)?.q ?? '0');
        const val = (k: string) => dec(mv.find((m) => m.productId === id && m.kind === k)?.v ?? '0');
        const used = get('issue_project').plus(get('consume_wo')).minus(get('return'));
        const boqQty = boq.get(id)?.qty ?? dec(0);
        const p = prods.find((x) => x.id === id);
        return {
          productId: id, code: p?.code ?? '', nameAr: p?.nameAr ?? '', serialTracked: !!p?.serialTracked, boqQty: boqQty.toString(), issued: get('issue_project').toString(), consumed: get('consume_wo').toString(), returned: get('return').toString(),
          used: used.toString(), reserved: dec(res.find((r) => r.productId === id)?.q ?? '0').toString(), variance: used.minus(boqQty).toString(),
          costSar: cost ? halalasToFixed(toHalalas(val('issue_project').plus(val('consume_wo')).minus(val('return')))) : null,
        };
      }).sort((a, b) => a.code.localeCompare(b.code));
      return { project: { id: prj.id, number: prj.number, name: prj.name }, rows, totalCostSar: cost ? halalasToFixed(rows.reduce((s, r) => s + toHalalas(r.costSar ?? '0'), 0)) : null };
    }, actor.userId);
  }
}
