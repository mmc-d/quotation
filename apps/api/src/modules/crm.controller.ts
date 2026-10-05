import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  activity, and, appUser, asc, campaign, contact, conversation, desc, eq, gte, ilike, inArray, isNull, lead, lostReason, lte, message, messageTemplate, nextNumber, notification, opportunity, or, party, pipeline, pipelineStage, quote, salesTarget, sql, type Tx,
} from '@mmc/db';
import { INTERESTS, LEAD_SOURCES, normalizeArabic, normalizeSaudiMobile, PROJECT_TYPES, scoreLead } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { badRequest, notFound } from '../common/errors.js';
import { sendTemplate, sendText } from '../common/messaging.js';
import { assertCan, scopeFilter } from '../common/scope.js';
import { ZodPipe, zDate, zMoney, zPage } from '../common/zod.js';

const leadSchema = z.object({
  source: z.enum(LEAD_SOURCES).default('other'),
  campaignId: z.string().uuid().nullish(),
  name: z.string().min(1),
  companyName: z.string().nullish(),
  mobile: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  city: z.string().nullish(),
  interest: z.enum(INTERESTS).nullish(),
  projectType: z.enum(PROJECT_TYPES).nullish(),
  estimatedUnits: z.number().int().min(0).nullish(),
  message: z.string().nullish(),
  ownerId: z.string().uuid().nullish(),
  referredByPartyId: z.string().uuid().nullish(),
});
type LeadInput = z.infer<typeof leadSchema>;

export async function createLead(tx: Tx, input: LeadInput & { waBsuid?: string | null; utm?: Record<string, string> | null }, actorId: string | null) {
  const mobile = input.mobile ? normalizeSaudiMobile(input.mobile) ?? input.mobile : null;
  const { number } = await nextNumber(tx, 'lead');
  const score = scoreLead({ source: input.source, estimatedUnits: input.estimatedUnits, hasMobile: !!mobile, hasEmail: !!input.email, interest: input.interest, city: input.city });
  const [row] = await tx.insert(lead).values({ ...input, number, mobile, email: input.email || null, score, ownerId: input.ownerId ?? actorId, createdBy: actorId }).returning();
  // Round-robin is a later refinement; unowned leads notify everyone who can manage leads.
  if (!row!.ownerId) {
    const managers = await tx.execute<{ user_id: string }>(sql`select distinct ur.user_id from user_role ur join role r on r.id = ur.role_id where r.grants ? 'lead.write' and (r.grants->>'lead.write') in ('team','branch','company','all')`);
    for (const m of managers) await tx.insert(notification).values({ userId: m.user_id, kind: 'lead', titleAr: `عميل محتمل جديد: ${row!.name} (${input.source})`, titleEn: `New lead: ${row!.name}`, link: `/crm/leads/${row!.id}` });
  }
  return row!;
}

const oppSchema = z.object({
  title: z.string().min(1),
  partyId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  siteId: z.string().uuid().nullish(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  amount: zMoney.default('0'),
  expectedClose: zDate.nullish(),
  projectType: z.enum(PROJECT_TYPES).nullish(),
  competitors: z.array(z.string()).default([]),
  ownerId: z.string().uuid().nullish(),
});

const activitySchema = z.object({
  entityType: z.enum(['party', 'lead', 'opportunity', 'quote', 'contract']),
  entityId: z.string().uuid(),
  type: z.enum(['call', 'meeting', 'site_visit', 'task', 'whatsapp', 'email', 'note']),
  subject: z.string().min(1),
  body: z.string().nullish(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  done: z.boolean().default(false),
  outcome: z.string().nullish(),
  ownerId: z.string().uuid().nullish(),
});

async function defaultPipeline(tx: Tx) {
  const [p] = await tx.select().from(pipeline).orderBy(desc(pipeline.isDefault)).limit(1);
  if (!p) throw badRequest('no pipeline configured');
  const stages = await tx.select().from(pipelineStage).where(eq(pipelineStage.pipelineId, p.id)).orderBy(asc(pipelineStage.sort));
  return { pipeline: p, stages };
}

async function touchOpportunity(tx: Tx, entityType: string, entityId: string) {
  if (entityType === 'opportunity') await tx.update(opportunity).set({ lastActivityAt: new Date() }).where(eq(opportunity.id, entityId));
  if (entityType === 'lead') await tx.update(lead).set({ firstContactAt: sql`coalesce(${lead.firstContactAt}, now())`, status: sql`case when ${lead.status} = 'new' then 'contacted' else ${lead.status} end` }).where(eq(lead.id, entityId));
}

@Controller('crm')
export class CrmController {
  // ── Leads ──────────────────────────────────────────────────────────────
  @Get('leads')
  @Perm('lead.read')
  async leads(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.string().optional(), source: z.string().optional(), ownerId: z.string().uuid().optional(), unassigned: z.coerce.boolean().optional() }))) q: { q?: string; limit: number; offset: number; status?: string; source?: string; ownerId?: string; unassigned?: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q ? `%${q.q}%` : null;
      const scope = scopeFilter(actor, 'lead.read', { owner: lead.ownerId, team: lead.teamId });
      const where = and(
        q.unassigned ? isNull(lead.ownerId) : scope ? or(scope, isNull(lead.ownerId)) : undefined,
        q.status ? inArray(lead.status, q.status.split(',')) : undefined,
        q.source ? eq(lead.source, q.source) : undefined,
        q.ownerId ? eq(lead.ownerId, q.ownerId) : undefined,
        term ? or(ilike(lead.name, term), ilike(lead.companyName, term), ilike(lead.mobile, term), ilike(lead.number, term)) : undefined,
      );
      const rows = await tx.select({ lead, ownerName: appUser.nameAr }).from(lead).leftJoin(appUser, eq(appUser.id, lead.ownerId)).where(where).orderBy(desc(lead.createdAt)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(lead).where(where)) as [{ n: number }];
      return { rows: rows.map((r) => ({ ...r.lead, ownerName: r.ownerName })), total: n };
    });
  }

  @Get('leads/:id')
  @Perm('lead.read')
  async lead(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [l] = await tx.select().from(lead).where(eq(lead.id, id));
      if (!l) throw notFound('lead');
      if (l.ownerId) assertCan(actor, 'lead.read', { ownerId: l.ownerId, teamId: l.teamId });
      const activities = await tx.select().from(activity).where(and(eq(activity.entityType, 'lead'), eq(activity.entityId, id))).orderBy(desc(activity.createdAt));
      const convs = l.mobile || l.waBsuid ? await tx.select().from(conversation).where(or(eq(conversation.leadId, id), l.mobile ? eq(conversation.externalAddress, l.mobile) : undefined)) : [];
      return { ...l, activities, conversations: convs };
    });
  }

  @Post('leads')
  @Perm('lead.write')
  async createLead(@Actor() actor: RequestActor, @Body(new ZodPipe(leadSchema)) b: LeadInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (b.mobile) {
        const m = normalizeSaudiMobile(b.mobile);
        const [dupe] = m ? await tx.select({ id: lead.id, number: lead.number }).from(lead).where(and(eq(lead.mobile, m), inArray(lead.status, ['new', 'contacted', 'qualified']))) : [];
        if (dupe) throw badRequest(`an open lead with this mobile already exists (${dupe.number})`, { id: dupe.id });
      }
      const row = await createLead(tx, b, actor.userId);
      await audit(tx, actor, 'create', 'lead', row.id, null, { name: b.name, source: b.source });
      return row;
    }, actor.userId);
  }

  @Put('leads/:id')
  @Perm('lead.write')
  async updateLead(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(leadSchema.extend({ status: z.enum(['new', 'contacted', 'qualified', 'unqualified']).optional(), unqualifiedReason: z.string().nullish() }))) b: LeadInput & { status?: string; unqualifiedReason?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [before] = await tx.select().from(lead).where(eq(lead.id, id));
      if (!before) throw notFound('lead');
      if (before.ownerId) assertCan(actor, 'lead.write', { ownerId: before.ownerId, teamId: before.teamId });
      if (before.status === 'converted') throw badRequest('lead already converted');
      const mobile = b.mobile ? normalizeSaudiMobile(b.mobile) ?? b.mobile : null;
      const score = scoreLead({ source: b.source, estimatedUnits: b.estimatedUnits, hasMobile: !!mobile, hasEmail: !!b.email, interest: b.interest, city: b.city });
      const [row] = await tx.update(lead).set({ ...b, mobile, email: b.email || null, score, ownerId: b.ownerId ?? before.ownerId, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(lead.id, id)).returning();
      if (b.ownerId && b.ownerId !== before.ownerId) {
        await tx.insert(notification).values({ userId: b.ownerId, kind: 'lead', titleAr: `أُسند إليك العميل المحتمل ${row!.name}`, link: `/crm/leads/${id}` });
        await audit(tx, actor, 'assign', 'lead', id, { ownerId: before.ownerId }, { ownerId: b.ownerId });
      }
      return row;
    }, actor.userId);
  }

  /** Lead → customer (party + contact) + opportunity in the default pipeline. */
  @Post('leads/:id/convert')
  @Perm('lead.write', 'opportunity.write')
  async convert(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ partyId: z.string().uuid().nullish(), createOpportunity: z.boolean().default(true), opportunityTitle: z.string().nullish(), amount: zMoney.default('0') }))) b: { partyId?: string | null; createOpportunity: boolean; opportunityTitle?: string | null; amount: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [l] = await tx.select().from(lead).where(eq(lead.id, id));
      if (!l) throw notFound('lead');
      if (l.ownerId) assertCan(actor, 'lead.write', { ownerId: l.ownerId, teamId: l.teamId });
      if (l.status === 'converted') throw badRequest('lead already converted');
      let partyId = b.partyId ?? null;
      if (!partyId) {
        const nameAr = l.companyName || l.name;
        const [p] = await tx.insert(party).values({ kind: l.companyName ? 'organization' : 'individual', nameAr, phone: l.mobile, email: l.email, source: l.source, ownerId: l.ownerId ?? actor.userId, b2b: !!l.companyName, searchText: normalizeArabic(`${nameAr} ${l.name} ${l.mobile ?? ''}`), createdBy: actor.userId }).returning();
        partyId = p!.id;
      }
      const [c] = await tx.insert(contact).values({ partyId, name: l.name, mobile: l.mobile, whatsapp: l.mobile, waBsuid: l.waBsuid, email: l.email, isPrimary: true }).returning();
      let oppId: string | null = null;
      if (b.createOpportunity) {
        const { pipeline: p, stages } = await defaultPipeline(tx);
        const first = stages[0]!;
        const [o] = await tx.insert(opportunity).values({ title: b.opportunityTitle || `${l.companyName || l.name} — ${l.interest ?? 'مشروع'}`, partyId, contactId: c!.id, pipelineId: p.id, stageId: first.id, probability: first.probability, amount: b.amount, projectType: l.projectType, ownerId: l.ownerId ?? actor.userId, teamId: l.teamId, leadId: l.id, createdBy: actor.userId }).returning();
        oppId = o!.id;
      }
      await tx.update(lead).set({ status: 'converted', convertedAt: new Date(), convertedPartyId: partyId, convertedContactId: c!.id, convertedOpportunityId: oppId }).where(eq(lead.id, id));
      await tx.update(conversation).set({ partyId, contactId: c!.id }).where(eq(conversation.leadId, id));
      await audit(tx, actor, 'convert', 'lead', id, null, { partyId, opportunityId: oppId });
      return { partyId, contactId: c!.id, opportunityId: oppId };
    }, actor.userId);
  }

  // ── Pipeline & opportunities ────────────────────────────────────────────
  @Get('pipeline')
  @Perm('opportunity.read')
  async pipeline(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ ownerId: z.string().uuid().optional(), q: z.string().optional() }))) q: { ownerId?: string; q?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { pipeline: p, stages } = await defaultPipeline(tx);
      const where = and(eq(opportunity.pipelineId, p.id), scopeFilter(actor, 'opportunity.read', { owner: opportunity.ownerId, team: opportunity.teamId }), q.ownerId ? eq(opportunity.ownerId, q.ownerId) : undefined, q.q ? ilike(opportunity.title, `%${q.q}%`) : undefined);
      const opps = await tx.select({ o: opportunity, partyName: party.nameAr, ownerName: appUser.nameAr }).from(opportunity).leftJoin(party, eq(party.id, opportunity.partyId)).leftJoin(appUser, eq(appUser.id, opportunity.ownerId)).where(where).orderBy(desc(opportunity.updatedAt));
      const lostReasons = await tx.select().from(lostReason);
      return { pipeline: p, stages, lostReasons, opportunities: opps.map((r) => ({ ...r.o, partyName: r.partyName, ownerName: r.ownerName })) };
    });
  }

  @Get('opportunities/:id')
  @Perm('opportunity.read')
  async opportunity(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [o] = await tx.select().from(opportunity).where(eq(opportunity.id, id));
      if (!o) throw notFound('opportunity');
      assertCan(actor, 'opportunity.read', { ownerId: o.ownerId, teamId: o.teamId });
      const [p] = o.partyId ? await tx.select().from(party).where(eq(party.id, o.partyId)) : [];
      const quotes = await tx.select({ id: quote.id, number: quote.number, revision: quote.revision, status: quote.status, total: quote.total }).from(quote).where(eq(quote.opportunityId, id)).orderBy(desc(quote.createdAt));
      const activities = await tx.select().from(activity).where(and(eq(activity.entityType, 'opportunity'), eq(activity.entityId, id))).orderBy(desc(activity.createdAt));
      const stages = await tx.select().from(pipelineStage).where(eq(pipelineStage.pipelineId, o.pipelineId)).orderBy(asc(pipelineStage.sort));
      return { ...o, party: p ?? null, quotes, activities, stages };
    });
  }

  @Put('opportunities/:id')
  @Perm('opportunity.write')
  async putOpportunity(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(oppSchema)) b: z.infer<typeof oppSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { pipeline: p, stages } = await defaultPipeline(tx);
      if (id === 'new') {
        const st = stages.find((s) => s.id === b.stageId) ?? stages[0]!;
        const [o] = await tx.insert(opportunity).values({ ...b, pipelineId: b.pipelineId ?? p.id, stageId: st.id, probability: st.probability, ownerId: b.ownerId ?? actor.userId, teamId: actor.teamIds[0] ?? null, createdBy: actor.userId }).returning();
        await audit(tx, actor, 'create', 'opportunity', o!.id, null, { title: b.title, amount: b.amount });
        return o;
      }
      const [before] = await tx.select().from(opportunity).where(eq(opportunity.id, id));
      if (!before) throw notFound('opportunity');
      assertCan(actor, 'opportunity.write', { ownerId: before.ownerId, teamId: before.teamId });
      const [o] = await tx.update(opportunity).set({ ...b, pipelineId: before.pipelineId, stageId: before.stageId, ownerId: b.ownerId ?? before.ownerId, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(opportunity.id, id)).returning();
      return o;
    }, actor.userId);
  }

  /** Kanban move; won/lost stages need (for lost) a reason code. */
  @Post('opportunities/:id/stage')
  @Perm('opportunity.write')
  async moveStage(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ stageId: z.string().uuid(), lostReasonKey: z.string().nullish(), lostNote: z.string().nullish() }))) b: { stageId: string; lostReasonKey?: string | null; lostNote?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [o] = await tx.select().from(opportunity).where(eq(opportunity.id, id));
      if (!o) throw notFound('opportunity');
      assertCan(actor, 'opportunity.write', { ownerId: o.ownerId, teamId: o.teamId });
      const [st] = await tx.select().from(pipelineStage).where(and(eq(pipelineStage.id, b.stageId), eq(pipelineStage.pipelineId, o.pipelineId)));
      if (!st) throw badRequest('stage not in this pipeline');
      if (st.kind === 'lost' && !b.lostReasonKey) throw badRequest('a lost reason is required');
      const [row] = await tx.update(opportunity).set({ stageId: st.id, probability: st.probability, wonAt: st.kind === 'won' ? new Date() : null, lostAt: st.kind === 'lost' ? new Date() : null, lostReasonKey: st.kind === 'lost' ? b.lostReasonKey ?? null : null, lostNote: st.kind === 'lost' ? b.lostNote ?? null : null, lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(opportunity.id, id)).returning();
      await tx.insert(activity).values({ entityType: 'opportunity', entityId: id, type: 'note', subject: `نُقلت إلى مرحلة «${st.nameAr}»${b.lostReasonKey ? ` — السبب: ${b.lostReasonKey}` : ''}`, ownerId: actor.userId, doneAt: new Date() });
      await audit(tx, actor, 'stage', 'opportunity', id, { stageId: o.stageId }, { stageId: st.id, lostReasonKey: b.lostReasonKey });
      return row;
    }, actor.userId);
  }

  // ── Activities & tasks ─────────────────────────────────────────────────
  @Get('activities')
  @Perm('activity.read')
  async activities(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ mine: z.coerce.boolean().default(true), open: z.coerce.boolean().default(true), entityType: z.string().optional(), entityId: z.string().uuid().optional() }))) q: { mine: boolean; open: boolean; entityType?: string; entityId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const where = and(
        q.entityId ? and(eq(activity.entityType, q.entityType ?? 'party'), eq(activity.entityId, q.entityId)) : undefined,
        q.mine && !q.entityId ? eq(activity.ownerId, actor.userId) : scopeFilter(actor, 'activity.read', { owner: activity.ownerId }),
        q.open && !q.entityId ? and(isNull(activity.doneAt), sql`${activity.dueAt} is not null`) : undefined,
      );
      return tx.select().from(activity).where(where).orderBy(q.open ? asc(activity.dueAt) : desc(activity.createdAt)).limit(200);
    });
  }

  @Post('activities')
  @Perm('activity.write')
  async addActivity(@Actor() actor: RequestActor, @Body(new ZodPipe(activitySchema)) b: z.infer<typeof activitySchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [a] = await tx.insert(activity).values({ entityType: b.entityType, entityId: b.entityId, type: b.type, subject: b.subject, body: b.body ?? null, dueAt: b.dueAt ? new Date(b.dueAt) : null, doneAt: b.done ? new Date() : null, outcome: b.outcome ?? null, ownerId: b.ownerId ?? actor.userId, createdBy: actor.userId }).returning();
      await touchOpportunity(tx, b.entityType, b.entityId);
      if (b.ownerId && b.ownerId !== actor.userId) await tx.insert(notification).values({ userId: b.ownerId, kind: 'task', titleAr: `مهمة جديدة: ${b.subject}`, link: `/crm/tasks` });
      return a;
    }, actor.userId);
  }

  @Post('activities/:id/done')
  @Perm('activity.write')
  async done(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ outcome: z.string().nullish() }))) b: { outcome?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [a] = await tx.select().from(activity).where(eq(activity.id, id));
      if (!a) throw notFound('activity');
      assertCan(actor, 'activity.write', { ownerId: a.ownerId });
      const [row] = await tx.update(activity).set({ doneAt: new Date(), outcome: b.outcome ?? a.outcome, updatedAt: new Date() }).where(eq(activity.id, id)).returning();
      await touchOpportunity(tx, a.entityType, a.entityId);
      return row;
    });
  }

  @Delete('activities/:id')
  @Perm('activity.write')
  async removeActivity(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [a] = await tx.select().from(activity).where(eq(activity.id, id));
      if (!a) throw notFound('activity');
      assertCan(actor, 'activity.write', { ownerId: a.ownerId });
      if (a.doneAt) throw badRequest('completed activities are part of the record and cannot be deleted');
      await tx.delete(activity).where(eq(activity.id, id));
      return { ok: true };
    });
  }

  // ── Shared inbox (WhatsApp / e-mail) ─────────────────────────────────────
  @Get('inbox')
  @Perm('message.read')
  async inbox(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ status: z.enum(['open', 'closed', 'all']).default('open'), mine: z.coerce.boolean().default(false) }))) q: { status: string; mine: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const scope = actor.grants['message.read'] === 'own' || q.mine ? or(eq(conversation.assigneeId, actor.userId), isNull(conversation.assigneeId)) : undefined;
      const rows = await tx.select({ c: conversation, contactName: contact.name, partyName: party.nameAr, leadName: lead.name, assigneeName: appUser.nameAr })
        .from(conversation).leftJoin(contact, eq(contact.id, conversation.contactId)).leftJoin(party, eq(party.id, conversation.partyId)).leftJoin(lead, eq(lead.id, conversation.leadId)).leftJoin(appUser, eq(appUser.id, conversation.assigneeId))
        .where(and(q.status === 'all' ? undefined : eq(conversation.status, q.status), scope)).orderBy(desc(conversation.lastMessageAt)).limit(200);
      return rows.map((r) => ({ ...r.c, displayName: r.contactName ?? r.partyName ?? r.leadName ?? r.c.externalAddress, assigneeName: r.assigneeName, windowOpen: !!r.c.lastInboundAt && Date.now() - r.c.lastInboundAt.getTime() < 24 * 3600_000 }));
    });
  }

  @Get('inbox/:id')
  @Perm('message.read')
  async conversation(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [c] = await tx.select().from(conversation).where(eq(conversation.id, id));
      if (!c) throw notFound('conversation');
      const messages = await tx.select().from(message).where(eq(message.conversationId, id)).orderBy(asc(message.createdAt)).limit(500);
      await tx.update(conversation).set({ unreadCount: 0 }).where(eq(conversation.id, id));
      const templates = await tx.select().from(messageTemplate).where(and(eq(messageTemplate.channel, c.channel), eq(messageTemplate.active, true)));
      return { ...c, messages, templates, windowOpen: !!c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < 24 * 3600_000 };
    });
  }

  @Post('inbox/:id/reply')
  @Perm('message.send')
  async reply(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ body: z.string().min(1).max(4096).optional(), templateKey: z.string().optional(), vars: z.record(z.string(), z.string()).default({}) }))) b: { body?: string; templateKey?: string; vars: Record<string, string> }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [c] = await tx.select().from(conversation).where(eq(conversation.id, id));
      if (!c) throw notFound('conversation');
      if (b.templateKey) return (await sendTemplate(tx, { channel: c.channel as 'whatsapp' | 'email', to: c.externalAddress, templateKey: b.templateKey, vars: b.vars, sentBy: actor.userId, link: { contactId: c.contactId, partyId: c.partyId, leadId: c.leadId } })).message;
      if (!b.body) throw badRequest('body or templateKey required');
      try {
        return await sendText(tx, id, b.body, actor.userId);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    }, actor.userId);
  }

  @Post('inbox/:id/assign')
  @Perm('message.send')
  async assign(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ assigneeId: z.string().uuid().nullish(), status: z.enum(['open', 'closed']).optional() }))) b: { assigneeId?: string | null; status?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [c] = await tx.update(conversation).set({ ...(b.assigneeId !== undefined ? { assigneeId: b.assigneeId } : {}), ...(b.status ? { status: b.status } : {}), updatedAt: new Date() }).where(eq(conversation.id, id)).returning();
      if (!c) throw notFound('conversation');
      if (b.assigneeId && b.assigneeId !== actor.userId) await tx.insert(notification).values({ userId: b.assigneeId, kind: 'inbox', titleAr: `أُسندت إليك محادثة ${c.externalAddress}`, link: `/crm/inbox/${id}` });
      return c;
    });
  }

  /** Create a lead from an unknown inbound conversation. */
  @Post('inbox/:id/lead')
  @Perm('lead.write')
  async leadFromConversation(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ name: z.string().min(1), interest: z.enum(INTERESTS).nullish() }))) b: { name: string; interest?: (typeof INTERESTS)[number] | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [c] = await tx.select().from(conversation).where(eq(conversation.id, id));
      if (!c) throw notFound('conversation');
      const isPhone = c.externalAddress.startsWith('+');
      const l = await createLead(tx, { source: c.channel === 'whatsapp' ? 'whatsapp' : 'email', name: b.name, mobile: isPhone ? c.externalAddress : null, email: !isPhone && c.channel === 'email' ? c.externalAddress : null, interest: b.interest ?? null, waBsuid: !isPhone && c.channel === 'whatsapp' ? c.externalAddress : null } as LeadInput, actor.userId);
      await tx.update(conversation).set({ leadId: l.id, assigneeId: c.assigneeId ?? actor.userId }).where(eq(conversation.id, id));
      return l;
    }, actor.userId);
  }

  // ── Targets & campaigns ───────────────────────────────────────────────
  @Get('targets')
  @Perm('report.sales')
  async targets(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ from: zDate.optional(), to: zDate.optional() }))) q: { from?: string; to?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({ t: salesTarget, name: appUser.nameAr }).from(salesTarget).leftJoin(appUser, eq(appUser.id, salesTarget.userId)).where(and(q.from ? gte(salesTarget.periodEnd, q.from) : undefined, q.to ? lte(salesTarget.periodStart, q.to) : undefined));
      const out = [];
      for (const r of rows) {
        const [won] = await tx.select({ v: sql<string>`coalesce(sum(${quote.total}),0)` }).from(quote).where(and(eq(quote.status, 'accepted'), r.t.userId ? eq(quote.ownerId, r.t.userId) : undefined, gte(quote.acceptedAt, new Date(`${r.t.periodStart}T00:00:00+03:00`)), lte(quote.acceptedAt, new Date(`${r.t.periodEnd}T23:59:59+03:00`))));
        out.push({ ...r.t, userName: r.name, achieved: won?.v ?? '0', percent: Number(r.t.amount) > 0 ? Math.round((Number(won?.v ?? 0) / Number(r.t.amount)) * 1000) / 10 : null });
      }
      return out;
    });
  }

  @Put('targets/:id')
  @Perm('opportunity.write', 'admin.settings')
  async putTarget(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ userId: z.string().uuid().nullish(), teamId: z.string().uuid().nullish(), periodStart: zDate, periodEnd: zDate, amount: zMoney }))) b: { userId?: string | null; teamId?: string | null; periodStart: string; periodEnd: string; amount: string }) {
    if (!actor.grants['admin.settings'] && actor.grants['opportunity.write'] === 'own') throw badRequest('targets are set by managers');
    return tenantTx(actor.tenantId, async (tx) => (id === 'new' ? (await tx.insert(salesTarget).values(b).returning())[0] : (await tx.update(salesTarget).set(b).where(eq(salesTarget.id, id)).returning())[0]));
  }

  @Get('campaigns')
  @Perm('lead.read')
  async campaigns(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => tx.execute(sql`select c.*, (select count(*)::int from lead l where l.campaign_id = c.id) as leads, (select count(*)::int from lead l where l.campaign_id = c.id and l.status = 'converted') as converted from campaign c where c.archived_at is null order by c.created_at desc`));
  }

  @Put('campaigns/:id')
  @Perm('lead.write')
  async putCampaign(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ name: z.string().min(1), channel: z.string().nullish(), startDate: zDate.nullish(), endDate: zDate.nullish(), budget: zMoney.nullish() }))) b: { name: string; channel?: string | null; startDate?: string | null; endDate?: string | null; budget?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => (id === 'new' ? (await tx.insert(campaign).values(b).returning())[0] : (await tx.update(campaign).set(b).where(eq(campaign.id, id)).returning())[0]));
  }
}
