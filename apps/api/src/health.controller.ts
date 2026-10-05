import { Controller, Get } from '@nestjs/common';
import { sql } from '@mmc/db';
import { Public } from './auth/actor.js';
import { getDb } from './common/db.js';
import { config } from './config.js';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  async health() {
    const t0 = Date.now();
    await getDb().execute(sql`select 1`);
    return {
      ok: true,
      db: { latencyMs: Date.now() - t0 },
      integrations: {
        backOffice: config.erpnext.url ? 'erpnext' : 'fake (development only)',
        whatsapp: config.whatsapp.accessToken ? 'cloud-api' : 'sandbox',
        email: config.smtpUrl ? 'smtp' : 'sandbox',
        esign: config.esign.provider,
        payments: config.payments.provider,
        googleSignIn: !!config.google.clientId,
      },
    };
  }
}
