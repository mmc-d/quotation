import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { and, asc, cannedReply, eq, inArray, kbArticle, product, productCategory, type Tx } from '@mmc/db';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { audit, diff } from '../common/audit.js';
import { tenantTx } from '../common/db.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { ZodPipe, zUuid } from '../common/zod.js';
import { loadTicket, userNames } from './field-service.service.js';
import {
  KB_STATUS, KB_VISIBILITY, REPLY_PLACEHOLDERS, articleFeedback, articleFiles, articleSummary, assertKbInput, bumpViews, categoryNames, fillPlaceholders, kbSearchText, loadReply,
  productIdsOfAsset, productRefs, replyContext, replyView, replyVisible, searchArticles, uniqueSlug, type KbArticleRow,
} from './kb.service.js';

/**
 * Knowledge base (FSM-85) and canned replies (FSM-84) under /api/kb.
 * - kb.read: search and read articles (drafts/archived only with kb.write); kb.write: create, edit, publish, archive.
 * - Feedback (helpful yes/no): any signed-in staff user.
 * - Canned replies: shared ones (kb.write) + the user's personal ones; rendered with ticket / conversation placeholders.
 */

const zText = (max = 2000) => z.string().trim().max(max);
const articleSchema = z.object({
  slug: zText(100).nullish(),
  titleAr: zText(300).min(2),
  titleEn: zText(300).nullish(),
  bodyAr: zText(50_000).min(1),
  bodyEn: zText(50_000).nullish(),
  visibility: z.enum(KB_VISIBILITY).default('internal'),
  categoryId: zUuid.nullish(),
  productIds: z.array(zUuid).max(50).default([]),
  tags: z.array(zText(60).min(1)).max(20).default([]),
  fileIds: z.array(zUuid).max(20).default([]),
  videoUrl: zText(500).nullish(),
  version: z.number().int().optional(),
});
type ArticleInput = z.infer<typeof articleSchema>;
const listQuery = z.object({
  q: z.string().max(200).optional(), status: z.string().max(60).optional(), visibility: z.string().max(40).optional(),
  productId: zUuid.optional(), assetId: zUuid.optional(), categoryId: zUuid.optional(), limit: z.coerce.number().int().min(1).max(300).default(100),
});
const replySchema = z.object({
  shortcut: zText(40).min(1).regex(/^[\p{L}\p{N}_-]+$/u, 'letters, digits, "-" or "_" only'),
  title: zText(200).min(1),
  bodyAr: zText(4000).min(1),
  bodyEn: zText(4000).nullish(),
  scope: z.enum(['inbox', 'ticket', 'both']).default('both'),
  shared: z.boolean().default(false),
});

@Controller('kb')
export class KbController {
  // ───────────────────────── articles ─────────────────────────

  @Get('articles')
  @Perm('kb.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const editor = !!actor.grants['kb.write'];
      const productIds = q.assetId ? await productIdsOfAsset(tx, q.assetId) : q.productId ? [q.productId] : undefined;
      const rows = await searchArticles(tx, { q: q.q, status: editor ? q.status : undefined, publishedOnly: !editor, visibility: q.visibility, productIds, categoryId: q.categoryId, limit: q.limit });
      const cats = await categoryNames(tx, rows.map((r) => r.categoryId));
      return { rows: rows.map((a) => ({ ...articleSummary(a), category: a.categoryId ? cats.get(a.categoryId) ?? null : null })), total: rows.length };
    });
  }

  /** Categories and the products named on articles (for the filters). */
  @Get('meta')
  @Perm('kb.read')
  async meta(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const categories = await tx.select({ id: productCategory.id, nameAr: productCategory.nameAr, nameEn: productCategory.nameEn }).from(productCategory).orderBy(asc(productCategory.sort), asc(productCategory.nameAr));
      const used = await tx.select({ ids: kbArticle.productIds }).from(kbArticle);
      const products = await productRefs(tx, [...new Set(used.flatMap((u) => u.ids))]);
      return { categories, products, placeholders: REPLY_PLACEHOLDERS };
    });
  }

  @Get('articles/:id')
  @Perm('kb.read')
  async get(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const a = await this.load(tx, actor, id);
      await bumpViews(tx, a.id);
      return this.view(tx, { ...a, views: a.views + 1 });
    });
  }

  private async load(tx: Tx, actor: RequestActor, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('article');
    const [a] = await tx.select().from(kbArticle).where(eq(kbArticle.id, id));
    if (!a || (a.status !== 'published' && !actor.grants['kb.write'])) throw notFound('article');
    return a;
  }

  private async view(tx: Tx, a: KbArticleRow) {
    const cats = await categoryNames(tx, [a.categoryId]);
    const names = await userNames(tx, [a.createdBy, a.updatedBy]);
    return {
      ...a,
      category: a.categoryId ? cats.get(a.categoryId) ?? null : null,
      products: await productRefs(tx, a.productIds),
      files: await articleFiles(tx, a.fileIds, (fid) => `/api/files/${fid}`),
      createdByName: a.createdBy ? names.get(a.createdBy) ?? null : null,
      updatedByName: a.updatedBy ? names.get(a.updatedBy) ?? null : null,
      searchText: undefined,
    };
  }

  private async checkRefs(tx: Tx, b: ArticleInput) {
    assertKbInput(b);
    if (b.productIds.length) {
      const found = await tx.select({ id: product.id }).from(product).where(inArray(product.id, b.productIds));
      if (found.length !== new Set(b.productIds).size) throw badRequest('unknown product in productIds');
    }
    if (b.categoryId) {
      const [c] = await tx.select({ id: productCategory.id }).from(productCategory).where(eq(productCategory.id, b.categoryId));
      if (!c) throw badRequest('unknown category');
    }
  }

  private values(b: ArticleInput, slug: string) {
    const tags = [...new Set(b.tags.map((t) => t.trim()).filter(Boolean))];
    const v = {
      slug, titleAr: b.titleAr, titleEn: b.titleEn || null, bodyAr: b.bodyAr, bodyEn: b.bodyEn || null, visibility: b.visibility, categoryId: b.categoryId ?? null,
      productIds: [...new Set(b.productIds)], tags, fileIds: [...new Set(b.fileIds)], videoUrl: b.videoUrl || null,
    };
    return { ...v, searchText: kbSearchText(v) };
  }

  @Post('articles')
  @Perm('kb.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(articleSchema)) b: ArticleInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      await this.checkRefs(tx, b);
      const slug = await uniqueSlug(tx, b.slug || b.titleEn || b.titleAr);
      const [a] = await tx.insert(kbArticle).values({ ...this.values(b, slug), status: 'draft', createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'kb_article', a!.id, null, { slug, titleAr: a!.titleAr, visibility: a!.visibility });
      return this.view(tx, a!);
    }, actor.userId);
  }

  @Put('articles/:id')
  @Perm('kb.write')
  async update(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(articleSchema)) b: ArticleInput) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await this.load(tx, actor, id);
      if (b.version !== undefined && b.version !== before.version) throw conflict('the article was changed by someone else — reload');
      await this.checkRefs(tx, b);
      // a typed slug must be free; an empty one keeps the current slug
      let slug = before.slug;
      if (b.slug && b.slug !== before.slug) {
        slug = await uniqueSlug(tx, b.slug, id);
      }
      const values = this.values(b, slug);
      await tx.update(kbArticle).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(kbArticle.id, id));
      const { searchText: _s, ...shown } = values;
      const d = diff(before as unknown as Record<string, unknown>, shown as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'kb_article', id, d.before, d.after);
      const [a] = await tx.select().from(kbArticle).where(eq(kbArticle.id, id));
      return this.view(tx, a!);
    }, actor.userId);
  }

  @Post('articles/:id/publish')
  @Perm('kb.write')
  @HttpCode(200)
  async publish(@Actor() actor: RequestActor, @Param('id') id: string) {
    return this.setStatus(actor, id, 'published');
  }

  @Post('articles/:id/archive')
  @Perm('kb.write')
  @HttpCode(200)
  async archive(@Actor() actor: RequestActor, @Param('id') id: string) {
    return this.setStatus(actor, id, 'archived');
  }

  private setStatus(actor: RequestActor, id: string, status: (typeof KB_STATUS)[number]) {
    return tenantTx(actor.tenantId, async (tx) => {
      const a = await this.load(tx, actor, id);
      if (a.status === status) throw badRequest(`the article is already ${status}`);
      await tx.update(kbArticle).set({ status, updatedAt: new Date(), updatedBy: actor.userId, version: a.version + 1 }).where(eq(kbArticle.id, id));
      await audit(tx, actor, `status_${status}`, 'kb_article', id, { status: a.status }, { status });
      const [n] = await tx.select().from(kbArticle).where(eq(kbArticle.id, id));
      return this.view(tx, n!);
    }, actor.userId);
  }

  /** Helpful yes/no from any signed-in staff user. */
  @Post('articles/:id/feedback')
  @HttpCode(200)
  async feedback(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ helpful: z.boolean() }))) b: { helpful: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('article');
      const [a] = await tx.select({ id: kbArticle.id, status: kbArticle.status }).from(kbArticle).where(eq(kbArticle.id, id));
      if (!a || (a.status !== 'published' && !actor.grants['kb.write'])) throw notFound('article');
      return { id, ...(await articleFeedback(tx, id, b.helpful)) };
    }, actor.userId);
  }

  // ───────────────────────── canned replies ─────────────────────────

  @Get('replies')
  @Perm('kb.read', 'ticket.write', 'message.send')
  async replies(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ scope: z.enum(['inbox', 'ticket']).optional(), q: z.string().max(100).optional() }))) q: { scope?: 'inbox' | 'ticket'; q?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select().from(cannedReply).where(and(replyVisible(actor), q.scope ? inArray(cannedReply.scope, [q.scope, 'both']) : undefined)).orderBy(asc(cannedReply.shortcut));
      const term = q.q?.trim().toLowerCase();
      const hit = term ? rows.filter((r) => `${r.shortcut} ${r.title} ${r.bodyAr} ${r.bodyEn ?? ''}`.toLowerCase().includes(term)) : rows;
      return { rows: hit.map((r) => replyView(r, actor)), canShare: !!actor.grants['kb.write'], placeholders: REPLY_PLACEHOLDERS };
    });
  }

  @Post('replies')
  @Perm('kb.read', 'ticket.write', 'message.send')
  async createReply(@Actor() actor: RequestActor, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    if (b.shared && !actor.grants['kb.write']) throw forbidden('missing permission: kb.write (shared replies)');
    return tenantTx(actor.tenantId, async (tx) => {
      await this.shortcutFree(tx, b.shortcut);
      const [r] = await tx.insert(cannedReply).values({
        shortcut: b.shortcut, title: b.title, bodyAr: b.bodyAr, bodyEn: b.bodyEn || null, scope: b.scope, ownerId: b.shared ? null : actor.userId, createdBy: actor.userId, updatedBy: actor.userId,
      }).returning();
      await audit(tx, actor, 'create', 'canned_reply', r!.id, null, { shortcut: b.shortcut, shared: b.shared });
      return replyView(r!, actor);
    }, actor.userId);
  }

  private async shortcutFree(tx: Tx, shortcut: string, exceptId?: string) {
    const [dupe] = await tx.select({ id: cannedReply.id }).from(cannedReply).where(eq(cannedReply.shortcut, shortcut));
    if (dupe && dupe.id !== exceptId) throw conflict(`the shortcut "/${shortcut}" is already used`);
  }

  private assertEditable(actor: RequestActor, r: { ownerId: string | null }) {
    if (r.ownerId === null && !actor.grants['kb.write']) throw forbidden('missing permission: kb.write (shared replies)');
    if (r.ownerId !== null && r.ownerId !== actor.userId) throw forbidden('a personal reply can only be changed by its owner');
  }

  @Put('replies/:id')
  @Perm('kb.read', 'ticket.write', 'message.send')
  async updateReply(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadReply(tx, actor, id);
      this.assertEditable(actor, before);
      if (b.shared && !actor.grants['kb.write']) throw forbidden('missing permission: kb.write (shared replies)');
      await this.shortcutFree(tx, b.shortcut, id);
      const values = { shortcut: b.shortcut, title: b.title, bodyAr: b.bodyAr, bodyEn: b.bodyEn || null, scope: b.scope, ownerId: b.shared ? null : before.ownerId ?? actor.userId };
      await tx.update(cannedReply).set({ ...values, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(cannedReply.id, id));
      const d = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'canned_reply', id, d.before, d.after);
      const [r] = await tx.select().from(cannedReply).where(eq(cannedReply.id, id));
      return replyView(r!, actor);
    }, actor.userId);
  }

  @Delete('replies/:id')
  @Perm('kb.read', 'ticket.write', 'message.send')
  async deleteReply(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await loadReply(tx, actor, id);
      this.assertEditable(actor, r);
      await tx.delete(cannedReply).where(eq(cannedReply.id, id));
      await audit(tx, actor, 'delete', 'canned_reply', id, { shortcut: r.shortcut, title: r.title }, null);
      return { id, deleted: true };
    }, actor.userId);
  }

  /** Body with {customer_name}, {ticket_number}, {technician_name}, {agent_name} filled from a ticket or a conversation. */
  @Post('replies/:id/render')
  @Perm('kb.read', 'ticket.write', 'message.send')
  @HttpCode(200)
  async render(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ ticketId: zUuid.nullish(), conversationId: zUuid.nullish(), locale: z.enum(['ar', 'en']).optional() }))) b: { ticketId?: string | null; conversationId?: string | null; locale?: 'ar' | 'en' }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await loadReply(tx, actor, id);
      if (b.ticketId) {
        await loadTicket(tx, actor, b.ticketId, 'ticket.read');
      }
      if (b.conversationId && !actor.grants['message.read'] && !actor.grants['message.send']) throw forbidden('missing permission: message.read');
      const vars = await replyContext(tx, actor, b);
      const src = b.locale === 'en' && r.bodyEn ? r.bodyEn : r.bodyAr;
      return { id: r.id, shortcut: r.shortcut, body: fillPlaceholders(src, vars), vars };
    });
  }
}
