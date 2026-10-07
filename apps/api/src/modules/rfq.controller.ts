import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { INCOTERMS } from '@mmc/domain';
import { htmlToPdf, renderRfqHtml } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { ZodPipe, zDate, zMoney, zPage, zQty, zUuid } from '../common/zod.js';
import { config } from '../config.js';
import {
  awardRfq, cancelRfq, createRfq, listRfqs, parseSupplierInvoice, rfqComparison, rfqDocFor, rfqView, sendRfq, upsertQuote, type Channel,
} from './rfq.service.js';
import { MAX_XML_BYTES } from './zatca-xml.js';

/**
 * RFQs and supplier quotations (INV-65) and supplier e-invoice parsing (INV-66), under
 * /api/inventory next to the purchasing endpoints. Prices need purchase.cost.read to be read.
 */

const zText = (max = 2000) => z.string().trim().max(max);
const CURRENCIES = ['SAR', 'USD', 'CNY', 'EUR', 'AED'] as const;
const zPrice = zMoney.refine((v) => Number(v) >= 0, 'must not be negative');
const zPercent = zMoney.refine((v) => Number(v) >= 0 && Number(v) <= 500, '0–500');
const zChannel = z.enum(['auto', 'email', 'whatsapp', 'none']);

const rfqSchema = z.object({
  materialRequestId: zUuid.nullish(),
  lines: z.array(z.object({ productId: zUuid.nullish(), code: zText(64).optional(), description: zText(500).nullish(), qty: zQty })
    .refine((l) => !!l.productId || !!l.code, 'a line needs a product or a code')).max(500).optional(),
  supplierIds: z.array(zUuid).min(1).max(30),
  dueDate: zDate.nullish(),
  notes: zText(5000).nullish(),
}).refine((b) => !!b.materialRequestId || !!b.lines?.length, 'give a material request or lines');

const quoteSchema = z.object({
  supplierId: zUuid, currency: z.enum(CURRENCIES).default('USD'), rateToSar: zMoney.optional(), incoterm: z.enum(INCOTERMS).nullish(),
  leadTimeDays: z.number().int().min(0).max(720).nullish(), validUntil: zDate.nullish(), landedPercent: zPercent.default('0'),
  lines: z.array(z.object({ code: zText(64).min(1), qty: zQty.optional(), unitPrice: zPrice.nullable(), note: zText(500).nullish() })).min(1).max(500),
  fileId: zUuid.nullish(), notes: zText(5000).nullish(),
});

const listQuery = zPage.extend({ status: z.string().optional(), materialRequestId: zUuid.optional() });

@Controller('inventory')
export class RfqController {
  @Get('rfqs')
  @Perm('purchase.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return tenantTx(actor.tenantId, (tx) => listRfqs(tx, q), actor.userId);
  }

  @Post('rfqs')
  @Perm('purchase.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(rfqSchema)) b: z.infer<typeof rfqSchema>) {
    return tenantTx(actor.tenantId, async (tx) => rfqView(tx, actor, (await createRfq(tx, actor, b)).id), actor.userId);
  }

  @Get('rfqs/:id')
  @Perm('purchase.read')
  async get(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => rfqView(tx, actor, id), actor.userId);
  }

  /** The bilingual RFQ document for one supplier (PDF; `?format=html` for the HTML). No prices. */
  @Get('rfqs/:id/pdf')
  @Perm('purchase.read')
  async pdf(@Actor() actor: RequestActor, @Param('id') id: string, @Res() res: Response, @Query('supplierId') supplierId?: string, @Query('format') format?: string) {
    const doc = await tenantTx(actor.tenantId, (tx) => rfqDocFor(tx, id, supplierId || undefined), actor.userId);
    const html = renderRfqHtml(doc);
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
      return;
    }
    const pdf = await htmlToPdf(html, config.gotenbergUrl);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.number}.pdf"`);
    res.send(pdf);
  }

  @Post('rfqs/:id/send')
  @Perm('purchase.write')
  async send(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ channel: zChannel.optional(), supplierIds: z.array(zUuid).max(30).optional() }).default({}))) b: { channel?: Channel; supplierIds?: string[] }) {
    return tenantTx(actor.tenantId, (tx) => sendRfq(tx, actor, id, b), actor.userId);
  }

  @Post('rfqs/:id/quotes')
  @Perm('purchase.write')
  async quote(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(quoteSchema)) b: z.infer<typeof quoteSchema>) {
    return tenantTx(actor.tenantId, (tx) => upsertQuote(tx, actor, id, b), actor.userId);
  }

  @Get('rfqs/:id/comparison')
  @Perm('purchase.read')
  async comparison(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => rfqComparison(tx, actor, id), actor.userId);
  }

  @Post('rfqs/:id/award')
  @Perm('purchase.write')
  async award(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ supplierQuoteId: zUuid, expectedOn: zDate.nullish(), depositPercent: z.number().int().min(0).max(100).optional() }))) b: { supplierQuoteId: string; expectedOn?: string | null; depositPercent?: number }) {
    return tenantTx(actor.tenantId, (tx) => awardRfq(tx, actor, id, b), actor.userId);
  }

  @Post('rfqs/:id/cancel')
  @Perm('purchase.write')
  async cancel(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: zText(1000).nullish() }).default({}))) b: { reason?: string | null }) {
    return tenantTx(actor.tenantId, (tx) => cancelRfq(tx, actor, id, b.reason), actor.userId);
  }

  /** Parse a supplier's ZATCA UBL 2.1 invoice into a bill proposal (nothing booked; see POST /inventory/bills). */
  @Post('bills/parse-xml')
  @Perm('purchase.write')
  async parseXml(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ fileId: zUuid.nullish(), xml: z.string().max(MAX_XML_BYTES).nullish(), supplierId: zUuid.nullish(), orderId: zUuid.nullish() })
    .refine((b) => !!b.fileId || !!b.xml, 'give fileId or xml'))) b: { fileId?: string | null; xml?: string | null; supplierId?: string | null; orderId?: string | null }) {
    return tenantTx(actor.tenantId, (tx) => parseSupplierInvoice(tx, actor, b), actor.userId);
  }
}
