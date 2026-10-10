import { createHash } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import {
  and, asc, desc, eq, erpLink, goodsReceipt, goodsReceiptLine, importShipment, inArray, isNotNull, isNull, or, party, product, project, purchaseOrder, purchaseOrderLine,
  site, sql, stockMove, supplierBill, syncReconciliationRun, tenant, warehouse, withTenant, type Tx,
} from '@mmc/db';
import { dec, riyadhDate } from '@mmc/domain';
import type { BackOfficePort, StockEntryPayload, StockEntryPurpose } from '@mmc/erp-connector';
import { backOffice } from '../common/backoffice.js';
import { getDb } from '../common/db.js';
import { config } from '../config.js';

/**
 * Push Phase 5 operational records to an external back office (ERPNext) through the BackOfficePort.
 * Optional since Phase 6: Core keeps its own general ledger (owner decision 2026-10-08, see
 * `gl-posting.service.ts`) and nothing there depends on this sync. Records go in dependency order:
 *
 *   warehouses → suppliers → projects (referenced by pending documents) → purchase orders (approved+) → goods receipts → supplier bills (approved)
 *   → stock entries (grouped stock moves) → landed cost vouchers
 *
 * Items are pushed on demand when a document references a product without `erpName`.
 *
 * Where the result is written back:
 *  - warehouse / purchase_order / goods_receipt / supplier_bill → their `erp_name` column;
 *  - supplier → `erp_link` (party, Supplier) — `party.erp_name` is already the ERPNext *Customer*;
 *  - project → `erp_link` (project, Project); documents carry the ERP Project name from that link
 *    (a project not pushed yet is upserted on demand — upsert by `mmc_core_id`, so always idempotent);
 *  - stock_move is append-only for the app role (UPDATE revoked), so every pushed move gets an
 *    `erp_link` row (stock_move, Stock Entry) instead; `checksum` holds the group key, so a group
 *    that failed is retried with exactly the same moves and idempotency key;
 *  - import_shipment has no erp column → `erp_link` (import_shipment, Landed Cost Voucher).
 * Every outcome (synced or error) is mirrored in `erp_link`, which is the sync log the status reads;
 * each run is recorded in `sync_reconciliation_run` (entity `erp_push`).
 */

export const SYNC_TYPES = ['warehouse', 'supplier', 'project', 'purchase_order', 'goods_receipt', 'supplier_bill', 'stock_entry', 'landed_cost'] as const;
export type SyncType = (typeof SYNC_TYPES)[number];

/** Purchase orders that exist for the supplier (approved or later). */
export const PO_SYNC_STATUSES = ['approved', 'sent', 'partially_received', 'received', 'closed'];
/** Supplier bills the back office should book (approved; paid ones too if they were never pushed). */
export const BILL_SYNC_STATUSES = ['approved', 'partially_paid', 'paid'];
/** Stock-move kinds that become Stock Entries (receipts → Purchase Receipt; landed-cost rows → LCV). */
/** Receipts against a PO sync as Purchase Receipts; opening stock and direct-bill receipts go as stock entries. */
export const STOCK_ENTRY_KINDS = ['opening', 'transfer', 'issue_project', 'consume_wo', 'return', 'adjust', 'count', 'scrap'];

const LINK = {
  warehouse: { entityType: 'warehouse', doctype: 'Warehouse' },
  supplier: { entityType: 'party', doctype: 'Supplier' },
  project: { entityType: 'project', doctype: 'Project' },
  purchase_order: { entityType: 'purchase_order', doctype: 'Purchase Order' },
  goods_receipt: { entityType: 'goods_receipt', doctype: 'Purchase Receipt' },
  supplier_bill: { entityType: 'supplier_bill', doctype: 'Purchase Invoice' },
  stock_entry: { entityType: 'stock_move', doctype: 'Stock Entry' },
  landed_cost: { entityType: 'import_shipment', doctype: 'Landed Cost Voucher' },
} as const satisfies Record<SyncType, { entityType: string; doctype: string }>;

const key = (type: string, id: string) => `mmc:${type}:${id}`;

async function writeLink(tx: Tx, type: SyncType, entityId: string, r: { erpName: string; error?: string | null; checksum?: string | null }) {
  const l = LINK[type];
  const values = { erpName: r.erpName, syncStatus: r.error ? 'error' : 'synced', lastError: r.error ?? null, lastSyncedAt: new Date(), checksum: r.checksum ?? null };
  await tx.insert(erpLink).values({ entityType: l.entityType, entityId, erpDoctype: l.doctype, ...values })
    .onConflictDoUpdate({ target: [erpLink.tenantId, erpLink.entityType, erpLink.entityId, erpLink.erpDoctype], set: values });
}

/** Rows not yet synced for the link-tracked types. */
const notSynced = (type: SyncType, idCol: Parameters<typeof eq>[0]) => {
  const l = LINK[type];
  return sql`not exists (select 1 from ${erpLink} el where el.entity_type = ${l.entityType} and el.erp_doctype = ${l.doctype} and el.entity_id = ${idCol} and el.sync_status = 'synced')`;
};

/** Purpose of a stock move in ERPNext terms: from+to = transfer, from only = issue, to only = receipt. */
export function stockPurpose(m: { fromWarehouseId: string | null; toWarehouseId: string | null }): StockEntryPurpose | null {
  if (m.fromWarehouseId && m.toWarehouseId) return 'Material Transfer';
  if (m.fromWarehouseId) return 'Material Issue';
  if (m.toWarehouseId) return 'Material Receipt';
  return null;
}

function pendingMovesWhere() {
  return and(or(inArray(stockMove.kind, STOCK_ENTRY_KINDS), and(eq(stockMove.kind, 'receipt'), eq(stockMove.refType, 'supplier_bill'))), sql`${stockMove.qty} <> 0`, sql`(${stockMove.fromWarehouseId} is not null or ${stockMove.toWarehouseId} is not null)`, sql`coalesce(${stockMove.refType}, '') <> 'landed_cost'`, notSynced('stock_entry', stockMove.id));
}

/** Projects referenced by documents still waiting to be pushed (POs, PO lines, receipts, stock moves). */
function pendingProjectsWhere(tx: Tx) {
  const openPo = and(isNull(purchaseOrder.erpName), inArray(purchaseOrder.status, PO_SYNC_STATUSES));
  return and(notSynced('project', project.id), or(
    inArray(project.id, tx.select({ id: purchaseOrder.projectId }).from(purchaseOrder).where(and(openPo, isNotNull(purchaseOrder.projectId)))),
    inArray(project.id, tx.select({ id: purchaseOrderLine.projectId }).from(purchaseOrderLine).innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId)).where(and(openPo, isNotNull(purchaseOrderLine.projectId)))),
    inArray(project.id, tx.select({ id: purchaseOrder.projectId }).from(goodsReceipt).innerJoin(purchaseOrder, eq(purchaseOrder.id, goodsReceipt.orderId)).where(and(isNull(goodsReceipt.erpName), isNotNull(purchaseOrder.projectId)))),
    inArray(project.id, tx.select({ id: stockMove.projectId }).from(stockMove).where(and(pendingMovesWhere(), isNotNull(stockMove.projectId)))),
  ));
}

/** Pending counts per type (stock_entry = stock moves waiting, not documents). */
export async function pendingCounts(tx: Tx): Promise<Record<SyncType, number>> {
  const c = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  return {
    warehouse: await c(tx.select({ n }).from(warehouse).where(isNull(warehouse.erpName))),
    supplier: await c(tx.select({ n }).from(party).where(and(eq(party.isSupplier, true), notSynced('supplier', party.id)))),
    project: await c(tx.select({ n }).from(project).where(pendingProjectsWhere(tx))),
    purchase_order: await c(tx.select({ n }).from(purchaseOrder).where(and(isNull(purchaseOrder.erpName), inArray(purchaseOrder.status, PO_SYNC_STATUSES)))),
    goods_receipt: await c(tx.select({ n }).from(goodsReceipt).where(isNull(goodsReceipt.erpName))),
    supplier_bill: await c(tx.select({ n }).from(supplierBill).where(and(isNull(supplierBill.erpName), inArray(supplierBill.status, BILL_SYNC_STATUSES)))),
    stock_entry: await c(tx.select({ n }).from(stockMove).where(pendingMovesWhere())),
    landed_cost: await c(tx.select({ n }).from(importShipment).where(and(isNotNull(importShipment.landedPostedAt), notSynced('landed_cost', importShipment.id)))),
  };
}

export interface SyncResult {
  backOffice: 'erpnext' | 'fake';
  skipped?: 'busy';
  pushed: Record<SyncType, number>;
  items: number;
  errors: { type: SyncType; id: string; ref: string; message: string }[];
}

class Waiting extends Error {}

/**
 * Push up to `limit` records of each type. Each record runs in its own savepoint: a back-office error
 * is logged on that record (erp_link, sync_status 'error') and the run goes on. Re-running is safe —
 * every create carries an idempotency key and already-synced records are not selected again.
 */
export async function syncPending(tx: Tx, tenantId: string, opts: { limit?: number } = {}): Promise<SyncResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
  const bo = backOffice(tenantId);
  const res: SyncResult = { backOffice: bo.kind, pushed: { warehouse: 0, supplier: 0, project: 0, purchase_order: 0, goods_receipt: 0, supplier_bill: 0, stock_entry: 0, landed_cost: 0 }, items: 0, errors: [] };
  // one run per tenant at a time (cron + manual button)
  const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${`erp-sync:${tenantId}`})) as ok`);
  if (!lock?.ok) return { ...res, skipped: 'busy' };

  const step = async (type: SyncType, id: string, ref: string, fn: (sp: Tx) => Promise<void>, onError?: (message: string) => Promise<void>) => {
    try {
      await tx.transaction(async (sp) => fn(sp));
      res.pushed[type]++;
    } catch (e) {
      const message = e instanceof Waiting ? e.message : (e as Error).message ?? String(e);
      res.errors.push({ type, id, ref, message });
      if (onError) await onError(message);
      else await writeLink(tx, type, id, { erpName: '', error: message.slice(0, 1000) });
    }
  };

  // ── items on demand ──
  const itemCache = new Map<string, string>();
  const ensureItem = async (sp: Tx, productId: string | null, fallback: { id: string; code: string; description?: string | null }) => {
    const cacheKey = productId ?? `code:${fallback.code}`;
    const hit = itemCache.get(cacheKey);
    if (hit) return hit;
    let name: string;
    if (productId) {
      const [p] = await sp.select().from(product).where(eq(product.id, productId));
      if (!p) throw new Waiting(`product ${productId} not found`);
      if (p.erpName) name = p.erpName;
      else {
        name = (await bo.upsertItem({ coreId: p.id, code: p.code, name: p.nameAr, description: p.description || p.nameEn, isStock: !['service', 'labor', 'non_stock', 'kit'].includes(p.type), listPrice: p.listPrice })).erpName;
        await sp.update(product).set({ erpName: name }).where(eq(product.id, p.id));
        res.items++;
      }
    } else {
      // free-text PO line: a non-stock item named by its code
      name = (await bo.upsertItem({ coreId: fallback.id, code: fallback.code, name: fallback.description || fallback.code, description: fallback.description, isStock: false, listPrice: '0' })).erpName;
      res.items++;
    }
    itemCache.set(cacheKey, name);
    return name;
  };

  // ── lookups (resolved per record from the savepoint so names written earlier in the run are seen) ──
  const whName = async (sp: Tx, id: string | null | undefined) => {
    if (!id) return null;
    const [w] = await sp.select({ erpName: warehouse.erpName, code: warehouse.code }).from(warehouse).where(eq(warehouse.id, id));
    if (!w?.erpName) throw new Waiting(`waiting for warehouse ${w?.code ?? id} to sync`);
    return w.erpName;
  };
  const supplierName = async (sp: Tx, partyId: string) => {
    const [l] = await sp.select({ erpName: erpLink.erpName }).from(erpLink).where(and(eq(erpLink.entityType, 'party'), eq(erpLink.erpDoctype, 'Supplier'), eq(erpLink.entityId, partyId), eq(erpLink.syncStatus, 'synced')));
    if (!l) throw new Waiting(`waiting for supplier ${partyId} to sync`);
    return l.erpName;
  };
  const pushProject = async (sp: Tx, p: typeof project.$inferSelect) => {
    const [cust] = p.partyId ? await sp.select({ erpName: party.erpName }).from(party).where(eq(party.id, p.partyId)) : [];
    const r = await bo.upsertProject({ coreId: p.id, name: p.number, title: p.name, customerErpName: cust?.erpName ?? null, status: p.status, expectedStart: p.plannedStart ?? p.clockStartedOn ?? null, expectedEnd: null });
    await writeLink(sp, 'project', p.id, r);
    return r.erpName;
  };
  const projectNames = new Map<string, string>();
  /** ERP Project name of a Core project (from erp_link; upserted on demand when not pushed yet). */
  const projectName = async (sp: Tx, id: string | null | undefined) => {
    if (!id) return null;
    if (!projectNames.has(id)) {
      const [l] = await sp.select({ erpName: erpLink.erpName }).from(erpLink).where(and(eq(erpLink.entityType, 'project'), eq(erpLink.erpDoctype, 'Project'), eq(erpLink.entityId, id), eq(erpLink.syncStatus, 'synced')));
      let name = l?.erpName ?? '';
      if (!name) {
        const [p] = await sp.select().from(project).where(eq(project.id, id));
        if (!p) throw new Waiting(`project ${id} not found`);
        name = await pushProject(sp, p);
        res.pushed.project++;
      }
      projectNames.set(id, name);
    }
    return projectNames.get(id) || null;
  };

  // 1. warehouses
  for (const w of await tx.select().from(warehouse).where(isNull(warehouse.erpName)).orderBy(asc(warehouse.createdAt)).limit(limit)) {
    await step('warehouse', w.id, w.code, async (sp) => {
      const r = await bo.upsertWarehouse({ idempotencyKey: key('warehouse', w.id), coreId: w.id, code: w.code, name: w.nameEn || w.nameAr, kind: w.kind });
      await sp.update(warehouse).set({ erpName: r.erpName }).where(eq(warehouse.id, w.id));
      await writeLink(sp, 'warehouse', w.id, r);
    });
  }

  // 2. suppliers
  for (const p of await tx.select().from(party).where(and(eq(party.isSupplier, true), notSynced('supplier', party.id))).orderBy(asc(party.createdAt)).limit(limit)) {
    await step('supplier', p.id, p.nameAr, async (sp) => {
      const [addr] = await sp.select().from(site).where(and(eq(site.partyId, p.id), inArray(site.type, ['billing', 'hq', 'office']))).limit(1);
      const [lastPo] = await sp.select({ currency: purchaseOrder.currency }).from(purchaseOrder).where(eq(purchaseOrder.supplierId, p.id)).orderBy(desc(purchaseOrder.createdAt)).limit(1);
      const r = await bo.upsertSupplier({
        idempotencyKey: key('supplier', p.id), coreId: p.id, name: p.nameAr, nameEn: p.nameEn, unifiedNumber: p.unifiedNumber, crNumber: p.crNumber, vatNumber: p.vatNumber,
        address: addr ? { buildingNumber: addr.buildingNumber, street: addr.street, district: addr.district, city: addr.city, postalCode: addr.postalCode, additionalNumber: addr.additionalNumber } : null,
        currency: lastPo?.currency ?? (p.vatNumber ? 'SAR' : 'USD'), paymentTermsDays: p.paymentTermsDays, email: p.email, phone: p.phone,
      });
      await writeLink(sp, 'supplier', p.id, r);
    });
  }

  // 2b. projects referenced by pending documents (before the documents that carry them)
  for (const p of await tx.select().from(project).where(pendingProjectsWhere(tx)).orderBy(asc(project.createdAt)).limit(limit)) {
    await step('project', p.id, p.number, async (sp) => {
      projectNames.set(p.id, await pushProject(sp, p));
    });
  }

  // 3. purchase orders (approved or later)
  for (const po of await tx.select().from(purchaseOrder).where(and(isNull(purchaseOrder.erpName), inArray(purchaseOrder.status, PO_SYNC_STATUSES))).orderBy(asc(purchaseOrder.createdAt)).limit(limit)) {
    await step('purchase_order', po.id, po.number, async (sp) => {
      const lines = await sp.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id)).orderBy(asc(purchaseOrderLine.sort));
      const prj = await projectName(sp, po.projectId);
      const lp = [];
      for (const l of lines) lp.push({ coreLineId: l.id, itemCode: await ensureItem(sp, l.productId, { id: l.id, code: l.code, description: l.description }), description: l.description, qty: l.qty, rate: l.unitPrice, project: (await projectName(sp, l.projectId)) ?? prj });
      const orderDate = po.orderDate ?? riyadhDate(po.approvedAt ?? po.createdAt);
      const r = await bo.createPurchaseOrder({
        idempotencyKey: key('purchase_order', po.id), coreId: po.id, number: po.number, supplierErpName: await supplierName(sp, po.supplierId), orderDate,
        scheduleDate: po.expectedOn && po.expectedOn >= orderDate ? po.expectedOn : orderDate, currency: po.currency, conversionRate: po.rateToSar, incoterm: po.incoterm, project: prj,
        vatAmount: po.vat, remarks: po.notes, lines: lp,
      });
      await sp.update(purchaseOrder).set({ erpName: r.erpName }).where(eq(purchaseOrder.id, po.id));
      await writeLink(sp, 'purchase_order', po.id, r);
    });
  }

  // 4. goods receipts
  for (const gr of await tx.select().from(goodsReceipt).where(isNull(goodsReceipt.erpName)).orderBy(asc(goodsReceipt.createdAt)).limit(limit)) {
    await step('goods_receipt', gr.id, gr.number, async (sp) => {
      const [po] = await sp.select().from(purchaseOrder).where(eq(purchaseOrder.id, gr.orderId));
      if (!po?.erpName) throw new Waiting(`waiting for purchase order ${po?.number ?? gr.orderId} to sync`);
      const lines = await sp.select({ l: goodsReceiptLine, code: purchaseOrderLine.code, unitPrice: purchaseOrderLine.unitPrice, description: purchaseOrderLine.description })
        .from(goodsReceiptLine).innerJoin(purchaseOrderLine, eq(purchaseOrderLine.id, goodsReceiptLine.orderLineId)).where(eq(goodsReceiptLine.receiptId, gr.id));
      const lp = [];
      for (const { l, code, unitPrice, description } of lines) {
        if (dec(l.qty).lte(0)) continue;
        lp.push({ coreLineId: l.id, poLineCoreId: l.orderLineId, itemCode: await ensureItem(sp, l.productId, { id: l.orderLineId, code, description }), qty: l.qty, rate: unitPrice, rateSar: l.unitCostSar, serials: l.serials.map((s) => s.serial) });
      }
      const r = await bo.createPurchaseReceipt({
        idempotencyKey: key('goods_receipt', gr.id), coreId: gr.id, number: gr.number, supplierErpName: await supplierName(sp, po.supplierId), postingDate: gr.receivedOn,
        warehouseErpName: (await whName(sp, gr.warehouseId))!, purchaseOrderErpName: po.erpName, currency: po.currency, conversionRate: po.rateToSar, project: await projectName(sp, po.projectId), remarks: gr.notes, lines: lp,
      });
      await sp.update(goodsReceipt).set({ erpName: r.erpName }).where(eq(goodsReceipt.id, gr.id));
      await writeLink(sp, 'goods_receipt', gr.id, r);
    });
  }

  // 5. supplier bills (approved)
  for (const b of await tx.select().from(supplierBill).where(and(isNull(supplierBill.erpName), inArray(supplierBill.status, BILL_SYNC_STATUSES))).orderBy(asc(supplierBill.createdAt)).limit(limit)) {
    await step('supplier_bill', b.id, b.number, async (sp) => {
      const [po] = b.orderId ? await sp.select().from(purchaseOrder).where(eq(purchaseOrder.id, b.orderId)) : [];
      if (po && !po.erpName) throw new Waiting(`waiting for purchase order ${po.number} to sync`);
      const receipts = po ? await sp.select({ erpName: goodsReceipt.erpName, number: goodsReceipt.number }).from(goodsReceipt).where(eq(goodsReceipt.orderId, po.id)) : [];
      const pending = receipts.find((r) => !r.erpName);
      if (pending) throw new Waiting(`waiting for goods receipt ${pending.number} to sync`);
      const poLines = po ? await sp.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, po.id)) : [];
      const lp = [];
      for (const [i, l] of b.lines.entries()) {
        if (!po) {
          // direct bill (no PO): the goods were posted as stock entries; the invoice carries the items only
          const code = l.code || `EXP-${b.number}-${i + 1}`;
          lp.push({ poLineCoreId: null, itemCode: await ensureItem(sp, l.productId ?? null, { id: `${b.id}:${i}`, code, description: l.description }), qty: l.qty, rate: l.unitPrice });
          continue;
        }
        const pl = poLines.find((x) => x.id === l.orderLineId);
        if (!pl) throw new Waiting(`bill line ${l.orderLineId} is not on the purchase order`);
        lp.push({ poLineCoreId: pl.id, itemCode: await ensureItem(sp, pl.productId, { id: pl.id, code: pl.code, description: pl.description }), qty: l.qty, rate: l.unitPrice });
      }
      const r = await bo.createPurchaseInvoice({
        idempotencyKey: key('supplier_bill', b.id), coreId: b.id, number: b.number, supplierErpName: await supplierName(sp, b.supplierId), billNo: b.supplierInvoiceNo, billDate: b.billDate,
        currency: b.currency, conversionRate: b.rateToSar, purchaseOrderErpName: po?.erpName ?? null, purchaseReceiptErpNames: receipts.map((x) => x.erpName!), vatAmount: b.vat, total: b.total,
        zatcaXmlRef: b.fileId ? `mmc-file:${b.fileId}` : null, lines: lp,
      });
      await sp.update(supplierBill).set({ erpName: r.erpName }).where(eq(supplierBill.id, b.id));
      await writeLink(sp, 'supplier_bill', b.id, r);
    });
  }

  // 6. stock entries — pending moves grouped by (source document, purpose, day); a group that failed
  //    before keeps its key (erp_link.checksum) so the retry sends the same moves under the same key.
  {
    const moves = await tx.select({ m: stockMove, claim: erpLink.checksum }).from(stockMove)
      .leftJoin(erpLink, and(eq(erpLink.entityType, 'stock_move'), eq(erpLink.erpDoctype, 'Stock Entry'), eq(erpLink.entityId, stockMove.id)))
      .where(pendingMovesWhere()).orderBy(asc(stockMove.postedAt), asc(stockMove.id)).limit(limit * 20);
    const groups = new Map<string, { purpose: StockEntryPurpose; moves: (typeof stockMove.$inferSelect)[] }>();
    for (const { m, claim } of moves) {
      const purpose = stockPurpose(m);
      if (!purpose) continue;
      const g = claim ? `claim:${claim}` : `${m.refType ?? '-'}|${m.refId ?? m.id}|${purpose}|${riyadhDate(m.postedAt)}`;
      const e = groups.get(g) ?? { purpose, moves: [] };
      e.moves.push(m);
      groups.set(g, e);
    }
    let done = 0;
    for (const [g, { purpose, moves: ms }] of groups) {
      if (done++ >= limit) break;
      const groupKey = g.startsWith('claim:') ? g.slice(6) : createHash('sha256').update(ms.map((m) => m.id).sort().join(',')).digest('hex').slice(0, 32);
      const first = ms[0]!;
      const ref = `${first.refType ?? first.kind}:${first.note ?? first.refId ?? first.id}`.slice(0, 120);
      await step('stock_entry', first.id, ref, async (sp) => {
        const lines: StockEntryPayload['lines'] = [];
        for (const m of ms) {
          lines.push({
            itemCode: await ensureItem(sp, m.productId, { id: m.productId, code: m.productId }), qty: m.qty, sourceWarehouse: await whName(sp, m.fromWarehouseId), targetWarehouse: await whName(sp, m.toWarehouseId),
            basicRateSar: m.unitCostSar, serials: m.serials, project: await projectName(sp, m.projectId),
          });
        }
        const prj = await projectName(sp, first.projectId);
        const r = await bo.createStockEntry({
          idempotencyKey: `mmc:stock:${groupKey}`, purpose, postingDate: riyadhDate(ms[ms.length - 1]!.postedAt), project: prj,
          remarks: [...new Set(ms.map((m) => `${m.kind}${m.note ? `: ${m.note}` : ''}`))].join(' · ').slice(0, 500),
          core: { refType: first.refType, refId: first.refId, moveIds: ms.map((m) => m.id) }, lines,
        });
        for (const m of ms) await writeLink(sp, 'stock_entry', m.id, { ...r, checksum: groupKey });
      }, async (message) => {
        for (const m of ms) await writeLink(tx, 'stock_entry', m.id, { erpName: '', error: message.slice(0, 1000), checksum: groupKey });
      });
    }
  }

  // 7. landed cost vouchers (shipments whose landed cost was posted in Core)
  for (const sh of await tx.select().from(importShipment).where(and(isNotNull(importShipment.landedPostedAt), notSynced('landed_cost', importShipment.id))).orderBy(asc(importShipment.landedPostedAt)).limit(limit)) {
    await step('landed_cost', sh.id, sh.number, async (sp) => {
      const grs = await sp.select().from(goodsReceipt).where(eq(goodsReceipt.shipmentId, sh.id));
      const receipts = [];
      for (const gr of grs) {
        if (!gr.erpName) throw new Waiting(`waiting for goods receipt ${gr.number} to sync`);
        const [po] = await sp.select({ supplierId: purchaseOrder.supplierId }).from(purchaseOrder).where(eq(purchaseOrder.id, gr.orderId));
        const [t] = await sp.select({ v: sql<string>`coalesce(sum(${goodsReceiptLine.qty} * ${goodsReceiptLine.unitCostSar}), 0)::numeric(18,2)::text` }).from(goodsReceiptLine).where(eq(goodsReceiptLine.receiptId, gr.id));
        receipts.push({ receiptErpName: gr.erpName, supplierErpName: await supplierName(sp, po!.supplierId), grandTotalSar: t?.v ?? '0' });
      }
      const charges = [
        ...(sh.dutySar && dec(sh.dutySar).gt(0) ? [{ kind: 'duty', description: `Customs duty ${sh.fasahNumber ?? ''}`.trim(), amountSar: sh.dutySar }] : []),
        ...sh.charges.filter((c) => dec(c.amountSar).gt(0)).map((c) => ({ kind: c.kind, description: c.note ? `${c.kind}: ${c.note}` : c.kind, amountSar: c.amountSar })),
      ];
      const r = await bo.createLandedCostVoucher({
        idempotencyKey: key('landed_cost', sh.id), coreId: sh.id, number: sh.number, postingDate: riyadhDate(sh.landedPostedAt!), receipts, charges, basis: sh.landedBasis ?? 'value',
      });
      await writeLink(sp, 'landed_cost', sh.id, r);
    });
  }

  const pushed = Object.values(res.pushed).reduce((a, b) => a + b, 0);
  await tx.insert(syncReconciliationRun).values({
    entity: 'erp_push', coreCount: pushed + res.errors.length, erpCount: pushed, status: res.errors.length ? 'errors' : 'ok',
    drift: { backOffice: bo.kind, pushed: res.pushed, items: res.items, errors: res.errors.slice(0, 100) },
  });
  return res;
}

/** Status for the admin page: pending per type, last run, open errors and the back-office kind. */
export async function syncStatus(tx: Tx, tenantId: string) {
  const bo: BackOfficePort = backOffice(tenantId);
  const pending = await pendingCounts(tx);
  const [last] = await tx.select().from(syncReconciliationRun).where(eq(syncReconciliationRun.entity, 'erp_push')).orderBy(desc(syncReconciliationRun.runAt)).limit(1);
  const errors = await tx.select({ entityType: erpLink.entityType, entityId: erpLink.entityId, doctype: erpLink.erpDoctype, error: erpLink.lastError, at: erpLink.lastSyncedAt })
    .from(erpLink).where(eq(erpLink.syncStatus, 'error')).orderBy(desc(erpLink.lastSyncedAt)).limit(50);
  const [synced] = await tx.select({ n: sql<number>`count(*)::int` }).from(erpLink).where(and(eq(erpLink.syncStatus, 'synced'), inArray(erpLink.erpDoctype, Object.values(LINK).map((l) => l.doctype))));
  return {
    backOffice: bo.kind,
    scheduled: !!config.erpnext.url,
    schedule: ERP_SYNC_JOB.cron,
    pending,
    pendingTotal: Object.values(pending).reduce((a, b) => a + b, 0),
    syncedLinks: synced?.n ?? 0,
    lastRun: last ? { at: last.runAt, status: last.status, pushed: last.erpCount, attempted: last.coreCount, detail: last.drift } : null,
    errors,
    notes: [
      'Projects referenced by purchase orders, receipts and stock entries are upserted in ERPNext (by mmc_core_id, named by the Core project number) before those documents.',
      'Supplier links are kept in erp_link (party.erp_name is the ERPNext Customer).',
    ],
  };
}

// ───────────────────────── scheduled job (registered from worker.ts) ─────────────────────────

export const ERP_SYNC_JOB = { name: 'erp-sync-push', cron: '*/15 * * * *' } as const;

/** Every 15 min, for each active tenant — only when a real back office is configured (ERPNEXT_URL). */
export async function runErpSync(limit = 100) {
  const tenants = await getDb().select({ id: tenant.id }).from(tenant).where(eq(tenant.status, 'active'));
  const out: Record<string, { pushed: number; errors: number; skipped?: string }> = {};
  for (const t of tenants) {
    try {
      const r = await withTenant(getDb(), t.id, (tx) => syncPending(tx, t.id, { limit }));
      out[t.id] = { pushed: Object.values(r.pushed).reduce((a, b) => a + b, 0), errors: r.errors.length, skipped: r.skipped };
    } catch (e) {
      console.error(`[worker] erp-sync tenant ${t.id}:`, e);
    }
  }
  return out;
}

export async function registerErpSyncJob(boss: PgBoss) {
  if (!config.erpnext.url) return false;
  await boss.createQueue(ERP_SYNC_JOB.name);
  await boss.schedule(ERP_SYNC_JOB.name, ERP_SYNC_JOB.cron, {}, { tz: 'Asia/Riyadh' });
  await boss.work(ERP_SYNC_JOB.name, async () => { await runErpSync(); });
  console.log('[worker] started:', ERP_SYNC_JOB.name);
  return true;
}
