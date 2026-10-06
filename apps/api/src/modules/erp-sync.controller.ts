import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { tenantTx } from '../common/db.js';
import { ZodPipe } from '../common/zod.js';
import { syncPending, syncStatus } from './erp-sync.service.js';

const runBody = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }).default({});

/** Phase 5 → ERPNext push (procurement & stock records). Admin only. */
@Controller('erp-sync')
export class ErpSyncController {
  @Get('status')
  @Perm('admin.settings')
  async status(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => syncStatus(tx, actor.tenantId));
  }

  @Post('run')
  @Perm('admin.settings')
  async run(@Actor() actor: RequestActor, @Body(new ZodPipe(runBody)) b: { limit?: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await syncPending(tx, actor.tenantId, { limit: b.limit });
      await audit(tx, actor, 'erp_sync', 'erp_link', null, null, { pushed: r.pushed, items: r.items, errors: r.errors.length, skipped: r.skipped ?? null });
      return r;
    }, actor.userId);
  }
}
