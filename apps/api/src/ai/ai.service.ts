/**
 * AI features on top of the gateway: AI-01 BOQ → draft quote (with the human approval queue),
 * AI-02 reply drafting and translation, usage reporting and personal access tokens for MCP.
 * The AI never writes business data itself: BOQ output waits in ai_draft until a person applies it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { aiCall, aiDraft, and, apiToken, appUser, desc, eq, inArray, isNull, party, product, sql, teamMember, type SQL, type Tx } from '@mmc/db';
import { redactPii } from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { loadCompany } from '../common/company.js';
import { tenantTx } from '../common/db.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { readStoredFile } from '../common/files.js';
import { assertCan } from '../common/scope.js';
import { createQuote, type LineInput } from '../modules/quotes.service.js';
import { CrmController } from '../modules/crm.controller.js';
import { BOQ_MAX_ROWS, catalogText, loadCatalog, rowsFromText, rowsFromXlsx, rowsFromTable, sandboxMatch, validateMatches, type BoqResultRow, type BoqRow } from './boq.js';
import { AiError, aiConfig, claudeParsed, claudeText } from './claude.js';
import { runAi, spentTodayUsd } from './gateway.js';
import { BOQ_PDF_TEXT, BOQ_SYSTEM, BoqOutput, boqUserText } from './prompts/boq.js';
import { replySystem, replyUser, sandboxReply, type ReplyContext, type ReplyTone } from './prompts/reply.js';
import { sandboxTranslate, translateSystem } from './prompts/translate.js';
import { parseCsv } from '../modules/parties.controller.js';

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const need = (actor: RequestActor, perm: string) => { if (!actor.grants[perm as keyof typeof actor.grants]) throw forbidden(`missing permission: ${perm}`); };

// ───────────────────────────── AI-01 BOQ ─────────────────────────────

export interface BoqInput {
  text?: string | null;
  fileId?: string | null;
  file?: { name: string; contentType: string; data: string } | null;
  partyId?: string | null;
}

type Source = { kind: 'text' | 'csv' | 'xlsx' | 'pdf'; filename: string | null; data?: Buffer };

function kindOf(name: string, mime: string): Source['kind'] | null {
  const n = name.toLowerCase();
  if (mime === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (mime.includes('spreadsheetml') || n.endsWith('.xlsx')) return 'xlsx';
  if (mime === 'text/csv' || mime === 'application/csv' || n.endsWith('.csv') || mime === 'text/plain' || n.endsWith('.txt')) return 'csv';
  return null;
}

async function resolveSource(actor: RequestActor, b: BoqInput): Promise<Source & { text?: string }> {
  const given = [b.text?.trim() ? 1 : 0, b.fileId ? 1 : 0, b.file ? 1 : 0].reduce((a, c) => a + c, 0);
  if (given !== 1) throw badRequest('send exactly one of: text, file, fileId');
  if (b.text?.trim()) return { kind: 'text', filename: null, text: b.text };
  if (b.file) {
    const data = Buffer.from(b.file.data, 'base64');
    if (!data.length) throw badRequest('empty file');
    const kind = kindOf(b.file.name, b.file.contentType);
    if (!kind) throw badRequest('upload an Excel (.xlsx), CSV or PDF file');
    return { kind, filename: b.file.name, data };
  }
  const f = await tenantTx(actor.tenantId, (tx) => readStoredFile(tx, b.fileId!));
  if (!f) throw notFound('file');
  const kind = kindOf(f.filename, f.mime);
  if (!kind) throw badRequest('the stored file is not an Excel, CSV or PDF file');
  return { kind, filename: f.filename, data: f.data };
}

async function parseRows(src: Source & { text?: string }): Promise<BoqRow[]> {
  if (src.kind === 'text') return rowsFromText(src.text ?? '');
  if (src.kind === 'csv') return rowsFromTable(parseCsv(src.data!.toString('utf8').replace(/^﻿/, '')));
  if (src.kind === 'xlsx') {
    try { return await rowsFromXlsx(src.data!); } catch { throw badRequest('could not read the Excel file'); }
  }
  return [];
}

export async function runBoq(actor: RequestActor, b: BoqInput) {
  need(actor, 'product.read');
  if (b.partyId) {
    await tenantTx(actor.tenantId, async (tx) => {
      const [p] = await tx.select({ id: party.id, ownerId: party.ownerId }).from(party).where(eq(party.id, b.partyId!));
      if (!p) throw notFound('customer');
      assertCan(actor, 'party.read', { ownerId: p.ownerId });
    });
  }
  const src = await resolveSource(actor, b);
  if (src.kind === 'pdf' && aiConfig.sandbox) throw badRequest('PDF BOQs need the live AI (no ANTHROPIC_API_KEY on this server) — upload the Excel/CSV version or paste the rows');
  const parsed = (await parseRows(src)).map((r) => ({ ...r, ref: redactPii(r.ref), code: redactPii(r.code), description: redactPii(r.description) }));
  if (src.kind !== 'pdf' && !parsed.length) throw badRequest('no BOQ rows with a quantity were found');
  const catalog = await tenantTx(actor.tenantId, (tx) => loadCatalog(tx));
  if (!catalog.length) throw badRequest('the catalog has no active products');

  const ai = await runAi(actor, {
    feature: 'boq',
    input: { rows: src.kind === 'pdf' ? '' : boqUserText(parsed) },
    meta: { source: src.kind, filename: src.filename, rowCount: parsed.length, catalogSize: catalog.length },
    sandbox: () => sandboxMatch(parsed, catalog),
    live: async (input) => {
      const content = src.kind === 'pdf'
        ? [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: src.data!.toString('base64') } }, { type: 'text' as const, text: BOQ_PDF_TEXT }]
        : input.rows;
      const r = await claudeParsed({
        system: BOQ_SYSTEM,
        cachedSystem: catalogText(catalog),
        content,
        schema: BoqOutput,
        effort: 'medium',
        maxTokens: src.kind === 'pdf' ? 64_000 : Math.min(64_000, 8_000 + parsed.length * 300),
      });
      return { ...r, result: r.result.rows.slice(0, BOQ_MAX_ROWS) as BoqResultRow[] };
    },
    logOutput: (rows) => ({ rows: rows.length, matched: rows.filter((r) => r.matches.length).length, codes: rows.flatMap((r) => r.matches.map((m) => m.productCode)).slice(0, 500) }),
  });
  const { rows, dropped } = validateMatches(ai.result, catalog);
  const id = await tenantTx(actor.tenantId, async (tx) => {
    const [d] = await tx.insert(aiDraft).values({
      feature: 'boq', callId: ai.callId, entityType: 'quote', status: 'pending', createdBy: actor.userId,
      payload: { rows, partyId: b.partyId ?? null, source: { kind: src.kind, filename: src.filename }, sandbox: ai.sandbox, model: ai.model, droppedCodes: dropped, catalogSize: catalog.length },
    }).returning({ id: aiDraft.id });
    await audit(tx, actor, 'create', 'ai_draft', d!.id, null, { feature: 'boq', rows: rows.length, sandbox: ai.sandbox });
    return d!.id;
  }, actor.userId);
  return getDraft(actor, id);
}

// ───────────────────────────── drafts (approval queue) ─────────────────────────────

function draftScope(actor: RequestActor): SQL | undefined {
  const s = actor.grants['ai.approve'] ?? actor.grants['ai.use'];
  if (!s) throw forbidden('missing permission: ai.use');
  if (s === 'all' || s === 'company' || s === 'branch') return undefined;
  if (s === 'team' && actor.teamIds.length) return sql`(${aiDraft.createdBy} = ${actor.userId} or ${aiDraft.createdBy} in (select ${teamMember.userId} from ${teamMember} where ${inArray(teamMember.teamId, actor.teamIds)}))`;
  return eq(aiDraft.createdBy, actor.userId);
}

async function loadDraft(tx: Tx, actor: RequestActor, id: string, lock = false) {
  if (!isUuid(id)) throw notFound('AI draft');
  const q = tx.select().from(aiDraft).where(and(eq(aiDraft.id, id), draftScope(actor)));
  const [d] = lock ? await q.for('update') : await q;
  if (!d) throw notFound('AI draft');
  return d;
}

export async function listDrafts(actor: RequestActor, status?: string) {
  return tenantTx(actor.tenantId, async (tx) => {
    const rows = await tx.select({ d: aiDraft, createdByName: appUser.nameAr }).from(aiDraft).leftJoin(appUser, eq(appUser.id, aiDraft.createdBy))
      .where(and(draftScope(actor), status ? inArray(aiDraft.status, status.split(',')) : undefined)).orderBy(desc(aiDraft.createdAt)).limit(100);
    return rows.map(({ d, createdByName }) => {
      const p = d.payload as { rows?: BoqResultRow[]; source?: unknown; sandbox?: boolean; partyId?: string | null };
      return { id: d.id, feature: d.feature, entityType: d.entityType, status: d.status, createdAt: d.createdAt, createdBy: d.createdBy, createdByName, appliedEntityId: d.appliedEntityId, rows: p.rows?.length ?? 0, source: p.source ?? null, sandbox: !!p.sandbox, partyId: p.partyId ?? null };
    });
  });
}

export async function getDraft(actor: RequestActor, id: string) {
  return tenantTx(actor.tenantId, async (tx) => {
    const d = await loadDraft(tx, actor, id);
    const p = d.payload as { rows?: BoqResultRow[]; partyId?: string | null };
    const codes = [...new Set((p.rows ?? []).flatMap((r) => r.matches.map((m) => m.productCode)))];
    const products = codes.length ? await tx.select({ id: product.id, code: product.code, nameAr: product.nameAr, nameEn: product.nameEn, listPrice: product.listPrice, uom: product.uom, archivedAt: product.archivedAt }).from(product).where(inArray(product.code, codes)) : [];
    const [pt] = p.partyId ? await tx.select({ id: party.id, nameAr: party.nameAr, nameEn: party.nameEn }).from(party).where(eq(party.id, p.partyId)) : [];
    return { ...d, products: Object.fromEntries(products.filter((x) => !x.archivedAt).map((x) => [x.code, { id: x.id, nameAr: x.nameAr, nameEn: x.nameEn, listPrice: x.listPrice, uom: x.uom }])), party: pt ?? null };
  });
}

export interface ApplyInput { lines: { ref: string; productCode: string; qty: number; include: boolean }[]; partyId?: string | null; title?: string | null }

/** A person turns the reviewed suggestion into a DRAFT quote (needs quote.write + ai.approve). */
export async function applyDraft(actor: RequestActor, id: string, b: ApplyInput) {
  need(actor, 'ai.approve');
  need(actor, 'quote.write');
  return tenantTx(actor.tenantId, async (tx) => {
    const d = await loadDraft(tx, actor, id, true);
    if (d.entityType !== 'quote') throw badRequest('this draft does not create a quote');
    if (d.status !== 'pending') throw conflict(`the draft is already ${d.status}`);
    const chosen = b.lines.filter((l) => l.include);
    if (!chosen.length) throw badRequest('include at least one line');
    const codes = [...new Set(chosen.map((l) => l.productCode))];
    const prods = await tx.select().from(product).where(and(inArray(product.code, codes), isNull(product.archivedAt)));
    const byCode = new Map(prods.map((p) => [p.code, p]));
    const missing = codes.filter((c) => !byCode.has(c));
    if (missing.length) throw badRequest(`unknown or archived product code(s): ${missing.join(', ')}`);
    const partyId = b.partyId !== undefined ? b.partyId : ((d.payload as { partyId?: string | null }).partyId ?? null);
    let clientName: string | null = null;
    if (partyId) {
      const [p] = await tx.select().from(party).where(eq(party.id, partyId));
      if (!p) throw notFound('customer');
      assertCan(actor, 'party.read', { ownerId: p.ownerId });
      clientName = p.nameAr;
    }
    const lines: LineInput[] = chosen.map((l) => {
      const p = byCode.get(l.productCode)!;
      const desc = p.description?.trim() || [p.nameAr, p.nameEn].filter(Boolean).join(' | ');
      return { productId: p.id, code: p.code, description: l.ref?.trim() ? `[BOQ ${l.ref.trim()}] ${desc}` : desc, qty: String(Math.round(l.qty * 1000) / 1000) };
    });
    const quoteId = await createQuote(tx, actor, {
      partyId, clientName, projectName: b.title?.trim() || null,
      discountType: 'percent', discountValue: '0', vatOn: true, lines,
    });
    await tx.update(aiDraft).set({ status: 'applied', decidedBy: actor.userId, decidedAt: new Date(), entityId: quoteId, appliedEntityId: quoteId, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(aiDraft.id, id));
    await audit(tx, actor, 'apply', 'ai_draft', id, { status: 'pending' }, { status: 'applied', quoteId, lines: lines.length });
    return { quoteId };
  }, actor.userId);
}

export async function rejectDraft(actor: RequestActor, id: string, reason?: string | null) {
  return tenantTx(actor.tenantId, async (tx) => {
    const d = await loadDraft(tx, actor, id, true);
    if (d.createdBy !== actor.userId && !actor.grants['ai.approve']) throw forbidden('missing permission: ai.approve');
    if (d.status !== 'pending') throw conflict(`the draft is already ${d.status}`);
    await tx.update(aiDraft).set({ status: 'rejected', decidedBy: actor.userId, decidedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId }).where(eq(aiDraft.id, id));
    await audit(tx, actor, 'reject', 'ai_draft', id, { status: 'pending' }, { status: 'rejected' }, reason ?? undefined);
    return { ok: true };
  }, actor.userId);
}

// ───────────────────────────── AI-02 replies & translation ─────────────────────────────

export interface ReplyInput { context: ReplyContext; thread?: string | null; conversationId?: string | null; tone: ReplyTone; language: 'ar' | 'en'; dialect?: 'msa' | 'hijazi' | null; instructions?: string | null }

export async function draftReply(actor: RequestActor, b: ReplyInput) {
  let thread = b.thread?.trim() ?? '';
  if (!thread && b.conversationId) {
    need(actor, 'message.read');
    // same handler (and checks) as GET /crm/inbox/:id
    const c = await new CrmController().conversation(actor, b.conversationId);
    thread = c.messages.slice(-30).filter((m) => m.body).map((m) => `${m.direction === 'in' ? 'Customer' : 'Us'}: ${m.body}`).join('\n');
  }
  if (!thread) throw badRequest('send the conversation text (thread) or a conversationId');
  const company = await tenantTx(actor.tenantId, async (tx) => (await loadCompany(tx)).legalNameAr ?? 'MMC');
  const dialect = b.language === 'ar' ? (b.dialect ?? 'msa') : undefined;
  const r = await runAi(actor, {
    feature: 'reply',
    input: { thread: thread.slice(-12_000), instructions: (b.instructions ?? '').slice(0, 1000) },
    meta: { context: b.context, tone: b.tone, language: b.language, dialect },
    sandbox: () => sandboxReply({ language: b.language, dialect, context: b.context }),
    live: (input) => claudeText({ system: replySystem({ context: b.context, tone: b.tone, language: b.language, dialect, company }), user: replyUser(input.thread, input.instructions || undefined), effort: 'low', maxTokens: 4_000 }),
  });
  return { text: r.result, sandbox: r.sandbox, callId: r.callId };
}

export async function translate(actor: RequestActor, b: { text: string; to: 'ar' | 'en' }) {
  const r = await runAi(actor, {
    feature: 'translate',
    input: { text: b.text },
    meta: { to: b.to },
    sandbox: (input) => sandboxTranslate(input.text, b.to),
    live: (input) => claudeText({ system: translateSystem(b.to), user: input.text, effort: 'low', maxTokens: Math.min(16_000, 2_000 + b.text.length * 2) }),
  });
  return { text: r.result, sandbox: r.sandbox, callId: r.callId };
}

// ───────────────────────────── usage ─────────────────────────────

export async function usage(actor: RequestActor, days: number) {
  const everyone = !!actor.grants['admin.settings'];
  return tenantTx(actor.tenantId, async (tx) => {
    const where = and(sql`${aiCall.createdAt} >= now() - make_interval(days => ${days})`, everyone ? undefined : eq(aiCall.userId, actor.userId));
    const byFeature = await tx.select({
      feature: aiCall.feature,
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${aiCall.status} in ('error','blocked'))::int`,
      inputTokens: sql<number>`coalesce(sum(${aiCall.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiCall.outputTokens}), 0)::int`,
      costUsd: sql<string>`coalesce(sum(${aiCall.costUsd}), 0)::numeric(18,4)::text`,
    }).from(aiCall).where(where).groupBy(aiCall.feature).orderBy(aiCall.feature);
    const byUser = everyone ? await tx.select({
      userId: aiCall.userId, name: appUser.nameAr, email: appUser.email,
      calls: sql<number>`count(*)::int`, costUsd: sql<string>`coalesce(sum(${aiCall.costUsd}), 0)::numeric(18,4)::text`,
    }).from(aiCall).leftJoin(appUser, eq(appUser.id, aiCall.userId)).where(where).groupBy(aiCall.userId, appUser.nameAr, appUser.email).orderBy(desc(sql`count(*)`)).limit(50) : [];
    const spent = await spentTodayUsd(actor.tenantId);
    return { days, scope: everyone ? 'company' : 'own', byFeature, byUser, today: { spentUsd: spent, budgetUsd: aiConfig.dailyUsd }, sandbox: aiConfig.sandbox, model: aiConfig.model };
  });
}

// ───────────────────────────── personal access tokens (MCP) ─────────────────────────────

export const TOKEN_PREFIX = 'mmc_pat_';
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function listTokens(actor: RequestActor) {
  return tenantTx(actor.tenantId, (tx) => tx.select({ id: apiToken.id, name: apiToken.name, scopes: apiToken.scopes, expiresAt: apiToken.expiresAt, lastUsedAt: apiToken.lastUsedAt, revokedAt: apiToken.revokedAt, createdAt: apiToken.createdAt })
    .from(apiToken).where(eq(apiToken.userId, actor.userId)).orderBy(desc(apiToken.createdAt)));
}

export async function createToken(actor: RequestActor, b: { name: string; expiresInDays: number }) {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + b.expiresInDays * 86_400_000);
  return tenantTx(actor.tenantId, async (tx) => {
    const [r] = await tx.insert(apiToken).values({ userId: actor.userId, name: b.name.trim(), tokenHash: hashToken(token), scopes: ['mcp:read'], expiresAt }).returning();
    await audit(tx, actor, 'create', 'api_token', r!.id, null, { name: r!.name, scopes: r!.scopes, expiresAt });
    // the plain token is returned once and never stored
    return { id: r!.id, name: r!.name, scopes: r!.scopes, expiresAt: r!.expiresAt, token };
  }, actor.userId);
}

export async function revokeToken(actor: RequestActor, id: string) {
  if (!isUuid(id)) throw notFound('token');
  return tenantTx(actor.tenantId, async (tx) => {
    const [t] = await tx.select().from(apiToken).where(eq(apiToken.id, id));
    if (!t || (t.userId !== actor.userId && !actor.grants['admin.users'])) throw notFound('token');
    if (!t.revokedAt) {
      await tx.update(apiToken).set({ revokedAt: new Date() }).where(eq(apiToken.id, id));
      await audit(tx, actor, 'revoke', 'api_token', id, null, { name: t.name });
    }
    return { ok: true };
  }, actor.userId);
}

