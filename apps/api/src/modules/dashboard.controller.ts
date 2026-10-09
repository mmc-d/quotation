import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { alias, opportunity, quote, sql } from '@mmc/db';
import { riyadhDate } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { scopeFilter } from '../common/scope.js';
import { ZodPipe, zDate } from '../common/zod.js';
import { badRequest } from '../common/errors.js';
import { homeDashboard } from './dashboard.service.js';

const range = z.object({ from: zDate.optional(), to: zDate.optional() });

function defaultRange(r: { from?: string; to?: string }) {
  const to = r.to ?? riyadhDate();
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(1);
  return { from: r.from ?? d.toISOString().slice(0, 10), to };
}

/** Reporting (module 10): the home control room, quote register with discount & margin, lost reasons. */
@Controller('dashboard')
export class DashboardController {
  /**
   * Home control room for every signed-in user: action inbox, cash, period funnel, projects at risk,
   * trend and sales team. No single permission gates it — each section is filled only for the
   * permissions the viewer holds (see dashboard.service.ts).
   */
  @Get('home')
  @Perm()
  async home(@Actor() actor: RequestActor, @Query(new ZodPipe(range)) r: { from?: string; to?: string }) {
    const { from, to } = defaultRange(r);
    if (from > to) throw badRequest('the period starts after it ends');
    if (Date.parse(to) - Date.parse(from) > 5 * 366 * 86400000) throw badRequest('the period is limited to five years');
    return tenantTx(actor.tenantId, (tx) => homeDashboard(tx, actor, { from, to }));
  }

  /** Quote register with discount and margin per quote (margin only with cost permission). */
  @Get('quote-register')
  @Perm('report.sales')
  async register(@Actor() actor: RequestActor, @Query(new ZodPipe(range)) r: { from?: string; to?: string }) {
    const { from, to } = defaultRange(r);
    const seeMargin = !!actor.grants['quote.cost.read'];
    return tenantTx(actor.tenantId, async (tx) => {
      // the raw query aliases quote as q, so the scope filter must be built on the same alias
      const q = alias(quote, 'q');
      const scope = scopeFilter(actor, 'report.sales', { owner: q.ownerId, team: q.teamId });
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
    const o = alias(opportunity, 'o');
    const scope = scopeFilter(actor, 'report.sales', { owner: o.ownerId, team: o.teamId });
    return tenantTx(actor.tenantId, (tx) => tx.execute(sql`
      select coalesce(o.lost_reason_key, 'other') as reason, count(*)::int as count, coalesce(sum(o.amount),0) as amount
      from opportunity o where o.lost_at between ${`${from}T00:00:00+03:00`}::timestamptz and ${`${to}T23:59:59+03:00`}::timestamptz ${scope ? sql`and ${scope}` : sql``}
      group by 1 order by 2 desc`));
  }
}

