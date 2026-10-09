import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  and, asc, billingMilestone, changeOrder, contract, desc, eq, inArray, inboxEvent, invoiceMirror, isNotNull, or, party, paymentMirror, paymentRequest, serviceAgreement, sql, withTenant,
} from '@mmc/db';
import { agingBucket, riyadhDate, toHalalas, halalasToFixed, VAT_RATE } from '@mmc/domain';
import { htmlToPdf, renderInvoiceHtml, renderPaymentRequestHtml } from '@mmc/doc-templates';
import { verifyFrappeWebhook } from '@mmc/erp-connector';
import { Actor, Perm, Public, type RequestActor } from '../auth/actor.js';
import { getDb, tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { backOffice } from '../common/backoffice.js';
import { companyBlock, loadCompany } from '../common/company.js';
import { badRequest, forbidden, notFound } from '../common/errors.js';
import { payments, signSandboxWebhook } from '../common/payments.js';
import { assertCan, scopeFilter } from '../common/scope.js';
import { ZodPipe, zDate, zMoney, zPage } from '../common/zod.js';
import { config } from '../config.js';
import { advanceCredits, applyPayment, CO_TRIGGER, ensureCustomer, issueFinalInvoice, mirrorInvoice, requestMilestone, sendPaymentRequest } from './finance.service.js';

const METHODS = ['bank_transfer', 'mada', 'credit_card', 'apple_pay', 'stc_pay', 'cash', 'cheque', 'payment_link'] as const;

async function invoicePdf(tx: Parameters<Parameters<typeof tenantTx>[1]>[0], id: string) {
  const [inv] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, id));
  if (!inv) throw notFound('invoice');
  const [p] = inv.partyId ? await tx.select().from(party).where(eq(party.id, inv.partyId)) : [];
  const [c] = inv.contractId ? await tx.select({ number: contract.number }).from(contract).where(eq(contract.id, inv.contractId)) : [];
  const lines = (inv.lines as { code: string; description: string; qty: string; unitPrice: string; net: string; vat: string; total: string }[]).map((l) => ({ ...l, net: toHalalas(l.net), vat: toHalalas(l.vat), total: toHalalas(l.total) }));
  const html = await renderInvoiceHtml({
    company: await companyBlock(tx), number: inv.number, typeCode: inv.typeCode, subtype: inv.subtype, issueDate: inv.issueDate,
    buyer: { name: p?.nameAr ?? '', vatNumber: p?.vatNumber, crNumber: p?.unifiedNumber ?? p?.crNumber }, contractNumber: c?.number ?? null, lines,
    taxable: toHalalas(inv.taxable), vat: toHalalas(inv.vatAmount), total: toHalalas(inv.total), prepaid: toHalalas(inv.prepaidAmount), balanceDue: toHalalas(inv.balanceDue), qrPayload: inv.qrPayload, zatcaStatus: inv.zatcaStatus,
  });
  return { pdf: await htmlToPdf(html, config.gotenbergUrl), number: inv.number };
}

/** Scope for payment-request lists: contract requests follow the contract, AMC requests the agreement. */
function requestScope(actor: RequestActor) {
  const byContract = scopeFilter(actor, 'billing.read', { owner: contract.ownerId, team: contract.teamId });
  if (!byContract) return undefined;
  const byAgreement = scopeFilter(actor, 'billing.read', { owner: serviceAgreement.ownerId, team: serviceAgreement.teamId });
  return or(and(isNotNull(paymentRequest.contractId), byContract), and(isNotNull(paymentRequest.agreementId), byAgreement));
}

@Controller('finance')
export class FinanceController {
  /** Contract billing cockpit: milestones, requests, invoices (386/388), payments, next step. */
  @Get('contracts/:id')
  @Perm('billing.read')
  async contractBilling(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [c] = await tx.select().from(contract).where(eq(contract.id, id));
      if (!c) throw notFound('contract');
      assertCan(actor, 'billing.read', { ownerId: c.ownerId, teamId: c.teamId });
      const all = await tx.select().from(billingMilestone).where(eq(billingMilestone.contractId, id)).orderBy(asc(billingMilestone.sort));
      // The contract's own schedule (50/40/10 …) and, separately, the milestones created to bill change orders.
      const milestones = all.filter((m) => m.trigger !== CO_TRIGGER);
      const coMilestones = all.filter((m) => m.trigger === CO_TRIGGER);
      const requests = await tx.select().from(paymentRequest).where(eq(paymentRequest.contractId, id)).orderBy(asc(paymentRequest.createdAt));
      const invoices = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.contractId, id)).orderBy(asc(invoiceMirror.issueDate), asc(invoiceMirror.number));
      const pays = requests.length ? await tx.select().from(paymentMirror).where(inArray(paymentMirror.paymentRequestId, requests.map((r) => r.id))).orderBy(asc(paymentMirror.paidOn)) : [];
      const paid = milestones.reduce((s, m) => s + toHalalas(m.paidAmount), 0);
      const cos = await tx.select().from(changeOrder).where(eq(changeOrder.contractId, id)).orderBy(asc(changeOrder.createdAt));
      const effective = cos.filter((x) => ['approved', 'signed', 'billed'].includes(x.status));
      const coTotal = effective.reduce((s, x) => s + toHalalas(x.amountDelta), 0);
      const coPaid = coMilestones.reduce((s, m) => s + toHalalas(m.paidAmount), 0);
      const credited = await advanceCredits(tx, id);
      return {
        contract: { id: c.id, number: c.number, status: c.status, total: c.total, partyId: c.partyId },
        milestones, requests, invoices, payments: pays,
        changeOrderMilestones: coMilestones.map((m) => ({ ...m, changeOrder: cos.find((x) => x.milestoneId === m.id)?.number ?? null })),
        changeOrders: {
          rows: cos.map((x) => ({ id: x.id, number: x.number, description: x.description, status: x.status, subtotalDelta: x.subtotalDelta, vatDelta: x.vatDelta, amountDelta: x.amountDelta, milestoneId: x.milestoneId })),
          approvedTotal: halalasToFixed(coTotal),
          paid: halalasToFixed(coPaid),
          adjustedTotal: halalasToFixed(toHalalas(c.total) + coTotal),
        },
        // credited = credit notes against the advances, netted in the final request (so they reduce what remains)
        summary: { total: c.total, paid: halalasToFixed(paid), credited: halalasToFixed(credited), remaining: halalasToFixed(toHalalas(c.total) - paid - credited), adjustedTotal: halalasToFixed(toHalalas(c.total) + coTotal) },
        nextMilestoneId: milestones.find((m) => m.status === 'pending')?.id ?? null,
      };
    });
  }

  @Post('milestones/:id/request')
  @Perm('billing.write')
  async request(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ dueDate: zDate.nullish(), send: z.enum(['whatsapp', 'email']).nullish(), to: z.string().nullish() }))) b: { dueDate?: string | null; send?: 'whatsapp' | 'email' | null; to?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const pr = await requestMilestone(tx, actor, id, b.dueDate);
      if (b.send) await sendPaymentRequest(tx, actor, pr.id, b.send, b.to);
      return (await tx.select().from(paymentRequest).where(eq(paymentRequest.id, pr.id)))[0];
    }, actor.userId);
  }

  @Get('payment-requests')
  @Perm('billing.read')
  async requests(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.string().optional(), overdue: z.coerce.boolean().optional() }))) q: { q?: string; limit: number; offset: number; status?: string; overdue?: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const where = and(
        q.status ? inArray(paymentRequest.status, q.status.split(',')) : undefined,
        q.overdue ? and(sql`${paymentRequest.dueDate} < current_date`, inArray(paymentRequest.status, ['sent', 'partially_paid'])) : undefined,
        // contract requests follow the contract's owner/team; AMC requests (Phase 7b) the agreement's
        requestScope(actor),
        q.q ? sql`(${paymentRequest.number} ilike ${`%${q.q}%`} or ${party.nameAr} ilike ${`%${q.q}%`} or ${contract.number} ilike ${`%${q.q}%`} or ${serviceAgreement.number} ilike ${`%${q.q}%`})` : undefined,
      );
      return tx.select({ pr: paymentRequest, partyName: party.nameAr, contractNumber: contract.number, agreementNumber: serviceAgreement.number }).from(paymentRequest).leftJoin(party, eq(party.id, paymentRequest.partyId)).leftJoin(contract, eq(contract.id, paymentRequest.contractId)).leftJoin(serviceAgreement, eq(serviceAgreement.id, paymentRequest.agreementId)).where(where).orderBy(desc(paymentRequest.createdAt)).limit(q.limit).offset(q.offset)
        .then((rows) => rows.map((r) => ({ ...r.pr, partyName: r.partyName, contractNumber: r.contractNumber ?? r.agreementNumber, agreementNumber: r.agreementNumber })));
    });
  }

  @Post('payment-requests/:id/send')
  @Perm('billing.write')
  async send(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ channel: z.enum(['whatsapp', 'email']), to: z.string().nullish() }))) b: { channel: 'whatsapp' | 'email'; to?: string | null }) {
    return tenantTx(actor.tenantId, (tx) => sendPaymentRequest(tx, actor, id, b.channel, b.to), actor.userId);
  }

  @Post('payment-requests/:id/cancel')
  @Perm('billing.write')
  async cancel(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().min(1) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [pr] = await tx.select().from(paymentRequest).where(eq(paymentRequest.id, id));
      if (!pr) throw notFound('payment request');
      if (toHalalas(pr.paidAmount) > 0) throw badRequest('a partly paid request cannot be cancelled — issue a credit note instead');
      await tx.update(paymentRequest).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(paymentRequest.id, id));
      if (pr.milestoneId) await tx.update(billingMilestone).set({ status: 'pending' }).where(eq(billingMilestone.id, pr.milestoneId));
      // A cancelled change-order request puts the change order back to approved/signed so it can be billed again.
      const [co] = pr.milestoneId ? await tx.select().from(changeOrder).where(and(eq(changeOrder.milestoneId, pr.milestoneId), eq(changeOrder.status, 'billed'))) : [];
      if (co) {
        const back = co.signedAt ? 'signed' : 'approved';
        await tx.update(changeOrder).set({ status: back, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(changeOrder.id, co.id));
        await audit(tx, actor, `status_${back}`, 'change_order', co.id, { status: 'billed' }, { status: back, reason: `payment request ${pr.number} cancelled` });
      }
      await audit(tx, actor, 'cancel', 'payment_request', id, null, { reason: b.reason });
      return { ok: true };
    });
  }

  @Get('payment-requests/:id/pdf')
  @Perm('billing.read')
  async requestPdf(@Actor() actor: RequestActor, @Param('id') id: string, @Res() res: Response) {
    const { pdf, number } = await tenantTx(actor.tenantId, async (tx) => {
      const [pr] = await tx.select().from(paymentRequest).where(eq(paymentRequest.id, id));
      if (!pr) throw notFound('payment request');
      return { pdf: await renderRequestPdf(tx, pr), number: pr.number };
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${number}.pdf"`);
    res.send(pdf);
  }

  /** Manual receipt (bank transfer, cheque, cash) — the accountant confirms the money arrived. */
  @Post('payment-requests/:id/payments')
  @Perm('payment.record')
  async recordPayment(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ amount: zMoney, paidOn: zDate, method: z.enum(METHODS), reference: z.string().max(140).nullish() }))) b: { amount: string; paidOn: string; method: string; reference?: string | null }) {
    return tenantTx(actor.tenantId, (tx) => applyPayment(tx, actor, actor.tenantId, id, { ...b, idempotencyKey: `manual:${id}:${b.reference ?? randomUUID()}` }), actor.userId);
  }

  @Post('contracts/:id/final-invoice')
  @Perm('invoice.issue')
  async finalInvoice(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, (tx) => issueFinalInvoice(tx, actor, actor.tenantId, id), actor.userId);
  }

  @Get('invoices')
  @Perm('invoice.read')
  async invoices(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ typeCode: z.string().optional(), unpaid: z.coerce.boolean().optional(), partyId: z.string().uuid().optional() }))) q: { q?: string; limit: number; offset: number; typeCode?: string; unpaid?: boolean; partyId?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const where = and(
        q.typeCode ? inArray(invoiceMirror.typeCode, q.typeCode.split(',')) : undefined,
        q.unpaid ? sql`${invoiceMirror.balanceDue} > 0` : undefined,
        q.partyId ? eq(invoiceMirror.partyId, q.partyId) : undefined,
        q.q ? sql`(${invoiceMirror.number} ilike ${`%${q.q}%`} or ${party.nameAr} ilike ${`%${q.q}%`})` : undefined,
        scopeFilter(actor, 'invoice.read', { owner: party.ownerId }),
      );
      return tx.select({ inv: invoiceMirror, partyName: party.nameAr, contractNumber: contract.number }).from(invoiceMirror).leftJoin(party, eq(party.id, invoiceMirror.partyId)).leftJoin(contract, eq(contract.id, invoiceMirror.contractId)).where(where).orderBy(desc(invoiceMirror.issueDate), desc(invoiceMirror.number)).limit(q.limit).offset(q.offset)
        .then((rows) => rows.map((r) => ({ ...r.inv, partyName: r.partyName, contractNumber: r.contractNumber })));
    });
  }

  @Get('invoices/:id/pdf')
  @Perm('invoice.read')
  async pdf(@Actor() actor: RequestActor, @Param('id') id: string, @Res() res: Response) {
    const { pdf, number } = await tenantTx(actor.tenantId, (tx) => invoicePdf(tx, id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${number}.pdf"`);
    res.send(pdf);
  }

  /** 381 credit note — never edit an issued invoice. */
  @Post('invoices/:id/credit-note')
  @Perm('invoice.issue')
  async creditNote(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().min(3), amount: zMoney.nullish() }))) b: { reason: string; amount?: string | null }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [inv] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, id));
      if (!inv) throw notFound('invoice');
      if (inv.typeCode === '381') throw badRequest('cannot credit a credit note');
      if (!inv.partyId) throw badRequest('invoice has no customer');
      const co = await loadCompany(tx);
      const customer = await ensureCustomer(tx, actor.tenantId, inv.partyId);
      const gross = b.amount ? toHalalas(b.amount) : toHalalas(inv.total);
      if (gross <= 0 || gross > toHalalas(inv.total)) throw badRequest('credit amount must be between 0 and the invoice total');
      const note = await backOffice(actor.tenantId).createInvoice({
        idempotencyKey: `credit:${id}:${gross}:${b.reason.slice(0, 40)}`, typeCode: '381', customer, issueDate: riyadhDate(),
        lines: [{ code: 'CN', description: `إشعار دائن على الفاتورة ${inv.number}: ${b.reason}`, qty: '1', unitPrice: halalasToFixed(gross) }],
        vatRate: co.vatRegistered && toHalalas(inv.vatAmount) > 0 ? VAT_RATE : 0, taxInclusive: true, originalErpName: inv.erpName, reason: b.reason,
        core: { contractId: inv.contractId },
      });
      const row = await mirrorInvoice(tx, note, { partyId: inv.partyId, contractId: inv.contractId, originalInvoiceId: inv.id });
      await audit(tx, actor, 'issue_381', 'invoice', id, null, { creditNote: note.number, amount: halalasToFixed(gross), reason: b.reason });
      return row;
    }, actor.userId);
  }

  /** Receivables aging by customer (from the invoice mirrors). */
  @Get('ar-aging')
  @Perm('invoice.read')
  async aging(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const rows = await tx.select({ inv: invoiceMirror, partyName: party.nameAr }).from(invoiceMirror).leftJoin(party, eq(party.id, invoiceMirror.partyId)).where(and(sql`${invoiceMirror.balanceDue} > 0`, scopeFilter(actor, 'invoice.read', { owner: party.ownerId })));
      const today = riyadhDate();
      const by = new Map<string, { partyId: string | null; partyName: string; current: number; '1_30': number; '31_60': number; '61_90': number; '90_plus': number; total: number }>();
      for (const r of rows) {
        const key = r.inv.partyId ?? 'none';
        const e = by.get(key) ?? { partyId: r.inv.partyId, partyName: r.partyName ?? '—', current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, total: 0 };
        const b = agingBucket(r.inv.dueDate ?? r.inv.issueDate, today);
        const v = toHalalas(r.inv.balanceDue);
        e[b] += v;
        e.total += v;
        by.set(key, e);
      }
      const list = [...by.values()].sort((a, b) => b.total - a.total);
      const totals = list.reduce((t, e) => ({ current: t.current + e.current, '1_30': t['1_30'] + e['1_30'], '31_60': t['31_60'] + e['31_60'], '61_90': t['61_90'] + e['61_90'], '90_plus': t['90_plus'] + e['90_plus'], total: t.total + e.total }), { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, total: 0 });
      return { asOf: today, rows: list, totals };
    });
  }

  /** Customer statement: invoices and payments with running balance. */
  @Get('statement/:partyId')
  @Perm('invoice.read')
  async statement(@Actor() actor: RequestActor, @Param('partyId') partyId: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [p] = await tx.select().from(party).where(eq(party.id, partyId));
      if (!p) throw notFound('customer');
      assertCan(actor, 'invoice.read', { ownerId: p.ownerId });
      const invs = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.partyId, partyId));
      const pays = await tx.select().from(paymentMirror).where(eq(paymentMirror.partyId, partyId));
      const entries = [
        ...invs.map((i) => ({ date: i.issueDate, kind: i.typeCode === '381' ? 'credit_note' : 'invoice', number: i.number, debit: i.typeCode === '381' ? 0 : toHalalas(i.total) - toHalalas(i.prepaidAmount), credit: i.typeCode === '381' ? -toHalalas(i.total) : 0 })),
        ...pays.map((x) => ({ date: x.paidOn, kind: 'payment', number: x.erpName, debit: 0, credit: toHalalas(x.amount) })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      let bal = 0;
      return { party: { id: p.id, nameAr: p.nameAr, vatNumber: p.vatNumber }, entries: entries.map((e) => ({ ...e, balance: (bal += e.debit - e.credit) })), balance: bal };
    });
  }

  /** Pull back-office state (ZATCA status, balances, payments recorded directly in ERPNext). */
  @Post('sync')
  @Perm('invoice.read')
  async sync(@Actor() actor: RequestActor) {
    return reconcile(actor.tenantId);
  }

  @Get('backoffice/health')
  @Perm('invoice.read')
  async boHealth(@Actor() actor: RequestActor) {
    return { kind: backOffice(actor.tenantId).kind, ...(await backOffice(actor.tenantId).health()) };
  }
}

async function renderRequestPdf(tx: Parameters<Parameters<typeof tenantTx>[1]>[0], pr: typeof paymentRequest.$inferSelect) {
  const [p] = pr.partyId ? await tx.select().from(party).where(eq(party.id, pr.partyId)) : [];
  const [c] = pr.contractId ? await tx.select().from(contract).where(eq(contract.id, pr.contractId)) : [];
  const [m] = pr.milestoneId ? await tx.select().from(billingMilestone).where(eq(billingMilestone.id, pr.milestoneId)) : [];
  const html = await renderPaymentRequestHtml({ company: await companyBlock(tx, false, true), number: pr.number, date: pr.createdAt.toISOString().slice(0, 10), dueDate: pr.dueDate, clientName: p?.nameAr ?? '', contractNumber: c?.number, milestoneName: m?.nameAr ?? '', amount: toHalalas(pr.amount), paidAmount: toHalalas(pr.paidAmount), payUrl: `${config.publicBaseUrl}/p/${pr.publicToken}` });
  return htmlToPdf(html, config.gotenbergUrl);
}

/** Reconciliation: refresh every mirrored invoice from the back office and record drift. */
export async function reconcile(tenantId: string) {
  return withTenant(getDb(), tenantId, async (tx) => {
    const mirrors = await tx.select().from(invoiceMirror);
    let updated = 0;
    const drift: string[] = [];
    for (const m of mirrors) {
      const inv = await backOffice(tenantId).getInvoice(m.erpName);
      if (!inv) { drift.push(`${m.number}: missing in back office`); continue; }
      if (inv.balanceDue !== m.balanceDue || inv.zatcaStatus !== m.zatcaStatus || inv.status !== m.status) {
        await mirrorInvoice(tx, inv, { partyId: m.partyId, contractId: m.contractId, milestoneId: m.milestoneId, paymentRequestId: m.paymentRequestId });
        updated++;
      }
      if (inv.total !== m.total) drift.push(`${m.number}: total ${m.total} ≠ ${inv.total}`);
    }
    const coreTotal = mirrors.reduce((s, m) => s + toHalalas(m.total), 0);
    await tx.execute(sql`insert into sync_reconciliation_run (entity, core_count, erp_count, core_total, status, drift) values ('invoice', ${mirrors.length}, ${mirrors.length - drift.filter((d) => d.includes('missing')).length}, ${halalasToFixed(coreTotal)}, ${drift.length ? 'drift' : 'ok'}, ${JSON.stringify(drift)}::jsonb)`);
    return { checked: mirrors.length, updated, drift };
  });
}

async function defaultTenant(): Promise<string> {
  const rows = await getDb().execute<{ t: string }>(sql`select default_tenant() as t`);
  return rows[0]!.t;
}

async function tenantForPay(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound('link');
  const rows = await getDb().execute<{ t: string | null }>(sql`select tenant_for_public_token('payment_request', ${token}) as t`);
  if (!rows[0]?.t) throw notFound('link');
  return rows[0].t;
}

/** Public payment page + gateway/ERP webhooks. */
@Controller()
@Public()
export class FinancePublicController {
  @Get('public/pay/:token')
  async view(@Param('token') token: string) {
    const tenantId = await tenantForPay(token);
    return withTenant(getDb(), tenantId, async (tx) => {
      const [pr] = await tx.select().from(paymentRequest).where(eq(paymentRequest.publicToken, token));
      if (!pr) throw notFound('payment request');
      const [p] = pr.partyId ? await tx.select({ nameAr: party.nameAr }).from(party).where(eq(party.id, pr.partyId)) : [];
      const [c] = pr.contractId ? await tx.select({ number: contract.number }).from(contract).where(eq(contract.id, pr.contractId)) : [];
      const [m] = pr.milestoneId ? await tx.select({ nameAr: billingMilestone.nameAr }).from(billingMilestone).where(eq(billingMilestone.id, pr.milestoneId)) : [];
      // AMC billing period (Phase 7b): show the agreement number and the period instead of a milestone
      const [ag] = pr.agreementId ? await tx.select({ number: serviceAgreement.number }).from(serviceAgreement).where(eq(serviceAgreement.id, pr.agreementId)) : [];
      const co = await companyBlock(tx);
      const invoices = pr.status === 'paid' || pr.status === 'partially_paid' ? await tx.select({ id: invoiceMirror.id, number: invoiceMirror.number, typeCode: invoiceMirror.typeCode, total: invoiceMirror.total }).from(invoiceMirror).where(eq(invoiceMirror.paymentRequestId, pr.id)) : [];
      return {
        company: { legalNameAr: co.legalNameAr, bankName: co.bankName, iban: co.iban, bankAccountName: co.bankAccountName, bankAccountNumber: co.bankAccountNumber, vatRegistered: co.vatRegistered },
        number: pr.number, status: pr.status, amount: pr.amount, paidAmount: pr.paidAmount, due: halalasToFixed(toHalalas(pr.amount) - toHalalas(pr.paidAmount)), dueDate: pr.dueDate,
        clientName: p?.nameAr ?? '', contractNumber: c?.number ?? ag?.number ?? null,
        milestone: m?.nameAr ?? (ag ? `عقد صيانة ${ag.number} — من ${pr.periodFrom ?? ''} إلى ${pr.periodTo ?? ''}` : ''), canPayOnline: ['draft', 'sent', 'partially_paid'].includes(pr.status), sandbox: config.payments.provider === 'sandbox' && config.allowSandbox, invoices,
      };
    });
  }

  @Get('public/pay/:token/pdf')
  async pdf(@Param('token') token: string, @Res() res: Response) {
    const tenantId = await tenantForPay(token);
    const { pdf, number } = await withTenant(getDb(), tenantId, async (tx) => {
      const [pr] = await tx.select().from(paymentRequest).where(eq(paymentRequest.publicToken, token));
      if (!pr) throw notFound('payment request');
      return { pdf: await renderRequestPdf(tx, pr), number: pr.number };
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${number}.pdf"`);
    res.send(pdf);
  }

  /** Sandbox gateway: simulates a successful mada payment and delivers a signed webhook. */
  @Post('public/pay/:token/sandbox')
  @HttpCode(200)
  async sandboxPay(@Param('token') token: string) {
    if (config.payments.provider !== 'sandbox' || !config.allowSandbox) throw forbidden('sandbox payments are disabled');
    const tenantId = await tenantForPay(token);
    const pr = await withTenant(getDb(), tenantId, async (tx) => (await tx.select().from(paymentRequest).where(eq(paymentRequest.publicToken, token)))[0]);
    if (!pr) throw notFound('payment request');
    const due = halalasToFixed(toHalalas(pr.amount) - toHalalas(pr.paidAmount));
    const payload = JSON.stringify({ id: `sbx_pay_${randomUUID()}`, status: 'paid', amount: due, method: 'mada', reference: pr.number, paymentLinkId: pr.paymentLinkProviderId, paidAt: new Date().toISOString() });
    return handlePaymentWebhook(Buffer.from(payload), signSandboxWebhook(payload));
  }

  @Post('webhooks/payments')
  @HttpCode(200)
  async paymentsWebhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-signature') sig: string | undefined) {
    return handlePaymentWebhook(req.rawBody ?? Buffer.alloc(0), sig);
  }

  /** ERPNext webhook (Sales Invoice / Payment Entry on_update): refresh mirrors. */
  @Post('webhooks/erpnext')
  @HttpCode(200)
  async erpWebhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-frappe-webhook-signature') sig: string | undefined, @Body() body: { doctype?: string; name?: string }) {
    if (!verifyFrappeWebhook(req.rawBody ?? Buffer.alloc(0), sig, config.erpnext.webhookSecret)) throw forbidden('bad signature');
    const tenantId = await defaultTenant();
    if (body.doctype === 'Sales Invoice' && body.name) {
      await withTenant(getDb(), tenantId, async (tx) => {
        const [seen] = await tx.insert(inboxEvent).values({ tenantId, source: 'erpnext', externalId: `${body.name}:${Date.now()}`, payload: body as never }).onConflictDoNothing().returning();
        if (!seen) return;
        const inv = await backOffice(tenantId).getInvoice(body.name!);
        const [m] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.erpName, body.name!));
        if (inv && m) await mirrorInvoice(tx, inv, { partyId: m.partyId, contractId: m.contractId, milestoneId: m.milestoneId, paymentRequestId: m.paymentRequestId });
      });
    }
    return { ok: true };
  }
}

async function handlePaymentWebhook(raw: Buffer, sig: string | undefined) {
  if (!payments().verifyWebhook(raw, sig)) throw forbidden('bad signature');
  const evt = JSON.parse(raw.toString('utf8')) as { id: string; status: string; amount: string; method: string; reference: string; paidAt: string };
  if (evt.status !== 'paid') return { ok: true, ignored: evt.status };
  const tenantId = await defaultTenant();
  return withTenant(getDb(), tenantId, async (tx) => {
    const [seen] = await tx.insert(inboxEvent).values({ tenantId, source: 'payments', externalId: evt.id, payload: evt as never }).onConflictDoNothing().returning();
    if (!seen) return { ok: true, duplicate: true };
    const [pr] = await tx.select().from(paymentRequest).where(eq(paymentRequest.number, evt.reference));
    if (!pr) throw notFound('payment request');
    const r = await applyPayment(tx, null, tenantId, pr.id, { amount: evt.amount, paidOn: evt.paidAt.slice(0, 10), method: evt.method === 'mada' ? 'mada' : evt.method, reference: evt.id, idempotencyKey: `gw:${evt.id}` });
    await tx.update(inboxEvent).set({ processedAt: new Date() }).where(and(eq(inboxEvent.source, 'payments'), eq(inboxEvent.externalId, evt.id)));
    return { ok: true, invoice: r.invoice?.number ?? r.changeOrderInvoice?.number ?? null };
  });
}
