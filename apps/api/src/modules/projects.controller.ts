import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  and, contract, desc, emit, eq, ilike, inArray, installedAsset, isNull, ne, or, party, project, projectApproval, projectClockPause, projectStageLog, projectTask, snag, sql, type Tx,
} from '@mmc/db';
import { APPROVAL_KINDS, PROJECT_STAGES, addBusinessDays, businessDaysBetween, gateFor, clockStartDate, riyadhDate, warrantyEnds, type ProjectStage } from '@mmc/domain';
import { htmlToPdf, renderHandoverHtml } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { assertCan } from '../common/scope.js';
import { ZodPipe, zDate, zPage, zUuid } from '../common/zod.js';
import { config } from '../config.js';
import { loadCalendar } from './calendar.controller.js';
import {
  TEMPLATE_KEYS, applyTemplateTasks, assertProject, decideApproval, ensureProjectForContract, handoverDoc, loadFacts, loadProject, projectClock, projectScope, projectView,
  type ProjectRow, type TemplateKey,
} from './projects.service.js';

/**
 * Projects & execution tracking (module 05): one project per signed contract, stage gates, the
 * contractual delivery clock, client approvals, tasks, snags, acceptance and the handover package.
 * Stage moves are always explicit (POST /advance); a failed gate can only be overridden with
 * project.override and a reason, and the overridden checks are logged.
 */
const zStage = z.enum(PROJECT_STAGES);
const zTemplate = z.enum(TEMPLATE_KEYS);
const zKind = z.enum(APPROVAL_KINDS);
const zText = (max: number) => z.string().trim().min(1).max(max);
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

const listSchema = zPage.extend({ stage: z.string().optional(), status: z.string().optional(), managerId: zUuid.optional() });
const createSchema = z.object({ templateKey: zTemplate.optional(), name: z.string().trim().max(200).nullish(), managerId: zUuid.nullish() }).nullish();
const updateSchema = z.object({
  name: zText(200).optional(),
  managerId: zUuid.nullable().optional(),
  templateKey: zTemplate.optional(),
  requiredApprovals: z.array(zKind).max(APPROVAL_KINDS.length).optional(),
  clockMinDays: z.number().int().min(1).max(1000).optional(),
  clockMaxDays: z.number().int().min(1).max(1000).optional(),
  warrantyLabourMonths: z.number().int().min(0).max(120).optional(),
  warrantyPartsMonths: z.number().int().min(0).max(120).optional(),
  materialsReady: z.boolean().optional(),
  plannedStart: zDate.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  status: z.enum(['active', 'on_hold', 'cancelled']).optional(),
  version: z.number().int().optional(),
});
const advanceSchema = z.object({ override: z.boolean().optional(), reason: z.string().trim().max(1000).nullish() }).nullish();
const approvalSchema = z.object({ kind: zKind, title: zText(200), notes: z.string().max(5000).nullish(), fileIds: z.array(zUuid).max(50).optional() });
const pauseSchema = z.object({ fromDate: zDate, toDate: zDate.nullish(), kind: z.enum(['client_delay', 'consultant_delay', 'site_not_ready', 'other']).default('client_delay'), reason: zText(1000) });
const taskSchema = z.object({ title: zText(300), stage: zStage.optional(), assigneeId: zUuid.nullish(), startDate: zDate.nullish(), dueDate: zDate.nullish(), dependsOnId: zUuid.nullish(), locationId: zUuid.nullish(), sort: z.number().int().optional() });
const taskUpdateSchema = z.object({ title: zText(300).optional(), stage: zStage.optional(), status: z.enum(['todo', 'doing', 'done']).optional(), assigneeId: zUuid.nullable().optional(), startDate: zDate.nullable().optional(), dueDate: zDate.nullable().optional(), dependsOnId: zUuid.nullable().optional(), sort: z.number().int().optional() });

type TaskRow = typeof projectTask.$inferSelect;

/** Finish-to-start predecessor (PRJ-13): same project, not itself, and no cycle. */
async function checkDependency(tx: Tx, projectId: string, taskId: string | null, dependsOnId: string | null | undefined) {
  if (!dependsOnId) return;
  if (dependsOnId === taskId) throw badRequest('a task cannot depend on itself');
  const rows = await tx.select({ id: projectTask.id, dependsOnId: projectTask.dependsOnId }).from(projectTask).where(eq(projectTask.projectId, projectId));
  const byId = new Map(rows.map((r) => [r.id, r.dependsOnId]));
  if (!byId.has(dependsOnId)) throw badRequest('the predecessor task belongs to another project');
  // walk up from the predecessor: reaching this task again would close a loop
  const seen = new Set<string>();
  for (let cur: string | null | undefined = dependsOnId; cur; cur = byId.get(cur)) {
    if (cur === taskId) throw badRequest('this dependency would create a cycle');
    if (seen.has(cur)) break;
    seen.add(cur);
  }
}

function checkDates(startDate: string | null | undefined, dueDate: string | null | undefined) {
  if (startDate && dueDate && startDate > dueDate) throw badRequest('the start date is after the due date');
}

/**
 * Simple finish-to-start rescheduling: when a task's due date moves later by n business days, every
 * open task that (transitively) depends on it moves its start and due dates by the same n business days.
 */
async function shiftDependents(tx: Tx, actor: RequestActor, t: TaskRow, oldDue: string, newDue: string) {
  const calendar = await loadCalendar(tx);
  const n = businessDaysBetween(oldDue, newDue, calendar);
  if (n <= 0) return [];
  const rows = await tx.select().from(projectTask).where(eq(projectTask.projectId, t.projectId));
  const moved: { id: string; startDate: string | null; dueDate: string | null }[] = [];
  const seen = new Set([t.id]);
  const queue = [t.id];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const d of rows.filter((r) => r.dependsOnId === parent && !seen.has(r.id))) {
      seen.add(d.id);
      queue.push(d.id);
      if (d.status === 'done') continue;
      const startDate = d.startDate ? addBusinessDays(d.startDate, n, calendar) : null;
      const dueDate = d.dueDate ? addBusinessDays(d.dueDate, n, calendar) : null;
      if (!startDate && !dueDate) continue;
      await tx.update(projectTask).set({ startDate, dueDate, ...touch(actor), version: d.version + 1 }).where(eq(projectTask.id, d.id));
      moved.push({ id: d.id, startDate, dueDate });
    }
  }
  if (moved.length) await audit(tx, actor, 'shift_dependents', 'project_task', t.id, { dueDate: oldDue }, { dueDate: newDue, businessDays: n, moved });
  return moved;
}
const snagSchema = z.object({ description: zText(2000), locationId: zUuid.nullish(), assigneeId: zUuid.nullish(), dueDate: zDate.nullish(), photoFileIds: z.array(zUuid).max(30).optional() });

const touch = (actor: RequestActor) => ({ updatedAt: new Date(), updatedBy: actor.userId });

/** Clock for list rows: kick-off projects need the facts (the clock may already run there). */
async function clockSummary(tx: Tx, p: ProjectRow, calendar: Awaited<ReturnType<typeof loadCalendar>>) {
  const facts = !p.clockStartedOn && p.stage === 'kickoff' ? (await loadFacts(tx, p)).facts : null;
  const { clock } = await projectClock(tx, p, facts, calendar);
  return { level: clock.level, elapsed: clock.elapsed, minDays: clock.minDays, maxDays: clock.maxDays, targetMax: clock.targetMax, startDate: clock.startDate, paused: clock.paused, ratio: clock.ratio };
}

@Controller('projects')
export class ProjectsController {
  /** List with clock summary and customer name (PRJ-06 portfolio, PRJ-12 list/kanban). */
  @Get()
  @Perm('project.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = and(
        projectScope(actor, 'project.read'),
        q.stage ? inArray(project.stage, q.stage.split(',')) : undefined,
        q.status ? inArray(project.status, q.status.split(',')) : undefined,
        q.managerId ? eq(project.managerId, q.managerId) : undefined,
        term ? or(ilike(project.number, term), ilike(project.name, term), ilike(party.nameAr, term), ilike(contract.number, term)) : undefined,
      );
      const rows = await tx.select({ p: project, customerName: party.nameAr, contractNumber: contract.number }).from(project)
        .leftJoin(party, eq(party.id, project.partyId)).leftJoin(contract, eq(contract.id, project.contractId))
        .where(where).orderBy(desc(project.createdAt)).limit(q.limit).offset(q.offset);
      const [cnt] = await tx.select({ total: sql<number>`count(*)::int` }).from(project)
        .leftJoin(party, eq(party.id, project.partyId)).leftJoin(contract, eq(contract.id, project.contractId)).where(where);
      const calendar = await loadCalendar(tx);
      const out = [];
      for (const r of rows) out.push({ ...r.p, customerName: r.customerName, contractNumber: r.contractNumber, clock: await clockSummary(tx, r.p, calendar) });
      return { rows: out, total: cnt?.total ?? 0 };
    });
  }

  /** Counts by stage, clocks at risk and open snags (dashboard tile). */
  @Get('dashboard/summary')
  @Perm('project.read')
  async summary(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select().from(project).where(and(projectScope(actor, 'project.read'), inArray(project.status, ['active', 'on_hold'])));
      const byStage = Object.fromEntries(PROJECT_STAGES.map((s) => [s, 0])) as Record<ProjectStage, number>;
      const clocks = { not_started: 0, ok: 0, warn70: 0, warn90: 0, overdue: 0, stopped: 0 };
      const calendar = await loadCalendar(tx);
      const atRisk: { id: string; number: string; name: string; level: string; elapsed: number; maxDays: number; targetMax: string | null }[] = [];
      for (const p of rows) {
        byStage[p.stage as ProjectStage] = (byStage[p.stage as ProjectStage] ?? 0) + 1;
        const c = await clockSummary(tx, p, calendar);
        clocks[c.level]++;
        if (['warn70', 'warn90', 'overdue'].includes(c.level)) atRisk.push({ id: p.id, number: p.number, name: p.name, level: c.level, elapsed: c.elapsed, maxDays: c.maxDays, targetMax: c.targetMax });
      }
      const ids = rows.map((p) => p.id);
      const [s] = ids.length ? await tx.select({ n: sql<number>`count(*)::int` }).from(snag).where(and(inArray(snag.projectId, ids), ne(snag.status, 'verified'))) : [{ n: 0 }];
      atRisk.sort((a, b) => b.elapsed / (b.maxDays || 1) - a.elapsed / (a.maxDays || 1));
      return { total: rows.length, byStage, clocks, openSnags: s?.n ?? 0, atRisk: atRisk.slice(0, 20) };
    });
  }

  /** Create (or return) the project of a signed contract, seeded from a template (PRJ-01/02). */
  @Post('from-contract/:contractId')
  @Perm('project.write')
  async fromContract(@Actor() actor: RequestActor, @Param('contractId') contractId: string, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (!isUuid(contractId)) throw notFound('contract');
      const [c] = await tx.select().from(contract).where(eq(contract.id, contractId));
      if (!c) throw notFound('contract');
      assertCan(actor, 'project.write', { ownerId: c.ownerId, teamId: c.teamId, branchId: c.branchId });
      if (!['signed', 'active', 'completed'].includes(c.status)) throw badRequest('a project is created from a signed contract');
      const r = await ensureProjectForContract(tx, actor, contractId, { templateKey: b?.templateKey, name: b?.name, managerId: b?.managerId });
      if (!r.created) {
        // Usually created when the contract was signed — apply what the user chose now.
        const patch: Partial<ProjectRow> = {};
        if (b?.name?.trim()) patch.name = b.name.trim();
        if (b?.managerId !== undefined) patch.managerId = b.managerId;
        if (b?.templateKey && b.templateKey !== r.project.templateKey) {
          patch.templateKey = b.templateKey;
          await applyTemplateTasks(tx, r.project.id, b.templateKey, actor.userId, true);
        }
        const d = diff(r.project as Record<string, unknown>, patch as Record<string, unknown>);
        if (d) {
          await tx.update(project).set({ ...patch, ...touch(actor), version: r.project.version + 1 }).where(eq(project.id, r.project.id));
          await audit(tx, actor, 'update', 'project', r.project.id, d.before, d.after);
        }
      }
      return projectView(tx, actor, r.project.id);
    }, actor.userId);
  }

  /** The cockpit. */
  @Get(':id')
  @Perm('project.read')
  async get(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => projectView(tx, actor, id));
  }

  @Put(':id')
  @Perm('project.write')
  async update(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProject(tx, actor, id, 'project.write');
      if (b.version !== undefined && b.version !== p.version) throw conflict('the project was changed by someone else — reload');
      const { version: _v, ...patch } = b;
      if ((patch.clockMinDays ?? p.clockMinDays) > (patch.clockMaxDays ?? p.clockMaxDays)) throw badRequest('the minimum delivery window cannot exceed the maximum');
      if (patch.requiredApprovals && p.stage !== 'kickoff') assertProject(actor, 'project.override', p);
      if (patch.status === 'cancelled' && p.status !== 'cancelled') assertProject(actor, 'project.override', p);
      if (p.status === 'closed' && patch.status) throw badRequest('a closed project cannot change status');
      const d = diff(p as Record<string, unknown>, patch as Record<string, unknown>);
      if (!d) return projectView(tx, actor, id);
      if (patch.templateKey && patch.templateKey !== p.templateKey) await applyTemplateTasks(tx, id, patch.templateKey as TemplateKey, actor.userId, true);
      await tx.update(project).set({ ...patch, ...touch(actor), version: p.version + 1 }).where(eq(project.id, id));
      await audit(tx, actor, 'update', 'project', id, d.before, d.after);
      return projectView(tx, actor, id);
    }, actor.userId);
  }

  /** Move to the next stage when its gate passes; overriding a failed gate needs project.override + a reason. */
  @Post(':id/advance')
  @Perm('project.write')
  async advance(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(advanceSchema)) b: z.infer<typeof advanceSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProject(tx, actor, id, 'project.write');
      if (p.status !== 'active') throw badRequest(`the project is ${p.status}`);
      if (p.stage === 'closed') throw badRequest('the project is closed');
      const { facts } = await loadFacts(tx, p);
      const gate = gateFor(p.stage as ProjectStage, facts);
      const failed = gate.checks.filter((c) => !c.ok);
      if (failed.length) {
        if (!b?.override) throw badRequest('the stage gate is not met', { gate, failed });
        if (!actor.grants['project.override']) throw forbidden('overriding a stage gate requires project.override');
        assertProject(actor, 'project.override', p);
        if (!b.reason?.trim()) throw badRequest('a reason is required to override a stage gate');
      }
      const to = gate.to;
      const today = riyadhDate();
      const patch: Partial<ProjectRow> = { stage: to };
      if (p.stage === 'kickoff') patch.clockStartedOn = p.clockStartedOn ?? clockStartDate(facts) ?? today;
      if (to === 'handover') patch.deliveredOn = p.deliveredOn ?? today;
      let warrantyAssets = 0;
      if (to === 'warranty') {
        if (!p.acceptedOn) throw badRequest('record the client acceptance first — the warranty starts on the acceptance date');
        const ends = warrantyEnds(p.acceptedOn, p.warrantyLabourMonths, p.warrantyPartsMonths);
        const upd = await tx.update(installedAsset).set({ labourWarrantyEnd: ends.labourEnd, partsWarrantyEnd: ends.partsEnd, updatedAt: new Date(), updatedBy: actor.userId })
          .where(and(eq(installedAsset.projectId, id), eq(installedAsset.status, 'active'))).returning({ id: installedAsset.id });
        warrantyAssets = upd.length;
      }
      if (to === 'closed') patch.status = 'closed';
      await tx.update(project).set({ ...patch, ...touch(actor), version: p.version + 1 }).where(eq(project.id, id));
      const overridden = failed.map((c) => c.key);
      await tx.insert(projectStageLog).values({ projectId: id, fromStage: p.stage, toStage: to, overriddenChecks: overridden, reason: b?.reason?.trim() || null, by: actor.userId });
      await audit(tx, actor, overridden.length ? 'stage_override' : 'stage_advance', 'project', id, { stage: p.stage },
        { stage: to, overriddenChecks: overridden, ...(patch.clockStartedOn && !p.clockStartedOn ? { clockStartedOn: patch.clockStartedOn } : {}), ...(warrantyAssets ? { warrantyAssets } : {}) }, b?.reason?.trim() || undefined);
      await emit(tx, 'project', id, 'project.stage_changed', { number: p.number, from: p.stage, to, overridden });
      return projectView(tx, actor, id);
    }, actor.userId);
  }

  /** Move back one stage (corrections) — project.override and a reason. */
  @Post(':id/stage')
  @Perm('project.override')
  async stageBack(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ to: zStage, reason: zText(1000) }))) b: { to: ProjectStage; reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProject(tx, actor, id, 'project.override');
      const i = PROJECT_STAGES.indexOf(p.stage as ProjectStage);
      if (PROJECT_STAGES.indexOf(b.to) !== i - 1) throw badRequest('a project can only be moved back one stage — use advance to move forward');
      const patch: Partial<ProjectRow> = { stage: b.to };
      if (p.stage === 'handover') patch.deliveredOn = null; // the clock runs again
      if (b.to === 'kickoff') patch.clockStartedOn = null;
      if (p.stage === 'closed') patch.status = 'active';
      await tx.update(project).set({ ...patch, ...touch(actor), version: p.version + 1 }).where(eq(project.id, id));
      await tx.insert(projectStageLog).values({ projectId: id, fromStage: p.stage, toStage: b.to, reason: b.reason, by: actor.userId });
      await audit(tx, actor, 'stage_back', 'project', id, { stage: p.stage }, { stage: b.to }, b.reason);
      await emit(tx, 'project', id, 'project.stage_changed', { number: p.number, from: p.stage, to: b.to, back: true });
      return projectView(tx, actor, id);
    }, actor.userId);
  }

  // ---- client approval packages (PRJ-20) ----

  @Post(':id/approvals')
  @Perm('project.write')
  async addApproval(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(approvalSchema)) b: z.infer<typeof approvalSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadProject(tx, actor, id, 'project.write');
      if (b.kind !== 'other') {
        const [open] = await tx.select({ id: projectApproval.id }).from(projectApproval).where(and(eq(projectApproval.projectId, id), eq(projectApproval.kind, b.kind), ne(projectApproval.status, 'superseded')));
        if (open) throw conflict('an approval of this kind already exists — revise it instead');
      }
      const [a] = await tx.insert(projectApproval).values({ projectId: id, kind: b.kind, title: b.title, notes: b.notes ?? null, fileIds: b.fileIds ?? [], createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'project_approval', a!.id, null, { kind: b.kind, title: b.title });
      return a!;
    }, actor.userId);
  }

  @Post('approvals/:aid/send')
  @Perm('project.write')
  async sendApproval(@Actor() actor: RequestActor, @Param('aid') aid: string) {
    return this.approvalStep(actor, aid, ['draft'], 'sent', {});
  }

  @Post('approvals/:aid/approve')
  @Perm('project.write')
  async approve(@Actor() actor: RequestActor, @Param('aid') aid: string, @Body(new ZodPipe(z.object({ approvedOn: zDate.nullish(), approvedByName: zText(200) }))) b: { approvedOn?: string | null; approvedByName: string }) {
    const on = b.approvedOn ?? riyadhDate();
    if (on > riyadhDate()) throw badRequest('the approval date cannot be in the future');
    return this.approvalStep(actor, aid, ['draft', 'sent'], 'approved', { approvedOn: on, approvedByName: b.approvedByName, rejectionReason: null });
  }

  @Post('approvals/:aid/reject')
  @Perm('project.write')
  async reject(@Actor() actor: RequestActor, @Param('aid') aid: string, @Body(new ZodPipe(z.object({ reason: zText(1000) }))) b: { reason: string }) {
    return this.approvalStep(actor, aid, ['draft', 'sent'], 'rejected', { rejectionReason: b.reason });
  }

  /** New revision of a package (the old one becomes superseded and stops counting). */
  @Post('approvals/:aid/revise')
  @Perm('project.write')
  async revise(@Actor() actor: RequestActor, @Param('aid') aid: string, @Body(new ZodPipe(z.object({ title: zText(200).optional(), notes: z.string().max(5000).nullish(), fileIds: z.array(zUuid).max(50).optional() }).nullish())) b: { title?: string; notes?: string | null; fileIds?: string[] } | null | undefined) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { a } = await this.loadApproval(tx, actor, aid);
      if (a.status === 'superseded') throw badRequest('this revision is already superseded');
      const [maxRev] = await tx.select({ r: sql<number>`max(${projectApproval.revision})::int` }).from(projectApproval)
        .where(and(eq(projectApproval.projectId, a.projectId), eq(projectApproval.kind, a.kind), a.kind === 'other' ? eq(projectApproval.title, a.title) : undefined));
      await tx.update(projectApproval).set({ status: 'superseded', ...touch(actor), version: a.version + 1 }).where(eq(projectApproval.id, aid));
      const [n] = await tx.insert(projectApproval).values({
        projectId: a.projectId, kind: a.kind, title: b?.title ?? a.title, revision: (maxRev?.r ?? a.revision) + 1, notes: b?.notes !== undefined ? b.notes : a.notes,
        fileIds: b?.fileIds ?? a.fileIds, createdBy: actor.userId, updatedBy: actor.userId,
      }).returning();
      await audit(tx, actor, 'revise', 'project_approval', n!.id, { id: aid, revision: a.revision, status: a.status }, { revision: n!.revision });
      return n!;
    }, actor.userId);
  }

  // ---- delivery clock: pauses and extensions (PRJ-04) ----

  @Post(':id/pauses')
  @Perm('project.write')
  async addPause(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(pauseSchema)) b: z.infer<typeof pauseSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadProject(tx, actor, id, 'project.write');
      if (b.toDate && b.toDate < b.fromDate) throw badRequest('the pause ends before it starts');
      const [open] = await tx.select({ id: projectClockPause.id }).from(projectClockPause).where(and(eq(projectClockPause.projectId, id), isNull(projectClockPause.toDate)));
      if (open && !b.toDate) throw conflict('a pause is already open — end it first');
      const [x] = await tx.insert(projectClockPause).values({ projectId: id, fromDate: b.fromDate, toDate: b.toDate ?? null, kind: b.kind, reason: b.reason, createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'clock_pause', 'project', id, null, { pauseId: x!.id, from: b.fromDate, to: b.toDate ?? null, kind: b.kind }, b.reason);
      return projectView(tx, actor, id);
    }, actor.userId);
  }

  @Post('pauses/:pid/end')
  @Perm('project.write')
  async endPause(@Actor() actor: RequestActor, @Param('pid') pid: string, @Body(new ZodPipe(z.object({ toDate: zDate.nullish() }).nullish())) b: { toDate?: string | null } | null | undefined) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (!isUuid(pid)) throw notFound('pause');
      const [x] = await tx.select().from(projectClockPause).where(eq(projectClockPause.id, pid));
      if (!x) throw notFound('pause');
      await loadProject(tx, actor, x.projectId, 'project.write');
      if (x.toDate) throw badRequest('the pause has already ended');
      const to = b?.toDate ?? riyadhDate();
      if (to < x.fromDate) throw badRequest('the pause ends before it starts');
      await tx.update(projectClockPause).set({ toDate: to, ...touch(actor) }).where(eq(projectClockPause.id, pid));
      await audit(tx, actor, 'clock_resume', 'project', x.projectId, { pauseId: pid, toDate: null }, { toDate: to });
      return projectView(tx, actor, x.projectId);
    }, actor.userId);
  }

  /** Extend the delivery window (approved change order / documented delay). */
  @Post(':id/extend')
  @Perm('project.write')
  async extend(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ days: z.number().int().min(1).max(365), reason: zText(1000) }))) b: { days: number; reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProject(tx, actor, id, 'project.write');
      const next = p.clockExtensionDays + b.days;
      await tx.update(project).set({ clockExtensionDays: next, ...touch(actor), version: p.version + 1 }).where(eq(project.id, id));
      await audit(tx, actor, 'clock_extend', 'project', id, { clockExtensionDays: p.clockExtensionDays }, { clockExtensionDays: next, days: b.days }, b.reason);
      return projectView(tx, actor, id);
    }, actor.userId);
  }

  // ---- tasks (PRJ-10) ----

  @Post(':id/tasks')
  @Perm('project.write')
  async addTask(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(taskSchema)) b: z.infer<typeof taskSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProject(tx, actor, id, 'project.write');
      const stage = b.stage ?? p.stage;
      checkDates(b.startDate, b.dueDate);
      await checkDependency(tx, id, null, b.dependsOnId);
      const [mx] = await tx.select({ s: sql<number>`coalesce(max(${projectTask.sort}), -1)::int` }).from(projectTask).where(and(eq(projectTask.projectId, id), eq(projectTask.stage, stage)));
      const [t] = await tx.insert(projectTask).values({ projectId: id, stage, title: b.title, assigneeId: b.assigneeId ?? null, startDate: b.startDate ?? null, dueDate: b.dueDate ?? null, dependsOnId: b.dependsOnId ?? null, locationId: b.locationId ?? null, sort: b.sort ?? (mx?.s ?? -1) + 1, createdBy: actor.userId, updatedBy: actor.userId }).returning();
      return t!;
    }, actor.userId);
  }

  @Put('tasks/:tid')
  @Perm('project.write')
  async updateTask(@Actor() actor: RequestActor, @Param('tid') tid: string, @Body(new ZodPipe(taskUpdateSchema)) b: z.infer<typeof taskUpdateSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const t = await this.loadTask(tx, actor, tid);
      checkDates(b.startDate === undefined ? t.startDate : b.startDate, b.dueDate === undefined ? t.dueDate : b.dueDate);
      if (b.dependsOnId !== undefined) await checkDependency(tx, t.projectId, t.id, b.dependsOnId);
      const doneAt = b.status === undefined ? t.doneAt : b.status === 'done' ? t.doneAt ?? new Date() : null;
      const [n] = await tx.update(projectTask).set({ ...b, doneAt, ...touch(actor), version: t.version + 1 }).where(eq(projectTask.id, tid)).returning();
      const shifted = t.dueDate && b.dueDate && b.dueDate > t.dueDate ? await shiftDependents(tx, actor, t, t.dueDate, b.dueDate) : [];
      return { ...n!, shifted };
    }, actor.userId);
  }

  @Delete('tasks/:tid')
  @Perm('project.write')
  async deleteTask(@Actor() actor: RequestActor, @Param('tid') tid: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const t = await this.loadTask(tx, actor, tid);
      // dependents lose their predecessor (no FK on depends_on_id)
      await tx.update(projectTask).set({ dependsOnId: null, ...touch(actor) }).where(eq(projectTask.dependsOnId, tid));
      await tx.delete(projectTask).where(eq(projectTask.id, tid));
      await audit(tx, actor, 'delete', 'project_task', tid, { title: t.title, stage: t.stage, status: t.status }, null);
      return { ok: true };
    }, actor.userId);
  }

  // ---- snags (PRJ-24) ----

  @Post(':id/snags')
  @Perm('project.write')
  async addSnag(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(snagSchema)) b: z.infer<typeof snagSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadProject(tx, actor, id, 'project.write');
      const [s] = await tx.insert(snag).values({ projectId: id, description: b.description, locationId: b.locationId ?? null, assigneeId: b.assigneeId ?? null, dueDate: b.dueDate ?? null, photoFileIds: b.photoFileIds ?? [], createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'snag', s!.id, null, { project: id, description: b.description });
      return s!;
    }, actor.userId);
  }

  /** Mark fixed — project.write, or a technician (asset.write) the snag is assigned to. */
  @Post('snags/:sid/fix')
  @Perm('project.read')
  async fixSnag(@Actor() actor: RequestActor, @Param('sid') sid: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { s, p } = await this.loadSnag(tx, actor, sid, 'project.read');
      if (actor.grants['project.write']) assertProject(actor, 'project.write', p);
      else if (!(actor.grants['asset.write'] && s.assigneeId === actor.userId)) throw forbidden('marking a snag fixed requires project.write or being its assignee');
      if (s.status !== 'open') throw badRequest(`the snag is ${s.status}`);
      const [n] = await tx.update(snag).set({ status: 'fixed', fixedAt: new Date(), ...touch(actor) }).where(eq(snag.id, sid)).returning();
      await audit(tx, actor, 'snag_fixed', 'snag', sid, { status: s.status }, { status: 'fixed' });
      return n!;
    }, actor.userId);
  }

  @Post('snags/:sid/verify')
  @Perm('project.write')
  async verifySnag(@Actor() actor: RequestActor, @Param('sid') sid: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { s } = await this.loadSnag(tx, actor, sid, 'project.write');
      if (s.status !== 'fixed') throw badRequest('only a fixed snag can be verified');
      const [n] = await tx.update(snag).set({ status: 'verified', verifiedAt: new Date(), verifiedBy: actor.userId, ...touch(actor) }).where(eq(snag.id, sid)).returning();
      await audit(tx, actor, 'snag_verified', 'snag', sid, { status: s.status }, { status: 'verified' });
      return n!;
    }, actor.userId);
  }

  @Post('snags/:sid/reopen')
  @Perm('project.write')
  async reopenSnag(@Actor() actor: RequestActor, @Param('sid') sid: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().max(1000).nullish() }).nullish())) b: { reason?: string | null } | null | undefined) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { s } = await this.loadSnag(tx, actor, sid, 'project.write');
      if (s.status === 'open') throw badRequest('the snag is already open');
      const [n] = await tx.update(snag).set({ status: 'open', fixedAt: null, verifiedAt: null, verifiedBy: null, ...touch(actor) }).where(eq(snag.id, sid)).returning();
      await audit(tx, actor, 'snag_reopened', 'snag', sid, { status: s.status }, { status: 'open' }, b?.reason ?? undefined);
      return n!;
    }, actor.userId);
  }

  // ---- acceptance and handover (PRJ-30/32) ----

  @Post(':id/accept')
  @Perm('project.write')
  async accept(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ acceptedOn: zDate, acceptedByName: zText(200), fileId: zUuid.nullish() }))) b: { acceptedOn: string; acceptedByName: string; fileId?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const p = await loadProject(tx, actor, id, 'project.write');
      if (p.stage !== 'handover') throw badRequest('acceptance is recorded in the handover stage');
      if (b.acceptedOn > riyadhDate()) throw badRequest('the acceptance date cannot be in the future');
      if (p.deliveredOn && b.acceptedOn < p.deliveredOn) throw badRequest('the acceptance date is before the handover stage was reached');
      await tx.update(project).set({ acceptedOn: b.acceptedOn, acceptedByName: b.acceptedByName, acceptanceFileId: b.fileId ?? null, ...touch(actor), version: p.version + 1 }).where(eq(project.id, id));
      await audit(tx, actor, 'accept', 'project', id, { acceptedOn: p.acceptedOn, acceptedByName: p.acceptedByName }, { acceptedOn: b.acceptedOn, acceptedByName: b.acceptedByName, fileId: b.fileId ?? null });
      await emit(tx, 'project', id, 'project.accepted', { number: p.number, acceptedOn: b.acceptedOn });
      return projectView(tx, actor, id);
    }, actor.userId);
  }

  /** Handover package as HTML (preview in the browser; needs asset.read for the device schedule). */
  @Get(':id/handover')
  @Perm('project.read')
  async handoverHtml(@Actor() actor: RequestActor, @Param('id') id: string, @Res() res: Response) {
    const html = await tenantTx(actor.tenantId, async (tx) => renderHandoverHtml(await handoverDoc(tx, actor, id)));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get(':id/handover.pdf')
  @Perm('project.read')
  async handoverPdf(@Actor() actor: RequestActor, @Param('id') id: string, @Res() res: Response) {
    const doc = await tenantTx(actor.tenantId, (tx) => handoverDoc(tx, actor, id));
    const pdf = await htmlToPdf(renderHandoverHtml(doc), config.gotenbergUrl);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.project.number}-handover.pdf"`);
    res.send(pdf);
  }

  // ---- helpers ----

  private async loadApproval(tx: Tx, actor: RequestActor, aid: string) {
    if (!isUuid(aid)) throw notFound('approval');
    const [a] = await tx.select().from(projectApproval).where(eq(projectApproval.id, aid));
    if (!a) throw notFound('approval');
    const p = await loadProject(tx, actor, a.projectId, 'project.write');
    return { a, p };
  }

  private approvalStep(actor: RequestActor, aid: string, from: string[], to: string, set: Partial<typeof projectApproval.$inferInsert>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { a } = await this.loadApproval(tx, actor, aid);
      return decideApproval(tx, actor, a, from, to, set);
    }, actor.userId);
  }

  private async loadTask(tx: Tx, actor: RequestActor, tid: string) {
    if (!isUuid(tid)) throw notFound('task');
    const [t] = await tx.select().from(projectTask).where(eq(projectTask.id, tid));
    if (!t) throw notFound('task');
    await loadProject(tx, actor, t.projectId, 'project.write');
    return t;
  }

  private async loadSnag(tx: Tx, actor: RequestActor, sid: string, perm: 'project.read' | 'project.write') {
    if (!isUuid(sid)) throw notFound('snag');
    const [s] = await tx.select().from(snag).where(eq(snag.id, sid));
    if (!s) throw notFound('snag');
    const p = await loadProject(tx, actor, s.projectId, perm);
    return { s, p };
  }
}
