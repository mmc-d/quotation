import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  and, asc, contact, desc, emit, eq, file, gte, ilike, inArray, installedAsset, isNull, lt, nextNumber, notification, or, party, project, site, siteLocation, sql, ticket, timeEntry, workOrder, type Tx,
} from '@mmc/db';
import { canTransitionWorkOrder, defaultChecklist, normalizeMac, normalizePhone, riyadhDate, TICKET_STATUSES, WORK_ORDER_TYPES, type WorkOrderStatus, type WorkOrderType } from '@mmc/domain';
import { Actor, Perm, Public, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { readStoredFile, storeFile } from '../common/files.js';
import { sendTemplate } from '../common/messaging.js';
import { ZodPipe, zDate, zPage, zQty, zUuid } from '../common/zod.js';
import { config } from '../config.js';
import { consumeForWorkOrder } from './inventory.service.js';
import {
  EDITABLE, LocationResolver, bookingWarnings, checkInGeofence, OPEN_WO, Rollback, assertAssetWrite, assignedTo, canWo, closeTimeEntries, coverageFor, decorateWorkOrders, duplicateAsset, ensureServiceReportTemplate, evidenceOf,
  loadLocation, loadSite, loadTicket, loadWo, locationPaths, matchPartyByPhone, missingError, parseCsv, parseReportToken, productByCode, renderServiceReport, reportToken, riyadhDayRange,
  technicians, ticketFilter, transition, userNames, woFilter, workOrderView, type AssetRow, type WorkOrderRow,
} from './field-service.service.js';

/**
 * Field service (module 06) under /api/field: location tree + installed base, helpdesk-lite tickets
 * with the coverage decision, work orders (dispatch board, technician app, completion stage gate,
 * bilingual service report sent by WhatsApp).
 */

const LOCATION_KINDS = ['building', 'floor', 'unit', 'room', 'riser', 'rack', 'gate', 'other'] as const;
const zText = (max = 2000) => z.string().trim().max(max);
const zInstant = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'ISO date-time').transform((v) => new Date(v));

const locationSchema = z.object({ parentId: zUuid.nullish(), kind: z.enum(LOCATION_KINDS).default('unit'), name: zText(120).min(1), sort: z.number().int().optional() });
const bulkSchema = z.object({
  building: zText(120).min(1),
  floors: z.number().int().min(1).max(200),
  unitsPerFloor: z.number().int().min(1).max(100),
  unitPrefix: zText(20).optional(),
  floorPrefix: zText(20).default('F'),
  firstFloor: z.number().int().min(-10).max(200).default(1),
});

const assetFields = {
  code: zText(100).min(1),
  productId: zUuid.nullish(),
  description: zText(500).nullish(),
  serial: zText(200).nullish(),
  mac: zText(60).nullish(),
  ip: zText(100).nullish(),
  firmware: zText(100).nullish(),
  attributes: z.record(z.string(), z.string()).default({}),
  locationId: zUuid.nullish(),
  siteId: zUuid.nullish(),
  projectId: zUuid.nullish(),
  parentAssetId: zUuid.nullish(),
  installedOn: zDate.nullish(),
  labourWarrantyEnd: zDate.nullish(),
  partsWarrantyEnd: zDate.nullish(),
  manufacturerWarrantyEnd: zDate.nullish(),
};
const assetCreateSchema = z.object({ ...assetFields, workOrderId: zUuid.nullish() });
const assetUpdateSchema = z.object({ ...assetFields, status: z.enum(['active', 'replaced', 'removed']).optional(), version: z.number().int().optional() });
type AssetInput = z.infer<typeof assetCreateSchema>;

const ticketFields = {
  channel: z.enum(['whatsapp', 'phone', 'web', 'email', 'walk_in']).default('phone'),
  partyId: zUuid.nullish(), siteId: zUuid.nullish(), locationId: zUuid.nullish(), assetId: zUuid.nullish(),
  contactName: zText(200).nullish(), contactPhone: zText(40).nullish(),
  subject: zText(300).min(1), description: zText(5000).nullish(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
};
const ticketSchema = z.object(ticketFields);
type TicketInput = z.infer<typeof ticketSchema>;

const woCreateSchema = z.object({
  type: z.enum(WORK_ORDER_TYPES), title: zText(300).min(1), description: zText(5000).nullish(),
  projectId: zUuid.nullish(), ticketId: zUuid.nullish(), partyId: zUuid.nullish(), siteId: zUuid.nullish(), locationId: zUuid.nullish(), assetId: zUuid.nullish(),
  /** outdoor work — the summer midday ban applies (default false; the dispatcher ticks it) */
  outdoor: z.boolean().optional(),
});
const woUpdateSchema = z.object({ title: zText(300).min(1), description: zText(5000).nullish(), partyId: zUuid.nullish(), siteId: zUuid.nullish(), locationId: zUuid.nullish(), assetId: zUuid.nullish(), outdoor: z.boolean().optional(), version: z.number().int().optional() });

const fileInput = z.object({ fileId: zUuid.optional(), name: zText(200).optional(), contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']).optional(), data: z.string().max(12_000_000).optional() })
  .refine((v) => !!v.fileId || (!!v.name && !!v.contentType && !!v.data), 'send fileId, or name + contentType + data (base64)');

const listWoQuery = zPage.extend({
  status: z.string().optional(), type: z.string().optional(), technicianId: zUuid.optional(), projectId: zUuid.optional(), ticketId: zUuid.optional(), siteId: zUuid.optional(), assetId: zUuid.optional(),
  from: zDate.optional(), to: zDate.optional(),
});

async function checkSiteLocation(tx: Tx, siteId: string | null | undefined, locationId: string | null | undefined) {
  if (siteId) await loadSite(tx, siteId);
  if (locationId) {
    const l = await loadLocation(tx, locationId);
    if (siteId && l.siteId !== siteId) throw badRequest('the location belongs to another site');
    return l;
  }
  return null;
}

async function loadAsset(tx: Tx, id: string) {
  const [a] = await tx.select().from(installedAsset).where(eq(installedAsset.id, id));
  if (!a) throw notFound('asset');
  return a;
}

/** Location tree of a site with asset counts per node. */
async function locationTree(tx: Tx, siteId: string) {
  const rows = await tx.select().from(siteLocation).where(and(eq(siteLocation.siteId, siteId), isNull(siteLocation.archivedAt))).orderBy(asc(siteLocation.sort), asc(siteLocation.name));
  const counts = await tx.select({ locationId: installedAsset.locationId, n: sql<number>`count(*)::int` }).from(installedAsset).where(and(eq(installedAsset.siteId, siteId), eq(installedAsset.status, 'active'))).groupBy(installedAsset.locationId);
  type Node = (typeof rows)[number] & { assetCount: number; children: Node[] };
  const nodes = new Map<string, Node>(rows.map((r) => [r.id, { ...r, assetCount: counts.find((c) => c.locationId === r.id)?.n ?? 0, children: [] }]));
  const roots: Node[] = [];
  for (const n of nodes.values()) (n.parentId && nodes.get(n.parentId) ? nodes.get(n.parentId)!.children : roots).push(n);
  // natural order (F2 before F10)
  const sortRec = (list: Node[]) => { list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'en', { numeric: true })); list.forEach((n) => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

@Controller('field')
export class FieldServiceController {
  // ───────────────────────── locations ─────────────────────────

  @Get('sites/:siteId/locations')
  @Perm('asset.read')
  async locations(@Actor() actor: RequestActor, @Param('siteId') siteId: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const s = await loadSite(tx, siteId);
      return { site: { id: s.id, name: s.name, partyId: s.partyId, city: s.city }, tree: await locationTree(tx, siteId) };
    });
  }

  @Post('sites/:siteId/locations')
  @Perm('asset.write')
  async addLocation(@Actor() actor: RequestActor, @Param('siteId') siteId: string, @Body(new ZodPipe(locationSchema)) b: z.infer<typeof locationSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadSite(tx, siteId);
      if (b.parentId) {
        const parent = await loadLocation(tx, b.parentId);
        if (parent.siteId !== siteId) throw badRequest('the parent location belongs to another site');
      }
      const [row] = await tx.insert(siteLocation).values({ siteId, parentId: b.parentId ?? null, kind: b.kind, name: b.name, sort: b.sort ?? 0, createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'site_location', row!.id, null, { siteId, name: b.name, kind: b.kind, parentId: b.parentId ?? null });
      return row;
    }, actor.userId);
  }

  /** Building → floors → units in one go (idempotent: existing nodes with the same names are reused). */
  @Post('sites/:siteId/locations/bulk')
  @Perm('asset.write')
  async bulkLocations(@Actor() actor: RequestActor, @Param('siteId') siteId: string, @Body(new ZodPipe(bulkSchema)) b: z.infer<typeof bulkSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadSite(tx, siteId);
      const r = await new LocationResolver(tx, siteId, actor.userId).init();
      const building = await r.child(null, b.building, 'building');
      for (let f = b.firstFloor; f < b.firstFloor + b.floors; f++) {
        const floor = await r.child(building, `${b.floorPrefix}${f}`, 'floor');
        for (let u = 1; u <= b.unitsPerFloor; u++) await r.child(floor, `${b.unitPrefix ?? ''}${f}${String(u).padStart(2, '0')}`, 'unit');
      }
      await audit(tx, actor, 'bulk_create', 'site_location', building, null, { siteId, ...b, created: r.created });
      return { created: r.created, buildingId: building, tree: await locationTree(tx, siteId) };
    }, actor.userId);
  }

  @Put('locations/:id')
  @Perm('asset.write')
  async updateLocation(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(locationSchema)) b: z.infer<typeof locationSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadLocation(tx, id);
      if (b.parentId) {
        const parent = await loadLocation(tx, b.parentId);
        if (parent.siteId !== before.siteId) throw badRequest('the parent location belongs to another site');
        // refuse cycles: walk up from the new parent
        for (let cur: string | null = parent.id, i = 0; cur && i < 50; i++) {
          if (cur === id) throw badRequest('a location cannot be moved under itself');
          const [up] = await tx.select({ parentId: siteLocation.parentId }).from(siteLocation).where(eq(siteLocation.id, cur));
          cur = up?.parentId ?? null;
        }
      }
      const values = { parentId: b.parentId ?? null, kind: b.kind, name: b.name, sort: b.sort ?? before.sort };
      const [row] = await tx.update(siteLocation).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(siteLocation.id, id)).returning();
      const d = diff(before as Record<string, unknown>, values);
      if (d) await audit(tx, actor, 'update', 'site_location', id, d.before, d.after);
      return row;
    }, actor.userId);
  }

  /** Archive a location and its sub-tree; refused while devices are attached anywhere below it. */
  @Delete('locations/:id')
  @Perm('asset.write')
  async archiveLocation(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadLocation(tx, id);
      const sub = await tx.execute<{ id: string }>(sql`
        with recursive t as (select id from site_location where id = ${id}::uuid union all select l.id from site_location l join t on l.parent_id = t.id where l.archived_at is null)
        select id::text as id from t`);
      const ids = [...sub].map((r) => r.id);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(installedAsset).where(and(inArray(installedAsset.locationId, ids), eq(installedAsset.status, 'active')))) as [{ n: number }];
      if (n > 0) throw conflict(`${n} device(s) are registered at this location or below it — move them first`);
      await tx.update(siteLocation).set({ archivedAt: new Date(), updatedBy: actor.userId }).where(inArray(siteLocation.id, ids));
      await audit(tx, actor, 'archive', 'site_location', id, null, { archived: ids.length });
      return { ok: true, archived: ids.length };
    }, actor.userId);
  }

  // ───────────────────────── installed base ─────────────────────────

  @Get('assets')
  @Perm('asset.read')
  async assets(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ siteId: zUuid.optional(), projectId: zUuid.optional(), partyId: zUuid.optional(), locationId: zUuid.optional(), workOrderId: zUuid.optional(), status: z.string().optional() }))) q: { q?: string; limit: number; offset: number; siteId?: string; projectId?: string; partyId?: string; locationId?: string; workOrderId?: string; status?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q?.trim();
      const mac = normalizeMac(term);
      const where = and(
        q.siteId ? eq(installedAsset.siteId, q.siteId) : undefined,
        q.projectId ? eq(installedAsset.projectId, q.projectId) : undefined,
        q.partyId ? eq(installedAsset.partyId, q.partyId) : undefined,
        q.locationId ? eq(installedAsset.locationId, q.locationId) : undefined,
        q.workOrderId ? eq(installedAsset.workOrderId, q.workOrderId) : undefined,
        q.status ? inArray(installedAsset.status, q.status.split(',')) : undefined,
        term ? or(ilike(installedAsset.code, `%${term}%`), ilike(installedAsset.serial, `%${term}%`), ilike(installedAsset.mac, `%${mac ?? term}%`), ilike(installedAsset.ip, `%${term}%`), ilike(installedAsset.description, `%${term}%`)) : undefined,
      );
      const rows = await tx.select().from(installedAsset).where(where).orderBy(asc(installedAsset.code), asc(installedAsset.serial)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(installedAsset).where(where)) as [{ n: number }];
      const paths = await locationPaths(tx, rows.map((r) => r.locationId));
      return { rows: rows.map((r) => ({ ...r, locationPath: r.locationId ? paths.get(r.locationId) ?? null : null })), total: n };
    });
  }

  @Get('assets/:id')
  @Perm('asset.read')
  async asset(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const a = await loadAsset(tx, id);
      const paths = await locationPaths(tx, [a.locationId]);
      const [s] = a.siteId ? await tx.select({ id: site.id, name: site.name, city: site.city, partyId: site.partyId }).from(site).where(eq(site.id, a.siteId)) : [];
      const [p] = a.partyId ? await tx.select({ id: party.id, nameAr: party.nameAr }).from(party).where(eq(party.id, a.partyId)) : [];
      const [pr] = a.projectId ? await tx.select({ id: project.id, number: project.number, name: project.name, stage: project.stage }).from(project).where(eq(project.id, a.projectId)) : [];
      const [parent] = a.parentAssetId ? await tx.select({ id: installedAsset.id, code: installedAsset.code, serial: installedAsset.serial }).from(installedAsset).where(eq(installedAsset.id, a.parentAssetId)) : [];
      const children = await tx.select({ id: installedAsset.id, code: installedAsset.code, serial: installedAsset.serial, mac: installedAsset.mac, status: installedAsset.status }).from(installedAsset).where(eq(installedAsset.parentAssetId, id));
      const wos = actor.grants['workorder.read'] ? await tx.select().from(workOrder).where(and(or(eq(workOrder.assetId, id), a.workOrderId ? eq(workOrder.id, a.workOrderId) : undefined), woFilter(actor, 'workorder.read'))).orderBy(desc(workOrder.createdAt)) : [];
      const tks = actor.grants['ticket.read'] ? await tx.select({ id: ticket.id, number: ticket.number, subject: ticket.subject, status: ticket.status, coverage: ticket.coverage, createdAt: ticket.createdAt }).from(ticket).where(and(eq(ticket.assetId, id), ticketFilter(actor, 'ticket.read'))).orderBy(desc(ticket.createdAt)) : [];
      const today = riyadhDate();
      const cov = await coverageFor(tx, { asset: a, today });
      const timeline = [
        ...wos.map((w) => ({ kind: 'work_order' as const, id: w.id, at: (w.completedAt ?? w.scheduledStart ?? w.createdAt).toISOString(), number: w.number, title: w.title, status: w.status, type: w.type, registeredHere: w.id === a.workOrderId })),
        ...tks.map((t) => ({ kind: 'ticket' as const, id: t.id, at: t.createdAt.toISOString(), number: t.number, title: t.subject, status: t.status, coverage: t.coverage })),
        ...(a.testedOn ? [{ kind: 'test' as const, id: a.id, at: `${a.testedOn}T12:00:00+03:00`, passed: a.testPassed, results: a.testResults }] : []),
        ...(a.installedOn ? [{ kind: 'installed' as const, id: a.id, at: `${a.installedOn}T12:00:00+03:00` }] : []),
      ].sort((x, y) => y.at.localeCompare(x.at));
      return {
        ...a,
        locationPath: a.locationId ? paths.get(a.locationId) ?? null : null,
        site: s ?? null, party: p ?? null, project: pr ?? null, parent: parent ?? null, children,
        warranty: { labourEnd: a.labourWarrantyEnd, partsEnd: a.partsWarrantyEnd, manufacturerEnd: a.manufacturerWarrantyEnd },
        coverageToday: { ...cov, date: today },
        workOrders: (await decorateWorkOrders(tx, wos)),
        tickets: tks,
        timeline,
      };
    });
  }

  @Post('assets')
  @Perm('asset.write')
  async createAsset(@Actor() actor: RequestActor, @Body(new ZodPipe(assetCreateSchema)) b: AssetInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      const row = await this.insertAsset(tx, actor, b);
      return { ...row, locationPath: row.locationId ? (await locationPaths(tx, [row.locationId])).get(row.locationId) ?? null : null };
    }, actor.userId);
  }

  private async insertAsset(tx: Tx, actor: RequestActor, b: AssetInput, opts: { quiet?: boolean } = {}): Promise<AssetRow> {
    let wo: WorkOrderRow | null = null;
    if (b.workOrderId) {
      const [found] = await tx.select().from(workOrder).where(eq(workOrder.id, b.workOrderId));
      if (!found) throw notFound('work order');
      wo = found;
      if (!canWo(actor, 'workorder.write', wo)) throw forbidden('not allowed: workorder.write');
      if (!EDITABLE.includes(wo.status as never)) throw badRequest(`the work order is ${wo.status}`);
    }
    const mac = b.mac ? normalizeMac(b.mac) : null;
    if (b.mac && !mac) throw badRequest('invalid MAC address', [{ path: 'mac', message: 'expected 12 hex digits, e.g. AA:BB:CC:DD:EE:FF' }]);
    const loc = b.locationId ?? wo?.locationId ?? null;
    let siteId = b.siteId ?? wo?.siteId ?? null;
    if (!siteId && loc) siteId = (await loadLocation(tx, loc)).siteId;
    if (!siteId) throw badRequest('siteId is required (or a work order / location that has one)');
    const s = await loadSite(tx, siteId);
    await checkSiteLocation(tx, siteId, loc);
    if (b.parentAssetId) await loadAsset(tx, b.parentAssetId);
    const serial = b.serial?.trim() || null;
    if (await duplicateAsset(tx, b.code, serial)) throw conflict(`a device ${b.code} with serial ${serial} is already registered`);
    const prod = b.productId ? null : await productByCode(tx, b.code);
    const own = ['own', 'team'].includes(actor.grants['asset.write'] ?? '');
    const [row] = await tx.insert(installedAsset).values({
      siteId, partyId: wo?.partyId ?? s.partyId, locationId: loc, projectId: b.projectId ?? wo?.projectId ?? null, parentAssetId: b.parentAssetId ?? null,
      productId: b.productId ?? prod?.id ?? null, code: b.code, description: b.description ?? prod?.description ?? null, serial, mac, ip: b.ip || null, firmware: b.firmware || null,
      attributes: b.attributes, installedOn: b.installedOn ?? (wo ? riyadhDate() : null),
      ...(own ? {} : { labourWarrantyEnd: b.labourWarrantyEnd ?? null, partsWarrantyEnd: b.partsWarrantyEnd ?? null, manufacturerWarrantyEnd: b.manufacturerWarrantyEnd ?? null }),
      workOrderId: wo?.id ?? null, createdBy: actor.userId, updatedBy: actor.userId,
    }).returning();
    if (!opts.quiet) await audit(tx, actor, 'create', 'installed_asset', row!.id, null, { code: b.code, serial, mac, siteId, workOrder: wo?.number ?? null });
    return row!;
  }

  @Put('assets/:id')
  @Perm('asset.write')
  async updateAsset(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(assetUpdateSchema)) b: z.infer<typeof assetUpdateSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadAsset(tx, id);
      await assertAssetWrite(tx, actor, before);
      if (b.version !== undefined && b.version !== before.version) throw conflict('the device was changed by someone else — reload');
      const mac = b.mac ? normalizeMac(b.mac) : null;
      if (b.mac && !mac) throw badRequest('invalid MAC address', [{ path: 'mac', message: 'expected 12 hex digits' }]);
      const siteId = b.siteId ?? before.siteId;
      await checkSiteLocation(tx, siteId, b.locationId);
      if (b.parentAssetId === id) throw badRequest('a device cannot be its own parent');
      const serial = b.serial?.trim() || null;
      if (await duplicateAsset(tx, b.code, serial, id)) throw conflict(`a device ${b.code} with serial ${serial} is already registered`);
      const own = ['own', 'team'].includes(actor.grants['asset.write'] ?? '');
      const values = {
        code: b.code, productId: b.productId ?? before.productId, description: b.description ?? null, serial, mac, ip: b.ip || null, firmware: b.firmware || null, attributes: b.attributes,
        locationId: b.locationId ?? null, siteId, projectId: b.projectId ?? before.projectId, parentAssetId: b.parentAssetId ?? null, installedOn: b.installedOn ?? null, status: b.status ?? before.status,
        ...(own ? {} : { labourWarrantyEnd: b.labourWarrantyEnd ?? null, partsWarrantyEnd: b.partsWarrantyEnd ?? null, manufacturerWarrantyEnd: b.manufacturerWarrantyEnd ?? null }),
      };
      const [row] = await tx.update(installedAsset).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(installedAsset.id, id)).returning();
      const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'installed_asset', id, d.before, d.after);
      return row;
    }, actor.userId);
  }

  /** Commissioning test result (PRJ-23): passed only when every check is ok. */
  @Post('assets/:id/test')
  @Perm('asset.write')
  async testAsset(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ results: z.array(z.object({ key: zText(60).min(1), ok: z.boolean(), note: zText(500).nullish() })).min(1).max(50) }))) b: { results: { key: string; ok: boolean; note?: string | null }[] }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadAsset(tx, id);
      await assertAssetWrite(tx, actor, before);
      const results = b.results.map((r) => ({ key: r.key, ok: r.ok, ...(r.note ? { note: r.note } : {}) }));
      const testPassed = results.every((r) => r.ok);
      const [row] = await tx.update(installedAsset).set({ testResults: results, testPassed, testedOn: riyadhDate(), updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(installedAsset.id, id)).returning();
      await audit(tx, actor, 'test', 'installed_asset', id, { testPassed: before.testPassed }, { testPassed, results });
      return row;
    }, actor.userId);
  }

  /**
   * Device schedule import (FSM-05): CSV columns code,serial,mac,ip,firmware,location ("B1/F2/U203";
   * a header row is optional). Missing locations are created; bad rows are reported and skipped.
   * dryRun = validate everything and roll back.
   */
  @Post('assets/import')
  @Perm('asset.write')
  async importAssets(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ siteId: zUuid, projectId: zUuid.nullish(), workOrderId: zUuid.nullish(), csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().default(false) }))) b: { siteId: string; projectId?: string | null; workOrderId?: string | null; csv: string; dryRun: boolean }) {
    const run = () => tenantTx(actor.tenantId, async (tx) => {
      await loadSite(tx, b.siteId);
      const rows = parseCsv(b.csv);
      const COLS = ['code', 'serial', 'mac', 'ip', 'firmware', 'location'] as const;
      let index: Record<(typeof COLS)[number], number> = { code: 0, serial: 1, mac: 2, ip: 3, firmware: 4, location: 5 };
      let first = 0;
      const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
      if (head.includes('code')) {
        first = 1;
        const at = (names: string[]) => head.findIndex((h) => names.includes(h));
        index = { code: at(['code']), serial: at(['serial', 'sn']), mac: at(['mac']), ip: at(['ip']), firmware: at(['firmware', 'fw']), location: at(['location', 'path', 'unit']) };
      }
      if (rows.length - first > 5000) throw badRequest('at most 5000 devices per import');
      const resolver = await new LocationResolver(tx, b.siteId, actor.userId).init();
      const seen = new Set<string>();
      const report: { row: number; code: string; serial: string | null; status: 'ok' | 'error'; message?: string; locationPath?: string | null }[] = [];
      for (let i = first; i < rows.length; i++) {
        const r = rows[i]!;
        const get = (k: (typeof COLS)[number]) => (index[k] >= 0 ? (r[index[k]] ?? '').trim() : '');
        const code = get('code');
        const serial = get('serial') || null;
        const line = i + 1;
        const fail = (message: string) => report.push({ row: line, code, serial, status: 'error', message });
        if (!code) { fail('code is required'); continue; }
        const macRaw = get('mac');
        if (macRaw && !normalizeMac(macRaw)) { fail(`invalid MAC address: ${macRaw}`); continue; }
        const key = `${code}|${serial ?? ''}`;
        if (serial && seen.has(key)) { fail('duplicate code + serial in the file'); continue; }
        if (serial && await duplicateAsset(tx, code, serial)) { fail('already registered (same code + serial)'); continue; }
        seen.add(key);
        const path = get('location');
        const locationId = path ? await resolver.path(path) : null;
        await this.insertAsset(tx, actor, { code, serial, mac: macRaw || null, ip: get('ip') || null, firmware: get('firmware') || null, locationId, siteId: b.siteId, projectId: b.projectId ?? null, workOrderId: b.workOrderId ?? null, attributes: {} }, { quiet: true });
        report.push({ row: line, code, serial, status: 'ok', locationPath: path || null });
      }
      const created = report.filter((r) => r.status === 'ok').length;
      const result = { dryRun: b.dryRun, total: report.length, created: b.dryRun ? 0 : created, valid: created, errors: report.filter((r) => r.status === 'error'), locationsCreated: resolver.created, rows: report };
      if (b.dryRun) throw new Rollback(result);
      await audit(tx, actor, 'import', 'installed_asset', null, null, { siteId: b.siteId, created, errors: result.errors.length, locationsCreated: resolver.created });
      return result;
    }, actor.userId);
    try {
      return await run();
    } catch (e) {
      if (e instanceof Rollback) return e.value;
      throw e;
    }
  }

  // ───────────────────────── tickets ─────────────────────────

  @Get('tickets')
  @Perm('ticket.read')
  async tickets(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.string().optional(), partyId: zUuid.optional(), siteId: zUuid.optional(), assetId: zUuid.optional(), coverage: z.string().optional() }))) q: { q?: string; limit: number; offset: number; status?: string; partyId?: string; siteId?: string; assetId?: string; coverage?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q?.trim();
      const where = and(
        ticketFilter(actor, 'ticket.read'),
        q.status ? inArray(ticket.status, q.status.split(',')) : undefined,
        q.coverage ? inArray(ticket.coverage, q.coverage.split(',')) : undefined,
        q.partyId ? eq(ticket.partyId, q.partyId) : undefined,
        q.siteId ? eq(ticket.siteId, q.siteId) : undefined,
        q.assetId ? eq(ticket.assetId, q.assetId) : undefined,
        term ? or(ilike(ticket.number, `%${term}%`), ilike(ticket.subject, `%${term}%`), ilike(ticket.contactName, `%${term}%`), ilike(ticket.contactPhone, `%${normalizePhone(term)?.slice(-9) ?? term}%`)) : undefined,
      );
      const rows = await tx.select().from(ticket).where(where).orderBy(desc(ticket.createdAt)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(ticket).where(where)) as [{ n: number }];
      return { rows: await this.decorateTickets(tx, rows), total: n };
    });
  }

  private async decorateTickets(tx: Tx, rows: (typeof ticket.$inferSelect)[]) {
    const pIds = [...new Set(rows.map((r) => r.partyId).filter((x): x is string => !!x))];
    const sIds = [...new Set(rows.map((r) => r.siteId).filter((x): x is string => !!x))];
    const aIds = [...new Set(rows.map((r) => r.assetId).filter((x): x is string => !!x))];
    const parties = pIds.length ? await tx.select({ id: party.id, nameAr: party.nameAr }).from(party).where(inArray(party.id, pIds)) : [];
    const sites = sIds.length ? await tx.select({ id: site.id, name: site.name }).from(site).where(inArray(site.id, sIds)) : [];
    const assets = aIds.length ? await tx.select({ id: installedAsset.id, code: installedAsset.code, serial: installedAsset.serial }).from(installedAsset).where(inArray(installedAsset.id, aIds)) : [];
    const paths = await locationPaths(tx, rows.map((r) => r.locationId));
    return rows.map((r) => ({
      ...r,
      partyName: parties.find((p) => p.id === r.partyId)?.nameAr ?? null,
      siteName: sites.find((s) => s.id === r.siteId)?.name ?? null,
      asset: assets.find((a) => a.id === r.assetId) ?? null,
      locationPath: r.locationId ? paths.get(r.locationId) ?? null : null,
    }));
  }

  @Get('tickets/:id')
  @Perm('ticket.read')
  async ticket(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => this.ticketView(tx, actor, (await loadTicket(tx, actor, id, 'ticket.read')).id));
  }

  private async ticketView(tx: Tx, actor: RequestActor, id: string) {
    const [t] = await tx.select().from(ticket).where(eq(ticket.id, id));
    const [d] = await this.decorateTickets(tx, [t!]);
    const wos = await tx.select().from(workOrder).where(eq(workOrder.ticketId, id)).orderBy(desc(workOrder.createdAt));
    return { ...d!, workOrders: await decorateWorkOrders(tx, wos.filter((w) => canWo(actor, 'workorder.read', w))) };
  }

  /** Resolve site/location/party from the asset when only the device is known; coverage from asset + site. */
  private async ticketContext(tx: Tx, b: Pick<TicketInput, 'partyId' | 'siteId' | 'locationId' | 'assetId' | 'contactPhone' | 'contactName'>) {
    const asset = b.assetId ? await loadAsset(tx, b.assetId) : null;
    const siteId = b.siteId ?? asset?.siteId ?? null;
    const locationId = b.locationId ?? asset?.locationId ?? null;
    await checkSiteLocation(tx, siteId, locationId);
    const s = siteId ? await loadSite(tx, siteId) : null;
    let partyId = b.partyId ?? asset?.partyId ?? s?.partyId ?? null;
    let contactName = b.contactName ?? null;
    let matchedBy: 'phone' | null = null;
    if (!partyId && b.contactPhone) {
      const m = await matchPartyByPhone(tx, b.contactPhone);
      if (m) { partyId = m.partyId; contactName ??= m.contactName; matchedBy = 'phone'; }
    }
    const cov = await coverageFor(tx, { siteId, asset });
    return { asset, siteId, locationId, partyId, contactName, matchedBy, cov };
  }

  @Post('tickets')
  @Perm('ticket.write')
  async createTicket(@Actor() actor: RequestActor, @Body(new ZodPipe(ticketSchema)) b: TicketInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      const ctx = await this.ticketContext(tx, b);
      const { number } = await nextNumber(tx, 'ticket');
      const [t] = await tx.insert(ticket).values({
        number, channel: b.channel, partyId: ctx.partyId, siteId: ctx.siteId, locationId: ctx.locationId, assetId: b.assetId ?? null,
        contactName: ctx.contactName, contactPhone: b.contactPhone ? normalizePhone(b.contactPhone) ?? b.contactPhone : null,
        subject: b.subject, description: b.description ?? null, priority: b.priority, status: 'open',
        coverage: ctx.cov.coverage, coverageReason: ctx.cov.reasonAr, ownerId: actor.userId, branchId: actor.branchId, createdBy: actor.userId, updatedBy: actor.userId,
      }).returning();
      await audit(tx, actor, 'create', 'ticket', t!.id, null, { number, coverage: ctx.cov.coverage, reason: ctx.cov.reasonEn, matchedBy: ctx.matchedBy });
      await emit(tx, 'ticket', t!.id, 'ticket.created', { number, coverage: ctx.cov.coverage });
      return { ...(await this.ticketView(tx, actor, t!.id)), matchedBy: ctx.matchedBy, coverageReasonEn: ctx.cov.reasonEn };
    }, actor.userId);
  }

  /** Edit a ticket; coverage is re-decided when the device or site changes. */
  @Put('tickets/:id')
  @Perm('ticket.write')
  async updateTicket(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(ticketSchema.extend({ version: z.number().int().optional() }))) b: TicketInput & { version?: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadTicket(tx, actor, id, 'ticket.write');
      if (b.version !== undefined && b.version !== before.version) throw conflict('the ticket was changed by someone else — reload');
      const ctx = await this.ticketContext(tx, b);
      const recheck = (b.assetId ?? null) !== before.assetId || ctx.siteId !== before.siteId;
      const values = {
        channel: b.channel, partyId: ctx.partyId, siteId: ctx.siteId, locationId: ctx.locationId, assetId: b.assetId ?? null, contactName: ctx.contactName,
        contactPhone: b.contactPhone ? normalizePhone(b.contactPhone) ?? b.contactPhone : null, subject: b.subject, description: b.description ?? null, priority: b.priority,
        ...(recheck ? { coverage: ctx.cov.coverage, coverageReason: ctx.cov.reasonAr } : {}),
      };
      await tx.update(ticket).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(ticket.id, id));
      const d = diff(before as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'ticket', id, d.before, d.after);
      return this.ticketView(tx, actor, id);
    }, actor.userId);
  }

  @Post('tickets/:id/status')
  @Perm('ticket.write')
  async ticketStatus(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ status: z.enum(TICKET_STATUSES), note: zText(1000).nullish() }))) b: { status: (typeof TICKET_STATUSES)[number]; note?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const t = await loadTicket(tx, actor, id, 'ticket.write');
      if (t.status === b.status) throw badRequest(`the ticket is already ${b.status}`);
      if (t.status === 'closed' && b.status !== 'open') throw badRequest('a closed ticket can only be reopened');
      await tx.update(ticket).set({ status: b.status, resolvedAt: b.status === 'resolved' ? new Date() : b.status === 'open' || b.status === 'in_progress' ? null : t.resolvedAt, updatedAt: new Date(), updatedBy: actor.userId, version: t.version + 1 }).where(eq(ticket.id, id));
      await audit(tx, actor, `status_${b.status}`, 'ticket', id, { status: t.status }, { status: b.status }, b.note ?? undefined);
      await emit(tx, 'ticket', id, `ticket.${b.status}`, { number: t.number });
      return this.ticketView(tx, actor, id);
    }, actor.userId);
  }

  /** One-click ticket → work order (FSM-82): same site / unit / device / coverage; the ticket moves to in_progress. */
  @Post('tickets/:id/work-order')
  @Perm('ticket.write', 'workorder.write')
  async ticketToWorkOrder(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ type: z.enum(WORK_ORDER_TYPES).optional(), title: zText(300).nullish(), description: zText(5000).nullish() }).nullish())) b: { type?: WorkOrderType; title?: string | null; description?: string | null } | null | undefined) {
    if (!actor.grants['workorder.write']) throw forbidden('missing permission: workorder.write');
    return tenantTx(actor.tenantId, async (tx) => {
      const t = await loadTicket(tx, actor, id, 'ticket.read');
      if (['resolved', 'closed'].includes(t.status)) throw badRequest(`the ticket is ${t.status}`);
      const type: WorkOrderType = b?.type ?? (t.coverage === 'warranty' ? 'warranty' : 'corrective');
      const wo = await this.insertWorkOrder(tx, actor, {
        type, title: b?.title || t.subject, description: b?.description ?? t.description, ticketId: t.id, partyId: t.partyId, siteId: t.siteId, locationId: t.locationId, assetId: t.assetId,
      }, { coverage: t.coverage, coverageReason: t.coverageReason });
      if (t.status === 'open') {
        await tx.update(ticket).set({ status: 'in_progress', updatedAt: new Date(), updatedBy: actor.userId, version: t.version + 1 }).where(eq(ticket.id, t.id));
        await audit(tx, actor, 'status_in_progress', 'ticket', t.id, { status: t.status }, { status: 'in_progress', workOrder: wo.number });
      }
      return workOrderView(tx, actor, wo.id);
    }, actor.userId);
  }

  // ───────────────────────── work orders ─────────────────────────

  @Get('work-orders')
  @Perm('workorder.read')
  async workOrders(@Actor() actor: RequestActor, @Query(new ZodPipe(listWoQuery)) q: z.infer<typeof listWoQuery>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const range = q.from || q.to ? riyadhDayRange(q.from ?? '1970-01-01', q.to ?? '2999-12-31') : null;
      const term = q.q?.trim();
      const where = and(
        woFilter(actor, 'workorder.read'),
        q.status ? inArray(workOrder.status, q.status.split(',')) : undefined,
        q.type ? inArray(workOrder.type, q.type.split(',')) : undefined,
        q.technicianId ? assignedTo(q.technicianId) : undefined,
        q.projectId ? eq(workOrder.projectId, q.projectId) : undefined,
        q.ticketId ? eq(workOrder.ticketId, q.ticketId) : undefined,
        q.siteId ? eq(workOrder.siteId, q.siteId) : undefined,
        q.assetId ? eq(workOrder.assetId, q.assetId) : undefined,
        range ? and(gte(workOrder.scheduledStart, range.start), lt(workOrder.scheduledStart, range.end)) : undefined,
        term ? or(ilike(workOrder.number, `%${term}%`), ilike(workOrder.title, `%${term}%`)) : undefined,
      );
      const rows = await tx.select().from(workOrder).where(where).orderBy(sql`${workOrder.scheduledStart} asc nulls last`, desc(workOrder.createdAt)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(workOrder).where(where)) as [{ n: number }];
      return { rows: await decorateWorkOrders(tx, rows), total: n };
    });
  }

  @Get('work-orders/:id')
  @Perm('workorder.read')
  async workOrder(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadWo(tx, actor, id, 'workorder.read');
      return workOrderView(tx, actor, id);
    });
  }

  @Post('work-orders')
  @Perm('workorder.write')
  async createWorkOrder(@Actor() actor: RequestActor, @Body(new ZodPipe(woCreateSchema)) b: z.infer<typeof woCreateSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      let fromTicket: { coverage: string; coverageReason: string | null } | undefined;
      if (b.ticketId) {
        const t = await loadTicket(tx, actor, b.ticketId, 'ticket.read');
        fromTicket = { coverage: t.coverage, coverageReason: t.coverageReason };
        b = { ...b, partyId: b.partyId ?? t.partyId, siteId: b.siteId ?? t.siteId, locationId: b.locationId ?? t.locationId, assetId: b.assetId ?? t.assetId };
      }
      const wo = await this.insertWorkOrder(tx, actor, b, b.projectId ? undefined : fromTicket);
      return workOrderView(tx, actor, wo.id);
    }, actor.userId);
  }

  private async insertWorkOrder(tx: Tx, actor: RequestActor, b: z.infer<typeof woCreateSchema>, coverage?: { coverage: string; coverageReason: string | null }) {
    const [pr] = b.projectId ? await tx.select().from(project).where(eq(project.id, b.projectId)) : [];
    if (b.projectId && !pr) throw notFound('project');
    const asset = b.assetId ? await loadAsset(tx, b.assetId) : null;
    const siteId = b.siteId ?? pr?.siteId ?? asset?.siteId ?? null;
    const locationId = b.locationId ?? asset?.locationId ?? null;
    await checkSiteLocation(tx, siteId, locationId);
    const s = siteId ? await loadSite(tx, siteId) : null;
    const partyId = b.partyId ?? pr?.partyId ?? asset?.partyId ?? s?.partyId ?? null;
    let cov = coverage;
    if (pr) cov = { coverage: 'project', coverageReason: `ضمن المشروع ${pr.number}` };
    if (!cov) { const d = await coverageFor(tx, { siteId, asset }); cov = { coverage: d.coverage, coverageReason: d.reasonAr }; }
    const { number } = await nextNumber(tx, 'work_order');
    const [wo] = await tx.insert(workOrder).values({
      number, type: b.type, status: 'new', title: b.title, description: b.description ?? null, projectId: pr?.id ?? null, ticketId: b.ticketId ?? null,
      partyId, siteId, locationId, assetId: asset?.id ?? null, outdoor: b.outdoor ?? false, coverage: cov.coverage, coverageReason: cov.coverageReason, checklist: defaultChecklist(b.type),
      ownerId: actor.userId, teamId: pr?.teamId ?? null, branchId: pr?.branchId ?? actor.branchId, createdBy: actor.userId, updatedBy: actor.userId,
    }).returning();
    await audit(tx, actor, 'create', 'work_order', wo!.id, null, { number, type: b.type, coverage: cov.coverage, project: pr?.number ?? null, ticketId: b.ticketId ?? null });
    await emit(tx, 'work_order', wo!.id, 'work_order.created', { number, type: b.type });
    return wo!;
  }

  @Put('work-orders/:id')
  @Perm('workorder.write')
  async updateWorkOrder(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(woUpdateSchema)) b: z.infer<typeof woUpdateSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.write');
      if (!EDITABLE.includes(wo.status as never)) throw badRequest(`a ${wo.status} work order cannot be edited`);
      if (b.version !== undefined && b.version !== wo.version) throw conflict('the work order was changed by someone else — reload');
      const siteId = b.siteId ?? wo.siteId;
      await checkSiteLocation(tx, siteId, b.locationId);
      if (b.assetId) await loadAsset(tx, b.assetId);
      const values = { title: b.title, description: b.description ?? null, partyId: b.partyId ?? wo.partyId, siteId, locationId: b.locationId ?? null, assetId: b.assetId ?? null, outdoor: b.outdoor ?? wo.outdoor };
      // the site pin and the outdoor flag feed the booking warnings — refresh them when either changes
      const rewarn = wo.scheduledStart && (values.outdoor !== wo.outdoor || siteId !== wo.siteId);
      const warnings = rewarn ? { scheduleWarnings: await bookingWarnings(tx, { siteId, outdoor: values.outdoor, start: wo.scheduledStart, end: wo.scheduledEnd }) } : {};
      await tx.update(workOrder).set({ ...values, ...warnings, updatedAt: new Date(), updatedBy: actor.userId, version: wo.version + 1 }).where(eq(workOrder.id, id));
      const d = diff(wo as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'work_order', id, d.before, d.after);
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  /** Book on the dispatch board (also re-books: dispatched/en-route/awaiting-parts → scheduled). */
  @Post('work-orders/:id/schedule')
  @Perm('workorder.dispatch')
  async schedule(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ technicianId: zUuid, crewIds: z.array(zUuid).max(20).default([]), scheduledStart: zInstant, scheduledEnd: zInstant, outdoor: z.boolean().optional() }))) b: { technicianId: string; crewIds: string[]; scheduledStart: Date; scheduledEnd: Date; outdoor?: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.dispatch');
      if (b.scheduledEnd <= b.scheduledStart) throw badRequest('scheduledEnd must be after scheduledStart');
      const crewIds = [...new Set(b.crewIds.filter((c) => c !== b.technicianId))];
      const names = await userNames(tx, [b.technicianId, ...crewIds]);
      const unknown = [b.technicianId, ...crewIds].filter((u) => !names.has(u));
      if (unknown.length) throw badRequest('unknown technician / crew member', unknown);
      const outdoor = b.outdoor ?? wo.outdoor;
      // KSA rules (FSM-27): soft warnings, stored with the booking — never block it
      const warnings = await bookingWarnings(tx, { siteId: wo.siteId, outdoor, start: b.scheduledStart, end: b.scheduledEnd });
      await transition(tx, actor, wo, 'scheduled', { technicianId: b.technicianId, crewIds, scheduledStart: b.scheduledStart, scheduledEnd: b.scheduledEnd, outdoor, scheduleWarnings: warnings });
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  /** Send to the technician (+ in-app notification to the technician and crew). */
  @Post('work-orders/:id/dispatch')
  @Perm('workorder.dispatch')
  async dispatch(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.dispatch');
      if (!wo.technicianId) throw badRequest('assign a technician first');
      await transition(tx, actor, wo, 'dispatched');
      const when = wo.scheduledStart ? `${riyadhDate(wo.scheduledStart)} ${new Date(wo.scheduledStart.getTime() + 3 * 3600_000).toISOString().slice(11, 16)}` : '';
      for (const uid of [wo.technicianId, ...wo.crewIds]) {
        await tx.insert(notification).values({ userId: uid, kind: 'work_order', titleAr: `🛠️ أمر عمل ${wo.number} — ${wo.title}${when ? ` (${when})` : ''}`, titleEn: `Work order ${wo.number} — ${wo.title}`, link: `/field/work-orders/${wo.id}` });
      }
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  @Post('work-orders/:id/cancel')
  @Perm('workorder.dispatch')
  async cancel(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: zText(1000).min(1) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.dispatch');
      await transition(tx, actor, wo, 'cancelled', {}, b.reason);
      await closeTimeEntries(tx, id);
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  /** Reviewed (and billed if chargeable) → closed. */
  @Post('work-orders/:id/close')
  @Perm('workorder.dispatch')
  async close(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.dispatch');
      await transition(tx, actor, wo, 'closed');
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  /** Completed → back on site (the review found something missing). */
  @Post('work-orders/:id/reopen')
  @Perm('workorder.dispatch')
  async reopen(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: zText(1000).min(1) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.dispatch');
      await transition(tx, actor, wo, 'on_site', { completedAt: null, checkOutAt: null }, b.reason);
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  /** Board: technician lanes with their work orders overlapping [from, to] + the unscheduled queue. */
  @Get('dispatch-board')
  @Perm('workorder.read')
  async board(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ from: zDate.optional(), to: zDate.optional() }))) q: { from?: string; to?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const from = q.from ?? riyadhDate();
      const to = q.to ?? from;
      if (to < from) throw badRequest('to must not be before from');
      const { start, end } = riyadhDayRange(from, to);
      const scope = woFilter(actor, 'workorder.read');
      const booked = await tx.select().from(workOrder).where(and(scope, sql`${workOrder.scheduledStart} is not null`, lt(workOrder.scheduledStart, end), sql`coalesce(${workOrder.scheduledEnd}, ${workOrder.scheduledStart}) >= ${start.toISOString()}::timestamptz`, sql`${workOrder.status} <> 'cancelled'`)).orderBy(asc(workOrder.scheduledStart));
      const queue = await tx.select().from(workOrder).where(and(scope, eq(workOrder.status, 'new'))).orderBy(asc(workOrder.createdAt)).limit(200);
      const techs = await technicians(tx);
      const laneIds = [...new Set([...techs.map((t) => t.id), ...booked.flatMap((w) => [w.technicianId, ...w.crewIds]).filter((x): x is string => !!x)])];
      const names = await userNames(tx, laneIds);
      const decorated = await decorateWorkOrders(tx, booked);
      const lanes = laneIds.map((uid) => ({
        id: uid,
        name: names.get(uid) ?? null,
        isTechnician: techs.some((t) => t.id === uid),
        workOrders: decorated.filter((w) => w.technicianId === uid || w.crewIds.includes(uid)).map((w) => ({ ...w, role: w.technicianId === uid ? 'lead' as const : 'crew' as const })),
      })).sort((a, b) => Number(b.isTechnician) - Number(a.isTechnician) || (a.name ?? '').localeCompare(b.name ?? ''));
      return { from, to, technicians: lanes, unscheduled: await decorateWorkOrders(tx, queue) };
    });
  }

  // ───────────────────────── technician app ─────────────────────────

  /** My day: work orders where I am lead or crew for the date, plus overdue open ones. */
  @Get('my-day')
  @Perm('workorder.read')
  async myDay(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ date: zDate.optional() }))) q: { date?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const date = q.date ?? riyadhDate();
      const { start, end } = riyadhDayRange(date);
      const mine = assignedTo(actor.userId);
      const today = await tx.select().from(workOrder).where(and(mine, lt(workOrder.scheduledStart, end), sql`coalesce(${workOrder.scheduledEnd}, ${workOrder.scheduledStart}) >= ${start.toISOString()}::timestamptz`, sql`${workOrder.status} <> 'cancelled'`)).orderBy(asc(workOrder.scheduledStart));
      const overdue = await tx.select().from(workOrder).where(and(mine, inArray(workOrder.status, OPEN_WO), sql`coalesce(${workOrder.scheduledEnd}, ${workOrder.scheduledStart}) < ${start.toISOString()}::timestamptz`)).orderBy(asc(workOrder.scheduledStart));
      const all = [...today, ...overdue];
      const tIds = [...new Set(all.map((w) => w.ticketId).filter((x): x is string => !!x))];
      const tks = tIds.length ? await tx.select({ id: ticket.id, number: ticket.number, contactName: ticket.contactName, contactPhone: ticket.contactPhone }).from(ticket).where(inArray(ticket.id, tIds)) : [];
      const pIds = [...new Set(all.map((w) => w.partyId).filter((x): x is string => !!x))];
      const contacts = pIds.length ? await tx.select({ partyId: contact.partyId, name: contact.name, mobile: contact.mobile, isPrimary: contact.isPrimary }).from(contact).where(and(inArray(contact.partyId, pIds), isNull(contact.archivedAt))) : [];
      const withContact = async (rows: WorkOrderRow[]) => (await decorateWorkOrders(tx, rows)).map((w) => {
        const t = tks.find((x) => x.id === w.ticketId);
        const c = contacts.filter((x) => x.partyId === w.partyId).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0];
        return { ...w, contactName: t?.contactName ?? c?.name ?? null, contactPhone: t?.contactPhone ?? c?.mobile ?? null, ticketNumber: t?.number ?? null };
      });
      return { date, today: await withContact(today), overdue: await withContact(overdue) };
    });
  }

  @Post('work-orders/:id/start-travel')
  @Perm('workorder.write')
  async startTravel(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.write');
      await transition(tx, actor, wo, 'en_route');
      await closeTimeEntries(tx, id, { userId: actor.userId });
      await tx.insert(timeEntry).values({ workOrderId: id, userId: actor.userId, kind: 'travel', startedAt: new Date(), createdBy: actor.userId });
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  @Post('work-orders/:id/check-in')
  @Perm('workorder.write')
  async checkIn(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ lat: z.union([z.number(), z.string()]).nullish(), lng: z.union([z.number(), z.string()]).nullish() }).nullish())) b: { lat?: number | string | null; lng?: number | string | null } | null | undefined) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.write');
      const now = new Date();
      // geofence (FSM-49): record the distance from the site pin and flag it when outside — never block
      const fence = await checkInGeofence(tx, wo.siteId, b?.lat, b?.lng);
      await transition(tx, actor, wo, 'on_site', { checkInAt: now, checkInLat: b?.lat != null ? String(b.lat) : null, checkInLng: b?.lng != null ? String(b.lng) : null, ...fence });
      await closeTimeEntries(tx, id, { userId: actor.userId });
      await tx.insert(timeEntry).values({ workOrderId: id, userId: actor.userId, kind: 'work', startedAt: now, createdBy: actor.userId });
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  private async editable(tx: Tx, actor: RequestActor, id: string) {
    const wo = await loadWo(tx, actor, id, 'workorder.write');
    if (!EDITABLE.includes(wo.status as never)) throw badRequest(`a ${wo.status} work order cannot be changed`);
    return wo;
  }

  @Put('work-orders/:id/checklist')
  @Perm('workorder.write')
  async checklist(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ items: z.array(z.object({ key: zText(60).min(1), done: z.boolean(), value: zText(1000).nullish() })).max(100) }))) b: { items: { key: string; done: boolean; value?: string | null }[] }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await this.editable(tx, actor, id);
      const unknown = b.items.filter((i) => !wo.checklist.some((c) => c.key === i.key)).map((i) => i.key);
      if (unknown.length) throw badRequest('unknown checklist item', unknown);
      const checklist = wo.checklist.map((c) => {
        const u = b.items.find((i) => i.key === c.key);
        return u ? { ...c, done: u.done, value: u.value ?? c.value ?? null } : c;
      });
      await tx.update(workOrder).set({ checklist, updatedAt: new Date(), updatedBy: actor.userId, version: wo.version + 1 }).where(eq(workOrder.id, id));
      await audit(tx, actor, 'checklist', 'work_order', id, null, { items: b.items });
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  /** Attach a photo: an existing file id, or the image itself as base64 (≤ 8 MB). */
  @Post('work-orders/:id/photos')
  @Perm('workorder.write')
  async addPhoto(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(fileInput)) b: z.infer<typeof fileInput>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await this.editable(tx, actor, id);
      if (wo.photoFileIds.length >= 50) throw badRequest('at most 50 photos per work order');
      let fileId = b.fileId;
      if (fileId) {
        const [f] = await tx.select({ id: file.id, mime: file.mime }).from(file).where(eq(file.id, fileId));
        if (!f) throw notFound('file');
        if (!f.mime.startsWith('image/')) throw badRequest('the file is not an image');
      } else {
        const data = Buffer.from(b.data!, 'base64');
        if (!data.length) throw badRequest('empty image');
        if (data.length > 8_000_000) throw badRequest('image larger than 8 MB');
        fileId = (await storeFile(tx, actor.tenantId, data, b.name!, b.contentType!, actor.userId)).id;
      }
      if (wo.photoFileIds.includes(fileId)) return workOrderView(tx, actor, id);
      await tx.update(workOrder).set({ photoFileIds: [...wo.photoFileIds, fileId], updatedAt: new Date(), updatedBy: actor.userId, version: wo.version + 1 }).where(eq(workOrder.id, id));
      await audit(tx, actor, 'add_photo', 'work_order', id, null, { fileId });
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  @Delete('work-orders/:id/photos/:fileId')
  @Perm('workorder.write')
  async removePhoto(@Actor() actor: RequestActor, @Param('id') id: string, @Param('fileId') fileId: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await this.editable(tx, actor, id);
      if (!wo.photoFileIds.includes(fileId)) throw notFound('photo');
      await tx.update(workOrder).set({ photoFileIds: wo.photoFileIds.filter((f) => f !== fileId), updatedAt: new Date(), updatedBy: actor.userId, version: wo.version + 1 }).where(eq(workOrder.id, id));
      await audit(tx, actor, 'remove_photo', 'work_order', id, { fileId }, null);
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  @Put('work-orders/:id/parts')
  @Perm('workorder.write')
  async parts(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ parts: z.array(z.object({ code: zText(100).min(1), description: zText(500).nullish(), qty: zQty, serial: zText(200).nullish() })).max(200) }))) b: { parts: { code: string; description?: string | null; qty: string; serial?: string | null }[] }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await this.editable(tx, actor, id);
      const partsUsed = b.parts.map((p) => ({ code: p.code, ...(p.description ? { description: p.description } : {}), qty: p.qty, serial: p.serial ?? null }));
      await tx.update(workOrder).set({ partsUsed, updatedAt: new Date(), updatedBy: actor.userId, version: wo.version + 1 }).where(eq(workOrder.id, id));
      await audit(tx, actor, 'parts', 'work_order', id, { parts: wo.partsUsed }, { parts: partsUsed });
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  @Put('work-orders/:id/findings')
  @Perm('workorder.write')
  async findings(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ findings: zText(10000).nullable() }))) b: { findings: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await this.editable(tx, actor, id);
      await tx.update(workOrder).set({ findings: b.findings || null, updatedAt: new Date(), updatedBy: actor.userId, version: wo.version + 1 }).where(eq(workOrder.id, id));
      await audit(tx, actor, 'findings', 'work_order', id, { findings: wo.findings }, { findings: b.findings });
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  /** Customer signature: the signer's name, optionally the drawn signature (PNG data URL ≤ 1 MB). */
  @Post('work-orders/:id/sign')
  @Perm('workorder.write')
  async sign(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ signatureName: zText(200).min(1), signatureImage: z.string().max(1_500_000).nullish() }))) b: { signatureName: string; signatureImage?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await this.editable(tx, actor, id);
      let signatureFileId = wo.signatureFileId;
      if (b.signatureImage) {
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(b.signatureImage);
        if (!m) throw badRequest('signatureImage must be a PNG data URL');
        const data = Buffer.from(m[1]!, 'base64');
        if (!data.length || data.length > 1_000_000) throw badRequest('signature image is empty or larger than 1 MB');
        signatureFileId = (await storeFile(tx, actor.tenantId, data, `${wo.number}-signature.png`, 'image/png', actor.userId)).id;
      }
      await tx.update(workOrder).set({ signatureName: b.signatureName, signatureFileId, updatedAt: new Date(), updatedBy: actor.userId, version: wo.version + 1 }).where(eq(workOrder.id, id));
      await audit(tx, actor, 'customer_signature', 'work_order', id, null, { signatureName: b.signatureName, signatureFileId });
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  @Post('work-orders/:id/awaiting-parts')
  @Perm('workorder.write')
  async awaitingParts(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ note: zText(2000).min(1) }))) b: { note: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.write');
      const findings = [wo.findings, `[بانتظار قطع غيار — ${riyadhDate()}] ${b.note}`].filter(Boolean).join('\n');
      await transition(tx, actor, wo, 'awaiting_parts', { findings }, b.note);
      await closeTimeEntries(tx, id);
      if (wo.ownerId && wo.ownerId !== actor.userId) await tx.insert(notification).values({ userId: wo.ownerId, kind: 'work_order', titleAr: `⏳ ${wo.number} بانتظار قطع غيار — ${b.note}`.slice(0, 300), link: `/field/work-orders/${wo.id}` });
      return workOrderView(tx, actor, id);
    }, actor.userId);
  }

  /** Stage gate (FSM-47): 400 with `missing` until the evidence is complete; then report PDF + ticket resolved. */
  @Post('work-orders/:id/complete')
  @Perm('workorder.write')
  async complete(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.write');
      if (!canTransitionWorkOrder(wo.status as WorkOrderStatus, 'completed')) throw badRequest(`cannot move a work order from ${wo.status} to completed`, { from: wo.status, to: 'completed' });
      const missing = await evidenceOf(tx, wo);
      if (missing.length) throw missingError(missing);
      const now = new Date();
      await transition(tx, actor, wo, 'completed', { completedAt: now, checkOutAt: now });
      await closeTimeEntries(tx, id);
      if (wo.ticketId) {
        const [t] = await tx.select().from(ticket).where(eq(ticket.id, wo.ticketId));
        if (t && !['resolved', 'closed'].includes(t.status)) {
          await tx.update(ticket).set({ status: 'resolved', resolvedAt: now, updatedAt: now, updatedBy: actor.userId, version: t.version + 1 }).where(eq(ticket.id, t.id));
          await audit(tx, actor, 'status_resolved', 'ticket', t.id, { status: t.status }, { status: 'resolved', workOrder: wo.number });
          await emit(tx, 'ticket', t.id, 'ticket.resolved', { number: t.number });
        }
      }
      if (wo.ownerId && wo.ownerId !== actor.userId) await tx.insert(notification).values({ userId: wo.ownerId, kind: 'work_order', titleAr: `✅ اكتمل أمر العمل ${wo.number} — ${wo.title}`, link: `/field/work-orders/${wo.id}` });
      // Phase 5: post parts / installed serials as stock consumption (own savepoint — never blocks completion)
      try {
        const used = await tx.transaction((sp) => consumeForWorkOrder(sp, actor, id));
        if (used.warnings.length) console.warn(`[inventory] ${wo.number}: ${used.warnings.join('; ')}`);
      } catch (e) {
        console.warn(`[inventory] ${wo.number}: stock consumption not posted — ${(e as Error).message}`);
      }
      let reportError: string | null = null;
      try {
        await renderServiceReport(tx, actor, id);
      } catch (e) {
        reportError = (e as Error).message;
      }
      return { ...(await workOrderView(tx, actor, id)), reportError };
    }, actor.userId);
  }

  /** Re-render the service report (e.g. the PDF service was down at completion). */
  @Post('work-orders/:id/report')
  @Perm('workorder.write')
  async report(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.write');
      if (!['completed', 'closed'].includes(wo.status)) throw badRequest('the service report is issued when the work order is completed');
      const f = await renderServiceReport(tx, actor, id);
      return { fileId: f.id, url: `/api/files/${f.id}` };
    }, actor.userId);
  }

  /** WhatsApp the report link to the customer (ticket caller, primary contact, or the customer's phone). */
  @Post('work-orders/:id/send-report')
  @Perm('workorder.write')
  async sendReport(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ to: zText(40).nullish() }).nullish())) b: { to?: string | null } | null | undefined) {
    return tenantTx(actor.tenantId, async (tx) => {
      const wo = await loadWo(tx, actor, id, 'workorder.write');
      if (!['completed', 'closed'].includes(wo.status)) throw badRequest('complete the work order first');
      if (!wo.reportFileId) throw badRequest('the service report has not been generated yet — retry POST /report');
      const [t] = wo.ticketId ? await tx.select({ contactName: ticket.contactName, contactPhone: ticket.contactPhone }).from(ticket).where(eq(ticket.id, wo.ticketId)) : [];
      const [p] = wo.partyId ? await tx.select({ nameAr: party.nameAr, phone: party.phone }).from(party).where(eq(party.id, wo.partyId)) : [];
      const contacts = wo.partyId ? await tx.select().from(contact).where(and(eq(contact.partyId, wo.partyId), isNull(contact.archivedAt))) : [];
      const c = contacts.sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary))[0];
      const raw = b?.to || t?.contactPhone || c?.whatsapp || c?.mobile || p?.phone;
      const to = raw ? normalizePhone(raw) : null;
      if (!to) throw badRequest('no customer phone — pass `to`');
      await ensureServiceReportTemplate(tx);
      const link = `${config.publicBaseUrl}/api/field/public/reports/${reportToken(actor.tenantId, wo.id)}`;
      const name = t?.contactName || c?.name || p?.nameAr || '';
      const r = await sendTemplate(tx, { channel: 'whatsapp', to, templateKey: 'service_report', vars: { name, number: wo.number, link }, related: { type: 'work_order', id: wo.id }, link: { partyId: wo.partyId, contactId: c?.id ?? null }, sentBy: actor.userId });
      await audit(tx, actor, 'send_report', 'work_order', id, null, { to, status: r.result.status });
      return { to, link, status: r.result.status, messageId: r.message.id };
    }, actor.userId);
  }

  /** Customer-facing report PDF behind a signed link (no session). */
  @Public()
  @Get('public/reports/:token')
  async publicReport(@Param('token') token: string, @Res() res: Response) {
    const t = parseReportToken(token);
    if (!t) throw notFound('report');
    const f = await tenantTx(t.tenantId, async (tx) => {
      const [wo] = await tx.select({ reportFileId: workOrder.reportFileId, status: workOrder.status }).from(workOrder).where(eq(workOrder.id, t.woId));
      if (!wo?.reportFileId || wo.status === 'cancelled') return null;
      return readStoredFile(tx, wo.reportFileId);
    });
    if (!f) throw notFound('report');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(f.data);
  }
}
