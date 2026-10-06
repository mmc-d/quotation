import { randomUUID } from 'node:crypto';
import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Put, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, installedAsset, iotAlarm, isNull, site, sql, ticket, withTenant } from '@mmc/db';
import { Actor, Perm, Public, type RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { getDb, tenantTx } from '../common/db.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { ZodPipe, zPage, zUuid } from '../common/zod.js';
import { assertAssetWrite } from './field-service.service.js';
import { heartbeat, ingestAlarm, siteHealth, tbEnv, TB_STATUSES, verifyTbSignature, type AlarmPayload } from './iot.service.js';

/**
 * IoT-connected service (module 12 §2) under /api/iot: the signed ThingsBoard webhooks (alarms +
 * heartbeats), the alarm list, per-site health and a demo "simulate alarm"; device binding lives at
 * PUT /api/field/assets/:id/iot.
 */

const ts = z.union([z.number(), z.string().max(40)]).nullish();
const alarmSchema = z.object({
  alarmId: z.string().trim().min(1).max(200),
  deviceName: z.string().trim().max(200).nullish(),
  deviceId: z.string().trim().max(200).nullish(),
  type: z.string().trim().min(1).max(200),
  severity: z.string().trim().min(1).max(40),
  status: z.enum(TB_STATUSES),
  ts,
  details: z.unknown().optional(),
}).refine((v) => !!(v.deviceName || v.deviceId), 'deviceName or deviceId is required');
const heartbeatSchema = z.object({ deviceName: z.string().trim().min(1).max(200), online: z.boolean(), ts });

async function defaultTenant(): Promise<string> {
  const rows = await getDb().execute<{ t: string }>(sql`select default_tenant() as t`);
  if (!rows[0]?.t) throw new Error('no tenant');
  return rows[0].t;
}

/** Signed body → parsed JSON (401 when unsigned or the signature is wrong). */
function signedBody<T>(req: Request & { rawBody?: Buffer }, sig: string | undefined, schema: z.ZodType<T>): T {
  if (!tbEnv().webhookSecret) throw new ForbiddenException({ error: 'forbidden', message: 'the ThingsBoard webhook is not configured' });
  const raw = req.rawBody ?? Buffer.alloc(0);
  if (!verifyTbSignature(raw, sig)) throw new UnauthorizedException({ error: 'unauthorized', message: 'bad or missing X-MMC-Signature' });
  let json: unknown;
  try { json = JSON.parse(raw.toString('utf8') || '{}'); } catch { throw badRequest('invalid JSON'); }
  const r = schema.safeParse(json);
  if (!r.success) throw badRequest('validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

@Controller('iot')
export class IotController {
  // ───────────────────────── webhooks (ThingsBoard rule chain → REST API Call node) ─────────────────────────

  @Public()
  @Post('thingsboard/webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-mmc-signature') sig: string | undefined) {
    const b = signedBody(req, sig, alarmSchema);
    const tenantId = await defaultTenant();
    return withTenant(getDb(), tenantId, (tx) => ingestAlarm(tx, b as AlarmPayload));
  }

  @Public()
  @Post('thingsboard/heartbeat')
  @HttpCode(200)
  async heartbeat(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-mmc-signature') sig: string | undefined) {
    const b = signedBody(req, sig, heartbeatSchema);
    const tenantId = await defaultTenant();
    return withTenant(getDb(), tenantId, (tx) => heartbeat(tx, b));
  }

  // ───────────────────────── staff ─────────────────────────

  @Get('alarms')
  @Perm('asset.read')
  async alarms(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.string().max(100).optional(), severity: z.string().max(100).optional(), siteId: zUuid.optional(), assetId: zUuid.optional() }))) q: { q?: string; limit: number; offset: number; status?: string; severity?: string; siteId?: string; assetId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const statuses = q.status?.split(',').filter(Boolean) ?? [];
      const where = and(
        statuses.includes('unbound') ? isNull(iotAlarm.assetId) : undefined,
        statuses.filter((s) => s !== 'unbound').length ? inArray(iotAlarm.status, statuses.filter((s) => s !== 'unbound')) : undefined,
        q.severity ? inArray(iotAlarm.severity, q.severity.toUpperCase().split(',')) : undefined,
        q.siteId ? eq(installedAsset.siteId, q.siteId) : undefined,
        q.assetId ? eq(iotAlarm.assetId, q.assetId) : undefined,
        q.q?.trim() ? sql`(${iotAlarm.deviceId} ilike ${`%${q.q.trim()}%`} or ${iotAlarm.alarmType} ilike ${`%${q.q.trim()}%`})` : undefined,
      );
      const rows = await tx.select({
        a: iotAlarm, assetCode: installedAsset.code, assetSerial: installedAsset.serial, siteId: installedAsset.siteId, siteName: site.name,
        ticketNumber: ticket.number, ticketStatus: ticket.status,
      }).from(iotAlarm).leftJoin(installedAsset, eq(installedAsset.id, iotAlarm.assetId)).leftJoin(site, eq(site.id, installedAsset.siteId)).leftJoin(ticket, eq(ticket.id, iotAlarm.ticketId))
        .where(where).orderBy(desc(iotAlarm.lastSeenAt)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(iotAlarm).leftJoin(installedAsset, eq(installedAsset.id, iotAlarm.assetId)).where(where)) as [{ n: number }];
      const [counts] = (await tx.select({
        active: sql<number>`count(*) filter (where ${iotAlarm.status} in ('active', 'acknowledged'))::int`,
        unbound: sql<number>`count(*) filter (where ${iotAlarm.assetId} is null)::int`,
      }).from(iotAlarm)) as [{ active: number; unbound: number }];
      return {
        rows: rows.map((r) => ({ ...r.a, raw: undefined, assetCode: r.assetCode, assetSerial: r.assetSerial, siteId: r.siteId, siteName: r.siteName, ticketNumber: r.ticketNumber, ticketStatus: r.ticketStatus })),
        total: n, counts, canManage: !!actor.grants['iot.manage'],
      };
    });
  }

  @Get('sites/:siteId/health')
  @Perm('asset.read')
  async health(@Actor() actor: RequestActor, @Param('siteId') siteId: string) {
    if (!zUuid.safeParse(siteId).success) throw notFound('site');
    return tenantTx(actor.tenantId, (tx) => siteHealth(tx, siteId, { detail: true }));
  }

  /** Demo / commissioning: run an alarm through the same path as the webhook (no signature needed). */
  @Post('test-alarm')
  @Perm('iot.manage')
  async testAlarm(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({
    assetId: zUuid.nullish(), deviceName: z.string().trim().max(200).nullish(),
    type: z.string().trim().min(1).max(200).default('Device offline'), severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR', 'WARNING']).default('CRITICAL'),
    status: z.enum(TB_STATUSES).default('ACTIVE_UNACK'), alarmId: z.string().trim().max(200).nullish(),
  }).refine((v) => !!(v.assetId || v.deviceName), 'assetId or deviceName is required'))) b: { assetId?: string | null; deviceName?: string | null; type: string; severity: string; status: AlarmPayload['status']; alarmId?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      let deviceName = b.deviceName ?? null;
      if (b.assetId) {
        const [a] = await tx.select().from(installedAsset).where(eq(installedAsset.id, b.assetId));
        if (!a) throw notFound('asset');
        deviceName = a.iotDeviceId ?? a.serial ?? a.mac;
        if (!deviceName) throw badRequest('the device has no IoT binding, serial or MAC');
      }
      const alarmId = b.alarmId || `test-${randomUUID()}`;
      const r = await ingestAlarm(tx, { alarmId, deviceName, type: b.type, severity: b.severity, status: b.status, ts: Date.now(), details: { simulatedBy: actor.email } });
      await audit(tx, actor, 'iot_test_alarm', 'iot_alarm', r.alarmId, null, { alarmId, deviceName, type: b.type, severity: b.severity });
      return { ...r, externalId: alarmId };
    }, actor.userId);
  }
}

/** Device ↔ ThingsBoard binding on the installed-device record (IOT-01). */
@Controller('field/assets')
export class IotBindingController {
  @Put(':id/iot')
  @Perm('asset.write')
  async bind(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ iotDeviceId: z.string().trim().max(200).nullish() }))) b: { iotDeviceId?: string | null }) {
    if (!zUuid.safeParse(id).success) throw notFound('asset');
    return tenantTx(actor.tenantId, async (tx) => {
      const [a] = await tx.select().from(installedAsset).where(eq(installedAsset.id, id));
      if (!a) throw notFound('asset');
      await assertAssetWrite(tx, actor, a);
      const deviceId = b.iotDeviceId?.trim() || null;
      if (deviceId) {
        const [dup] = await tx.select({ id: installedAsset.id, code: installedAsset.code, serial: installedAsset.serial }).from(installedAsset)
          .where(and(sql`lower(${installedAsset.iotDeviceId}) = ${deviceId.toLowerCase()}`, sql`${installedAsset.id} <> ${id}`)).limit(1);
        if (dup) throw conflict(`the IoT device ${deviceId} is already bound to ${[dup.code, dup.serial].filter(Boolean).join(' / ')}`);
      }
      const changed = deviceId !== a.iotDeviceId;
      const [row] = await tx.update(installedAsset).set({
        iotDeviceId: deviceId, ...(changed ? { iotOnline: null, iotLastSeenAt: null } : {}), updatedAt: new Date(), updatedBy: actor.userId, version: a.version + 1,
      }).where(eq(installedAsset.id, id)).returning();
      if (changed) {
        await audit(tx, actor, 'iot_bind', 'installed_asset', id, { iotDeviceId: a.iotDeviceId }, { iotDeviceId: deviceId });
        // alarms that arrived from this device before it was bound now point at the asset
        if (deviceId) await tx.update(iotAlarm).set({ assetId: id, updatedAt: new Date() }).where(and(isNull(iotAlarm.assetId), sql`lower(${iotAlarm.deviceId}) = ${deviceId.toLowerCase()}`));
      }
      return { id: row!.id, iotDeviceId: row!.iotDeviceId, iotOnline: row!.iotOnline, iotLastSeenAt: row!.iotLastSeenAt };
    }, actor.userId);
  }
}
