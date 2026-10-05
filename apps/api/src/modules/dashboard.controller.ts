import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { and, gte, lte, quote, sql, opportunity, lead, activity, invoiceMirror, paymentRequest } from '@mmc/db';
import { riyadhDate } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { scopeFilter } from '../common/scope.js';
import { ZodPipe, zDate } from '../common/zod.js';

const range = z.object({ from: zDate.optional(), to: zDate.optional() });

function defaultRange(r: { from?: string; to?: string }) {
  const to = r.to ?? riyadhDate();
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(1);
  return { from: r.from ?? d.toISOString().slice(0, 10), to };
}

/** Reporting v1 (module 10): CEO cockpit tiles, quote register, win rate, discount & margin. */
@Controller('dashboard')
export class DashboardController {
  @Get('cockpit')
  @Perm('quote.read')
  async cockpit(@Actor() actor: RequestActor, @Query(new ZodPipe(range)) r: { from?: string; to?: string }) {
    const { from, to } = defaultRange(r);
    return tenantTx(actor.tenantId, async (tx) => {
      const qScope = scopeFilter(actor, 'quote.read', { owner: quote.ownerId, team: quote.teamId, branch: quote.branchId });
      const inRange = and(qScope, gte(quote.quoteDate, from), lte(quote.quoteDate, to), sql`${quote.status} <> 'superseded'`);
      const [q] = await tx.select({
        count: sql<number>`count(*)::int`,
        value: sql<string>`coalesce(sum(${quote.total}),0)`,
        sent: sql<number>`count(*) filter (where ${quote.sentAt} is not null)::int`,
        accepted: sql<number>`count(*) filter (where ${quote.status} = 'accepted')::int`,
        acceptedValue: sql<string>`coalesce(sum(${quote.total}) filter (where ${quote.status} = 'accepted'),0)`,
        lost: sql<number>`count(*) filter (where ${quote.status} in ('lost','rejected'))::int`,
        pendingApproval: sql<number>`count(*) filter (where ${quote.status} = 'pending_approval')::int`,
        avgDiscount: sql<string>`coalesce(avg(case when ${quote.subtotal} > 0 then ${quote.discountAmount} / ${quote.subtotal} * 100 end),0)`,
        margin: sql<string>`coalesce(sum(${quote.marginTotal}) filter (where ${quote.costTotal} > 0),0)`,
        marginBase: sql<string>`coalesce(sum(${quote.taxable}) filter (where ${quote.costTotal} > 0),0)`,
      }).from(quote).where(inRange);
      const decided = (q?.accepted ?? 0) + (q?.lost ?? 0);
      const byDay = await tx.select({ day: quote.quoteDate, count: sql<number>`count(*)::int`, value: sql<string>`sum(${quote.total})` }).from(quote).where(inRange).groupBy(quote.quoteDate).orderBy(quote.quoteDate);
      const byRep = await tx.execute(sql`
        select u.id, coalesce(u.name_ar, u.email) as name, count(q.*)::int as quotes,
               count(*) filter (where q.status = 'accepted')::int as won,
               coalesce(sum(q.total) filter (where q.status = 'accepted'),0) as won_value,
               coalesce(sum(q.total),0) as value
        from quote q join app_user u on u.id = q.owner_id
        where q.quote_date between ${from} and ${to} and q.status <> 'superseded' ${qScope ? sql`and ${qScope}` : sql``}
        group by u.id order by value desc`);
      const pipeline = actor.grants['opportunity.read'] ? await tx.execute(sql`
        select s.key, s.name_ar, s.name_en, s.sort, s.kind, count(o.*)::int as count, coalesce(sum(o.amount),0) as amount, coalesce(sum(o.amount * o.probability / 100.0),0) as weighted
        from pipeline_stage s left join opportunity o on o.stage_id = s.id
        group by s.id order by s.sort`) : [];
      const leads = actor.grants['lead.read'] ? (await tx.select({ total: sql<number>`count(*)::int`, fresh: sql<number>`count(*) filter (where ${lead.status} = 'new')::int`, converted: sql<number>`count(*) filter (where ${lead.status} = 'converted')::int` }).from(lead).where(and(gte(lead.createdAt, new Date(`${from}T00:00:00+03:00`)), lte(lead.createdAt, new Date(`${to}T23:59:59+03:00`)))))[0] : null;
      const tasks = (await tx.select({ open: sql<number>`count(*) filter (where ${activity.doneAt} is null and ${activity.dueAt} is not null)::int`, overdue: sql<number>`count(*) filter (where ${activity.doneAt} is null and ${activity.dueAt} < now())::int` }).from(activity).where(sql`${activity.ownerId} = ${actor.userId}`))[0];
      const ar = actor.grants['invoice.read'] ? (await tx.select({ outstanding: sql<string>`coalesce(sum(${invoiceMirror.balanceDue}),0)`, overdue: sql<string>`coalesce(sum(${invoiceMirror.balanceDue}) filter (where ${invoiceMirror.dueDate} < current_date),0)` }).from(invoiceMirror))[0] : null;
      const requested = actor.grants['billing.read'] ? (await tx.select({ open: sql<string>`coalesce(sum(${paymentRequest.amount} - ${paymentRequest.paidAmount}) filter (where ${paymentRequest.status} in ('sent','partially_paid')),0)` }).from(paymentRequest))[0] : null;
      const seeMargin = !!actor.grants['quote.cost.read'];
      return {
        range: { from, to },
        quotes: {
          count: q?.count ?? 0, value: q?.value ?? '0', sent: q?.sent ?? 0, accepted: q?.accepted ?? 0, acceptedValue: q?.acceptedValue ?? '0', lost: q?.lost ?? 0, pendingApproval: q?.pendingApproval ?? 0,
          winRate: decided ? Math.round(((q?.accepted ?? 0) / decided) * 1000) / 10 : null,
          avgDiscountPercent: Math.round(Number(q?.avgDiscount ?? 0) * 10) / 10,
          marginPercent: seeMargin && Number(q?.marginBase) > 0 ? Math.round((Number(q?.margin) / Number(q?.marginBase)) * 1000) / 10 : null,
        },
        byDay, byRep, pipeline, leads, tasks, ar, requested,
      };
    });
  }

  /** Quote register with discount and margin per quote (margin only with cost permission). */
  @Get('quote-register')
  @Perm('report.sales')
  async register(@Actor() actor: RequestActor, @Query(new ZodPipe(range)) r: { from?: string; to?: string }) {
    const { from, to } = defaultRange(r);
    const seeMargin = !!actor.grants['quote.cost.read'];
    return tenantTx(actor.tenantId, async (tx) => {
      const scope = scopeFilter(actor, 'report.sales', { owner: quote.ownerId, team: quote.teamId });
      return tx.execute(sql`
        select q.id, q.number, q.revision, q.quote_date, q.status, coalesce(p.name_ar, q.client_name) as client, coalesce(u.name_ar, u.email) as owner,
               q.subtotal, q.discount_amount, case when q.subtotal > 0 then round(q.discount_amount / q.subtotal * 100, 1) end as discount_percent,
               q.total ${seeMargin ? sql`, q.cost_total, q.margin_total, case when q.taxable > 0 and q.cost_total > 0 then round(q.margin_total / q.taxable * 100, 1) end as margin_percent` : sql``}
        from quote q left join party p on p.id = q.party_id left join app_user u on u.id = q.owner_id
        where q.quote_date between ${from} and ${to} and q.status <> 'superseded' ${scope ? sql`and ${scope}` : sql``}
        order by q.quote_date desc, q.number desc`);
    });
  }

  @Get('lost-reasons')
  @Perm('report.sales')
  async lostReasons(@Actor() actor: RequestActor, @Query(new ZodPipe(range)) r: { from?: string; to?: string }) {
    const { from, to } = defaultRange(r);
    return tenantTx(actor.tenantId, (tx) => tx.execute(sql`
      select coalesce(o.lost_reason_key, 'other') as reason, count(*)::int as count, coalesce(sum(o.amount),0) as amount
      from opportunity o where o.lost_at between ${`${from}T00:00:00+03:00`}::timestamptz and ${`${to}T23:59:59+03:00`}::timestamptz group by 1 order by 2 desc`));
  }
}

export { opportunity };
