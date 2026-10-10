import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { forbidden } from '../common/errors.js';
import { ZodPipe, zDate } from '../common/zod.js';
import { closeYear, reopenYear, yearsOverview } from './closing.service.js';
import { fx } from './report-kit.js';

/** Fiscal years and the year-end close (Phase 6C). Needs ledger.close — owner and general manager only. */

@Controller('accounting/fiscal-years')
export class ClosingController {
  @Get()
  @Perm('ledger.read')
  async list(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => yearsOverview(tx));
  }

  @Post('close')
  @Perm('ledger.close')
  async close(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ start: zDate }))) b: { start: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await closeYear(tx, actor, b.start);
      await audit(tx, actor, 'close_year', 'fiscal_year', b.start, null, { label: r.label, profit: fx(r.profit), entry: r.entry?.number ?? null, lockedThrough: r.lockedThrough });
      return { label: r.label, profit: fx(r.profit), entry: r.entry, lockedThrough: r.lockedThrough };
    }, actor.userId);
  }

  @Post('reopen')
  @Perm('ledger.close')
  async reopen(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ start: zDate, reason: z.string().trim().min(1).max(500) }))) b: { start: string; reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (!actor.roleKeys.includes('owner')) throw forbidden('only the owner can re-open a closed year');
      const r = await reopenYear(tx, actor, b.start, b.reason);
      await audit(tx, actor, 'reopen_year', 'fiscal_year', b.start, { status: 'closed' }, { status: 'open', label: r.label }, b.reason);
      return r;
    }, actor.userId);
  }
}
