import { PgBoss } from 'pg-boss';
import {
  activity, and, eq, inArray, isNull, lead, lt, notification, outboxEvent, paymentRequest, quote, sql, tenant, withTenant,
} from '@mmc/db';
import { followUpsDue, remindersDue, riyadhDate } from '@mmc/domain';
import { getDb } from './common/db.js';
import { config } from './config.js';
import { sendPaymentRequest } from './modules/finance.service.js';
import { reconcile } from './modules/finance.controller.js';

/**
 * Background jobs on pg-boss (Postgres-backed, no extra infrastructure). pg-boss manages its own
 * schema, so it connects with the admin URL; the jobs themselves run as the RLS-bound runtime role.
 */
const JOBS = {
  followups: { name: 'crm-followups', cron: '*/30 * * * *' },
  reminders: { name: 'finance-reminders', cron: '0 9 * * 0-4' },
  expire: { name: 'quotes-expire', cron: '15 0 * * *' },
  reconcile: { name: 'erp-reconcile', cron: '0 2 * * *' },
  outbox: { name: 'outbox-dispatch', cron: '* * * * *' },
} as const;

async function forEachTenant(fn: (tenantId: string) => Promise<void>) {
  const tenants = await getDb().select({ id: tenant.id }).from(tenant).where(eq(tenant.status, 'active'));
  for (const t of tenants) {
    try { await fn(t.id); } catch (e) { console.error(`[worker] tenant ${t.id}:`, e); }
  }
}

export async function runFollowUps() {
  let created = 0;
  await forEachTenant((tenantId) => withTenant(getDb(), tenantId, async (tx) => {
    const quotes = await tx.select({ id: quote.id, number: quote.number, ownerId: quote.ownerId, status: quote.status, sentAt: quote.sentAt, viewedAt: quote.viewedAt, validUntil: quote.validUntil }).from(quote).where(inArray(quote.status, ['sent', 'viewed']));
    const opps = await tx.execute<{ id: string; title: string; owner_id: string | null; last_activity_at: Date }>(sql`select o.id, o.title, o.owner_id, o.last_activity_at from opportunity o join pipeline_stage s on s.id = o.stage_id where s.kind = 'open'`);
    const leads = await tx.select({ id: lead.id, name: lead.name, ownerId: lead.ownerId, status: lead.status, createdAt: lead.createdAt, firstContactAt: lead.firstContactAt }).from(lead).where(eq(lead.status, 'new'));
    const due = followUpsDue(new Date(), {
      quotes: quotes.map((q) => ({ ...q, validUntil: q.validUntil ? new Date(`${q.validUntil}T23:59:59+03:00`) : null })),
      opportunities: opps.map((o) => ({ id: o.id, title: o.title, ownerId: o.owner_id, open: true, lastActivityAt: new Date(o.last_activity_at) })),
      leads,
    });
    for (const d of due) {
      // One follow-up task per entity, rule and day (unique index on entity + rule_key).
      const ruleKey = `${d.rule}:${riyadhDate()}`;
      const [a] = await tx.insert(activity).values({ entityType: d.entityType, entityId: d.entityId, type: 'task', subject: d.message_ar, body: d.message_en, dueAt: new Date(), ownerId: d.ownerId, ruleKey }).onConflictDoNothing().returning();
      if (a) {
        created++;
        if (d.ownerId) await tx.insert(notification).values({ userId: d.ownerId, kind: 'task', titleAr: d.message_ar, titleEn: d.message_en, link: d.entityType === 'quote' ? `/quotes/${d.entityId}` : d.entityType === 'lead' ? `/crm/leads/${d.entityId}` : `/crm/opportunities/${d.entityId}` });
      }
    }
  }));
  return { created };
}

export async function runReminders() {
  let sent = 0;
  await forEachTenant((tenantId) => withTenant(getDb(), tenantId, async (tx) => {
    const open = await tx.select().from(paymentRequest).where(inArray(paymentRequest.status, ['sent', 'partially_paid']));
    for (const pr of open) {
      const offsets = remindersDue(pr.dueDate, riyadhDate(), pr.remindersSent);
      if (!offsets.length) continue;
      try {
        await sendPaymentRequest(tx, null, pr.id, 'whatsapp', null, 'payment_reminder');
        await tx.update(paymentRequest).set({ remindersSent: [...pr.remindersSent, ...offsets] }).where(eq(paymentRequest.id, pr.id));
        sent++;
      } catch (e) {
        console.warn(`[worker] reminder ${pr.number}:`, (e as Error).message);
      }
    }
  }));
  return { sent };
}

export async function runExpire() {
  let expired = 0;
  await forEachTenant((tenantId) => withTenant(getDb(), tenantId, async (tx) => {
    const rows = await tx.update(quote).set({ status: 'expired', updatedAt: new Date() }).where(and(inArray(quote.status, ['sent', 'viewed']), lt(quote.validUntil, riyadhDate()))).returning({ id: quote.id, ownerId: quote.ownerId, number: quote.number });
    expired += rows.length;
    for (const r of rows) if (r.ownerId) await tx.insert(notification).values({ userId: r.ownerId, kind: 'quote', titleAr: `انتهت صلاحية العرض ${r.number}`, link: `/quotes/${r.id}` });
  }));
  return { expired };
}

export async function runOutbox() {
  // No external subscribers yet (webhook subscriptions come with the integration catalogue);
  // events are marked delivered so the table stays a short queue.
  await forEachTenant((tenantId) => withTenant(getDb(), tenantId, async (tx) => {
    await tx.update(outboxEvent).set({ deliveredAt: new Date(), attempts: sql`${outboxEvent.attempts} + 1` }).where(isNull(outboxEvent.deliveredAt));
  }));
}

let boss: PgBoss | null = null;

export async function startWorker() {
  const url = process.env.DATABASE_ADMIN_URL ?? config.databaseUrl;
  boss = new PgBoss({ connectionString: url, schema: 'pgboss' });
  boss.on('error', (e) => console.error('[worker]', e));
  await boss.start();
  const handlers: Record<string, () => Promise<unknown>> = {
    [JOBS.followups.name]: runFollowUps,
    [JOBS.reminders.name]: runReminders,
    [JOBS.expire.name]: runExpire,
    [JOBS.reconcile.name]: () => forEachTenant(async (t) => { await reconcile(t); }),
    [JOBS.outbox.name]: runOutbox,
  };
  for (const j of Object.values(JOBS)) {
    await boss.createQueue(j.name);
    await boss.schedule(j.name, j.cron, {}, { tz: 'Asia/Riyadh' });
    await boss.work(j.name, async () => { await handlers[j.name]!(); });
  }
  console.log('[worker] started:', Object.values(JOBS).map((j) => j.name).join(', '));
  return boss;
}

export async function stopWorker() {
  await boss?.stop();
}

if (process.argv[1]?.endsWith('worker.js')) {
  await startWorker();
  process.on('SIGTERM', async () => { await stopWorker(); process.exit(0); });
}
