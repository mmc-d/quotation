import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  agreementVisit, and, appUser, contact, desc, emit, eq, gte, inArray, isNull, lte, messageTemplate, nextNumber, notification, or, party, paymentRequest, role, serviceAgreement, site, sql, ticket, userRole, workOrder,
  type SQL, type Tx,
} from '@mmc/db';
import {
  addMonths, billingSchedule, dec, defaultChecklist, halalasToFixed, nextBusinessDay, normalizePhone, renewalPrice, riyadhDate, slaState, slaTargets, TIER_DEFAULTS, toHalalas, VAT_RATE, visitSchedule,
  type AgreementTier, type BillingFrequency,
} from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { loadCompany } from '../common/company.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { sendTemplate } from '../common/messaging.js';
import { payments } from '../common/payments.js';
import { assertCan, scopeFilter } from '../common/scope.js';
import { config } from '../config.js';
import { addDays, loadCalendar } from './calendar.controller.js';
import { newToken, sendPaymentRequest } from './finance.service.js';

/**
 * Service agreements (AMC), SLAs and CSAT — module 06 §2.4–2.5, Phase 7b. Pure rules live in
 * @mmc/domain (service.ts); this file holds the persistence: agreement lifecycle (activate → visits +
 * payment requests per billing period, renew with uplift, cancel), the coverage look-up used by
 * field service, SLA targets / state, the scheduled jobs (per tenant) and the CSAT link.
 *
 * Kept free of imports from field-service.service (which imports this file) to avoid a module cycle.
 */

export type AgreementRow = typeof serviceAgreement.$inferSelect;
export type TicketSlaInput = Pick<typeof ticket.$inferSelect, 'createdAt' | 'updatedAt' | 'status' | 'slaResponseDue' | 'slaResolutionDue' | 'firstResponseAt' | 'resolvedAt'>;
export interface SlaPolicy { responseHours: number; resolutionHours: number; coverage: 'business' | '24x7' }

/** Company default SLA for calls not under an agreement. */
export const DEFAULT_SLA: SlaPolicy = { responseHours: 24, resolutionHours: 72, coverage: 'business' };

// ───────────────────────── scope ─────────────────────────

export const agreementFilter = (actor: RequestActor, perm: 'agreement.read' | 'agreement.write') =>
  scopeFilter(actor, perm, { owner: serviceAgreement.ownerId, team: serviceAgreement.teamId, branch: serviceAgreement.branchId });

export async function loadAgreement(tx: Tx, actor: RequestActor | null, id: string, perm: 'agreement.read' | 'agreement.write' = 'agreement.read') {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('agreement');
  const [a] = await tx.select().from(serviceAgreement).where(eq(serviceAgreement.id, id));
  if (!a) throw notFound('agreement');
  if (actor) assertCan(actor, perm, a);
  return a;
}

// ───────────────────────── coverage & SLA ─────────────────────────

/** Statuses whose term still covers calls: a renewed agreement covers until its own end date. */
const COVERING = ['active', 'renewed'];

/**
 * The active agreement covering a device (explicit asset list, or every device of a covered site
 * when the list is empty) or — with no device — a covered site, on `today`.
 */
export async function activeAgreementFor(tx: Tx, i: { siteId?: string | null; assetId?: string | null; today: string }): Promise<AgreementRow | null> {
  const conds: (SQL | undefined)[] = [];
  if (i.assetId) conds.push(sql`${serviceAgreement.assetIds} @> ${JSON.stringify([i.assetId])}::jsonb`);
  if (i.siteId) conds.push(and(sql`${serviceAgreement.siteIds} @> ${JSON.stringify([i.siteId])}::jsonb`, i.assetId ? sql`jsonb_array_length(${serviceAgreement.assetIds}) = 0` : undefined));
  const any = conds.filter((c): c is SQL => !!c);
  if (!any.length) return null;
  const [a] = await tx.select().from(serviceAgreement)
    .where(and(inArray(serviceAgreement.status, COVERING), lte(serviceAgreement.startDate, i.today), gte(serviceAgreement.endDate, i.today), or(...any)))
    .orderBy(desc(serviceAgreement.endDate)).limit(1);
  return a ?? null;
}

export function slaPolicyOf(a: Pick<AgreementRow, 'responseHours' | 'resolutionHours' | 'coverage'> | null | undefined): SlaPolicy {
  return a ? { responseHours: a.responseHours, resolutionHours: a.resolutionHours, coverage: a.coverage === '24x7' ? '24x7' : 'business' } : DEFAULT_SLA;
}

/** SLA due instants for a ticket opened at `openedAt` (company calendar for business-hour clocks). */
export async function slaDue(tx: Tx, openedAt: Date, policy: SlaPolicy) {
  const t = slaTargets(openedAt, policy, await loadCalendar(tx));
  return { slaResponseDue: t.responseDue, slaResolutionDue: t.resolutionDue };
}

const doneAt = (t: TicketSlaInput) => (['resolved', 'closed'].includes(t.status) ? t.resolvedAt ?? t.updatedAt : null);

/** SLA state for response and resolution (ok / at_risk / breached / met), or null without targets. */
export function ticketSla(t: TicketSlaInput, now = new Date()) {
  const part = (due: Date | null, done: Date | null) => (due ? { due: due.toISOString(), doneAt: done?.toISOString() ?? null, state: slaState(t.createdAt, due, done, now) } : null);
  return { response: part(t.slaResponseDue, t.firstResponseAt), resolution: part(t.slaResolutionDue, doneAt(t)) };
}

const doneSql = sql`(case when ${ticket.status} in ('resolved', 'closed') then coalesce(${ticket.resolvedAt}, ${ticket.updatedAt}) end)`;
const breachedSql = sql`((${ticket.slaResponseDue} is not null and coalesce(${ticket.firstResponseAt}, now()) > ${ticket.slaResponseDue})
  or (${ticket.slaResolutionDue} is not null and coalesce(${doneSql}, now()) > ${ticket.slaResolutionDue}))`;
const atRiskSql = sql`((${ticket.firstResponseAt} is null and ${ticket.slaResponseDue} is not null and now() >= ${ticket.createdAt} + (${ticket.slaResponseDue} - ${ticket.createdAt}) * 0.75)
  or (${doneSql} is null and ${ticket.slaResolutionDue} is not null and now() >= ${ticket.createdAt} + (${ticket.slaResolutionDue} - ${ticket.createdAt}) * 0.75))`;

/** List filter: sla=at_risk (not breached yet, ≥ 75% of a window used) | breached. */
export function slaFilter(kind: string | undefined): SQL | undefined {
  if (kind === 'breached') return breachedSql;
  if (kind === 'at_risk') return and(sql`not ${breachedSql}`, atRiskSql);
  return undefined;
}

/** First staff action on a ticket (status change, work order, reply) stops the response clock. */
export async function markFirstResponse(tx: Tx, ticketId: string | null | undefined, at = new Date()) {
  if (!ticketId) return;
  await tx.update(ticket).set({ firstResponseAt: at }).where(and(eq(ticket.id, ticketId), isNull(ticket.firstResponseAt)));
}

// ───────────────────────── message templates ─────────────────────────

export const SERVICE_TEMPLATES = [
  { key: 'csat_request', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_csat_request', variables: ['name', 'number', 'link'],
    body: 'مرحبًا {{name}}، شكرًا لاختياركم المدى المبارك. كيف تقيّمون خدمة أمر العمل رقم {{number}}؟ قيّمونا بنقرة واحدة: {{link}}' },
  { key: 'portal_otp', channel: 'whatsapp', category: 'authentication', language: 'ar', providerTemplateName: 'mmc_otp', variables: ['code'],
    body: 'رمز الدخول إلى بوابة عملاء المدى المبارك: {{code}} — صالح لمدة 10 دقائق. لا تشاركه مع أحد.' },
  { key: 'portal_invite', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_portal_invite', variables: ['name', 'link'],
    body: 'مرحبًا {{name}}، يمكنكم الآن متابعة أجهزتكم وطلبات الصيانة والفواتير عبر بوابة عملاء المدى المبارك: {{link}} — الدخول برمز يصلكم على واتساب.' },
  { key: 'amc_renewal', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_amc_renewal', variables: ['name', 'number', 'end', 'link'],
    body: 'مرحبًا {{name}}، ينتهي عقد الصيانة رقم {{number}} بتاريخ {{end}}. لتجديد العقد واستمرار التغطية تواصلوا معنا أو تابعوا عبر البوابة: {{link}}' },
  { key: 'amc_visit_due', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_amc_visit_due', variables: ['name', 'number', 'date'],
    body: 'مرحبًا {{name}}، زيارة الصيانة الوقائية ضمن عقد الصيانة {{number}} مستحقة بتاريخ {{date}}. سنتواصل معكم لتحديد الموعد المناسب.' },
];

/** Tenants seeded before Phase 7b get the templates on first use (same values as the seed). */
export async function ensureServiceTemplates(tx: Tx) {
  await tx.insert(messageTemplate).values(SERVICE_TEMPLATES).onConflictDoNothing();
}

/** Best customer number for a party (primary contact WhatsApp/mobile, else the party phone). */
export async function customerPhone(tx: Tx, partyId: string | null | undefined, preferred?: string | null) {
  const [p] = partyId ? await tx.select({ nameAr: party.nameAr, phone: party.phone }).from(party).where(eq(party.id, partyId)) : [];
  const contacts = partyId ? await tx.select().from(contact).where(and(eq(contact.partyId, partyId), isNull(contact.archivedAt))) : [];
  const c = contacts.sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary))[0];
  const raw = preferred || c?.whatsapp || c?.mobile || p?.phone;
  return { to: raw ? normalizePhone(raw) : null, name: c?.name || p?.nameAr || '', contactId: c?.id ?? null };
}

// ───────────────────────── notifications ─────────────────────────

/** Active users whose roles grant workorder.dispatch. */
export async function dispatcherIds(tx: Tx): Promise<string[]> {
  const rows = await tx.selectDistinct({ id: appUser.id }).from(appUser)
    .innerJoin(userRole, eq(userRole.userId, appUser.id)).innerJoin(role, eq(role.id, userRole.roleId))
    .where(and(sql`${role.grants} ->> 'workorder.dispatch' is not null`, sql`${appUser.status} <> 'suspended'`));
  return rows.map((r) => r.id);
}

export async function notifyUsers(tx: Tx, userIds: (string | null | undefined)[], n: { kind: string; titleAr: string; titleEn?: string | null; link?: string | null }) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length) await tx.insert(notification).values(ids.map((userId) => ({ userId, kind: n.kind, titleAr: n.titleAr.slice(0, 300), titleEn: n.titleEn ?? null, link: n.link ?? null })));
  return ids.length;
}

// ───────────────────────── agreement lifecycle ─────────────────────────

export const TIERS = Object.keys(TIER_DEFAULTS) as AgreementTier[];

/** Sites an agreement visits: its siteIds, or the sites of its explicit devices. */
export async function agreementSites(tx: Tx, a: Pick<AgreementRow, 'siteIds' | 'assetIds'>): Promise<string[]> {
  if (a.siteIds.length) return [...new Set(a.siteIds)];
  if (!a.assetIds.length) return [];
  const rows = await tx.execute<{ site_id: string }>(sql`select distinct site_id::text as site_id from installed_asset where id in (${sql.join(a.assetIds.map((i) => sql`${i}::uuid`), sql`, `)}) and site_id is not null`);
  return [...rows].map((r) => r.site_id);
}

/** Does the company charge VAT on this agreement? */
export async function vatApplies(tx: Tx, a: Pick<AgreementRow, 'vatOn'>) {
  return (await loadCompany(tx)).vatRegistered && a.vatOn;
}

/**
 * Billing periods with VAT. VAT is spread cumulatively so the requests add up exactly to
 * price + round(price × 15%) (each period's 388 is issued tax-inclusive for exactly its request).
 */
export function billingWithVat(start: string, end: string, priceHalalas: number, frequency: BillingFrequency, withVat: boolean) {
  const periods = billingSchedule(start, end, priceHalalas, frequency);
  let cumNet = 0;
  let cumVat = 0;
  return periods.map((p) => {
    cumNet += p.amount;
    const vatToDate = withVat ? dec(cumNet).times(VAT_RATE).div(100).toDecimalPlaces(0).toNumber() : 0;
    const vat = vatToDate - cumVat;
    cumVat = vatToDate;
    return { ...p, net: p.amount, vat, gross: p.amount + vat };
  });
}

export async function activateAgreement(tx: Tx, actor: RequestActor | null, id: string) {
  const a = await loadAgreement(tx, actor, id, 'agreement.write');
  if (a.status !== 'draft') throw badRequest(`a ${a.status} agreement cannot be activated`);
  if (a.endDate < a.startDate) throw badRequest('the end date is before the start date');
  const sites = await agreementSites(tx, a);
  if (!sites.length) throw badRequest('the agreement covers no site or device');
  const cal = await loadCalendar(tx);
  const visits: { siteId: string; dueDate: string }[] = [];
  for (const s of sites) for (const due of visitSchedule(a.startDate, a.endDate, a.visitsPerYear, cal)) visits.push({ siteId: s, dueDate: due });
  if (visits.length) await tx.insert(agreementVisit).values(visits.map((v) => ({ agreementId: a.id, siteId: v.siteId, dueDate: v.dueDate, status: 'planned', createdBy: actor?.userId ?? null, updatedBy: actor?.userId ?? null })));
  const withVat = await vatApplies(tx, a);
  const periods = toHalalas(a.price) > 0 ? billingWithVat(a.startDate, a.endDate, toHalalas(a.price), a.billingFrequency as BillingFrequency, withVat) : [];
  const requests: string[] = [];
  for (const p of periods) {
    const { number } = await nextNumber(tx, 'payment_request');
    const token = newToken();
    const amount = halalasToFixed(p.gross);
    const link = await payments().createLink({ amount, description: `${a.number} — ${p.from} → ${p.to}`, reference: number, returnUrl: `${config.publicBaseUrl}/p/${token}`, publicToken: token });
    await tx.insert(paymentRequest).values({
      number, partyId: a.partyId, amount, dueDate: nextBusinessDay(p.from, cal), status: 'draft', publicToken: token, paymentLinkUrl: link.url, paymentLinkProviderId: link.providerId,
      agreementId: a.id, periodFrom: p.from, periodTo: p.to, createdBy: actor?.userId ?? null,
    });
    requests.push(number);
  }
  await tx.update(serviceAgreement).set({ status: 'active', updatedAt: new Date(), updatedBy: actor?.userId ?? null, version: a.version + 1 }).where(eq(serviceAgreement.id, a.id));
  if (a.renewalOfId) {
    const [old] = await tx.select().from(serviceAgreement).where(eq(serviceAgreement.id, a.renewalOfId));
    if (old && ['active', 'expired'].includes(old.status)) {
      await tx.update(serviceAgreement).set({ status: 'renewed', updatedAt: new Date(), updatedBy: actor?.userId ?? null, version: old.version + 1 }).where(eq(serviceAgreement.id, old.id));
      await audit(tx, actor, 'status_renewed', 'service_agreement', old.id, { status: old.status }, { status: 'renewed', renewal: a.number });
    }
  }
  await audit(tx, actor, 'status_active', 'service_agreement', a.id, { status: a.status }, { status: 'active', visits: visits.length, paymentRequests: requests, vat: withVat });
  await emit(tx, 'service_agreement', a.id, 'service_agreement.activated', { number: a.number });
  return { visits: visits.length, paymentRequests: requests };
}

/** Term of an agreement in whole months when it is month-aligned, else in days. */
function termOf(start: string, end: string): { months: number } | { days: number } {
  const after = addDays(end, 1);
  const months = (Number(after.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(after.slice(5, 7)) - Number(start.slice(5, 7));
  if (months > 0 && addMonths(start, months) === after) return { months };
  return { days: Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) };
}

/** Renewal (FSM-65): a new draft for the next term at the uplifted price; the old one → renewed on activation. */
export async function renewAgreement(tx: Tx, actor: RequestActor | null, id: string) {
  const a = await loadAgreement(tx, actor, id, 'agreement.write');
  if (!['active', 'expired'].includes(a.status)) throw badRequest(`a ${a.status} agreement cannot be renewed`);
  const [open] = await tx.select({ number: serviceAgreement.number }).from(serviceAgreement).where(and(eq(serviceAgreement.renewalOfId, a.id), inArray(serviceAgreement.status, ['draft', 'active'])));
  if (open) throw conflict(`renewal ${open.number} already exists`);
  const start = addDays(a.endDate, 1);
  const term = termOf(a.startDate, a.endDate);
  const end = 'months' in term ? addDays(addMonths(start, term.months), -1) : addDays(start, term.days);
  const { number } = await nextNumber(tx, 'service_agreement');
  const [row] = await tx.insert(serviceAgreement).values({
    number, partyId: a.partyId, siteIds: a.siteIds, assetIds: a.assetIds, tier: a.tier, startDate: start, endDate: end, visitsPerYear: a.visitsPerYear,
    responseHours: a.responseHours, resolutionHours: a.resolutionHours, coverage: a.coverage, partsIncluded: a.partsIncluded,
    price: halalasToFixed(renewalPrice(toHalalas(a.price), a.upliftPercent)), billingFrequency: a.billingFrequency, vatOn: a.vatOn, status: 'draft',
    autoRenew: a.autoRenew, upliftPercent: a.upliftPercent, renewalOfId: a.id, notes: a.notes,
    ownerId: a.ownerId, teamId: a.teamId, branchId: a.branchId, createdBy: actor?.userId ?? null, updatedBy: actor?.userId ?? null,
  }).returning();
  await audit(tx, actor, 'renew', 'service_agreement', a.id, null, { renewal: number, price: row!.price, upliftPercent: a.upliftPercent });
  return row!;
}

/** Cancel: future planned visits skipped, unpaid requests for periods not started yet cancelled. */
export async function cancelAgreement(tx: Tx, actor: RequestActor, id: string, reason: string) {
  const a = await loadAgreement(tx, actor, id, 'agreement.write');
  if (!['draft', 'active'].includes(a.status)) throw badRequest(`a ${a.status} agreement cannot be cancelled`);
  const today = riyadhDate();
  await tx.update(serviceAgreement).set({ status: 'cancelled', cancelledAt: today, updatedAt: new Date(), updatedBy: actor.userId, version: a.version + 1 }).where(eq(serviceAgreement.id, id));
  const skipped = await tx.update(agreementVisit).set({ status: 'skipped', updatedAt: new Date(), updatedBy: actor.userId }).where(and(eq(agreementVisit.agreementId, id), eq(agreementVisit.status, 'planned'))).returning({ id: agreementVisit.id });
  const cancelled = await tx.update(paymentRequest).set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(paymentRequest.agreementId, id), inArray(paymentRequest.status, ['draft', 'sent']), sql`${paymentRequest.paidAmount} = 0`, sql`${paymentRequest.periodFrom} > ${today}`)).returning({ number: paymentRequest.number });
  await audit(tx, actor, 'status_cancelled', 'service_agreement', id, { status: a.status }, { status: 'cancelled', visitsSkipped: skipped.length, requestsCancelled: cancelled.map((c) => c.number) }, reason);
  return { visitsSkipped: skipped.length, requestsCancelled: cancelled.map((c) => c.number) };
}

// ───────────────────────── scheduled jobs (one tenant, inside withTenant) ─────────────────────────

const ESC_LABEL: Record<string, { ar: string; en: string }> = {
  response_at_risk: { ar: 'اقترب موعد الاستجابة', en: 'Response SLA at risk' },
  response_breached: { ar: 'تجاوز موعد الاستجابة', en: 'Response SLA breached' },
  resolution_at_risk: { ar: 'اقترب موعد الحل', en: 'Resolution SLA at risk' },
  resolution_breached: { ar: 'تجاوز موعد الحل', en: 'Resolution SLA breached' },
};

/** Every 15 min: at-risk / breached open tickets → in-app notification to the owner + dispatchers (once per key). */
export async function slaEscalationsFor(tx: Tx, now = new Date()) {
  const rows = await tx.select().from(ticket).where(and(inArray(ticket.status, ['open', 'in_progress']), or(sql`${ticket.slaResponseDue} is not null`, sql`${ticket.slaResolutionDue} is not null`)));
  if (!rows.length) return { escalated: 0, notifications: 0 };
  const dispatchers = await dispatcherIds(tx);
  let escalated = 0;
  let sent = 0;
  for (const t of rows) {
    const keys: string[] = [];
    if (t.slaResponseDue && !t.firstResponseAt) {
      const s = slaState(t.createdAt, t.slaResponseDue, null, now);
      if (s === 'at_risk' || s === 'breached') keys.push(`response_${s}`);
    }
    if (t.slaResolutionDue && !t.resolvedAt) {
      const s = slaState(t.createdAt, t.slaResolutionDue, null, now);
      if (s === 'at_risk' || s === 'breached') keys.push(`resolution_${s}`);
    }
    const fresh = keys.filter((k) => !t.slaEscalations.includes(k));
    if (!fresh.length) continue;
    escalated++;
    for (const k of fresh) {
      sent += await notifyUsers(tx, [t.ownerId, ...dispatchers], { kind: 'sla', titleAr: `⚠️ ${ESC_LABEL[k]!.ar} — البلاغ ${t.number}: ${t.subject}`, titleEn: `${ESC_LABEL[k]!.en} — ticket ${t.number}`, link: `/field/tickets/${t.id}` });
    }
    await tx.update(ticket).set({ slaEscalations: [...t.slaEscalations, ...fresh] }).where(eq(ticket.id, t.id));
    await audit(tx, null, 'sla_escalation', 'ticket', t.id, null, { keys: fresh });
  }
  return { escalated, notifications: sent };
}

/** Daily: preventive work orders for planned visits due within `leadDays` (FSM-62). */
export async function preventiveVisitsFor(tx: Tx, today = riyadhDate(), leadDays = 14) {
  const horizon = addDays(today, leadDays);
  const due = await tx.select({ v: agreementVisit, a: serviceAgreement }).from(agreementVisit).innerJoin(serviceAgreement, eq(serviceAgreement.id, agreementVisit.agreementId))
    .where(and(eq(agreementVisit.status, 'planned'), lte(agreementVisit.dueDate, horizon), inArray(serviceAgreement.status, COVERING), gte(agreementVisit.dueDate, serviceAgreement.startDate))).orderBy(agreementVisit.dueDate);
  if (due.length) await ensureServiceTemplates(tx);
  const created: string[] = [];
  for (const { v, a } of due) {
    const { number } = await nextNumber(tx, 'work_order');
    const [wo] = await tx.insert(workOrder).values({
      number, type: 'preventive', status: 'new', title: `زيارة صيانة وقائية — ${a.number}`, description: `موعد الزيارة المخطط: ${v.dueDate}`,
      partyId: a.partyId, siteId: v.siteId, agreementId: a.id, coverage: 'amc', coverageReason: `عقد صيانة ${a.number} ساري حتى ${a.endDate}`, checklist: defaultChecklist('preventive'),
      ownerId: a.ownerId, teamId: a.teamId, branchId: a.branchId,
    }).returning();
    await tx.update(agreementVisit).set({ status: 'generated', workOrderId: wo!.id, updatedAt: new Date() }).where(eq(agreementVisit.id, v.id));
    await audit(tx, null, 'create', 'work_order', wo!.id, null, { number, type: 'preventive', agreement: a.number, visitDue: v.dueDate });
    await emit(tx, 'work_order', wo!.id, 'work_order.created', { number, type: 'preventive' });
    await notifyUsers(tx, [a.ownerId], { kind: 'work_order', titleAr: `🗓️ زيارة وقائية ${number} — ${a.number} (${v.dueDate})`, link: `/field/work-orders/${wo!.id}` });
    try {
      const c = await customerPhone(tx, a.partyId);
      if (c.to) await tx.transaction((sp) => sendTemplate(sp, { channel: 'whatsapp', to: c.to!, templateKey: 'amc_visit_due', vars: { name: c.name, number: a.number, date: v.dueDate }, related: { type: 'work_order', id: wo!.id }, link: { partyId: a.partyId, contactId: c.contactId } }));
    } catch (e) {
      console.warn(`[service] visit notice ${number}:`, (e as Error).message);
    }
    created.push(number);
  }
  return { created: created.length, workOrders: created };
}

/**
 * Daily: active agreements past their end → expired; ending within 30 days without a renewal →
 * owner notification + WhatsApp amc_renewal to the customer (once per term; auto-renew agreements
 * get their renewal draft); AMC payment requests still in draft and due within 7 days are sent.
 */
export async function agreementRenewalsFor(tx: Tx, today = riyadhDate()) {
  const expired = await tx.update(serviceAgreement).set({ status: 'expired', updatedAt: new Date() }).where(and(eq(serviceAgreement.status, 'active'), sql`${serviceAgreement.endDate} < ${today}`)).returning({ id: serviceAgreement.id, number: serviceAgreement.number, ownerId: serviceAgreement.ownerId });
  for (const e of expired) {
    await audit(tx, null, 'status_expired', 'service_agreement', e.id, { status: 'active' }, { status: 'expired' });
    await notifyUsers(tx, [e.ownerId], { kind: 'agreement', titleAr: `انتهى عقد الصيانة ${e.number}`, link: `/service/agreements/${e.id}` });
  }
  const ending = await tx.select().from(serviceAgreement).where(and(eq(serviceAgreement.status, 'active'), lte(serviceAgreement.endDate, addDays(today, 30)), isNull(serviceAgreement.renewalNotifiedAt)));
  let reminded = 0;
  const autoRenewed: string[] = [];
  if (ending.length) await ensureServiceTemplates(tx);
  for (const a of ending) {
    const [renewal] = await tx.select({ id: serviceAgreement.id }).from(serviceAgreement).where(and(eq(serviceAgreement.renewalOfId, a.id), inArray(serviceAgreement.status, ['draft', 'active'])));
    if (renewal) continue;
    if (a.autoRenew) autoRenewed.push((await renewAgreement(tx, null, a.id)).number);
    await notifyUsers(tx, [a.ownerId], { kind: 'agreement', titleAr: `🔁 عقد الصيانة ${a.number} ينتهي في ${a.endDate}${a.autoRenew ? ' — أُنشئت مسودة التجديد' : ' — جهّز التجديد'}`, link: `/service/agreements/${a.id}` });
    try {
      const c = await customerPhone(tx, a.partyId);
      if (c.to) await tx.transaction((sp) => sendTemplate(sp, { channel: 'whatsapp', to: c.to!, templateKey: 'amc_renewal', vars: { name: c.name, number: a.number, end: a.endDate, link: `${config.publicBaseUrl}/portal` }, related: { type: 'service_agreement', id: a.id }, link: { partyId: a.partyId, contactId: c.contactId } }));
    } catch (e) {
      console.warn(`[service] renewal notice ${a.number}:`, (e as Error).message);
    }
    await tx.update(serviceAgreement).set({ renewalNotifiedAt: new Date() }).where(eq(serviceAgreement.id, a.id));
    reminded++;
  }
  const drafts = await tx.select({ id: paymentRequest.id, number: paymentRequest.number }).from(paymentRequest)
    .where(and(sql`${paymentRequest.agreementId} is not null`, eq(paymentRequest.status, 'draft'), lte(paymentRequest.dueDate, addDays(today, 7))));
  let requestsSent = 0;
  for (const pr of drafts) {
    try {
      await tx.transaction((sp) => sendPaymentRequest(sp, null, pr.id, 'whatsapp'));
      requestsSent++;
    } catch (e) {
      console.warn(`[service] AMC request ${pr.number}:`, (e as Error).message);
    }
  }
  return { expired: expired.length, reminded, autoRenewed, requestsSent };
}

// ───────────────────────── CSAT (FSM-87) ─────────────────────────

function csatSign(p: string) {
  return createHmac('sha256', config.authSecret).update(`csat:${p}`).digest('base64url').slice(0, 32);
}

/** Signed, unguessable one-tap survey link for a completed work order. */
export function csatToken(tenantId: string, woId: string): string {
  const p = Buffer.from(`${tenantId}.${woId}`).toString('base64url');
  return `${p}.${csatSign(p)}`;
}

export function parseCsatToken(token: string): { tenantId: string; woId: string } | null {
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const want = Buffer.from(csatSign(p));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [tenantId, woId] = Buffer.from(p, 'base64url').toString().split('.');
  const uuid = /^[0-9a-f-]{36}$/i;
  return tenantId && woId && uuid.test(tenantId) && uuid.test(woId) ? { tenantId, woId } : null;
}

export const csatUrl = (tenantId: string, woId: string) => `${config.publicBaseUrl}/csat/${csatToken(tenantId, woId)}`;

/** WhatsApp the survey link to the customer (ticket caller, primary contact or the customer's phone). */
export async function sendCsatRequest(tx: Tx, tenantId: string, woId: string, sentBy: string | null) {
  const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, woId));
  if (!wo) throw notFound('work order');
  if (!['completed', 'closed'].includes(wo.status)) throw badRequest('the survey is sent once the work order is completed');
  const [t] = wo.ticketId ? await tx.select({ contactName: ticket.contactName, contactPhone: ticket.contactPhone }).from(ticket).where(eq(ticket.id, wo.ticketId)) : [];
  const c = await customerPhone(tx, wo.partyId, t?.contactPhone);
  if (!c.to) return null;
  await ensureServiceTemplates(tx);
  const link = csatUrl(tenantId, wo.id);
  const r = await sendTemplate(tx, { channel: 'whatsapp', to: c.to, templateKey: 'csat_request', vars: { name: t?.contactName || c.name, number: wo.number, link }, related: { type: 'work_order', id: wo.id }, link: { partyId: wo.partyId, contactId: c.contactId }, sentBy });
  return { to: c.to, link, status: r.result.status };
}

// ───────────────────────── reports ─────────────────────────

export async function csatReport(tx: Tx, scope: SQL | undefined, from?: string, to?: string) {
  const rows = await tx.select({ score: workOrder.csatScore, technicianId: workOrder.technicianId }).from(workOrder).where(and(
    scope, sql`${workOrder.csatScore} is not null`,
    from ? sql`${workOrder.csatAt} >= ${from}::date` : undefined, to ? sql`${workOrder.csatAt} < (${to}::date + 1)` : undefined,
  ));
  const distribution: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byTech = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    distribution[String(r.score)] = (distribution[String(r.score)] ?? 0) + 1;
    const k = r.technicianId ?? '';
    const cur = byTech.get(k) ?? { sum: 0, count: 0 };
    byTech.set(k, { sum: cur.sum + r.score!, count: cur.count + 1 });
  }
  const ids = [...byTech.keys()].filter(Boolean);
  const names = ids.length ? await tx.select({ id: appUser.id, nameAr: appUser.nameAr, email: appUser.email }).from(appUser).where(inArray(appUser.id, ids)) : [];
  const avg = (s: number, n: number) => (n ? Math.round((s / n) * 100) / 100 : null);
  return {
    count: rows.length,
    average: avg(rows.reduce((s, r) => s + r.score!, 0), rows.length),
    distribution,
    byTechnician: [...byTech.entries()].map(([id, v]) => ({ technicianId: id || null, name: names.find((n) => n.id === id)?.nameAr || names.find((n) => n.id === id)?.email || null, average: avg(v.sum, v.count), count: v.count }))
      .sort((a, b) => (b.average ?? 0) - (a.average ?? 0)),
  };
}

export async function slaReport(tx: Tx, scope: SQL | undefined, months = 12) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - months + 1, 1);
  const rows = await tx.select().from(ticket).where(and(scope, sql`${ticket.slaResponseDue} is not null`, gte(ticket.createdAt, new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1)))));
  const now = new Date();
  const byMonth = new Map<string, { month: string; tickets: number; response: { met: number; breached: number; open: number }; resolution: { met: number; breached: number; open: number } }>();
  for (const t of rows) {
    const month = riyadhDate(t.createdAt).slice(0, 7);
    const m = byMonth.get(month) ?? { month, tickets: 0, response: { met: 0, breached: 0, open: 0 }, resolution: { met: 0, breached: 0, open: 0 } };
    m.tickets++;
    const s = ticketSla(t, now);
    for (const part of ['response', 'resolution'] as const) {
      const st = s[part]?.state;
      if (st === 'met') m[part].met++;
      else if (st === 'breached') m[part].breached++;
      else if (st) m[part].open++;
    }
    byMonth.set(month, m);
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({
      ...m,
      responseMetPct: pct(m.response.met, m.response.met + m.response.breached),
      resolutionMetPct: pct(m.resolution.met, m.resolution.met + m.resolution.breached),
    })),
  };
}

/** Annualised agreement value (price × 365 / term days). */
export function annualValue(a: Pick<AgreementRow, 'price' | 'startDate' | 'endDate'>): number {
  const days = Math.round((Date.parse(`${a.endDate}T12:00:00Z`) - Date.parse(`${a.startDate}T12:00:00Z`)) / 86_400_000) + 1;
  return days > 0 ? dec(toHalalas(a.price)).times(365).div(days).toDecimalPlaces(0).toNumber() : 0;
}

export async function agreementsReport(tx: Tx, scope: SQL | undefined, today = riyadhDate()) {
  const active = await tx.select().from(serviceAgreement).where(and(scope, eq(serviceAgreement.status, 'active')));
  const renewalIds = new Set((await tx.select({ id: serviceAgreement.renewalOfId }).from(serviceAgreement).where(and(sql`${serviceAgreement.renewalOfId} is not null`, inArray(serviceAgreement.status, ['draft', 'active'])))).map((r) => r.id));
  const due = active.filter((a) => a.endDate <= addDays(today, 30));
  const partyIds = [...new Set(due.map((a) => a.partyId))];
  const parties = partyIds.length ? await tx.select({ id: party.id, nameAr: party.nameAr }).from(party).where(inArray(party.id, partyIds)) : [];
  const byTier: Record<string, number> = {};
  for (const a of active) byTier[a.tier] = (byTier[a.tier] ?? 0) + 1;
  return {
    activeCount: active.length,
    annualValue: halalasToFixed(active.reduce((s, a) => s + annualValue(a), 0)),
    byTier,
    renewalsDue: due.map((a) => ({ id: a.id, number: a.number, partyId: a.partyId, partyName: parties.find((p) => p.id === a.partyId)?.nameAr ?? null, endDate: a.endDate, price: a.price, autoRenew: a.autoRenew, renewalDrafted: renewalIds.has(a.id), notifiedAt: a.renewalNotifiedAt }))
      .sort((a, b) => a.endDate.localeCompare(b.endDate)),
  };
}

// ───────────────────────── views ─────────────────────────

export function tierInfo(tier: string) {
  const t = TIER_DEFAULTS[tier as AgreementTier];
  return t ? { key: tier, ar: t.ar, en: t.en } : { key: tier, ar: tier, en: tier };
}

/** Sites by id (name, city) for lists. */
export async function siteNames(tx: Tx, ids: string[]) {
  const uniq = [...new Set(ids)];
  return uniq.length ? tx.select({ id: site.id, name: site.name, city: site.city, partyId: site.partyId }).from(site).where(inArray(site.id, uniq)) : [];
}
