import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { HealthController } from './health.controller.js';
import { AuditController, FilesController, MeController, SettingsController, UsersController } from './modules/platform.controller.js';
import { PartiesController, ProductsController } from './modules/parties.controller.js';
import { QuotesController } from './modules/quotes.controller.js';
import { ContractsController } from './modules/contracts.controller.js';
import { DashboardController } from './modules/dashboard.controller.js';
import { CrmController } from './modules/crm.controller.js';
import { PublicController, WhatsAppWebhookController } from './modules/public.controller.js';
import { FinanceController, FinancePublicController } from './modules/finance.controller.js';
import { JobsController } from './modules/jobs.controller.js';

@Module({
  controllers: [
    HealthController, MeController, SettingsController, UsersController, AuditController, FilesController,
    PartiesController, ProductsController, QuotesController, ContractsController, DashboardController,
    CrmController, PublicController, WhatsAppWebhookController, FinanceController, FinancePublicController, JobsController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
