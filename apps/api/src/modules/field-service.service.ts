import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  and, appUser, contact, emit, eq, file, inArray, installedAsset, isNull, messageTemplate, or, party, product, project, role, site, siteLocation, sql, ticket, timeEntry, userRole, workOrder,
  type SQL, type Tx,
} from '@mmc/db';
import {
  canTransitionWorkOrder, decideCoverage, distanceMeters, GEOFENCE_RADIUS_M, missingForCompletion, normalizePhone, normalizeSaudiMobile, riyadhDate, scheduleWarnings, WORK_ORDER_STATUSES,
  type ScheduleWarning, type WorkOrderStatus, type WorkOrderType,
} from '@mmc/domain';
import { htmlToPdf, renderServiceReportHtml } from '@mmc/doc-templates';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { companyBlock, loadCompany } from '../common/company.js';
import { badRequest, forbidden, notFound } from '../common/errors.js';
import { readStoredFile, storeFile } from '../common/files.js';
import { config } from '../config.js';
import { loadCalendar } from './calendar.controller.js';

/**
 * Field service (module 06): installed base, helpdesk-lite tickets, work orders and the technician
 * app. Record scope for work orders: "own" means the actor is the lead technician, a crew member or
 * the owner of the work order (technicians hold workorder.read/write with scope "own").
 */

export type WorkOrderRow = typeof workOrder.$inferSelect;
export type TicketRow = typeof ticket.$inferSelect;
export type AssetRow = typeof installedAsset.$inferSelect;
type Perm = 'workorder.read' | 'workorder.write' | 'workorder.dispatch';

/** Statuses in which evidence (checklist, photos, parts, findings, signature) may still change. */
export const EDITABLE: WorkOrderStatus[] = ['new', 'scheduled', 'dispatched', 'en_route', 'on_site', 'awaiting_parts'];
export const OPEN_WO: WorkOrderStatus[] = ['new', 'scheduled', 'dispatched', 'en_route', 'on_site', 'awaiting_parts'];

// ───────────────────────── scope ─────────────────────────

const crewHas = (uid: string) => sql`${workOrder.crewIds} @> ${JSON.stringify([uid])}::jsonb`;
/** Actor is the lead technician or a crew member. */
export const assignedTo = (uid: string) => or(eq(workOrder.technicianId, uid), crewHas(uid))!;
const onWo = (uid: string) => or(eq(workOrder.technicianId, uid), eq(workOrder.ownerId, uid), crewHas(uid))!;

export function woFilter(actor: RequestActor, perm: Perm): SQL | undefined {
  const scope = actor.grants[perm];
  if (!scope) throw forbidden(`missing permission: ${perm}`);
  if (scope === 'all' || scope === 'company') return undefined;
  if (scope === 'branch') return actor.branchId ? or(eq(workOrder.branchId, actor.branchId), isNull(workOrder.branchId)) : undefined;
  if (scope === 'team' && actor.teamIds.length) return or(onWo(actor.userId), inArray(workOrder.teamId, actor.teamIds));
  return onWo(actor.userId);
}

export function canWo(actor: RequestActor, perm: Perm, wo: Pick<WorkOrderRow, 'technicianId' | 'crewIds' | 'ownerId' | 'teamId' | 'branchId'>): boolean {
  const scope = actor.grants[perm];
  if (!scope) return false;
  if (scope === 'all' || scope === 'company') return true;
  if (scope === 'branch') return !wo.branchId || wo.branchId === actor.branchId;
  const mine = wo.technicianId === actor.userId || wo.ownerId === actor.userId || (wo.crewIds ?? []).includes(actor.userId);
  if (scope === 'team') return mine || (!!wo.teamId && actor.teamIds.includes(wo.teamId));
  return mine;
}

export async function loadWo(tx: Tx, actor: RequestActor, id: string, perm: Perm) {
  const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, id));
  if (!wo) throw notFound('work order');
  if (!canWo(actor, perm, wo)) throw forbidden(`not allowed: ${perm}`);
  return wo;
}

/** Tickets: owner/team/branch as usual; "own" also covers tickets behind a work order the actor works on. */
export function ticketFilter(actor: RequestActor, perm: 'ticket.read' | 'ticket.write'): SQL | undefined {
  const scope = actor.grants[perm];
  if (!scope) throw forbidden(`missing permission: ${perm}`);
  if (scope === 'all' || scope === 'company') return undefined;
  if (scope === 'branch') return actor.branchId ? or(eq(ticket.branchId, actor.branchId), isNull(ticket.branchId)) : undefined;
  const uid = actor.userId;
  const viaWo = sql`exists (select 1 from work_order w where w.ticket_id = ${ticket.id} and (w.technician_id = ${uid} or w.crew_ids @> ${JSON.stringify([uid])}::jsonb))`;
  if (scope === 'team' && actor.teamIds.length) return or(eq(ticket.ownerId, uid), inArray(ticket.teamId, actor.teamIds), viaWo);
  return or(eq(ticket.ownerId, uid), viaWo);
}

export async function loadTicket(tx: Tx, actor: RequestActor, id: string, perm: 'ticket.read' | 'ticket.write') {
  const [t] = await tx.select().from(ticket).where(and(eq(ticket.id, id), ticketFilter(actor, perm)));
  if (!t) {
    const [exists] = await tx.select({ id: ticket.id }).from(ticket).where(eq(ticket.id, id));
    throw exists ? forbidden(`not allowed: ${perm}`) : notFound('ticket');
  }
  return t;
}

/** asset.write with scope "own": the actor registered the asset, or works on the work order that did. */
export async function assertAssetWrite(tx: Tx, actor: RequestActor, a: { createdBy: string | null; workOrderId: string | null }) {
  const scope = actor.grants['asset.write'];
  if (!scope) throw forbidden('missing permission: asset.write');
  if (scope !== 'own' && scope !== 'team') return;
  if (a.createdBy === actor.userId) return;
  if (a.workOrderId) {
    const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, a.workOrderId));
    if (wo && canWo(actor, 'workorder.write', wo)) return;
  }
  throw forbidden('not allowed: asset.write');
}

// ───────────────────────── transitions ─────────────────────────

export async function transition(tx: Tx, actor: RequestActor, wo: WorkOrderRow, to: WorkOrderStatus, set: Partial<typeof workOrder.$inferInsert> = {}, reason?: string) {
  if (!canTransitionWorkOrder(wo.status as WorkOrderStatus, to)) throw badRequest(`cannot move a work order from ${wo.status} to ${to}`, { from: wo.status, to });
  const now = new Date();
  await tx.update(workOrder).set({ ...set, status: to, updatedAt: now, updatedBy: actor.userId, version: wo.version + 1 }).where(eq(workOrder.id, wo.id));
  await audit(tx, actor, `status_${to}`, 'work_order', wo.id, { status: wo.status }, { status: to, ...pickAuditable(set) }, reason);
  await emit(tx, 'work_order', wo.id, `work_order.${to}`, { number: wo.number });
}

function pickAuditable(set: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(set)) if (v instanceof Date) out[k] = v.toISOString(); else if (typeof v !== 'object' || v === null || Array.isArray(v)) out[k] = v;
  return out;
}

export function allowedNext(status: string): WorkOrderStatus[] {
  return WORK_ORDER_STATUSES.filter((s) => canTransitionWorkOrder(status as WorkOrderStatus, s));
}

/** Close every open time entry of the work order (optionally only the actor's / one kind). */
export async function closeTimeEntries(tx: Tx, woId: string, opts: { userId?: string; kind?: 'travel' | 'work' } = {}) {
  const now = new Date();
  await tx.update(timeEntry).set({
    endedAt: now,
    hours: sql`round((extract(epoch from (${now.toISOString()}::timestamptz - ${timeEntry.startedAt})) / 3600)::numeric, 3)`,
    updatedAt: now,
  }).where(and(eq(timeEntry.workOrderId, woId), isNull(timeEntry.endedAt), opts.userId ? eq(timeEntry.userId, opts.userId) : undefined, opts.kind ? eq(timeEntry.kind, opts.kind) : undefined));
}

// ───────────────────────── coverage ─────────────────────────

/** A project in progress (stage before warranty/closed, not closed/cancelled) on the site or owning the asset. */
export async function projectInProgress(tx: Tx, siteId: string | null | undefined, projectId: string | null | undefined): Promise<boolean> {
  const conds = [siteId ? eq(project.siteId, siteId) : undefined, projectId ? eq(project.id, projectId) : undefined].filter((c): c is SQL => !!c);
  if (!conds.length) return false;
  const [p] = await tx.select({ id: project.id }).from(project).where(and(or(...conds), sql`${project.stage} not in ('warranty', 'closed')`, sql`${project.status} not in ('closed', 'cancelled')`)).limit(1);
  return !!p;
}

export async function coverageFor(tx: Tx, input: { siteId?: string | null; asset?: AssetRow | null; today?: string }) {
  const today = input.today ?? riyadhDate();
  const inProgress = await projectInProgress(tx, input.siteId ?? input.asset?.siteId, input.asset?.projectId);
  return decideCoverage({ today, projectInProgress: inProgress, asset: input.asset ?? null });
}

// ───────────────────────── look-ups ─────────────────────────

export async function userNames(tx: Tx, ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = uniq.length ? await tx.select({ id: appUser.id, nameAr: appUser.nameAr, email: appUser.email }).from(appUser).where(inArray(appUser.id, uniq)) : [];
  return new Map(rows.map((r) => [r.id, r.nameAr || r.email]));
}

/** "B1/F2/U203" for each location id (walks up the tree). */
export async function locationPaths(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const rows = await tx.execute<{ leaf: string; path: string }>(sql`
    with recursive up as (
      select id, parent_id, name, id as leaf, 0 as depth from site_location where id in (${sql.join(uniq.map((i) => sql`${i}::uuid`), sql`, `)})
      union all
      select l.id, l.parent_id, l.name, up.leaf, up.depth + 1 from site_location l join up on l.id = up.parent_id where up.depth < 20
    )
    select leaf::text as leaf, string_agg(name, '/' order by depth desc) as path from up group by leaf`);
  return new Map([...rows].map((r) => [r.leaf, r.path]));
}

export function navUrl(s: { mapLink?: string | null; lat?: string | null; lng?: string | null; buildingNumber?: string | null; street?: string | null; district?: string | null; city?: string | null } | null | undefined): string | null {
  if (!s) return null;
  if (s.mapLink) return s.mapLink;
  if (s.lat && s.lng) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.lat},${s.lng}`)}`;
  // no pin yet: let Google Maps search the national address
  const address = [s.buildingNumber, s.street, s.district, s.city].filter(Boolean).join('، ');
  return s.city && address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
}

/** List rows decorated with site/party/technician names and the location path. */
export async function decorateWorkOrders(tx: Tx, rows: WorkOrderRow[]) {
  const siteIds = [...new Set(rows.map((r) => r.siteId).filter((x): x is string => !!x))];
  const partyIds = [...new Set(rows.map((r) => r.partyId).filter((x): x is string => !!x))];
  const sites = siteIds.length ? await tx.select({ id: site.id, name: site.name, city: site.city, district: site.district, street: site.street, buildingNumber: site.buildingNumber, lat: site.lat, lng: site.lng, mapLink: site.mapLink }).from(site).where(inArray(site.id, siteIds)) : [];
  const parties = partyIds.length ? await tx.select({ id: party.id, nameAr: party.nameAr, phone: party.phone }).from(party).where(inArray(party.id, partyIds)) : [];
  const names = await userNames(tx, rows.flatMap((r) => [r.technicianId, ...(r.crewIds ?? [])]));
  const paths = await locationPaths(tx, rows.map((r) => r.locationId));
  return rows.map((r) => {
    const s = sites.find((x) => x.id === r.siteId) ?? null;
    const p = parties.find((x) => x.id === r.partyId) ?? null;
    return {
      id: r.id, number: r.number, type: r.type, status: r.status, title: r.title, coverage: r.coverage,
      projectId: r.projectId, ticketId: r.ticketId, partyId: r.partyId, siteId: r.siteId, locationId: r.locationId, assetId: r.assetId,
      technicianId: r.technicianId, crewIds: r.crewIds, scheduledStart: r.scheduledStart, scheduledEnd: r.scheduledEnd, checkInAt: r.checkInAt, completedAt: r.completedAt,
      outdoor: r.outdoor, scheduleWarnings: r.scheduleWarnings ?? [], checkInDistanceM: r.checkInDistanceM, checkInOutsideGeofence: r.checkInOutsideGeofence,
      partyName: p?.nameAr ?? null, siteName: s?.name ?? null, siteCity: s?.city ?? null, navUrl: navUrl(s), locationPath: r.locationId ? paths.get(r.locationId) ?? null : null,
      technicianName: r.technicianId ? names.get(r.technicianId) ?? null : null, crewNames: (r.crewIds ?? []).map((u) => names.get(u) ?? u),
    };
  });
}

export async function evidenceOf(tx: Tx, wo: WorkOrderRow) {
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(installedAsset).where(eq(installedAsset.workOrderId, wo.id))) as [{ n: number }];
  return missingForCompletion({ type: wo.type as WorkOrderType, checklist: wo.checklist, photoCount: wo.photoFileIds.length, assetsRegistered: n, signatureName: wo.signatureName, checkedIn: !!wo.checkInAt });
}

export async function workOrderView(tx: Tx, actor: RequestActor, id: string) {
  const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, id));
  if (!wo) throw notFound('work order');
  const [decorated] = await decorateWorkOrders(tx, [wo]);
  const photoFiles = wo.photoFileIds.length ? await tx.select({ id: file.id, filename: file.filename, mime: file.mime, size: file.size }).from(file).where(inArray(file.id, wo.photoFileIds)) : [];
  const photos = wo.photoFileIds.map((fid) => photoFiles.find((f) => f.id === fid)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ fileId: f.id, filename: f.filename, mime: f.mime, size: f.size, url: `/api/files/${f.id}` }));
  const assets = await tx.select().from(installedAsset).where(eq(installedAsset.workOrderId, id));
  const paths = await locationPaths(tx, assets.map((a) => a.locationId));
  const [t] = wo.ticketId ? await tx.select({ id: ticket.id, number: ticket.number, subject: ticket.subject, status: ticket.status, contactName: ticket.contactName, contactPhone: ticket.contactPhone, coverage: ticket.coverage }).from(ticket).where(eq(ticket.id, wo.ticketId)) : [];
  const [pr] = wo.projectId ? await tx.select({ id: project.id, number: project.number, name: project.name, stage: project.stage, status: project.status }).from(project).where(eq(project.id, wo.projectId)) : [];
  const [s] = wo.siteId ? await tx.select().from(site).where(eq(site.id, wo.siteId)) : [];
  const [p] = wo.partyId ? await tx.select({ id: party.id, nameAr: party.nameAr, phone: party.phone }).from(party).where(eq(party.id, wo.partyId)) : [];
  const [asset] = wo.assetId ? await tx.select({ id: installedAsset.id, code: installedAsset.code, serial: installedAsset.serial, mac: installedAsset.mac }).from(installedAsset).where(eq(installedAsset.id, wo.assetId)) : [];
  const times = await tx.select().from(timeEntry).where(eq(timeEntry.workOrderId, id)).orderBy(timeEntry.startedAt);
  const names = await userNames(tx, times.map((x) => x.userId));
  return {
    ...wo,
    ...decorated,
    photos,
    parts: wo.partsUsed,
    assets: assets.map((a) => ({ ...a, locationPath: a.locationId ? paths.get(a.locationId) ?? null : null })),
    ticket: t ?? null,
    project: pr ?? null,
    site: s ? { id: s.id, name: s.name, city: s.city, district: s.district, street: s.street, buildingNumber: s.buildingNumber, lat: s.lat, lng: s.lng, mapLink: s.mapLink, accessNotes: s.accessNotes } : null,
    party: p ?? null,
    asset: asset ?? null,
    timeEntries: times.map((x) => ({ ...x, userName: names.get(x.userId) ?? null })),
    missing: await evidenceOf(tx, wo),
    allowedTransitions: allowedNext(wo.status),
    reportUrl: wo.reportFileId ? `/api/files/${wo.reportFileId}` : null,
    canDispatch: !!actor.grants['workorder.dispatch'],
  };
}

// ───────────────────────── KSA scheduling rules (FSM-27 / FSM-49) ─────────────────────────

const num = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Soft scheduling warnings for a booking (non-business day, midday heat ban for outdoor work,
 * Ramadan hours, prayer times at the site — Jeddah when the site has no pin).
 * Ramadan dates come from the company calendar settings (`company.ramadanRanges`).
 */
export async function bookingWarnings(tx: Tx, input: { siteId: string | null; outdoor: boolean; start: Date | null; end: Date | null }): Promise<ScheduleWarning[]> {
  if (!input.start || !input.end) return [];
  const [s] = input.siteId ? await tx.select({ lat: site.lat, lng: site.lng }).from(site).where(eq(site.id, input.siteId)) : [];
  const lat = num(s?.lat);
  const lng = num(s?.lng);
  const hasPin = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const startDay = riyadhDate(input.start);
  const ramadan = ((await loadCompany(tx)).ramadanRanges ?? []).find((r) => r.from <= startDay && startDay <= r.to) ?? null;
  return scheduleWarnings({
    start: input.start, end: input.end, outdoor: input.outdoor, calendar: await loadCalendar(tx), ramadan,
    lat: hasPin ? lat : null, lng: hasPin ? lng : null,
  });
}

/** Check-in distance from the site pin (FSM-49) — flagged when outside the geofence, never blocked. */
export async function checkInGeofence(tx: Tx, siteId: string | null, lat: string | number | null | undefined, lng: string | number | null | undefined) {
  const la = num(lat);
  const ln = num(lng);
  const [s] = siteId ? await tx.select({ lat: site.lat, lng: site.lng }).from(site).where(eq(site.id, siteId)) : [];
  const sla = num(s?.lat);
  const sln = num(s?.lng);
  if (la === null || ln === null || sla === null || sln === null) return { checkInDistanceM: null, checkInOutsideGeofence: null };
  const d = Math.round(distanceMeters(la, ln, sla, sln));
  return { checkInDistanceM: d, checkInOutsideGeofence: d > GEOFENCE_RADIUS_M };
}

// ───────────────────────── tickets ─────────────────────────

/** FSM-81: match a caller by phone to one customer (party phone, or a contact's mobile/WhatsApp). */
export async function matchPartyByPhone(tx: Tx, phone: string | null | undefined): Promise<{ partyId: string; contactName: string | null } | null> {
  const norm = normalizePhone(phone ?? '');
  if (!norm) return null;
  const variants = [...new Set([norm, normalizeSaudiMobile(phone ?? '') ?? norm, phone!.trim()])];
  const viaParty = await tx.select({ id: party.id }).from(party).where(and(inArray(party.phone, variants), isNull(party.archivedAt)));
  const viaContact = await tx.select({ partyId: contact.partyId, name: contact.name }).from(contact).where(and(or(inArray(contact.mobile, variants), inArray(contact.whatsapp, variants)), isNull(contact.archivedAt)));
  const ids = new Set([...viaParty.map((p) => p.id), ...viaContact.map((c) => c.partyId).filter((x): x is string => !!x)]);
  if (ids.size !== 1) return null;
  const partyId = [...ids][0]!;
  return { partyId, contactName: viaContact.find((c) => c.partyId === partyId)?.name ?? null };
}

// ───────────────────────── installed base helpers ─────────────────────────

export async function loadSite(tx: Tx, siteId: string) {
  const [s] = await tx.select().from(site).where(eq(site.id, siteId));
  if (!s) throw notFound('site');
  return s;
}

export async function loadLocation(tx: Tx, id: string) {
  const [l] = await tx.select().from(siteLocation).where(eq(siteLocation.id, id));
  if (!l || l.archivedAt) throw notFound('location');
  return l;
}

/** Look a product up by code so registered devices link to the catalog. */
export async function productByCode(tx: Tx, code: string) {
  const [p] = await tx.select({ id: product.id, description: product.description, nameAr: product.nameAr }).from(product).where(eq(product.code, code)).limit(1);
  return p ?? null;
}

export async function duplicateAsset(tx: Tx, code: string, serial: string | null | undefined, exceptId?: string) {
  if (!serial) return null;
  const [d] = await tx.select({ id: installedAsset.id }).from(installedAsset).where(and(eq(installedAsset.code, code), eq(installedAsset.serial, serial), exceptId ? sql`${installedAsset.id} <> ${exceptId}` : undefined));
  return d ?? null;
}

const KIND_BY_DEPTH = ['building', 'floor', 'unit', 'room'];

/** Resolve "B1/F2/U203" under a site, creating missing nodes (cache keyed by parent + lower-cased name). */
export class LocationResolver {
  private cache = new Map<string, string>();
  created = 0;
  constructor(private readonly tx: Tx, private readonly siteId: string, private readonly actorId: string) {}
  async init() {
    const rows = await this.tx.select({ id: siteLocation.id, parentId: siteLocation.parentId, name: siteLocation.name }).from(siteLocation).where(and(eq(siteLocation.siteId, this.siteId), isNull(siteLocation.archivedAt)));
    for (const r of rows) this.cache.set(`${r.parentId ?? ''}/${r.name.trim().toLowerCase()}`, r.id);
    return this;
  }
  async child(parentId: string | null, name: string, kind: string): Promise<string> {
    const key = `${parentId ?? ''}/${name.trim().toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const [row] = await this.tx.insert(siteLocation).values({ siteId: this.siteId, parentId, kind, name: name.trim(), createdBy: this.actorId, updatedBy: this.actorId }).returning({ id: siteLocation.id });
    this.cache.set(key, row!.id);
    this.created++;
    return row!.id;
  }
  async path(path: string): Promise<string | null> {
    const parts = path.split('/').map((s) => s.trim()).filter(Boolean);
    let parent: string | null = null;
    for (let i = 0; i < parts.length; i++) parent = await this.child(parent, parts[i]!, KIND_BY_DEPTH[i] ?? 'other');
    return parent;
  }
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/** Thrown inside a transaction to roll it back while returning a value (dry runs). */
export class Rollback<T> extends Error {
  constructor(readonly value: T) { super('rollback'); }
}

// ───────────────────────── report ─────────────────────────

export async function renderServiceReport(tx: Tx, actor: RequestActor, woId: string) {
  const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, woId));
  if (!wo) throw notFound('work order');
  const [s] = wo.siteId ? await tx.select().from(site).where(eq(site.id, wo.siteId)) : [];
  const [p] = wo.partyId ? await tx.select({ nameAr: party.nameAr }).from(party).where(eq(party.id, wo.partyId)) : [];
  const [pr] = wo.projectId ? await tx.select({ number: project.number }).from(project).where(eq(project.id, wo.projectId)) : [];
  const [t] = wo.ticketId ? await tx.select({ number: ticket.number, contactName: ticket.contactName }).from(ticket).where(eq(ticket.id, wo.ticketId)) : [];
  const assets = await tx.select().from(installedAsset).where(eq(installedAsset.workOrderId, woId));
  const paths = await locationPaths(tx, [wo.locationId, ...assets.map((a) => a.locationId)]);
  const names = await userNames(tx, [wo.technicianId, ...wo.crewIds]);
  let signatureDataUrl: string | null = null;
  if (wo.signatureFileId) {
    const f = await readStoredFile(tx, wo.signatureFileId);
    if (f) signatureDataUrl = `data:${f.mime};base64,${f.data.toString('base64')}`;
  }
  const fmt = (d: Date | null) => (d ? `${riyadhDate(d)} ${new Date(d.getTime() + 3 * 3600_000).toISOString().slice(11, 16)}` : null);
  const html = renderServiceReportHtml({
    company: await companyBlock(tx),
    number: wo.number, type: wo.type, title: wo.title, description: wo.description,
    date: riyadhDate(wo.completedAt ?? new Date()),
    customerName: p?.nameAr ?? t?.contactName ?? null,
    siteName: s?.name ?? null,
    siteAddress: s ? [s.buildingNumber, s.street, s.district, s.city].filter(Boolean).join('، ') || null : null,
    locationPath: wo.locationId ? paths.get(wo.locationId) ?? null : null,
    projectNumber: pr?.number ?? null, ticketNumber: t?.number ?? null,
    coverage: wo.coverage, coverageReason: wo.coverageReason,
    technicianName: wo.technicianId ? names.get(wo.technicianId) ?? null : null,
    crewNames: wo.crewIds.map((u) => names.get(u) ?? '').filter(Boolean),
    checkInAt: fmt(wo.checkInAt), checkOutAt: fmt(wo.checkOutAt),
    checklist: wo.checklist, parts: wo.partsUsed,
    assets: assets.map((a) => ({ code: a.code, serial: a.serial, mac: a.mac, locationPath: a.locationId ? paths.get(a.locationId) ?? null : null })),
    findings: wo.findings, photoCount: wo.photoFileIds.length, signatureName: wo.signatureName, signatureDataUrl,
  });
  const pdf = await htmlToPdf(html, config.gotenbergUrl);
  const f = await storeFile(tx, actor.tenantId, pdf, `${wo.number}-service-report.pdf`, 'application/pdf', actor.userId);
  await tx.update(workOrder).set({ reportFileId: f.id, updatedAt: new Date() }).where(eq(workOrder.id, woId));
  await audit(tx, actor, 'service_report', 'work_order', woId, null, { fileId: f.id, sha256: f.sha256 });
  return f;
}

/** Signed, unguessable link to a work order's service report (customer-facing, no session). */
export function reportToken(tenantId: string, woId: string): string {
  const p = Buffer.from(`${tenantId}.${woId}`).toString('base64url');
  return `${p}.${sign(p)}`;
}

export function parseReportToken(token: string): { tenantId: string; woId: string } | null {
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const want = Buffer.from(sign(p));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [tenantId, woId] = Buffer.from(p, 'base64url').toString().split('.');
  const uuid = /^[0-9a-f-]{36}$/i;
  return tenantId && woId && uuid.test(tenantId) && uuid.test(woId) ? { tenantId, woId } : null;
}

function sign(p: string) {
  return createHmac('sha256', config.authSecret).update(`service-report:${p}`).digest('base64url').slice(0, 32);
}

export const SERVICE_REPORT_TEMPLATE = {
  key: 'service_report', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_service_report', variables: ['name', 'number', 'link'],
  body: 'مرحبًا {{name}}، تم إنجاز أمر العمل رقم {{number}} من المدى المبارك. تقرير الخدمة: {{link}}',
};

/** Tenants seeded before the template existed get it on first use (same values as the seed). */
export async function ensureServiceReportTemplate(tx: Tx) {
  await tx.insert(messageTemplate).values(SERVICE_REPORT_TEMPLATE).onConflictDoNothing();
}

/** Users who hold the technician role (dispatch-board lanes). */
export async function technicians(tx: Tx) {
  return tx.select({ id: appUser.id, nameAr: appUser.nameAr, email: appUser.email, status: appUser.status }).from(appUser)
    .innerJoin(userRole, eq(userRole.userId, appUser.id)).innerJoin(role, eq(role.id, userRole.roleId))
    .where(and(eq(role.key, 'technician'), sql`${appUser.status} <> 'suspended'`));
}

export function missingError(missing: { key: string; ar: string; en: string }[]) {
  return new BadRequestException({ error: 'bad_request', message: 'the work order cannot be completed yet', missing });
}

/** Riyadh day [start, end) as instants. */
export function riyadhDayRange(from: string, to: string = from) {
  const start = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(`${to}T00:00:00+03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
