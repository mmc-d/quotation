import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  and, contact, contract, conversation, desc, eq, esignRequest, gte, inboxEvent, issuedDocument, lead, message, notification, quote, quoteAcceptance, sql, withTenant, type Tx,
} from '@mmc/db';
import { INTERESTS, OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES, normalizeSaudiMobile, normalizeArabic } from '@mmc/domain';
import { htmlToPdf, renderQuoteHtml } from '@mmc/doc-templates';
import { Public } from '../auth/actor.js';
import { getDb } from '../common/db.js';
import { audit } from '../common/audit.js';
import { companyBlock } from '../common/company.js';
import { badRequest, forbidden, notFound } from '../common/errors.js';
import { sendTemplate, verifyMetaSignature } from '../common/messaging.js';
import { ZodPipe } from '../common/zod.js';
import { config } from '../config.js';
import { createLead } from './crm.controller.js';
import { loadQuote, logActivity, quoteDocFrom } from './quotes.service.js';
import { calculateQuote } from '@mmc/domain';

async function tenantForToken(kind: 'quote' | 'payment_request', token: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound('link');
  const rows = await getDb().execute<{ t: string | null }>(sql`select tenant_for_public_token(${kind}, ${token}) as t`);
  const t = rows[0]?.t;
  if (!t) throw notFound('link');
  return t;
}

async function defaultTenant(): Promise<string> {
  const rows = await getDb().execute<{ t: string }>(sql`select default_tenant() as t`);
  if (!rows[0]?.t) throw new Error('no tenant');
  return rows[0].t;
}

function otpHash(otp: string, quoteId: string) {
  return createHash('sha256').update(`${otp}:${quoteId}:${config.authSecret}`).digest('hex');
}

function clientIp(req: Request) {
  return (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null;
}

/** Public view of a quote — never includes cost, margin or internal notes. */
async function publicQuote(tx: Tx, token: string) {
  const [q] = await tx.select().from(quote).where(eq(quote.publicToken, token));
  if (!q) throw notFound('quote');
  const full = await loadQuote(tx, q.id);
  const co = await companyBlock(tx);
  const calc = calculateQuote({ lines: full.lines.map((l) => ({ code: l.code, description: l.description, listPrice: l.listPrice, unitPrice: l.unitPrice, qty: l.qty, isOptional: l.isOptional })), discount: { type: q.discountType as 'percent' | 'amount', value: q.discountValue }, vatRegistered: co.vatRegistered, vatOn: q.vatOn });
  return { q, full, co, calc };
}

const leadHits = new Map<string, number[]>();

@Controller('public')
@Public()
export class PublicController {
  @Get('quotes/:token')
  async viewQuote(@Param('token') token: string) {
    const tenantId = await tenantForToken('quote', token);
    return withTenant(getDb(), tenantId, async (tx) => {
      const { q, full, co, calc } = await publicQuote(tx, token);
      if (q.status === 'sent') {
        await tx.update(quote).set({ status: 'viewed', viewedAt: new Date() }).where(eq(quote.id, q.id));
        if (q.ownerId) await tx.insert(notification).values({ userId: q.ownerId, kind: 'quote', titleAr: `فتح العميل العرض ${q.number}`, titleEn: `Client opened quote ${q.number}`, link: `/quotes/${q.id}` });
        await logActivity(tx, 'quote', q.id, 'note', `فتح العميل العرض عبر الرابط`, q.ownerId);
      }
      const [superseding] = await tx.select({ id: quote.id }).from(quote).where(and(eq(quote.rootQuoteId, q.rootQuoteId ?? q.id), sql`${quote.revision} > ${q.revision}`)).limit(1);
      const expired = !!q.validUntil && q.validUntil < new Date().toISOString().slice(0, 10);
      return {
        company: { legalNameAr: co.legalNameAr, legalNameEn: co.legalNameEn, vatRegistered: co.vatRegistered, phone: co.phone },
        number: q.number, revision: q.revision, date: q.quoteDate, validUntil: q.validUntil, status: q.status === 'sent' ? 'viewed' : q.status,
        clientName: q.clientName, projectName: q.projectName,
        lines: full.lines.map((l, i) => ({ code: l.code, description: l.description, qty: l.qty, unitPrice: l.unitPrice, amount: calc.lines[i]!.amount, listAmount: calc.lines[i]!.listAmount, isFree: calc.lines[i]!.isFree, struck: calc.lines[i]!.struck, isOptional: l.isOptional, imageUrl: l.imageUrl })),
        totals: { subtotal: calc.totals.subtotal, discount: calc.totals.discount, taxable: calc.totals.taxable, vat: calc.totals.vat, total: calc.totals.total, vatApplied: calc.totals.vatApplied, vatRate: calc.totals.vatRate, optionalTotal: calc.totals.optionalTotal },
        notes: q.notes, terms: q.terms,
        canAccept: ['sent', 'viewed'].includes(q.status) && !expired && !superseding,
        expired, superseded: !!superseding || q.status === 'superseded',
        mobileHint: q.clientPhone ? `•••• ${q.clientPhone.slice(-4)}` : null,
      };
    });
  }

  @Get('quotes/:token/pdf')
  async quotePdf(@Param('token') token: string, @Res() res: Response) {
    const tenantId = await tenantForToken('quote', token);
    const { pdf, number } = await withTenant(getDb(), tenantId, async (tx) => {
      const { q, full, co, calc } = await publicQuote(tx, token);
      const view = { ...full, computed: { lines: calc.lines, totals: calc.totals } } as unknown as Parameters<typeof quoteDocFrom>[0];
      return { pdf: await htmlToPdf(renderQuoteHtml({ company: co, ...quoteDocFrom(view) }), config.gotenbergUrl), number: q.number };
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${number}.pdf"`);
    res.send(pdf);
  }

  /** OTP to the mobile on file (never to an arbitrary number). Max 3 per 10 minutes. */
  @Post('quotes/:token/otp')
  @HttpCode(200)
  async sendOtp(@Param('token') token: string) {
    const tenantId = await tenantForToken('quote', token);
    return withTenant(getDb(), tenantId, async (tx) => {
      const [q] = await tx.select().from(quote).where(eq(quote.publicToken, token));
      if (!q || !['sent', 'viewed'].includes(q.status)) throw badRequest('this quote can no longer be accepted online');
      let mobile = q.clientPhone ? normalizeSaudiMobile(q.clientPhone) : null;
      if (!mobile && q.contactId) {
        const [c] = await tx.select().from(contact).where(eq(contact.id, q.contactId));
        mobile = normalizeSaudiMobile(c?.whatsapp ?? c?.mobile ?? null);
      }
      if (!mobile) throw badRequest('no mobile number on file — contact your sales representative');
      const recent = await tx.select({ n: sql<number>`count(*)::int` }).from(quoteAcceptance).where(and(eq(quoteAcceptance.quoteId, q.id), gte(quoteAcceptance.createdAt, new Date(Date.now() - 10 * 60_000))));
      if ((recent[0]?.n ?? 0) >= 3) throw forbidden('too many codes requested — try again in 10 minutes');
      const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await tx.insert(quoteAcceptance).values({ quoteId: q.id, mobile, otpHash: otpHash(otp, q.id), expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) });
      await sendTemplate(tx, { channel: 'whatsapp', to: mobile, templateKey: 'quote_otp', vars: { code: otp }, related: { type: 'quote', id: q.id }, link: { partyId: q.partyId, contactId: q.contactId } });
      if (config.env !== 'production' && !config.whatsapp.accessToken) console.log(`[otp:sandbox] quote ${q.number} → ${mobile}: ${otp}`);
      return { sentTo: `•••• ${mobile.slice(-4)}`, expiresInMinutes: OTP_TTL_MINUTES };
    });
  }

  @Post('quotes/:token/decision')
  @HttpCode(200)
  async decide(@Param('token') token: string, @Req() req: Request, @Body(new ZodPipe(z.object({ otp: z.string().regex(/^\d{6}$/), signerName: z.string().min(2).max(120), decision: z.enum(['accept', 'reject']), reason: z.string().max(500).nullish() }))) b: { otp: string; signerName: string; decision: 'accept' | 'reject'; reason?: string | null }) {
    const tenantId = await tenantForToken('quote', token);
    return withTenant(getDb(), tenantId, async (tx) => {
      const [q] = await tx.select().from(quote).where(eq(quote.publicToken, token));
      if (!q || !['sent', 'viewed'].includes(q.status)) throw badRequest('this quote can no longer be accepted online');
      const [acc] = await tx.select().from(quoteAcceptance).where(and(eq(quoteAcceptance.quoteId, q.id), sql`${quoteAcceptance.verifiedAt} is null`)).orderBy(desc(quoteAcceptance.createdAt)).limit(1);
      if (!acc || acc.expiresAt < new Date()) throw badRequest('the code expired — request a new one');
      if (acc.attempts >= OTP_MAX_ATTEMPTS) throw forbidden('too many wrong attempts — request a new code');
      const a = Buffer.from(otpHash(b.otp, q.id));
      const e = Buffer.from(acc.otpHash);
      if (a.length !== e.length || !timingSafeEqual(a, e)) {
        await tx.update(quoteAcceptance).set({ attempts: acc.attempts + 1 }).where(eq(quoteAcceptance.id, acc.id));
        throw badRequest('wrong code');
      }
      const [doc] = await tx.select().from(issuedDocument).where(and(eq(issuedDocument.documentType, 'quote'), eq(issuedDocument.entityId, q.id))).orderBy(desc(issuedDocument.issuedAt)).limit(1);
      await tx.update(quoteAcceptance).set({ verifiedAt: new Date(), decision: b.decision, signerName: b.signerName, ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null, documentSha256: doc?.sha256 ?? null }).where(eq(quoteAcceptance.id, acc.id));
      const status = b.decision === 'accept' ? 'accepted' : 'rejected';
      await tx.update(quote).set({ status, acceptedAt: status === 'accepted' ? new Date() : null, rejectedAt: status === 'rejected' ? new Date() : null, lostReason: b.reason ?? null, updatedAt: new Date() }).where(eq(quote.id, q.id));
      await audit(tx, null, `online_${status}`, 'quote', q.id, null, { signerName: b.signerName, mobile: acc.mobile, ip: clientIp(req), documentSha256: doc?.sha256 ?? null });
      await logActivity(tx, 'quote', q.id, 'note', `${status === 'accepted' ? 'قبِل' : 'رفض'} العميل العرض إلكترونيًا (${b.signerName}، تحقق برمز OTP)`, q.ownerId, b.reason);
      if (q.ownerId) await tx.insert(notification).values({ userId: q.ownerId, kind: 'quote', titleAr: status === 'accepted' ? `🎉 قبِل العميل العرض ${q.number}` : `رفض العميل العرض ${q.number}`, link: `/quotes/${q.id}` });
      return { status };
    });
  }

  /** Website lead form (honeypot + per-IP rate limit). */
  @Post('leads')
  @HttpCode(201)
  async webLead(@Req() req: Request, @Body(new ZodPipe(z.object({ name: z.string().min(2).max(120), mobile: z.string().min(7).max(20), email: z.string().email().nullish().or(z.literal('')), city: z.string().max(60).nullish(), interest: z.enum(INTERESTS).nullish(), message: z.string().max(2000).nullish(), website: z.string().max(0).optional(), consent: z.boolean().default(false), utm: z.record(z.string(), z.string()).nullish() }))) b: { name: string; mobile: string; email?: string | null; city?: string | null; interest?: (typeof INTERESTS)[number] | null; message?: string | null; consent: boolean; utm?: Record<string, string> | null }) {
    const ip = clientIp(req) ?? 'unknown';
    const now = Date.now();
    const hits = (leadHits.get(ip) ?? []).filter((t) => now - t < 3600_000);
    if (hits.length >= 5) throw forbidden('too many submissions');
    leadHits.set(ip, [...hits, now]);
    const mobile = normalizeSaudiMobile(b.mobile);
    if (!mobile) throw badRequest('please enter a Saudi mobile number (05XXXXXXXX)');
    const tenantId = await defaultTenant();
    return withTenant(getDb(), tenantId, async (tx) => {
      const [dupe] = await tx.select({ id: lead.id }).from(lead).where(and(eq(lead.mobile, mobile), sql`${lead.status} in ('new','contacted','qualified')`));
      if (dupe) {
        await tx.update(lead).set({ message: sql`coalesce(${lead.message}, '') || ${`\n— ${new Date().toISOString().slice(0, 10)}: ${b.message ?? ''}`}`, updatedAt: new Date() }).where(eq(lead.id, dupe.id));
        return { ok: true };
      }
      const l = await createLead(tx, { source: 'website', name: b.name, mobile, email: b.email || null, city: b.city ?? null, interest: b.interest ?? null, message: b.message ?? null, utm: b.utm ?? null } as Parameters<typeof createLead>[1], null);
      void normalizeArabic;
      return { ok: true, reference: l.number };
    });
  }

  /** Sandbox Nafath signing page data. */
  @Get('esign/:id')
  async esignView(@Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('request');
    const tenantId = await defaultTenant();
    return withTenant(getDb(), tenantId, async (tx) => {
      const [r] = await tx.select().from(esignRequest).where(eq(esignRequest.id, id));
      if (!r || r.provider !== 'sandbox') throw notFound('request');
      const [c] = await tx.select({ number: contract.number, title: contract.title, total: contract.total }).from(contract).where(eq(contract.id, r.contractId));
      return { status: r.status, signerName: r.signerName, contract: c, documentSha256: r.documentSha256, nationalIdHint: r.signerNationalId ? `••••••${r.signerNationalId.slice(-4)}` : null };
    });
  }

  /** Sandbox: simulates the Nafath approval callback a licensed provider would send. */
  @Post('esign/:id/complete')
  @HttpCode(200)
  async esignComplete(@Param('id') id: string, @Req() req: Request, @Body(new ZodPipe(z.object({ nationalIdLast4: z.string().regex(/^\d{4}$/), approve: z.boolean() }))) b: { nationalIdLast4: string; approve: boolean }) {
    if (config.env === 'production') throw forbidden('sandbox signing is disabled in production');
    const tenantId = await defaultTenant();
    return withTenant(getDb(), tenantId, async (tx) => {
      const [r] = await tx.select().from(esignRequest).where(eq(esignRequest.id, id));
      if (!r || r.provider !== 'sandbox') throw notFound('request');
      if (r.status === 'signed') return { status: 'signed' };
      if (r.signerNationalId && !r.signerNationalId.endsWith(b.nationalIdLast4)) throw badRequest('identity check failed');
      const status = b.approve ? 'signed' : 'declined';
      await tx.update(esignRequest).set({ status, completedAt: new Date(), updatedAt: new Date() }).where(eq(esignRequest.id, id));
      const [c] = await tx.select().from(contract).where(eq(contract.id, r.contractId));
      if (c && b.approve && c.status === 'sent_for_signature') await tx.update(contract).set({ status: 'signed', signedAt: new Date(), updatedAt: new Date() }).where(eq(contract.id, c.id));
      if (c && !b.approve && c.status === 'sent_for_signature') await tx.update(contract).set({ status: 'draft', updatedAt: new Date() }).where(eq(contract.id, c.id));
      await audit(tx, null, `esign_${status}`, 'contract', r.contractId, null, { requestId: id, signer: r.signerName, ip: clientIp(req), documentSha256: r.documentSha256 });
      if (c) {
        await logActivity(tx, 'contract', c.id, 'note', b.approve ? `وُقّع العقد ${c.number} إلكترونيًا عبر نفاذ (${r.signerName})` : `رفض ${r.signerName} توقيع العقد ${c.number}`, c.ownerId);
        if (c.ownerId) await tx.insert(notification).values({ userId: c.ownerId, kind: 'contract', titleAr: b.approve ? `✍️ وُقّع العقد ${c.number}` : `رُفض توقيع العقد ${c.number}`, link: `/contracts/${c.id}` });
      }
      return { status };
    });
  }
}

/** WhatsApp Cloud API webhook: verification + inbound messages + delivery statuses. */
@Controller('webhooks/whatsapp')
@Public()
export class WhatsAppWebhookController {
  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) return res.status(200).send(challenge);
    return res.status(403).send('forbidden');
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') sig: string | undefined, @Body() body: WaWebhook) {
    if (!verifyMetaSignature(req.rawBody ?? Buffer.from(JSON.stringify(body)), sig)) throw forbidden('bad signature');
    const tenantId = await defaultTenant();
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        const names = new Map((v.contacts ?? []).map((c) => [c.wa_id ?? c.user_id ?? '', c.profile?.name ?? '']));
        for (const m of v.messages ?? []) {
          await withTenant(getDb(), tenantId, async (tx) => {
            const [seen] = await tx.insert(inboxEvent).values({ tenantId, source: 'whatsapp', externalId: m.id, payload: m as never }).onConflictDoNothing().returning();
            if (!seen) return;
            // Contacts may arrive with a business-scoped user ID instead of a phone number (BSUID).
            const address = m.from ? `+${m.from.replace(/^\+/, '')}` : (m.user_id ?? 'unknown');
            const bodyText = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? (m.type ? `[${m.type}]` : '');
            let [conv] = await tx.select().from(conversation).where(and(eq(conversation.channel, 'whatsapp'), eq(conversation.externalAddress, address)));
            if (!conv) {
              const [ct] = await tx.select().from(contact).where(sql`${contact.whatsapp} = ${address} or ${contact.mobile} = ${address} or ${contact.waBsuid} = ${address}`).limit(1);
              const [ld] = ct ? [] : await tx.select().from(lead).where(eq(lead.mobile, address)).limit(1);
              let leadId = ld?.id ?? null;
              if (!ct && !ld) leadId = (await createLead(tx, { source: 'whatsapp', name: names.get(m.from ?? m.user_id ?? '') || address, mobile: m.from ? address : null, waBsuid: m.from ? null : address, message: bodyText } as Parameters<typeof createLead>[1], null)).id;
              [conv] = await tx.insert(conversation).values({ channel: 'whatsapp', externalAddress: address, contactId: ct?.id ?? null, partyId: ct?.partyId ?? null, leadId }).returning();
            }
            await tx.insert(message).values({ conversationId: conv!.id, direction: 'in', channel: 'whatsapp', from: address, body: bodyText, status: 'received', providerMessageId: m.id });
            await tx.update(conversation).set({ lastMessageAt: new Date(), lastInboundAt: new Date(), unreadCount: sql`${conversation.unreadCount} + 1`, status: 'open', updatedAt: new Date() }).where(eq(conversation.id, conv!.id));
            if (conv!.assigneeId) await tx.insert(notification).values({ userId: conv!.assigneeId, kind: 'inbox', titleAr: `رسالة واتساب جديدة من ${names.get(m.from ?? '') || address}`, link: `/crm/inbox/${conv!.id}` });
            await tx.update(inboxEvent).set({ processedAt: new Date() }).where(and(eq(inboxEvent.source, 'whatsapp'), eq(inboxEvent.externalId, m.id)));
          });
        }
        for (const s of v.statuses ?? []) {
          await withTenant(getDb(), tenantId, (tx) => tx.update(message).set({ status: s.status === 'failed' ? 'failed' : s.status, error: s.errors?.[0]?.title ?? null, updatedAt: new Date() }).where(and(eq(message.channel, 'whatsapp'), eq(message.providerMessageId, s.id))));
        }
      }
    }
    return { ok: true };
  }
}

interface WaWebhook {
  entry?: { changes?: { value?: {
    contacts?: { wa_id?: string; user_id?: string; profile?: { name?: string } }[];
    messages?: { id: string; from?: string; user_id?: string; type?: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string } } }[];
    statuses?: { id: string; status: string; errors?: { title: string }[] }[];
  } }[] }[];
}
