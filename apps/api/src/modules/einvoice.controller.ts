import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, desc, einvoiceDocument, eq, invoiceMirror, party, sql } from '@mmc/db';
import { z } from 'zod';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { tenantTx } from '../common/db.js';
import { badRequest, notFound } from '../common/errors.js';
import { ZodPipe, zPage, zUuid } from '../common/zod.js';
import { invoicePdf } from './finance.controller.js';
import {
  ZatcaRejection, createUnit, einvoiceOverview, exchangeCsr, issueMissing, prepareCsr, reissueRejected, requestProduction, revokeUnit, runCompliance,
  selfTest, setEnabled, storeComplianceCsid, submitPending, unitView, verifyChain,
} from './einvoice.service.js';

/**
 * ZATCA Phase-2 e-invoicing (Phase 6D). Reading needs ledger.read / invoice.read; onboarding,
 * the feature flag and submissions need einvoice.manage (owner and general manager).
 */
@Controller('einvoice')
export class EInvoiceController {
  @Get('status')
  @Perm('ledger.read')
  async status(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => einvoiceOverview(tx));
  }

  @Put('settings')
  @Perm('einvoice.manage')
  async settings(
    @Actor() actor: RequestActor,
    @Body(new ZodPipe(z.object({
      enabled: z.boolean(),
      zeroRatedReason: z.string().trim().regex(/^VATEX-SA-[A-Z0-9-]+$/, 'a VATEX-SA-… code').nullish(),
      zeroRatedReasonText: z.string().trim().max(200).nullish(),
      paymentMeansCode: z.enum(['1', '10', '30', '42', '48']).nullish(),
    }))) b: { enabled: boolean; zeroRatedReason?: string | null; zeroRatedReasonText?: string | null; paymentMeansCode?: string | null },
  ) {
    return tenantTx(actor.tenantId, (tx) => setEnabled(tx, actor, b), actor.userId);
  }

  // ───────── onboarding ladder: unit → CSR + OTP → compliance checks → production CSID ─────────

  @Post('units')
  @Perm('einvoice.manage')
  async newUnit(@Actor() actor: RequestActor, @Body(new ZodPipe(z.object({ name: z.string().trim().min(1).max(80), environment: z.enum(['simulation', 'production']) }))) b: { name: string; environment: 'simulation' | 'production' }) {
    return tenantTx(actor.tenantId, async (tx) => unitView(await createUnit(tx, actor, b)), actor.userId);
  }

  /** Spends the OTP: the CSR is saved first, the exchange runs once, and a failure is shown — never queued. */
  @Post('units/:id/otp')
  @Perm('einvoice.manage')
  async otp(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ otp: z.string().trim().regex(/^\d{4,10}$/, 'the OTP from the Fatoora portal') }))) b: { otp: string }) {
    const { csr, environment } = await tenantTx(actor.tenantId, (tx) => prepareCsr(tx, actor, id), actor.userId);
    let issued;
    try {
      issued = await exchangeCsr(csr, environment, b.otp);
    } catch (e) {
      if (e instanceof ZatcaRejection) throw badRequest(e.message, e.detail);
      throw e;
    }
    return tenantTx(actor.tenantId, async (tx) => {
      await storeComplianceCsid(tx, actor, id, issued);
      return { status: 'compliance_csid', requestId: issued.requestId };
    }, actor.userId);
  }

  @Post('units/:id/compliance')
  @Perm('einvoice.manage')
  async compliance(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, (tx) => runCompliance(tx, actor, id), actor.userId);
  }

  @Post('units/:id/production')
  @Perm('einvoice.manage')
  async production(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    try {
      return await tenantTx(actor.tenantId, (tx) => requestProduction(tx, actor, id), actor.userId);
    } catch (e) {
      if (e instanceof ZatcaRejection) throw badRequest(e.message, e.detail);
      throw e;
    }
  }

  @Post('units/:id/revoke')
  @Perm('einvoice.manage')
  async revoke(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3).max(300) }))) b: { reason: string }) {
    await tenantTx(actor.tenantId, (tx) => revokeUnit(tx, actor, id, b.reason), actor.userId);
    return { ok: true };
  }

  /** Rehearsal against ZATCA's sandbox — writes nothing. */
  @Post('self-test')
  @Perm('einvoice.manage')
  async rehearsal() {
    try {
      return await selfTest();
    } catch (e) {
      if (e instanceof ZatcaRejection) throw badRequest(e.message, e.detail);
      throw e;
    }
  }

  // ───────── documents ─────────

  @Get('documents')
  @Perm('invoice.read')
  async documents(@Actor() actor: RequestActor, @Query(new ZodPipe(zPage.extend({ status: z.enum(['pending', 'error', 'cleared', 'reported', 'rejected']).optional() }))) q: { limit: number; offset: number; status?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const where = and(sql`${einvoiceDocument.supersededAt} is null`, q.status ? eq(einvoiceDocument.status, q.status) : undefined);
      const rows = await tx.select({
        id: einvoiceDocument.id, number: einvoiceDocument.number, typeCode: einvoiceDocument.typeCode, subtype: einvoiceDocument.subtype, icv: einvoiceDocument.icv,
        issueDate: einvoiceDocument.issueDate, submission: einvoiceDocument.submission, status: einvoiceDocument.status, attempts: einvoiceDocument.attempts,
        lastError: einvoiceDocument.lastError, submittedAt: einvoiceDocument.submittedAt, invoiceId: einvoiceDocument.invoiceId,
        total: invoiceMirror.total, customer: party.nameAr,
      }).from(einvoiceDocument).innerJoin(invoiceMirror, eq(invoiceMirror.id, einvoiceDocument.invoiceId)).leftJoin(party, eq(party.id, invoiceMirror.partyId))
        .where(where).orderBy(desc(einvoiceDocument.icv)).limit(q.limit).offset(q.offset);
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(einvoiceDocument).where(where);
      return { rows, total: n };
    });
  }

  @Get('documents/:id')
  @Perm('invoice.read')
  async document(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [d] = await tx.select().from(einvoiceDocument).where(eq(einvoiceDocument.id, id));
      if (!d) throw notFound('e-invoice document');
      const { xml, clearedXml, ...rest } = d;
      return { ...rest, hasClearedXml: Boolean(clearedXml), xmlBytes: xml.length };
    });
  }

  /** The signed XML as issued, or ZATCA's stamped copy once cleared (`?version=cleared`). */
  @Get('documents/:id/xml')
  @Perm('invoice.read')
  async xml(@Actor() actor: RequestActor, @Res() res: Response, @Param('id', new ZodPipe(zUuid)) id: string, @Query(new ZodPipe(z.object({ version: z.enum(['signed', 'cleared']).optional() }))) q: { version?: 'signed' | 'cleared' }) {
    const d = await tenantTx(actor.tenantId, async (tx) => {
      const [row] = await tx.select().from(einvoiceDocument).where(eq(einvoiceDocument.id, id));
      if (!row) throw notFound('e-invoice document');
      return row;
    });
    const wantCleared = q.version ? q.version === 'cleared' : Boolean(d.clearedXml);
    if (wantCleared && !d.clearedXml) throw notFound('cleared XML');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${d.number}${wantCleared ? '-cleared' : ''}.xml"`);
    return res.send(wantCleared ? d.clearedXml : d.xml);
  }

  /** Archival PDF/A-3b of the invoice with the signed (cleared, once cleared) XML embedded. */
  @Get('documents/:id/pdf')
  @Perm('invoice.read')
  async archivePdf(@Actor() actor: RequestActor, @Res() res: Response, @Param('id', new ZodPipe(zUuid)) id: string) {
    const { pdf, number } = await tenantTx(actor.tenantId, async (tx) => {
      const [d] = await tx.select().from(einvoiceDocument).where(eq(einvoiceDocument.id, id));
      if (!d) throw notFound('e-invoice document');
      return invoicePdf(tx, d.invoiceId, { name: `${d.number}.xml`, xml: d.clearedXml ?? d.xml });
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${number}-archive.pdf"`);
    return res.send(pdf);
  }

  @Post('documents/:id/reissue')
  @Perm('einvoice.manage')
  async reissue(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, (tx) => reissueRejected(tx, actor, id), actor.userId);
  }

  /** Send everything pending in ICV order (the 2-minute job does the same). */
  @Post('submit')
  @Perm('einvoice.manage')
  async submit(@Actor() actor: RequestActor) {
    return submitPending(actor.tenantId);
  }

  /** Build documents for invoices that were blocked (customer data fixed since). */
  @Post('issue-missing')
  @Perm('einvoice.manage')
  async missing(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const r = await issueMissing(tx);
      await audit(tx, actor, 'issue_missing', 'einvoice', null, null, { issued: r.issued, blocked: r.blocked });
      return r;
    }, actor.userId);
  }

  /** Integrity check: hashes recompute, stamps verify, ICV is gapless and PIH links every document. */
  @Get('verify')
  @Perm('ledger.close')
  async verify(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => verifyChain(tx));
  }

  /** Invoices that could not be turned into e-invoices yet, with the reason. */
  @Get('blocked')
  @Perm('invoice.read')
  async blocked(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, (tx) => tx.select({ id: invoiceMirror.id, number: invoiceMirror.number, typeCode: invoiceMirror.typeCode, issueDate: invoiceMirror.issueDate, error: invoiceMirror.einvoiceError, customer: party.nameAr })
      .from(invoiceMirror).leftJoin(party, eq(party.id, invoiceMirror.partyId))
      .where(and(sql`${invoiceMirror.einvoiceError} is not null`, sql`${invoiceMirror.status} <> 'cancelled'`)).orderBy(asc(invoiceMirror.issueDate)).limit(200));
  }
}
