import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import {
  agreementVisit, and, asc, attachment, auditLog, desc, emit, eq, file, gte, inArray, installedAsset, invoiceMirror, isNull, nextNumber, or, party, paymentRequest, portalAccount, portalOtp, portalSession,
  project, projectApproval, serviceAgreement, site, sql, ticket, withTenant, workOrder, type Tx,
} from '@mmc/db';
import { APPROVAL_LABELS, halalasToFixed, OTP_MAX_ATTEMPTS, toHalalas, OTP_TTL_MINUTES, PROJECT_STAGE_LABELS, gateFor, normalizeSaudiMobile, riyadhDate, type ApprovalKind, type ProjectStage } from '@mmc/domain';
import { audit } from '../common/audit.js';
import { getDb } from '../common/db.js';
import { badRequest, forbidden, notFound } from '../common/errors.js';
import { storeFile } from '../common/files.js';
import { sendTemplate } from '../common/messaging.js';
import { config } from '../config.js';
import { coverageFor, locationPaths, reportToken, userNames } from './field-service.service.js';
import { decideApproval, loadFacts, projectClock } from './projects.service.js';
import { csatUrl, dispatcherIds, ensureServiceTemplates, notifyUsers, slaDue, ticketSla, tierInfo } from './service.service.js';

/**
 * Customer portal (module 11 §3.2, POR-01/05..09). Customers sign in with a WhatsApp code and get an
 * opaque httpOnly cookie (`mmc_portal`); they never get a staff session. Every query here is bound to
 * the signed-in account's customer (party) — never cost, margin, internal notes or staff-only fields.
 */

export const PORTAL_COOKIE = 'mmc_portal';
export const SESSION_DAYS = 7;
const OTP_PER_WINDOW = 3;

export type PortalAccountRow = typeof portalAccount.$inferSelect;
export interface PortalCtx { tenantId: string; sessionId: string; account: PortalAccountRow; partyId: string; partyName: string; siteIds: string[] }

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const otpHash = (code: string, phone: string, tenantId: string) => sha256(`portal:${code}:${phone}:${tenantId}:${config.authSecret}`);

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function clientIp(req: Request) {
  return (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null;
}

const unauthenticated = () => new UnauthorizedException({ error: 'unauthenticated', message: 'portal sign-in required' });

export async function defaultTenant(): Promise<string> {
  const rows = await getDb().execute<{ t: string }>(sql`select default_tenant() as t`);
  if (!rows[0]?.t) throw new Error('no tenant');
  return rows[0].t;
}

/** In-memory per-IP limiter for the login endpoints (same approach as the public lead form). */
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw forbidden('too many attempts — try again in a few minutes');
  hits.set(key, [...recent, now]);
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
}

// ───────────────────────── session ─────────────────────────

/** Cookie → sha256 → tenant (SECURITY DEFINER look-up) → session + active account → party scope. */
export async function withPortal<T>(req: Request, fn: (tx: Tx, ctx: PortalCtx) => Promise<T>): Promise<T> {
  const token = readCookie(req, PORTAL_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw unauthenticated();
  const hash = sha256(token);
  const rows = await getDb().execute<{ t: string | null }>(sql`select tenant_for_portal_session(${hash}) as t`);
  const tenantId = rows[0]?.t;
  if (!tenantId) throw unauthenticated();
  return withTenant(getDb(), tenantId, async (tx) => {
    const [s] = await tx.select().from(portalSession).where(and(eq(portalSession.tokenHash, hash), isNull(portalSession.revokedAt), sql`${portalSession.expiresAt} > now()`));
    if (!s) throw unauthenticated();
    const [acc] = await tx.select().from(portalAccount).where(and(eq(portalAccount.id, s.accountId), eq(portalAccount.status, 'active')));
    if (!acc) throw unauthenticated();
    const [p] = await tx.select({ nameAr: party.nameAr }).from(party).where(eq(party.id, acc.partyId));
    if (!p) throw unauthenticated();
    const sites = await tx.select({ id: site.id }).from(site).where(and(eq(site.partyId, acc.partyId), isNull(site.archivedAt)));
    return fn(tx, { tenantId, sessionId: s.id, account: acc, partyId: acc.partyId, partyName: p.nameAr, siteIds: sites.map((x) => x.id) });
  });
}

// ───────────────────────── login ─────────────────────────

/** Always "sent" — never reveals whether the phone has an account. */
export async function requestLoginCode(phoneRaw: string) {
  const phone = normalizeSaudiMobile(phoneRaw);
  if (!phone) return { sent: true as const };
  const tenantId = await defaultTenant();
  await withTenant(getDb(), tenantId, async (tx) => {
    const accounts = await tx.select({ id: portalAccount.id, partyId: portalAccount.partyId }).from(portalAccount).where(and(eq(portalAccount.phone, phone), eq(portalAccount.status, 'active')));
    if (!accounts.length) return;
    const [recent] = await tx.select({ n: sql<number>`count(*)::int` }).from(portalOtp).where(and(eq(portalOtp.phone, phone), gte(portalOtp.createdAt, new Date(Date.now() - 10 * 60_000))));
    if ((recent?.n ?? 0) >= OTP_PER_WINDOW) return;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await tx.insert(portalOtp).values({ phone, codeHash: otpHash(code, phone, tenantId), expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) });
    await ensureServiceTemplates(tx);
    await sendTemplate(tx, { channel: 'whatsapp', to: phone, templateKey: 'portal_otp', vars: { code }, related: { type: 'portal_account', id: accounts[0]!.id }, link: { partyId: accounts.length === 1 ? accounts[0]!.partyId : null } });
    if (config.allowSandbox && !config.whatsapp.accessToken) console.log(`[otp:sandbox] portal → ${phone}: ${code}`);
  });
  return { sent: true as const };
}

export type VerifyResult =
  | { ok: true; token: string; expiresAt: Date; account: { id: string; name: string | null; phone: string }; party: { id: string; nameAr: string } }
  | { ok: false; needsSelection: true; accounts: { accountId: string; partyName: string }[] };

export async function verifyLoginCode(phoneRaw: string, code: string, accountId: string | null | undefined, meta: { ip: string | null; userAgent: string | null }): Promise<VerifyResult> {
  const phone = normalizeSaudiMobile(phoneRaw);
  if (!phone) throw badRequest('wrong code');
  const tenantId = await defaultTenant();
  // a wrong code must still count the attempt, so the failure is thrown after the transaction commits
  const r = await withTenant(getDb(), tenantId, async (tx): Promise<VerifyResult | { wrong: true }> => {
    const [otp] = await tx.select().from(portalOtp).where(and(eq(portalOtp.phone, phone), isNull(portalOtp.usedAt))).orderBy(desc(portalOtp.createdAt)).limit(1);
    if (!otp || otp.expiresAt < new Date()) throw badRequest('the code expired — request a new one');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw forbidden('too many wrong attempts — request a new code');
    const a = Buffer.from(otpHash(code, phone, tenantId));
    const e = Buffer.from(otp.codeHash);
    if (a.length !== e.length || !timingSafeEqual(a, e)) {
      await tx.update(portalOtp).set({ attempts: otp.attempts + 1 }).where(eq(portalOtp.id, otp.id));
      return { wrong: true as const };
    }
    const accounts = await tx.select({ id: portalAccount.id, partyId: portalAccount.partyId, name: portalAccount.name, phone: portalAccount.phone, partyName: party.nameAr })
      .from(portalAccount).innerJoin(party, eq(party.id, portalAccount.partyId)).where(and(eq(portalAccount.phone, phone), eq(portalAccount.status, 'active'))).orderBy(asc(party.nameAr));
    if (!accounts.length) throw badRequest('wrong code');
    let acc = accounts[0]!;
    if (accounts.length > 1) {
      // the code stays valid until the customer picks which company to open
      if (!accountId) return { ok: false as const, needsSelection: true as const, accounts: accounts.map((x) => ({ accountId: x.id, partyName: x.partyName })) };
      const chosen = accounts.find((x) => x.id === accountId);
      if (!chosen) throw badRequest('choose one of the listed accounts');
      acc = chosen;
    }
    await tx.update(portalOtp).set({ usedAt: new Date() }).where(eq(portalOtp.id, otp.id));
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await tx.insert(portalSession).values({ accountId: acc.id, tokenHash: sha256(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) ?? null });
    await tx.update(portalAccount).set({ lastLoginAt: new Date() }).where(eq(portalAccount.id, acc.id));
    await audit(tx, null, 'portal_login', 'portal_account', acc.id, null, { phone, ip: meta.ip });
    return { ok: true as const, token, expiresAt, account: { id: acc.id, name: acc.name, phone: acc.phone }, party: { id: acc.partyId, nameAr: acc.partyName } };
  });
  if ('wrong' in r) throw badRequest('wrong code');
  return r;
}

export async function logout(req: Request) {
  const token = readCookie(req, PORTAL_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return;
  const hash = sha256(token);
  const rows = await getDb().execute<{ t: string | null }>(sql`select tenant_for_portal_session(${hash}) as t`);
  if (!rows[0]?.t) return;
  await withTenant(getDb(), rows[0].t, (tx) => tx.update(portalSession).set({ revokedAt: new Date() }).where(eq(portalSession.tokenHash, hash)));
}

// ───────────────────────── data (always party-bound) ─────────────────────────

const assetOfParty = (c: PortalCtx) => or(eq(installedAsset.partyId, c.partyId), c.siteIds.length ? inArray(installedAsset.siteId, c.siteIds) : undefined);
const portalFileUrl = (id: string) => `/api/portal/files/${id}`;

export async function me(tx: Tx, c: PortalCtx) {
  const sites = await tx.select({ id: site.id, name: site.name, type: site.type, city: site.city, district: site.district }).from(site).where(and(eq(site.partyId, c.partyId), isNull(site.archivedAt))).orderBy(asc(site.name));
  return { account: { id: c.account.id, name: c.account.name, phone: c.account.phone, lastLoginAt: c.account.lastLoginAt }, party: { id: c.partyId, nameAr: c.partyName }, sites };
}

type AssetRow = typeof installedAsset.$inferSelect;
async function deviceRows(tx: Tx, rows: AssetRow[]) {
  const paths = await locationPaths(tx, rows.map((r) => r.locationId));
  const sIds = [...new Set(rows.map((r) => r.siteId).filter((x): x is string => !!x))];
  const sites = sIds.length ? await tx.select({ id: site.id, name: site.name }).from(site).where(inArray(site.id, sIds)) : [];
  const today = riyadhDate();
  const out = [];
  for (const a of rows) {
    const cov = await coverageFor(tx, { asset: a, today });
    out.push({
      id: a.id, code: a.code, description: a.description, serial: a.serial, mac: a.mac, status: a.status, installedOn: a.installedOn,
      siteId: a.siteId, siteName: sites.find((s) => s.id === a.siteId)?.name ?? null, locationPath: a.locationId ? paths.get(a.locationId) ?? null : null,
      warranty: { labourEnd: a.labourWarrantyEnd, partsEnd: a.partsWarrantyEnd, manufacturerEnd: a.manufacturerWarrantyEnd },
      coverageToday: { coverage: cov.coverage, reasonAr: cov.reasonAr, reasonEn: cov.reasonEn, agreementNumber: cov.agreementNumber, date: today },
    });
  }
  return out;
}

export async function devices(tx: Tx, c: PortalCtx, siteId?: string) {
  if (siteId && !c.siteIds.includes(siteId)) throw notFound('site');
  const rows = await tx.select().from(installedAsset).where(and(assetOfParty(c), eq(installedAsset.status, 'active'), siteId ? eq(installedAsset.siteId, siteId) : undefined))
    .orderBy(asc(installedAsset.siteId), asc(installedAsset.code), asc(installedAsset.serial)).limit(1000);
  return { rows: await deviceRows(tx, rows) };
}

async function loadDevice(tx: Tx, c: PortalCtx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('device');
  const [a] = await tx.select().from(installedAsset).where(and(eq(installedAsset.id, id), assetOfParty(c)));
  if (!a) throw notFound('device');
  return a;
}

export async function device(tx: Tx, c: PortalCtx, id: string) {
  const a = await loadDevice(tx, c, id);
  const [d] = await deviceRows(tx, [a]);
  const tks = await tx.select({ id: ticket.id, number: ticket.number, subject: ticket.subject, status: ticket.status, createdAt: ticket.createdAt }).from(ticket).where(and(eq(ticket.assetId, id), eq(ticket.partyId, c.partyId))).orderBy(desc(ticket.createdAt));
  const wos = await tx.select().from(workOrder).where(and(or(eq(workOrder.assetId, id), a.workOrderId ? eq(workOrder.id, a.workOrderId) : undefined), sql`${workOrder.status} <> 'cancelled'`)).orderBy(desc(workOrder.createdAt));
  return { ...d!, tickets: tks, serviceHistory: wos.map((w) => workOrderPublic(c, w)) };
}

function workOrderPublic(c: PortalCtx, w: typeof workOrder.$inferSelect, techName?: string | null) {
  const done = ['completed', 'closed'].includes(w.status);
  return {
    id: w.id, number: w.number, type: w.type, status: w.status, title: w.title, scheduledStart: w.scheduledStart, scheduledEnd: w.scheduledEnd, completedAt: w.completedAt,
    ...(techName !== undefined ? { technicianName: techName } : {}),
    reportUrl: done && w.reportFileId ? `${config.publicBaseUrl}/api/field/public/reports/${reportToken(c.tenantId, w.id)}` : null,
    csatUrl: done && !w.csatAt ? csatUrl(c.tenantId, w.id) : null,
    csatScore: w.csatScore,
  };
}

// projects

function latestApprovals(rows: (typeof projectApproval.$inferSelect)[]) {
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return kinds.map((k) => rows.filter((r) => r.kind === k).sort((a, b) => b.revision - a.revision || +b.createdAt - +a.createdAt).find((r) => r.status !== 'superseded')).filter((r): r is NonNullable<typeof r> => !!r);
}

const clockSummary = (clock: Awaited<ReturnType<typeof projectClock>>['clock']) => ({
  started: clock.started, startDate: clock.startDate, elapsedDays: clock.elapsed, minDays: clock.minDays, maxDays: clock.maxDays, targetMin: clock.targetMin, targetMax: clock.targetMax, paused: clock.paused, level: clock.level,
});

async function partyProjects(tx: Tx, c: PortalCtx, id?: string) {
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw notFound('project');
  return tx.select().from(project).where(and(eq(project.partyId, c.partyId), sql`${project.status} <> 'cancelled'`, id ? eq(project.id, id) : undefined)).orderBy(desc(project.createdAt));
}

export async function projects(tx: Tx, c: PortalCtx) {
  const rows = await partyProjects(tx, c);
  const out = [];
  for (const p of rows) {
    const { facts, approvals } = await loadFacts(tx, p);
    const { clock } = await projectClock(tx, p, facts);
    out.push({
      id: p.id, number: p.number, name: p.name, stage: p.stage, stageLabel: PROJECT_STAGE_LABELS[p.stage as ProjectStage] ?? null, status: p.status,
      clock: clockSummary(clock), approvalsPending: latestApprovals(approvals).filter((a) => a.status === 'sent').length, acceptedOn: p.acceptedOn,
    });
  }
  return { rows: out };
}

export async function projectDetail(tx: Tx, c: PortalCtx, id: string) {
  const [p] = await partyProjects(tx, c, id);
  if (!p) throw notFound('project');
  const { facts, approvals } = await loadFacts(tx, p);
  const { clock } = await projectClock(tx, p, facts);
  const gate = gateFor(p.stage as ProjectStage, facts);
  const visible = latestApprovals(approvals).filter((a) => a.status !== 'draft');
  const fileIds = [...new Set(visible.flatMap((a) => a.fileIds))];
  const files = fileIds.length ? await tx.select({ id: file.id, filename: file.filename, mime: file.mime, size: file.size }).from(file).where(inArray(file.id, fileIds)) : [];
  const [s] = p.siteId ? await tx.select({ id: site.id, name: site.name, city: site.city }).from(site).where(eq(site.id, p.siteId)) : [];
  const wos = await tx.select().from(workOrder).where(and(eq(workOrder.projectId, p.id), sql`${workOrder.status} <> 'cancelled'`)).orderBy(desc(workOrder.createdAt));
  return {
    id: p.id, number: p.number, name: p.name, stage: p.stage, stageLabel: PROJECT_STAGE_LABELS[p.stage as ProjectStage] ?? null, status: p.status, site: s ?? null,
    clock: clockSummary(clock), acceptedOn: p.acceptedOn,
    nextStep: p.stage === 'closed' ? null : { to: gate.to, toLabel: PROJECT_STAGE_LABELS[gate.to] ?? null, pending: gate.checks.filter((x) => !x.ok).map((x) => ({ key: x.key, ar: x.ar, en: x.en })) },
    approvals: visible.map((a) => ({
      id: a.id, kind: a.kind, label: APPROVAL_LABELS[a.kind as ApprovalKind] ?? null, title: a.title, revision: a.revision, status: a.status, notes: a.notes,
      approvedOn: a.approvedOn, approvedByName: a.approvedByName, rejectionReason: a.rejectionReason, canDecide: a.status === 'sent',
      files: a.fileIds.map((fid) => files.find((f) => f.id === fid)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ ...f, url: portalFileUrl(f.id) })),
    })),
    workOrders: wos.map((w) => workOrderPublic(c, w)),
  };
}

/** Customer decision on a sent approval package — same transition as the staff cockpit. */
export async function decide(tx: Tx, c: PortalCtx, projectId: string, approvalId: string, to: 'approved' | 'rejected', b: { approvedByName?: string; reason?: string }) {
  const [p] = await partyProjects(tx, c, projectId);
  if (!p) throw notFound('project');
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw notFound('approval');
  const [a] = await tx.select().from(projectApproval).where(and(eq(projectApproval.id, approvalId), eq(projectApproval.projectId, p.id)));
  if (!a || a.status === 'draft') throw notFound('approval');
  const set = to === 'approved'
    ? { approvedOn: riyadhDate(), approvedByName: b.approvedByName!, rejectionReason: null }
    : { rejectionReason: b.reason! };
  const n = await decideApproval(tx, null, a, ['sent'], to, set, 'portal');
  const label = APPROVAL_LABELS[a.kind as ApprovalKind]?.ar ?? a.kind;
  await notifyUsers(tx, [p.managerId, p.ownerId], {
    kind: 'project',
    titleAr: to === 'approved' ? `✅ اعتمد العميل (${b.approvedByName}) ${label} — ${p.number}` : `↩️ رفض العميل ${label} — ${p.number}: ${b.reason}`,
    link: `/projects/${p.id}`,
  });
  return { id: n.id, status: n.status, approvedOn: n.approvedOn, approvedByName: n.approvedByName, rejectionReason: n.rejectionReason };
}

// tickets

function ticketPublic(t: typeof ticket.$inferSelect, extra: { siteName?: string | null; asset?: { code: string; serial: string | null } | null } = {}) {
  return {
    id: t.id, number: t.number, channel: t.channel, subject: t.subject, description: t.description, status: t.status, priority: t.priority,
    coverage: t.coverage, coverageReason: t.coverageReason, createdAt: t.createdAt, resolvedAt: t.resolvedAt, siteId: t.siteId, assetId: t.assetId,
    siteName: extra.siteName ?? null, asset: extra.asset ?? null, sla: ticketSla(t),
  };
}

export async function tickets(tx: Tx, c: PortalCtx, status?: string) {
  const rows = await tx.select().from(ticket).where(and(eq(ticket.partyId, c.partyId), status ? inArray(ticket.status, status.split(',')) : undefined)).orderBy(desc(ticket.createdAt)).limit(200);
  const sIds = [...new Set(rows.map((r) => r.siteId).filter((x): x is string => !!x))];
  const aIds = [...new Set(rows.map((r) => r.assetId).filter((x): x is string => !!x))];
  const sites = sIds.length ? await tx.select({ id: site.id, name: site.name }).from(site).where(inArray(site.id, sIds)) : [];
  const assets = aIds.length ? await tx.select({ id: installedAsset.id, code: installedAsset.code, serial: installedAsset.serial }).from(installedAsset).where(inArray(installedAsset.id, aIds)) : [];
  return { rows: rows.map((t) => ticketPublic(t, { siteName: sites.find((s) => s.id === t.siteId)?.name ?? null, asset: assets.find((a) => a.id === t.assetId) ?? null })) };
}

const STATUS_LABEL: Record<string, { ar: string; en: string }> = {
  open: { ar: 'مفتوح', en: 'Open' }, in_progress: { ar: 'قيد المعالجة', en: 'In progress' }, resolved: { ar: 'تم الحل', en: 'Resolved' }, closed: { ar: 'مغلق', en: 'Closed' },
};

export async function ticketDetail(tx: Tx, c: PortalCtx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('ticket');
  const [t] = await tx.select().from(ticket).where(and(eq(ticket.id, id), eq(ticket.partyId, c.partyId)));
  if (!t) throw notFound('ticket');
  const [s] = t.siteId ? await tx.select({ name: site.name }).from(site).where(eq(site.id, t.siteId)) : [];
  const [a] = t.assetId ? await tx.select({ code: installedAsset.code, serial: installedAsset.serial }).from(installedAsset).where(eq(installedAsset.id, t.assetId)) : [];
  // customer-facing timeline: opened, status changes and staff replies (internal notes on status changes are not shown)
  const log = await tx.select({ at: auditLog.at, action: auditLog.action, after: auditLog.after }).from(auditLog).where(and(eq(auditLog.entityType, 'ticket'), eq(auditLog.entityId, id))).orderBy(asc(auditLog.at));
  type Entry = { at: Date; kind: 'opened' | 'status' | 'reply'; status?: string; note?: string; ar: string; en: string };
  const timeline = log.flatMap((l): Entry[] => {
    if (l.action === 'create') return [{ at: l.at, kind: 'opened', ar: 'تم فتح البلاغ', en: 'Ticket opened' }];
    if (l.action.startsWith('status_')) {
      const st = l.action.slice(7);
      return [{ at: l.at, kind: 'status', status: st, ar: STATUS_LABEL[st]?.ar ?? st, en: STATUS_LABEL[st]?.en ?? st }];
    }
    if (l.action === 'respond') return [{ at: l.at, kind: 'reply', note: String((l.after as { note?: unknown } | null)?.note ?? ''), ar: 'رد فريق الخدمة', en: 'Service team reply' }];
    return [];
  });
  const wos = await tx.select().from(workOrder).where(and(eq(workOrder.ticketId, id), sql`${workOrder.status} <> 'cancelled'`)).orderBy(desc(workOrder.createdAt));
  const names = await userNames(tx, wos.map((w) => w.technicianId));
  const photos = await tx.select({ id: file.id, filename: file.filename, mime: file.mime, size: file.size }).from(attachment).innerJoin(file, eq(file.id, attachment.fileId)).where(and(eq(attachment.entityType, 'ticket'), eq(attachment.entityId, id)));
  return {
    ...ticketPublic(t, { siteName: s?.name ?? null, asset: a ?? null }),
    timeline,
    workOrders: wos.map((w) => workOrderPublic(c, w, w.technicianId ? names.get(w.technicianId) ?? null : null)),
    photos: photos.map((f) => ({ ...f, url: portalFileUrl(f.id) })),
  };
}

export interface PortalTicketInput { siteId?: string | null; assetId?: string | null; subject: string; description?: string | null; photos?: { name: string; contentType: string; data: string }[] }

/** Service request from the portal: coverage + SLA like a staff ticket, dispatchers notified. */
export async function createTicket(tx: Tx, c: PortalCtx, b: PortalTicketInput) {
  const asset = b.assetId ? await loadDevice(tx, c, b.assetId) : null;
  const siteId = b.siteId ?? asset?.siteId ?? null;
  if (siteId && !c.siteIds.includes(siteId)) throw notFound('site');
  if (asset && b.siteId && asset.siteId !== b.siteId) throw badRequest('the device is on another site');
  const photos = (b.photos ?? []).map((p) => ({ ...p, buf: Buffer.from(p.data, 'base64') }));
  for (const p of photos) if (!p.buf.length || p.buf.length > 1_500_000) throw badRequest('each photo must be an image of at most 1.5 MB');
  const cov = await coverageFor(tx, { siteId, asset });
  const now = new Date();
  const { number } = await nextNumber(tx, 'ticket');
  const [t] = await tx.insert(ticket).values({
    createdAt: now, updatedAt: now, number, channel: 'portal', partyId: c.partyId, siteId, locationId: asset?.locationId ?? null, assetId: asset?.id ?? null,
    contactName: c.account.name, contactPhone: c.account.phone, subject: b.subject, description: b.description ?? null, priority: 'normal', status: 'open',
    coverage: cov.coverage, coverageReason: cov.reasonAr, agreementId: cov.agreementId, ...(await slaDue(tx, now, cov.sla)), portalAccountId: c.account.id,
  }).returning();
  for (const p of photos) {
    const f = await storeFile(tx, c.tenantId, p.buf, p.name, p.contentType, null);
    await tx.insert(attachment).values({ fileId: f.id, entityType: 'ticket', entityId: t!.id, label: 'portal_photo' });
  }
  await audit(tx, null, 'create', 'ticket', t!.id, null, { number, via: 'portal', portalAccountId: c.account.id, coverage: cov.coverage, agreement: cov.agreementNumber, photos: photos.length });
  await emit(tx, 'ticket', t!.id, 'ticket.created', { number, coverage: cov.coverage, channel: 'portal' });
  await notifyUsers(tx, await dispatcherIds(tx), { kind: 'ticket', titleAr: `🆕 بلاغ من بوابة العملاء ${number} — ${c.partyName}: ${b.subject}`, titleEn: `Portal ticket ${number}`, link: `/field/tickets/${t!.id}` });
  return ticketDetail(tx, c, t!.id);
}

// billing

const INVOICE_TYPE: Record<string, { ar: string; en: string }> = {
  '386': { ar: 'فاتورة دفعة مقدمة', en: 'Prepayment invoice' }, '388': { ar: 'فاتورة ضريبية', en: 'Tax invoice' }, '381': { ar: 'إشعار دائن', en: 'Credit note' }, '383': { ar: 'إشعار مدين', en: 'Debit note' },
};

export async function invoices(tx: Tx, c: PortalCtx) {
  const rows = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.partyId, c.partyId)).orderBy(desc(invoiceMirror.issueDate), desc(invoiceMirror.number));
  return {
    rows: rows.map((i) => ({
      id: i.id, number: i.number, typeCode: i.typeCode, typeLabel: INVOICE_TYPE[i.typeCode] ?? null, issueDate: i.issueDate, dueDate: i.dueDate,
      taxable: i.taxable, vatAmount: i.vatAmount, total: i.total, balanceDue: i.balanceDue, status: i.status, zatcaStatus: i.zatcaStatus, qrPayload: i.qrPayload,
      pdfUrl: i.pdfFileId ? portalFileUrl(i.pdfFileId) : null,
    })),
  };
}

export async function paymentRequests(tx: Tx, c: PortalCtx) {
  const rows = await tx.select({ pr: paymentRequest, agreementNumber: serviceAgreement.number }).from(paymentRequest).leftJoin(serviceAgreement, eq(serviceAgreement.id, paymentRequest.agreementId))
    .where(and(eq(paymentRequest.partyId, c.partyId), inArray(paymentRequest.status, ['sent', 'partially_paid']))).orderBy(asc(paymentRequest.dueDate));
  const contracts = await tx.execute<{ id: string; number: string }>(sql`select id::text as id, number from contract where party_id = ${c.partyId}::uuid`);
  const cn = new Map([...contracts].map((x) => [x.id, x.number]));
  return {
    rows: rows.map(({ pr, agreementNumber }) => ({
      id: pr.id, number: pr.number, amount: pr.amount, paidAmount: pr.paidAmount, due: halalasToFixed(toHalalas(pr.amount) - toHalalas(pr.paidAmount)), dueDate: pr.dueDate, status: pr.status,
      contractNumber: pr.contractId ? cn.get(pr.contractId) ?? null : null, agreementNumber, periodFrom: pr.periodFrom, periodTo: pr.periodTo,
      payUrl: pr.publicToken ? `${config.publicBaseUrl}/p/${pr.publicToken}` : null,
    })),
  };
}

export async function agreements(tx: Tx, c: PortalCtx) {
  const rows = await tx.select().from(serviceAgreement).where(and(eq(serviceAgreement.partyId, c.partyId), inArray(serviceAgreement.status, ['active', 'expired', 'renewed']))).orderBy(desc(serviceAgreement.endDate));
  const ids = rows.map((r) => r.id);
  const visits = ids.length ? await tx.select({ v: agreementVisit, woNumber: workOrder.number, woStatus: workOrder.status, scheduledStart: workOrder.scheduledStart }).from(agreementVisit).leftJoin(workOrder, eq(workOrder.id, agreementVisit.workOrderId))
    .where(and(inArray(agreementVisit.agreementId, ids), inArray(agreementVisit.status, ['planned', 'generated']))).orderBy(asc(agreementVisit.dueDate)) : [];
  const sIds = [...new Set(rows.flatMap((r) => r.siteIds))];
  const sites = sIds.length ? await tx.select({ id: site.id, name: site.name }).from(site).where(inArray(site.id, sIds)) : [];
  const renewals = ids.length ? await tx.select({ id: serviceAgreement.id, renewalOfId: serviceAgreement.renewalOfId, number: serviceAgreement.number, status: serviceAgreement.status, startDate: serviceAgreement.startDate, endDate: serviceAgreement.endDate, price: serviceAgreement.price })
    .from(serviceAgreement).where(and(inArray(serviceAgreement.renewalOfId, ids), inArray(serviceAgreement.status, ['draft', 'active']))) : [];
  const today = riyadhDate();
  return {
    rows: rows.map((a) => ({
      id: a.id, number: a.number, tier: tierInfo(a.tier), status: a.status, startDate: a.startDate, endDate: a.endDate,
      daysLeft: Math.max(0, Math.round((Date.parse(`${a.endDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)),
      coverage: { hours: a.coverage, responseHours: a.responseHours, resolutionHours: a.resolutionHours, visitsPerYear: a.visitsPerYear, partsIncluded: a.partsIncluded,
        sites: a.siteIds.map((sid) => sites.find((s) => s.id === sid)).filter((s): s is NonNullable<typeof s> => !!s), deviceCount: a.assetIds.length || null },
      price: a.price, billingFrequency: a.billingFrequency,
      nextVisits: visits.filter((v) => v.v.agreementId === a.id).slice(0, 5).map((v) => ({ dueDate: v.v.dueDate, status: v.v.status, siteName: sites.find((s) => s.id === v.v.siteId)?.name ?? null, workOrderNumber: v.woNumber, workOrderStatus: v.woStatus, scheduledStart: v.scheduledStart })),
      renewal: renewals.find((r) => r.renewalOfId === a.id) ?? null,
    })),
  };
}

/** A file the customer may see: approval package of their project, photo of their ticket, their invoice PDF. */
export async function portalFile(tx: Tx, c: PortalCtx, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const [hit] = await tx.execute<{ ok: number }>(sql`
    select 1 as ok where
      exists (select 1 from project_approval a join project p on p.id = a.project_id where p.party_id = ${c.partyId}::uuid and a.status <> 'draft' and a.file_ids @> ${JSON.stringify([id])}::jsonb)
      or exists (select 1 from attachment x join ticket t on t.id = x.entity_id where x.entity_type = 'ticket' and x.file_id = ${id}::uuid and t.party_id = ${c.partyId}::uuid)
      or exists (select 1 from invoice_mirror i where i.party_id = ${c.partyId}::uuid and i.pdf_file_id = ${id}::uuid)`);
  return !!hit;
}
