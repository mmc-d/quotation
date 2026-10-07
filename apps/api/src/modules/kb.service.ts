import { and, appUser, asc, cannedReply, contact, conversation, desc, eq, file, inArray, installedAsset, isNull, kbArticle, lead, ne, or, party, product, productCategory, sql, ticket, ticketMessage, workOrder, type Tx } from '@mmc/db';
import { normalizeArabic } from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { badRequest, notFound } from '../common/errors.js';
import { userNames } from './field-service.service.js';

/**
 * Knowledge base (FSM-85), canned replies (FSM-84) and the ticket conversation helpers.
 * Article bodies are plain text with a small markdown subset (headings, lists, **bold**, links);
 * the web renders that subset itself — never as raw HTML.
 */

export type KbArticleRow = typeof kbArticle.$inferSelect;
export type CannedReplyRow = typeof cannedReply.$inferSelect;
export const KB_VISIBILITY = ['internal', 'public'] as const;
export const KB_STATUS = ['draft', 'published', 'archived'] as const;
/** The placeholders a canned reply may use (filled by POST /api/kb/replies/:id/render). */
export const REPLY_PLACEHOLDERS = ['customer_name', 'ticket_number', 'technician_name', 'agent_name'] as const;

// ───────────────────────── articles ─────────────────────────

export function kbSearchText(a: { titleAr: string; titleEn?: string | null; bodyAr: string; bodyEn?: string | null; tags?: string[] | null; slug?: string | null }) {
  return normalizeArabic([a.titleAr, a.titleEn, a.slug?.replace(/-/g, ' '), (a.tags ?? []).join(' '), a.bodyAr, a.bodyEn].filter(Boolean).join(' \n '));
}

/** URL slug from a title: Arabic and Latin letters + digits, words joined by "-". */
export function slugify(title: string): string {
  const s = normalizeArabic(title)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return s || 'article';
}

export async function uniqueSlug(tx: Tx, wanted: string, exceptId?: string): Promise<string> {
  const base = slugify(wanted);
  for (let i = 1; i < 500; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    const [hit] = await tx.select({ id: kbArticle.id }).from(kbArticle).where(and(eq(kbArticle.slug, s), exceptId ? ne(kbArticle.id, exceptId) : undefined));
    if (!hit) return s;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Every word of the (normalised) query must appear in the article's search text. */
export function kbTermFilter(q: string | null | undefined) {
  const words = normalizeArabic(q ?? '').split(' ').filter((w) => w.length > 0).slice(0, 8);
  if (!words.length) return undefined;
  return and(...words.map((w) => sql`${kbArticle.searchText} like ${`%${likeEscape(w)}%`}`));
}

/** Product id(s) of an installed device (its own product + the product found by its code). */
export async function productIdsOfAsset(tx: Tx, assetId: string): Promise<string[]> {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return [];
  const [a] = await tx.select({ productId: installedAsset.productId, code: installedAsset.code }).from(installedAsset).where(eq(installedAsset.id, assetId));
  if (!a) return [];
  const ids = new Set<string>();
  if (a.productId) ids.add(a.productId);
  const byCode = await tx.select({ id: product.id }).from(product).where(eq(product.code, a.code)).limit(3);
  for (const p of byCode) ids.add(p.id);
  return [...ids];
}

export interface KbQuery { q?: string; status?: string; visibility?: string; productIds?: string[]; categoryId?: string; publishedOnly?: boolean; publicOnly?: boolean; limit?: number }

export async function searchArticles(tx: Tx, f: KbQuery): Promise<KbArticleRow[]> {
  const where = and(
    f.publishedOnly ? eq(kbArticle.status, 'published') : f.status ? inArray(kbArticle.status, f.status.split(',')) : undefined,
    f.publicOnly ? eq(kbArticle.visibility, 'public') : f.visibility ? inArray(kbArticle.visibility, f.visibility.split(',')) : undefined,
    f.categoryId ? eq(kbArticle.categoryId, f.categoryId) : undefined,
    f.productIds ? (f.productIds.length ? or(...f.productIds.map((p) => sql`${kbArticle.productIds} @> ${JSON.stringify([p])}::jsonb`)) : sql`false`) : undefined,
    kbTermFilter(f.q),
  );
  const rows = await tx.select().from(kbArticle).where(where).orderBy(desc(kbArticle.updatedAt)).limit(Math.min(f.limit ?? 100, 300));
  const words = normalizeArabic(f.q ?? '').split(' ').filter(Boolean);
  if (!words.length) return rows;
  // title hits first, then the most helpful / most viewed
  const score = (a: KbArticleRow) => {
    const title = normalizeArabic(`${a.titleAr} ${a.titleEn ?? ''}`);
    return words.filter((w) => title.includes(w)).length * 1000 + Math.min(999, a.helpfulYes - a.helpfulNo + Math.floor(a.views / 10));
  };
  return [...rows].sort((x, y) => score(y) - score(x));
}

export async function categoryNames(tx: Tx, ids: (string | null)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map<string, { nameAr: string; nameEn: string | null }>();
  const rows = await tx.select({ id: productCategory.id, nameAr: productCategory.nameAr, nameEn: productCategory.nameEn }).from(productCategory).where(inArray(productCategory.id, uniq));
  return new Map(rows.map((r) => [r.id, { nameAr: r.nameAr, nameEn: r.nameEn }]));
}

/** Staff list row (no bodies). */
export function articleSummary(a: KbArticleRow) {
  return {
    id: a.id, slug: a.slug, titleAr: a.titleAr, titleEn: a.titleEn, visibility: a.visibility, status: a.status, categoryId: a.categoryId, productIds: a.productIds,
    tags: a.tags, hasVideo: !!a.videoUrl, views: a.views, helpfulYes: a.helpfulYes, helpfulNo: a.helpfulNo, excerptAr: excerpt(a.bodyAr), excerptEn: a.bodyEn ? excerpt(a.bodyEn) : null,
    updatedAt: a.updatedAt, createdAt: a.createdAt,
  };
}

export function excerpt(body: string, max = 180) {
  const plain = body.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*([-*]|\d+[.)])\s+/gm, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export async function articleFiles(tx: Tx, ids: string[], urlOf: (id: string) => string) {
  if (!ids.length) return [];
  const rows = await tx.select({ id: file.id, filename: file.filename, mime: file.mime, size: file.size }).from(file).where(inArray(file.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ ...r, url: urlOf(r.id) }));
}

export async function productRefs(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  const rows = await tx.select({ id: product.id, code: product.code, nameAr: product.nameAr, nameEn: product.nameEn }).from(product).where(inArray(product.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
}

/** Customer-facing article (portal): no internal counters or author fields. */
export async function publicArticle(tx: Tx, a: KbArticleRow) {
  return {
    id: a.id, slug: a.slug, titleAr: a.titleAr, titleEn: a.titleEn, bodyAr: a.bodyAr, bodyEn: a.bodyEn, tags: a.tags, videoUrl: a.videoUrl, updatedAt: a.updatedAt,
    products: (await productRefs(tx, a.productIds)).map((p) => ({ id: p.id, code: p.code, nameAr: p.nameAr, nameEn: p.nameEn })),
    files: await articleFiles(tx, a.fileIds, (id) => `/api/portal/files/${id}`),
  };
}

export const publicSummary = (a: KbArticleRow) => ({ id: a.id, slug: a.slug, titleAr: a.titleAr, titleEn: a.titleEn, excerptAr: excerpt(a.bodyAr), excerptEn: a.bodyEn ? excerpt(a.bodyEn) : null, hasVideo: !!a.videoUrl, updatedAt: a.updatedAt });

export async function articleFeedback(tx: Tx, id: string, helpful: boolean) {
  const [r] = await tx.update(kbArticle).set(helpful ? { helpfulYes: sql`${kbArticle.helpfulYes} + 1` } : { helpfulNo: sql`${kbArticle.helpfulNo} + 1` })
    .where(eq(kbArticle.id, id)).returning({ helpfulYes: kbArticle.helpfulYes, helpfulNo: kbArticle.helpfulNo });
  if (!r) throw notFound('article');
  return r;
}

export async function bumpViews(tx: Tx, id: string) {
  await tx.update(kbArticle).set({ views: sql`${kbArticle.views} + 1` }).where(eq(kbArticle.id, id));
}

// ───────────────────────── canned replies ─────────────────────────

/** {customer_name} … → values; unknown placeholders stay as typed so the agent sees them. */
export function fillPlaceholders(body: string, vars: Record<string, string | null | undefined>) {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] ?? '' : m));
}

export const replyVisible = (actor: RequestActor) => or(isNull(cannedReply.ownerId), eq(cannedReply.ownerId, actor.userId));

export async function loadReply(tx: Tx, actor: RequestActor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('canned reply');
  const [r] = await tx.select().from(cannedReply).where(and(eq(cannedReply.id, id), replyVisible(actor)));
  if (!r) throw notFound('canned reply');
  return r;
}

/** Values for the placeholders, from a ticket (customer, number, technician) or an inbox conversation. */
export async function replyContext(tx: Tx, actor: RequestActor, src: { ticketId?: string | null; conversationId?: string | null }) {
  const vars: Record<string, string> = { customer_name: '', ticket_number: '', technician_name: '', agent_name: actor.name ?? '' };
  if (src.ticketId) {
    const [t] = await tx.select().from(ticket).where(eq(ticket.id, src.ticketId));
    if (!t) throw notFound('ticket');
    const [p] = t.partyId ? await tx.select({ nameAr: party.nameAr }).from(party).where(eq(party.id, t.partyId)) : [];
    vars.customer_name = t.contactName || p?.nameAr || '';
    vars.ticket_number = t.number;
    const [wo] = await tx.select({ technicianId: workOrder.technicianId }).from(workOrder).where(and(eq(workOrder.ticketId, t.id), ne(workOrder.status, 'cancelled'), sql`${workOrder.technicianId} is not null`)).orderBy(desc(workOrder.createdAt)).limit(1);
    if (wo?.technicianId) vars.technician_name = (await userNames(tx, [wo.technicianId])).get(wo.technicianId) ?? '';
  } else if (src.conversationId) {
    const [c] = await tx.select().from(conversation).where(eq(conversation.id, src.conversationId));
    if (!c) throw notFound('conversation');
    const [ct] = c.contactId ? await tx.select({ name: contact.name }).from(contact).where(eq(contact.id, c.contactId)) : [];
    const [p] = c.partyId ? await tx.select({ nameAr: party.nameAr }).from(party).where(eq(party.id, c.partyId)) : [];
    const [l] = c.leadId ? await tx.select({ name: lead.name }).from(lead).where(eq(lead.id, c.leadId)) : [];
    vars.customer_name = ct?.name || l?.name || p?.nameAr || '';
    if (c.partyId) {
      const [t] = await tx.select({ id: ticket.id, number: ticket.number }).from(ticket).where(and(eq(ticket.partyId, c.partyId), inArray(ticket.status, ['open', 'in_progress', 'resolved']))).orderBy(desc(ticket.createdAt)).limit(1);
      if (t) {
        vars.ticket_number = t.number;
        const [wo] = await tx.select({ technicianId: workOrder.technicianId }).from(workOrder).where(and(eq(workOrder.ticketId, t.id), ne(workOrder.status, 'cancelled'), sql`${workOrder.technicianId} is not null`)).orderBy(desc(workOrder.createdAt)).limit(1);
        if (wo?.technicianId) vars.technician_name = (await userNames(tx, [wo.technicianId])).get(wo.technicianId) ?? '';
      }
    }
  }
  return vars;
}

export function replyView(r: CannedReplyRow, actor: RequestActor) {
  return { id: r.id, shortcut: r.shortcut, title: r.title, bodyAr: r.bodyAr, bodyEn: r.bodyEn, scope: r.scope, shared: !r.ownerId, mine: r.ownerId === actor.userId, updatedAt: r.updatedAt };
}

// ───────────────────────── ticket conversation ─────────────────────────

export type TicketMessageRow = typeof ticketMessage.$inferSelect;

/** Staff view: every message incl. internal notes, with author names and file links. */
export async function staffMessages(tx: Tx, ticketId: string) {
  const rows = await tx.select().from(ticketMessage).where(eq(ticketMessage.ticketId, ticketId)).orderBy(asc(ticketMessage.createdAt));
  const names = await userNames(tx, rows.map((r) => r.authorUserId));
  const fids = [...new Set(rows.flatMap((r) => r.fileIds))];
  const files = fids.length ? await tx.select({ id: file.id, filename: file.filename, mime: file.mime }).from(file).where(inArray(file.id, fids)) : [];
  return rows.map((m) => ({
    id: m.id, author: m.author, authorName: m.authorUserId ? names.get(m.authorUserId) ?? null : null, body: m.body, internal: m.internal, deliveredVia: m.deliveredVia, createdAt: m.createdAt,
    files: m.fileIds.map((id) => files.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ ...f, url: `/api/files/${f.id}` })),
  }));
}

/** Customer view: never internal notes; staff shown by first name only. */
export async function portalMessages(tx: Tx, ticketId: string) {
  const rows = await tx.select().from(ticketMessage).where(and(eq(ticketMessage.ticketId, ticketId), eq(ticketMessage.internal, false))).orderBy(asc(ticketMessage.createdAt));
  const ids = [...new Set(rows.map((r) => r.authorUserId).filter((x): x is string => !!x))];
  const users = ids.length ? await tx.select({ id: appUser.id, nameAr: appUser.nameAr }).from(appUser).where(inArray(appUser.id, ids)) : [];
  const fids = [...new Set(rows.flatMap((r) => r.fileIds))];
  const files = fids.length ? await tx.select({ id: file.id, filename: file.filename, mime: file.mime }).from(file).where(inArray(file.id, fids)) : [];
  return rows.map((m) => ({
    id: m.id, author: m.author, createdAt: m.createdAt, body: m.body,
    authorName: m.author === 'staff' ? (users.find((u) => u.id === m.authorUserId)?.nameAr?.split(' ')[0] ?? null) : null,
    files: m.fileIds.map((id) => files.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ ...f, url: `/api/portal/files/${f.id}` })),
  }));
}

export function assertKbInput(b: { videoUrl?: string | null }) {
  if (b.videoUrl && !/^https?:\/\//i.test(b.videoUrl)) throw badRequest('the video link must start with http:// or https://');
}
