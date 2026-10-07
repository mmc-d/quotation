import {
  and, asc, desc, eq, inArray, materialRequest, materialRequestLine, messageTemplate, nextNumber, party, product, purchaseOrder, purchaseOrderLine, rfq, sql, supplierBill, supplierItem, supplierQuote, type Tx,
} from '@mmc/db';
import { dec, riyadhDate } from '@mmc/domain';
import { htmlToPdf, renderPurchaseOrderHtml, renderRfqHtml } from '@mmc/doc-templates';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { companyBlock, loadCompany } from '../common/company.js';
import { badRequest, forbidden, notFound } from '../common/errors.js';
import { readStoredFile, storeFile } from '../common/files.js';
import { sendTemplate } from '../common/messaging.js';
import { config } from '../config.js';
import { canCost, fq, isUuid, userNameMap } from './inventory.service.js';
import { createPurchaseOrder, defaultRate, loadPo, loadSupplier, purchaseOrderDoc, type PoLineInput } from './purchasing.service.js';
import { customerPhone } from './service.service.js';
import { parseZatcaInvoice, similarity, validateZatcaInvoice, ZatcaXmlError, type XmlIssue } from './zatca-xml.js';

/**
 * RFQ + supplier-quotation comparison (module 07, INV-65), supplier ZATCA e-invoice ingestion
 * (INV-66) and delivery of RFQs / purchase orders to suppliers (e-mail with the PDF, or a WhatsApp
 * utility template; sandboxed and logged in `message` without the integration env vars).
 */

export type RfqRow = typeof rfq.$inferSelect;
export type QuoteRow = typeof supplierQuote.$inferSelect;
export type Channel = 'auto' | 'email' | 'whatsapp' | 'none';

// ───────────────────────── message templates (also in seed-data/defaults.ts) ─────────────────────────

export const PURCHASING_TEMPLATES = [
  { key: 'rfq_request', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_rfq_request', variables: ['name', 'company', 'number', 'items', 'due'],
    body: 'مرحبًا {{name}}، تطلب {{company}} عرض سعر لطلب عروض الأسعار رقم {{number}} ({{items}} بنود) قبل {{due}}: السعر والعملة وشروط التسليم ومدة التوريد.\nDear supplier, {{company}} requests your quotation for RFQ {{number}} ({{items}} items) by {{due}}: price, currency, Incoterm and lead time.' },
  { key: 'rfq_request', channel: 'email', category: 'utility', language: 'ar', providerTemplateName: null, variables: ['name', 'company', 'number', 'items', 'due', 'lines'],
    body: 'مرحبًا {{name}}،\n\nنرجو تزويدنا بعرض سعر لطلب عروض الأسعار رقم {{number}} قبل {{due}} (المستند مرفق):\n{{lines}}\n\nيرجى ذكر سعر الوحدة والعملة وشروط التسليم (Incoterm) ومدة التوريد وصلاحية العرض.\n\nDear {{name}},\n\nPlease send your quotation for RFQ {{number}} ({{items}} items, document attached) by {{due}}, stating unit price, currency, Incoterm, lead time and validity.\n\n{{company}}' },
  { key: 'purchase_order', channel: 'whatsapp', category: 'utility', language: 'ar', providerTemplateName: 'mmc_purchase_order', variables: ['name', 'company', 'number', 'total'],
    body: 'مرحبًا {{name}}، أصدرت {{company}} أمر الشراء رقم {{number}} بإجمالي {{total}}. نرجو تأكيد الاستلام وموعد التوريد.\nDear supplier, {{company}} has issued purchase order {{number}} ({{total}}). Please confirm receipt and the delivery date.' },
  { key: 'purchase_order', channel: 'email', category: 'utility', language: 'ar', providerTemplateName: null, variables: ['name', 'company', 'number', 'total'],
    body: 'مرحبًا {{name}}،\n\nمرفق أمر الشراء رقم {{number}} بإجمالي {{total}}. نرجو تأكيد الاستلام وموعد التوريد.\n\nDear {{name}},\n\nPlease find attached purchase order {{number}} ({{total}}). Kindly confirm receipt and the delivery date.\n\n{{company}}' },
];

export async function ensurePurchasingTemplates(tx: Tx) {
  await tx.insert(messageTemplate).values(PURCHASING_TEMPLATES).onConflictDoNothing();
}

// ───────────────────────── delivery to a supplier ─────────────────────────

export interface Delivery {
  supplierId: string;
  supplierName: string;
  channel: 'email' | 'whatsapp' | 'none';
  to: string | null;
  /** sent | sandboxed | failed | skipped */
  status: string;
  messageId: string | null;
  attachment: 'pdf' | 'html' | null;
  note?: string;
}

async function renderAttachment(html: string, name: string): Promise<{ filename: string; content: Buffer; kind: 'pdf' | 'html' }> {
  try {
    return { filename: `${name}.pdf`, content: await htmlToPdf(html, config.gotenbergUrl), kind: 'pdf' };
  } catch {
    // Gotenberg down (dev/tests): the bilingual HTML still carries the full document
    return { filename: `${name}.html`, content: Buffer.from(html, 'utf8'), kind: 'html' };
  }
}

/**
 * Send one templated message to a supplier: e-mail (with the document attached) when the supplier
 * has an address, else WhatsApp to the supplier's primary contact / phone. Runs in a savepoint so a
 * provider failure never rolls back the business change; the outcome is returned for the audit.
 */
async function deliverToSupplier(tx: Tx, actor: RequestActor, s: { supplierId: string; channel: Channel; templateKey: string; subject: string; vars: Record<string, string>; related: { type: string; id: string }; attachment?: () => Promise<{ filename: string; content: Buffer; kind: 'pdf' | 'html' }> }): Promise<Delivery> {
  const [p] = await tx.select({ id: party.id, nameAr: party.nameAr, nameEn: party.nameEn, email: party.email }).from(party).where(eq(party.id, s.supplierId));
  if (!p) throw notFound('supplier');
  const base: Delivery = { supplierId: p.id, supplierName: p.nameAr, channel: 'none', to: null, status: 'skipped', messageId: null, attachment: null };
  if (s.channel === 'none') return { ...base, note: 'not sent (channel none)' };
  const phone = await customerPhone(tx, p.id);
  const email = p.email?.trim() || null;
  const channel: 'email' | 'whatsapp' | null = s.channel === 'email' ? (email ? 'email' : null) : s.channel === 'whatsapp' ? (phone.to ? 'whatsapp' : null) : email ? 'email' : phone.to ? 'whatsapp' : null;
  if (!channel) return { ...base, note: s.channel === 'auto' ? 'the supplier has no e-mail or phone' : `the supplier has no ${s.channel === 'email' ? 'e-mail' : 'phone'}` };
  await ensurePurchasingTemplates(tx);
  const to = channel === 'email' ? email! : phone.to!;
  const name = (channel === 'email' ? null : phone.name) || p.nameEn || p.nameAr;
  try {
    const att = channel === 'email' && s.attachment ? await s.attachment() : null;
    const r = await tx.transaction((sp) => sendTemplate(sp, {
      channel, to, templateKey: s.templateKey, vars: { name, ...s.vars }, subject: s.subject, related: s.related, link: { partyId: p.id, contactId: channel === 'whatsapp' ? phone.contactId : null }, sentBy: actor.userId,
      attachments: att ? [{ filename: att.filename, content: att.content }] : undefined,
    }));
    if (r.result.status === 'sandboxed') console.info(`[purchasing] sandbox ${channel} ${s.templateKey} → ${to} (${s.related.type} ${s.related.id})`);
    return { ...base, channel, to, status: r.result.status, messageId: r.message.id, attachment: att?.kind ?? null, ...(r.result.error ? { note: r.result.error } : {}) };
  } catch (e) {
    return { ...base, channel, to, status: 'failed', note: (e as Error).message.slice(0, 300) };
  }
}

/** Deliver an (already approved → sent) purchase order to its supplier. */
export async function deliverPurchaseOrder(tx: Tx, actor: RequestActor, poId: string, channel: Channel): Promise<Delivery> {
  const po = await loadPo(tx, actor, poId, 'purchase.write');
  const co = await loadCompany(tx);
  const cost = canCost(actor);
  const doc = cost ? await purchaseOrderDoc(tx, actor, po.id) : null;
  const total = cost ? `${dec(po.total ?? '0').toFixed(2)} ${po.currency}` : '—';
  const d = await deliverToSupplier(tx, actor, {
    supplierId: po.supplierId, channel, templateKey: 'purchase_order', subject: `أمر شراء / Purchase Order ${po.number} — ${co.legalNameEn || co.legalNameAr}`,
    vars: { company: co.legalNameEn || co.legalNameAr, number: po.number, total }, related: { type: 'purchase_order', id: po.id },
    attachment: doc ? () => renderAttachment(renderPurchaseOrderHtml(doc), po.number) : undefined,
  });
  return doc || d.channel !== 'email' ? d : { ...d, note: [d.note, 'PDF not attached: the sender has no purchase.cost.read'].filter(Boolean).join('; ') };
}

// ───────────────────────── RFQ ─────────────────────────

export interface RfqInput {
  materialRequestId?: string | null;
  lines?: { productId?: string | null; code?: string; description?: string | null; qty: string }[];
  supplierIds: string[];
  dueDate?: string | null;
  notes?: string | null;
}

export async function loadRfq(tx: Tx, id: string, lock = false) {
  if (!isUuid(id)) throw notFound('RFQ');
  const q = tx.select().from(rfq).where(eq(rfq.id, id));
  const [r] = lock ? await q.for('update') : await q;
  if (!r) throw notFound('RFQ');
  return r;
}

export async function createRfq(tx: Tx, actor: RequestActor, b: RfqInput) {
  const supplierIds = [...new Set(b.supplierIds)];
  for (const s of supplierIds) await loadSupplier(tx, s);
  let lines: RfqRow['lines'] = [];
  let mrNumber: string | null = null;
  if (b.materialRequestId) {
    if (!isUuid(b.materialRequestId)) throw notFound('material request');
    const [mr] = await tx.select().from(materialRequest).where(eq(materialRequest.id, b.materialRequestId));
    if (!mr) throw notFound('material request');
    if (!['draft', 'approved'].includes(mr.status)) throw badRequest(`a ${mr.status} material request cannot be quoted`);
    mrNumber = mr.number;
    const open = (await tx.select().from(materialRequestLine).where(eq(materialRequestLine.requestId, mr.id)).orderBy(asc(materialRequestLine.code))).filter((l) => dec(l.qty).gt(l.orderedQty));
    if (!open.length) throw badRequest('every line of the request is already on order');
    lines = open.map((l) => ({ productId: l.productId, code: l.code, description: l.description, qty: fq(dec(l.qty).minus(l.orderedQty)) }));
  }
  if (b.lines?.length) {
    if (b.materialRequestId) throw badRequest('give either a material request or lines, not both');
    for (const l of b.lines) {
      let code = l.code?.trim() ?? '';
      let description = l.description ?? null;
      if (l.productId) {
        const [p] = await tx.select().from(product).where(eq(product.id, l.productId));
        if (!p) throw badRequest(`unknown product ${l.productId}`);
        code ||= p.code;
        description ??= p.nameAr;
      }
      if (!code) throw badRequest('a line needs a product or a code');
      lines.push({ productId: l.productId ?? null, code, description, qty: l.qty });
    }
  }
  if (!lines.length) throw badRequest('an RFQ needs lines (or a material request with open lines)');
  const codes = lines.map((l) => l.code);
  if (new Set(codes).size !== codes.length) throw badRequest('a code appears twice — one line per code');
  const { number } = await nextNumber(tx, 'rfq');
  const [row] = await tx.insert(rfq).values({
    number, materialRequestId: b.materialRequestId ?? null, status: 'draft', dueDate: b.dueDate ?? null, lines, supplierIds, notes: b.notes ?? (mrNumber ? `من طلب المواد ${mrNumber}` : null), createdBy: actor.userId, updatedBy: actor.userId,
  }).returning();
  await audit(tx, actor, 'create', 'rfq', row!.id, null, { number, materialRequest: mrNumber, lines: lines.length, suppliers: supplierIds.length });
  return row!;
}

/** Quote lines with prices hidden for users without purchase.cost.read. */
function quoteOut(actor: RequestActor, q: QuoteRow) {
  const cost = canCost(actor);
  return { ...q, lines: q.lines.map((l) => ({ ...l, unitPrice: cost ? l.unitPrice : null, quoted: l.unitPrice != null })) };
}

export async function rfqView(tx: Tx, actor: RequestActor, id: string) {
  const r = await loadRfq(tx, id);
  const sups = r.supplierIds.length ? await tx.select({ id: party.id, nameAr: party.nameAr, nameEn: party.nameEn, email: party.email, phone: party.phone, vatNumber: party.vatNumber }).from(party).where(inArray(party.id, r.supplierIds)) : [];
  const quotes = await tx.select().from(supplierQuote).where(eq(supplierQuote.rfqId, r.id)).orderBy(asc(supplierQuote.createdAt));
  const [mr] = r.materialRequestId ? await tx.select({ id: materialRequest.id, number: materialRequest.number, status: materialRequest.status, projectId: materialRequest.projectId }).from(materialRequest).where(eq(materialRequest.id, r.materialRequestId)) : [];
  const [po] = r.purchaseOrderId ? await tx.select({ id: purchaseOrder.id, number: purchaseOrder.number, status: purchaseOrder.status }).from(purchaseOrder).where(eq(purchaseOrder.id, r.purchaseOrderId)) : [];
  const names = await userNameMap(tx, [r.createdBy]);
  return {
    ...r,
    createdByName: names.get(r.createdBy ?? '') ?? null,
    materialRequest: mr ?? null,
    purchaseOrder: po ?? null,
    suppliers: r.supplierIds.map((sid) => {
      const s = sups.find((x) => x.id === sid);
      const q = quotes.find((x) => x.supplierId === sid);
      return { id: sid, nameAr: s?.nameAr ?? '', nameEn: s?.nameEn ?? null, email: s?.email ?? null, phone: s?.phone ?? null, quoteId: q?.id ?? null };
    }),
    quotes: quotes.map((q) => ({ ...quoteOut(actor, q), supplierName: sups.find((s) => s.id === q.supplierId)?.nameAr ?? '' })),
    canSeePrices: canCost(actor),
  };
}

export async function listRfqs(tx: Tx, q: { limit: number; offset: number; status?: string; q?: string; materialRequestId?: string }) {
  const conds = [
    q.status ? inArray(rfq.status, q.status.split(',')) : undefined,
    q.materialRequestId ? eq(rfq.materialRequestId, q.materialRequestId) : undefined,
    q.q?.trim() ? sql`${rfq.number} ilike ${`%${q.q.trim()}%`}` : undefined,
  ].filter((x) => !!x);
  const where = conds.length ? and(...conds) : undefined;
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(rfq).where(where)) as [{ n: number }];
  const rows = await tx.select({
    r: rfq, mrNumber: materialRequest.number, poNumber: purchaseOrder.number,
    quotes: sql<number>`(select count(*)::int from supplier_quote q where q.rfq_id = ${rfq.id})`,
  }).from(rfq).leftJoin(materialRequest, eq(materialRequest.id, rfq.materialRequestId)).leftJoin(purchaseOrder, eq(purchaseOrder.id, rfq.purchaseOrderId))
    .where(where).orderBy(desc(rfq.createdAt)).limit(q.limit).offset(q.offset);
  return {
    rows: rows.map((x) => ({ ...x.r, lineCount: x.r.lines.length, supplierCount: x.r.supplierIds.length, quoteCount: x.quotes, materialRequestNumber: x.mrNumber, purchaseOrderNumber: x.poNumber })),
    total: n,
  };
}

/** Send the RFQ to every supplier (or the ones given): bilingual RFQ document by e-mail, else WhatsApp. */
export async function sendRfq(tx: Tx, actor: RequestActor, id: string, b: { channel?: Channel; supplierIds?: string[] }) {
  const r = await loadRfq(tx, id, true);
  if (!['draft', 'sent'].includes(r.status)) throw badRequest(`a ${r.status} RFQ cannot be sent`);
  const targets = b.supplierIds?.length ? b.supplierIds.filter((s) => r.supplierIds.includes(s)) : r.supplierIds;
  if (!targets.length) throw badRequest('no supplier to send to');
  const company = await companyBlock(tx);
  const due = r.dueDate ?? '—';
  const lineText = r.lines.map((l, i) => `${i + 1}. ${l.code}${l.description ? ` — ${l.description}` : ''} × ${l.qty}`).join('\n');
  const deliveries: Delivery[] = [];
  for (const sid of targets) {
    const s = await loadSupplier(tx, sid);
    deliveries.push(await deliverToSupplier(tx, actor, {
      supplierId: sid, channel: b.channel ?? 'auto', templateKey: 'rfq_request', subject: `طلب عرض سعر / Request for Quotation ${r.number} — ${company.legalNameEn || company.legalNameAr}`,
      vars: { company: company.legalNameEn || company.legalNameAr, number: r.number, items: String(r.lines.length), due, lines: lineText }, related: { type: 'rfq', id: r.id },
      attachment: () => renderAttachment(renderRfqHtml({
        company, number: r.number, date: riyadhDate(r.createdAt), dueDate: r.dueDate, supplier: { name: s.nameAr, nameEn: s.nameEn, vatNumber: s.vatNumber, email: s.email, phone: s.phone },
        lines: r.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty })), notes: r.notes,
      }), `${r.number}-${(s.nameEn || s.nameAr).replace(/[^\w]+/g, '_').slice(0, 30)}`),
    }));
  }
  if (r.status === 'draft') await tx.update(rfq).set({ status: 'sent', updatedAt: new Date(), updatedBy: actor.userId, version: r.version + 1 }).where(eq(rfq.id, r.id));
  await audit(tx, actor, 'send', 'rfq', r.id, { status: r.status }, { status: 'sent', deliveries: deliveries.map((d) => ({ supplier: d.supplierName, channel: d.channel, status: d.status, to: d.to })) });
  return { rfq: await rfqView(tx, actor, r.id), deliveries };
}

export async function rfqDocFor(tx: Tx, id: string, supplierId?: string) {
  const r = await loadRfq(tx, id);
  const sid = supplierId ?? r.supplierIds[0];
  if (!sid) throw badRequest('the RFQ has no supplier');
  const s = await loadSupplier(tx, sid);
  return {
    company: await companyBlock(tx), number: r.number, date: riyadhDate(r.createdAt), dueDate: r.dueDate,
    supplier: { name: s.nameAr, nameEn: s.nameEn, vatNumber: s.vatNumber, email: s.email, phone: s.phone },
    lines: r.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty })), notes: r.notes,
  };
}

export interface QuoteInput {
  supplierId: string; currency: string; rateToSar?: string; incoterm?: string | null; leadTimeDays?: number | null; validUntil?: string | null; landedPercent?: string;
  lines: { code: string; qty?: string; unitPrice: string | null; note?: string | null }[]; fileId?: string | null; notes?: string | null;
}

/** Record (or replace) a supplier's quotation for the RFQ. */
export async function upsertQuote(tx: Tx, actor: RequestActor, id: string, b: QuoteInput) {
  const r = await loadRfq(tx, id, true);
  if (!['draft', 'sent'].includes(r.status)) throw badRequest(`a ${r.status} RFQ takes no more quotations`);
  await loadSupplier(tx, b.supplierId);
  const rate = b.rateToSar ?? defaultRate(b.currency);
  if (!rate || dec(rate).lte(0)) throw badRequest(`give the SAR rate for ${b.currency} (rateToSar)`);
  const seen = new Set<string>();
  const lines = b.lines.map((l, i) => {
    const rl = r.lines.find((x) => x.code === l.code);
    if (!rl) throw badRequest(`line ${i + 1}: ${l.code} is not on ${r.number}`);
    if (seen.has(l.code)) throw badRequest(`line ${i + 1}: ${l.code} appears twice`);
    seen.add(l.code);
    return { code: l.code, qty: l.qty ?? rl.qty, unitPrice: l.unitPrice, note: l.note ?? null };
  });
  if (!lines.some((l) => l.unitPrice != null)) throw badRequest('the quotation prices no line');
  const values = {
    currency: b.currency, rateToSar: rate, incoterm: b.incoterm ?? null, leadTimeDays: b.leadTimeDays ?? null, validUntil: b.validUntil ?? null, landedPercent: b.landedPercent ?? '0',
    lines, fileId: b.fileId ?? null, notes: b.notes ?? null, updatedBy: actor.userId,
  };
  const [prior] = await tx.select().from(supplierQuote).where(and(eq(supplierQuote.rfqId, r.id), eq(supplierQuote.supplierId, b.supplierId)));
  let row: QuoteRow;
  if (prior) {
    [row] = (await tx.update(supplierQuote).set({ ...values, updatedAt: new Date(), version: prior.version + 1 }).where(eq(supplierQuote.id, prior.id)).returning()) as [QuoteRow];
  } else {
    [row] = (await tx.insert(supplierQuote).values({ rfqId: r.id, supplierId: b.supplierId, ...values, createdBy: actor.userId }).returning()) as [QuoteRow];
  }
  if (!r.supplierIds.includes(b.supplierId)) await tx.update(rfq).set({ supplierIds: [...r.supplierIds, b.supplierId], updatedAt: new Date(), updatedBy: actor.userId }).where(eq(rfq.id, r.id));
  await audit(tx, actor, prior ? 'update_quote' : 'add_quote', 'rfq', r.id, null, { supplierId: b.supplierId, currency: b.currency, landedPercent: values.landedPercent, quoted: lines.filter((l) => l.unitPrice != null).length });
  return quoteOut(actor, row);
}

/**
 * Bid comparison on landed cost + lead time. Per line and supplier: unit price → SAR (× rate) →
 * landed SAR (× (1 + landed%/100)); the lowest landed unit wins the line (tie → shorter lead time).
 * Supplier totals use the RFQ quantities over the lines they quoted; a supplier that skipped lines
 * shows its missing count and cannot be recommended. Recommended = lowest landed total among the
 * suppliers that quoted every line, tie → shorter lead time.
 */
export function compareQuotes(r: Pick<RfqRow, 'lines'>, quotes: (Pick<QuoteRow, 'id' | 'supplierId' | 'currency' | 'rateToSar' | 'landedPercent' | 'leadTimeDays' | 'validUntil' | 'incoterm' | 'lines'> & { supplierName?: string })[], today = riyadhDate()) {
  const lead = (d: number | null) => d ?? Number.POSITIVE_INFINITY;
  const lines = r.lines.map((l) => {
    const offers = quotes.map((q) => {
      const ql = q.lines.find((x) => x.code === l.code);
      if (!ql || ql.unitPrice == null) return { quoteId: q.id, supplierId: q.supplierId, quoted: false as const, unitPrice: null, unitSar: null, landedUnitSar: null, landedSar: null, leadTimeDays: q.leadTimeDays, best: false, note: ql?.note ?? null };
      const unitSar = dec(ql.unitPrice).times(q.rateToSar);
      const landedUnit = unitSar.times(dec(1).plus(dec(q.landedPercent).div(100)));
      return {
        quoteId: q.id, supplierId: q.supplierId, quoted: true as const, unitPrice: ql.unitPrice, unitSar: unitSar.toFixed(4), landedUnitSar: landedUnit.toFixed(4), landedSar: landedUnit.times(l.qty).toFixed(2),
        leadTimeDays: q.leadTimeDays, best: false, note: ql.note ?? null,
      };
    });
    const quoted = offers.filter((o) => o.quoted);
    const best = quoted.sort((a, b) => dec(a.landedUnitSar!).cmp(b.landedUnitSar!) || lead(a.leadTimeDays) - lead(b.leadTimeDays))[0];
    if (best) best.best = true;
    return { code: l.code, description: l.description ?? null, productId: l.productId, qty: l.qty, offers: quotes.map((q) => offers.find((o) => o.quoteId === q.id)!), bestSupplierId: best?.supplierId ?? null };
  });
  const totals = quotes.map((q) => {
    let goods = dec(0);
    let sar = dec(0);
    let landed = dec(0);
    let quotedLines = 0;
    for (const l of lines) {
      const o = l.offers.find((x) => x.quoteId === q.id)!;
      if (!o.quoted) continue;
      quotedLines++;
      goods = goods.plus(dec(o.unitPrice!).times(l.qty));
      sar = sar.plus(dec(o.unitSar!).times(l.qty));
      landed = landed.plus(o.landedSar!);
    }
    return {
      quoteId: q.id, supplierId: q.supplierId, supplierName: q.supplierName ?? '', currency: q.currency, rateToSar: q.rateToSar, landedPercent: q.landedPercent, incoterm: q.incoterm,
      leadTimeDays: q.leadTimeDays, validUntil: q.validUntil, expired: !!q.validUntil && q.validUntil < today,
      goodsTotal: goods.toFixed(2), totalSar: sar.toFixed(2), landedTotalSar: landed.toFixed(2), quotedLines, missingLines: lines.length - quotedLines,
      bestLines: lines.filter((l) => l.bestSupplierId === q.supplierId).length, recommended: false,
    };
  });
  const complete = totals.filter((t) => t.missingLines === 0 && t.quotedLines > 0).sort((a, b) => dec(a.landedTotalSar).cmp(b.landedTotalSar) || lead(a.leadTimeDays) - lead(b.leadTimeDays));
  const rec = complete[0] ?? null;
  if (rec) rec.recommended = true;
  return {
    lines, totals,
    recommended: rec ? { quoteId: rec.quoteId, supplierId: rec.supplierId, supplierName: rec.supplierName, landedTotalSar: rec.landedTotalSar, leadTimeDays: rec.leadTimeDays } : null,
    reason: rec ? null : quotes.length ? { ar: 'لا يوجد مورد سعّر جميع البنود', en: 'no supplier quoted every line' } : { ar: 'لا توجد عروض بعد', en: 'no quotations yet' },
  };
}

export async function rfqComparison(tx: Tx, actor: RequestActor, id: string) {
  if (!canCost(actor)) throw forbidden('the comparison shows prices (purchase.cost.read)');
  const r = await loadRfq(tx, id);
  const quotes = await tx.select({ q: supplierQuote, supplierName: party.nameAr }).from(supplierQuote).innerJoin(party, eq(party.id, supplierQuote.supplierId)).where(eq(supplierQuote.rfqId, r.id)).orderBy(asc(supplierQuote.createdAt));
  return { rfqId: r.id, number: r.number, status: r.status, awardedQuoteId: r.awardedQuoteId, ...compareQuotes(r, quotes.map((x) => ({ ...x.q, supplierName: x.supplierName }))) };
}

/** Award a quotation: a draft PO at that supplier's prices (quoted lines only), linked to the MR lines; the RFQ closes. */
export async function awardRfq(tx: Tx, actor: RequestActor, id: string, b: { supplierQuoteId: string; expectedOn?: string | null; depositPercent?: number }) {
  const r = await loadRfq(tx, id, true);
  if (!['draft', 'sent'].includes(r.status)) throw badRequest(`a ${r.status} RFQ cannot be awarded`);
  if (!isUuid(b.supplierQuoteId)) throw notFound('supplier quotation');
  const [q] = await tx.select().from(supplierQuote).where(and(eq(supplierQuote.id, b.supplierQuoteId), eq(supplierQuote.rfqId, r.id)));
  if (!q) throw notFound('supplier quotation');
  const [mr] = r.materialRequestId ? await tx.select().from(materialRequest).where(eq(materialRequest.id, r.materialRequestId)) : [];
  const mrLines = mr ? await tx.select().from(materialRequestLine).where(eq(materialRequestLine.requestId, mr.id)) : [];
  const poLines: PoLineInput[] = [];
  for (const l of r.lines) {
    const ql = q.lines.find((x) => x.code === l.code);
    if (!ql || ql.unitPrice == null) continue;
    const ml = mrLines.find((m) => (l.productId ? m.productId === l.productId : m.code === l.code) && dec(m.qty).gt(m.orderedQty));
    const open = ml ? dec(ml.qty).minus(ml.orderedQty) : null;
    const qty = open && open.lt(l.qty) ? fq(open) : l.qty;
    poLines.push({ productId: l.productId, code: l.code, description: l.description ?? null, qty, unitPrice: ql.unitPrice, materialRequestLineId: ml?.id ?? null });
  }
  if (!poLines.length) throw badRequest('the quotation prices no line of the RFQ');
  const incoterm = q.incoterm && ['EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'].includes(q.incoterm) ? q.incoterm : null;
  const expectedOn = b.expectedOn ?? (q.leadTimeDays != null ? riyadhDate(new Date(Date.now() + q.leadTimeDays * 86_400_000)) : null);
  const poId = await createPurchaseOrder(tx, actor, {
    supplierId: q.supplierId, currency: q.currency, rateToSar: q.rateToSar, incoterm, depositPercent: b.depositPercent ?? 0, expectedOn, projectId: mr?.projectId ?? null,
    notes: `من طلب عروض الأسعار ${r.number}${mr ? ` / طلب المواد ${mr.number}` : ''}`, lines: poLines,
  }, mr?.id ?? null);
  await tx.update(rfq).set({ status: 'closed', awardedQuoteId: q.id, purchaseOrderId: poId, updatedAt: new Date(), updatedBy: actor.userId, version: r.version + 1 }).where(eq(rfq.id, r.id));
  const [po] = await tx.select({ id: purchaseOrder.id, number: purchaseOrder.number }).from(purchaseOrder).where(eq(purchaseOrder.id, poId));
  await audit(tx, actor, 'award', 'rfq', r.id, { status: r.status }, { status: 'closed', supplierQuoteId: q.id, supplierId: q.supplierId, purchaseOrder: po!.number, lines: poLines.length });
  return { rfq: await rfqView(tx, actor, r.id), purchaseOrder: po! };
}

export async function cancelRfq(tx: Tx, actor: RequestActor, id: string, reason?: string | null) {
  const r = await loadRfq(tx, id, true);
  if (!['draft', 'sent'].includes(r.status)) throw badRequest(`a ${r.status} RFQ cannot be cancelled`);
  await tx.update(rfq).set({ status: 'cancelled', updatedAt: new Date(), updatedBy: actor.userId, version: r.version + 1 }).where(eq(rfq.id, r.id));
  await audit(tx, actor, 'cancel', 'rfq', r.id, { status: r.status }, { status: 'cancelled' }, reason ?? undefined);
  return rfqView(tx, actor, r.id);
}

// ───────────────────────── supplier e-invoice (INV-66) ─────────────────────────

const BILLABLE_PO = ['approved', 'sent', 'partially_received', 'received'];

/**
 * Parse a supplier's ZATCA UBL invoice into a bill proposal: the supplier (matched by VAT number),
 * its open purchase orders ranked by how well their lines match, the invoice lines mapped to PO
 * lines (vendor SKU from the supplier catalogue, then code, then description similarity), the
 * totals and the validation list. Nothing is written except the XML itself (as a file, when sent
 * inline) — the UI posts the reviewed lines to POST /inventory/bills with sourceXmlFileId.
 */
export async function parseSupplierInvoice(tx: Tx, actor: RequestActor, b: { fileId?: string | null; xml?: string | null; supplierId?: string | null; orderId?: string | null }) {
  let xml: string;
  let fileId: string | null = b.fileId ?? null;
  if (b.fileId) {
    if (!isUuid(b.fileId)) throw notFound('file');
    const f = await readStoredFile(tx, b.fileId).catch(() => null);
    if (!f) throw notFound('file');
    xml = f.data.toString('utf8');
  } else if (b.xml) {
    xml = b.xml;
  } else throw badRequest('give fileId or xml');

  let inv;
  try {
    inv = parseZatcaInvoice(xml);
  } catch (e) {
    if (e instanceof ZatcaXmlError) throw badRequest(e.message, { ar: e.ar, en: e.message });
    throw e;
  }
  if (!fileId) fileId = (await storeFile(tx, actor.tenantId, Buffer.from(xml, 'utf8'), `${inv.number.replace(/[^\w.\-]+/g, '_')}.xml`, 'application/xml', actor.userId)).id;

  // supplier by VAT (or the one chosen)
  let supplier: typeof party.$inferSelect | null = null;
  if (b.supplierId) supplier = await loadSupplier(tx, b.supplierId);
  else if (inv.supplier.vatNumber) {
    const [s] = await tx.select().from(party).where(and(eq(party.isSupplier, true), eq(party.vatNumber, inv.supplier.vatNumber))).limit(1);
    supplier = s ?? null;
  }
  const co = await loadCompany(tx);
  const issues: XmlIssue[] = validateZatcaInvoice(inv, { supplierVat: supplier?.vatNumber ?? null, supplierMatched: !!supplier, companyVat: co.vatNumber, companyNames: [co.legalNameAr, co.legalNameEn ?? ''] });
  if (supplier) {
    const [dup] = await tx.select({ number: supplierBill.number }).from(supplierBill).where(and(eq(supplierBill.supplierId, supplier.id), eq(supplierBill.supplierInvoiceNo, inv.number)));
    if (dup) issues.push({ level: 'error', code: 'duplicate', en: `supplier invoice ${inv.number} is already recorded as ${dup.number}`, ar: `فاتورة المورد ${inv.number} مسجّلة مسبقًا برقم ${dup.number}` });
  }

  // candidate POs and line mapping
  const cost = canCost(actor);
  const pos = supplier ? await tx.select().from(purchaseOrder).where(and(eq(purchaseOrder.supplierId, supplier.id), inArray(purchaseOrder.status, BILLABLE_PO))).orderBy(desc(purchaseOrder.createdAt)).limit(50) : [];
  const skus = supplier ? await tx.select({ productId: supplierItem.productId, vendorSku: supplierItem.vendorSku }).from(supplierItem).where(eq(supplierItem.supplierId, supplier.id)) : [];
  const poLinesAll = pos.length ? await tx.select().from(purchaseOrderLine).where(inArray(purchaseOrderLine.orderId, pos.map((p) => p.id))) : [];

  const mapLines = (orderId: string) => {
    const pl = poLinesAll.filter((l) => l.orderId === orderId);
    const used = new Set<string>();
    return inv.lines.map((il) => {
      let best: { line: (typeof pl)[number]; score: number; by: string } | null = null;
      for (const l of pl) {
        if (used.has(l.id)) continue;
        const sku = skus.find((s) => s.productId === l.productId)?.vendorSku ?? null;
        const cands: [number, string][] = [
          [sku && il.sellersItemId && similarity(sku, il.sellersItemId) === 1 ? 1 : 0, 'vendor_sku'],
          [il.sellersItemId ? similarity(l.code, il.sellersItemId) : 0, 'code'],
          [il.buyersItemId ? similarity(l.code, il.buyersItemId) : 0, 'code'],
          [similarity(l.code, il.name) * 0.9, 'code_in_name'],
          [similarity(l.description, il.name) * 0.8, 'description'],
        ];
        const [score, by] = cands.sort((a, b2) => b2[0] - a[0])[0]!;
        if (score > (best?.score ?? 0)) best = { line: l, score, by };
      }
      const hit = best && best.score >= 0.5 ? best : null;
      if (hit) used.add(hit.line.id);
      const unitPrice = dec(il.lineExtension).div(dec(il.qty).gt(0) ? il.qty : 1);
      return {
        invoiceLineId: il.id, name: il.name, sellersItemId: il.sellersItemId, qty: fq(dec(il.qty)), unitPrice: unitPrice.toDecimalPlaces(4).toString(), lineExtension: il.lineExtension, vatPercent: il.vatPercent,
        orderLineId: hit?.line.id ?? null, poLineCode: hit?.line.code ?? null, poLineDescription: hit?.line.description ?? null, matchedBy: hit?.by ?? null, score: hit ? Number(hit.score.toFixed(2)) : 0,
        billableQty: hit ? fq(dec(hit.line.receivedQty).minus(hit.line.billedQty)) : null,
      };
    });
  };
  const ranked = pos.map((p) => {
    const m = mapLines(p.id);
    const matched = m.filter((x) => x.orderLineId).length;
    const score = m.reduce((s, x) => s + x.score, 0);
    const amountGap = p.subtotal ? dec(p.subtotal).minus(inv.taxExclusive).abs().toNumber() : Number.POSITIVE_INFINITY;
    return { po: p, lines: m, matched, score, amountGap };
  }).sort((a, b2) => b2.matched - a.matched || b2.score - a.score || a.amountGap - b2.amountGap);
  const chosen = (b.orderId ? ranked.find((x) => x.po.id === b.orderId) : null) ?? ranked[0] ?? null;
  if (b.orderId && !ranked.some((x) => x.po.id === b.orderId)) issues.push({ level: 'warning', code: 'order_not_open', en: 'the chosen purchase order is not an open order of this supplier', ar: 'أمر الشراء المختار ليس أمرًا مفتوحًا لهذا المورد' });
  const lines = chosen?.lines ?? mapLines('');
  if (supplier && !pos.length) issues.push({ level: 'warning', code: 'no_open_po', en: 'the supplier has no open purchase order to bill against', ar: 'لا يوجد أمر شراء مفتوح لهذا المورد' });
  const unmatched = lines.filter((l) => !l.orderLineId).length;
  if (chosen && unmatched) issues.push({ level: 'warning', code: 'unmatched_lines', en: `${unmatched} invoice line(s) not matched to ${chosen.po.number} — map them by hand`, ar: `${unmatched} بند لم يُطابق مع ${chosen.po.number} — طابقها يدويًا` });
  for (const l of lines) {
    if (l.orderLineId && l.billableQty != null && dec(l.qty).gt(l.billableQty)) issues.push({ level: 'warning', code: 'over_billed', en: `line ${l.invoiceLineId} (${l.poLineCode}): ${l.qty} invoiced, ${l.billableQty} received and not yet billed`, ar: `البند ${l.invoiceLineId} (${l.poLineCode}): الكمية المفوترة ${l.qty} والمستلم غير المفوتر ${l.billableQty}` });
  }
  if (chosen && chosen.po.currency !== inv.currency) issues.push({ level: 'warning', code: 'currency', en: `the invoice is in ${inv.currency}, ${chosen.po.number} in ${chosen.po.currency}`, ar: `عملة الفاتورة ${inv.currency} وعملة أمر الشراء ${chosen.po.currency}` });

  const errors = issues.filter((i) => i.level === 'error').length;
  const { qr: _qr, ...invoice } = inv;
  return {
    ok: errors === 0,
    fileId,
    invoice: { ...invoice, hasQr: !!inv.qr },
    supplier: supplier ? { id: supplier.id, nameAr: supplier.nameAr, nameEn: supplier.nameEn, vatNumber: supplier.vatNumber } : null,
    purchaseOrders: ranked.map((x) => ({ id: x.po.id, number: x.po.number, status: x.po.status, currency: x.po.currency, subtotal: cost ? x.po.subtotal : null, matchedLines: x.matched, score: Number(x.score.toFixed(2)) })),
    orderId: chosen?.po.id ?? null,
    lines,
    totals: { taxExclusive: inv.taxExclusive, vat: inv.vat, taxInclusive: inv.taxInclusive, payable: inv.payable, currency: inv.currency },
    bill: supplier && chosen ? {
      supplierId: supplier.id, orderId: chosen.po.id, supplierInvoiceNo: inv.number, billDate: inv.issueDate, currency: inv.currency,
      rateToSar: inv.currency === 'SAR' ? '1' : chosen.po.currency === inv.currency ? chosen.po.rateToSar : undefined,
      vat: dec(inv.vat).toFixed(2), sourceXmlFileId: fileId,
      lines: lines.filter((l) => l.orderLineId).map((l) => ({ orderLineId: l.orderLineId!, qty: l.qty, unitPrice: l.unitPrice })),
    } : null,
    validation: issues,
  };
}

