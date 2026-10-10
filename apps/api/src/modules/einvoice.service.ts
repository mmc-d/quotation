import { randomUUID } from 'node:crypto';
import {
  and, asc, desc, einvoiceDocument, einvoiceEgs, eq, inArray, invoiceMirror, isNull, ledgerSettings, lte, party, site, sql, type Tx,
} from '@mmc/db';
import { dec, halalasToFixed, riyadhDate, riyadhTime, toHalalas, VAT_RATE } from '@mmc/domain';
import {
  GENESIS_PIH, SANDBOX_OTP, buildSignedDocument, createFatooraClient, egsSerial, generateCsr, qrOf, verifySignedDocument,
  ZatcaRejection, ZatcaTransportError,
  type DocKind, type DocLine, type EInvoiceDoc, type FatooraClient, type FetchLike, type Party, type PrepaymentRef, type Subtype, type Verdict, type ZatcaEnvironment,
} from '@mmc/zatca';
import type { RequestActor } from '../auth/actor.js';
import { audit } from '../common/audit.js';
import { loadCompany } from '../common/company.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { tenantTx } from '../common/db.js';
import { open, seal } from '../common/secret-box.js';
import { config } from '../config.js';
import { errorText } from './gl-core.js';

/**
 * ZATCA Phase-2 e-invoicing inside Core (Phase 6D). Flow:
 *
 *   invoice_mirror row (386/388/381/383)  →  issueDocument(): UBL + hash + ECDSA stamp + QR + XAdES,
 *   ICV / PIH from the EGS unit's locked counter (gapless — it rolls back with the invoice)  →
 *   einvoice_document (immutable)  →  submitPending(): clearance (standard) / reporting (simplified)
 *   in ICV order, cleared XML stored, mirror QR replaced by the cleared one.
 *
 * Everything is behind `ledger_settings.einvoice_enabled`, which can only be switched on once the
 * company is VAT-registered with a complete seller identity and an EGS unit holds a PRODUCTION CSID.
 */

type InvoiceRow = typeof invoiceMirror.$inferSelect;
export type EgsRow = typeof einvoiceEgs.$inferSelect;
export type DocumentRow = typeof einvoiceDocument.$inferSelect;

const KIND_OF: Record<string, DocKind> = { '388': 'invoice', '386': 'prepayment', '381': 'credit', '383': 'debit' };
const VAT_NUMBER = /^3\d{13}3$/;

/** The document cannot be built from what Core holds — carries every reason so staff can fix them in one go. */
export class EInvoiceBlocked extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' · '));
    this.name = 'EInvoiceBlocked';
  }
}

// ─────────────────────────────── network seam (tests inject a fake gateway) ───────────────────────────────

let gatewayFetch: FetchLike | undefined;
/** Tests only: route every Fatoora call through `f` (pass undefined to restore the real network). */
export function __setGatewayFetch(f: FetchLike | undefined) {
  gatewayFetch = f;
}
const clientFor = (environment: ZatcaEnvironment): FatooraClient => createFatooraClient({ environment, fetch: gatewayFetch });

// ─────────────────────────────── identities ───────────────────────────────

type CompanyRow = Awaited<ReturnType<typeof loadCompany>>;

/** The seller block ZATCA needs, or what is missing. */
export function sellerOf(co: CompanyRow): { seller: Party & { crn?: string | null }; problems: string[] } {
  const a = co.address ?? {};
  const problems: string[] = [];
  if (!co.vatRegistered) problems.push('the company is not VAT-registered');
  if (!co.vatNumber || !VAT_NUMBER.test(co.vatNumber)) problems.push('company VAT number must be 15 digits starting and ending with 3');
  if (!co.crNumber && !co.unifiedNumber) problems.push('company commercial registration (or 700 unified number) is missing');
  if (!a.street) problems.push('company street is missing');
  if (!a.buildingNumber || !/^\d{4}$/.test(a.buildingNumber)) problems.push('company building number must be 4 digits');
  if (!a.district) problems.push('company district is missing');
  if (!a.city) problems.push('company city is missing');
  if (!a.postalCode || !/^\d{5}$/.test(a.postalCode)) problems.push('company postal code must be 5 digits');
  if (a.additionalNumber && !/^\d{4}$/.test(a.additionalNumber)) problems.push('company additional number must be 4 digits');
  const crn = co.crNumber ?? null;
  return {
    seller: {
      name: co.legalNameAr,
      vatNumber: co.vatNumber,
      otherId: crn ?? co.unifiedNumber ?? null,
      schemeId: crn ? 'CRN' : '700',
      crn,
      address: { street: a.street, buildingNumber: a.buildingNumber, additionalNumber: a.additionalNumber, district: a.district, city: a.city, postalCode: a.postalCode, country: a.country || 'SA' },
    },
    problems,
  };
}

async function buyerOf(tx: Tx, partyId: string | null, subtype: Subtype): Promise<{ buyer: Party | null; problems: string[] }> {
  const problems: string[] = [];
  if (!partyId) {
    if (subtype === 'standard') problems.push('the invoice has no customer');
    return { buyer: null, problems };
  }
  const [p] = await tx.select().from(party).where(eq(party.id, partyId));
  if (!p) return { buyer: null, problems: ['customer not found'] };
  const [s] = await tx.select().from(site).where(and(eq(site.partyId, partyId), eq(site.type, 'billing'))).limit(1);
  const buyer: Party = {
    name: p.nameAr,
    vatNumber: p.vatNumber && VAT_NUMBER.test(p.vatNumber) ? p.vatNumber : null,
    otherId: p.crNumber ?? p.unifiedNumber ?? null,
    schemeId: p.crNumber ? 'CRN' : p.unifiedNumber ? '700' : null,
    address: s ? { street: s.street, buildingNumber: s.buildingNumber, additionalNumber: s.additionalNumber, district: s.district, city: s.city, postalCode: s.postalCode, country: 'SA' } : null,
  };
  if (subtype === 'standard') {
    const who = `customer «${p.nameAr}»`;
    if (p.vatNumber && !VAT_NUMBER.test(p.vatNumber)) problems.push(`${who}: VAT number must be 15 digits starting and ending with 3`);
    if (!buyer.vatNumber && !buyer.otherId) problems.push(`${who}: VAT number or commercial registration is required on a standard invoice`);
    const a = buyer.address ?? {};
    if (!a.street) problems.push(`${who}: billing street is missing`);
    if (!a.buildingNumber || !/^\d{4}$/.test(a.buildingNumber)) problems.push(`${who}: billing building number must be 4 digits`);
    if (!a.district) problems.push(`${who}: billing district is missing`);
    if (!a.city) problems.push(`${who}: billing city is missing`);
    if (!a.postalCode || !/^\d{5}$/.test(a.postalCode)) problems.push(`${who}: billing postal code must be 5 digits`);
  }
  return { buyer, problems };
}

// ─────────────────────────────── building a document from an invoice ───────────────────────────────

interface MirrorLine { code?: string; description?: string; qty: string; unitPrice: string; net: string; vat: string; total: string }
const abs = (v: string) => (v.startsWith('-') ? v.slice(1) : v);
const fixed = (h: number) => halalasToFixed(Math.abs(h));

type BuiltDoc = Omit<EInvoiceDoc, 'icv' | 'pih' | 'uuid' | 'issueDate' | 'issueTime'>;

async function buildFromInvoice(tx: Tx, inv: InvoiceRow, co: CompanyRow, opts: { zeroRatedReason?: string; zeroRatedReasonText?: string; paymentMeansCode?: string }): Promise<BuiltDoc> {
  const kind = KIND_OF[inv.typeCode];
  if (!kind) throw new EInvoiceBlocked([`document type ${inv.typeCode} is not an e-invoice type`]);
  const subtype: Subtype = inv.subtype === 'simplified' ? 'simplified' : 'standard';
  const problems: string[] = [];
  const { seller, problems: sp } = sellerOf(co);
  problems.push(...sp);
  const { buyer, problems: bp } = await buyerOf(tx, inv.partyId, subtype);
  problems.push(...bp);

  const zero = toHalalas(inv.vatAmount) === 0;
  if (zero && !opts.zeroRatedReason) problems.push('this invoice has no VAT: set the zero-rating reason (VATEX-SA-… code) in the e-invoice settings');
  const src = (inv.lines ?? []) as MirrorLine[];
  if (!src.length) problems.push('the invoice has no lines');

  const lines: DocLine[] = src.map((l, i) => {
    const net = toHalalas(abs(l.net));
    const gross = dec(l.qty).times(l.unitPrice).times(100).toDecimalPlaces(0).toNumber();
    const discount = Math.max(0, gross - net);
    return {
      name: String(l.description || l.code || `line ${i + 1}`),
      quantity: String(l.qty),
      unitPrice: halalasToFixed(toHalalas(abs(String(l.unitPrice)))),
      net: fixed(net),
      discount: discount ? fixed(discount) : undefined,
      vat: fixed(toHalalas(abs(l.vat))),
      rate: zero ? 0 : VAT_RATE,
      category: zero ? 'Z' : 'S',
      exemptionReasonCode: zero ? opts.zeroRatedReason ?? null : null,
      exemptionReason: zero ? opts.zeroRatedReasonText ?? 'Zero-rated supply' : null,
    };
  });

  // 388 final invoice: every advance (386) it deducts is carried as a zero line with its reference.
  let prepayments: PrepaymentRef[] | undefined;
  if (kind === 'invoice' && toHalalas(inv.prepaidAmount) > 0) {
    const advances = inv.contractId
      ? await tx.select().from(invoiceMirror).where(and(eq(invoiceMirror.contractId, inv.contractId), eq(invoiceMirror.typeCode, '386'), sql`${invoiceMirror.status} <> 'cancelled'`, lte(invoiceMirror.createdAt, inv.createdAt))).orderBy(asc(invoiceMirror.issueDate), asc(invoiceMirror.number))
      : [];
    const sum = advances.reduce((s, a) => s + toHalalas(a.total), 0);
    if (!advances.length || sum !== toHalalas(inv.prepaidAmount)) {
      problems.push(`the advances found (${halalasToFixed(sum)}) do not add up to the amount deducted on the invoice (${inv.prepaidAmount})`);
    } else {
      const docs = await tx.select({ invoiceId: einvoiceDocument.invoiceId, uuid: einvoiceDocument.uuid, issueDate: einvoiceDocument.issueDate, issueTime: einvoiceDocument.issueTime })
        .from(einvoiceDocument).where(and(inArray(einvoiceDocument.invoiceId, advances.map((a) => a.id)), isNull(einvoiceDocument.supersededAt)));
      prepayments = advances.map((a) => {
        const d = docs.find((x) => x.invoiceId === a.id);
        return {
          number: a.number,
          uuid: d?.uuid ?? a.zatcaUuid ?? randomUUID(),
          issueDate: d?.issueDate ?? a.issueDate,
          issueTime: d?.issueTime ?? '00:00:00',
          net: fixed(toHalalas(a.taxable)),
          vat: fixed(toHalalas(a.vatAmount)),
          rate: toHalalas(a.vatAmount) === 0 ? 0 : VAT_RATE,
          category: toHalalas(a.vatAmount) === 0 ? 'Z' : 'S',
          exemptionReasonCode: toHalalas(a.vatAmount) === 0 ? opts.zeroRatedReason ?? null : null,
          exemptionReason: toHalalas(a.vatAmount) === 0 ? opts.zeroRatedReasonText ?? 'Zero-rated supply' : null,
        };
      });
    }
  }

  let billingReference: BuiltDoc['billingReference'] = null;
  if (kind === 'credit' || kind === 'debit') {
    const [orig] = inv.originalInvoiceId ? await tx.select({ number: invoiceMirror.number }).from(invoiceMirror).where(eq(invoiceMirror.id, inv.originalInvoiceId)) : [];
    if (!orig) problems.push('a credit / debit note must reference the invoice it corrects');
    else billingReference = { number: orig.number, reason: inv.adjustmentReason || 'Adjustment to a previously issued invoice' };
  }

  if (problems.length) throw new EInvoiceBlocked(problems);
  return { kind, subtype, number: inv.number, supplyDate: inv.issueDate, currency: inv.currency || 'SAR', seller, buyer, lines, prepayments, billingReference, paymentMeansCode: opts.paymentMeansCode || '1' };
}

// ─────────────────────────────── EGS units ───────────────────────────────

export async function activeUnit(tx: Tx, lock = false): Promise<EgsRow | null> {
  const q = tx.select().from(einvoiceEgs).where(eq(einvoiceEgs.status, 'production')).orderBy(desc(einvoiceEgs.liveFrom)).limit(1);
  const [u] = lock ? await q.for('update') : await q;
  return u ?? null;
}

/** What the API may show of a unit — never the key, CSIDs or secrets. */
export const unitView = (u: EgsRow) => ({
  id: u.id, name: u.name, environment: u.environment, serial: u.serial, status: u.status, icvCounter: u.icvCounter, lastPih: u.lastPih,
  liveFrom: u.liveFrom, hasKey: Boolean(u.privateKeyEnc), hasComplianceCsid: Boolean(u.complianceCsidEnc), hasProductionCsid: Boolean(u.csidEnc),
  complianceResults: u.complianceResults, createdAt: u.createdAt,
});

export async function createUnit(tx: Tx, actor: RequestActor, b: { name: string; environment: 'simulation' | 'production' }) {
  const [u] = await tx.insert(einvoiceEgs).values({ name: b.name, environment: b.environment, serial: egsSerial({ uuid: randomUUID() }), createdBy: actor.userId }).returning();
  await audit(tx, actor, 'create', 'einvoice_egs', u!.id, null, { name: b.name, environment: b.environment });
  return u!;
}

async function unitById(tx: Tx, id: string, lock = false): Promise<EgsRow> {
  const q = tx.select().from(einvoiceEgs).where(eq(einvoiceEgs.id, id));
  const [u] = lock ? await q.for('update') : await q;
  if (!u) throw notFound('EGS unit');
  return u;
}

/** Step 1a (persisted before any network call): mint the key and CSR for the unit. */
export async function prepareCsr(tx: Tx, actor: RequestActor, unitId: string) {
  const u = await unitById(tx, unitId, true);
  if (u.status === 'revoked') throw conflict('this unit is revoked');
  if (u.status === 'production') throw conflict('this unit is already live');
  const co = await loadCompany(tx);
  const { seller, problems } = sellerOf(co);
  if (problems.length) throw badRequest(`complete the company profile first: ${problems.join(' · ')}`);
  const a = seller.address ?? {};
  const serial = u.serial ?? egsSerial({ uuid: u.id });
  const { csrPem, privateKeyPem } = generateCsr({
    environment: u.environment as ZatcaEnvironment,
    // an existing key is reused: re-keying a unit that has already signed would orphan its documents
    privateKeyPem: u.privateKeyEnc ? open(u.privateKeyEnc) : undefined,
    commonName: `${serial.split('|')[0]!.replace('1-', '')}-${co.vatNumber}`,
    serialNumber: serial,
    organizationIdentifier: co.vatNumber!,
    organizationUnitName: u.name,
    organizationName: co.legalNameAr,
    locationAddress: [a.buildingNumber, a.street, a.district, a.city].filter(Boolean).join(' '),
    businessCategory: 'Trading',
    invoiceType: '1100',
  });
  await tx.update(einvoiceEgs).set({ privateKeyEnc: seal(privateKeyPem), csr: csrPem, serial, status: 'csr_generated', updatedAt: new Date(), updatedBy: actor.userId }).where(eq(einvoiceEgs.id, u.id));
  return { csr: csrPem, environment: u.environment as ZatcaEnvironment };
}

/** Step 1b: the OTP is single-use — call exactly once, never from a retry queue. */
export async function exchangeCsr(csr: string, environment: ZatcaEnvironment, otp: string) {
  return clientFor(environment).requestComplianceCsid(csr, otp);
}

export async function storeComplianceCsid(tx: Tx, actor: RequestActor, unitId: string, c: { requestId: string; csid: string; secret: string; certificatePem: string }) {
  await tx.update(einvoiceEgs).set({
    complianceRequestId: c.requestId, complianceCsidEnc: seal(c.csid), complianceSecretEnc: seal(c.secret), complianceCertificate: c.certificatePem,
    status: 'compliance_csid', updatedAt: new Date(), updatedBy: actor.userId,
  }).where(eq(einvoiceEgs.id, unitId));
  await audit(tx, actor, 'compliance_csid', 'einvoice_egs', unitId, null, { requestId: c.requestId });
}

const COMPLIANCE_MATRIX: { subtype: Subtype; kind: DocKind }[] = [
  { subtype: 'standard', kind: 'invoice' }, { subtype: 'standard', kind: 'credit' }, { subtype: 'standard', kind: 'debit' },
  { subtype: 'simplified', kind: 'invoice' }, { subtype: 'simplified', kind: 'credit' }, { subtype: 'simplified', kind: 'debit' },
];

/** A minimal valid document for a compliance check, built by the production signing path. */
function complianceDoc(spec: { subtype: Subtype; kind: DocKind }, seller: BuiltDoc['seller'], icv: number, pih: string): EInvoiceDoc {
  const now = new Date();
  return {
    kind: spec.kind, subtype: spec.subtype,
    number: `COMPLY-${spec.subtype.slice(0, 3).toUpperCase()}-${spec.kind.slice(0, 3).toUpperCase()}-${icv}`,
    uuid: randomUUID(), issueDate: riyadhDate(now), issueTime: riyadhTime(now), icv, pih, currency: 'SAR', seller,
    // a standard document is rejected without a full buyer
    buyer: spec.subtype === 'standard'
      ? { name: 'ZATCA Compliance Buyer', vatNumber: '399999999800003', address: { street: 'King Fahd Rd', buildingNumber: '1234', additionalNumber: '5678', district: 'Olaya', city: 'Riyadh', postalCode: '12345', country: 'SA' } }
      : null,
    billingReference: spec.kind === 'invoice' ? null : { number: 'COMPLY-INV-1', reason: 'compliance check' },
    lines: [{ name: 'Compliance check item', quantity: '1', unitPrice: '869.57', net: '869.57', vat: '130.43', rate: 15, category: 'S' }],
    paymentMeansCode: '10',
  };
}

export interface ComplianceOutcome { kind: string; subtype: string; accepted: boolean; errors: string[]; warnings: string[] }

/**
 * Step 2: ZATCA must accept all six documents (standard + simplified × invoice / credit / debit)
 * before it issues a production CSID. They advance a throwaway chain from the genesis and are
 * signed with the COMPLIANCE certificate — they never touch the unit's live counter.
 */
export async function runCompliance(tx: Tx, actor: RequestActor, unitId: string) {
  const u = await unitById(tx, unitId, true);
  if (!u.complianceCsidEnc || !u.complianceSecretEnc || !u.privateKeyEnc || !u.complianceCertificate) throw badRequest('request the compliance CSID first (CSR + OTP)');
  const co = await loadCompany(tx);
  const { seller, problems } = sellerOf(co);
  if (problems.length) throw badRequest(`complete the company profile first: ${problems.join(' · ')}`);
  const client = clientFor(u.environment as ZatcaEnvironment);
  const creds = { csid: open(u.complianceCsidEnc), secret: open(u.complianceSecretEnc) };
  const keys = { privateKeyPem: open(u.privateKeyEnc), certificatePem: u.complianceCertificate };
  const results: ComplianceOutcome[] = [];
  let pih = GENESIS_PIH;
  let icv = 0;
  for (const spec of COMPLIANCE_MATRIX) {
    icv += 1;
    const doc = complianceDoc(spec, seller, icv, pih);
    const signed = buildSignedDocument(doc, keys);
    const v = await client.submitComplianceInvoice(creds, { invoiceHash: signed.hashBase64, uuid: doc.uuid, xml: signed.xml });
    results.push({ kind: spec.kind, subtype: spec.subtype, accepted: v.accepted, errors: v.errors.map((e) => String(e.code ?? e.message)), warnings: v.warnings.map((w) => String(w.code ?? w.message)) });
    if (v.accepted) pih = signed.hashBase64;
  }
  const passed = results.every((r) => r.accepted);
  await tx.update(einvoiceEgs).set({ complianceResults: results, status: passed ? 'compliance_passed' : u.status, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(einvoiceEgs.id, u.id));
  await audit(tx, actor, 'compliance_run', 'einvoice_egs', u.id, null, { passed, results });
  return { passed, results };
}

/** Step 3: trade a passed compliance run for the production CSID — the only thing that makes the unit live. */
export async function requestProduction(tx: Tx, actor: RequestActor, unitId: string) {
  const u = await unitById(tx, unitId, true);
  if (u.status !== 'compliance_passed') throw badRequest('ZATCA issues a production CSID only after the compliance checks pass');
  if (!u.complianceCsidEnc || !u.complianceSecretEnc || !u.complianceRequestId) throw badRequest('missing compliance credentials');
  const other = await activeUnit(tx);
  if (other && other.id !== u.id) throw conflict(`unit «${other.name}» is already live — revoke it before promoting another`);
  const p = await clientFor(u.environment as ZatcaEnvironment).requestProductionCsid({ csid: open(u.complianceCsidEnc), secret: open(u.complianceSecretEnc) }, u.complianceRequestId);
  await tx.update(einvoiceEgs).set({
    csidEnc: seal(p.csid), csidSecretEnc: seal(p.secret), certificate: p.certificatePem, status: 'production', liveFrom: new Date(),
    // the unit legally begins here: ICV 1 chained from the genesis PIH
    icvCounter: 0, lastPih: GENESIS_PIH, updatedAt: new Date(), updatedBy: actor.userId,
  }).where(eq(einvoiceEgs.id, u.id));
  await audit(tx, actor, 'production_csid', 'einvoice_egs', u.id, null, { requestId: p.requestId, environment: u.environment });
  return { requestId: p.requestId };
}

export async function revokeUnit(tx: Tx, actor: RequestActor, unitId: string, reason: string) {
  const u = await unitById(tx, unitId, true);
  await tx.update(einvoiceEgs).set({ status: 'revoked', updatedAt: new Date(), updatedBy: actor.userId }).where(eq(einvoiceEgs.id, u.id));
  await audit(tx, actor, 'revoke', 'einvoice_egs', u.id, { status: u.status }, { status: 'revoked' }, reason);
}

/**
 * Rehearsal: runs the whole ladder against ZATCA's SANDBOX with its published OTP and test taxpayer.
 * Writes nothing and consumes nothing; proves the documents this engine issues pass ZATCA's validator.
 * It cannot prove this company is onboarded — sandbox certificates carry ZATCA's test identity.
 */
export async function selfTest() {
  const seller = {
    name: 'Maximum Speed Tech Supply LTD', vatNumber: '399999999900003', otherId: '1010010000', schemeId: 'CRN', crn: '1010010000',
    address: { street: 'Prince Sultan', buildingNumber: '2322', additionalNumber: '9999', district: 'Al-Murabba', city: 'Riyadh', postalCode: '23333', country: 'SA' },
  };
  const client = clientFor('sandbox');
  const { csrPem, privateKeyPem } = generateCsr({
    environment: 'sandbox', commonName: `TST-886431145-${seller.vatNumber}`, serialNumber: egsSerial({ uuid: randomUUID() }),
    organizationIdentifier: seller.vatNumber, organizationUnitName: 'Head office', organizationName: seller.name, locationAddress: 'RRRD2929', businessCategory: 'Trading',
  });
  const c = await client.requestComplianceCsid(csrPem, SANDBOX_OTP);
  const documents: ComplianceOutcome[] = [];
  let pih = GENESIS_PIH;
  let icv = 0;
  for (const spec of COMPLIANCE_MATRIX) {
    icv += 1;
    const doc = complianceDoc(spec, seller, icv, pih);
    const signed = buildSignedDocument(doc, { privateKeyPem, certificatePem: c.certificatePem });
    const v = await client.submitComplianceInvoice({ csid: c.csid, secret: c.secret }, { invoiceHash: signed.hashBase64, uuid: doc.uuid, xml: signed.xml });
    documents.push({ kind: spec.kind, subtype: spec.subtype, accepted: v.accepted, errors: v.errors.map((e) => String(e.code ?? e.message)), warnings: v.warnings.map((w) => String(w.code ?? w.message)) });
    if (v.accepted) pih = signed.hashBase64;
  }
  const passed = documents.every((d) => d.accepted);
  let productionCsid = false;
  if (passed) productionCsid = Boolean((await client.requestProductionCsid({ csid: c.csid, secret: c.secret }, c.requestId)).csid);
  return { environment: 'sandbox' as const, documents, productionCsid, passed: passed && productionCsid, testedAt: new Date().toISOString() };
}

// ─────────────────────────────── issuing ───────────────────────────────

export type IssueOutcome =
  | { status: 'issued'; documentId: string; icv: number }
  | { status: 'skipped'; reason: 'disabled' | 'no-unit' | 'not-applicable' | 'exists' }
  | { status: 'blocked'; problems: string[] };

async function settingsOf(tx: Tx) {
  const [s] = await tx.select({ enabled: ledgerSettings.einvoiceEnabled, options: ledgerSettings.einvoiceOptions }).from(ledgerSettings).limit(1);
  return { enabled: s?.enabled ?? false, options: s?.options ?? {} };
}

/**
 * Sign and store the e-invoice document for one invoice mirror. Runs inside the caller's
 * transaction: the unit row is locked FOR UPDATE, so ICV / PIH are gapless under concurrency, and an
 * invoice that rolls back gives its counter value back.
 */
export async function issueDocument(tx: Tx, invoiceId: string, opts: { newUuid?: boolean } = {}): Promise<IssueOutcome> {
  const { enabled, options } = await settingsOf(tx);
  if (!enabled) return { status: 'skipped', reason: 'disabled' };
  const unit = await activeUnit(tx, true);
  if (!unit || !unit.privateKeyEnc || !unit.certificate) return { status: 'skipped', reason: 'no-unit' };
  const [inv] = await tx.select().from(invoiceMirror).where(eq(invoiceMirror.id, invoiceId));
  if (!inv) throw notFound('invoice');
  if (!KIND_OF[inv.typeCode] || inv.status === 'cancelled' || inv.zatcaStatus === 'not_applicable') return { status: 'skipped', reason: 'not-applicable' };
  const [existing] = await tx.select({ id: einvoiceDocument.id }).from(einvoiceDocument).where(and(eq(einvoiceDocument.invoiceId, invoiceId), isNull(einvoiceDocument.supersededAt)));
  if (existing) return { status: 'skipped', reason: 'exists' };

  let built: BuiltDoc;
  try {
    built = await buildFromInvoice(tx, inv, await loadCompany(tx), options);
  } catch (e) {
    if (!(e instanceof EInvoiceBlocked)) throw e;
    // No document → no honest QR and no "cleared": the back office's Phase-1 values must not look like a stamp.
    await tx.update(invoiceMirror).set({ einvoiceError: e.problems.join(' · ').slice(0, 2000), zatcaStatus: 'error', qrPayload: null }).where(eq(invoiceMirror.id, invoiceId));
    return { status: 'blocked', problems: e.problems };
  }

  const icv = unit.icvCounter + 1;
  const pih = unit.lastPih ?? GENESIS_PIH;
  const now = new Date();
  const uuid = !opts.newUuid && inv.zatcaUuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inv.zatcaUuid) ? inv.zatcaUuid : randomUUID();
  const doc: EInvoiceDoc = { ...built, uuid, icv, pih, issueDate: inv.issueDate, issueTime: riyadhTime(now) };
  const signed = buildSignedDocument(doc, { privateKeyPem: open(unit.privateKeyEnc), certificatePem: unit.certificate });

  const [row] = await tx.insert(einvoiceDocument).values({
    egsId: unit.id, invoiceId, number: inv.number, typeCode: inv.typeCode, subtype: built.subtype, icv, uuid, pih, invoiceHash: signed.hashBase64,
    issueDate: inv.issueDate, issueTime: doc.issueTime, xml: signed.xml, qr: signed.qr, submission: built.subtype === 'standard' ? 'clearance' : 'reporting', status: 'pending',
  }).returning({ id: einvoiceDocument.id });
  await tx.update(einvoiceEgs).set({ icvCounter: icv, lastPih: signed.hashBase64, updatedAt: now }).where(eq(einvoiceEgs.id, unit.id));
  // The mirror now carries the Phase-2 identity: UUID, QR with tags 1–9 and a "pending" status
  // (replaced by the cleared QR once ZATCA stamps a standard invoice).
  await tx.update(invoiceMirror).set({ zatcaUuid: uuid, zatcaStatus: 'pending', qrPayload: signed.qr, einvoiceError: null }).where(eq(invoiceMirror.id, invoiceId));
  return { status: 'issued', documentId: row!.id, icv };
}

/**
 * The Phase-2 identity of an invoice (UUID, status, QR) — what the mirror must keep when the back
 * office re-sends the invoice after a payment (its own Phase-1 QR and "cleared" must not win).
 */
export async function phase2Fields(tx: Tx, invoiceId: string): Promise<{ zatcaUuid: string; zatcaStatus: string; qrPayload: string } | null> {
  const [d] = await tx.select({ uuid: einvoiceDocument.uuid, status: einvoiceDocument.status, qr: einvoiceDocument.qr, clearedXml: einvoiceDocument.clearedXml })
    .from(einvoiceDocument).where(and(eq(einvoiceDocument.invoiceId, invoiceId), isNull(einvoiceDocument.supersededAt)));
  if (!d) return null;
  return { zatcaUuid: d.uuid, zatcaStatus: d.status, qrPayload: (d.clearedXml ? qrOf(d.clearedXml) : null) ?? d.qr };
}

/** Best-effort, in its own savepoint: e-invoicing problems never fail the business action. */
export async function tryIssue(tx: Tx, invoiceId: string): Promise<void> {
  try {
    await tx.transaction((sp) => issueDocument(sp, invoiceId));
  } catch (e) {
    console.warn(`[einvoice] ${invoiceId}:`, errorText(e));
  }
}

/** Invoices that should have a document but do not (built before the unit went live, or blocked until fixed). */
export async function issueMissing(tx: Tx, limit = 50) {
  const { enabled } = await settingsOf(tx);
  const unit = enabled ? await activeUnit(tx) : null;
  if (!unit) return { issued: 0, blocked: 0, skipped: 0, items: [] as { number: string; problems: string[] }[] };
  const rows = await tx.select({ id: invoiceMirror.id, number: invoiceMirror.number }).from(invoiceMirror).where(and(
    inArray(invoiceMirror.typeCode, ['386', '388', '381', '383']), sql`${invoiceMirror.status} <> 'cancelled'`, sql`${invoiceMirror.einvoiceError} is not null`,
    sql`not exists (select 1 from einvoice_document d where d.invoice_id = ${invoiceMirror.id} and d.superseded_at is null)`,
  )).orderBy(asc(invoiceMirror.issueDate), asc(invoiceMirror.number)).limit(limit);
  const out = { issued: 0, blocked: 0, skipped: 0, items: [] as { number: string; problems: string[] }[] };
  for (const r of rows) {
    const o = await tx.transaction((sp) => issueDocument(sp, r.id));
    if (o.status === 'issued') out.issued++;
    else if (o.status === 'blocked') { out.blocked++; out.items.push({ number: r.number, problems: o.problems }); } else out.skipped++;
  }
  return out;
}

/** A rejected document is replaced by a fresh one (new ICV, new UUID) once the cause is fixed. */
export async function reissueRejected(tx: Tx, actor: RequestActor, documentId: string) {
  const [d] = await tx.select().from(einvoiceDocument).where(eq(einvoiceDocument.id, documentId)).for('update');
  if (!d) throw notFound('e-invoice document');
  if (d.status !== 'rejected') throw badRequest('only a rejected document can be re-issued');
  if (d.supersededAt) throw conflict('this document was already replaced');
  await tx.update(einvoiceDocument).set({ supersededAt: new Date() }).where(eq(einvoiceDocument.id, d.id));
  const o = await issueDocument(tx, d.invoiceId, { newUuid: true });
  if (o.status !== 'issued') {
    // nothing replaced it: put the rejected row back as the current one
    await tx.update(einvoiceDocument).set({ supersededAt: null }).where(eq(einvoiceDocument.id, d.id));
    throw badRequest(o.status === 'blocked' ? o.problems.join(' · ') : `could not re-issue (${o.reason})`);
  }
  await audit(tx, actor, 'reissue', 'einvoice_document', d.id, { status: 'rejected', icv: d.icv }, { documentId: o.documentId, icv: o.icv });
  return o;
}

// ─────────────────────────────── submission ───────────────────────────────

export interface SubmitSummary { attempted: number; cleared: number; reported: number; rejected: number; failed: number; busy?: boolean; stoppedBy?: string }

/**
 * Send documents to ZATCA in ICV order: standard → clearance, simplified → reporting (within 24 h).
 * One transaction per document; a tenant-level advisory lock keeps two workers from interleaving.
 * A transport failure stops the run (the chain order is preserved on the next one); a permanent
 * rejection is recorded and the run continues.
 */
export async function submitPending(tenantId: string, limit = 25): Promise<SubmitSummary> {
  const sum: SubmitSummary = { attempted: 0, cleared: 0, reported: 0, rejected: 0, failed: 0 };
  for (let n = 0; n < limit; n++) {
    const step = await tenantTx(tenantId, async (tx) => {
      const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${`einvoice-submit:${tenantId}`})) as ok`);
      if (!lock?.ok) return 'busy' as const;
      const [d] = await tx.select().from(einvoiceDocument).where(and(inArray(einvoiceDocument.status, ['pending', 'error']), isNull(einvoiceDocument.supersededAt))).orderBy(asc(einvoiceDocument.icv)).limit(1).for('update');
      if (!d) return 'done' as const;
      const [unit] = await tx.select().from(einvoiceEgs).where(eq(einvoiceEgs.id, d.egsId));
      if (!unit?.csidEnc || !unit.csidSecretEnc || unit.status !== 'production') return 'done' as const;
      sum.attempted++;
      let v: Verdict;
      try {
        v = await clientFor(unit.environment as ZatcaEnvironment).submitInvoice({ csid: open(unit.csidEnc), secret: open(unit.csidSecretEnc) }, { invoiceHash: d.invoiceHash, uuid: d.uuid, xml: d.xml, standard: d.submission === 'clearance' });
      } catch (e) {
        if (!(e instanceof ZatcaTransportError)) throw e;
        await tx.update(einvoiceDocument).set({ status: 'error', attempts: d.attempts + 1, lastError: errorText(e), updatedAt: new Date() }).where(eq(einvoiceDocument.id, d.id));
        await tx.update(invoiceMirror).set({ zatcaStatus: 'error' }).where(eq(invoiceMirror.id, d.invoiceId));
        sum.failed++;
        sum.stoppedBy = errorText(e);
        return 'stop' as const;
      }
      const response = { httpStatus: v.httpStatus, reportingStatus: v.reportingStatus, clearanceStatus: v.clearanceStatus, warnings: v.warnings, errors: v.errors, clearanceDisabled: v.clearanceDisabled ?? false, at: new Date().toISOString() };
      if (!v.accepted) {
        await tx.update(einvoiceDocument).set({ status: 'rejected', attempts: d.attempts + 1, lastError: v.errors.map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join(' · ').slice(0, 1000) || `HTTP ${v.httpStatus}`, zatcaResponse: response, submittedAt: new Date(), updatedAt: new Date() }).where(eq(einvoiceDocument.id, d.id));
        await tx.update(invoiceMirror).set({ zatcaStatus: 'rejected' }).where(eq(invoiceMirror.id, d.invoiceId));
        sum.rejected++;
        return 'next' as const;
      }
      const cleared = d.submission === 'clearance' && !v.clearanceDisabled && v.clearanceStatus !== null;
      const status = cleared ? 'cleared' : 'reported';
      await tx.update(einvoiceDocument).set({ status, attempts: d.attempts + 1, lastError: null, zatcaResponse: response, submittedAt: new Date(), clearedXml: v.clearedInvoiceXml ?? null, updatedAt: new Date() }).where(eq(einvoiceDocument.id, d.id));
      // once cleared the stamped document is the legal one — its QR replaces ours on the printed invoice
      const stampedQr = v.clearedInvoiceXml ? qrOf(v.clearedInvoiceXml) : null;
      await tx.update(invoiceMirror).set({ zatcaStatus: status, ...(stampedQr ? { qrPayload: stampedQr } : {}) }).where(eq(invoiceMirror.id, d.invoiceId));
      if (cleared) sum.cleared++; else sum.reported++;
      return 'next' as const;
    });
    if (step === 'busy') { sum.busy = true; break; }
    if (step === 'done' || step === 'stop') break;
  }
  return sum;
}

/**
 * Standard (B2B) invoices may not be shared with the customer until ZATCA has cleared them. Returns
 * the subset of `ids` that has a clearance document which is not (yet) cleared.
 */
export async function awaitingClearance(tx: Tx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await tx.select({ invoiceId: einvoiceDocument.invoiceId }).from(einvoiceDocument).where(and(
    inArray(einvoiceDocument.invoiceId, ids), isNull(einvoiceDocument.supersededAt), eq(einvoiceDocument.submission, 'clearance'), sql`${einvoiceDocument.status} <> 'cleared'`,
  ));
  // an invoice that could not even be turned into an e-invoice (customer data missing) is not shareable either
  const held = await tx.select({ id: invoiceMirror.id }).from(invoiceMirror).where(and(
    inArray(invoiceMirror.id, ids), sql`${invoiceMirror.einvoiceError} is not null`, eq(invoiceMirror.subtype, 'standard'),
  ));
  return new Set([...rows.map((r) => r.invoiceId), ...held.map((r) => r.id)]);
}

// ─────────────────────────────── status & checks ───────────────────────────────

export async function readiness(tx: Tx) {
  const co = await loadCompany(tx);
  const { problems } = sellerOf(co);
  const unit = await activeUnit(tx);
  return [
    { key: 'registered', ok: co.vatRegistered, message: 'The company is VAT-registered' },
    { key: 'identity', ok: problems.filter((p) => !p.includes('not VAT-registered')).length === 0, message: problems.filter((p) => !p.includes('not VAT-registered')).join(' · ') || 'Seller identity and national address are complete' },
    { key: 'erpnext', ok: !config.erpnext.url, message: config.erpnext.url ? 'ERPNext is configured as the ZATCA engine — Core cannot also sign invoices' : 'Core is the invoicing engine (no ERPNext)' },
    { key: 'unit', ok: Boolean(unit), message: unit ? `Production unit «${unit.name}» (${unit.environment})` : 'No EGS unit holds a production CSID yet — onboard one' },
  ];
}

export async function einvoiceOverview(tx: Tx) {
  const { enabled, options } = await settingsOf(tx);
  const units = await tx.select().from(einvoiceEgs).orderBy(desc(einvoiceEgs.createdAt));
  const counts = await tx.execute<{ status: string; n: number }>(sql`select status, count(*)::int as n from einvoice_document where superseded_at is null group by status`);
  const [blocked] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from invoice_mirror where einvoice_error is not null and status <> 'cancelled'`);
  return {
    enabled, options, ready: (await readiness(tx)).every((r) => r.ok), checks: await readiness(tx),
    units: units.map(unitView),
    documents: Object.fromEntries(counts.map((r) => [r.status, r.n])),
    blockedInvoices: blocked?.n ?? 0,
  };
}

export async function setEnabled(tx: Tx, actor: RequestActor, b: { enabled: boolean; zeroRatedReason?: string | null; zeroRatedReasonText?: string | null; paymentMeansCode?: string | null }) {
  const [cur] = await tx.select().from(ledgerSettings).limit(1);
  if (!cur) throw badRequest('open the accounting module once to create the ledger settings');
  if (b.enabled) {
    const bad = (await readiness(tx)).filter((r) => !r.ok);
    if (bad.length) throw badRequest(`cannot enable e-invoicing: ${bad.map((r) => r.message).join(' · ')}`);
  }
  const options = { ...cur.einvoiceOptions };
  for (const k of ['zeroRatedReason', 'zeroRatedReasonText', 'paymentMeansCode'] as const) {
    if (b[k] !== undefined) { if (b[k]) options[k] = b[k] as string; else delete options[k]; }
  }
  await tx.update(ledgerSettings).set({ einvoiceEnabled: b.enabled, einvoiceOptions: options, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(ledgerSettings.id, cur.id));
  await audit(tx, actor, b.enabled ? 'enable' : 'disable', 'einvoice', null, { enabled: cur.einvoiceEnabled, options: cur.einvoiceOptions }, { enabled: b.enabled, options });
  return { enabled: b.enabled, options };
}

/** Integrity check of the stored documents (hash recomputes, stamp verifies, chain is gapless and linked). */
export async function verifyChain(tx: Tx, unitId?: string) {
  const unit = unitId ? await unitById(tx, unitId) : await activeUnit(tx);
  if (!unit) return { checked: 0, ok: true, problems: [] as string[] };
  const docs = await tx.select().from(einvoiceDocument).where(eq(einvoiceDocument.egsId, unit.id)).orderBy(asc(einvoiceDocument.icv));
  const problems: string[] = [];
  let pih = GENESIS_PIH;
  let icv = 0;
  for (const d of docs) {
    icv += 1;
    if (d.icv !== icv) problems.push(`ICV gap: expected ${icv}, found ${d.icv} (${d.number})`);
    if (d.pih !== pih) problems.push(`${d.number}: PIH does not match the previous document's hash`);
    const v = verifySignedDocument(d.xml);
    if (!v.ok) problems.push(`${d.number}: ${v.problems.join('; ')}`);
    else if (v.hashBase64 !== d.invoiceHash) problems.push(`${d.number}: stored hash differs from the recomputed one`);
    pih = d.invoiceHash;
  }
  if (docs.length && unit.lastPih !== pih) problems.push('the unit chain head does not match its last document');
  if (unit.icvCounter !== docs.length) problems.push(`the unit counter (${unit.icvCounter}) differs from the number of documents (${docs.length})`);
  return { checked: docs.length, ok: problems.length === 0, problems };
}

export { ZatcaRejection };
