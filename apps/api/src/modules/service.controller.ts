import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  agreementVisit, and, asc, desc, eq, ilike, inArray, installedAsset, invoiceMirror, lte, nextNumber, or, party, paymentRequest, serviceAgreement, site, sql, ticket, workOrder, type Tx,
} from '@mmc/db';
import { AGREEMENT_TIERS, BILLING_FREQUENCIES, isCsatScore, riyadhDate, TIER_DEFAULTS, toHalalas, halalasToFixed, type AgreementTier } from '@mmc/domain';
import { Actor, Perm, Public, type RequestActor } from '../auth/actor.js';
import { audit, diff } from '../common/audit.js';
import { companyBlock } from '../common/company.js';
import { tenantTx } from '../common/db.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { ZodPipe, zDate, zMoney, zPage, zUuid } from '../common/zod.js';
import { config } from '../config.js';
import { addDays } from './calendar.controller.js';
import { loadWo, locationPaths, ticketFilter, userNames, woFilter } from './field-service.service.js';
import {
  activateAgreement, agreementFilter, agreementRenewalsFor, agreementsReport, agreementSites, annualValue, billingWithVat, cancelAgreement, csatReport, csatToken, csatUrl, dispatcherIds, loadAgreement, notifyUsers,
  parseCsatToken, preventiveVisitsFor, renewAgreement, sendCsatRequest, siteNames, slaEscalationsFor, slaReport, ticketSla, tierInfo, vatApplies, type AgreementRow,
} from './service.service.js';

/**
 * Service agreements (AMC), SLA & CSAT reports and the one-tap CSAT survey under /api/service
 * (module 06 §2.4–2.5, Phase 7b). Record scope for agreements: owner / team / branch.
 */

const zText = (max = 2000) => z.string().trim().max(max);
const BILLING = Object.keys(BILLING_FREQUENCIES) as [keyof typeof BILLING_FREQUENCIES, ...(keyof typeof BILLING_FREQUENCIES)[]];

const agreementFields = {
  partyId: zUuid,
  siteIds: z.array(zUuid).max(200).default([]),
  assetIds: z.array(zUuid).max(5000).default([]),
  tier: z.enum(AGREEMENT_TIERS).default('standard'),
  startDate: zDate,
  endDate: zDate,
  /** overrides of the tier defaults */
  visitsPerYear: z.number().int().min(0).max(52).optional(),
  responseHours: z.number().int().min(1).max(720).optional(),
  resolutionHours: z.number().int().min(1).max(2160).optional(),
  coverage: z.enum(['business', '24x7']).optional(),
  partsIncluded: z.boolean().default(false),
  price: zMoney,
  billingFrequency: z.enum(BILLING).default('annual'),
  vatOn: z.boolean().default(true),
  autoRenew: z.boolean().default(false),
  upliftPercent: z.number().int().min(0).max(100).default(0),
  notes: zText(5000).nullish(),
  ownerId: zUuid.nullish(),
};
const agreementSchema = z.object(agreementFields);
type AgreementInput = z.infer<typeof agreementSchema>;
const activeUpdateSchema = z.object({ notes: zText(5000).nullish(), autoRenew: z.boolean().optional(), upliftPercent: z.number().int().min(0).max(100).optional(), ownerId: zUuid.nullish(), version: z.number().int().optional() });

const listQuery = zPage.extend({ status: z.string().optional(), partyId: zUuid.optional(), expiring: z.coerce.number().int().min(0).max(366).optional() });

@Controller('service')
export class ServiceController {
  // ───────────────────────── agreements ─────────────────────────

  @Get('agreements')
  @Perm('agreement.read')
  async agreements(@Actor() actor: RequestActor, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q?.trim();
      const today = riyadhDate();
      const where = and(
        agreementFilter(actor, 'agreement.read'),
        q.status ? inArray(serviceAgreement.status, q.status.split(',')) : undefined,
        q.partyId ? eq(serviceAgreement.partyId, q.partyId) : undefined,
        q.expiring !== undefined ? and(eq(serviceAgreement.status, 'active'), lte(serviceAgreement.endDate, addDays(today, q.expiring))) : undefined,
        term ? or(ilike(serviceAgreement.number, `%${term}%`), sql`${serviceAgreement.partyId} in (select id from party where name_ar ilike ${`%${term}%`})`) : undefined,
      );
      const rows = await tx.select().from(serviceAgreement).where(where).orderBy(desc(serviceAgreement.createdAt)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(serviceAgreement).where(where)) as [{ n: number }];
      return { rows: await this.decorate(tx, rows), total: n };
    });
  }

  private async decorate(tx: Tx, rows: AgreementRow[]) {
    const ids = rows.map((r) => r.id);
    const partyIds = [...new Set(rows.map((r) => r.partyId))];
    const parties = partyIds.length ? await tx.select({ id: party.id, nameAr: party.nameAr }).from(party).where(inArray(party.id, partyIds)) : [];
    const sites = await siteNames(tx, rows.flatMap((r) => r.siteIds));
    const next = ids.length ? await tx.select({ agreementId: agreementVisit.agreementId, due: sql<string>`min(${agreementVisit.dueDate})::text` }).from(agreementVisit)
      .where(and(inArray(agreementVisit.agreementId, ids), inArray(agreementVisit.status, ['planned', 'generated']))).groupBy(agreementVisit.agreementId) : [];
    const open = ids.length ? await tx.select({ agreementId: paymentRequest.agreementId, due: sql<string>`coalesce(sum(${paymentRequest.amount} - ${paymentRequest.paidAmount}), 0)::text` }).from(paymentRequest)
      .where(and(inArray(paymentRequest.agreementId, ids), inArray(paymentRequest.status, ['sent', 'partially_paid']))).groupBy(paymentRequest.agreementId) : [];
    return rows.map((r) => ({
      ...r,
      tierLabel: tierInfo(r.tier),
      partyName: parties.find((p) => p.id === r.partyId)?.nameAr ?? null,
      sites: r.siteIds.map((id) => sites.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ id: s.id, name: s.name, city: s.city })),
      assetCount: r.assetIds.length,
      nextVisit: next.find((v) => v.agreementId === r.id)?.due ?? null,
      openBalance: halalasToFixed(toHalalas(open.find((o) => o.agreementId === r.id)?.due ?? '0')),
      annualValue: halalasToFixed(annualValue(r)),
    }));
  }

  @Get('agreements/:id')
  @Perm('agreement.read')
  async agreement(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => this.view(tx, actor, id));
  }

  private async view(tx: Tx, actor: RequestActor, id: string) {
    const a = await loadAgreement(tx, actor, id, 'agreement.read');
    const [d] = await this.decorate(tx, [a]);
    const [p] = await tx.select({ id: party.id, nameAr: party.nameAr, nameEn: party.nameEn, phone: party.phone }).from(party).where(eq(party.id, a.partyId));
    const siteIds = await agreementSites(tx, a);
    const sites = await siteNames(tx, siteIds);
    // covered devices: the explicit list, or every active device on the covered sites
    const assets = a.assetIds.length
      ? await tx.select().from(installedAsset).where(inArray(installedAsset.id, a.assetIds))
      : siteIds.length ? await tx.select().from(installedAsset).where(and(inArray(installedAsset.siteId, siteIds), eq(installedAsset.status, 'active'))).orderBy(asc(installedAsset.code)) : [];
    const paths = await locationPaths(tx, assets.map((x) => x.locationId));
    const visits = await tx.select().from(agreementVisit).where(eq(agreementVisit.agreementId, id)).orderBy(asc(agreementVisit.dueDate));
    const woIds = visits.map((v) => v.workOrderId).filter((x): x is string => !!x);
    const wos = woIds.length ? await tx.select({ id: workOrder.id, number: workOrder.number, status: workOrder.status, scheduledStart: workOrder.scheduledStart, completedAt: workOrder.completedAt, technicianId: workOrder.technicianId, csatScore: workOrder.csatScore }).from(workOrder).where(inArray(workOrder.id, woIds)) : [];
    const names = await userNames(tx, wos.map((w) => w.technicianId));
    const prs = await tx.select().from(paymentRequest).where(eq(paymentRequest.agreementId, id)).orderBy(asc(paymentRequest.periodFrom));
    const invs = prs.length ? await tx.select({ id: invoiceMirror.id, number: invoiceMirror.number, typeCode: invoiceMirror.typeCode, total: invoiceMirror.total, balanceDue: invoiceMirror.balanceDue, status: invoiceMirror.status, issueDate: invoiceMirror.issueDate, paymentRequestId: invoiceMirror.paymentRequestId }).from(invoiceMirror).where(inArray(invoiceMirror.paymentRequestId, prs.map((r) => r.id))) : [];
    const tks = actor.grants['ticket.read'] ? await tx.select().from(ticket).where(and(eq(ticket.agreementId, id), ticketFilter(actor, 'ticket.read'))).orderBy(desc(ticket.createdAt)) : [];
    const now = new Date();
    const tRows = tks.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, coverage: t.coverage, priority: t.priority, createdAt: t.createdAt, sla: ticketSla(t, now) }));
    const count = (part: 'response' | 'resolution', st: string) => tRows.filter((t) => t.sla[part]?.state === st).length;
    // renewal chain: walk back through renewalOfId, then forward through the renewals
    const pick = (x: AgreementRow) => ({ id: x.id, number: x.number, startDate: x.startDate, endDate: x.endDate, status: x.status, price: x.price });
    const chain: ReturnType<typeof pick>[] = [];
    for (let cur: AgreementRow | undefined = a, i = 0; cur && i < 50; i++) {
      chain.unshift(pick(cur));
      cur = cur.renewalOfId ? (await tx.select().from(serviceAgreement).where(eq(serviceAgreement.id, cur.renewalOfId)))[0] : undefined;
    }
    for (let cur: AgreementRow | undefined = a, i = 0; cur && i < 50; i++) {
      cur = (await tx.select().from(serviceAgreement).where(and(eq(serviceAgreement.renewalOfId, cur.id), sql`${serviceAgreement.status} <> 'cancelled'`)).orderBy(desc(serviceAgreement.createdAt)).limit(1))[0];
      if (cur) chain.push(pick(cur));
    }
    const sum = (f: (r: (typeof prs)[number]) => string) => halalasToFixed(prs.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + toHalalas(f(r)), 0));
    const withVat = await vatApplies(tx, a);
    return {
      ...d!,
      party: p ?? null,
      sites: sites.map((s) => ({ id: s.id, name: s.name, city: s.city })),
      assets: assets.map((x) => ({ id: x.id, code: x.code, description: x.description, serial: x.serial, mac: x.mac, siteId: x.siteId, locationPath: x.locationId ? paths.get(x.locationId) ?? null : null, status: x.status, labourWarrantyEnd: x.labourWarrantyEnd, partsWarrantyEnd: x.partsWarrantyEnd })),
      visits: visits.map((v) => {
        const w = wos.find((x) => x.id === v.workOrderId);
        return { id: v.id, siteId: v.siteId, siteName: sites.find((s) => s.id === v.siteId)?.name ?? null, dueDate: v.dueDate, status: v.status, workOrder: w ? { ...w, technicianName: w.technicianId ? names.get(w.technicianId) ?? null : null } : null };
      }),
      billing: {
        vatApplies: withVat,
        // before activation: a preview of the periods that will be requested
        schedule: a.status === 'draft' && toHalalas(a.price) > 0 ? billingWithVat(a.startDate, a.endDate, toHalalas(a.price), a.billingFrequency as keyof typeof BILLING_FREQUENCIES, withVat).map((x) => ({ from: x.from, to: x.to, net: halalasToFixed(x.net), vat: halalasToFixed(x.vat), gross: halalasToFixed(x.gross) })) : [],
        requests: prs.map((r) => ({
          id: r.id, number: r.number, periodFrom: r.periodFrom, periodTo: r.periodTo, amount: r.amount, paidAmount: r.paidAmount, status: r.status, dueDate: r.dueDate, sentAt: r.sentAt,
          payUrl: r.publicToken ? `${config.publicBaseUrl}/p/${r.publicToken}` : null, invoices: invs.filter((i) => i.paymentRequestId === r.id),
        })),
        total: sum((r) => r.amount),
        paid: sum((r) => r.paidAmount),
      },
      tickets: {
        rows: tRows,
        stats: {
          count: tRows.length, open: tRows.filter((t) => ['open', 'in_progress'].includes(t.status)).length,
          responseMet: count('response', 'met'), responseBreached: count('response', 'breached'), resolutionMet: count('resolution', 'met'), resolutionBreached: count('resolution', 'breached'),
        },
      },
      renewalChain: chain,
      renewal: chain[chain.findIndex((c) => c.id === a.id) + 1] ?? null,
    };
  }

  /** Sites and devices must belong to the customer; SLA/visits default from the tier. */
  private async normalise(tx: Tx, b: AgreementInput) {
    if (b.endDate < b.startDate) throw badRequest('endDate must not be before startDate');
    if (toHalalas(b.price) < 0) throw badRequest('price must not be negative');
    const [p] = await tx.select({ id: party.id }).from(party).where(eq(party.id, b.partyId));
    if (!p) throw notFound('customer');
    const siteIds = [...new Set(b.siteIds)];
    const assetIds = [...new Set(b.assetIds)];
    if (!siteIds.length && !assetIds.length) throw badRequest('choose at least one site or device');
    const sites = siteIds.length ? await tx.select({ id: site.id, partyId: site.partyId }).from(site).where(inArray(site.id, siteIds)) : [];
    const foreign = siteIds.filter((sid) => sites.find((s) => s.id === sid)?.partyId !== b.partyId);
    if (foreign.length) throw badRequest('site(s) not found for this customer', foreign);
    if (assetIds.length) {
      const assets = await tx.select({ id: installedAsset.id, partyId: installedAsset.partyId, siteId: installedAsset.siteId }).from(installedAsset).where(inArray(installedAsset.id, assetIds));
      const partySites = new Set((await tx.select({ id: site.id }).from(site).where(eq(site.partyId, b.partyId))).map((s) => s.id));
      const bad = assetIds.filter((aid) => { const x = assets.find((y) => y.id === aid); return !x || (x.partyId !== b.partyId && !(x.siteId && partySites.has(x.siteId))); });
      if (bad.length) throw badRequest('device(s) not found for this customer', bad);
    }
    const t = TIER_DEFAULTS[b.tier as AgreementTier];
    const responseHours = b.responseHours ?? t.responseHours;
    const resolutionHours = b.resolutionHours ?? t.resolutionHours;
    if (resolutionHours < responseHours) throw badRequest('resolutionHours must be at least responseHours');
    return {
      partyId: b.partyId, siteIds, assetIds, tier: b.tier, startDate: b.startDate, endDate: b.endDate,
      visitsPerYear: b.visitsPerYear ?? t.visitsPerYear, responseHours, resolutionHours, coverage: b.coverage ?? t.coverage, partsIncluded: b.partsIncluded,
      price: halalasToFixed(toHalalas(b.price)), billingFrequency: b.billingFrequency, vatOn: b.vatOn, autoRenew: b.autoRenew, upliftPercent: b.upliftPercent, notes: b.notes ?? null,
    };
  }

  @Post('agreements')
  @Perm('agreement.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(agreementSchema)) b: AgreementInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      const values = await this.normalise(tx, b);
      const { number } = await nextNumber(tx, 'service_agreement');
      const [row] = await tx.insert(serviceAgreement).values({
        ...values, number, status: 'draft', ownerId: b.ownerId ?? actor.userId, branchId: actor.branchId, teamId: actor.teamIds[0] ?? null, createdBy: actor.userId, updatedBy: actor.userId,
      }).returning();
      await audit(tx, actor, 'create', 'service_agreement', row!.id, null, { number, partyId: b.partyId, tier: b.tier, price: values.price, startDate: b.startDate, endDate: b.endDate });
      return this.view(tx, actor, row!.id);
    }, actor.userId);
  }

  /** Drafts: every field. Active agreements: notes, auto-renew, uplift and owner only. */
  @Put('agreements/:id')
  @Perm('agreement.write')
  async update(@Actor() actor: RequestActor, @Param('id') id: string, @Body() raw: unknown) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadAgreement(tx, actor, id, 'agreement.write');
      const version = (raw as { version?: unknown } | null)?.version;
      if (typeof version === 'number' && version !== before.version) throw conflict('the agreement was changed by someone else — reload');
      let values: Partial<typeof serviceAgreement.$inferInsert>;
      if (before.status === 'draft') {
        const b = new ZodPipe(agreementSchema).transform(raw);
        values = { ...(await this.normalise(tx, b)), ...(b.ownerId ? { ownerId: b.ownerId } : {}) };
      } else if (before.status === 'active') {
        const b = new ZodPipe(activeUpdateSchema).transform(raw);
        values = {
          ...(b.notes !== undefined ? { notes: b.notes ?? null } : {}), ...(b.autoRenew !== undefined ? { autoRenew: b.autoRenew } : {}),
          ...(b.upliftPercent !== undefined ? { upliftPercent: b.upliftPercent } : {}), ...(b.ownerId ? { ownerId: b.ownerId } : {}),
        };
      } else throw badRequest(`a ${before.status} agreement cannot be edited`);
      await tx.update(serviceAgreement).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(serviceAgreement.id, id));
      const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'service_agreement', id, d.before, d.after);
      return this.view(tx, actor, id);
    }, actor.userId);
  }

  /** Draft → active: preventive visits per site and one payment request per billing period (no invoices yet). */
  @Post('agreements/:id/activate')
  @Perm('agreement.write')
  @HttpCode(200)
  async activate(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await activateAgreement(tx, actor, id);
      return { ...(await this.view(tx, actor, id)), activation: r };
    }, actor.userId);
  }

  @Post('agreements/:id/cancel')
  @Perm('agreement.write')
  @HttpCode(200)
  async cancel(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: zText(1000).min(1) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await cancelAgreement(tx, actor, id, b.reason);
      return { ...(await this.view(tx, actor, id)), cancellation: r };
    }, actor.userId);
  }

  /** New draft for the next term at the uplifted price (activate it to take over). */
  @Post('agreements/:id/renew')
  @Perm('agreement.write')
  async renew(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => this.view(tx, actor, (await renewAgreement(tx, actor, id)).id), actor.userId);
  }

  // ───────────────────────── CSAT (FSM-87) ─────────────────────────

  /** The survey link of a work order (staff can copy / resend it) and the rating once given. */
  @Get('work-orders/:id/csat')
  @Perm('workorder.read')
  async csatLink(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.read');
      return { url: csatUrl(actor.tenantId, wo.id), token: csatToken(actor.tenantId, wo.id), score: wo.csatScore, comment: wo.csatComment, at: wo.csatAt, available: ['completed', 'closed'].includes(wo.status) };
    });
  }

  @Post('work-orders/:id/csat/send')
  @Perm('workorder.write')
  @HttpCode(200)
  async csatSend(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.write');
      if (wo.csatAt) throw conflict('the customer already rated this visit');
      const r = await sendCsatRequest(tx, actor.tenantId, wo.id, actor.userId);
      if (!r) throw badRequest('no customer phone on file');
      await audit(tx, actor, 'csat_request', 'work_order', wo.id, null, { to: r.to, status: r.status });
      return r;
    }, actor.userId);
  }

  /** Public survey page data — work-order number, technician and date only (no prices or notes). */
  @Public()
  @Get('public/csat/:token')
  async publicCsat(@Param('token') token: string) {
    const t = parseCsatToken(token);
    if (!t) throw notFound('survey');
    return tenantTx(t.tenantId, async (tx) => {
      const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, t.woId));
      if (!wo || !['completed', 'closed'].includes(wo.status)) throw notFound('survey');
      const names = await userNames(tx, [wo.technicianId]);
      const co = await companyBlock(tx);
      return {
        company: { legalNameAr: co.legalNameAr, legalNameEn: co.legalNameEn, phone: co.phone },
        number: wo.number, title: wo.title, technicianName: wo.technicianId ? names.get(wo.technicianId) ?? null : null,
        date: riyadhDate(wo.completedAt ?? wo.updatedAt), rated: !!wo.csatAt, score: wo.csatScore,
      };
    });
  }

  /** One-tap score 1–5 (+ optional comment), accepted once. */
  @Public()
  @Post('public/csat/:token')
  @HttpCode(200)
  async submitCsat(@Param('token') token: string, @Body() body: { score?: unknown; comment?: unknown } | null) {
    const t = parseCsatToken(token);
    if (!t) throw notFound('survey');
    const score = body?.score;
    if (!isCsatScore(score)) throw badRequest('score must be a whole number from 1 to 5');
    const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) || null : null;
    return tenantTx(t.tenantId, async (tx) => {
      const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, t.woId));
      if (!wo || !['completed', 'closed'].includes(wo.status)) throw notFound('survey');
      // once only — conditional update so two taps at the same moment cannot both count
      const done = await tx.update(workOrder).set({ csatScore: score, csatComment: comment, csatAt: new Date() }).where(and(eq(workOrder.id, wo.id), sql`${workOrder.csatAt} is null`)).returning({ id: workOrder.id });
      if (!done.length) throw conflict('this visit has already been rated');
      await audit(tx, null, 'csat', 'work_order', wo.id, null, { score, comment });
      if (score <= 2) await notifyUsers(tx, [wo.ownerId, ...(await dispatcherIds(tx))], { kind: 'csat', titleAr: `😟 تقييم منخفض (${score}/5) — ${wo.number}${comment ? `: ${comment}` : ''}`, titleEn: `Low CSAT (${score}/5) — ${wo.number}`, link: `/field/work-orders/${wo.id}` });
      return { ok: true, score };
    });
  }

  // ───────────────────────── reports ─────────────────────────

  @Get('reports/csat')
  @Perm('workorder.read')
  async csatReport(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ from: zDate.optional(), to: zDate.optional() }))) q: { from?: string; to?: string }) {
    return tenantTx(actor.tenantId, (tx) => csatReport(tx, woFilter(actor, 'workorder.read'), q.from, q.to));
  }

  @Get('reports/sla')
  @Perm('ticket.read')
  async slaReport(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }))) q: { months: number }) {
    return tenantTx(actor.tenantId, (tx) => slaReport(tx, ticketFilter(actor, 'ticket.read'), q.months));
  }

  @Get('reports/agreements')
  @Perm('agreement.read')
  async agreementsReport(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => agreementsReport(tx, agreementFilter(actor, 'agreement.read')));
  }

  // ───────────────────────── jobs ─────────────────────────

  /** Run a Phase 7b job now for this tenant (support + tests). `today` simulates the date. */
  @Post('jobs/run')
  @Perm('admin.settings')
  @HttpCode(200)
  async runJob(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ job: z.enum(['sla', 'preventive', 'renewals']), today: zDate.optional() }))) b: { job: 'sla' | 'preventive' | 'renewals'; today?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (b.job === 'sla') return slaEscalationsFor(tx, new Date());
      if (b.job === 'preventive') return preventiveVisitsFor(tx, b.today ?? riyadhDate());
      return agreementRenewalsFor(tx, b.today ?? riyadhDate());
    }, actor.userId);
  }
}
