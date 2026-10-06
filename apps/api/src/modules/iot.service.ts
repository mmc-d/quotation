import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  and, appUser, desc, emit, eq, gte, inArray, installedAsset, iotAlarm, isNull, messageTemplate, nextNumber, or, role, site, sql, ticket, userRole, workOrder, type SQL, type Tx,
} from '@mmc/db';
import { ALARM_DEDUP_WINDOW_MIN, alarmAction, alarmDedupKey, defaultChecklist, normalizeMac, type WorkOrderType } from '@mmc/domain';
import { audit } from '../common/audit.js';
import { notFound } from '../common/errors.js';
import { sendTemplate } from '../common/messaging.js';
import { coverageFor, locationPaths } from './field-service.service.js';
import { customerPhone, dispatcherIds, notifyUsers, slaDue } from './service.service.js';

/**
 * IoT-connected service (module 12 §2, IOT-01/03/04/05/06/07): ThingsBoard alarms arrive on a signed
 * webhook, are mapped to an installed asset, deduplicated (one active alarm per device + alarm type)
 * and — for critical/major alarms — open a ticket (coverage + SLA like any ticket) and an unscheduled
 * corrective work order. Closing the job acknowledges and clears the alarm back in ThingsBoard.
 */

export type AlarmRow = typeof iotAlarm.$inferSelect;
export const TB_STATUSES = ['ACTIVE_UNACK', 'ACTIVE_ACK', 'CLEARED_UNACK', 'CLEARED_ACK'] as const;
export type TbStatus = (typeof TB_STATUSES)[number];

/** Read at call time so tests and deployments can set the env without a restart of the module graph. */
export function tbEnv() {
  return {
    webhookSecret: process.env.THINGSBOARD_WEBHOOK_SECRET ?? '',
    url: (process.env.THINGSBOARD_URL ?? '').replace(/\/+$/, ''),
    username: process.env.THINGSBOARD_USERNAME ?? '',
    password: process.env.THINGSBOARD_PASSWORD ?? '',
  };
}

/** X-MMC-Signature = hex HMAC-SHA256(raw body, THINGSBOARD_WEBHOOK_SECRET); "sha256=<hex>" is accepted too. */
export function verifyTbSignature(raw: Buffer, header: string | undefined): boolean {
  const secret = tbEnv().webhookSecret;
  if (!secret || !header) return false;
  const sig = header.trim().replace(/^sha256=/i, '').toLowerCase();
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// ───────────────────────── ThingsBoard REST client ─────────────────────────

/**
 * Minimal ThingsBoard client for alarm state sync (IOT-05): JWT from POST /api/auth/login, cached
 * until shortly before it expires; ack + clear via POST /api/alarm/{id}/ack and /clear.
 * Sandbox (no THINGSBOARD_URL/USERNAME/PASSWORD): logs and reports success so syncedAt is set.
 */
export class ThingsBoardClient {
  private token: { value: string; exp: number } | null = null;

  get sandbox() {
    const e = tbEnv();
    return !e.url || !e.username || !e.password;
  }

  private async login(): Promise<string> {
    if (this.token && this.token.exp - 60_000 > Date.now()) return this.token.value;
    const e = tbEnv();
    const res = await fetch(`${e.url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: e.username, password: e.password }) });
    if (!res.ok) throw new Error(`ThingsBoard login failed: ${res.status}`);
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new Error('ThingsBoard login returned no token');
    let exp = Date.now() + 30 * 60_000;
    try {
      const claims = JSON.parse(Buffer.from(body.token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
      if (claims.exp) exp = claims.exp * 1000;
    } catch { /* opaque token: keep the 30-minute default */ }
    this.token = { value: body.token, exp };
    return body.token;
  }

  private async post(path: string): Promise<void> {
    const call = async () => fetch(`${tbEnv().url}${path}`, { method: 'POST', headers: { 'X-Authorization': `Bearer ${await this.login()}` } });
    let res = await call();
    if (res.status === 401) { this.token = null; res = await call(); }
    if (!res.ok) throw new Error(`ThingsBoard ${path} → ${res.status}`);
  }

  /** Acknowledge, then clear. Returns the mode used. */
  async ackAndClear(alarmId: string): Promise<'sandbox' | 'live'> {
    if (this.sandbox) {
      console.log(`[thingsboard:sandbox] ack + clear alarm ${alarmId}`);
      return 'sandbox';
    }
    const id = encodeURIComponent(alarmId);
    await this.post(`/api/alarm/${id}/ack`);
    await this.post(`/api/alarm/${id}/clear`);
    return 'live';
  }
}

export const thingsBoard = new ThingsBoardClient();

// ───────────────────────── device → asset ─────────────────────────

/** IOT-01: bound device id, else serial, else MAC — active devices first. */
export async function assetForDevice(tx: Tx, keys: (string | null | undefined)[]) {
  const ids = [...new Set(keys.map((k) => k?.trim()).filter((k): k is string => !!k))];
  if (!ids.length) return null;
  const lower = ids.map((k) => k.toLowerCase());
  const pick = async (where: SQL) => (await tx.select().from(installedAsset).where(where).orderBy(sql`case when ${installedAsset.status} = 'active' then 0 else 1 end`, desc(installedAsset.updatedAt)).limit(1))[0] ?? null;
  const inList = (col: SQL) => sql`${col} in (${sql.join(lower.map((k) => sql`${k}`), sql`, `)})`;
  const byBinding = await pick(inList(sql`lower(${installedAsset.iotDeviceId})`));
  if (byBinding) return byBinding;
  const bySerial = await pick(inList(sql`lower(${installedAsset.serial})`));
  if (bySerial) return bySerial;
  const macs = [...new Set(ids.map((k) => normalizeMac(k)).filter((m): m is string => !!m))];
  return macs.length ? pick(inArray(installedAsset.mac, macs)) : null;
}

/** Users whose roles grant iot.manage (unknown devices are routed to them). */
export async function iotManagerIds(tx: Tx): Promise<string[]> {
  const rows = await tx.selectDistinct({ id: appUser.id }).from(appUser)
    .innerJoin(userRole, eq(userRole.userId, appUser.id)).innerJoin(role, eq(role.id, userRole.roleId))
    .where(and(sql`${role.grants} ->> 'iot.manage' is not null`, sql`${appUser.status} <> 'suspended'`));
  return rows.map((r) => r.id);
}

// ───────────────────────── templates ─────────────────────────

export const IOT_TEMPLATE = {
  key: 'iot_alert', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_iot_alert', variables: ['name', 'device', 'number'],
  body: 'مرحبًا {{name}}، رصدت منظومة المراقبة لدى المدى المبارك تنبيهًا في الجهاز {{device}}. تم فتح طلب الصيانة رقم {{number}} وسيتواصل معكم فريق الدعم الفني.',
};

export async function ensureIotTemplate(tx: Tx) {
  await tx.insert(messageTemplate).values(IOT_TEMPLATE).onConflictDoNothing();
}

// ───────────────────────── alarm intake ─────────────────────────

export interface AlarmPayload {
  alarmId: string;
  deviceName?: string | null;
  deviceId?: string | null;
  type: string;
  severity: string;
  status: TbStatus;
  ts?: number | string | null;
  details?: unknown;
}

const isActive = (s: TbStatus) => s.startsWith('ACTIVE');
const coreStatus = (s: TbStatus) => (s === 'ACTIVE_ACK' ? 'acknowledged' : isActive(s) ? 'active' : 'cleared');

function alarmTime(ts: AlarmPayload['ts']): Date {
  if (ts === null || ts === undefined || ts === '') return new Date();
  const n = typeof ts === 'number' ? ts : /^\d+$/.test(ts) ? Number(ts) : Date.parse(ts);
  const d = new Date(typeof n === 'number' && n < 1e12 ? n * 1000 : n);
  // ignore clocks far in the future / nonsense values
  return Number.isFinite(d.getTime()) && d.getTime() < Date.now() + 5 * 60_000 ? d : new Date();
}

const deviceLabel = (a: { code: string; serial: string | null } | null, key: string) => (a ? [a.code, a.serial].filter(Boolean).join(' / ') : key);

/**
 * One ThingsBoard alarm event (IOT-03/04). Idempotent on the alarm id; repeats of the same device +
 * alarm type while active (or within the dedup window) are merged into the open alarm.
 */
export async function ingestAlarm(tx: Tx, p: AlarmPayload) {
  const deviceKey = (p.deviceName || p.deviceId || '').trim();
  const at = alarmTime(p.ts);
  const status = coreStatus(p.status);
  const dedupKey = alarmDedupKey(deviceKey, p.type);
  const raw = { ...p } as Record<string, unknown>;

  // 1) the same ThingsBoard alarm again (re-delivery or a state change)
  const [same] = await tx.select().from(iotAlarm).where(or(eq(iotAlarm.externalId, p.alarmId), sql`${iotAlarm.raw} -> 'mergedIds' ? ${p.alarmId}`));
  if (same) {
    if (status === 'cleared') return { ...(await clearAlarm(tx, same, at)), duplicate: true };
    const set: Partial<typeof iotAlarm.$inferInsert> = { lastSeenAt: at > same.lastSeenAt ? at : same.lastSeenAt, updatedAt: new Date() };
    if (status === 'acknowledged' && same.status === 'active') set.status = 'acknowledged';
    await tx.update(iotAlarm).set(set).where(eq(iotAlarm.id, same.id));
    return { alarmId: same.id, ticketId: same.ticketId, action: 'duplicate' as const, duplicate: true };
  }

  // 2) a new alarm id for a device + type that is still active, or was seen within the window → merge
  const windowStart = new Date(Date.now() - ALARM_DEDUP_WINDOW_MIN * 60_000);
  const [open] = await tx.select().from(iotAlarm).where(and(eq(iotAlarm.dedupKey, dedupKey), or(inArray(iotAlarm.status, ['active', 'acknowledged']), gte(iotAlarm.lastSeenAt, windowStart))))
    .orderBy(desc(iotAlarm.lastSeenAt)).limit(1);
  if (open) {
    const mergedIds = [...new Set([...(((open.raw as { mergedIds?: string[] }).mergedIds) ?? []), p.alarmId])];
    if (status === 'cleared') {
      await tx.update(iotAlarm).set({ raw: { ...open.raw, mergedIds }, updatedAt: new Date() }).where(eq(iotAlarm.id, open.id));
      return { ...(await clearAlarm(tx, { ...open, raw: { ...open.raw, mergedIds } }, at)), duplicate: true };
    }
    await tx.update(iotAlarm).set({
      occurrences: sql`${iotAlarm.occurrences} + 1`, lastSeenAt: at > open.lastSeenAt ? at : open.lastSeenAt, raw: { ...open.raw, mergedIds, last: raw },
      // a repeat inside the window re-opens a just-cleared alarm (no new ticket)
      ...(open.status === 'cleared' ? { status, clearedAt: null, syncedAt: null } : {}),
      updatedAt: new Date(),
    }).where(eq(iotAlarm.id, open.id));
    return { alarmId: open.id, ticketId: open.ticketId, action: 'merged' as const, duplicate: false };
  }

  // 3) a new alarm
  const asset = await assetForDevice(tx, [p.deviceName, p.deviceId]);
  const [row] = await tx.insert(iotAlarm).values({
    externalId: p.alarmId, deviceId: deviceKey, dedupKey, alarmType: p.type, severity: p.severity.toUpperCase(), status, assetId: asset?.id ?? null,
    firstSeenAt: at, lastSeenAt: at, clearedAt: status === 'cleared' ? at : null, raw,
  }).returning();
  const alarm = row!;
  await audit(tx, null, 'create', 'iot_alarm', alarm.id, null, { externalId: p.alarmId, device: deviceKey, type: p.type, severity: alarm.severity, status, asset: asset?.code ?? null });
  if (!asset) {
    await notifyUsers(tx, await iotManagerIds(tx), { kind: 'iot', titleAr: `📡 تنبيه من جهاز غير مربوط: ${deviceKey} — ${p.type} (${alarm.severity})`, titleEn: `Alarm from an unbound device ${deviceKey}`, link: '/iot?status=unbound' });
    return { alarmId: alarm.id, ticketId: null, action: 'unknown_device' as const, duplicate: false };
  }
  const decision = alarmAction(p.severity);
  if (status === 'cleared' || !decision.createTicket) return { alarmId: alarm.id, ticketId: null, action: 'logged' as const, duplicate: false };
  const t = await createAlarmTicket(tx, alarm, asset, p, decision.priority ?? 'normal');
  return { alarmId: alarm.id, ticketId: t.ticketId, workOrderId: t.workOrderId, ticketNumber: t.number, action: 'ticket' as const, duplicate: false };
}

/** Ticket (coverage + SLA from the shared helpers) + unscheduled corrective work order + notifications. */
async function createAlarmTicket(tx: Tx, alarm: AlarmRow, asset: typeof installedAsset.$inferSelect, p: AlarmPayload, priority: string) {
  const siteId = asset.siteId ?? null;
  const [s] = siteId ? await tx.select({ partyId: site.partyId, name: site.name }).from(site).where(eq(site.id, siteId)) : [];
  const partyId = asset.partyId ?? s?.partyId ?? null;
  const cov = await coverageFor(tx, { siteId, asset });
  const now = new Date();
  const { number } = await nextNumber(tx, 'ticket');
  const device = deviceLabel(asset, alarm.deviceId);
  const details = p.details && typeof p.details === 'object' ? JSON.stringify(p.details).slice(0, 1500) : p.details ? String(p.details).slice(0, 1500) : null;
  const description = [`تنبيه ThingsBoard (${alarm.severity}) — الجهاز ${device}`, `ThingsBoard alarm ${p.alarmId}`, details].filter(Boolean).join('\n');
  const [t] = await tx.insert(ticket).values({
    createdAt: now, updatedAt: now, number, channel: 'iot', partyId, siteId, locationId: asset.locationId ?? null, assetId: asset.id,
    subject: `تنبيه جهاز: ${p.type}`.slice(0, 300), description, priority, status: 'open',
    coverage: cov.coverage, coverageReason: cov.reasonAr, agreementId: cov.agreementId, ...(await slaDue(tx, now, cov.sla)),
  }).returning();
  await audit(tx, null, 'create', 'ticket', t!.id, null, { number, via: 'iot', alarm: p.alarmId, coverage: cov.coverage, agreement: cov.agreementNumber, priority });
  await emit(tx, 'ticket', t!.id, 'ticket.created', { number, coverage: cov.coverage, channel: 'iot' });

  const type: WorkOrderType = cov.coverage === 'warranty' ? 'warranty' : 'corrective';
  const { number: woNumber } = await nextNumber(tx, 'work_order');
  const [wo] = await tx.insert(workOrder).values({
    number: woNumber, type, status: 'new', title: `تنبيه جهاز: ${p.type}`.slice(0, 300), description, ticketId: t!.id,
    partyId, siteId, locationId: asset.locationId ?? null, assetId: asset.id, coverage: cov.coverage, coverageReason: cov.reasonAr, agreementId: cov.agreementId, checklist: defaultChecklist(type),
  }).returning();
  await audit(tx, null, 'create', 'work_order', wo!.id, null, { number: woNumber, type, coverage: cov.coverage, ticket: number, via: 'iot' });
  await emit(tx, 'work_order', wo!.id, 'work_order.created', { number: woNumber, type });

  await tx.update(iotAlarm).set({ ticketId: t!.id, updatedAt: new Date() }).where(eq(iotAlarm.id, alarm.id));
  await notifyUsers(tx, await dispatcherIds(tx), { kind: 'ticket', titleAr: `🚨 تنبيه جهاز ${number} — ${device}${s?.name ? ` (${s.name})` : ''}: ${p.type}`, titleEn: `IoT alarm ${number} — ${device}: ${p.type}`, link: `/field/tickets/${t!.id}` });
  // customer notice (utility template) — never blocks the intake
  try {
    const c = await customerPhone(tx, partyId);
    if (c.to) {
      await ensureIotTemplate(tx);
      await tx.transaction((sp) => sendTemplate(sp, { channel: 'whatsapp', to: c.to!, templateKey: 'iot_alert', vars: { name: c.name, device, number }, related: { type: 'ticket', id: t!.id }, link: { partyId, contactId: c.contactId } }));
    }
  } catch (e) {
    console.warn(`[iot] customer notice ${number}:`, (e as Error).message);
  }
  return { ticketId: t!.id, workOrderId: wo!.id, number };
}

/** Device cleared the alarm. If nobody has started on the ticket yet, leave a note on it. */
async function clearAlarm(tx: Tx, a: AlarmRow, at: Date) {
  if (a.status !== 'cleared') await tx.update(iotAlarm).set({ status: 'cleared', clearedAt: at, lastSeenAt: at > a.lastSeenAt ? at : a.lastSeenAt, updatedAt: new Date() }).where(eq(iotAlarm.id, a.id));
  let noted = false;
  if (a.ticketId && a.status !== 'cleared') {
    const [t] = await tx.select().from(ticket).where(eq(ticket.id, a.ticketId));
    const started = await tx.select({ id: workOrder.id }).from(workOrder).where(and(eq(workOrder.ticketId, a.ticketId), sql`(${workOrder.status} not in ('new', 'scheduled', 'cancelled') or ${workOrder.checkInAt} is not null)`)).limit(1);
    if (t && !['resolved', 'closed'].includes(t.status) && !started.length) {
      await audit(tx, null, 'note', 'ticket', t.id, null, { note: `زال التنبيه "${a.alarmType}" من الجهاز تلقائيًا — تحقّق قبل إرسال الفني. / The device cleared the alarm by itself — check before dispatching.`, alarm: a.externalId });
      await tx.update(ticket).set({ updatedAt: new Date() }).where(eq(ticket.id, t.id));
      noted = true;
    }
  }
  return { alarmId: a.id, ticketId: a.ticketId, action: 'cleared' as const, noted };
}

/**
 * IOT-05: the linked work order completed / the ticket was resolved or closed → ack + clear in
 * ThingsBoard (every alarm merged into it too) and mark the alarm synced. Never throws.
 */
export async function syncAlarmsForTicket(tx: Tx, ticketId: string | null | undefined) {
  if (!ticketId) return { synced: 0 };
  const rows = await tx.select().from(iotAlarm).where(and(eq(iotAlarm.ticketId, ticketId), isNull(iotAlarm.syncedAt)));
  let synced = 0;
  for (const a of rows) {
    try {
      const ids = [a.externalId, ...(((a.raw as { mergedIds?: string[] }).mergedIds) ?? [])];
      let mode: 'sandbox' | 'live' = 'sandbox';
      for (const id of ids) mode = await thingsBoard.ackAndClear(id);
      const now = new Date();
      await tx.update(iotAlarm).set({ status: 'cleared', clearedAt: a.clearedAt ?? now, syncedAt: now, updatedAt: now }).where(eq(iotAlarm.id, a.id));
      await audit(tx, null, 'iot_sync', 'iot_alarm', a.id, { status: a.status }, { status: 'cleared', mode, alarmIds: ids });
      synced++;
    } catch (e) {
      console.warn(`[iot] ThingsBoard sync for alarm ${a.externalId}:`, (e as Error).message);
    }
  }
  return { synced };
}

// ───────────────────────── heartbeat & health ─────────────────────────

export async function heartbeat(tx: Tx, b: { deviceName: string; online: boolean; ts?: number | string | null }) {
  const asset = await assetForDevice(tx, [b.deviceName]);
  if (!asset) return { ok: true, matched: false };
  const at = alarmTime(b.ts);
  if (asset.iotLastSeenAt && asset.iotLastSeenAt > at) return { ok: true, matched: true, assetId: asset.id, stale: true };
  await tx.update(installedAsset).set({ iotOnline: b.online, iotLastSeenAt: at }).where(eq(installedAsset.id, asset.id));
  return { ok: true, matched: true, assetId: asset.id, online: b.online };
}

const ACTIVE = ['active', 'acknowledged'];

/** Devices bound to ThingsBoard on a site, online share and active alarms (IOT-07). */
export async function siteHealth(tx: Tx, siteId: string, opts: { detail: boolean }) {
  const [s] = await tx.select({ id: site.id, name: site.name, city: site.city, partyId: site.partyId }).from(site).where(eq(site.id, siteId));
  if (!s) throw notFound('site');
  const devices = await tx.select().from(installedAsset).where(and(eq(installedAsset.siteId, siteId), eq(installedAsset.status, 'active'), sql`${installedAsset.iotDeviceId} is not null`)).orderBy(installedAsset.code, installedAsset.serial);
  const online = devices.filter((d) => d.iotOnline === true).length;
  const alarms = await tx.select({ a: iotAlarm, code: installedAsset.code, serial: installedAsset.serial, ticketNumber: ticket.number })
    .from(iotAlarm).innerJoin(installedAsset, eq(installedAsset.id, iotAlarm.assetId)).leftJoin(ticket, eq(ticket.id, iotAlarm.ticketId))
    .where(and(eq(installedAsset.siteId, siteId), inArray(iotAlarm.status, ACTIVE))).orderBy(desc(iotAlarm.lastSeenAt));
  const summary = {
    siteId, siteName: s.name, devicesBound: devices.length, online, offline: devices.filter((d) => d.iotOnline === false).length,
    onlinePercent: devices.length ? Math.round((online / devices.length) * 1000) / 10 : null, activeAlarms: alarms.length,
  };
  if (!opts.detail) return summary;
  const paths = await locationPaths(tx, devices.map((d) => d.locationId));
  return {
    ...summary, city: s.city, partyId: s.partyId,
    devices: devices.map((d) => ({ id: d.id, code: d.code, serial: d.serial, mac: d.mac, iotDeviceId: d.iotDeviceId, online: d.iotOnline, lastSeenAt: d.iotLastSeenAt, locationPath: d.locationId ? paths.get(d.locationId) ?? null : null })),
    alarms: alarms.map((r) => ({ ...r.a, assetCode: r.code, assetSerial: r.serial, ticketNumber: r.ticketNumber })),
  };
}
