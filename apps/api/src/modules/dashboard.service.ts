import {
  activity, and, appUser, billingMilestone, contract, desc, eq, gte, inArray, invoiceMirror, isNotNull, isNull, lead, lt, lte, ne, opportunity, or, party, paymentMirror,
  paymentRequest, pipelineStage, product, project, projectApproval, purchaseOrder, quote, serviceAgreement, snag, sql, supplierBill, ticket, workOrder, type SQL, type Tx,
} from '@mmc/db';
import { PROJECT_STAGES, halalasToFixed, riyadhDate, toHalalas, type Permission, type ProjectStage } from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { scopeFilter } from '../common/scope.js';
import { loadCalendar } from './calendar.controller.js';
import { ticketFilter, woFilter } from './field-service.service.js';
import { invoiceRevenue } from './insights.controller.js';
import { canCost, quantities } from './inventory.service.js';
import { loadFacts, projectClock, projectScope } from './projects.service.js';
import { slaFilter } from './service.service.js';

/**
 * Home "control room" (module 10): what needs action today, where the cash is, how the period
 * converts quote → collection, which projects are at risk and how the business trends.
 *
 * Every section is computed only when the viewer holds its permission, and always under that
 * permission's record scope; a section the viewer cannot read comes back as null (or is left out of
 * the action list), never as zeros. Cost and margin need quote.cost.read; supplier amounts need
 * purchase.cost.read. Money is SAR as fixed 2-dp strings (halalas internally).
 */

export interface Period { from: string; to: string }

/** A pending item for the "needs action" inbox. `sub` is a secondary count whose meaning depends on the key. */
export interface ActionItem { key: string; severity: 'critical' | 'warning' | 'info'; count: number; amount: string | null; sub: number | null; href: string }

const CONTRACTED = ['signed', 'active', 'completed'];
const OPEN_REQUEST = ['sent', 'partially_paid'];
const OPEN_BILL = ['approved', 'partially_paid'];
const fx = halalasToFixed;
const H = (v: string | number | null | undefined) => toHalalas(String(v ?? '0'));

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** The equal-length period just before `p` (deltas). */
export function previousPeriod(p: Period): Period {
  const len = daysBetween(p.from, p.to) + 1;
  const to = addDays(p.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}

/** Trend granularity by range length: weeks (Sun–Sat, clipped) up to ~6 weeks, months up to 2 years, then quarters. */
export function trendBuckets(p: Period): { granularity: 'week' | 'month' | 'quarter'; buckets: { key: string; from: string; to: string }[] } {
  const days = daysBetween(p.from, p.to) + 1;
  const granularity = days <= 45 ? 'week' : days <= 731 ? 'month' : 'quarter';
  const buckets: { key: string; from: string; to: string }[] = [];
  let cur = p.from;
  while (cur <= p.to) {
    const d = new Date(`${cur}T00:00:00Z`);
    let end: string;
    if (granularity === 'week') end = addDays(cur, 6 - d.getUTCDay());
    else {
      const months = granularity === 'month' ? 1 : 3 - (d.getUTCMonth() % 3);
      end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 0)).toISOString().slice(0, 10);
    }
    if (end > p.to) end = p.to;
    buckets.push({ key: cur, from: cur, to: end });
    cur = addDays(end, 1);
  }
  return { granularity, buckets };
}

/** Scope of a permission, or null when the viewer lacks it (section hidden). */
function scope(actor: RequestActor, perm: Permission, cols: Parameters<typeof scopeFilter>[2]): { where: SQL | undefined } | null {
  return actor.grants[perm] ? { where: scopeFilter(actor, perm, cols) } : null;
}

/** Payment requests: contract requests follow the contract's owner/team, AMC requests the agreement's (as /finance/payment-requests). */
function requestScope(actor: RequestActor): SQL | undefined {
  const byContract = scopeFilter(actor, 'billing.read', { owner: contract.ownerId, team: contract.teamId });
  if (!byContract) return undefined;
  const byAgreement = scopeFilter(actor, 'billing.read', { owner: serviceAgreement.ownerId, team: serviceAgreement.teamId });
  return or(and(isNotNull(paymentRequest.contractId), byContract), and(isNotNull(paymentRequest.agreementId), byAgreement));
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export async function homeDashboard(tx: Tx, actor: RequestActor, period: Period) {
  const g = actor.grants;
  const today = riyadhDate();
  const prev = previousPeriod(period);
  const seeMargin = !!g['quote.cost.read'];
  const actions: ActionItem[] = [];
  const push = (a: Omit<ActionItem, 'amount' | 'sub'> & { amount?: string | null; sub?: number | null }) => {
    if (a.count > 0) actions.push({ amount: null, sub: null, ...a });
  };

  // ───────────── sales (quote.read) ─────────────
  const qs = scope(actor, 'quote.read', { owner: quote.ownerId, team: quote.teamId, branch: quote.branchId });
  const quoteWhere = (p: Period) => and(qs?.where, gte(quote.quoteDate, p.from), lte(quote.quoteDate, p.to), ne(quote.status, 'superseded'));
  const salesAgg = async (p: Period) => {
    const [r] = await tx.select({
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${quote.total}),0)::text`,
      accepted: sql<number>`count(*) filter (where ${quote.status} = 'accepted')::int`,
      acceptedValue: sql<string>`coalesce(sum(${quote.total}) filter (where ${quote.status} = 'accepted'),0)::text`,
      lost: sql<number>`count(*) filter (where ${quote.status} in ('lost','rejected'))::int`,
      avgDiscount: sql<string>`coalesce(avg(case when ${quote.subtotal} > 0 then ${quote.discountAmount} / ${quote.subtotal} * 100 end),0)::text`,
      margin: sql<string>`coalesce(sum(${quote.marginTotal}) filter (where ${quote.costTotal} > 0),0)::text`,
      marginBase: sql<string>`coalesce(sum(${quote.taxable}) filter (where ${quote.costTotal} > 0),0)::text`,
    }).from(quote).where(quoteWhere(p));
    const decided = (r?.accepted ?? 0) + (r?.lost ?? 0);
    return {
      count: r?.count ?? 0, value: fx(H(r?.value)), accepted: r?.accepted ?? 0, acceptedValue: fx(H(r?.acceptedValue)), lost: r?.lost ?? 0,
      winRate: decided ? pct(r?.accepted ?? 0, decided) : null,
      avgDiscountPercent: Math.round(Number(r?.avgDiscount ?? 0) * 10) / 10,
      marginPercent: seeMargin && Number(r?.marginBase) > 0 ? Math.round((Number(r?.margin) / Number(r?.marginBase)) * 1000) / 10 : null,
    };
  };

  let sales: null | (Awaited<ReturnType<typeof salesAgg>> & { prev: Awaited<ReturnType<typeof salesAgg>>; pipelineWeighted: string | null; openOpportunities: number | null; newLeads: number | null }) = null;
  let team: null | { id: string; name: string; quotes: number; won: number; lost: number; winRate: number | null; value: string; wonValue: string; avgDiscountPercent: number; marginPercent: number | null }[] = null;
  if (qs) {
    const cur = await salesAgg(period);
    const before = await salesAgg(prev);
    const os = scope(actor, 'opportunity.read', { owner: opportunity.ownerId, team: opportunity.teamId });
    const [pipe] = os ? await tx.select({ n: sql<number>`count(*)::int`, w: sql<string>`coalesce(sum(${opportunity.amount} * ${opportunity.probability} / 100.0),0)::text` })
      .from(opportunity).innerJoin(pipelineStage, eq(pipelineStage.id, opportunity.stageId)).where(and(os.where, eq(pipelineStage.kind, 'open'))) : [];
    const ls = scope(actor, 'lead.read', { owner: lead.ownerId, team: lead.teamId });
    const [leads] = ls ? await tx.select({ n: sql<number>`count(*)::int` }).from(lead)
      .where(and(ls.where, gte(lead.createdAt, new Date(`${period.from}T00:00:00+03:00`)), lte(lead.createdAt, new Date(`${period.to}T23:59:59.999+03:00`)))) : [];
    sales = { ...cur, prev: before, pipelineWeighted: pipe ? fx(H(pipe.w)) : null, openOpportunities: pipe ? pipe.n : null, newLeads: leads ? leads.n : null };

    const reps = await tx.select({
      id: appUser.id, name: sql<string>`coalesce(${appUser.nameAr}, ${appUser.email})`,
      quotes: sql<number>`count(*)::int`,
      won: sql<number>`count(*) filter (where ${quote.status} = 'accepted')::int`,
      lost: sql<number>`count(*) filter (where ${quote.status} in ('lost','rejected'))::int`,
      value: sql<string>`coalesce(sum(${quote.total}),0)::text`,
      wonValue: sql<string>`coalesce(sum(${quote.total}) filter (where ${quote.status} = 'accepted'),0)::text`,
      avgDiscount: sql<string>`coalesce(avg(case when ${quote.subtotal} > 0 then ${quote.discountAmount} / ${quote.subtotal} * 100 end),0)::text`,
      margin: sql<string>`coalesce(sum(${quote.marginTotal}) filter (where ${quote.costTotal} > 0),0)::text`,
      marginBase: sql<string>`coalesce(sum(${quote.taxable}) filter (where ${quote.costTotal} > 0),0)::text`,
    }).from(quote).innerJoin(appUser, eq(appUser.id, quote.ownerId)).where(quoteWhere(period)).groupBy(appUser.id).orderBy(desc(sql`sum(${quote.total})`));
    team = reps.map((r) => ({
      id: r.id, name: r.name, quotes: r.quotes, won: r.won, lost: r.lost, winRate: r.won + r.lost ? pct(r.won, r.won + r.lost) : null,
      value: fx(H(r.value)), wonValue: fx(H(r.wonValue)), avgDiscountPercent: Math.round(Number(r.avgDiscount) * 10) / 10,
      marginPercent: seeMargin && Number(r.marginBase) > 0 ? Math.round((Number(r.margin) / Number(r.marginBase)) * 1000) / 10 : null,
    }));

    // quotes about to lapse: sent/viewed, valid until within a week
    const [exp] = await tx.select({ n: sql<number>`count(*)::int`, v: sql<string>`coalesce(sum(${quote.total}),0)::text` }).from(quote)
      .where(and(qs.where, inArray(quote.status, ['sent', 'viewed']), gte(quote.validUntil, today), lte(quote.validUntil, addDays(today, 7))));
    push({ key: 'quotes_expiring', severity: 'warning', count: exp?.n ?? 0, amount: fx(H(exp?.v)), href: '/quotes?status=sent,viewed' });
  }
  const qa = scope(actor, 'quote.approve', { owner: quote.ownerId, team: quote.teamId, branch: quote.branchId });
  if (qa) {
    const [r] = await tx.select({ n: sql<number>`count(*)::int`, v: sql<string>`coalesce(sum(${quote.total}),0)::text` }).from(quote).where(and(qa.where, eq(quote.status, 'pending_approval')));
    push({ key: 'quotes_pending_approval', severity: 'warning', count: r?.n ?? 0, amount: fx(H(r?.v)), href: '/quotes?status=pending_approval' });
  }

  // ───────────── funnel: what became of the quotes dated in the period ─────────────
  let funnel: null | { key: string; value: string; fromPrev: number | null; ofQuoted: number | null }[] = null;
  if (qs && sales) {
    const cohortQ = tx.select({ id: quote.id }).from(quote).where(quoteWhere(period));
    const cohortC = tx.select({ id: contract.id }).from(contract).where(and(inArray(contract.quoteId, cohortQ), inArray(contract.status, CONTRACTED)));
    const steps: { key: string; h: number }[] = [];
    steps.push({ key: 'quoted', h: H(sales.value) }, { key: 'accepted', h: H(sales.acceptedValue) });
    if (g['contract.read']) {
      const [c] = await tx.select({ v: sql<string>`coalesce(sum(${contract.total}),0)::text` }).from(contract).where(and(inArray(contract.quoteId, cohortQ), inArray(contract.status, CONTRACTED)));
      steps.push({ key: 'contracted', h: H(c?.v) });
      if (g['invoice.read']) {
        const invs = await tx.select({ typeCode: invoiceMirror.typeCode, taxable: invoiceMirror.taxable, total: invoiceMirror.total, prepaidAmount: invoiceMirror.prepaidAmount })
          .from(invoiceMirror).where(and(inArray(invoiceMirror.contractId, cohortC), ne(invoiceMirror.status, 'cancelled')));
        steps.push({ key: 'invoiced', h: invs.reduce((a, i) => a + invoiceRevenue(i).gross, 0) });
      }
      if (g['billing.read']) {
        const [p] = await tx.select({ v: sql<string>`coalesce(sum(${paymentRequest.paidAmount}),0)::text` }).from(paymentRequest)
          .where(and(inArray(paymentRequest.contractId, cohortC), ne(paymentRequest.status, 'cancelled')));
        steps.push({ key: 'collected', h: H(p?.v) });
      }
    }
    const quoted = steps[0]!.h;
    funnel = steps.map((x, i) => ({ key: x.key, value: fx(x.h), fromPrev: i ? pct(x.h, steps[i - 1]!.h) : null, ofQuoted: i ? pct(x.h, quoted) : null }));
  }

  // ───────────── cash ─────────────
  const collectedIn = async (p: Period) => {
    const rs = requestScope(actor);
    const [r] = await tx.select({ v: sql<string>`coalesce(sum(${paymentMirror.amount}),0)::text` }).from(paymentMirror)
      .leftJoin(paymentRequest, eq(paymentRequest.id, paymentMirror.paymentRequestId)).leftJoin(contract, eq(contract.id, paymentRequest.contractId))
      .leftJoin(serviceAgreement, eq(serviceAgreement.id, paymentRequest.agreementId))
      .where(and(gte(paymentMirror.paidOn, p.from), lte(paymentMirror.paidOn, p.to), rs));
    return H(r?.v);
  };
  const cash: {
    collected: { value: string; prev: string } | null;
    receivables: { outstanding: string; overdue: string; requests: string | null; invoices: string | null } | null;
    expected: { d14: string; d30: string; scheduled30: string } | null;
    payables: { owed: string; overdue: string; d14: string; d30: string } | null;
  } = { collected: null, receivables: null, expected: null, payables: null };

  let recOut = 0;
  let recOverdue = 0;
  if (g['billing.read']) {
    cash.collected = { value: fx(await collectedIn(period)), prev: fx(await collectedIn(prev)) };
    const rem = sql`(${paymentRequest.amount} - ${paymentRequest.paidAmount})`;
    const [pr] = await tx.select({
      open: sql<string>`coalesce(sum(${rem}),0)::text`,
      overdue: sql<string>`coalesce(sum(${rem}) filter (where ${paymentRequest.dueDate} < ${today}),0)::text`,
      overdueN: sql<number>`count(*) filter (where ${paymentRequest.dueDate} < ${today})::int`,
      d14: sql<string>`coalesce(sum(${rem}) filter (where ${paymentRequest.dueDate} between ${today} and ${addDays(today, 14)}),0)::text`,
      d30: sql<string>`coalesce(sum(${rem}) filter (where ${paymentRequest.dueDate} between ${today} and ${addDays(today, 30)}),0)::text`,
    }).from(paymentRequest).leftJoin(contract, eq(contract.id, paymentRequest.contractId)).leftJoin(serviceAgreement, eq(serviceAgreement.id, paymentRequest.agreementId))
      .where(and(inArray(paymentRequest.status, OPEN_REQUEST), requestScope(actor)));
    // milestones not requested yet but scheduled in the next 30 days (or already due → "to bill")
    const ms = scopeFilter(actor, 'billing.read', { owner: contract.ownerId, team: contract.teamId });
    const [m] = await tx.select({
      d14: sql<string>`coalesce(sum(${billingMilestone.amount}) filter (where ${billingMilestone.dueDate} between ${today} and ${addDays(today, 14)}),0)::text`,
      d30: sql<string>`coalesce(sum(${billingMilestone.amount}) filter (where ${billingMilestone.dueDate} between ${today} and ${addDays(today, 30)}),0)::text`,
      dueN: sql<number>`count(*) filter (where ${billingMilestone.dueDate} < ${today})::int`,
      due: sql<string>`coalesce(sum(${billingMilestone.amount}) filter (where ${billingMilestone.dueDate} < ${today}),0)::text`,
    }).from(billingMilestone).innerJoin(contract, eq(contract.id, billingMilestone.contractId))
      .where(and(eq(billingMilestone.status, 'pending'), isNotNull(billingMilestone.dueDate), inArray(contract.status, CONTRACTED), ms));
    recOut += H(pr?.open);
    recOverdue += H(pr?.overdue);
    cash.expected = { d14: fx(H(pr?.d14) + H(m?.d14)), d30: fx(H(pr?.d30) + H(m?.d30)), scheduled30: fx(H(m?.d30)) };
    cash.receivables = { outstanding: '0', overdue: '0', requests: fx(H(pr?.open)), invoices: null };
    push({ key: 'payment_requests_overdue', severity: 'critical', count: pr?.overdueN ?? 0, amount: fx(H(pr?.overdue)), href: '/finance/requests' });
    if (g['billing.write']) push({ key: 'milestones_to_bill', severity: 'warning', count: m?.dueN ?? 0, amount: fx(H(m?.due)), href: '/contracts?status=signed,active' });
  }
  if (g['invoice.read']) {
    // invoice balances not already counted through an open payment request
    const [inv] = await tx.select({
      open: sql<string>`coalesce(sum(${invoiceMirror.balanceDue}),0)::text`,
      overdue: sql<string>`coalesce(sum(${invoiceMirror.balanceDue}) filter (where coalesce(${invoiceMirror.dueDate}, ${invoiceMirror.issueDate}) < ${today}),0)::text`,
      overdueN: sql<number>`count(*) filter (where coalesce(${invoiceMirror.dueDate}, ${invoiceMirror.issueDate}) < ${today})::int`,
    }).from(invoiceMirror).leftJoin(party, eq(party.id, invoiceMirror.partyId))
      .where(and(sql`${invoiceMirror.balanceDue} > 0`, ne(invoiceMirror.status, 'cancelled'), scopeFilter(actor, 'invoice.read', { owner: party.ownerId }),
        sql`not exists (select 1 from payment_request r where r.id = ${invoiceMirror.paymentRequestId} and r.status in ('sent','partially_paid'))`));
    recOut += H(inv?.open);
    recOverdue += H(inv?.overdue);
    cash.receivables = { outstanding: '0', overdue: '0', requests: cash.receivables?.requests ?? null, invoices: fx(H(inv?.open)) };
    push({ key: 'invoices_overdue', severity: 'critical', count: inv?.overdueN ?? 0, amount: fx(H(inv?.overdue)), href: '/finance/aging' });
  }
  if (cash.receivables) Object.assign(cash.receivables, { outstanding: fx(recOut), overdue: fx(recOverdue) });

  if (g['purchase.read']) {
    const owed = sql`round((${supplierBill.total} - ${supplierBill.paidAmount}) * ${supplierBill.rateToSar}, 2)`;
    const due = sql`coalesce(${supplierBill.dueDate}, ${supplierBill.billDate})`;
    const [b] = await tx.select({
      owed: sql<string>`coalesce(sum(${owed}),0)::text`,
      overdue: sql<string>`coalesce(sum(${owed}) filter (where ${due} < ${today}),0)::text`,
      overdueN: sql<number>`count(*) filter (where ${due} < ${today})::int`,
      weekN: sql<number>`count(*) filter (where ${due} between ${today} and ${addDays(today, 7)})::int`,
      week: sql<string>`coalesce(sum(${owed}) filter (where ${due} between ${today} and ${addDays(today, 7)}),0)::text`,
      d14: sql<string>`coalesce(sum(${owed}) filter (where ${due} between ${today} and ${addDays(today, 14)}),0)::text`,
      d30: sql<string>`coalesce(sum(${owed}) filter (where ${due} between ${today} and ${addDays(today, 30)}),0)::text`,
    }).from(supplierBill).where(inArray(supplierBill.status, OPEN_BILL));
    const cost = canCost(actor);
    if (cost) cash.payables = { owed: fx(H(b?.owed)), overdue: fx(H(b?.overdue)), d14: fx(H(b?.d14)), d30: fx(H(b?.d30)) };
    push({ key: 'bills_overdue', severity: 'critical', count: b?.overdueN ?? 0, amount: cost ? fx(H(b?.overdue)) : null, href: '/purchasing/bills?view=overdue' });
    push({ key: 'bills_due_week', severity: 'warning', count: b?.weekN ?? 0, amount: cost ? fx(H(b?.week)) : null, href: '/purchasing/bills?view=unpaid' });
  }
  if (g['purchase.approve']) {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(purchaseOrder).where(eq(purchaseOrder.status, 'pending_approval'));
    push({ key: 'pos_pending_approval', severity: 'warning', count: r?.n ?? 0, href: '/purchasing/orders?status=pending_approval' });
  }
  // store/purchasing view (technicians with own-van inventory don't see replenishment)
  if (g['inventory.read'] && (g['purchase.read'] || g['inventory.read'] !== 'own')) {
    const prods = await tx.select({ id: product.id, reorderLevel: product.reorderLevel }).from(product).where(and(isNull(product.archivedAt), isNotNull(product.reorderLevel)));
    const qmap = await quantities(tx, prods.map((p) => p.id), null);
    const below = prods.filter((p) => {
      const x = qmap.get(p.id)!;
      return x.onHand.minus(x.reserved).plus(x.incoming).lt(p.reorderLevel!);
    }).length;
    push({ key: 'stock_below_reorder', severity: 'warning', count: below, href: '/inventory?tab=reorder' });
  }

  // ───────────── contracts awaiting signature ─────────────
  const cs = scope(actor, 'contract.read', { owner: contract.ownerId, team: contract.teamId, branch: contract.branchId });
  if (cs) {
    const [r] = await tx.select({ n: sql<number>`count(*)::int`, v: sql<string>`coalesce(sum(${contract.total}),0)::text` }).from(contract).where(and(cs.where, eq(contract.status, 'sent_for_signature')));
    push({ key: 'contracts_awaiting_signature', severity: 'info', count: r?.n ?? 0, amount: fx(H(r?.v)), href: '/contracts?status=sent_for_signature' });
  }

  // ───────────── projects ─────────────
  type AtRisk = { id: string; number: string; name: string; customer: string | null; stage: string; level: string; elapsed: number; maxDays: number; targetMax: string | null; paused: boolean };
  let projects: null | {
    total: number; byStage: Record<ProjectStage, number>; onHold: number; clocks: Record<string, number>; openSnags: number; approvalsPending: number; atRisk: AtRisk[];
  } = null;
  if (g['project.read']) {
    const rows = await tx.select({ p: project, customer: party.nameAr }).from(project).leftJoin(party, eq(party.id, project.partyId))
      .where(and(projectScope(actor, 'project.read'), inArray(project.status, ['active', 'on_hold'])));
    const byStage = Object.fromEntries(PROJECT_STAGES.map((s) => [s, 0])) as Record<ProjectStage, number>;
    const clocks: Record<string, number> = { not_started: 0, ok: 0, warn70: 0, warn90: 0, overdue: 0, stopped: 0 };
    const atRisk: AtRisk[] = [];
    const calendar = rows.length ? await loadCalendar(tx) : null;
    for (const { p, customer } of rows) {
      byStage[p.stage as ProjectStage] = (byStage[p.stage as ProjectStage] ?? 0) + 1;
      // kick-off projects without a stored start need the facts (the clock may already run there)
      const facts = !p.clockStartedOn && p.stage === 'kickoff' ? (await loadFacts(tx, p)).facts : null;
      const { clock } = await projectClock(tx, p, facts, calendar!);
      clocks[clock.level] = (clocks[clock.level] ?? 0) + 1;
      if (['warn70', 'warn90', 'overdue'].includes(clock.level)) {
        atRisk.push({ id: p.id, number: p.number, name: p.name, customer, stage: p.stage, level: clock.level, elapsed: clock.elapsed, maxDays: clock.maxDays, targetMax: clock.targetMax, paused: clock.paused });
      }
    }
    atRisk.sort((a, b) => b.elapsed / (b.maxDays || 1) - a.elapsed / (a.maxDays || 1));
    const ids = rows.map((r) => r.p.id);
    const [sn] = ids.length ? await tx.select({ open: sql<number>`count(*)::int`, overdue: sql<number>`count(*) filter (where ${snag.status} = 'open' and ${snag.dueDate} < ${today})::int` })
      .from(snag).where(and(inArray(snag.projectId, ids), ne(snag.status, 'verified'))) : [];
    const [ap] = ids.length ? await tx.select({ n: sql<number>`count(*)::int` }).from(projectApproval).where(and(inArray(projectApproval.projectId, ids), eq(projectApproval.status, 'sent'))) : [];
    const onHold = rows.filter((r) => r.p.status === 'on_hold').length;
    projects = { total: rows.length, byStage, onHold, clocks, openSnags: sn?.open ?? 0, approvalsPending: ap?.n ?? 0, atRisk: atRisk.slice(0, 6) };

    const only = (lvl: string) => atRisk.filter((x) => x.level === lvl);
    const href = (list: { id: string }[]) => (list.length === 1 ? `/projects/${list[0]!.id}` : '/projects');
    push({ key: 'projects_clock_overdue', severity: 'critical', count: only('overdue').length, href: href(only('overdue')) });
    push({ key: 'projects_clock_warn', severity: 'warning', count: only('warn90').length, href: href(only('warn90')) });
    push({ key: 'snags_open', severity: (sn?.overdue ?? 0) > 0 ? 'warning' : 'info', count: sn?.open ?? 0, sub: sn?.overdue ?? 0, href: '/projects' });
    push({ key: 'client_approvals_pending', severity: 'info', count: ap?.n ?? 0, href: '/projects' });
    push({ key: 'projects_on_hold', severity: 'info', count: onHold, href: '/projects' });
  }

  // ───────────── field service ─────────────
  if (g['ticket.read']) {
    const tf = ticketFilter(actor, 'ticket.read');
    const open = inArray(ticket.status, ['open', 'in_progress']);
    const [br] = await tx.select({ n: sql<number>`count(*)::int` }).from(ticket).where(and(tf, open, slaFilter('breached')));
    const [ar] = await tx.select({ n: sql<number>`count(*)::int` }).from(ticket).where(and(tf, open, slaFilter('at_risk')));
    push({ key: 'tickets_sla_breached', severity: 'critical', count: br?.n ?? 0, href: '/field/tickets?sla=breached' });
    push({ key: 'tickets_sla_at_risk', severity: 'warning', count: ar?.n ?? 0, href: '/field/tickets?sla=at_risk' });
  }
  if (g['workorder.read']) {
    const wf = woFilter(actor, 'workorder.read');
    const [w] = await tx.select({
      unassigned: sql<number>`count(*) filter (where ${workOrder.technicianId} is null and ${workOrder.status} in ('new','scheduled'))::int`,
      parts: sql<number>`count(*) filter (where ${workOrder.status} = 'awaiting_parts')::int`,
    }).from(workOrder).where(wf);
    push({ key: 'work_orders_unassigned', severity: 'warning', count: w?.unassigned ?? 0, href: g['workorder.dispatch'] ? '/field/dispatch' : '/field/work-orders?status=new,scheduled' });
    push({ key: 'work_orders_awaiting_parts', severity: 'info', count: w?.parts ?? 0, href: '/field/work-orders?status=awaiting_parts' });
  }

  // ───────────── personal ─────────────
  const [tk] = await tx.select({ overdue: sql<number>`count(*)::int` }).from(activity)
    .where(and(eq(activity.ownerId, actor.userId), isNull(activity.doneAt), lt(activity.dueAt, new Date())));
  push({ key: 'tasks_overdue', severity: 'warning', count: tk?.overdue ?? 0, href: '/crm/tasks' });
  const ls = scope(actor, 'lead.read', { owner: lead.ownerId, team: lead.teamId });
  if (ls) {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(lead).where(and(ls.where, eq(lead.status, 'new')));
    push({ key: 'leads_new', severity: 'info', count: r?.n ?? 0, href: '/crm/leads' });
  }

  // ───────────── trend ─────────────
  const { granularity, buckets } = trendBuckets(period);
  const series: { key: 'quoted' | 'contracted' | 'collected'; byDay: { d: string; v: string }[] }[] = [];
  if (qs) {
    series.push({ key: 'quoted', byDay: await tx.select({ d: sql<string>`${quote.quoteDate}::text`, v: sql<string>`sum(${quote.total})::text` }).from(quote).where(quoteWhere(period)).groupBy(quote.quoteDate) });
  }
  if (cs) {
    const day = sql`coalesce((${contract.signedAt} at time zone 'Asia/Riyadh')::date, ${contract.contractDate})`;
    series.push({ key: 'contracted', byDay: await tx.select({ d: sql<string>`${day}::text`, v: sql<string>`sum(${contract.total})::text` }).from(contract)
      .where(and(cs.where, inArray(contract.status, CONTRACTED), sql`${day} between ${period.from} and ${period.to}`)).groupBy(sql`1`) });
  }
  if (g['billing.read']) {
    series.push({ key: 'collected', byDay: await tx.select({ d: sql<string>`${paymentMirror.paidOn}::text`, v: sql<string>`sum(${paymentMirror.amount})::text` }).from(paymentMirror)
      .leftJoin(paymentRequest, eq(paymentRequest.id, paymentMirror.paymentRequestId)).leftJoin(contract, eq(contract.id, paymentRequest.contractId))
      .leftJoin(serviceAgreement, eq(serviceAgreement.id, paymentRequest.agreementId))
      .where(and(gte(paymentMirror.paidOn, period.from), lte(paymentMirror.paidOn, period.to), requestScope(actor))).groupBy(paymentMirror.paidOn) });
  }
  const trend = {
    granularity,
    series: series.map((s) => s.key),
    points: buckets.map((b) => ({
      from: b.from, to: b.to,
      ...Object.fromEntries(series.map((s) => [s.key, fx(s.byDay.filter((x) => x.d >= b.from && x.d <= b.to).reduce((a, x) => a + H(x.v), 0))])),
    })) as ({ from: string; to: string } & Partial<Record<'quoted' | 'contracted' | 'collected', string>>)[],
  };

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  actions.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);

  return {
    period, previous: prev, asOf: today,
    visibility: { margin: seeMargin, payables: canCost(actor) },
    actions, cash, sales, funnel, projects, trend, team,
  };
}
