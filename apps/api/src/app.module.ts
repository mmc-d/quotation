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
import { LeadsWebhookController, PublicController, WhatsAppWebhookController } from './modules/public.controller.js';
import { FinanceController, FinancePublicController } from './modules/finance.controller.js';
import { JobsController } from './modules/jobs.controller.js';
import { PriceListsController } from './modules/pricelists.controller.js';
import { ChangeOrdersController } from './modules/change-orders.controller.js';
import { CalendarController } from './modules/calendar.controller.js';
import { ProjectsController } from './modules/projects.controller.js';
import { FieldServiceController } from './modules/field-service.controller.js';
import { InventoryController } from './modules/inventory.controller.js';
import { PayablesController } from './modules/payables.controller.js';
import { RfqController } from './modules/rfq.controller.js';
import { ServiceController } from './modules/service.controller.js';
import { PortalController } from './modules/portal.controller.js';
import { InsightsController } from './modules/insights.controller.js';
import { ErpSyncController } from './modules/erp-sync.controller.js';
import { IotBindingController, IotController } from './modules/iot.controller.js';
import { CommissionsController } from './modules/commissions.controller.js';
import { KbController } from './modules/kb.controller.js';
import { AiController } from './ai/ai.controller.js';
import { McpController } from './ai/mcp.js';

@Module({
  controllers: [
    HealthController, MeController, SettingsController, UsersController, AuditController, FilesController,
    PartiesController, ProductsController, QuotesController, ContractsController, DashboardController,
    CrmController, PublicController, WhatsAppWebhookController, LeadsWebhookController, FinanceController, FinancePublicController, JobsController,
    PriceListsController, ChangeOrdersController, CalendarController, ProjectsController, FieldServiceController, InventoryController, PayablesController, RfqController, ServiceController, PortalController, InsightsController, ErpSyncController,
    IotController, IotBindingController, CommissionsController, KbController,
    AiController, McpController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
