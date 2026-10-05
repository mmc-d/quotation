import { createHash } from 'node:crypto';
import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  and, appUser, asc, billingMilestone, clauseTemplate, contact, contract, contractClause, desc, emit, eq, esignRequest, ilike, inArray, issuedDocument, nextNumber, or, party, quote, quoteLine, site, sql, invoiceMirror, paymentRequest, type Tx,
} from '@mmc/db';
import {
  buildSchedule, calculateQuote, canTransitionContract, DEFAULT_SCHEDULE, dec, formatNationalAddress, halalasToFixed, riyadhDate, toHalalas, type ContractStatus, type MilestoneSpec, type MilestoneTrigger,
} from '@mmc/domain';
import { htmlToPdf, renderContractHtml } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { companyBlock, loadCompany } from '../common/company.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { esign } from '../common/esign.js';
import { storeFile } from '../common/files.js';
import { sendTemplate } from '../common/messaging.js';
import { assertCan, scopeFilter } from '../common/scope.js';
import { ZodPipe, zDate, zMoney, zPage, zQty } from '../common/zod.js';
import { config } from '../config.js';
import { logActivity } from './quotes.service.js';

const milestoneSchema = z.object({ nameAr: z.string().min(1), nameEn: z.string().nullish(), percent: z.number().positive().max(100), trigger: z.enum(['on_signing', 'before_delivery', 'after_programming', 'on_handover', 'on_date', 'manual']).default('manual'), dueDate: zDate.nullish() });
const contractUpdateSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullish(),
  clientBlock: z.object({ name: z.string().optional(), representative: z.string().optional(), idNumber: z.string().optional(), crNumber: z.string().optional(), vatNumber: z.string().optional(), address: z.string().optional(), mobile: z.string().optional() }),
  contractDate: zDate,
  deliveryDaysMin: z.number().int().min(0).nullish(),
  deliveryDaysMax: z.number().int().min(0).nullish(),
  warrantyMonths: z.number().int().min(0).nullish(),
  partsWarrantyMonths: z.number().int().min(0).nullish(),
  sparePartsYears: z.number().int().min(0).nullish(),
  discountAmount: zMoney.default('0'),
  lines: z.array(z.object({ code: z.string().min(1), description: z.string().min(1), qty: zQty, unitPrice: zMoney })).min(1),
  clauses: z.array(z.object({ templateId: z.string().uuid().nullish(), titleAr: z.string().min(1), bodyAr: z.string().min(1) })),
  milestones: z.array(milestoneSchema).min(1),
  version: z.number().int().optional(),
});
type ContractUpdate = z.infer<typeof contractUpdateSchema>;

/** Totals and milestone amounts for contract lines (discount by amount, VAT per company mode). */
function computeContract(lines: { code: string; description: string; qty: string; unitPrice: string }[], discountAmount: string, vatOn: boolean, vatRegistered: boolean, specs: MilestoneSpec[]) {
  const calc = calculateQuote({ lines: lines.map((l) => ({ ...l, listPrice: l.unitPrice })), discount: { type: 'amount', value: discountAmount }, vatRegistered, vatOn });
  const t = calc.totals;
  return { calc, totals: { subtotal: halalasToFixed(t.subtotal), discountAmount: halalasToFixed(t.discount), vatAmount: halalasToFixed(t.vat), total: halalasToFixed(t.total), vatOn: t.vatApplied }, schedule: buildSchedule(t.total, specs) };
}

async function loadContract(tx: Tx, id: string) {
  const [c] = await tx.select().from(contract).where(eq(contract.id, id));
  if (!c) throw notFound('contract');
  const clauses = await tx.select().from(contractClause).where(eq(contractClause.contractId, id)).orderBy(asc(contractClause.sort));
  const milestones = await tx.select().from(billingMilestone).where(eq(billingMilestone.contractId, id)).orderBy(asc(billingMilestone.sort));
  return { ...c, clauses, milestones };
}

async function contractView(tx: Tx, actor: RequestActor, id: string) {
  const c = await loadContract(tx, id);
  assertCan(actor, 'contract.read', { ownerId: c.ownerId, teamId: c.teamId, branchId: c.branchId });
  const [q] = c.quoteId ? await tx.select({ id: quote.id, number: quote.number, revision: quote.revision }).from(quote).where(eq(quote.id, c.quoteId)) : [];
  const documents = await tx.select().from(issuedDocument).where(and(eq(issuedDocument.documentType, 'contract'), eq(issuedDocument.entityId, id))).orderBy(desc(issuedDocument.issuedAt));
  const esigns = await tx.select().from(esignRequest).where(eq(esignRequest.contractId, id)).orderBy(desc(esignRequest.createdAt));
  const invoices = actor.grants['invoice.read'] ? await tx.select().from(invoiceMirror).where(eq(invoiceMirror.contractId, id)).orderBy(asc(invoiceMirror.issueDate)) : [];
  const requests = actor.grants['billing.read'] ? await tx.select().from(paymentRequest).where(eq(paymentRequest.contractId, id)).orderBy(asc(paymentRequest.createdAt)) : [];
  return { ...c, quote: q ?? null, documents, esignRequests: esigns, invoices, paymentRequests: requests };
}

async function writeMilestones(tx: Tx, contractId: string, schedule: ReturnType<typeof buildSchedule>, dueDates: (string | null | undefined)[] = []) {
  await tx.delete(billingMilestone).where(eq(billingMilestone.contractId, contractId));
  await tx.insert(billingMilestone).values(schedule.map((m, i) => ({ contractId, sort: m.order, nameAr: m.name_ar, nameEn: m.name_en, percent: String(m.percent), amount: halalasToFixed(m.amount), trigger: m.trigger, dueDate: dueDates[i] ?? null })));
}

@Controller('contracts')
export class ContractsController {
  @Get()
  @Perm('contract.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.string().optional(), partyId: z.string().uuid().optional() }))) q: { q?: string; limit: number; offset: number; status?: string; partyId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q ? `%${q.q}%` : null;
      const where = and(
        scopeFilter(actor, 'contract.read', { owner: contract.ownerId, team: contract.teamId, branch: contract.branchId }),
        q.status ? inArray(contract.status, q.status.split(',')) : undefined,
        q.partyId ? eq(contract.partyId, q.partyId) : undefined,
        term ? or(ilike(contract.number, term), ilike(contract.title, term), sql`${contract.clientBlock}->>'name' ilike ${term}`) : undefined,
      );
      const rows = await tx.select({ id: contract.id, number: contract.number, title: contract.title, subtitle: contract.subtitle, status: contract.status, contractDate: contract.contractDate, total: contract.total, partyId: contract.partyId, partyName: party.nameAr, clientName: sql<string>`${contract.clientBlock}->>'name'`, ownerName: appUser.nameAr })
        .from(contract).leftJoin(party, eq(party.id, contract.partyId)).leftJoin(appUser, eq(appUser.id, contract.ownerId)).where(where).orderBy(desc(contract.createdAt)).limit(q.limit).offset(q.offset);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(contract).where(where)) as [{ n: number }];
      return { rows, total: n };
    });
  }

  @Get(':id')
  @Perm('contract.read')
  async get(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => contractView(tx, actor, id));
  }

  /** Contract v2 from a quote: client block, lines, verbatim clause library, 50/40/10 schedule. */
  @Post('from-quote/:quoteId')
  @Perm('contract.write')
  async fromQuote(@Actor() actor: RequestActor, @Param('quoteId') quoteId: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [q] = await tx.select().from(quote).where(eq(quote.id, quoteId));
      if (!q) throw notFound('quote');
      assertCan(actor, 'quote.read', { ownerId: q.ownerId, teamId: q.teamId });
      if (!['accepted', 'approved', 'sent', 'viewed'].includes(q.status)) throw badRequest('the quote must be approved or accepted first');
      const [existing] = await tx.select({ id: contract.id, number: contract.number }).from(contract).where(and(eq(contract.quoteId, quoteId), sql`${contract.status} <> 'cancelled'`));
      if (existing) throw conflict(`contract ${existing.number} already exists for this quote`);
      const co = await loadCompany(tx);
      const lines = (await tx.select().from(quoteLine).where(eq(quoteLine.quoteId, quoteId)).orderBy(asc(quoteLine.sort))).filter((l) => !l.isOptional && dec(l.qty).gt(0));
      const [p] = q.partyId ? await tx.select().from(party).where(eq(party.id, q.partyId)) : [];
      const [ct] = q.contactId ? await tx.select().from(contact).where(eq(contact.id, q.contactId)) : [];
      const [st] = q.siteId ? await tx.select().from(site).where(eq(site.id, q.siteId)) : [];
      const contractLines = lines.map((l) => ({ code: l.code, description: l.description, qty: dec(l.qty).toString(), unitPrice: dec(l.unitPrice).toString() }));
      const { totals, schedule } = computeContract(contractLines, q.discountAmount, q.vatOn, co.vatRegistered, DEFAULT_SCHEDULE);
      const { number } = await nextNumber(tx, 'contract');
      const [c] = await tx.insert(contract).values({
        number, quoteId, partyId: q.partyId, companyId: co.id, branchId: q.branchId, ownerId: q.ownerId ?? actor.userId, teamId: q.teamId,
        title: 'عقد توريد وتركيب', subtitle: q.projectName || 'نظام الانتركوم والمنزل الذكي',
        clientBlock: {
          name: p?.nameAr ?? q.clientName ?? '', representative: ct?.name ?? '', crNumber: p?.unifiedNumber ?? p?.crNumber ?? '', vatNumber: p?.vatNumber ?? '',
          address: st ? formatNationalAddress(st) : q.projectLocation ?? '', mobile: ct?.mobile ?? q.clientPhone ?? '',
        },
        contractDate: riyadhDate(), deliveryDaysMin: 45, deliveryDaysMax: 60, lines: contractLines, ...totals, createdBy: actor.userId,
      }).returning();
      const templates = await tx.select().from(clauseTemplate).where(eq(clauseTemplate.active, true)).orderBy(asc(clauseTemplate.sort));
      if (templates.length) await tx.insert(contractClause).values(templates.map((t, i) => ({ contractId: c!.id, templateId: t.id, sort: i, titleAr: t.key === 'preamble' ? 'تمهيد' : t.titleAr, bodyAr: t.bodyAr })));
      await writeMilestones(tx, c!.id, schedule);
      if (q.status !== 'accepted') await tx.update(quote).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(quote.id, quoteId));
      await audit(tx, actor, 'create', 'contract', c!.id, null, { number, quote: q.number, total: totals.total });
      await emit(tx, 'contract', c!.id, 'contract.created', { number });
      return contractView(tx, actor, c!.id);
    }, actor.userId);
  }

  @Put(':id')
  @Perm('contract.write')
  async update(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(contractUpdateSchema)) b: ContractUpdate) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await loadContract(tx, id);
      assertCan(actor, 'contract.write', { ownerId: before.ownerId, teamId: before.teamId });
      if (before.status !== 'draft') throw conflict('only draft contracts can be edited — use a change order');
      if (b.version !== undefined && b.version !== before.version) throw conflict('the contract was changed by someone else — reload');
      const co = await loadCompany(tx);
      const specs = b.milestones.map((m) => ({ name_ar: m.nameAr, name_en: m.nameEn ?? '', percent: m.percent, trigger: m.trigger as MilestoneTrigger }));
      let computed;
      try {
        computed = computeContract(b.lines, b.discountAmount, before.vatOn, co.vatRegistered, specs);
      } catch (e) {
        throw badRequest((e as Error).message);
      }
      await tx.update(contract).set({
        title: b.title, subtitle: b.subtitle ?? null, clientBlock: b.clientBlock, contractDate: b.contractDate,
        deliveryDaysMin: b.deliveryDaysMin ?? null, deliveryDaysMax: b.deliveryDaysMax ?? null, warrantyMonths: b.warrantyMonths ?? null, partsWarrantyMonths: b.partsWarrantyMonths ?? null, sparePartsYears: b.sparePartsYears ?? null,
        lines: b.lines, ...computed.totals, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1,
      }).where(eq(contract.id, id));
      await tx.delete(contractClause).where(eq(contractClause.contractId, id));
      if (b.clauses.length) {
        const tpls = await tx.select({ id: clauseTemplate.id, bodyAr: clauseTemplate.bodyAr }).from(clauseTemplate);
        await tx.insert(contractClause).values(b.clauses.map((c, i) => ({ contractId: id, templateId: c.templateId ?? null, sort: i, titleAr: c.titleAr, bodyAr: c.bodyAr, modified: !c.templateId || tpls.find((t) => t.id === c.templateId)?.bodyAr !== c.bodyAr })));
      }
      await writeMilestones(tx, id, computed.schedule, b.milestones.map((m) => m.dueDate));
      if (before.total !== computed.totals.total) await audit(tx, actor, 'update', 'contract', id, { total: before.total }, { total: computed.totals.total });
      return contractView(tx, actor, id);
    }, actor.userId);
  }

  @Post(':id/status')
  @Perm('contract.write')
  async status(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ status: z.enum(['sent_for_signature', 'signed', 'active', 'completed', 'terminated', 'cancelled', 'draft']), reason: z.string().nullish() }))) b: { status: ContractStatus; reason?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const c = await loadContract(tx, id);
      assertCan(actor, 'contract.write', { ownerId: c.ownerId, teamId: c.teamId });
      if (b.status === 'signed' && !actor.grants['contract.sign']) throw forbidden('marking a contract signed requires contract.sign');
      if (!canTransitionContract(c.status as ContractStatus, b.status)) throw badRequest(`cannot move a ${c.status} contract to ${b.status}`);
      await tx.update(contract).set({ status: b.status, signedAt: b.status === 'signed' ? new Date() : c.signedAt, startDate: b.status === 'active' ? riyadhDate() : c.startDate, endDate: b.status === 'completed' || b.status === 'terminated' ? riyadhDate() : c.endDate, updatedAt: new Date() }).where(eq(contract.id, id));
      await audit(tx, actor, `status_${b.status}`, 'contract', id, { status: c.status }, { status: b.status, reason: b.reason });
      await emit(tx, 'contract', id, `contract.${b.status}`, { number: c.number });
      return contractView(tx, actor, id);
    }, actor.userId);
  }

  /**
   * PDF. `stamp=1` applies the company stamp — only for users with contract.stamp, only on a
   * contract past draft, and every stamped issue is archived and audited.
   */
  @Get(':id/pdf')
  @Perm('contract.read')
  async pdf(@Actor() actor: RequestActor, @Param('id') id: string, @Query('stamp') stamp: string | undefined, @Res() res: Response) {
    const { pdf, number } = await tenantTx(actor.tenantId, async (tx) => {
      const c = await contractView(tx, actor, id);
      const applyStamp = stamp === '1';
      if (applyStamp) {
        if (!actor.grants['contract.stamp']) throw forbidden('applying the stamp requires contract.stamp');
        if (c.status === 'draft' || c.status === 'cancelled') throw badRequest('the stamp can only be applied to an approved contract');
        if (!(await loadCompany(tx)).stampFileId) throw badRequest('upload the company stamp in Settings first');
      }
      const out = await this.renderPdf(tx, c, applyStamp);
      if (applyStamp) {
        const f = await storeFile(tx, actor.tenantId, out, `${c.number}-stamped.pdf`, 'application/pdf', actor.userId);
        await tx.insert(issuedDocument).values({ documentType: 'contract', entityId: id, number: c.number, fileId: f.id, sha256: f.sha256, issuedBy: actor.userId });
        await tx.update(contract).set({ stampApplied: true }).where(eq(contract.id, id));
        await audit(tx, actor, 'stamp', 'contract', id, null, { sha256: f.sha256 });
      }
      return { pdf: out, number: c.number };
    }, actor.userId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${number}.pdf"`);
    res.send(pdf);
  }

  private async renderPdf(tx: Tx, c: Awaited<ReturnType<typeof contractView>>, applyStamp: boolean) {
    const co = await companyBlock(tx, applyStamp);
    const lines = c.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty, unitPrice: toHalalas(l.unitPrice), amount: dec(l.unitPrice).times(l.qty).times(100).toDecimalPlaces(0).toNumber() }));
    const html = renderContractHtml({
      company: co, number: c.number, date: c.contractDate, title: c.title, subtitle: c.subtitle, client: c.clientBlock,
      clauses: c.clauses.map((x) => ({ titleAr: x.titleAr, bodyAr: x.bodyAr.replace('(45) إلى (60)', `(${c.deliveryDaysMin ?? 45}) إلى (${c.deliveryDaysMax ?? 60})`) })),
      lines,
      totals: { subtotal: toHalalas(c.subtotal), discount: toHalalas(c.discountAmount), vat: toHalalas(c.vatAmount), total: toHalalas(c.total), vatOn: c.vatOn },
      milestones: c.milestones.map((m) => ({ nameAr: m.nameAr, percent: Number(m.percent), amount: toHalalas(m.amount) })),
      applyStamp,
    });
    return htmlToPdf(html, config.gotenbergUrl);
  }

  /** Send for Nafath-backed e-signature (sandbox until a licensed provider is contracted). */
  @Post(':id/esign')
  @Perm('contract.write')
  async startEsign(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ signerName: z.string().min(1), signerNationalId: z.string().regex(/^[12]\d{9}$/, 'national ID / iqama: 10 digits').nullish(), signerMobile: z.string().nullish(), notify: z.boolean().default(true) }))) b: { signerName: string; signerNationalId?: string | null; signerMobile?: string | null; notify: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const c = await contractView(tx, actor, id);
      assertCan(actor, 'contract.write', { ownerId: c.ownerId, teamId: c.teamId });
      if (!['draft', 'sent_for_signature'].includes(c.status)) throw badRequest('contract is already signed or closed');
      const pdf = await this.renderPdf(tx, c, false);
      const sha256 = createHash('sha256').update(pdf).digest('hex');
      const f = await storeFile(tx, actor.tenantId, pdf, `${c.number}.pdf`, 'application/pdf', actor.userId);
      await tx.insert(issuedDocument).values({ documentType: 'contract', entityId: id, number: c.number, fileId: f.id, sha256, issuedBy: actor.userId });
      const [req] = await tx.insert(esignRequest).values({ contractId: id, provider: esign().name, signerName: b.signerName, signerNationalId: b.signerNationalId ?? null, signerMobile: b.signerMobile ?? null, documentSha256: sha256 }).returning();
      const created = await esign().create({ requestId: req!.id, contractNumber: c.number, signerName: b.signerName, signerNationalId: b.signerNationalId, signerMobile: b.signerMobile, pdf, sha256 });
      await tx.update(esignRequest).set({ providerRequestId: created.providerRequestId, signingUrl: created.signingUrl, status: 'sent' }).where(eq(esignRequest.id, req!.id));
      await tx.update(contract).set({ status: 'sent_for_signature', esignRequestId: req!.id, updatedAt: new Date() }).where(eq(contract.id, id));
      if (b.notify && b.signerMobile) await sendTemplate(tx, { channel: 'whatsapp', to: b.signerMobile, templateKey: 'contract_sign', vars: { name: b.signerName, number: c.number, link: created.signingUrl }, related: { type: 'contract', id }, link: { partyId: c.partyId }, sentBy: actor.userId });
      await logActivity(tx, 'contract', id, 'note', `أُرسل العقد ${c.number} للتوقيع الإلكتروني (${b.signerName})`, actor.userId);
      await audit(tx, actor, 'esign_start', 'contract', id, null, { requestId: req!.id, sha256 });
      return { signingUrl: created.signingUrl, contract: await contractView(tx, actor, id) };
    }, actor.userId);
  }
}

export { loadContract, contractView, toHalalas };
