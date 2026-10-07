import { randomBytes } from 'node:crypto';
import {
  and, appUser, approvalRequest, asc, company, contract, desc, emit, eq, inArray, issuedDocument, nextNumber, notification, opportunity, pipelineStage, priceList, product, quote, quoteLine, quoteSection, role, sql, userRole, activity, type Tx,
} from '@mmc/db';
import {
  approvalReasons, calculateQuote, canTransitionQuote, dec, fromHalalas, halalasToFixed, INS_CODE, isQuoteEditable, riyadhDate, syncInstallationLine, type QuoteLineInput, type QuoteStatus,
} from '@mmc/domain';
import { htmlToPdf, renderQuoteHtml } from '@mmc/doc-templates';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { companyBlock, loadCompany } from '../common/company.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { inlineImages, storeFile } from '../common/files.js';
import { assertCan } from '../common/scope.js';
import { config } from '../config.js';
import { resolvePrices } from './pricelists.controller.js';

export interface LineInput {
  productId?: string | null;
  code: string;
  description: string;
  listPrice?: string | null;
  /** omitted → the customer's price-list price (else the catalog list price) */
  unitPrice?: string | null;
  qty: string;
  installCost?: string | null;
  unitCost?: string | null;
  isOptional?: boolean;
  manualPrice?: boolean;
  sectionKey?: string | null;
  imageUrl?: string | null;
}

export interface QuoteInput {
  partyId?: string | null;
  contactId?: string | null;
  siteId?: string | null;
  opportunityId?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  projectName?: string | null;
  projectLocation?: string | null;
  quoteDate?: string;
  validUntil?: string | null;
  discountType: 'percent' | 'amount';
  discountValue: string;
  vatOn: boolean;
  insDeleted?: boolean;
  notes?: string | null;
  terms?: string | null;
  language?: 'ar' | 'en';
  sections?: { key: string; title: string }[];
  lines: LineInput[];
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type HydratedLine = LineInput & { unitPrice: string };

/**
 * Product snapshot for new lines: list price, install cost, SAR unit cost from USD × rate.
 * A line sent without a unit price takes the customer's price-list price (CPQ-05); its list price
 * stays the catalog price, so the struck-through list price and "discount from list" still work.
 */
async function hydrateLines(tx: Tx, lines: LineInput[], partyId?: string | null): Promise<{ lines: HydratedLine[]; priceListId: string | null }> {
  const ids = lines.map((l) => l.productId).filter((x): x is string => !!x);
  const products = ids.length ? await tx.select().from(product).where(inArray(product.id, ids)) : [];
  const resolved = await resolvePrices(tx, partyId, ids);
  return {
    priceListId: resolved.priceList?.id ?? null,
    lines: lines.map((l) => {
      const p = products.find((x) => x.id === l.productId);
      if (!p) return { ...l, unitPrice: l.unitPrice ?? l.listPrice ?? '0' };
      const unitCostSar = p.costPrice ? dec(p.costPrice).times(p.costCurrency === 'SAR' ? 1 : dec(p.costRateToSar)).toDecimalPlaces(4).toString() : null;
      return {
        ...l,
        listPrice: l.listPrice ?? p.listPrice,
        unitPrice: l.unitPrice ?? resolved.prices[p.id]?.price ?? l.listPrice ?? p.listPrice,
        installCost: l.installCost ?? p.installCost,
        unitCost: l.unitCost ?? unitCostSar,
        imageUrl: l.imageUrl ?? p.imageUrl,
      };
    }),
  };
}

function toDomain(lines: HydratedLine[]): QuoteLineInput[] {
  return lines.map((l) => ({
    code: l.code,
    description: l.description,
    listPrice: l.listPrice ?? l.unitPrice,
    unitPrice: l.unitPrice,
    qty: l.qty,
    installCost: l.installCost ?? '0',
    unitCost: l.unitCost ?? '0',
    isOptional: !!l.isOptional,
    manualPrice: !!l.manualPrice,
    // the INS line always stays last and outside sections
    sectionKey: l.code === INS_CODE ? null : l.sectionKey ?? null,
  }));
}

export async function loadQuote(tx: Tx, id: string) {
  const [q] = await tx.select().from(quote).where(eq(quote.id, id));
  if (!q) throw notFound('quote');
  const lines = await tx.select().from(quoteLine).where(eq(quoteLine.quoteId, id)).orderBy(asc(quoteLine.sort));
  const sections = await tx.select().from(quoteSection).where(eq(quoteSection.quoteId, id)).orderBy(asc(quoteSection.sort));
  return { ...q, lines, sections };
}

/** Recompute, then persist header totals and line totals (INS kept last, legacy rules). */
async function writeLines(tx: Tx, quoteId: string, input: QuoteInput, vatRegistered: boolean) {
  const { lines: hydrated, priceListId } = await hydrateLines(tx, input.lines, input.partyId);
  const synced = syncInstallationLine(toDomain(hydrated), { insDeleted: input.insDeleted });
  const calc = calculateQuote({ lines: synced, discount: { type: input.discountType, value: input.discountValue }, vatRegistered, vatOn: input.vatOn });
  await tx.delete(quoteLine).where(eq(quoteLine.quoteId, quoteId));
  await tx.delete(quoteSection).where(eq(quoteSection.quoteId, quoteId));
  const sectionIds = new Map<string, string>();
  for (const [i, s] of (input.sections ?? []).entries()) {
    if (sectionIds.has(s.key)) throw badRequest(`section key "${s.key}" appears twice`);
    const [row] = await tx.insert(quoteSection).values({ quoteId, title: s.title.trim() || `${i + 1}`, sort: i }).returning();
    sectionIds.set(s.key, row!.id);
  }
  if (synced.length) {
    // syncInstallationLine keeps non-INS lines in order and puts INS last, so map by position.
    const nonIns = hydrated.filter((h) => h.code !== INS_CODE);
    await tx.insert(quoteLine).values(synced.map((l, i) => {
      const src = l.code === INS_CODE ? undefined : nonIns[i];
      return {
        quoteId,
        sort: i,
        sectionId: l.sectionKey ? sectionIds.get(l.sectionKey) ?? null : null,
        productId: l.code === INS_CODE ? null : src?.productId ?? null,
        code: l.code,
        description: l.description,
        isDescriptionModified: false,
        listPrice: String(l.listPrice),
        unitPrice: String(l.unitPrice),
        qty: String(l.qty),
        installCost: String(l.installCost ?? '0'),
        unitCost: l.unitCost ? String(l.unitCost) : null,
        lineTotal: halalasToFixed(calc.lines[i]!.amount),
        isOptional: !!l.isOptional,
        isLabor: l.code === INS_CODE,
        isAutoLabor: l.code === INS_CODE && !l.manualPrice,
        manualPrice: !!l.manualPrice,
        imageUrl: src?.imageUrl ?? null,
      };
    }));
  }
  const t = calc.totals;
  return {
    calc,
    priceListId,
    totals: {
      subtotal: halalasToFixed(t.subtotal), discountAmount: halalasToFixed(t.discount), taxable: halalasToFixed(t.taxable), vatAmount: halalasToFixed(t.vat), total: halalasToFixed(t.total),
      costTotal: halalasToFixed(t.cost), marginTotal: halalasToFixed(t.margin), vatOn: t.vatApplied,
    },
  };
}

/** "margin 12.5% < 20%" → "margin below the minimum": the reason stays visible, the figure doesn't. */
const hideMarginFigure = (r: string) => (r.startsWith('margin ') ? 'margin below the minimum' : r);

/**
 * Without quote.cost.read nothing derived from purchase cost leaves the API: stored totals, line unit
 * costs, the computed cost/margin (per line and in totals) and the margin figure in approval reasons.
 */
function stripCost<T extends { lines?: { unitCost: string | null }[]; costTotal?: string; marginTotal?: string }>(actor: RequestActor, q: T): T {
  if (actor.grants['quote.cost.read']) return q;
  const x = q as T & {
    computed?: { lines: Record<string, unknown>[]; totals: Record<string, unknown> };
    approvalReasons?: string[];
    approvals?: { reasons: string[] }[];
  };
  return {
    ...x,
    costTotal: undefined,
    marginTotal: undefined,
    lines: x.lines?.map((l) => ({ ...l, unitCost: null })),
    ...(x.computed ? { computed: { lines: x.computed.lines.map((l) => ({ ...l, cost: null })), totals: { ...x.computed.totals, cost: null, margin: null, marginPercent: null } } } : {}),
    ...(x.approvalReasons ? { approvalReasons: x.approvalReasons.map(hideMarginFigure) } : {}),
    ...(x.approvals ? { approvals: x.approvals.map((a) => ({ ...a, reasons: (a.reasons ?? []).map(hideMarginFigure) })) } : {}),
  } as T;
}

export async function getQuoteView(tx: Tx, actor: RequestActor, id: string) {
  const q = await loadQuote(tx, id);
  assertCan(actor, 'quote.read', { ownerId: q.ownerId, teamId: q.teamId, branchId: q.branchId });
  const co = await loadCompany(tx);
  const calc = calculateQuote({
    // section keys are the quote_section row ids (the editor uses them as its keys too)
    lines: q.lines.map((l) => ({ code: l.code, description: l.description, listPrice: l.listPrice, unitPrice: l.unitPrice, qty: l.qty, unitCost: l.unitCost ?? '0', isOptional: l.isOptional, sectionKey: l.sectionId })),
    discount: { type: q.discountType as 'percent' | 'amount', value: q.discountValue },
    vatRegistered: co.vatRegistered,
    vatOn: q.vatOn,
  });
  const [pl] = q.priceListId ? await tx.select({ id: priceList.id, name: priceList.name }).from(priceList).where(eq(priceList.id, q.priceListId)) : [];
  const reasons = approvalReasons(calc.totals, co.approvalPolicy, q.lines.some((l) => l.unitCost !== null));
  const approvals = await tx.select().from(approvalRequest).where(and(eq(approvalRequest.documentType, 'quote'), eq(approvalRequest.entityId, id))).orderBy(desc(approvalRequest.createdAt));
  const documents = await tx.select().from(issuedDocument).where(and(eq(issuedDocument.documentType, 'quote'), eq(issuedDocument.entityId, id))).orderBy(desc(issuedDocument.issuedAt));
  const revisions = await tx.select({ id: quote.id, revision: quote.revision, status: quote.status, total: quote.total, createdAt: quote.createdAt }).from(quote).where(eq(quote.rootQuoteId, q.rootQuoteId ?? q.id)).orderBy(asc(quote.revision));
  // the live (not cancelled) contract made from this quote, so the editor links to it instead of offering a new one
  const [linkedContract] = await tx.select({ id: contract.id, number: contract.number, status: contract.status }).from(contract).where(and(eq(contract.quoteId, id), sql`${contract.status} <> 'cancelled'`));
  const [owner] = q.ownerId ? await tx.select({ id: appUser.id, nameAr: appUser.nameAr, email: appUser.email }).from(appUser).where(eq(appUser.id, q.ownerId)) : [];
  const given = Math.max(calc.totals.discountPercent, calc.totals.discountFromListPercent);
  const needsApproval = reasons.length > 0 || given > actor.maxDiscountPercent;
  return stripCost(actor, {
    ...q,
    owner: owner ?? null,
    priceList: pl ?? null,
    computed: { lines: calc.lines, totals: calc.totals },
    approvalReasons: reasons,
    needsApproval,
    editable: isQuoteEditable(q.status as QuoteStatus),
    approvals,
    documents,
    revisions,
    vatRegistered: co.vatRegistered,
    contract: linkedContract ?? null,
  });
}

export async function createQuote(tx: Tx, actor: RequestActor, input: QuoteInput) {
  const co = await loadCompany(tx);
  const date = input.quoteDate ?? riyadhDate();
  const { number } = await nextNumber(tx, 'quote');
  const [q] = await tx.insert(quote).values({
    number,
    revision: 0,
    partyId: input.partyId ?? null,
    contactId: input.contactId ?? null,
    siteId: input.siteId ?? null,
    opportunityId: input.opportunityId ?? null,
    clientName: input.clientName ?? null,
    clientPhone: input.clientPhone ?? null,
    clientEmail: input.clientEmail ?? null,
    projectName: input.projectName ?? null,
    projectLocation: input.projectLocation ?? null,
    ownerId: actor.userId,
    teamId: actor.teamIds[0] ?? null,
    branchId: actor.branchId,
    companyId: co.id,
    quoteDate: date,
    validUntil: input.validUntil ?? addDays(date, co.quoteDefaults?.validityDays ?? 15),
    discountType: input.discountType,
    discountValue: input.discountValue,
    vatOn: input.vatOn && co.vatRegistered,
    insDeleted: !!input.insDeleted,
    notes: input.notes ?? co.quoteDefaults?.notesAr ?? null,
    terms: input.terms ?? co.quoteDefaults?.termsAr ?? null,
    language: input.language ?? 'ar',
    createdBy: actor.userId,
  }).returning();
  await tx.update(quote).set({ rootQuoteId: q!.id }).where(eq(quote.id, q!.id));
  const { totals, priceListId } = await writeLines(tx, q!.id, input, co.vatRegistered);
  await tx.update(quote).set({ ...totals, priceListId }).where(eq(quote.id, q!.id));
  await audit(tx, actor, 'create', 'quote', q!.id, null, { number, total: totals.total });
  await emit(tx, 'quote', q!.id, 'quote.created', { number });
  return q!.id;
}

export async function updateQuote(tx: Tx, actor: RequestActor, id: string, input: QuoteInput, expectedVersion?: number) {
  const before = await loadQuote(tx, id);
  assertCan(actor, 'quote.write', { ownerId: before.ownerId, teamId: before.teamId, branchId: before.branchId });
  if (!isQuoteEditable(before.status as QuoteStatus)) throw conflict('this quote was sent — create a revision to change it');
  if (expectedVersion !== undefined && expectedVersion !== before.version) throw conflict('the quote was changed by someone else — reload');
  const co = await loadCompany(tx);
  const { totals, priceListId } = await writeLines(tx, id, input, co.vatRegistered);
  // Any change invalidates an approval.
  const status = before.status === 'approved' || before.status === 'pending_approval' ? 'draft' : before.status;
  await tx.update(quote).set({
    partyId: input.partyId ?? null, contactId: input.contactId ?? null, siteId: input.siteId ?? null, opportunityId: input.opportunityId ?? before.opportunityId,
    clientName: input.clientName ?? null, clientPhone: input.clientPhone ?? null, clientEmail: input.clientEmail ?? null,
    projectName: input.projectName ?? null, projectLocation: input.projectLocation ?? null,
    quoteDate: input.quoteDate ?? before.quoteDate, validUntil: input.validUntil ?? before.validUntil,
    discountType: input.discountType, discountValue: input.discountValue, insDeleted: !!input.insDeleted,
    notes: input.notes ?? null, terms: input.terms ?? null, language: input.language ?? before.language,
    ...totals, priceListId, status, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1,
  }).where(eq(quote.id, id));
  if (before.total !== totals.total || before.discountValue !== input.discountValue || before.status !== status) {
    await audit(tx, actor, 'update', 'quote', id, { total: before.total, discount: `${before.discountType}:${before.discountValue}`, status: before.status }, { total: totals.total, discount: `${input.discountType}:${input.discountValue}`, status });
  }
}

/** New revision R(n+1) of a sent/rejected/expired quote: same number, lines copied, old one superseded. */
export async function reviseQuote(tx: Tx, actor: RequestActor, id: string) {
  const q = await loadQuote(tx, id);
  assertCan(actor, 'quote.write', { ownerId: q.ownerId, teamId: q.teamId });
  if (isQuoteEditable(q.status as QuoteStatus)) throw badRequest('edit the draft directly — revisions are for quotes already sent');
  if (q.status === 'accepted' || q.status === 'lost' || q.status === 'superseded') throw badRequest(`a ${q.status} quote cannot be revised`);
  const [latest] = await tx.select({ revision: quote.revision }).from(quote).where(eq(quote.rootQuoteId, q.rootQuoteId ?? q.id)).orderBy(desc(quote.revision)).limit(1);
  const { id: _id, lines, sections, createdAt: _c, updatedAt: _u, publicToken: _t, sentAt: _s, viewedAt: _v, acceptedAt: _a, rejectedAt: _r, ...rest } = q;
  const [n] = await tx.insert(quote).values({ ...rest, revision: (latest?.revision ?? q.revision) + 1, parentQuoteId: q.id, rootQuoteId: q.rootQuoteId ?? q.id, status: 'draft', quoteDate: riyadhDate(), version: 1, createdBy: actor.userId, ownerId: q.ownerId }).returning();
  const secMap = new Map<string, string>();
  for (const s of sections) {
    const [row] = await tx.insert(quoteSection).values({ quoteId: n!.id, title: s.title, sort: s.sort }).returning();
    secMap.set(s.id, row!.id);
  }
  if (lines.length) await tx.insert(quoteLine).values(lines.map(({ id: _lid, quoteId: _qid, tenantId: _tid, ...l }) => ({ ...l, quoteId: n!.id, sectionId: l.sectionId ? secMap.get(l.sectionId) ?? null : null })));
  await tx.update(quote).set({ status: 'superseded', updatedAt: new Date() }).where(eq(quote.id, q.id));
  await audit(tx, actor, 'revise', 'quote', n!.id, { from: q.id, revision: q.revision }, { revision: n!.revision });
  return n!.id;
}

async function approverIds(tx: Tx): Promise<string[]> {
  const rows = await tx.select({ userId: userRole.userId, grants: role.grants }).from(userRole).innerJoin(role, eq(role.id, userRole.roleId));
  return [...new Set(rows.filter((r) => (r.grants as Record<string, string>)['quote.approve']).map((r) => r.userId))];
}

export async function submitQuote(tx: Tx, actor: RequestActor, id: string) {
  const view = await getQuoteView(tx, actor, id);
  assertCan(actor, 'quote.write', { ownerId: view.ownerId, teamId: view.teamId });
  if (view.status !== 'draft') throw badRequest('only drafts can be submitted');
  if (!view.lines.length) throw badRequest('add at least one line');
  if (!view.needsApproval) {
    await tx.update(quote).set({ status: 'approved', updatedAt: new Date() }).where(eq(quote.id, id));
    await audit(tx, actor, 'auto_approve', 'quote', id, null, { discountPercent: view.computed.totals.discountPercent });
    return { status: 'approved' as const };
  }
  const given = Math.max(view.computed.totals.discountPercent, view.computed.totals.discountFromListPercent);
  const reasons = view.approvalReasons.length ? view.approvalReasons : [`discount ${given}% above your limit ${actor.maxDiscountPercent}%`];
  await tx.insert(approvalRequest).values({ documentType: 'quote', entityId: id, reasons, requestedBy: actor.userId });
  await tx.update(quote).set({ status: 'pending_approval', updatedAt: new Date() }).where(eq(quote.id, id));
  for (const uid of await approverIds(tx)) {
    if (uid === actor.userId) continue;
    await tx.insert(notification).values({ userId: uid, kind: 'approval', titleAr: `عرض ${view.number} بانتظار الموافقة: ${reasons.join('، ')}`, titleEn: `Quote ${view.number} awaits approval`, link: `/quotes/${id}` });
  }
  await audit(tx, actor, 'submit', 'quote', id, null, { reasons });
  return { status: 'pending_approval' as const, reasons };
}

export async function decideQuote(tx: Tx, actor: RequestActor, id: string, decision: 'approve' | 'reject', comment?: string | null) {
  const q = await loadQuote(tx, id);
  assertCan(actor, 'quote.approve', { ownerId: q.ownerId, teamId: q.teamId });
  if (q.status !== 'pending_approval') throw badRequest('quote is not waiting for approval');
  // Separation of duties: the requester cannot approve their own quote (owners excepted).
  if (q.ownerId === actor.userId && !actor.roleKeys.includes('owner')) throw forbidden('you cannot approve your own quote');
  const view = await getQuoteView(tx, actor, id);
  if (decision === 'approve' && Math.max(view.computed.totals.discountPercent, view.computed.totals.discountFromListPercent) > actor.maxDiscountPercent) throw forbidden(`discount above your approval limit (${actor.maxDiscountPercent}%) — escalate`);
  const [req] = await tx.select().from(approvalRequest).where(and(eq(approvalRequest.documentType, 'quote'), eq(approvalRequest.entityId, id), eq(approvalRequest.status, 'pending'))).orderBy(desc(approvalRequest.createdAt)).limit(1);
  if (req) await tx.update(approvalRequest).set({ status: decision === 'approve' ? 'approved' : 'rejected', decidedBy: actor.userId, decidedAt: new Date(), comment: comment ?? null }).where(eq(approvalRequest.id, req.id));
  await tx.update(quote).set({ status: decision === 'approve' ? 'approved' : 'draft', updatedAt: new Date() }).where(eq(quote.id, id));
  if (q.ownerId) await tx.insert(notification).values({ userId: q.ownerId, kind: 'approval', titleAr: decision === 'approve' ? `تمت الموافقة على العرض ${q.number}` : `رُفض العرض ${q.number}: ${comment ?? ''}`, link: `/quotes/${id}` });
  await audit(tx, actor, decision, 'quote', id, null, { comment });
}

export async function setQuoteStatus(tx: Tx, actor: RequestActor, id: string, to: QuoteStatus, reason?: string | null) {
  const q = await loadQuote(tx, id);
  assertCan(actor, 'quote.write', { ownerId: q.ownerId, teamId: q.teamId });
  if (!canTransitionQuote(q.status as QuoteStatus, to)) throw badRequest(`cannot move a ${q.status} quote to ${to}`);
  const now = new Date();
  await tx.update(quote).set({
    status: to,
    acceptedAt: to === 'accepted' ? now : q.acceptedAt,
    rejectedAt: to === 'rejected' ? now : q.rejectedAt,
    lostReason: to === 'lost' || to === 'rejected' ? reason ?? null : q.lostReason,
    updatedAt: now,
  }).where(eq(quote.id, id));
  await audit(tx, actor, `status_${to}`, 'quote', id, { status: q.status }, { status: to, reason });
  await emit(tx, 'quote', id, `quote.${to}`, { number: q.number });
  if (q.opportunityId && (to === 'accepted' || to === 'lost')) await moveOpportunityStage(tx, q.opportunityId, to === 'accepted' ? 'won' : 'lost', reason);
}

export async function moveOpportunityStage(tx: Tx, opportunityId: string, stageKey: string, reason?: string | null) {
  const [o] = await tx.select().from(opportunity).where(eq(opportunity.id, opportunityId));
  if (!o) return;
  const [st] = await tx.select().from(pipelineStage).where(and(eq(pipelineStage.pipelineId, o.pipelineId), eq(pipelineStage.key, stageKey)));
  if (!st) return;
  const cur = await tx.select().from(pipelineStage).where(eq(pipelineStage.id, o.stageId));
  if (cur[0] && (cur[0].kind !== 'open' || cur[0].sort >= st.sort) && st.kind === 'open') return;
  await tx.update(opportunity).set({ stageId: st.id, probability: st.probability, wonAt: st.kind === 'won' ? new Date() : null, lostAt: st.kind === 'lost' ? new Date() : null, lostReasonKey: st.kind === 'lost' ? reason ?? 'other' : null, lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(opportunity.id, opportunityId));
}

export function quoteDocFrom(q: Awaited<ReturnType<typeof getQuoteView>>, ownerName?: string | null) {
  // Section subtotals from the line amounts (optional lines excluded, as in the totals).
  const sections = (q.sections ?? []).map((s) => ({
    key: s.id,
    title: s.title,
    subtotal: q.lines.reduce((sum, l, i) => (l.sectionId === s.id && !l.isOptional && l.code !== INS_CODE ? sum + q.computed.lines[i]!.amount : sum), 0),
  }));
  return {
    number: q.number,
    revision: q.revision,
    date: q.quoteDate,
    validUntil: q.validUntil,
    clientName: q.clientName,
    clientPhone: q.clientPhone,
    clientEmail: q.clientEmail,
    projectName: q.projectName,
    projectLocation: q.projectLocation,
    salesRep: ownerName ?? null,
    lines: q.lines.map((l, i) => {
      const c = q.computed.lines[i]!;
      const section = l.code === INS_CODE ? undefined : sections.find((s) => s.key === l.sectionId);
      return { code: l.code, description: l.description, qty: dec(l.qty).toString(), unitPrice: Math.round(Number(l.unitPrice) * 100), amount: c.amount, listAmount: c.listAmount, isFree: c.isFree, struck: c.struck, isOptional: l.isOptional, isIns: l.code === INS_CODE, imageUrl: l.imageUrl, sectionKey: section?.key ?? null, sectionTitle: section?.title ?? null };
    }),
    sections,
    totals: q.computed.totals,
    notes: q.notes,
    terms: q.terms,
  };
}

export async function renderQuotePdf(tx: Tx, actor: RequestActor, id: string) {
  const q = await getQuoteView(tx, actor, id);
  const doc = quoteDocFrom(q, q.owner?.nameAr);
  const html = renderQuoteHtml({ company: await companyBlock(tx), ...doc, lines: await inlineImages(tx, doc.lines) });
  return { quote: q, pdf: await htmlToPdf(html, config.gotenbergUrl) };
}

/** Archive the PDF exactly as sent (immutable, hashed). */
export async function issueQuoteDocument(tx: Tx, actor: RequestActor, id: string) {
  const { quote: q, pdf } = await renderQuotePdf(tx, actor, id);
  const f = await storeFile(tx, actor.tenantId, pdf, `${q.number}${q.revision ? `-R${q.revision}` : ''}.pdf`, 'application/pdf', actor.userId);
  await tx.insert(issuedDocument).values({ documentType: 'quote', entityId: id, number: q.number, revision: q.revision, language: q.language, fileId: f.id, sha256: f.sha256, issuedBy: actor.userId });
  return { quote: q, file: f, pdf };
}

export function newPublicToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function logActivity(tx: Tx, entityType: string, entityId: string, type: string, subject: string, ownerId: string | null, body?: string | null) {
  await tx.insert(activity).values({ entityType, entityId, type, subject, body: body ?? null, ownerId, doneAt: new Date() });
}

export async function markQuoteSent(tx: Tx, actor: RequestActor, id: string) {
  const q = await loadQuote(tx, id);
  const token = q.publicToken ?? newPublicToken();
  await tx.update(quote).set({ status: q.status === 'viewed' ? 'viewed' : 'sent', sentAt: q.sentAt ?? new Date(), publicToken: token, updatedAt: new Date() }).where(eq(quote.id, id));
  if (q.opportunityId) await moveOpportunityStage(tx, q.opportunityId, 'quoted');
  await audit(tx, actor, 'send', 'quote', id);
  return { token, link: `${config.publicBaseUrl}/q/${token}` };
}

export { company, fromHalalas };
