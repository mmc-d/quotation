import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { account, and, appUser, cashVoucher, desc, eq, gte, ilike, lte, nextNumber, or, party, project, sql, type Tx } from '@mmc/db';
import { halalasToFixed, riyadhDate, toHalalas } from '@mmc/domain';
import { htmlToPdf, renderVoucherHtml } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit, diff } from '../common/audit.js';
import { companyBlock } from '../common/company.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { ZodPipe, zDate, zMoney, zPage, zUuid } from '../common/zod.js';
import { config } from '../config.js';
import { tryPost } from './gl-posting.service.js';

/**
 * Cash vouchers — سند صرف (payment) and سند قبض (receipt). Finance staff enter a draft; a second
 * person with voucher.approve stamps it (the owner may stamp their own). Approved vouchers are
 * read-only; cancelling one needs voucher.approve and a reason. Numbers are never reused.
 */

const KINDS = ['payment', 'receipt'] as const;
const METHODS = ['cash', 'cheque', 'transfer', 'card', 'other'] as const;
const zText = (max = 2000) => z.string().trim().max(max);

const voucherSchema = z.object({
  kind: z.enum(KINDS),
  voucherDate: zDate,
  partyId: zUuid.nullish(),
  counterpartyName: zText(200).min(1),
  counterpartyIdNumber: zText(40).nullish(),
  counterpartyMobile: zText(30).nullish(),
  amount: zMoney.refine((v) => Number(v) > 0, 'must be positive'),
  purpose: zText(1000).min(1),
  method: z.enum(METHODS).default('cash'),
  methodRef: zText(80).nullish(),
  bankName: zText(120).nullish(),
  methodDate: zDate.nullish(),
  projectId: zUuid.nullish(),
  costCenter: zText(120).nullish(),
  accountId: zUuid.nullish(),
  docRef: zText(120).nullish(),
  notes: zText(2000).nullish(),
});
type VoucherBody = z.infer<typeof voucherSchema>;
const listQuery = zPage.extend({ kind: z.enum(KINDS).optional(), status: z.enum(['draft', 'approved', 'cancelled']).optional(), from: zDate.optional(), to: zDate.optional() });

async function load(tx: Tx, id: string) {
  const [v] = await tx.select().from(cashVoucher).where(eq(cashVoucher.id, id));
  if (!v) throw notFound('voucher');
  return v;
}

async function view(tx: Tx, id: string) {
  const v = await load(tx, id);
  const [pt] = v.partyId ? await tx.select({ id: party.id, nameAr: party.nameAr }).from(party).where(eq(party.id, v.partyId)) : [];
  const [pr] = v.projectId ? await tx.select({ id: project.id, number: project.number, name: project.name }).from(project).where(eq(project.id, v.projectId)) : [];
  const [ac] = v.accountId ? await tx.select({ id: account.id, code: account.code, nameAr: account.nameAr }).from(account).where(eq(account.id, v.accountId)) : [];
  const [cu] = v.createdBy ? await tx.select({ nameAr: appUser.nameAr }).from(appUser).where(eq(appUser.id, v.createdBy)) : [];
  return { ...v, party: pt ?? null, project: pr ?? null, account: ac ?? null, createdByName: cu?.nameAr ?? null };
}

const values = (b: VoucherBody) => ({
  voucherDate: b.voucherDate, partyId: b.partyId ?? null, counterpartyName: b.counterpartyName, counterpartyIdNumber: b.counterpartyIdNumber || null,
  counterpartyMobile: b.counterpartyMobile || null, amount: halalasToFixed(toHalalas(b.amount)), purpose: b.purpose, method: b.method,
  methodRef: b.methodRef || null, bankName: b.bankName || null, methodDate: b.methodDate ?? null, projectId: b.projectId ?? null,
  costCenter: b.costCenter || null, accountId: b.accountId ?? null, docRef: b.docRef || null, notes: b.notes || null,
});

/** The counter account must be a postable, active account; accounts that track a customer/supplier need the party chosen. */
async function checkAccount(tx: Tx, b: { accountId?: string | null; partyId?: string | null }) {
  if (!b.accountId) return;
  const [a] = await tx.select().from(account).where(eq(account.id, b.accountId));
  if (!a || a.isGroup || !a.isActive) throw badRequest('the counter account must be an active, postable account');
  if (a.requiresParty && !b.partyId) throw badRequest(`account ${a.code} tracks a customer/supplier — choose the party on the voucher`);
}

@Controller('vouchers')
export class VouchersController {
  @Get()
  @Perm('voucher.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const term = q.q?.trim() ? `%${q.q.trim()}%` : null;
      const where = and(
        q.kind ? eq(cashVoucher.kind, q.kind) : undefined,
        q.status ? eq(cashVoucher.status, q.status) : undefined,
        q.from ? gte(cashVoucher.voucherDate, q.from) : undefined,
        q.to ? lte(cashVoucher.voucherDate, q.to) : undefined,
        term ? or(ilike(cashVoucher.number, term), ilike(cashVoucher.counterpartyName, term), ilike(cashVoucher.purpose, term), ilike(cashVoucher.docRef, term)) : undefined,
      );
      const rows = await tx.select({
        id: cashVoucher.id, kind: cashVoucher.kind, number: cashVoucher.number, voucherDate: cashVoucher.voucherDate, counterpartyName: cashVoucher.counterpartyName,
        amount: cashVoucher.amount, purpose: cashVoucher.purpose, method: cashVoucher.method, status: cashVoucher.status, approvedByName: cashVoucher.approvedByName, projectNumber: project.number,
      }).from(cashVoucher).leftJoin(project, eq(project.id, cashVoucher.projectId)).where(where).orderBy(desc(cashVoucher.voucherDate), desc(cashVoucher.createdAt)).limit(q.limit).offset(q.offset);
      // totals of approved vouchers in the same filter (cancelled and drafts don't move money)
      const [t] = await tx.select({
        total: sql<number>`count(*)::int`,
        paid: sql<string>`coalesce(sum(${cashVoucher.amount}) filter (where ${cashVoucher.kind} = 'payment' and ${cashVoucher.status} = 'approved'), 0)::text`,
        received: sql<string>`coalesce(sum(${cashVoucher.amount}) filter (where ${cashVoucher.kind} = 'receipt' and ${cashVoucher.status} = 'approved'), 0)::text`,
        pending: sql<number>`count(*) filter (where ${cashVoucher.status} = 'draft')::int`,
      }).from(cashVoucher).where(where);
      return { rows, total: t!.total, summary: { paid: t!.paid, received: t!.received, pending: t!.pending } };
    });
  }

  @Get(':id')
  @Perm('voucher.read')
  async get(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, (tx) => view(tx, id));
  }

  @Post()
  @Perm('voucher.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(voucherSchema)) b: VoucherBody) {
    return tenantTx(actor.tenantId, async (tx) => {
      if (b.voucherDate > riyadhDate()) throw badRequest('the voucher date cannot be in the future');
      await checkAccount(tx, b);
      const { number } = await nextNumber(tx, b.kind === 'payment' ? 'payment_voucher' : 'receipt_voucher');
      const [v] = await tx.insert(cashVoucher).values({ kind: b.kind, number, ...values(b), createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'cash_voucher', v!.id, null, { number, kind: b.kind, amount: v!.amount, counterparty: b.counterpartyName });
      return view(tx, v!.id);
    }, actor.userId);
  }

  @Put(':id')
  @Perm('voucher.write')
  async update(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(voucherSchema.extend({ version: z.number().int() }))) b: VoucherBody & { version: number }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const before = await load(tx, id);
      if (before.status !== 'draft') throw conflict('only draft vouchers can be edited');
      if (b.kind !== before.kind) throw badRequest('the voucher kind cannot be changed');
      if (b.version !== before.version) throw conflict('the voucher was changed by someone else — reload');
      if (b.voucherDate > riyadhDate()) throw badRequest('the voucher date cannot be in the future');
      await checkAccount(tx, b);
      const next = values(b);
      await tx.update(cashVoucher).set({ ...next, updatedAt: new Date(), updatedBy: actor.userId, version: before.version + 1 }).where(eq(cashVoucher.id, id));
      const d = diff(before as Record<string, unknown>, next as Record<string, unknown>);
      if (d) await audit(tx, actor, 'update', 'cash_voucher', id, d.before, d.after);
      return view(tx, id);
    }, actor.userId);
  }

  /** The second confirmation: stamps the voucher. The approver must not be the creator unless they are the owner. */
  @Post(':id/approve')
  @Perm('voucher.approve')
  async approve(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const v = await load(tx, id);
      if (v.status !== 'draft') throw conflict(`the voucher is already ${v.status}`);
      if (v.createdBy === actor.userId && !actor.roleKeys.includes('owner')) throw forbidden('you cannot approve a voucher you created — another approver must stamp it');
      const [me] = await tx.select({ nameAr: appUser.nameAr }).from(appUser).where(eq(appUser.id, actor.userId));
      await tx.update(cashVoucher).set({ status: 'approved', approvedBy: actor.userId, approvedByName: me?.nameAr || actor.name, approvedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId, version: v.version + 1 }).where(eq(cashVoucher.id, id));
      await audit(tx, actor, 'approve', 'cash_voucher', id, { status: 'draft' }, { status: 'approved', number: v.number, amount: v.amount });
      await tryPost(tx, 'voucher', id);
      return view(tx, id);
    }, actor.userId);
  }

  /** Drafts can be cancelled by their editors; an approved voucher only by an approver. Always with a reason. */
  @Post(':id/cancel')
  @Perm('voucher.write', 'voucher.approve')
  async cancel(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ reason: zText(1000).min(1) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const v = await load(tx, id);
      if (v.status === 'cancelled') throw conflict('the voucher is already cancelled');
      if (v.status === 'approved' && !actor.grants['voucher.approve']) throw forbidden('cancelling an approved voucher requires voucher.approve');
      if (v.status === 'draft' && !actor.grants['voucher.write']) throw forbidden('missing permission: voucher.write');
      await tx.update(cashVoucher).set({ status: 'cancelled', cancelledBy: actor.userId, cancelledAt: new Date(), cancelReason: b.reason, updatedAt: new Date(), updatedBy: actor.userId, version: v.version + 1 }).where(eq(cashVoucher.id, id));
      await audit(tx, actor, 'cancel', 'cash_voucher', id, { status: v.status }, { status: 'cancelled' }, b.reason);
      if (v.status === 'approved') await tryPost(tx, 'voucher', id); // reverses the entry it posted
      return view(tx, id);
    }, actor.userId);
  }

  @Get(':id/pdf')
  @Perm('voucher.read')
  async pdf(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Res() res: Response) {
    const { pdf, number } = await tenantTx(actor.tenantId, async (tx) => {
      const v = await view(tx, id);
      const approved = v.status === 'approved';
      const html = renderVoucherHtml({
        company: await companyBlock(tx, approved), kind: v.kind as 'payment' | 'receipt', number: v.number, date: v.voucherDate,
        counterpartyName: v.counterpartyName, counterpartyIdNumber: v.counterpartyIdNumber, counterpartyMobile: v.counterpartyMobile, amount: toHalalas(v.amount),
        purpose: v.purpose, method: v.method, methodRef: v.methodRef, bankName: v.bankName, methodDate: v.methodDate,
        project: v.project ? `${v.project.number} — ${v.project.name}` : null, costCenter: v.costCenter, docRef: v.docRef, notes: v.notes,
        status: v.status as 'draft' | 'approved' | 'cancelled', createdByName: v.createdByName, approvedByName: v.approvedByName,
        approvedAt: v.approvedAt ? riyadhDate(v.approvedAt) : null, cancelReason: v.cancelReason,
      });
      return { pdf: await htmlToPdf(html, config.gotenbergUrl), number: v.number };
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${number}.pdf"`);
    res.send(pdf);
  }
}
