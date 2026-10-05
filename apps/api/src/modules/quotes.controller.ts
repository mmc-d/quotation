import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { and, appUser, contact, desc, eq, gte, ilike, inArray, lte, or, party, quote, sql } from '@mmc/db';
import { formatSar, normalizeArabic } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { badRequest } from '../common/errors.js';
import { sendTemplate } from '../common/messaging.js';
import { scopeFilter, assertCan } from '../common/scope.js';
import { ZodPipe, zDate, zMoney, zPage, zQty } from '../common/zod.js';
import {
  createQuote, decideQuote, getQuoteView, issueQuoteDocument, logActivity, markQuoteSent, renderQuotePdf, reviseQuote, setQuoteStatus, submitQuote, updateQuote, type QuoteInput,
} from './quotes.service.js';

const lineSchema = z.object({
  productId: z.string().uuid().nullish(),
  code: z.string().min(1),
  description: z.string().min(1),
  listPrice: zMoney.nullish(),
  unitPrice: zMoney,
  qty: zQty,
  installCost: zMoney.nullish(),
  unitCost: zMoney.nullish(),
  isOptional: z.boolean().optional(),
  manualPrice: z.boolean().optional(),
  sectionKey: z.string().nullish(),
  imageUrl: z.string().nullish(),
});

export const quoteSchema = z.object({
  partyId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  siteId: z.string().uuid().nullish(),
  opportunityId: z.string().uuid().nullish(),
  clientName: z.string().nullish(),
  clientPhone: z.string().nullish(),
  clientEmail: z.string().nullish(),
  projectName: z.string().nullish(),
  projectLocation: z.string().nullish(),
  quoteDate: zDate.optional(),
  validUntil: zDate.nullish(),
  discountType: z.enum(['percent', 'amount']).default('percent'),
  discountValue: zMoney.default('0'),
  vatOn: z.boolean().default(true),
  insDeleted: z.boolean().optional(),
  notes: z.string().nullish(),
  terms: z.string().nullish(),
  language: z.enum(['ar', 'en']).optional(),
  sections: z.array(z.object({ key: z.string(), title: z.string() })).optional(),
  lines: z.array(lineSchema).max(500),
  version: z.number().int().optional(),
}).refine((q) => q.discountType !== 'percent' || (Number(q.discountValue) >= 0 && Number(q.discountValue) <= 100), { message: 'discount % must be 0–100', path: ['discountValue'] });

const listQuery = zPage.extend({
  status: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  partyId: z.string().uuid().optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  latestOnly: z.coerce.boolean().default(true),
});

@Controller('quotes')
export class QuotesController {
  @Get()
  @Perm('quote.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q ? `%${q.q}%` : null;
      const where = and(
        scopeFilter(actor, 'quote.read', { owner: quote.ownerId, team: quote.teamId, branch: quote.branchId }),
        q.status ? inArray(quote.status, q.status.split(',')) : undefined,
        q.ownerId ? eq(quote.ownerId, q.ownerId) : undefined,
        q.partyId ? eq(quote.partyId, q.partyId) : undefined,
        q.from ? gte(quote.quoteDate, q.from) : undefined,
        q.to ? lte(quote.quoteDate, q.to) : undefined,
        q.latestOnly ? sql`${quote.status} <> 'superseded'` : undefined,
        term ? or(ilike(quote.number, term), ilike(quote.clientName, term), ilike(quote.projectName, term), ilike(quote.clientPhone, term), sql`exists (select 1 from party p where p.id = ${quote.partyId} and p.search_text ilike ${`%${normalizeArabic(q.q)}%`})`) : undefined,
      );
      const rows = await tx.select({
        id: quote.id, number: quote.number, revision: quote.revision, status: quote.status, quoteDate: quote.quoteDate, validUntil: quote.validUntil,
        clientName: quote.clientName, projectName: quote.projectName, total: quote.total, partyId: quote.partyId, partyName: party.nameAr,
        ownerId: quote.ownerId, ownerName: appUser.nameAr, sentAt: quote.sentAt, viewedAt: quote.viewedAt, ...(actor.grants['quote.cost.read'] ? { marginTotal: quote.marginTotal } : {}),
      }).from(quote).leftJoin(party, eq(party.id, quote.partyId)).leftJoin(appUser, eq(appUser.id, quote.ownerId)).where(where).orderBy(desc(quote.createdAt)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(quote).where(where)) as [{ n: number }];
      return { rows, total: n };
    });
  }

  @Get(':id')
  @Perm('quote.read')
  async get(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => getQuoteView(tx, actor, id));
  }

  @Post()
  @Perm('quote.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(quoteSchema)) body: QuoteInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      const id = await createQuote(tx, actor, body);
      return getQuoteView(tx, actor, id);
    }, actor.userId);
  }

  @Put(':id')
  @Perm('quote.write')
  async update(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(quoteSchema)) body: QuoteInput & { version?: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      await updateQuote(tx, actor, id, body, body.version);
      return getQuoteView(tx, actor, id);
    }, actor.userId);
  }

  @Post(':id/duplicate')
  @Perm('quote.write')
  async duplicate(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const src = await getQuoteView(tx, actor, id);
      const newId = await createQuote(tx, actor, {
        partyId: src.partyId, contactId: src.contactId, siteId: src.siteId, opportunityId: src.opportunityId, clientName: src.clientName, clientPhone: src.clientPhone, clientEmail: src.clientEmail,
        projectName: src.projectName, projectLocation: src.projectLocation, discountType: src.discountType as 'percent' | 'amount', discountValue: src.discountValue, vatOn: src.vatOn,
        insDeleted: src.insDeleted, notes: src.notes, terms: src.terms,
        lines: src.lines.filter((l) => !l.isAutoLabor).map((l) => ({ productId: l.productId, code: l.code, description: l.description, listPrice: l.listPrice, unitPrice: l.unitPrice, qty: l.qty, installCost: l.installCost, unitCost: l.unitCost, isOptional: l.isOptional, manualPrice: l.manualPrice, imageUrl: l.imageUrl })),
      });
      return getQuoteView(tx, actor, newId);
    }, actor.userId);
  }

  @Post(':id/revise')
  @Perm('quote.write')
  async revise(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => getQuoteView(tx, actor, await reviseQuote(tx, actor, id)), actor.userId);
  }

  @Post(':id/submit')
  @Perm('quote.write')
  async submit(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => ({ ...(await submitQuote(tx, actor, id)), quote: await getQuoteView(tx, actor, id) }), actor.userId);
  }

  @Post(':id/approve')
  @Perm('quote.approve')
  async approve(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ comment: z.string().nullish() }))) b: { comment?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => { await decideQuote(tx, actor, id, 'approve', b.comment); return getQuoteView(tx, actor, id); }, actor.userId);
  }

  @Post(':id/reject-approval')
  @Perm('quote.approve')
  async rejectApproval(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ comment: z.string().min(1) }))) b: { comment: string }) {
    return tenantTx(actor.tenantId, async (tx) => { await decideQuote(tx, actor, id, 'reject', b.comment); return getQuoteView(tx, actor, id); }, actor.userId);
  }

  @Post(':id/status')
  @Perm('quote.write')
  async status(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ status: z.enum(['accepted', 'rejected', 'lost', 'expired', 'sent']), reason: z.string().nullish() }))) b: { status: 'accepted' | 'rejected' | 'lost' | 'expired' | 'sent'; reason?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => { await setQuoteStatus(tx, actor, id, b.status, b.reason); return getQuoteView(tx, actor, id); }, actor.userId);
  }

  /** Send by WhatsApp / e-mail with the online view-and-accept link; archives the PDF as sent. */
  @Post(':id/send')
  @Perm('quote.send')
  async send(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ channel: z.enum(['whatsapp', 'email', 'link']), to: z.string().nullish(), contactId: z.string().uuid().nullish() }))) b: { channel: 'whatsapp' | 'email' | 'link'; to?: string | null; contactId?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const view = await getQuoteView(tx, actor, id);
      assertCan(actor, 'quote.send', { ownerId: view.ownerId, teamId: view.teamId });
      if (view.status === 'draft' && !view.needsApproval) await submitQuote(tx, actor, id);
      else if (view.status === 'draft' || view.status === 'pending_approval') throw badRequest('this quote needs approval before it can be sent');
      const { file } = await issueQuoteDocument(tx, actor, id);
      const { link } = await markQuoteSent(tx, actor, id);
      let to = b.to ?? null;
      let name = view.clientName ?? '';
      if (!to && b.contactId) {
        const [c] = await tx.select().from(contact).where(eq(contact.id, b.contactId));
        to = b.channel === 'email' ? c?.email ?? null : c?.whatsapp ?? c?.mobile ?? null;
        name = c?.name ?? name;
      }
      if (!to && b.channel !== 'link') to = b.channel === 'email' ? view.clientEmail : view.clientPhone;
      let message = null;
      if (b.channel !== 'link') {
        if (!to) throw badRequest('no recipient — add a mobile/e-mail');
        message = (await sendTemplate(tx, { channel: b.channel, to, templateKey: 'quote_sent', vars: { name, number: view.number, link }, subject: `عرض سعر ${view.number}`, related: { type: 'quote', id }, link: { partyId: view.partyId, contactId: b.contactId ?? view.contactId }, sentBy: actor.userId })).message;
      }
      await logActivity(tx, 'quote', id, b.channel === 'link' ? 'note' : b.channel, `أُرسل العرض ${view.number}${to ? ` إلى ${to}` : ''}`, actor.userId);
      if (view.partyId) await logActivity(tx, 'party', view.partyId, b.channel === 'link' ? 'note' : b.channel, `أُرسل العرض ${view.number}`, actor.userId);
      return { link, fileId: file.id, message, quote: await getQuoteView(tx, actor, id) };
    }, actor.userId);
  }

  @Get(':id/pdf')
  @Perm('quote.read')
  async pdf(@Actor() actor: RequestActor, @Param('id') id: string, @Res() res: Response) {
    const { quote: q, pdf } = await tenantTx(actor.tenantId, (tx) => renderQuotePdf(tx, actor, id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${q.number}${q.revision ? `-R${q.revision}` : ''}.pdf"`);
    res.send(pdf);
  }

  /** Excel export (legacy "تصدير Excel"): items, totals, VAT; cost columns only with permission. */
  @Get(':id/excel')
  @Perm('quote.read')
  async excel(@Actor() actor: RequestActor, @Param('id') id: string, @Res() res: Response) {
    const q = await tenantTx(actor.tenantId, (tx) => getQuoteView(tx, actor, id));
    const wb = new ExcelJS.Workbook();
    wb.creator = 'المدى المبارك للتجارة والحلول الذكية';
    const ws = wb.addWorksheet(q.number, { views: [{ rightToLeft: true }] });
    const withCost = !!actor.grants['quote.cost.read'];
    ws.columns = [
      { header: '#', key: 'n', width: 5 }, { header: 'الموديل', key: 'code', width: 18 }, { header: 'الوصف', key: 'desc', width: 60 },
      { header: 'الكمية', key: 'qty', width: 9 }, { header: 'سعر الوحدة', key: 'price', width: 14 }, { header: 'الإجمالي', key: 'total', width: 14 },
      ...(withCost ? [{ header: 'تكلفة الوحدة', key: 'cost', width: 14 }] : []),
    ];
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D4A2E' } };
    q.lines.forEach((l, i) => ws.addRow({ n: i + 1, code: l.code, desc: l.description, qty: Number(l.qty), price: Number(l.unitPrice), total: Number(l.lineTotal), ...(withCost ? { cost: l.unitCost ? Number(l.unitCost) : null } : {}) }));
    const t = q.computed.totals;
    ws.addRow({});
    const add = (label: string, h: number) => { const r = ws.addRow({ desc: label, total: h / 100 }); r.font = { bold: true }; };
    add('المجموع', t.subtotal);
    if (t.discount) add('الخصم', -t.discount);
    if (t.vatApplied) add(`ضريبة القيمة المضافة ${t.vatRate}%`, t.vat);
    add(`الإجمالي — ${formatSar(t.total)} ريال`, t.total);
    ['price', 'total', 'cost'].forEach((k) => { const c = ws.getColumn(k); if (c) c.numFmt = '#,##0.00'; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${q.number}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }
}
