import { randomBytes } from 'node:crypto';
import {
  and, asc, billingMilestone, contact, contract, emit, eq, inArray, invoiceMirror, nextNumber, notification, party, paymentMirror, paymentRequest, site, sql, erpLink, type Tx,
} from '@mmc/db';
import { halalasToFixed, riyadhDate, toHalalas, VAT_RATE, type InvoiceTypeCode } from '@mmc/domain';
import type { InvoiceResult, PaymentResult } from '@mmc/erp-connector';
import { audit } from '../common/audit.js';
import { backOffice } from '../common/backoffice.js';
import { loadCompany } from '../common/company.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { sendTemplate } from '../common/messaging.js';
import { payments } from '../common/payments.js';
import { config } from '../config.js';
import type { RequestActor } from '../auth/actor.js';

/** Push the customer to the back office once (and on change); returns its ERP name. */
export async function ensureCustomer(tx: Tx, tenantId: string, partyId: string): Promise<{ erpName: string; b2b: boolean }> {
  const [p] = await tx.select().from(party).where(eq(party.id, partyId));
  if (!p) throw notFound('customer');
  const [s] = await tx.select().from(site).where(and(eq(site.partyId, partyId), eq(site.type, 'billing'))).limit(1);
  const r = await backOffice(tenantId).upsertCustomer({ coreId: p.id, name: p.nameAr, nameEn: p.nameEn, vatNumber: p.vatNumber, crNumber: p.unifiedNumber ?? p.crNumber, b2b: p.b2b, email: p.email, phone: p.phone, address: s ?? null });
  if (p.erpName !== r.erpName) {
    await tx.update(party).set({ erpName: r.erpName }).where(eq(party.id, partyId));
    await tx.insert(erpLink).values({ entityType: 'party', entityId: partyId, erpDoctype: 'Customer', erpName: r.erpName }).onConflictDoUpdate({ target: [erpLink.tenantId, erpLink.entityType, erpLink.entityId, erpLink.erpDoctype], set: { erpName: r.erpName, lastSyncedAt: new Date(), syncStatus: 'synced' } });
  }
  return { erpName: r.erpName, b2b: p.b2b };
}

/** Upsert the Core mirror of a back-office invoice (only the port writes mirrors). */
export async function mirrorInvoice(tx: Tx, inv: InvoiceResult, links: { partyId?: string | null; contractId?: string | null; milestoneId?: string | null; paymentRequestId?: string | null; originalInvoiceId?: string | null }) {
  const values = {
    erpName: inv.erpName, number: inv.number, typeCode: inv.typeCode, subtype: inv.subtype, issueDate: inv.issueDate, dueDate: inv.dueDate,
    taxable: inv.taxable, vatAmount: inv.vat, total: inv.total, prepaidAmount: inv.prepaid, balanceDue: inv.balanceDue, lines: inv.lines as never,
    zatcaUuid: inv.zatcaUuid, zatcaStatus: inv.zatcaStatus, qrPayload: inv.qrPayload, status: inv.status, syncedAt: new Date(),
  };
  const [row] = await tx.insert(invoiceMirror).values({ ...values, partyId: links.partyId ?? null, contractId: links.contractId ?? null, milestoneId: links.milestoneId ?? null, paymentRequestId: links.paymentRequestId ?? null, originalInvoiceId: links.originalInvoiceId ?? null })
    .onConflictDoUpdate({ target: [invoiceMirror.tenantId, invoiceMirror.erpName], set: values }).returning();
  return row!;
}

export async function mirrorPayment(tx: Tx, p: PaymentResult, links: { partyId?: string | null; paymentRequestId?: string | null }) {
  const values = { erpName: p.erpName, amount: p.amount, paidOn: p.paidOn, method: p.method, reference: p.reference, allocations: p.allocations, syncedAt: new Date() };
  const [row] = await tx.insert(paymentMirror).values({ ...values, partyId: links.partyId ?? null, paymentRequestId: links.paymentRequestId ?? null }).onConflictDoUpdate({ target: [paymentMirror.tenantId, paymentMirror.erpName], set: values }).returning();
  return row!;
}

async function contractWithMilestones(tx: Tx, contractId: string) {
  const [c] = await tx.select().from(contract).where(eq(contract.id, contractId));
  if (!c) throw notFound('contract');
  const milestones = await tx.select().from(billingMilestone).where(eq(billingMilestone.contractId, contractId)).orderBy(asc(billingMilestone.sort));
  return { c, milestones };
}

function isFinal(milestones: { id: string; sort: number }[], milestoneId: string) {
  return milestones.length > 0 && milestones[milestones.length - 1]!.id === milestoneId;
}

/**
 * 388 final tax invoice for the whole contract, deducting every 386 issued on it. Idempotent per
 * contract (one final invoice; corrections go through credit notes).
 */
export async function issueFinalInvoice(tx: Tx, actor: RequestActor | null, tenantId: string, contractId: string) {
  const { c } = await contractWithMilestones(tx, contractId);
  const [existing] = await tx.select().from(invoiceMirror).where(and(eq(invoiceMirror.contractId, contractId), eq(invoiceMirror.typeCode, '388'), sql`${invoiceMirror.status} <> 'cancelled'`));
  if (existing) return existing;
  if (!c.partyId) throw badRequest('link the contract to a customer before invoicing');
  if (!['signed', 'active', 'completed'].includes(c.status)) throw badRequest('the contract must be signed before invoicing');
  const co = await loadCompany(tx);
  const customer = await ensureCustomer(tx, tenantId, c.partyId);
  const prepay = await tx.select().from(invoiceMirror).where(and(eq(invoiceMirror.contractId, contractId), eq(invoiceMirror.typeCode, '386'), sql`${invoiceMirror.status} <> 'cancelled'`));
  for (const l of c.lines) await backOffice(tenantId).upsertItem({ coreId: l.code, code: l.code, name: l.description, description: l.description, isStock: l.code !== 'INS', listPrice: l.unitPrice });
  const inv = await backOffice(tenantId).createInvoice({
    idempotencyKey: `final:${contractId}`,
    typeCode: '388',
    customer,
    issueDate: riyadhDate(),
    dueDate: riyadhDate(),
    lines: c.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty, unitPrice: l.unitPrice })),
    discount: c.discountAmount,
    vatRate: co.vatRegistered && c.vatOn ? VAT_RATE : 0,
    prepayments: prepay.map((p) => ({ erpName: p.erpName, total: p.total, vat: p.vatAmount })),
    core: { contractId, contractNumber: c.number },
    remarks: `العقد ${c.number}`,
  });
  const row = await mirrorInvoice(tx, inv, { partyId: c.partyId, contractId });
  await audit(tx, actor, 'issue_388', 'contract', contractId, null, { invoice: inv.number, total: inv.total, prepaid: inv.prepaid, balance: inv.balanceDue });
  await emit(tx, 'invoice', row.id, 'invoice.issued', { number: inv.number, typeCode: '388' });
  return row;
}

export function newToken() {
  return randomBytes(24).toString('base64url');
}

/** Payment request for a milestone. The final milestone first issues the 388 and requests its balance. */
export async function requestMilestone(tx: Tx, actor: RequestActor, milestoneId: string, dueDate?: string | null) {
  const [m] = await tx.select().from(billingMilestone).where(eq(billingMilestone.id, milestoneId));
  if (!m) throw notFound('milestone');
  const { c, milestones } = await contractWithMilestones(tx, m.contractId);
  if (!['signed', 'active', 'completed'].includes(c.status)) throw badRequest('the contract must be signed before requesting payments');
  if (!c.partyId) throw badRequest('link the contract to a customer first');
  const [open] = await tx.select().from(paymentRequest).where(and(eq(paymentRequest.milestoneId, milestoneId), inArray(paymentRequest.status, ['draft', 'sent', 'partially_paid'])));
  if (open) throw conflict(`payment request ${open.number} is already open for this milestone`);
  if (m.status === 'paid') throw badRequest('milestone already paid');
  let amount = toHalalas(m.amount) - toHalalas(m.paidAmount);
  if (isFinal(milestones, milestoneId)) {
    const inv = await issueFinalInvoice(tx, actor, actor.tenantId, c.id);
    amount = toHalalas(inv.balanceDue);
  }
  if (amount <= 0) throw badRequest('nothing left to request on this milestone');
  const { number } = await nextNumber(tx, 'payment_request');
  const token = newToken();
  const due = dueDate ?? m.dueDate ?? riyadhDate();
  const link = await payments().createLink({ amount: halalasToFixed(amount), description: `${c.number} — ${m.nameAr}`, reference: number, returnUrl: `${config.publicBaseUrl}/p/${token}`, publicToken: token });
  const [pr] = await tx.insert(paymentRequest).values({ number, milestoneId, contractId: c.id, partyId: c.partyId, amount: halalasToFixed(amount), dueDate: due, status: 'draft', publicToken: token, paymentLinkUrl: link.url, paymentLinkProviderId: link.providerId, createdBy: actor.userId }).returning();
  await tx.update(billingMilestone).set({ status: 'requested', dueDate: due, updatedAt: new Date() }).where(eq(billingMilestone.id, milestoneId));
  await audit(tx, actor, 'request', 'payment_request', pr!.id, null, { number, amount: halalasToFixed(amount), milestone: m.nameAr });
  return pr!;
}

export async function sendPaymentRequest(tx: Tx, actor: RequestActor | null, prId: string, channel: 'whatsapp' | 'email', to?: string | null, templateKey: 'payment_request' | 'payment_reminder' = 'payment_request') {
  const [pr] = await tx.select().from(paymentRequest).where(eq(paymentRequest.id, prId));
  if (!pr) throw notFound('payment request');
  const [p] = pr.partyId ? await tx.select().from(party).where(eq(party.id, pr.partyId)) : [];
  const [ct] = pr.partyId ? await tx.select().from(contact).where(and(eq(contact.partyId, pr.partyId), eq(contact.isPrimary, true))).limit(1) : [];
  const recipient = to ?? (channel === 'email' ? ct?.email ?? p?.email : ct?.whatsapp ?? ct?.mobile ?? p?.phone);
  if (!recipient) throw badRequest('no recipient on file for this customer');
  const link = `${config.publicBaseUrl}/p/${pr.publicToken}`;
  const due = toHalalas(pr.amount) - toHalalas(pr.paidAmount);
  const r = await sendTemplate(tx, { channel, to: recipient, templateKey, vars: { name: ct?.name ?? p?.nameAr ?? '', number: pr.number, amount: halalasToFixed(due), due: pr.dueDate, link }, subject: `طلب دفع ${pr.number}`, related: { type: 'payment_request', id: pr.id }, link: { partyId: pr.partyId, contactId: ct?.id }, sentBy: actor?.userId ?? null });
  if (pr.status === 'draft') await tx.update(paymentRequest).set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() }).where(eq(paymentRequest.id, prId));
  return r.message;
}

/**
 * Apply a received payment (manual bank transfer, or a payment-gateway webhook): issues the 386
 * prepayment invoice for an advance — or allocates to the 388 for the final milestone — records the
 * payment in the back office and mirrors both. Idempotent on `idempotencyKey`.
 */
export async function applyPayment(tx: Tx, actor: RequestActor | null, tenantId: string, prId: string, p: { amount: string; paidOn: string; method: string; reference?: string | null; idempotencyKey: string }) {
  const [pr] = await tx.select().from(paymentRequest).where(eq(paymentRequest.id, prId));
  if (!pr) throw notFound('payment request');
  if (pr.status === 'paid' || pr.status === 'cancelled') throw badRequest(`payment request is ${pr.status}`);
  const amountH = toHalalas(p.amount);
  const remaining = toHalalas(pr.amount) - toHalalas(pr.paidAmount);
  if (amountH <= 0) throw badRequest('amount must be positive');
  if (amountH > remaining) throw badRequest(`amount exceeds the remaining ${halalasToFixed(remaining)}`);
  const [already] = await tx.select().from(paymentMirror).where(sql`${paymentMirror.reference} = ${p.idempotencyKey} or ${paymentMirror.erpName} = ${p.idempotencyKey}`);
  if (already) return { payment: already, invoice: null, duplicate: true };
  const { c, milestones } = await contractWithMilestones(tx, pr.contractId!);
  const co = await loadCompany(tx);
  const customer = await ensureCustomer(tx, tenantId, pr.partyId!);
  const m = milestones.find((x) => x.id === pr.milestoneId)!;
  let invoice: InvoiceResult | null = null;
  let allocateTo: string;
  if (isFinal(milestones, m.id)) {
    const final = await issueFinalInvoice(tx, actor, tenantId, c.id);
    allocateTo = final.erpName;
  } else {
    // Advance received → VAT is due now → 386 prepayment invoice for exactly what was received.
    const rate = co.vatRegistered && c.vatOn ? VAT_RATE : 0;
    invoice = await backOffice(tenantId).createInvoice({
      idempotencyKey: `adv:${p.idempotencyKey}`,
      typeCode: '386' as InvoiceTypeCode,
      customer,
      issueDate: p.paidOn,
      lines: [{ code: 'ADV', description: `دفعة مقدمة — ${m.nameAr} — العقد ${c.number}`, qty: '1', unitPrice: halalasToFixed(amountH) }],
      vatRate: rate,
      taxInclusive: true,
      core: { contractId: c.id, milestoneId: m.id, paymentRequestId: pr.id, contractNumber: c.number },
      remarks: `${pr.number} / ${p.reference ?? ''}`,
    });
    if (toHalalas(invoice.total) !== amountH) throw new Error(`prepayment invoice total ${invoice.total} ≠ received ${p.amount}`);
    await mirrorInvoice(tx, invoice, { partyId: pr.partyId, contractId: c.id, milestoneId: m.id, paymentRequestId: pr.id });
    allocateTo = invoice.erpName;
  }
  const pay = await backOffice(tenantId).recordPayment({ idempotencyKey: p.idempotencyKey, customerErpName: customer.erpName, amount: halalasToFixed(amountH), paidOn: p.paidOn, method: p.method, reference: p.reference ?? null, allocations: [{ invoiceErpName: allocateTo, amount: halalasToFixed(amountH) }] });
  const payRow = await mirrorPayment(tx, { ...pay, reference: p.idempotencyKey }, { partyId: pr.partyId, paymentRequestId: pr.id });
  // Refresh the allocated invoice's balance from the back office.
  const refreshed = await backOffice(tenantId).getInvoice(allocateTo);
  if (refreshed) await mirrorInvoice(tx, refreshed, { partyId: pr.partyId, contractId: c.id });
  const paid = toHalalas(pr.paidAmount) + amountH;
  const full = paid >= toHalalas(pr.amount);
  await tx.update(paymentRequest).set({ paidAmount: halalasToFixed(paid), status: full ? 'paid' : 'partially_paid', updatedAt: new Date() }).where(eq(paymentRequest.id, pr.id));
  const mPaid = toHalalas(m.paidAmount) + amountH;
  await tx.update(billingMilestone).set({ paidAmount: halalasToFixed(mPaid), status: full ? 'paid' : 'partially_paid', updatedAt: new Date() }).where(eq(billingMilestone.id, m.id));
  if (full && c.status === 'signed' && m.sort === 1) await tx.update(contract).set({ status: 'active', startDate: riyadhDate() }).where(eq(contract.id, c.id));
  await audit(tx, actor, 'payment', 'payment_request', pr.id, null, { amount: halalasToFixed(amountH), method: p.method, reference: p.reference, invoice: invoice?.number ?? allocateTo });
  await emit(tx, 'payment', payRow.id, 'payment.received', { amount: halalasToFixed(amountH), paymentRequest: pr.number });
  if (c.ownerId) await tx.insert(notification).values({ userId: c.ownerId, kind: 'payment', titleAr: `💰 استُلم ${halalasToFixed(amountH)} ريال — ${pr.number} (${c.number})`, link: `/contracts/${c.id}` });
  return { payment: payRow, invoice, duplicate: false };
}
