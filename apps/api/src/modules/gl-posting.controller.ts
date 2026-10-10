import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { ZodPipe, zUuid } from '../common/zod.js';
import { grniReport, postPending, postingExceptions, reclassifyLine, reconciliationChecks } from './gl-posting.service.js';

/** Auto-posting: run now, the exceptions screen («بانتظار التوجيه المحاسبي») and reclassification. */
@Controller('accounting')
export class GlPostingController {
  /** «رحّل الآن»: post everything pending (the 10-minute job does the same). */
  @Post('posting/run')
  @Perm('ledger.post')
  async run(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await postPending(tx);
      await audit(tx, actor, 'post_pending', 'ledger', actor.tenantId, null, r);
      return r;
    }, actor.userId);
  }

  @Get('posting/exceptions')
  @Perm('ledger.read')
  async exceptions(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => postingExceptions(tx));
  }

  @Post('posting/reclassify')
  @Perm('ledger.post')
  async reclassify(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ entryId: zUuid, lineId: zUuid, accountId: zUuid }))) b: { entryId: string; lineId: string; accountId: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await reclassifyLine(tx, actor, b);
      await audit(tx, actor, 'reclassify', 'journal_entry', b.entryId, null, { toAccount: b.accountId, reversal: r.reversal.number, entry: r.entry.number });
      return r;
    }, actor.userId);
  }

  /** Goods received but not yet billed (GRNI), per purchase-order line, at receipt cost. */
  @Get('reports/grni')
  @Perm('ledger.read')
  async grni(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => grniReport(tx));
  }

  @Get('reports/reconciliation')
  @Perm('ledger.read')
  async reconciliation(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => reconciliationChecks(tx));
  }
}
