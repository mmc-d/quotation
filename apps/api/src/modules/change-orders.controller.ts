import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { and, appUser, asc, billingMilestone, changeOrder, contract, desc, emit, eq, inArray, invoiceMirror, nextNumber, paymentRequest, type Tx } from '@mmc/db';
import { dec, halalasToFixed } from '@mmc/domain';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { loadCompany } from '../common/company.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors.js';
import { assertCan } from '../common/scope.js';
import { ZodPipe, zDate, zMoney } from '../common/zod.js';
import { billChangeOrder, changeOrderTotals } from './finance.service.js';

/**
 * Change orders (module 04): amendments to a signed contract. Lines are priced deltas — a negative
 * quantity removes an item. The contract itself is never edited; its total stays the original and
 * the billing view shows the value including approved change orders.
 *
 * draft → pending_approval → approved → signed (client acceptance, optional) → billed; or rejected / cancelled.
 */
const zSignedQty = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^-?\d+(\.\d{1,3})?$/.test(v) && Number(v) !== 0, 'quantity must be a non-zero number (negative removes an item)');
const lineSchema = z.object({ code: z.string().trim().min(1), description: z.string().trim().min(1), qty: zSignedQty, unitPrice: zMoney.refine((v) => Number(v) >= 0, 'unit price cannot be negative') });
const bodySchema = z.object({ description: z.string().trim().min(1).max(500), reason: z.string().trim().max(2000).nullish(), lines: z.array(lineSchema).min(1).max(200), version: z.number().int().optional() });
const createSchema = bodySchema.extend({ contractId: z.string().uuid() });
type CoBody = z.infer<typeof bodySchema>;

const OPEN_CONTRACT = ['signed', 'active'];

async function loadContractFor(tx: Tx, actor: RequestActor, contractId: string, perm: 'contract.read' | 'contract.write') {
  const [c] = await tx.select().from(contract).where(eq(contract.id, contractId));
  if (!c) throw notFound('contract');
  assertCan(actor, perm, { ownerId: c.ownerId, teamId: c.teamId, branchId: c.branchId });
  return c;
}

async function loadCo(tx: Tx, actor: RequestActor, id: string, perm: 'contract.read' | 'contract.write') {
  const [co] = await tx.select().from(changeOrder).where(eq(changeOrder.id, id));
  if (!co) throw notFound('change order');
  const c = await loadContractFor(tx, actor, co.contractId, perm);
  return { co, c };
}

/** Deltas for the lines at the contract's VAT terms (VAT only when the company is registered and the contract has VAT on). */
async function computeDeltas(tx: Tx, c: typeof contract.$inferSelect, lines: CoBody['lines']) {
  const company = await loadCompany(tx);
  const t = changeOrderTotals(lines, company.vatRegistered && c.vatOn);
  return { subtotalDelta: halalasToFixed(t.subtotal), vatDelta: halalasToFixed(t.vat), amountDelta: halalasToFixed(t.total) };
}

function normLines(lines: CoBody['lines']) {
  return lines.map((l) => ({ code: l.code, description: l.description, qty: dec(l.qty).toString(), unitPrice: dec(l.unitPrice).toString() }));
}

async function coView(tx: Tx, id: string) {
  const [co] = await tx.select().from(changeOrder).where(eq(changeOrder.id, id));
  if (!co) throw notFound('change order');
  const [c] = await tx.select({ id: contract.id, number: contract.number, title: contract.title, status: contract.status, total: contract.total, vatOn: contract.vatOn }).from(contract).where(eq(contract.id, co.contractId));
  const users = [co.createdBy, co.approvedBy].filter((x): x is string => !!x);
  const names = users.length ? await tx.select({ id: appUser.id, nameAr: appUser.nameAr, email: appUser.email }).from(appUser).where(inArray(appUser.id, users)) : [];
  const nameOf = (uid: string | null) => (uid ? names.find((n) => n.id === uid)?.nameAr || names.find((n) => n.id === uid)?.email || null : null);
  const [m] = co.milestoneId ? await tx.select().from(billingMilestone).where(eq(billingMilestone.id, co.milestoneId)) : [];
  const requests = co.milestoneId ? await tx.select({ id: paymentRequest.id, number: paymentRequest.number, amount: paymentRequest.amount, paidAmount: paymentRequest.paidAmount, status: paymentRequest.status, dueDate: paymentRequest.dueDate, publicToken: paymentRequest.publicToken }).from(paymentRequest).where(eq(paymentRequest.milestoneId, co.milestoneId)).orderBy(asc(paymentRequest.createdAt)) : [];
  const invoices = co.milestoneId ? await tx.select({ id: invoiceMirror.id, number: invoiceMirror.number, typeCode: invoiceMirror.typeCode, total: invoiceMirror.total, balanceDue: invoiceMirror.balanceDue, issueDate: invoiceMirror.issueDate }).from(invoiceMirror).where(eq(invoiceMirror.milestoneId, co.milestoneId)).orderBy(asc(invoiceMirror.issueDate)) : [];
  return { ...co, contract: c ?? null, createdByName: nameOf(co.createdBy), approvedByName: nameOf(co.approvedBy), milestone: m ?? null, paymentRequests: requests, invoices };
}

@Controller('change-orders')
export class ChangeOrdersController {
  @Get()
  @Perm('contract.read')
  async list(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ contractId: z.string().uuid(), status: z.string().optional() }))) q: { contractId: string; status?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const c = await loadContractFor(tx, actor, q.contractId, 'contract.read');
      const rows = await tx.select().from(changeOrder).where(and(eq(changeOrder.contractId, c.id), q.status ? inArray(changeOrder.status, q.status.split(',')) : undefined)).orderBy(desc(changeOrder.createdAt));
      const effective = rows.filter((r) => ['approved', 'signed', 'billed'].includes(r.status)).reduce((s, r) => s.plus(r.amountDelta), dec(0));
      return { rows, contract: { id: c.id, number: c.number, total: c.total, status: c.status }, approvedTotal: effective.toFixed(2), adjustedTotal: dec(c.total).plus(effective).toFixed(2) };
    });
  }

  @Get(':id')
  @Perm('contract.read')
  async get(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      await loadCo(tx, actor, id, 'contract.read');
      return coView(tx, id);
    });
  }

  /** New draft change order on a signed / active contract (numbered MMC-CO-0001…). */
  @Post()
  @Perm('contract.write')
  async create(@Actor() actor: RequestActor, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    return tenantTx(actor.tenantId, async (tx) => {
      const c = await loadContractFor(tx, actor, b.contractId, 'contract.write');
      if (!OPEN_CONTRACT.includes(c.status)) throw badRequest('change orders apply to a signed or active contract — edit a draft contract directly');
      const lines = normLines(b.lines);
      const deltas = await computeDeltas(tx, c, lines);
      const { number } = await nextNumber(tx, 'change_order');
      const [co] = await tx.insert(changeOrder).values({ contractId: c.id, number, description: b.description, reason: b.reason ?? null, lines, ...deltas, status: 'draft', createdBy: actor.userId, updatedBy: actor.userId }).returning();
      await audit(tx, actor, 'create', 'change_order', co!.id, null, { number, contract: c.number, ...deltas });
      await emit(tx, 'change_order', co!.id, 'change_order.created', { number, contract: c.number });
      return coView(tx, co!.id);
    }, actor.userId);
  }

  /** Edit a draft (or a rejected one, which goes back to draft). */
  @Put(':id')
  @Perm('contract.write')
  async update(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(bodySchema)) b: CoBody) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { co, c } = await loadCo(tx, actor, id, 'contract.write');
      if (!['draft', 'rejected'].includes(co.status)) throw conflict(`a ${co.status} change order cannot be edited`);
      if (b.version !== undefined && b.version !== co.version) throw conflict('the change order was changed by someone else — reload');
      const lines = normLines(b.lines);
      const deltas = await computeDeltas(tx, c, lines);
      await tx.update(changeOrder).set({ description: b.description, reason: b.reason ?? null, lines, ...deltas, status: 'draft', updatedAt: new Date(), updatedBy: actor.userId, version: co.version + 1 }).where(eq(changeOrder.id, id));
      await audit(tx, actor, 'update', 'change_order', id, { amountDelta: co.amountDelta, status: co.status }, { amountDelta: deltas.amountDelta, status: 'draft' });
      return coView(tx, id);
    }, actor.userId);
  }

  @Post(':id/submit')
  @Perm('contract.write')
  async submit(@Actor() actor: RequestActor, @Param('id') id: string) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { co, c } = await loadCo(tx, actor, id, 'contract.write');
      if (co.status !== 'draft') throw badRequest(`cannot submit a ${co.status} change order`);
      if (!OPEN_CONTRACT.includes(c.status)) throw badRequest(`the contract is ${c.status}`);
      const deltas = await computeDeltas(tx, c, co.lines); // VAT mode may have changed since the draft
      if (dec(deltas.amountDelta).isZero()) throw badRequest('the change order has no value — add or remove at least one priced item');
      await tx.update(changeOrder).set({ ...deltas, status: 'pending_approval', updatedAt: new Date(), updatedBy: actor.userId }).where(eq(changeOrder.id, id));
      await audit(tx, actor, 'status_pending_approval', 'change_order', id, { status: co.status }, { status: 'pending_approval', amountDelta: deltas.amountDelta });
      await emit(tx, 'change_order', id, 'change_order.submitted', { number: co.number });
      return coView(tx, id);
    }, actor.userId);
  }

  /** Approve: needs contract.sign or quote.approve, and the approver must not be the creator (the owner may self-approve). */
  @Post(':id/approve')
  @Perm('contract.read')
  async approve(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ comment: z.string().max(1000).nullish() }).nullish())) b: { comment?: string | null } | null | undefined) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { co } = await this.forDecision(tx, actor, id);
      const now = new Date();
      await tx.update(changeOrder).set({ status: 'approved', approvedBy: actor.userId, approvedAt: now, updatedAt: now, updatedBy: actor.userId }).where(eq(changeOrder.id, id));
      await audit(tx, actor, 'status_approved', 'change_order', id, { status: co.status }, { status: 'approved', comment: b?.comment ?? null });
      await emit(tx, 'change_order', id, 'change_order.approved', { number: co.number });
      return coView(tx, id);
    }, actor.userId);
  }

  @Post(':id/reject')
  @Perm('contract.read')
  async reject(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(1).max(1000) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { co } = await this.forDecision(tx, actor, id);
      await tx.update(changeOrder).set({ status: 'rejected', updatedAt: new Date(), updatedBy: actor.userId }).where(eq(changeOrder.id, id));
      await audit(tx, actor, 'status_rejected', 'change_order', id, { status: co.status }, { status: 'rejected' }, b.reason);
      return coView(tx, id);
    }, actor.userId);
  }

  /** Record the client's acceptance of an approved change order (optional step before billing). */
  @Post(':id/sign')
  @Perm('contract.write')
  async sign(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ signedOn: zDate.nullish(), note: z.string().max(1000).nullish() }).nullish())) b: { signedOn?: string | null; note?: string | null } | null | undefined) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { co } = await loadCo(tx, actor, id, 'contract.write');
      if (co.status !== 'approved') throw badRequest('only an approved change order can be marked as accepted by the client');
      const signedAt = b?.signedOn ? new Date(`${b.signedOn}T12:00:00+03:00`) : new Date();
      await tx.update(changeOrder).set({ status: 'signed', signedAt, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(changeOrder.id, id));
      await audit(tx, actor, 'status_signed', 'change_order', id, { status: co.status }, { status: 'signed', signedAt: signedAt.toISOString(), note: b?.note ?? null });
      await emit(tx, 'change_order', id, 'change_order.signed', { number: co.number });
      return coView(tx, id);
    }, actor.userId);
  }

  @Post(':id/cancel')
  @Perm('contract.write')
  async cancel(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(1).max(1000) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const { co } = await loadCo(tx, actor, id, 'contract.write');
      if (!['draft', 'pending_approval', 'approved', 'signed', 'rejected'].includes(co.status)) throw badRequest(`a ${co.status} change order cannot be cancelled — issue a credit note instead`);
      if (co.milestoneId) {
        const [open] = await tx.select({ number: paymentRequest.number }).from(paymentRequest).where(and(eq(paymentRequest.milestoneId, co.milestoneId), inArray(paymentRequest.status, ['draft', 'sent', 'partially_paid', 'paid'])));
        if (open) throw badRequest(`payment request ${open.number} exists for this change order`);
      }
      await tx.update(changeOrder).set({ status: 'cancelled', updatedAt: new Date(), updatedBy: actor.userId }).where(eq(changeOrder.id, id));
      await audit(tx, actor, 'status_cancelled', 'change_order', id, { status: co.status }, { status: 'cancelled' }, b.reason);
      return coView(tx, id);
    }, actor.userId);
  }

  /** Bill: positive → payment request (paid → separate 388 for the CO lines); negative → 381 credit note. */
  @Post(':id/bill')
  @Perm('billing.write')
  async bill(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ dueDate: zDate.nullish() }).nullish())) b: { dueDate?: string | null } | null | undefined) {
    return tenantTx(actor.tenantId, async (tx) => {
      const [co] = await tx.select().from(changeOrder).where(eq(changeOrder.id, id));
      if (!co) throw notFound('change order');
      const [c] = await tx.select().from(contract).where(eq(contract.id, co.contractId));
      if (!c) throw notFound('contract');
      assertCan(actor, 'billing.write', { ownerId: c.ownerId, teamId: c.teamId, branchId: c.branchId });
      const r = await billChangeOrder(tx, actor, id, b?.dueDate);
      return { ...r, changeOrder: await coView(tx, id) };
    }, actor.userId);
  }

  private async forDecision(tx: Tx, actor: RequestActor, id: string) {
    if (!actor.grants['contract.sign'] && !actor.grants['quote.approve']) throw forbidden('approving change orders requires contract.sign or quote.approve');
    const r = await loadCo(tx, actor, id, 'contract.read');
    if (r.co.status !== 'pending_approval') throw badRequest(`the change order is ${r.co.status}, not pending approval`);
    if (r.co.createdBy === actor.userId && !actor.roleKeys.includes('owner')) throw forbidden('you cannot approve or reject your own change order');
    return r;
  }
}
