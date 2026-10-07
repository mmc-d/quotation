import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { riyadhDate } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { ZodPipe, zDate, zMoney, zPage, zQty, zUuid } from '../common/zod.js';
import {
  PAYMENT_METHODS, addSupplierPayment, billView, createDirectBill, listBills, listOpenings, openingStock, openingView, payablesAging, voidSupplierPayment,
} from './payables.service.js';

/**
 * Supplier bills without a PO, payments to suppliers, the payables list / aging and opening stock,
 * under /api/inventory next to the PO-based bills (InventoryController).
 */

const zText = (max = 2000) => z.string().trim().max(max);
const zPrice = zMoney.refine((v) => Number(v) >= 0, 'must not be negative');
const zBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const CURRENCIES = ['SAR', 'USD', 'CNY', 'EUR', 'AED'] as const;

const billsQuery = zPage.extend({
  orderId: zUuid.optional(), supplierId: zUuid.optional(), matchStatus: z.enum(['matched', 'exception', 'direct']).optional(), status: z.string().max(200).optional(),
  kind: z.enum(['po', 'direct']).optional(), unpaid: zBool.optional(), overdue: zBool.optional(), from: zDate.optional(), to: zDate.optional(),
});
const directBillSchema = z.object({
  supplierId: zUuid, supplierInvoiceNo: zText(100).min(1), billDate: zDate, dueDate: zDate.nullish(), currency: z.enum(CURRENCIES).default('SAR'), rateToSar: zMoney.optional(),
  receive: z.boolean().default(true), warehouseId: zUuid.nullish(), projectId: zUuid.nullish(), notes: zText(2000).nullish(), fileId: zUuid.nullish(),
  lines: z.array(z.object({
    productId: zUuid.nullish(), code: zText(64).nullish(), description: zText(500).nullish(), qty: zQty, unitPrice: zPrice,
    vatPercent: zPrice.refine((v) => Number(v) <= 100, 'at most 100').nullish(), serials: z.array(zText(120)).max(5000).optional(),
  })).min(1).max(500),
  vat: zPrice.nullish(),
  paidNow: z.object({ method: z.enum(PAYMENT_METHODS), reference: zText(200).nullish() }).nullish(),
});
const paymentSchema = z.object({ paidOn: zDate.default(() => riyadhDate()), amount: zPrice, method: z.enum(PAYMENT_METHODS).default('bank_transfer'), reference: zText(200).nullish(), note: zText(500).nullish() });
const openingSchema = z.object({
  warehouseId: zUuid.nullish(), openedOn: zDate.default(() => riyadhDate()), notes: zText(2000).nullish(), preview: z.boolean().optional(),
  sheet: z.string().max(2_000_000).nullish(),
  lines: z.array(z.object({ productId: zUuid.nullish(), code: zText(64).nullish(), qty: zQty, unitCostSar: zPrice.nullish(), serials: z.array(zText(120)).max(5000).optional() })).max(2000).optional(),
});

@Controller('inventory')
export class PayablesController {
  // ───────────────────────── supplier bills ─────────────────────────

  @Get('bills')
  @Perm('purchase.read')
  async bills(@Actor() actor: RequestActor, @Query(new ZodPipe(billsQuery)) q: z.infer<typeof billsQuery>) {
    return tenantTx(actor.tenantId, (tx) => listBills(tx, actor, q), actor.userId);
  }

  @Get('bills/aging')
  @Perm('purchase.cost.read')
  async aging(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => payablesAging(tx, actor), actor.userId);
  }

  @Get('bills/:id')
  @Perm('purchase.read')
  async bill(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => billView(tx, actor, id), actor.userId);
  }

  @Post('bills/direct')
  @Perm('purchase.write')
  async addDirect(@Actor() actor: RequestActor, @Body(new ZodPipe(directBillSchema)) b: z.infer<typeof directBillSchema>) {
    return tenantTx(actor.tenantId, (tx) => createDirectBill(tx, actor, b), actor.userId);
  }

  @Post('bills/:id/payments')
  @Perm('payment.record', 'purchase.approve')
  async pay(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(paymentSchema)) b: z.infer<typeof paymentSchema>) {
    return tenantTx(actor.tenantId, (tx) => addSupplierPayment(tx, actor, id, b), actor.userId);
  }

  @Post('bills/:id/payments/:paymentId/void')
  @Perm('payment.record', 'purchase.approve')
  async voidPay(@Actor() actor: RequestActor, @Param('id') id: string, @Param('paymentId') paymentId: string, @Body(new ZodPipe(z.object({ reason: zText(500).min(1) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, (tx) => voidSupplierPayment(tx, actor, id, paymentId, b.reason), actor.userId);
  }

  // ───────────────────────── opening stock ─────────────────────────

  @Get('opening-balances')
  @Perm('inventory.read')
  async openings(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => listOpenings(tx, actor), actor.userId);
  }

  @Get('opening-balances/:id')
  @Perm('inventory.read')
  async opening(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => openingView(tx, actor, id), actor.userId);
  }

  @Post('opening-balances')
  @Perm('inventory.count')
  async addOpening(@Actor() actor: RequestActor, @Body(new ZodPipe(openingSchema)) b: z.infer<typeof openingSchema>) {
    return tenantTx(actor.tenantId, (tx) => openingStock(tx, actor, b), actor.userId);
  }
}
