import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { and, appUser, asc, commissionEntry, company, commissionPlan, commissionSplit, contract, desc, eq, inArray, invoiceMirror, salesQuota, sql, workOrder } from '@mmc/db';
import { dec, DEFAULT_TECH_INCENTIVES, halalasToFixed, sortTiers, splitSharesError, toHalalas } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { audit, diff } from '../common/audit.js';
import { tenantTx } from '../common/db.js';
import { badRequest, forbidden, notFound } from '../common/errors.js';
import { loadCompany } from '../common/company.js';
import { ZodPipe, zDate, zUuid } from '../common/zod.js';
import { currentPeriod, monthRange, periodStats, recomputeContract, recomputePeriod, repDashboard, repFilter, technicianIncentives, tiersInUse } from './commissions.service.js';

/**
 * Commissions & technician incentives (module 09 §3.4) under /api/commissions: plans (commission.manage),
 * the rep ledger (commission.read with own/team/company scope), mark-paid + payroll CSV, technician incentives.
 */

const zPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const planSchema = z.object({
  name: z.string().trim().min(1).max(200),
  basis: z.enum(['revenue', 'margin']).default('revenue'),
  ratePercent: z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d{1,3}(\.\d{1,4})?$/.test(v) && Number(v) <= 100, 'percent 0–100'),
  categoryIds: z.array(zUuid).max(200).default([]),
  userIds: z.array(zUuid).max(500).default([]),
  validFrom: zDate.nullish(),
  validTo: zDate.nullish(),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(10_000).default(0),
  /** accelerators on monthly quota attainment (HR-53): from `fromPercent` % of quota, earned × multiplier */
  tiers: z.array(z.object({ fromPercent: z.coerce.number().min(0).max(1000), multiplier: z.coerce.number().min(0).max(10) })).max(20).default([])
    .refine((t) => new Set(t.map((x) => x.fromPercent)).size === t.length, 'tier thresholds must be unique')
    .transform((t) => sortTiers(t)),
}).refine((v) => !v.validFrom || !v.validTo || v.validFrom <= v.validTo, 'validFrom must be before validTo');
type PlanInput = z.infer<typeof planSchema>;

const zAmount = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d{1,15}(\.\d{1,2})?$/.test(v), 'amount ≥ 0, 2 decimals');
const quotasSchema = z.object({ period: zPeriod, rows: z.array(z.object({ userId: zUuid, amount: zAmount.nullable() })).min(1).max(500) });
const splitsSchema = z.object({
  splits: z.array(z.object({ userId: zUuid, sharePercent: z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d{1,3}(\.\d{1,4})?$/.test(v), 'percent') })).max(20),
});

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  // neutralise spreadsheet formulas and quote when needed
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const halalas = z.number().int().min(0).max(10_000_000);
const techRulesSchema = z.object({
  perDeviceHalalas: halalas, firstTimeFixHalalas: halalas, callbackPenaltyHalalas: halalas,
  callbackWindowDays: z.number().int().min(1).max(365), happyCustomerHalalas: halalas,
});

@Controller('commissions')
export class CommissionsController {
  // ───────────────────────── plans ─────────────────────────

  @Get('plans')
  @Perm('commission.manage')
  async plans(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => tx.select().from(commissionPlan).orderBy(asc(commissionPlan.sort), asc(commissionPlan.createdAt)));
  }

  @Post('plans')
  @Perm('commission.manage')
  async createPlan(@Actor() actor: RequestActor, @Body(new ZodPipe(planSchema)) b: PlanInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [row] = await tx.insert(commissionPlan).values({ ...b, validFrom: b.validFrom ?? null, validTo: b.validTo ?? null, createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'commission_plan', row!.id, null, b);
      return row;
    }, actor.userId);
  }

  @Put('plans/:id')
  @Perm('commission.manage')
  async updatePlan(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(planSchema)) b: PlanInput) {
    if (!zUuid.safeParse(id).success) throw notFound('plan');
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(commissionPlan).where(eq(commissionPlan.id, id));
      if (!before) throw notFound('plan');
      const values = { ...b, validFrom: b.validFrom ?? null, validTo: b.validTo ?? null };
      const [row] = await tx.update(commissionPlan).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(commissionPlan.id, id)).returning();
      const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'commission_plan', id, d.before, d.after);
      return row;
    }, actor.userId);
  }

  // ───────────────────────── quotas (HR-53) ─────────────────────────

  /** Quotas for a month (`period`) or a year (`year`); reps read their own (commission.read scope), managers all + the rep list. */
  @Get('quotas')
  @Perm('commission.read')
  async quotas(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ period: zPeriod.optional(), year: z.string().regex(/^\d{4}$/).optional() }))) q: { period?: string; year?: string }) {
    const canManage = !!actor.grants['commission.manage'];
    return tenantTx(actor.tenantId, async (tx) => {
      const year = q.year ?? (q.period ?? currentPeriod()).slice(0, 4);
      const rows = await tx.select({ userId: salesQuota.userId, period: salesQuota.period, amount: salesQuota.amount }).from(salesQuota).where(and(
        canManage ? undefined : repFilter(actor, salesQuota.userId),
        q.period ? eq(salesQuota.period, q.period) : sql`${salesQuota.period} like ${`${year}-%`}`,
      )).orderBy(salesQuota.period);
      const reps = await tx.select({ id: appUser.id, name: sql<string>`coalesce(${appUser.nameAr}, ${appUser.email})`, email: appUser.email }).from(appUser)
        .where(and(sql`${appUser.status} <> 'suspended'`, canManage ? undefined : repFilter(actor, appUser.id))).orderBy(appUser.nameAr, appUser.email);
      return { period: q.period ?? null, year, rows, reps, canManage };
    });
  }

  @Put('quotas')
  @Perm('commission.manage')
  async putQuotas(@Actor() actor: RequestActor, @Body(new ZodPipe(quotasSchema)) b: z.infer<typeof quotasSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const ids = [...new Set(b.rows.map((r) => r.userId))];
      if (ids.length !== b.rows.length) throw badRequest('a rep appears twice');
      const users = await tx.select({ id: appUser.id }).from(appUser).where(inArray(appUser.id, ids));
      if (users.length !== ids.length) throw badRequest('unknown user in quotas');
      const before = await tx.select().from(salesQuota).where(and(eq(salesQuota.period, b.period), inArray(salesQuota.userId, ids)));
      for (const r of b.rows) {
        const prev = before.find((x) => x.userId === r.userId);
        if (r.amount === null || toHalalas(r.amount) === 0) {
          if (prev) await tx.delete(salesQuota).where(eq(salesQuota.id, prev.id));
        } else if (prev) {
          if (toHalalas(prev.amount) !== toHalalas(r.amount)) await tx.update(salesQuota).set({ amount: r.amount, updatedAt: new Date(), updatedBy: actor.userId, version: prev.version + 1 }).where(eq(salesQuota.id, prev.id));
        } else {
          await tx.insert(salesQuota).values({ userId: r.userId, period: b.period, amount: r.amount, createdBy: actor.userId, updatedBy: actor.userId });
        }
      }
      await audit(tx, actor, 'update', 'sales_quota', null, { period: b.period, rows: before.map((x) => ({ userId: x.userId, amount: x.amount })) }, b);
      // attainment changed → re-tier the month
      const recomputed = await tiersInUse(tx) ? await recomputePeriod(tx, b.period) : null;
      const rows = await tx.select({ userId: salesQuota.userId, period: salesQuota.period, amount: salesQuota.amount }).from(salesQuota).where(eq(salesQuota.period, b.period));
      return { period: b.period, rows, recomputed };
    }, actor.userId);
  }

  // ───────────────────────── splits (HR-53) ─────────────────────────

  @Get('splits/:contractId')
  @Perm('commission.manage')
  async splits(@Actor() actor: RequestActor, @Param('contractId') contractId: string) {
    if (!zUuid.safeParse(contractId).success) throw notFound('contract');
    return tenantTx(actor.tenantId, async (tx) => {
      const [c] = await tx.select({ id: contract.id, number: contract.number, ownerId: contract.ownerId }).from(contract).where(eq(contract.id, contractId));
      if (!c) throw notFound('contract');
      const rows = await tx.select({ userId: commissionSplit.userId, sharePercent: commissionSplit.sharePercent, userName: sql<string>`coalesce(${appUser.nameAr}, ${appUser.email})` })
        .from(commissionSplit).leftJoin(appUser, eq(appUser.id, commissionSplit.userId)).where(eq(commissionSplit.contractId, contractId)).orderBy(commissionSplit.createdAt, commissionSplit.userId);
      return { contractId, contractNumber: c.number, ownerId: c.ownerId, rows: rows.map((r) => ({ ...r, sharePercent: dec(r.sharePercent).toString() })) };
    });
  }

  /** Replace a contract's split (shares must total 100); an empty list returns the commission to the owner. */
  @Put('splits/:contractId')
  @Perm('commission.manage')
  async putSplits(@Actor() actor: RequestActor, @Param('contractId') contractId: string, @Body(new ZodPipe(splitsSchema)) b: z.infer<typeof splitsSchema>) {
    if (!zUuid.safeParse(contractId).success) throw notFound('contract');
    if (b.splits.length) {
      const err = splitSharesError(b.splits);
      if (err) throw badRequest(err);
    }
    return tenantTx(actor.tenantId, async (tx) => {
      const [c] = await tx.select({ id: contract.id }).from(contract).where(eq(contract.id, contractId));
      if (!c) throw notFound('contract');
      const ids = b.splits.map((s) => s.userId);
      if (ids.length) {
        const users = await tx.select({ id: appUser.id }).from(appUser).where(inArray(appUser.id, ids));
        if (users.length !== ids.length) throw badRequest('unknown user in split');
      }
      const before = await tx.select({ userId: commissionSplit.userId, sharePercent: commissionSplit.sharePercent }).from(commissionSplit).where(eq(commissionSplit.contractId, contractId));
      await tx.delete(commissionSplit).where(eq(commissionSplit.contractId, contractId));
      if (b.splits.length) await tx.insert(commissionSplit).values(b.splits.map((s) => ({ contractId, userId: s.userId, sharePercent: s.sharePercent, createdBy: actor.userId, updatedBy: actor.userId })));
      await audit(tx, actor, 'update', 'commission_split', contractId, { splits: before }, { splits: b.splits });
      const recomputed = await recomputeContract(tx, contractId);
      return { contractId, rows: b.splits, recomputed };
    }, actor.userId);
  }

  /** Re-tier and recompute every invoice of a month (after quota/plan edits). */
  @Post('recalc')
  @Perm('commission.manage')
  async recalc(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ period: zPeriod }))) b: { period: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await recomputePeriod(tx, b.period);
      await audit(tx, actor, 'recalc', 'commission_entry', null, null, r);
      return r;
    }, actor.userId);
  }

  // ───────────────────────── rep dashboard & leaderboard (HR-54) ─────────────────────────

  /** The signed-in rep's own month: attainment, tiers, earned / payable / paid (month + YTD), entries. */
  @Get('me')
  @Perm('commission.read')
  async me(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ period: zPeriod.optional() }))) q: { period?: string }) {
    const period = q.period ?? currentPeriod();
    return tenantTx(actor.tenantId, async (tx) => ({ ...(await repDashboard(tx, actor.userId, period)), currentPeriod: currentPeriod(), canManage: !!actor.grants['commission.manage'] }));
  }

  /** Reps (within the reader's commission.read scope) ranked by quota attainment for the month. */
  @Get('leaderboard')
  @Perm('commission.read')
  async leaderboard(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ period: zPeriod.optional() }))) q: { period?: string }) {
    const period = q.period ?? currentPeriod();
    return tenantTx(actor.tenantId, async (tx) => {
      const stats = await periodStats(tx, period);
      const ids = [...stats.keys()];
      const users = ids.length ? await tx.select({ id: appUser.id, name: sql<string>`coalesce(${appUser.nameAr}, ${appUser.email})` }).from(appUser).where(and(inArray(appUser.id, ids), repFilter(actor, appUser.id))) : [];
      const [from, to] = monthRange(period);
      const earned = users.length ? await tx.select({ userId: commissionEntry.userId, earned: sql<string>`sum(${commissionEntry.earned})::text` }).from(commissionEntry)
        .innerJoin(invoiceMirror, eq(invoiceMirror.id, commissionEntry.invoiceId))
        .where(and(inArray(commissionEntry.userId, users.map((u) => u.id)), sql`${invoiceMirror.issueDate} >= ${from}`, sql`${invoiceMirror.issueDate} < ${to}`)).groupBy(commissionEntry.userId) : [];
      const rows = users.map((u) => {
        const s = stats.get(u.id)!;
        return { userId: u.id, userName: u.name, revenue: halalasToFixed(s.revenue), quota: s.quota ? halalasToFixed(s.quota) : null, attainment: s.attainment, earned: halalasToFixed(toHalalas(earned.find((e) => e.userId === u.id)?.earned ?? '0')) };
      }).sort((a, b) => (b.attainment ?? -Infinity) - (a.attainment ?? -Infinity) || toHalalas(b.revenue) - toHalalas(a.revenue));
      return { period, rows: rows.map((r, i) => ({ rank: i + 1, ...r })) };
    });
  }

  // ───────────────────────── ledger ─────────────────────────

  @Get('entries')
  @Perm('commission.read')
  async entries(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ userId: zUuid.optional(), status: z.string().max(60).optional(), period: zPeriod.optional(), limit: z.coerce.number().int().min(1).max(500).default(200), offset: z.coerce.number().int().min(0).default(0) }))) q: { userId?: string; status?: string; period?: string; limit: number; offset: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const where = and(
        repFilter(actor),
        q.userId ? eq(commissionEntry.userId, q.userId) : undefined,
        q.status ? inArray(commissionEntry.status, q.status.split(',')) : undefined,
        q.period ? eq(commissionEntry.period, q.period) : undefined,
      );
      const rows = await tx.select({
        e: commissionEntry, invoiceNumber: invoiceMirror.number, invoiceType: invoiceMirror.typeCode, invoiceDate: invoiceMirror.issueDate, invoiceTotal: invoiceMirror.total,
        contractNumber: contract.number, planName: commissionPlan.name, planBasis: commissionPlan.basis, planRate: commissionPlan.ratePercent, userName: sql<string>`coalesce(${appUser.nameAr}, ${appUser.email})`,
      }).from(commissionEntry)
        .leftJoin(invoiceMirror, eq(invoiceMirror.id, commissionEntry.invoiceId)).leftJoin(contract, eq(contract.id, commissionEntry.contractId))
        .leftJoin(commissionPlan, eq(commissionPlan.id, commissionEntry.planId)).leftJoin(appUser, eq(appUser.id, commissionEntry.userId))
        .where(where).orderBy(desc(invoiceMirror.issueDate), desc(commissionEntry.createdAt)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(commissionEntry).where(where)) as [{ n: number }];
      return {
        rows: rows.map((r) => ({
          ...r.e, outstanding: halalasToFixed(toHalalas(r.e.payable) - toHalalas(r.e.paid)),
          invoiceNumber: r.invoiceNumber, invoiceType: r.invoiceType, invoiceDate: r.invoiceDate, invoiceTotal: r.invoiceTotal, contractNumber: r.contractNumber,
          planName: r.planName, planBasis: r.planBasis, planRate: r.planRate, userName: r.userName,
        })),
        total: n,
      };
    });
  }

  @Get('summary')
  @Perm('commission.read')
  async summary(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ period: zPeriod.optional() }))) q: { period?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({
        userId: commissionEntry.userId, userName: sql<string>`coalesce(max(${appUser.nameAr}), max(${appUser.email}))`,
        earned: sql<string>`sum(${commissionEntry.earned})::text`, payable: sql<string>`sum(${commissionEntry.payable})::text`, paid: sql<string>`sum(${commissionEntry.paid})::text`, entries: sql<number>`count(*)::int`,
      }).from(commissionEntry).leftJoin(appUser, eq(appUser.id, commissionEntry.userId))
        .where(and(repFilter(actor), q.period ? eq(commissionEntry.period, q.period) : undefined)).groupBy(commissionEntry.userId);
      const reps = rows.map((r) => {
        const e = toHalalas(r.earned); const p = toHalalas(r.payable); const d = toHalalas(r.paid);
        return { userId: r.userId, userName: r.userName, entries: r.entries, earned: halalasToFixed(e), payable: halalasToFixed(p), paid: halalasToFixed(d), outstanding: halalasToFixed(p - d) };
      }).sort((a, b) => toHalalas(b.earned) - toHalalas(a.earned));
      const sum = (k: 'earned' | 'payable' | 'paid' | 'outstanding') => halalasToFixed(reps.reduce((s, r) => s + toHalalas(r[k]), 0));
      return { period: q.period ?? null, currentPeriod: currentPeriod(), reps, totals: { earned: sum('earned'), payable: sum('payable'), paid: sum('paid'), outstanding: sum('outstanding') }, canManage: !!actor.grants['commission.manage'] };
    });
  }

  /** Payroll hand-off: the outstanding payable of each entry is marked paid in that payroll period. */
  @Post('mark-paid')
  @Perm('commission.manage')
  async markPaid(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ entryIds: z.array(zUuid).min(1).max(2000), period: zPeriod }))) b: { entryIds: string[]; period: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select().from(commissionEntry).where(inArray(commissionEntry.id, b.entryIds));
      if (rows.length !== new Set(b.entryIds).size) throw notFound('commission entry');
      const due = rows.filter((r) => toHalalas(r.payable) - toHalalas(r.paid) !== 0);
      if (!due.length) throw badRequest('nothing outstanding on the selected entries');
      let amount = 0;
      for (const r of due) {
        amount += toHalalas(r.payable) - toHalalas(r.paid);
        await tx.update(commissionEntry).set({ paid: r.payable, status: 'paid', period: b.period, updatedAt: new Date(), updatedBy: actor.userId, version: r.version + 1 }).where(eq(commissionEntry.id, r.id));
      }
      await audit(tx, actor, 'mark_paid', 'commission_entry', null, null, { period: b.period, entries: due.map((r) => r.id), amount: halalasToFixed(amount) });
      return { marked: due.length, skipped: rows.length - due.length, amount: halalasToFixed(amount), period: b.period };
    }, actor.userId);
  }

  /** CSV for payroll: outstanding payable per employee, for entries payable in or before the period. */
  @Get('export')
  @Perm('commission.manage')
  async export(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ period: zPeriod }))) q: { period: string }, @Res() res: Response) {
    const rows = await tenantTx(actor.tenantId, (tx) => tx.select({
      userId: commissionEntry.userId, email: sql<string>`max(${appUser.email})`, name: sql<string>`coalesce(max(${appUser.nameAr}), max(${appUser.email}))`,
      amount: sql<string>`sum(${commissionEntry.payable} - ${commissionEntry.paid})::text`, entries: sql<number>`count(*)::int`,
    }).from(commissionEntry).leftJoin(appUser, eq(appUser.id, commissionEntry.userId))
      .where(and(eq(commissionEntry.status, 'payable'), sql`${commissionEntry.period} <= ${q.period}`)).groupBy(commissionEntry.userId));
    const lines = [['employee', 'email', 'amount', 'entries', 'period'].join(','), ...rows.filter((r) => toHalalas(r.amount) !== 0).map((r) => [csvCell(r.name), csvCell(r.email), halalasToFixed(toHalalas(r.amount)), r.entries, q.period].join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="commissions-${q.period}.csv"`);
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  }

  // ───────────────────────── technicians ─────────────────────────

  @Get('technicians')
  @Perm('commission.read')
  async technicians(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ from: zDate.optional(), to: zDate.optional() }))) q: { from?: string; to?: string }) {
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const from = q.from ?? `${today.slice(0, 7)}-01`;
    const to = q.to ?? today;
    if (from > to) throw badRequest('from must be before to');
    return tenantTx(actor.tenantId, async (tx) => {
      const rules = await techRules(tx);
      return { ...(await technicianIncentives(tx, from, to, repFilter(actor, workOrder.technicianId), rules.rules)), rules: rules.rules, rulesAreDefault: rules.isDefault };
    });
  }

  /** Technician incentive rules (HR-55), stored on the company; defaults until a manager changes them. */
  @Get('technician-rules')
  @Perm('commission.read')
  async getTechRules(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => techRules(tx));
  }

  @Put('technician-rules')
  @Perm('commission.manage')
  async putTechRules(@Actor() actor: RequestActor, @Body(new ZodPipe(techRulesSchema)) b: z.infer<typeof techRulesSchema>) {
    if (!actor.grants['commission.manage']) throw forbidden('commission.manage required');
    return tenantTx(actor.tenantId, async (tx) => {
      const co = await loadCompany(tx);
      await tx.update(company).set({ techIncentiveRules: b, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(company.id, co.id));
      await audit(tx, actor, 'update_tech_incentive_rules', 'company', co.id, { rules: co.techIncentiveRules ?? null }, { rules: b });
      return { rules: b, isDefault: false };
    }, actor.userId);
  }
}

async function techRules(tx: Parameters<typeof loadCompany>[0]) {
  const co = await loadCompany(tx);
  return co.techIncentiveRules ? { rules: co.techIncentiveRules, isDefault: false } : { rules: DEFAULT_TECH_INCENTIVES, isDefault: true };
}
