import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  and, asc, changeOrder, contract, eq, gte, inArray, invoiceMirror, ne, party, paymentMirror, paymentRequest, product, project, purchaseOrder, purchaseOrderLine, quoteLine, sql,
  stockBalance, stockMove, supplierBill, timeEntry, warehouse, workOrder, type SQL, type Tx,
} from '@mmc/db';
import { agingBucket, halalasToFixed, riyadhDate, toHalalas, type AgingBucket } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { backOffice } from '../common/backoffice.js';
import { tenantTx } from '../common/db.js';
import { ZodPipe } from '../common/zod.js';
import { OPEN_PO, canCost } from './inventory.service.js';
import { loadProject, projectScope } from './projects.service.js';

/**
 * Finance & project-profitability dashboards (modules 08/10) computed from MMC Core's own records.
 * They are management views, not accounting: the books (GL, AP/AR ledgers, VAT) live in ERPNext.
 *
 * Formulas (all SAR):
 *  - invoiced net (revenue) per invoice: 386 = taxable · 388 = taxable − prepaid × taxable/total (the
 *    advances already counted by their 386) · 381 = −|taxable| · 383 = taxable. "Gross" is the same with
 *    totals (VAT included) and is the basis for DSO, so it matches AR (balances incl. VAT).
 *  - DSO = AR outstanding ÷ gross invoiced in the last 90 days × 90.
 *  - project contract value = contract total − VAT + client-signed change orders (subtotal delta).
 *  - material cost = Σ(issue_project + consume_wo − return) qty × unit cost on project-linked moves.
 *  - committed = open project PO lines (approved/sent/partially received): unreceived qty × price × rate.
 *  - labour = time-entry hours on the project's work orders × LABOUR_RATE_SAR.
 *  - estimate at completion: margin = contract value − (material + committed + labour).
 */

/** Loaded hourly labour cost (SAR). A constant for now — to become a company setting. */
export const LABOUR_RATE_SAR = '120';
export const LOW_MARGIN_PERCENT = 20;
const SOURCE = { ar: 'من بيانات النظام — الدفاتر المحاسبية في ERPNext', en: 'From MMC Core data — the books live in ERPNext' };

type InvRow = Pick<typeof invoiceMirror.$inferSelect, 'typeCode' | 'taxable' | 'total' | 'prepaidAmount'>;

/** Revenue of one invoice mirror, net (excl. VAT) and gross (incl. VAT), in halalas — see the header. */
export function invoiceRevenue(i: InvRow): { net: number; gross: number } {
  const taxable = toHalalas(i.taxable);
  const total = toHalalas(i.total);
  const prepaid = toHalalas(i.prepaidAmount);
  switch (i.typeCode) {
    case '388': return { net: taxable - (total !== 0 ? Math.round((prepaid * taxable) / total) : 0), gross: total - prepaid };
    case '381': return { net: -Math.abs(taxable), gross: -Math.abs(total) };
    default: return { net: taxable, gross: total };
  }
}

function monthKeys(n: number, to = riyadhDate()): string[] {
  const out: string[] = [];
  const d = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.unshift(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function daysAgo(n: number, from = riyadhDate()) {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const fx = halalasToFixed;
const sumH = (v: string | null | undefined) => toHalalas(v ?? '0');

// ───────────────────────── project profitability ─────────────────────────

interface ProjectFigures {
  contractValue: number; invoiced: number; collected: number; material: number; committed: number; labourHours: string; labour: number; quoteCost: number | null;
}

/** Aggregates per project id (halalas), a handful of grouped queries for any number of projects. */
async function projectFigures(tx: Tx, rows: { id: string; contractId: string | null }[]): Promise<Map<string, ProjectFigures>> {
  const out = new Map<string, ProjectFigures>();
  for (const r of rows) out.set(r.id, { contractValue: 0, invoiced: 0, collected: 0, material: 0, committed: 0, labourHours: '0', labour: 0, quoteCost: null });
  const ids = rows.map((r) => r.id);
  if (!ids.length) return out;
  const byContract = new Map(rows.filter((r) => r.contractId).map((r) => [r.contractId!, r.id]));
  const contractIds = [...byContract.keys()];

  if (contractIds.length) {
    for (const c of await tx.select({ id: contract.id, total: contract.total, vat: contract.vatAmount, quoteId: contract.quoteId }).from(contract).where(inArray(contract.id, contractIds))) {
      out.get(byContract.get(c.id)!)!.contractValue = sumH(c.total) - sumH(c.vat);
    }
    for (const co of await tx.select({ contractId: changeOrder.contractId, v: sql<string>`sum(${changeOrder.subtotalDelta})::text` }).from(changeOrder)
      .where(and(inArray(changeOrder.contractId, contractIds), inArray(changeOrder.status, ['signed', 'billed']))).groupBy(changeOrder.contractId)) {
      out.get(byContract.get(co.contractId)!)!.contractValue += sumH(co.v);
    }
    for (const i of await tx.select({ contractId: invoiceMirror.contractId, typeCode: invoiceMirror.typeCode, taxable: invoiceMirror.taxable, total: invoiceMirror.total, prepaidAmount: invoiceMirror.prepaidAmount })
      .from(invoiceMirror).where(and(inArray(invoiceMirror.contractId, contractIds), ne(invoiceMirror.status, 'cancelled')))) {
      out.get(byContract.get(i.contractId!)!)!.invoiced += invoiceRevenue(i).net;
    }
    for (const p of await tx.select({ contractId: paymentRequest.contractId, v: sql<string>`sum(${paymentMirror.amount})::text` }).from(paymentMirror)
      .innerJoin(paymentRequest, eq(paymentRequest.id, paymentMirror.paymentRequestId)).where(inArray(paymentRequest.contractId, contractIds)).groupBy(paymentRequest.contractId)) {
      out.get(byContract.get(p.contractId!)!)!.collected += sumH(p.v);
    }
    // quote cost: Σ unitCost × qty of the non-optional quote lines that carry a cost
    for (const q of await tx.select({ contractId: contract.id, v: sql<string | null>`round(sum(${quoteLine.unitCost} * ${quoteLine.qty}) filter (where ${quoteLine.unitCost} is not null), 2)::text` })
      .from(contract).innerJoin(quoteLine, eq(quoteLine.quoteId, contract.quoteId))
      .where(and(inArray(contract.id, contractIds), eq(quoteLine.isOptional, false))).groupBy(contract.id)) {
      if (q.v != null) out.get(byContract.get(q.contractId)!)!.quoteCost = sumH(q.v);
    }
  }
  for (const m of await tx.select({
    projectId: stockMove.projectId,
    v: sql<string>`round(coalesce(sum(case when ${stockMove.kind} = 'return' then -1 else 1 end * ${stockMove.qty} * ${stockMove.unitCostSar}), 0), 2)::text`,
  }).from(stockMove).where(and(inArray(stockMove.projectId, ids), inArray(stockMove.kind, ['issue_project', 'consume_wo', 'return']))).groupBy(stockMove.projectId)) {
    out.get(m.projectId!)!.material = sumH(m.v);
  }
  const lineProject = sql<string>`coalesce(${purchaseOrderLine.projectId}, ${purchaseOrder.projectId})`;
  for (const c of await tx.select({
    projectId: lineProject,
    v: sql<string>`round(coalesce(sum(greatest(${purchaseOrderLine.qty} - ${purchaseOrderLine.receivedQty}, 0) * ${purchaseOrderLine.unitPrice} * ${purchaseOrder.rateToSar}), 0), 2)::text`,
  }).from(purchaseOrderLine).innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId))
    .where(and(inArray(purchaseOrder.status, OPEN_PO), inArray(lineProject, ids))).groupBy(lineProject)) {
    const f = out.get(c.projectId);
    if (f) f.committed = sumH(c.v);
  }
  for (const t of await tx.select({
    projectId: workOrder.projectId,
    h: sql<string>`round(coalesce(sum(coalesce(${timeEntry.hours}, extract(epoch from (${timeEntry.endedAt} - ${timeEntry.startedAt})) / 3600.0)), 0), 2)::text`,
  }).from(timeEntry).innerJoin(workOrder, eq(workOrder.id, timeEntry.workOrderId)).where(inArray(workOrder.projectId, ids)).groupBy(workOrder.projectId)) {
    const f = out.get(t.projectId!)!;
    f.labourHours = Number(t.h).toFixed(2);
    f.labour = toHalalas(Number(t.h) * Number(LABOUR_RATE_SAR));
  }
  return out;
}

function profitView(f: ProjectFigures, cost: boolean) {
  const eacCost = f.material + f.committed + f.labour;
  const margin = f.contractValue - eacCost;
  const marginPct = f.contractValue > 0 ? Math.round((margin / f.contractValue) * 1000) / 10 : null;
  const flags: string[] = [];
  if (marginPct != null && marginPct < LOW_MARGIN_PERCENT) flags.push('low_margin');
  if (f.quoteCost != null && f.material + f.committed > f.quoteCost) flags.push('cost_overrun');
  const base = {
    contractValue: fx(f.contractValue), invoiced: fx(f.invoiced), collected: fx(f.collected), labourHours: f.labourHours,
    invoicedPct: f.contractValue > 0 ? Math.round((f.invoiced / f.contractValue) * 1000) / 10 : null,
  };
  if (!cost) return { ...base, costVisible: false as const };
  return {
    ...base, costVisible: true as const,
    materialCost: fx(f.material), committedCost: fx(f.committed), labourCost: fx(f.labour), quoteCost: f.quoteCost != null ? fx(f.quoteCost) : null,
    costAtCompletion: fx(eacCost), margin: fx(margin), marginPct, flags,
  };
}

const projectsQuery = z.object({ status: z.enum(['active', 'open', 'all']).default('open') });

@Controller('insights')
export class InsightsController {
  /** Finance dashboard (report.finance); supplier-side figures need purchase.cost.read. */
  @Get('finance')
  @Perm('report.finance')
  async finance(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ months: z.coerce.number().int().min(3).max(24).default(12) }))) q: { months: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const today = riyadhDate();
      const months = monthKeys(q.months, today);
      const from = `${months[0]}-01`;
      const since90 = daysAgo(90, today);
      const monthly = new Map(months.map((m) => [m, { month: m, collected: 0, invoicedNet: 0, invoicedGross: 0 }]));

      for (const p of await tx.select({ m: sql<string>`to_char(${paymentMirror.paidOn}, 'YYYY-MM')`, v: sql<string>`sum(${paymentMirror.amount})::text` }).from(paymentMirror).where(gte(paymentMirror.paidOn, from)).groupBy(sql`1`)) {
        const e = monthly.get(p.m);
        if (e) e.collected += sumH(p.v);
      }
      let gross90 = 0;
      const invs = await tx.select({ issueDate: invoiceMirror.issueDate, typeCode: invoiceMirror.typeCode, taxable: invoiceMirror.taxable, total: invoiceMirror.total, prepaidAmount: invoiceMirror.prepaidAmount })
        .from(invoiceMirror).where(and(gte(invoiceMirror.issueDate, from < since90 ? from : since90), ne(invoiceMirror.status, 'cancelled')));
      for (const i of invs) {
        const r = invoiceRevenue(i);
        const e = monthly.get(i.issueDate.slice(0, 7));
        if (e && i.issueDate >= from) { e.invoicedNet += r.net; e.invoicedGross += r.gross; }
        if (i.issueDate >= since90) gross90 += r.gross;
      }

      // AR outstanding + aging (same buckets as /finance/ar-aging)
      const buckets: Record<AgingBucket, number> = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
      let ar = 0;
      let arCount = 0;
      for (const i of await tx.select({ dueDate: invoiceMirror.dueDate, issueDate: invoiceMirror.issueDate, balanceDue: invoiceMirror.balanceDue }).from(invoiceMirror).where(sql`${invoiceMirror.balanceDue} > 0`)) {
        const v = sumH(i.balanceDue);
        buckets[agingBucket(i.dueDate ?? i.issueDate, today)] += v;
        ar += v;
        arCount++;
      }
      const topDebtors = await tx.select({ partyId: invoiceMirror.partyId, name: party.nameAr, v: sql<string>`sum(${invoiceMirror.balanceDue})::text` }).from(invoiceMirror)
        .leftJoin(party, eq(party.id, invoiceMirror.partyId)).where(sql`${invoiceMirror.balanceDue} > 0`).groupBy(invoiceMirror.partyId, party.nameAr).orderBy(sql`3 desc`).limit(5);

      const [pr] = await tx.select({
        count: sql<number>`count(*)::int`,
        outstanding: sql<string>`coalesce(sum(${paymentRequest.amount} - ${paymentRequest.paidAmount}), 0)::text`,
        overdueCount: sql<number>`count(*) filter (where ${paymentRequest.dueDate} < ${today})::int`,
        overdue: sql<string>`coalesce(sum(${paymentRequest.amount} - ${paymentRequest.paidAmount}) filter (where ${paymentRequest.dueDate} < ${today}), 0)::text`,
      }).from(paymentRequest).where(inArray(paymentRequest.status, ['sent', 'partially_paid']));

      const out = {
        source: SOURCE,
        backOffice: backOffice(actor.tenantId).kind,
        asOf: today,
        months: [...monthly.values()].map((m) => ({ month: m.month, collected: fx(m.collected), invoicedNet: fx(m.invoicedNet), invoicedGross: fx(m.invoicedGross) })),
        totals: {
          collected: fx([...monthly.values()].reduce((a, m) => a + m.collected, 0)),
          invoicedNet: fx([...monthly.values()].reduce((a, m) => a + m.invoicedNet, 0)),
        },
        ar: { outstanding: fx(ar), invoices: arCount, buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, fx(v)])) as Record<AgingBucket, string>, topDebtors: topDebtors.map((d) => ({ partyId: d.partyId, name: d.name ?? '—', outstanding: fx(sumH(d.v)) })) },
        dso: { days: gross90 > 0 ? Math.round((ar / gross90) * 90 * 10) / 10 : null, revenue90Gross: fx(gross90), formula: 'AR ÷ gross invoiced (last 90 days) × 90' },
        paymentRequests: { open: pr?.count ?? 0, outstanding: fx(sumH(pr?.outstanding)), overdueCount: pr?.overdueCount ?? 0, overdue: fx(sumH(pr?.overdue)) },
        costVisible: canCost(actor),
        ap: null as null | { open: string; bills: number },
        commitments: null as null | { open: string; orders: number },
        stock: null as null | { value: string; products: number; withoutCost: number },
      };
      if (canCost(actor)) {
        const [ap] = await tx.select({ n: sql<number>`count(*)::int`, v: sql<string>`coalesce(round(sum(${supplierBill.total} * ${supplierBill.rateToSar}), 2), 0)::text` }).from(supplierBill).where(eq(supplierBill.status, 'approved'));
        out.ap = { open: fx(sumH(ap?.v)), bills: ap?.n ?? 0 };
        const [cm] = await tx.select({
          n: sql<number>`count(distinct ${purchaseOrder.id})::int`,
          v: sql<string>`coalesce(round(sum(greatest(${purchaseOrderLine.qty} - ${purchaseOrderLine.receivedQty}, 0) * ${purchaseOrderLine.unitPrice} * ${purchaseOrder.rateToSar}), 2), 0)::text`,
        }).from(purchaseOrderLine).innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId)).where(inArray(purchaseOrder.status, OPEN_PO));
        out.commitments = { open: fx(sumH(cm?.v)), orders: cm?.n ?? 0 };
        const [st] = await tx.select({
          v: sql<string>`coalesce(round(sum(${stockBalance.qty} * coalesce(${product.avgCostSar}, 0)), 2), 0)::text`,
          n: sql<number>`count(distinct ${product.id}) filter (where ${stockBalance.qty} > 0)::int`,
          noCost: sql<number>`count(distinct ${product.id}) filter (where ${stockBalance.qty} > 0 and coalesce(${product.avgCostSar}, 0) = 0)::int`,
        }).from(stockBalance).innerJoin(warehouse, eq(warehouse.id, stockBalance.warehouseId)).innerJoin(product, eq(product.id, stockBalance.productId)).where(ne(warehouse.kind, 'quarantine'));
        out.stock = { value: fx(sumH(st?.v)), products: st?.n ?? 0, withoutCost: st?.noCost ?? 0 };
      }
      return out;
    });
  }

  /** Profitability per project (project.read scope); cost fields only with purchase.cost.read. */
  @Get('projects')
  @Perm('project.read')
  async projects(@Actor() actor: RequestActor, @Query(new ZodPipe(projectsQuery)) q: { status: 'active' | 'open' | 'all' }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const conds: (SQL | undefined)[] = [projectScope(actor, 'project.read')];
      if (q.status === 'active') conds.push(eq(project.status, 'active'));
      if (q.status === 'open') conds.push(sql`${project.status} not in ('closed', 'cancelled')`);
      const rows = await tx.select({ id: project.id, number: project.number, name: project.name, stage: project.stage, status: project.status, contractId: project.contractId, contractNumber: contract.number, customer: party.nameAr })
        .from(project).leftJoin(contract, eq(contract.id, project.contractId)).leftJoin(party, eq(party.id, project.partyId)).where(and(...conds)).orderBy(asc(project.number));
      const figs = await projectFigures(tx, rows);
      const cost = canCost(actor);
      const list = rows.map((r) => ({ ...r, ...profitView(figs.get(r.id)!, cost) }));
      const tot = [...figs.values()].reduce((a, f) => ({ contractValue: a.contractValue + f.contractValue, invoiced: a.invoiced + f.invoiced, collected: a.collected + f.collected, material: a.material + f.material, committed: a.committed + f.committed, labour: a.labour + f.labour }), { contractValue: 0, invoiced: 0, collected: 0, material: 0, committed: 0, labour: 0 });
      const totalCost = tot.material + tot.committed + tot.labour;
      return {
        source: SOURCE,
        assumptions: { labourRateSar: Number(LABOUR_RATE_SAR).toFixed(2), lowMarginPercent: LOW_MARGIN_PERCENT },
        costVisible: cost,
        rows: list,
        totals: {
          projects: rows.length, contractValue: fx(tot.contractValue), invoiced: fx(tot.invoiced), collected: fx(tot.collected),
          ...(cost ? { materialCost: fx(tot.material), committedCost: fx(tot.committed), labourCost: fx(tot.labour), costAtCompletion: fx(totalCost), margin: fx(tot.contractValue - totalCost), marginPct: tot.contractValue > 0 ? Math.round(((tot.contractValue - totalCost) / tot.contractValue) * 1000) / 10 : null } : {}),
        },
      };
    });
  }

  /** One project with per-product material detail and open project POs (costs need purchase.cost.read). */
  @Get('projects/:id')
  @Perm('project.read')
  async project(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProject(tx, actor, id, 'project.read');
      const figs = (await projectFigures(tx, [{ id: p.id, contractId: p.contractId }])).get(p.id)!;
      const cost = canCost(actor);
      const base = { source: SOURCE, assumptions: { labourRateSar: Number(LABOUR_RATE_SAR).toFixed(2), lowMarginPercent: LOW_MARGIN_PERCENT }, id: p.id, number: p.number, name: p.name, stage: p.stage, status: p.status, ...profitView(figs, cost) };
      if (!cost) return base;
      const materials = await tx.select({
        productId: stockMove.productId, code: product.code, name: product.nameAr,
        issuedQty: sql<string>`coalesce(sum(${stockMove.qty}) filter (where ${stockMove.kind} in ('issue_project', 'consume_wo')), 0)::text`,
        returnedQty: sql<string>`coalesce(sum(${stockMove.qty}) filter (where ${stockMove.kind} = 'return'), 0)::text`,
        cost: sql<string>`round(coalesce(sum(case when ${stockMove.kind} = 'return' then -1 else 1 end * ${stockMove.qty} * ${stockMove.unitCostSar}), 0), 2)::text`,
      }).from(stockMove).innerJoin(product, eq(product.id, stockMove.productId))
        .where(and(eq(stockMove.projectId, p.id), inArray(stockMove.kind, ['issue_project', 'consume_wo', 'return']))).groupBy(stockMove.productId, product.code, product.nameAr).orderBy(asc(product.code));
      const lineProject = sql`coalesce(${purchaseOrderLine.projectId}, ${purchaseOrder.projectId})`;
      const committed = await tx.select({
        orderId: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status, code: purchaseOrderLine.code,
        openQty: sql<string>`greatest(${purchaseOrderLine.qty} - ${purchaseOrderLine.receivedQty}, 0)::text`,
        valueSar: sql<string>`round(greatest(${purchaseOrderLine.qty} - ${purchaseOrderLine.receivedQty}, 0) * ${purchaseOrderLine.unitPrice} * ${purchaseOrder.rateToSar}, 2)::text`,
      }).from(purchaseOrderLine).innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId))
        .where(and(inArray(purchaseOrder.status, OPEN_PO), sql`${lineProject} = ${p.id}`, sql`${purchaseOrderLine.qty} > ${purchaseOrderLine.receivedQty}`)).orderBy(asc(purchaseOrder.number), asc(purchaseOrderLine.sort));
      return {
        ...base,
        materials: materials.map((m) => ({ ...m, netQty: (Number(m.issuedQty) - Number(m.returnedQty)).toString() })),
        committedLines: committed,
      };
    });
  }
}
