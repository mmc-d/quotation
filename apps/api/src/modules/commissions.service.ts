import {
  and, appUser, commissionEntry, commissionPlan, contract, eq, inArray, installedAsset, invoiceMirror, paymentRequest, product, quoteLine, serviceAgreement, sql, workOrder, type AnyPgColumn, type SQL, type Tx,
} from '@mmc/db';
import {
  commissionEarned, commissionPayable, dec, DEFAULT_TECH_INCENTIVES, riyadhDate, technicianIncentive, toHalalas, halalasToFixed,
  type CommissionLine, type CommissionPlan, type TechnicianIncentiveRules,
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

/** The rep credited with an invoice: contract owner, else the AMC agreement owner; credit notes follow their original. */
async function repFor(tx: Tx, inv: typeof invoiceMirror.$inferSelect, depth = 0): Promise<{ userId: string; contractId: string | null } | null> {
  if (inv.contractId) {
    const [c] = await tx.select({ ownerId: contract.ownerId }).from(contract).where(eq(contract.id, inv.contractId));
    return c?.ownerId ? { userId: c.ownerId, contractId: inv.contractId } : null;
  }
  if (inv.paymentRequestId) {
    const [pr] = await tx.select({ agreementId: paymentRequest.agreementId, contractId: paymentRequest.contractId }).from(paymentRequest).where(eq(paymentRequest.id, inv.paymentRequestId));
    if (pr?.agreementId) {
      const [a] = await tx.select({ ownerId: serviceAgreement.ownerId }).from(serviceAgreement).where(eq(serviceAgreement.id, pr.agreementId));
      if (a?.ownerId) return { userId: a.ownerId, contractId: null };
    }
    if (pr?.contractId) {
      const [c] = await tx.select({ ownerId: contract.ownerId }).from(contract).where(eq(contract.id, pr.contractId));
      if (c?.ownerId) return { userId: c.ownerId, contractId: pr.contractId };
    }
  }
  if (inv.originalInvoiceId && depth < 2) {
    const [orig] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, inv.originalInvoiceId));
    if (orig) return repFor(tx, orig, depth + 1);
  }
  return null;
}

/** Plans in force on the invoice date for this rep (empty userIds = every contract owner), in sort order. */
async function plansFor(tx: Tx, userId: string, onDate: string): Promise<CommissionPlan[]> {
  const rows = await tx.select().from(commissionPlan).where(and(
    eq(commissionPlan.active, true),
    sql`(${commissionPlan.validFrom} is null or ${commissionPlan.validFrom} <= ${onDate})`,
    sql`(${commissionPlan.validTo} is null or ${commissionPlan.validTo} >= ${onDate})`,
    sql`(jsonb_array_length(${commissionPlan.userIds}) = 0 or ${commissionPlan.userIds} @> ${JSON.stringify([userId])}::jsonb)`,
  )).orderBy(commissionPlan.sort, commissionPlan.createdAt);
  return rows.map((p) => ({ id: p.id, basis: p.basis === 'margin' ? 'margin' : 'revenue', ratePercent: p.ratePercent, categoryIds: p.categoryIds }));
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

/**
 * (Re)compute the commission entries of one invoice: earned per plan for the rep, and the payable
 * share. Paid amounts are never touched; entries no plan applies to any more are removed unless paid.
 */
export async function recomputeCommissions(tx: Tx, invoiceId: string) {
  const [inv] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, invoiceId));
  if (!inv) return { entries: 0 };
  const existing = await tx.select().from(commissionEntry).where(eq(commissionEntry.invoiceId, invoiceId));
  const rep = EARNING_TYPES.includes(inv.typeCode) && inv.status !== 'cancelled' ? await repFor(tx, inv) : null;
  const earned = rep ? commissionEarned(await commissionLines(tx, inv, rep.contractId), await plansFor(tx, rep.userId, inv.issueDate)) : [];
  const total = toHalalas(inv.total);
  const collected = earned.length ? await collectedFor(tx, inv) : 0;
  const period = currentPeriod();
  const keep = new Set<string>();
  for (const e of earned) {
    const payable = commissionPayable(e.halalas, total, collected);
    const prev = existing.find((x) => x.userId === rep!.userId && x.planId === e.planId);
    if (prev) {
      keep.add(prev.id);
      const paid = toHalalas(prev.paid);
      const changed = toHalalas(prev.earned) !== e.halalas || toHalalas(prev.payable) !== payable;
      if (!changed && prev.status === statusOf(payable, paid)) continue;
      await tx.update(commissionEntry).set({
        earned: halalasToFixed(e.halalas), payable: halalasToFixed(payable), status: statusOf(payable, paid), contractId: rep!.contractId,
        ...(toHalalas(prev.payable) !== payable ? { period } : {}), updatedAt: new Date(), version: prev.version + 1,
      }).where(eq(commissionEntry.id, prev.id));
    } else {
      const [row] = await tx.insert(commissionEntry).values({
        userId: rep!.userId, planId: e.planId, invoiceId, contractId: rep!.contractId, earned: halalasToFixed(e.halalas), payable: halalasToFixed(payable), period, status: statusOf(payable, 0),
      }).returning({ id: commissionEntry.id });
      keep.add(row!.id);
    }
  }
  const stale = existing.filter((x) => !keep.has(x.id) && toHalalas(x.paid) === 0).map((x) => x.id);
  if (stale.length) await tx.delete(commissionEntry).where(inArray(commissionEntry.id, stale));
  return { entries: keep.size };
}

/** Nightly: refresh the payable share of every entry that is not fully paid (collections since). */
export async function recalcOpenCommissions(tx: Tx) {
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
