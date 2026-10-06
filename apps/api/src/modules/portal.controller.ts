import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { and, contact, desc, eq, party, portalAccount, portalSession, sql } from '@mmc/db';
import { normalizeSaudiMobile } from '@mmc/domain';
import { Actor, Perm, Public, type RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { tenantTx } from '../common/db.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { readStoredFile } from '../common/files.js';
import { sendTemplate } from '../common/messaging.js';
import { ZodPipe, zUuid } from '../common/zod.js';
import { config } from '../config.js';
import {
  agreements, clientIp, createTicket, decide, device, devices, invoices, logout, me, paymentRequests, PORTAL_COOKIE, portalFile, projectDetail, projects, rateLimit, requestLoginCode, SESSION_DAYS,
  ticketDetail, tickets, verifyLoginCode, withPortal, type PortalTicketInput,
} from './portal.service.js';
import { ensureServiceTemplates } from './service.service.js';

/**
 * Customer portal under /api/portal (module 11 §3.2).
 * - Staff (normal session, portal.manage): portal accounts — list, create, disable/enable, invite.
 * - Customers (@Public routes, authenticated only by the `mmc_portal` cookie — never a staff session):
 *   WhatsApp-code login, me, devices, projects + approvals, tickets, invoices, payment requests, AMC.
 */

const zText = (max = 2000) => z.string().trim().max(max);
const accountSchema = z.object({ partyId: zUuid, contactId: zUuid.nullish(), phone: zText(30).min(7), name: zText(120).nullish() });
const ticketSchema = z.object({
  siteId: zUuid.nullish(), assetId: zUuid.nullish(), subject: zText(300).min(3), description: zText(5000).nullish(),
  photos: z.array(z.object({ name: zText(120).min(1), contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']), data: z.string().min(1).max(2_100_000) })).max(3).optional(),
});

function setSessionCookie(res: Response, token: string) {
  res.cookie(PORTAL_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', path: '/', maxAge: SESSION_DAYS * 86_400_000 });
}

@Controller('portal')
export class PortalController {
  // ───────────────────────── staff: portal accounts ─────────────────────────

  @Get('accounts')
  @Perm('portal.manage')
  async accounts(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ partyId: zUuid.optional() }))) q: { partyId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({ a: portalAccount, partyName: party.nameAr }).from(portalAccount).innerJoin(party, eq(party.id, portalAccount.partyId))
        .where(q.partyId ? eq(portalAccount.partyId, q.partyId) : undefined).orderBy(desc(portalAccount.createdAt)).limit(500);
      return { rows: rows.map(({ a, partyName }) => ({ id: a.id, partyId: a.partyId, partyName, contactId: a.contactId, phone: a.phone, name: a.name, status: a.status, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt })) };
    });
  }

  @Post('accounts')
  @Perm('portal.manage')
  async createAccount(@Actor() actor: RequestActor, @Body(new ZodPipe(accountSchema)) b: z.infer<typeof accountSchema>) {
    const phone = normalizeSaudiMobile(b.phone);
    if (!phone) throw badRequest('enter a Saudi mobile number (05XXXXXXXX)');
    return tenantTx(actor.tenantId, async (tx) => {
      const [p] = await tx.select({ id: party.id, nameAr: party.nameAr }).from(party).where(eq(party.id, b.partyId));
      if (!p) throw notFound('customer');
      let name = b.name ?? null;
      if (b.contactId) {
        const [c] = await tx.select({ partyId: contact.partyId, name: contact.name }).from(contact).where(eq(contact.id, b.contactId));
        if (!c || c.partyId !== b.partyId) throw badRequest('the contact belongs to another customer');
        name ??= c.name;
      }
      const [dupe] = await tx.select({ id: portalAccount.id }).from(portalAccount).where(and(eq(portalAccount.phone, phone), eq(portalAccount.partyId, b.partyId)));
      if (dupe) throw conflict('this mobile already has a portal account for this customer');
      const [row] = await tx.insert(portalAccount).values({ partyId: b.partyId, contactId: b.contactId ?? null, phone, name, status: 'active', createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'portal_account', row!.id, null, { partyId: b.partyId, phone });
      return { ...row!, partyName: p.nameAr };
    }, actor.userId);
  }

  @Post('accounts/:id/disable')
  @Perm('portal.manage')
  @HttpCode(200)
  async disable(@Actor() actor: RequestActor, @Param('id') id: string) {
    return this.setStatus(actor, id, 'disabled');
  }

  @Post('accounts/:id/enable')
  @Perm('portal.manage')
  @HttpCode(200)
  async enable(@Actor() actor: RequestActor, @Param('id') id: string) {
    return this.setStatus(actor, id, 'active');
  }

  private setStatus(actor: RequestActor, id: string, status: 'active' | 'disabled') {
    return tenantTx(actor.tenantId, async (tx) => {
      const a = await this.loadAccount(tx, id);
      await tx.update(portalAccount).set({ status, updatedAt: new Date(), updatedBy: actor.userId, version: a.version + 1 }).where(eq(portalAccount.id, id));
      // disabling signs the customer out everywhere
      if (status === 'disabled') await tx.update(portalSession).set({ revokedAt: new Date() }).where(and(eq(portalSession.accountId, id), sql`${portalSession.revokedAt} is null`));
      await audit(tx, actor, `status_${status}`, 'portal_account', id, { status: a.status }, { status });
      return { id, status };
    }, actor.userId);
  }

  private async loadAccount(tx: Parameters<Parameters<typeof tenantTx>[1]>[0], id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('portal account');
    const [a] = await tx.select().from(portalAccount).where(eq(portalAccount.id, id));
    if (!a) throw notFound('portal account');
    return a;
  }

  /** WhatsApp the portal link (sandbox without credentials). */
  @Post('accounts/:id/invite')
  @Perm('portal.manage')
  @HttpCode(200)
  async invite(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const a = await this.loadAccount(tx, id);
      if (a.status !== 'active') throw badRequest('the portal account is disabled');
      await ensureServiceTemplates(tx);
      const link = `${config.publicBaseUrl}/portal`;
      const r = await sendTemplate(tx, { channel: 'whatsapp', to: a.phone, templateKey: 'portal_invite', vars: { name: a.name ?? '', link }, related: { type: 'portal_account', id }, link: { partyId: a.partyId, contactId: a.contactId }, sentBy: actor.userId });
      await audit(tx, actor, 'invite', 'portal_account', id, null, { to: a.phone, status: r.result.status });
      return { to: a.phone, link, status: r.result.status };
    }, actor.userId);
  }

  // ───────────────────────── customer: login ─────────────────────────

  /** Always 200 {sent:true}; a code goes out only when an active account has this mobile. */
  @Public()
  @Post('login/request')
  @HttpCode(200)
  async loginRequest(@Req() req: Request, @Body(new ZodPipe(z.object({ phone: zText(30) }))) b: { phone: string }) {
    rateLimit(`req:${clientIp(req) ?? 'unknown'}`, 10, 10 * 60_000);
    return requestLoginCode(b.phone);
  }

  /** Code → session cookie. A mobile on several customers returns the list; send it again with accountId. */
  @Public()
  @Post('login/verify')
  @HttpCode(200)
  async loginVerify(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(new ZodPipe(z.object({ phone: zText(30), code: z.string().regex(/^\d{6}$/), accountId: zUuid.nullish() }))) b: { phone: string; code: string; accountId?: string | null }) {
    rateLimit(`verify:${clientIp(req) ?? 'unknown'}`, 30, 10 * 60_000);
    const r = await verifyLoginCode(b.phone, b.code, b.accountId, { ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null });
    if (!r.ok) return { needsSelection: true, accounts: r.accounts };
    setSessionCookie(res, r.token);
    return { account: r.account, party: r.party, expiresAt: r.expiresAt };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await logout(req);
    res.clearCookie(PORTAL_COOKIE, { path: '/' });
    return { ok: true };
  }

  // ───────────────────────── customer: data ─────────────────────────

  @Public()
  @Get('me')
  async me(@Req() req: Request) {
    return withPortal(req, (tx, c) => me(tx, c));
  }

  @Public()
  @Get('devices')
  async devices(@Req() req: Request, @Query(new ZodPipe(z.object({ siteId: zUuid.optional() }))) q: { siteId?: string }) {
    return withPortal(req, (tx, c) => devices(tx, c, q.siteId));
  }

  @Public()
  @Get('devices/:id')
  async device(@Req() req: Request, @Param('id') id: string) {
    return withPortal(req, (tx, c) => device(tx, c, id));
  }

  @Public()
  @Get('projects')
  async projects(@Req() req: Request) {
    return withPortal(req, (tx, c) => projects(tx, c));
  }

  @Public()
  @Get('projects/:id')
  async project(@Req() req: Request, @Param('id') id: string) {
    return withPortal(req, (tx, c) => projectDetail(tx, c, id));
  }

  @Public()
  @Post('projects/:id/approvals/:aid/approve')
  @HttpCode(200)
  async approve(@Req() req: Request, @Param('id') id: string, @Param('aid') aid: string, @Body(new ZodPipe(z.object({ approvedByName: zText(200).min(2) }))) b: { approvedByName: string }) {
    return withPortal(req, (tx, c) => decide(tx, c, id, aid, 'approved', b));
  }

  @Public()
  @Post('projects/:id/approvals/:aid/reject')
  @HttpCode(200)
  async reject(@Req() req: Request, @Param('id') id: string, @Param('aid') aid: string, @Body(new ZodPipe(z.object({ reason: zText(1000).min(2) }))) b: { reason: string }) {
    return withPortal(req, (tx, c) => decide(tx, c, id, aid, 'rejected', b));
  }

  @Public()
  @Get('tickets')
  async tickets(@Req() req: Request, @Query(new ZodPipe(z.object({ status: z.string().max(100).optional() }))) q: { status?: string }) {
    return withPortal(req, (tx, c) => tickets(tx, c, q.status));
  }

  @Public()
  @Post('tickets')
  async createTicket(@Req() req: Request, @Body(new ZodPipe(ticketSchema)) b: PortalTicketInput) {
    return withPortal(req, (tx, c) => createTicket(tx, c, b));
  }

  @Public()
  @Get('tickets/:id')
  async ticket(@Req() req: Request, @Param('id') id: string) {
    return withPortal(req, (tx, c) => ticketDetail(tx, c, id));
  }

  @Public()
  @Get('invoices')
  async invoices(@Req() req: Request) {
    return withPortal(req, (tx, c) => invoices(tx, c));
  }

  @Public()
  @Get('payment-requests')
  async paymentRequests(@Req() req: Request) {
    return withPortal(req, (tx, c) => paymentRequests(tx, c));
  }

  @Public()
  @Get('agreements')
  async agreements(@Req() req: Request) {
    return withPortal(req, (tx, c) => agreements(tx, c));
  }

  /** Files the customer may open (approval packages, their ticket photos, invoice PDFs). */
  @Public()
  @Get('files/:id')
  async file(@Req() req: Request, @Param('id') id: string, @Res() res: Response) {
    const f = await withPortal(req, async (tx, c) => ((await portalFile(tx, c, id)) ? readStoredFile(tx, id) : null));
    if (!f) throw notFound('file');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(f.data);
  }
}
