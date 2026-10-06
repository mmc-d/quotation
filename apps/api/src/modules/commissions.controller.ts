import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { and, appUser, asc, commissionEntry, commissionPlan, contract, desc, eq, inArray, invoiceMirror, sql, workOrder } from '@mmc/db';
import { halalasToFixed, toHalalas } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { audit, diff } from '../common/audit.js';
import { tenantTx } from '../common/db.js';
import { badRequest, notFound } from '../common/errors.js';
import { ZodPipe, zDate, zUuid } from '../common/zod.js';
import { currentPeriod, repFilter, technicianIncentives } from './commissions.service.js';

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
}).refine((v) => !v.validFrom || !v.validTo || v.validFrom <= v.validTo, 'validFrom must be before validTo');
type PlanInput = z.infer<typeof planSchema>;

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  // neutralise spreadsheet formulas and quote when needed
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

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
    return tenantTx(actor.tenantId, (tx) => technicianIncentives(tx, from, to, repFilter(actor, workOrder.technicianId)));
  }
}
