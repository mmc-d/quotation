import {
  and, appUser, commissionEntry, commissionPlan, commissionSplit, contract, eq, inArray, installedAsset, invoiceMirror, paymentRequest, product, quoteLine, salesQuota, serviceAgreement, sql, workOrder, type AnyPgColumn, type SQL, type Tx,
} from '@mmc/db';
import {
  applyMultiplier, commissionEarned, commissionPayable, dec, DEFAULT_TECH_INCENTIVES, quotaAttainment, riyadhDate, sortTiers, splitCommission, splitSharesError,
  technicianIncentive, tierMultiplier, tierStatus, toHalalas, halalasToFixed,
  type CommissionLine, type CommissionPlan, type CommissionTier, type SplitShare, type TechnicianIncentiveRules,
} from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { forbidden } from '../common/errors.js';

/**
 * Sales commissions (module 09 §3.4, HR-50..54) and technician incentives (HR-55).
 *
 * - Earned on invoice: a 388 earns (the contract's final 388, change-order 388s and AMC 388s);
 *   386 advances never earn on their own (the final 388 covers the whole contract — no double
 *   counting); a 381 credit note claws back.
 * - Payable on collection (pay-when-paid): pro-rata to what was collected against the invoice
 *   (advances deducted on the 388 + payment allocations), never above the earned amount.
 * - Paid through payroll (Frappe HR later): mark-paid + CSV export.
 */

export type EntryRow = typeof commissionEntry.$inferSelect;
const EARNING_TYPES = ['388', '381'];

export const currentPeriod = () => riyadhDate().slice(0, 7);

/** commission.read scope → filter on the entry's rep. */
export function repFilter(actor: RequestActor, col: AnyPgColumn = commissionEntry.userId): SQL | undefined {
  const scope = actor.grants['commission.read'];
  if (!scope) throw forbidden('missing permission: commission.read');
  if (scope === 'all' || scope === 'company') return undefined;
  if (scope === 'branch') return actor.branchId ? sql`${col} in (select id from app_user where branch_id = ${actor.branchId})` : undefined;
  if (scope === 'team' && actor.teamIds.length) {
    return sql`(${col} = ${actor.userId} or ${col} in (select user_id from team_member where team_id in (${sql.join(actor.teamIds.map((t) => sql`${t}::uuid`), sql`, `)})))`;
  }
  return eq(col, actor.userId);
}

/** Month bounds of a YYYY-MM period: [first day, first day of next month). */
export function monthRange(period: string): [string, string] {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [`${period}-01`, `${next}-01`];
}

/** The rep credited with an invoice: contract owner, else the AMC agreement owner; credit notes follow their original. */
async function repFor(tx: Tx, inv: typeof invoiceMirror.$inferSelect, depth = 0): Promise<{ userId: string | null; contractId: string | null } | null> {
  if (inv.contractId) {
    const [c] = await tx.select({ ownerId: contract.ownerId }).from(contract).where(eq(contract.id, inv.contractId));
    return c ? { userId: c.ownerId ?? null, contractId: inv.contractId } : null;
  }
  if (inv.paymentRequestId) {
    const [pr] = await tx.select({ agreementId: paymentRequest.agreementId, contractId: paymentRequest.contractId }).from(paymentRequest).where(eq(paymentRequest.id, inv.paymentRequestId));
    if (pr?.agreementId) {
      const [a] = await tx.select({ ownerId: serviceAgreement.ownerId }).from(serviceAgreement).where(eq(serviceAgreement.id, pr.agreementId));
      if (a?.ownerId) return { userId: a.ownerId, contractId: null };
    }
    if (pr?.contractId) {
      const [c] = await tx.select({ ownerId: contract.ownerId }).from(contract).where(eq(contract.id, pr.contractId));
      if (c) return { userId: c.ownerId ?? null, contractId: pr.contractId };
    }
  }
  if (inv.originalInvoiceId && depth < 2) {
    const [orig] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, inv.originalInvoiceId));
    if (orig) return repFor(tx, orig, depth + 1);
  }
  return null;
}

export interface Attribution { contractId: string | null; shares: SplitShare[] }

/** Valid split rows of a contract (sum = 100), else null. */
export async function contractSplits(tx: Tx, contractId: string): Promise<SplitShare[] | null> {
  const rows = await tx.select({ userId: commissionSplit.userId, sharePercent: commissionSplit.sharePercent }).from(commissionSplit)
    .where(eq(commissionSplit.contractId, contractId)).orderBy(commissionSplit.createdAt, commissionSplit.userId);
  return rows.length && !splitSharesError(rows) ? rows : null;
}

/** Who shares an invoice: the contract's commission split (HR-53) when set, else 100 % to the owner. */
async function attributionFor(tx: Tx, inv: typeof invoiceMirror.$inferSelect): Promise<Attribution | null> {
  const rep = await repFor(tx, inv);
  if (!rep) return null;
  const split = rep.contractId ? await contractSplits(tx, rep.contractId) : null;
  if (split) return { contractId: rep.contractId, shares: split };
  return rep.userId ? { contractId: rep.contractId, shares: [{ userId: rep.userId, sharePercent: '100' }] } : null;
}

type PlanWithTiers = CommissionPlan & { tiers: CommissionTier[]; name: string };

/** Plans in force on the invoice date for this rep (empty userIds = every contract owner), in sort order. */
export async function plansFor(tx: Tx, userId: string, onDate: string): Promise<PlanWithTiers[]> {
  const rows = await tx.select().from(commissionPlan).where(and(
    eq(commissionPlan.active, true),
    sql`(${commissionPlan.validFrom} is null or ${commissionPlan.validFrom} <= ${onDate})`,
    sql`(${commissionPlan.validTo} is null or ${commissionPlan.validTo} >= ${onDate})`,
    sql`(jsonb_array_length(${commissionPlan.userIds}) = 0 or ${commissionPlan.userIds} @> ${JSON.stringify([userId])}::jsonb)`,
  )).orderBy(commissionPlan.sort, commissionPlan.createdAt);
  return rows.map((p) => ({ id: p.id, name: p.name, basis: p.basis === 'margin' ? 'margin' : 'revenue', ratePercent: p.ratePercent, categoryIds: p.categoryIds, tiers: sortTiers(p.tiers ?? []) }));
}

/** Invoice lines (VAT excluded) with the quote's cost snapshot and the product category. */
async function commissionLines(tx: Tx, inv: typeof invoiceMirror.$inferSelect, contractId: string | null): Promise<CommissionLine[]> {
  const lines = (inv.lines as { code: string; qty: string; net: string }[] | null) ?? [];
  const codes = [...new Set(lines.map((l) => l.code))];
  const cost = new Map<string, string>();
  if (contractId && codes.length) {
    const [c] = await tx.select({ quoteId: contract.quoteId }).from(contract).where(eq(contract.id, contractId));
    if (c?.quoteId) {
      const ql = await tx.select({ code: quoteLine.code, unitCost: quoteLine.unitCost }).from(quoteLine).where(and(eq(quoteLine.quoteId, c.quoteId), inArray(quoteLine.code, codes))).orderBy(quoteLine.sort);
      for (const l of ql) if (l.unitCost !== null && !cost.has(l.code)) cost.set(l.code, l.unitCost);
    }
  }
  const cats = codes.length ? await tx.select({ code: product.code, categoryId: product.categoryId }).from(product).where(inArray(product.code, codes)) : [];
  const catOf = new Map(cats.map((p) => [p.code, p.categoryId]));
  return lines.map((l) => {
    const amount = toHalalas(l.net);
    const unitCost = cost.get(l.code);
    const c = unitCost ? toHalalas(dec(unitCost).times(dec(l.qty).abs())) : 0;
    return { amount, cost: amount < 0 ? -c : c, categoryId: catOf.get(l.code) ?? null };
  });
}

/** Collected against an invoice (incl. VAT): advances deducted on it + payment allocations (or its payment request). */
export async function collectedFor(tx: Tx, inv: typeof invoiceMirror.$inferSelect): Promise<number> {
  const rows = await tx.execute<{ s: string | null }>(sql`
    select coalesce(sum((al ->> 'amount')::numeric), 0)::text as s
    from payment_mirror pm cross join lateral jsonb_array_elements(pm.allocations) al
    where al ->> 'invoiceErpName' = ${inv.erpName}`);
  let paid = toHalalas(rows[0]?.s ?? '0');
  if (!paid && inv.paymentRequestId) {
    const [pr] = await tx.select({ paidAmount: paymentRequest.paidAmount }).from(paymentRequest).where(eq(paymentRequest.id, inv.paymentRequestId));
    paid = toHalalas(pr?.paidAmount ?? '0');
  }
  const total = toHalalas(inv.total);
  return Math.min(total, toHalalas(inv.prepaidAmount) + paid);
}

function statusOf(payable: number, paid: number) {
  return payable - paid !== 0 ? 'payable' : paid !== 0 ? 'paid' : 'open';
}

// ───────────────────────── quota attainment (HR-53) ─────────────────────────

export interface RepMonth { userId: string; revenue: number; quota: number; attainment: number | null }

/**
 * Per rep for one month: invoiced revenue (388 net excl. VAT minus 381, by invoice date, split per
 * the contract's commission split) against the rep's sales_quota.
 */
export async function periodStats(tx: Tx, period: string): Promise<Map<string, RepMonth>> {
  const [from, to] = monthRange(period);
  const invs = await tx.select().from(invoiceMirror).where(and(
    inArray(invoiceMirror.typeCode, EARNING_TYPES), sql`${invoiceMirror.status} <> 'cancelled'`,
    sql`${invoiceMirror.issueDate} >= ${from}`, sql`${invoiceMirror.issueDate} < ${to}`,
  ));
  const out = new Map<string, RepMonth>();
  const get = (userId: string) => {
    let r = out.get(userId);
    if (!r) { r = { userId, revenue: 0, quota: 0, attainment: null }; out.set(userId, r); }
    return r;
  };
  for (const inv of invs) {
    const att = await attributionFor(tx, inv);
    if (!att) continue;
    const net = Math.abs(toHalalas(inv.taxable)) * (inv.typeCode === '381' ? -1 : 1);
    for (const s of splitCommission(net, att.shares)) get(s.userId).revenue += s.halalas;
  }
  const quotas = await tx.select().from(salesQuota).where(eq(salesQuota.period, period));
  for (const q of quotas) get(q.userId).quota = toHalalas(q.amount);
  for (const r of out.values()) r.attainment = quotaAttainment(r.revenue, r.quota);
  return out;
}

/** True when any active plan carries tiers — only then do invoices of a month depend on each other. */
export async function tiersInUse(tx: Tx): Promise<boolean> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(commissionPlan).where(and(eq(commissionPlan.active, true), sql`jsonb_array_length(${commissionPlan.tiers}) > 0`));
  return (r?.n ?? 0) > 0;
}

type Ctx = Map<string, Map<string, RepMonth>>;
async function statsOf(tx: Tx, ctx: Ctx, period: string) {
  let m = ctx.get(period);
  if (!m) { m = await periodStats(tx, period); ctx.set(period, m); }
  return m;
}

/**
 * (Re)compute the commission entries of one invoice: for each rep sharing it (split or owner), the
 * earned amount per plan, split to the halala, times the rep's accelerator for the invoice month;
 * then the payable share. Paid amounts are never touched; entries no plan applies to any more are
 * removed unless paid.
 */
async function computeInvoice(tx: Tx, inv: typeof invoiceMirror.$inferSelect, ctx: Ctx) {
  const existing = await tx.select().from(commissionEntry).where(eq(commissionEntry.invoiceId, inv.id));
  const att = EARNING_TYPES.includes(inv.typeCode) && inv.status !== 'cancelled' ? await attributionFor(tx, inv) : null;
  const target: { userId: string; planId: string; halalas: number }[] = [];
  if (att) {
    const lines = await commissionLines(tx, inv, att.contractId);
    const month = inv.issueDate.slice(0, 7);
    for (const s of att.shares) {
      const plans = await plansFor(tx, s.userId, inv.issueDate);
      for (const e of commissionEarned(lines, plans)) {
        const slice = splitCommission(e.halalas, att.shares).find((x) => x.userId === s.userId)!.halalas;
        const plan = plans.find((p) => p.id === e.planId)!;
        const mult = plan.tiers.length ? tierMultiplier((await statsOf(tx, ctx, month)).get(s.userId)?.attainment ?? null, plan.tiers) : 1;
        target.push({ userId: s.userId, planId: e.planId, halalas: applyMultiplier(slice, mult) });
      }
    }
  }
  const total = toHalalas(inv.total);
  const collected = target.length ? await collectedFor(tx, inv) : 0;
  const period = currentPeriod();
  const keep = new Set<string>();
  for (const e of target) {
    const payable = commissionPayable(e.halalas, total, collected);
    const prev = existing.find((x) => x.userId === e.userId && x.planId === e.planId);
    if (prev) {
      keep.add(prev.id);
      const paid = toHalalas(prev.paid);
      const changed = toHalalas(prev.earned) !== e.halalas || toHalalas(prev.payable) !== payable || prev.contractId !== att!.contractId;
      if (!changed && prev.status === statusOf(payable, paid)) continue;
      await tx.update(commissionEntry).set({
        earned: halalasToFixed(e.halalas), payable: halalasToFixed(payable), status: statusOf(payable, paid), contractId: att!.contractId,
        ...(toHalalas(prev.payable) !== payable ? { period } : {}), updatedAt: new Date(), version: prev.version + 1,
      }).where(eq(commissionEntry.id, prev.id));
    } else {
      const [row] = await tx.insert(commissionEntry).values({
        userId: e.userId, planId: e.planId, invoiceId: inv.id, contractId: att!.contractId, earned: halalasToFixed(e.halalas), payable: halalasToFixed(payable), period, status: statusOf(payable, 0),
      }).returning({ id: commissionEntry.id });
      keep.add(row!.id);
    }
  }
  const stale = existing.filter((x) => !keep.has(x.id) && toHalalas(x.paid) === 0).map((x) => x.id);
  if (stale.length) await tx.delete(commissionEntry).where(inArray(commissionEntry.id, stale));
  return keep.size;
}

/** Recompute every earning invoice dated in a month (tiers depend on the rep's whole month). */
export async function recomputePeriod(tx: Tx, period: string, ctx: Ctx = new Map()) {
  const [from, to] = monthRange(period);
  const invs = await tx.select().from(invoiceMirror).where(and(inArray(invoiceMirror.typeCode, EARNING_TYPES), sql`${invoiceMirror.issueDate} >= ${from}`, sql`${invoiceMirror.issueDate} < ${to}`))
    .orderBy(invoiceMirror.issueDate, invoiceMirror.createdAt);
  let entries = 0;
  for (const inv of invs) entries += await computeInvoice(tx, inv, ctx);
  return { period, invoices: invs.length, entries };
}

/**
 * (Re)compute the commission entries of one invoice. With tiered plans in force, the whole month of
 * the invoice is recomputed — a new invoice can move the rep into a higher tier for every invoice of
 * that month.
 */
export async function recomputeCommissions(tx: Tx, invoiceId: string) {
  const [inv] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, invoiceId));
  if (!inv) return { entries: 0 };
  if (EARNING_TYPES.includes(inv.typeCode) && await tiersInUse(tx)) {
    await recomputePeriod(tx, inv.issueDate.slice(0, 7));
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(commissionEntry).where(eq(commissionEntry.invoiceId, invoiceId))) as [{ n: number }];
    return { entries: n };
  }
  return { entries: await computeInvoice(tx, inv, new Map()) };
}

/** Recompute the invoices of a contract (after its commission split changed), month-wide when tiers apply. */
export async function recomputeContract(tx: Tx, contractId: string) {
  const invs = await tx.select({ id: invoiceMirror.id, issueDate: invoiceMirror.issueDate }).from(invoiceMirror).where(sql`(
    ${invoiceMirror.contractId} = ${contractId}
    or ${invoiceMirror.paymentRequestId} in (select id from payment_request where contract_id = ${contractId})
    or ${invoiceMirror.originalInvoiceId} in (select id from invoice_mirror where contract_id = ${contractId}))`);
  const ctx: Ctx = new Map();
  if (await tiersInUse(tx)) {
    for (const p of new Set(invs.map((i) => i.issueDate.slice(0, 7)))) await recomputePeriod(tx, p, ctx);
  } else {
    for (const { id } of invs) {
      const [inv] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, id));
      if (inv) await computeInvoice(tx, inv, ctx);
    }
  }
  return { invoices: invs.length };
}

/** Previous YYYY-MM. */
export function prevPeriod(period: string) {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Nightly: with tiered plans, recompute this and last month (quotas or late invoices may have moved
 * a tier); then refresh the payable share of every entry that is not fully paid (collections since).
 */
export async function recalcOpenCommissions(tx: Tx) {
  if (await tiersInUse(tx)) {
    const cur = currentPeriod();
    await recomputePeriod(tx, prevPeriod(cur));
    await recomputePeriod(tx, cur);
  }
  const rows = await tx.selectDistinct({ invoiceId: commissionEntry.invoiceId }).from(commissionEntry).where(inArray(commissionEntry.status, ['open', 'payable']));
  const period = currentPeriod();
  let updated = 0;
  for (const { invoiceId } of rows) {
    const [inv] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, invoiceId));
    if (!inv) continue;
    const total = toHalalas(inv.total);
    const collected = await collectedFor(tx, inv);
    const entries = await tx.select().from(commissionEntry).where(and(eq(commissionEntry.invoiceId, invoiceId), inArray(commissionEntry.status, ['open', 'payable'])));
    for (const e of entries) {
      const payable = commissionPayable(toHalalas(e.earned), total, collected);
      const paid = toHalalas(e.paid);
      if (payable === toHalalas(e.payable) && e.status === statusOf(payable, paid)) continue;
      await tx.update(commissionEntry).set({ payable: halalasToFixed(payable), status: statusOf(payable, paid), period, updatedAt: new Date(), version: e.version + 1 }).where(eq(commissionEntry.id, e.id));
      updated++;
    }
  }
  return { invoices: rows.length, updated };
}

// ───────────────────────── rep dashboard (HR-54) ─────────────────────────

/** The rep's month: revenue vs quota, tier ladder, earned/payable/paid for the month (by invoice date) and YTD, entries. */
export async function repDashboard(tx: Tx, userId: string, period: string) {
  const stats = (await periodStats(tx, period)).get(userId) ?? { userId, revenue: 0, quota: 0, attainment: null };
  const [from, to] = monthRange(period);
  const lastDay = new Date(new Date(`${to}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const plans = await plansFor(tx, userId, lastDay);
  const tiered = plans.find((p) => p.tiers.length);
  const tier = tierStatus(stats.attainment, tiered?.tiers ?? []);
  const sums = async (start: string) => {
    const [r] = await tx.select({
      earned: sql<string>`coalesce(sum(${commissionEntry.earned}), 0)::text`, payable: sql<string>`coalesce(sum(${commissionEntry.payable}), 0)::text`, paid: sql<string>`coalesce(sum(${commissionEntry.paid}), 0)::text`,
    }).from(commissionEntry).innerJoin(invoiceMirror, eq(invoiceMirror.id, commissionEntry.invoiceId))
      .where(and(eq(commissionEntry.userId, userId), sql`${invoiceMirror.issueDate} >= ${start}`, sql`${invoiceMirror.issueDate} < ${to}`));
    const e = toHalalas(r?.earned ?? '0'); const p = toHalalas(r?.payable ?? '0'); const d = toHalalas(r?.paid ?? '0');
    return { earned: halalasToFixed(e), payable: halalasToFixed(p), paid: halalasToFixed(d), outstanding: halalasToFixed(p - d) };
  };
  const entries = await tx.select({
    e: commissionEntry, invoiceNumber: invoiceMirror.number, invoiceType: invoiceMirror.typeCode, invoiceDate: invoiceMirror.issueDate,
    contractNumber: contract.number, planName: commissionPlan.name,
  }).from(commissionEntry).innerJoin(invoiceMirror, eq(invoiceMirror.id, commissionEntry.invoiceId))
    .leftJoin(contract, eq(contract.id, commissionEntry.contractId)).leftJoin(commissionPlan, eq(commissionPlan.id, commissionEntry.planId))
    .where(and(eq(commissionEntry.userId, userId), sql`${invoiceMirror.issueDate} >= ${from}`, sql`${invoiceMirror.issueDate} < ${to}`))
    .orderBy(invoiceMirror.issueDate, commissionEntry.createdAt);
  return {
    userId, period,
    revenue: halalasToFixed(stats.revenue), quota: stats.quota ? halalasToFixed(stats.quota) : null, attainment: stats.attainment,
    planName: tiered?.name ?? null, tiers: tiered?.tiers ?? [], currentTier: tier.current, nextTier: tier.next, multiplier: tier.multiplier,
    toNextTier: tier.next && stats.quota ? halalasToFixed(Math.max(0, Math.ceil((stats.quota * tier.next.fromPercent) / 100) - stats.revenue)) : null,
    month: await sums(from), ytd: await sums(`${period.slice(0, 4)}-01-01`),
    entries: entries.map((r) => ({
      ...r.e, outstanding: halalasToFixed(toHalalas(r.e.payable) - toHalalas(r.e.paid)),
      invoiceNumber: r.invoiceNumber, invoiceType: r.invoiceType, invoiceDate: r.invoiceDate, contractNumber: r.contractNumber, planName: r.planName,
    })),
  };
}

// ───────────────────────── technician incentives ─────────────────────────

const FIX_TYPES = ['corrective', 'warranty'];

/**
 * HR-55 from work-order facts: completed jobs of each lead technician in [from, to] (Riyadh days).
 * Installed devices = assets registered on installation work orders; a corrective/warranty job is a
 * first-time fix unless another corrective/warranty work order on the same asset was opened within
 * the callback window after it was completed (then it counts as a callback); a signed job with
 * CSAT ≥ 4 earns the happy-customer bonus.
 */
export async function technicianIncentives(tx: Tx, from: string, to: string, techFilter: SQL | undefined, rules: TechnicianIncentiveRules = DEFAULT_TECH_INCENTIVES) {
  const start = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(`${to}T00:00:00+03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  const wos = await tx.select().from(workOrder).where(and(
    inArray(workOrder.status, ['completed', 'closed']), sql`${workOrder.technicianId} is not null`,
    sql`${workOrder.completedAt} >= ${start.toISOString()}::timestamptz`, sql`${workOrder.completedAt} < ${end.toISOString()}::timestamptz`, techFilter,
  ));
  const ids = wos.map((w) => w.id);
  const devices = ids.length ? await tx.select({ woId: installedAsset.workOrderId, n: sql<number>`count(*)::int` }).from(installedAsset).where(inArray(installedAsset.workOrderId, ids)).groupBy(installedAsset.workOrderId) : [];
  const assetIds = [...new Set(wos.filter((w) => FIX_TYPES.includes(w.type) && w.assetId).map((w) => w.assetId!))];
  const later = assetIds.length ? await tx.select({ id: workOrder.id, assetId: workOrder.assetId, createdAt: workOrder.createdAt }).from(workOrder)
    .where(and(inArray(workOrder.assetId, assetIds), inArray(workOrder.type, FIX_TYPES), sql`${workOrder.status} <> 'cancelled'`)) : [];
  const windowMs = rules.callbackWindowDays * 86_400_000;
  const byTech = new Map<string, Parameters<typeof technicianIncentive>[0]>();
  for (const w of wos) {
    const fix = FIX_TYPES.includes(w.type);
    const done = w.completedAt!.getTime();
    const callback = fix && !!w.assetId && later.some((x) => x.id !== w.id && x.assetId === w.assetId && x.createdAt.getTime() > done && x.createdAt.getTime() - done <= windowMs);
    const job = { type: w.type, devicesInstalled: w.type === 'installation' ? devices.find((d) => d.woId === w.id)?.n ?? 0 : 0, firstTimeFix: fix && !callback, callback, csat: w.csatScore, signed: !!w.signatureName };
    const list = byTech.get(w.technicianId!) ?? [];
    list.push(job);
    byTech.set(w.technicianId!, list);
  }
  const users = byTech.size ? await tx.select({ id: appUser.id, nameAr: appUser.nameAr, email: appUser.email }).from(appUser).where(inArray(appUser.id, [...byTech.keys()])) : [];
  const rows = [...byTech].map(([userId, jobs]) => {
    const u = users.find((x) => x.id === userId);
    return { userId, name: u?.nameAr || u?.email || userId, jobs: jobs.length, ...technicianIncentive(jobs, rules) };
  }).sort((a, b) => b.totalHalalas - a.totalHalalas);
  return { from, to, rules, rows, totalHalalas: rows.reduce((s, r) => s + r.totalHalalas, 0) };
}
