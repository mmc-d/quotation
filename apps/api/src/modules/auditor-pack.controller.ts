import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { tenantTx } from '../common/db.js';
import { ZodPipe, zDate } from '../common/zod.js';
import { buildAuditorPack } from './auditor-pack.service.js';

/** Yearly package for the external auditor — includes salary data, so it needs ledger.close (owner / general manager). */
@Controller('accounting')
export class AuditorPackController {
  @Get('auditor-pack')
  @Perm('ledger.close')
  async pack(@Actor() actor: RequestActor, @Res() res: Response, @Query(new ZodPipe(z.object({ start: zDate.optional() }))) q: { start?: string }) {
    const { file, buf } = await buildAuditorPack(actor, q.start);
    await tenantTx(actor.tenantId, (tx) => audit(tx, actor, 'export', 'auditor_pack', file, null, { bytes: buf.length }), actor.userId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    return res.send(buf);
  }
}
