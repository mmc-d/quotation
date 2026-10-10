import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { riyadhDate } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { ZodPipe, zDate } from '../common/zod.js';
import { aging, agingJson, agingTable, cashFlow, cashFlowJson, cashFlowTable, equityChanges, equityJson, equityTable, zakat, zakatJson, zakatTable } from './statements.service.js';
import { defaultRange, reportFormat, send, H, type ReportFormat } from './report-kit.js';

/** Supporting statements (Phase 6C): cash flow, changes in equity, aging, Zakat-base schedule. */

const range = z.object({ from: zDate.optional(), to: zDate.optional(), format: reportFormat }).refine((r) => !r.from || !r.to || r.from <= r.to, 'from must not be after to');
type Range = { from?: string; to?: string; format: ReportFormat };

@Controller('accounting/reports')
export class StatementsController {
  @Get('cash-flow')
  @Perm('ledger.read')
  async cash(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(range)) q: Range) {
    const { p, c } = await tenantTx(actor.tenantId, async (tx) => {
      const p = await defaultRange(tx, q);
      return { p, c: await cashFlow(tx, p.from, p.to) };
    });
    return send(res, actor, q.format, cashFlowJson(c, p), cashFlowTable(c, p), 'cash-flow');
  }

  @Get('equity-changes')
  @Perm('ledger.read')
  async equity(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(range)) q: Range) {
    const r = await tenantTx(actor.tenantId, async (tx) => {
      const p = await defaultRange(tx, q);
      return equityChanges(tx, p.from, p.to);
    });
    return send(res, actor, q.format, equityJson(r), equityTable(r), 'equity-changes');
  }

  @Get('aging')
  @Perm('ledger.read')
  async agingReport(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(z.object({ side: z.enum(['ar', 'ap']).default('ar'), asOf: zDate.optional(), format: reportFormat }))) q: { side: 'ar' | 'ap'; asOf?: string; format: ReportFormat }) {
    const a = await tenantTx(actor.tenantId, (tx) => aging(tx, q.side, q.asOf ?? riyadhDate()));
    return send(res, actor, q.format, agingJson(a), agingTable(a), `aging-${q.side}`);
  }

  @Get('zakat')
  @Perm('ledger.read')
  async zakatReport(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(z.object({
    asOf: zDate.optional(), rate: z.enum(['hijri', 'gregorian']).default('gregorian'), adjustments: z.union([z.string(), z.number()]).transform(String).refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), 'invalid amount').default('0'), format: reportFormat,
  }))) q: { asOf?: string; rate: 'hijri' | 'gregorian'; adjustments: string; format: ReportFormat }) {
    const z0 = await tenantTx(actor.tenantId, (tx) => zakat(tx, q.asOf ?? riyadhDate(), { rate: q.rate, profitAdjustments: H(q.adjustments) }));
    return send(res, actor, q.format, zakatJson(z0), zakatTable(z0), 'zakat-base');
  }
}
