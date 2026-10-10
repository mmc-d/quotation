import { esc, money } from './xml.js';

/**
 * ZATCA UBL 2.1 builder for a tax invoice (388), prepayment invoice (386), credit note (381) or
 * debit note (383), standard (B2B, cleared) or simplified (B2C, reported).
 *
 * ALL FOUR ARE `Invoice`-ROOTED. ZATCA carries every document kind in the UBL *Invoice* schema and
 * tells them apart only by cbc:InvoiceTypeCode — there is no CreditNote root and no
 * cac:CreditNoteLine (the gateway answers HTTP 400 with an empty body if you send one).
 *
 * The text this produces is the payload that gets hashed. It is deliberately indented the way the
 * SDK's samples are and is NEVER re-indented afterwards: the invoice hash is taken over the
 * canonical form, whitespace included, so the QR / signature blocks are spliced in without
 * touching anything around them (see document.ts).
 *
 * Money is carried as decimal STRINGS with two decimals all the way through — no floats.
 */

export type DocKind = 'invoice' | 'prepayment' | 'credit' | 'debit';
export type Subtype = 'standard' | 'simplified';
export type TaxCategory = 'S' | 'Z' | 'E' | 'O';

export const TYPE_CODE: Record<DocKind, '388' | '386' | '381' | '383'> = { invoice: '388', prepayment: '386', credit: '381', debit: '383' };

export interface Address {
  street?: string | null;
  buildingNumber?: string | null;
  /** KSA-23 additional number (4 digits) → cbc:PlotIdentification */
  additionalNumber?: string | null;
  district?: string | null;
  city?: string | null;
  postalCode?: string | null;
  /** BT-54 region; falls back to the city */
  region?: string | null;
  country?: string | null;
}

export interface Party {
  name: string;
  /** 15-digit VAT registration number */
  vatNumber?: string | null;
  /** other identification (BT-29 / BT-46): scheme CRN, 700, MOM, MLS, SAG, GCC, TIN, NAT, IQA, PAS, OTH */
  otherId?: string | null;
  schemeId?: string | null;
  address?: Address | null;
}

export interface DocLine {
  name: string;
  /** decimal string, e.g. "2" or "1.5" */
  quantity: string;
  /** VAT-exclusive unit price, 2 dp */
  unitPrice: string;
  /** line net AFTER any discount, 2 dp (positive — credit notes carry positive amounts) */
  net: string;
  /** discount already taken off this line (2 dp), shown as a line allowance */
  discount?: string;
  /** VAT on the line, 2 dp */
  vat: string;
  /** percent, e.g. 15 */
  rate: number;
  category: TaxCategory;
  /** VATEX-SA-… — required by ZATCA for Z / E / O */
  exemptionReasonCode?: string | null;
  exemptionReason?: string | null;
  unitCode?: string;
}

/** A 386 prepayment invoice deducted on a final 388 invoice (shown as a zero line carrying the reference). */
export interface PrepaymentRef {
  number: string;
  uuid: string;
  issueDate: string;
  issueTime: string;
  /** the prepayment's taxable amount and VAT, 2 dp */
  net: string;
  vat: string;
  rate: number;
  category: TaxCategory;
  exemptionReasonCode?: string | null;
  exemptionReason?: string | null;
}

export interface EInvoiceDoc {
  kind: DocKind;
  subtype: Subtype;
  number: string;
  uuid: string;
  issueDate: string;
  issueTime: string;
  /** KSA-5 supply date — mandatory on standard invoices; defaults to the issue date */
  supplyDate?: string | null;
  currency?: string;
  /** invoice counter value (gapless per EGS unit) */
  icv: number;
  /** previous invoice hash (base64) */
  pih: string;
  /** base64 QR — attached once it exists; its content is excluded from the hash */
  qr?: string | null;
  seller: Party & { crn?: string | null };
  buyer?: Party | null;
  lines: DocLine[];
  prepayments?: PrepaymentRef[];
  /** 381 / 383 only: the document being corrected and why (BR-KSA-17 needs the reason) */
  billingReference?: { number: string; reason: string } | null;
  /** 1 unspecified · 10 cash · 30 credit transfer · 42 bank account · 48 card */
  paymentMeansCode?: string;
  /** ZATCA transaction flags NPEEB…: third-party, nominal, export, summary, self-billed (default 00000) */
  flags?: string;
  /** XAdES signing time, local KSA time without a suffix; defaults to issue date + time */
  signingTime?: string;
}

const XMLNS =
  'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" ' +
  'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"';

const c = (n: number) => n.toFixed(2);
const cents = (s: string): bigint => {
  const m = money(s);
  const neg = m.startsWith('-');
  const [i = '0', f = '00'] = m.replace('-', '').split('.');
  const v = BigInt(i) * 100n + BigInt(f);
  return neg ? -v : v;
};
const fromCents = (v: bigint): string => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
};

/** Quantity with at least two and at most six decimals. */
function qty(q: string): string {
  const t = String(q).trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`not a quantity: ${t}`);
  const [i = '0', f = ''] = t.split('.');
  return `${i}.${(f + '00').slice(0, 6).replace(/(\d{2})0+$/, '$1')}`;
}

const el = (indent: string, tag: string, v: unknown) => (v == null || v === '' ? '' : `\n${indent}<cbc:${tag}>${esc(v)}</cbc:${tag}>`);

/** Seller / buyer block. An empty element anywhere fails BR-KSA-F-03, so a child is emitted only when it has a value. */
function partyXml(role: 'AccountingSupplierParty' | 'AccountingCustomerParty', p: Party & { crn?: string | null }): string {
  const a = p.address ?? {};
  const otherId = p.otherId || p.crn || '';
  const scheme = String(p.schemeId || 'CRN').toUpperCase();
  const addr = [
    el('                ', 'StreetName', a.street),
    el('                ', 'BuildingNumber', a.buildingNumber),
    el('                ', 'PlotIdentification', a.additionalNumber),
    el('                ', 'CitySubdivisionName', a.district),
    el('                ', 'CityName', a.city),
    el('                ', 'PostalZone', a.postalCode),
    el('                ', 'CountrySubentity', a.region || a.city),
  ].join('');
  // A party with no address must not get a defaulted country (BR-KSA-67 then demands a postal code).
  const country = addr || a.country
    ? `\n                <cac:Country>\n                    <cbc:IdentificationCode>${esc(a.country || 'SA')}</cbc:IdentificationCode>\n                </cac:Country>`
    : '';
  const parts: string[] = [];
  if (otherId) parts.push(`            <cac:PartyIdentification>\n                <cbc:ID schemeID="${esc(scheme)}">${esc(otherId)}</cbc:ID>\n            </cac:PartyIdentification>`);
  if (addr || country) parts.push(`            <cac:PostalAddress>${addr}${country}\n            </cac:PostalAddress>`);
  if (p.vatNumber) parts.push(`            <cac:PartyTaxScheme>\n                <cbc:CompanyID>${esc(p.vatNumber)}</cbc:CompanyID>\n                <cac:TaxScheme>\n                    <cbc:ID>VAT</cbc:ID>\n                </cac:TaxScheme>\n            </cac:PartyTaxScheme>`);
  if (p.name) parts.push(`            <cac:PartyLegalEntity>\n                <cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>\n            </cac:PartyLegalEntity>`);
  return `    <cac:${role}>\n        <cac:Party>\n${parts.join('\n')}\n        </cac:Party>\n    </cac:${role}>`;
}

function taxCategory(tag: 'TaxCategory' | 'ClassifiedTaxCategory', ind: string, cat: TaxCategory, rate: number, code?: string | null, reason?: string | null): string {
  const exempt = tag === 'TaxCategory' && cat !== 'S'
    ? `${code ? `\n${ind}    <cbc:TaxExemptionReasonCode>${esc(code)}</cbc:TaxExemptionReasonCode>` : ''}${reason ? `\n${ind}    <cbc:TaxExemptionReason>${esc(reason)}</cbc:TaxExemptionReason>` : ''}`
    : '';
  return `${ind}<cac:${tag}>\n${ind}    <cbc:ID>${cat}</cbc:ID>\n${ind}    <cbc:Percent>${c(rate)}</cbc:Percent>${exempt}\n${ind}    <cac:TaxScheme>\n${ind}        <cbc:ID>VAT</cbc:ID>\n${ind}    </cac:TaxScheme>\n${ind}</cac:${tag}>`;
}

export interface DocTotals {
  lineExtension: string;
  taxExclusive: string;
  vat: string;
  taxInclusive: string;
  prepaid: string;
  payable: string;
}

/** Totals derived from the lines — what the XML carries, so the document can never disagree with itself. */
export function docTotals(doc: Pick<EInvoiceDoc, 'lines' | 'prepayments'>): DocTotals {
  const net = doc.lines.reduce((s, l) => s + cents(l.net), 0n);
  const vat = doc.lines.reduce((s, l) => s + cents(l.vat), 0n);
  const prepaid = (doc.prepayments ?? []).reduce((s, p) => s + cents(p.net) + cents(p.vat), 0n);
  return {
    lineExtension: fromCents(net),
    taxExclusive: fromCents(net),
    vat: fromCents(vat),
    taxInclusive: fromCents(net + vat),
    prepaid: fromCents(prepaid),
    payable: fromCents(net + vat - prepaid),
  };
}

interface Subtotal { cat: TaxCategory; rate: number; code?: string | null; reason?: string | null; taxable: bigint; tax: bigint }

function subtotals(lines: DocLine[]): Subtotal[] {
  const g = new Map<string, Subtotal>();
  for (const l of lines) {
    const key = `${l.category}:${l.rate}:${l.exemptionReasonCode ?? ''}`;
    const s = g.get(key) ?? { cat: l.category, rate: l.rate, code: l.exemptionReasonCode, reason: l.exemptionReason, taxable: 0n, tax: 0n };
    s.taxable += cents(l.net);
    s.tax += cents(l.vat);
    g.set(key, s);
  }
  return [...g.values()];
}

const SUBTOTAL = (ind: string, s: { cat: TaxCategory; rate: number; code?: string | null; reason?: string | null }, taxable: string, tax: string, cur: string) =>
  `${ind}<cac:TaxSubtotal>\n${ind}    <cbc:TaxableAmount currencyID="${cur}">${taxable}</cbc:TaxableAmount>\n${ind}    <cbc:TaxAmount currencyID="${cur}">${tax}</cbc:TaxAmount>\n${taxCategory('TaxCategory', `${ind}    `, s.cat, s.rate, s.code, s.reason)}\n${ind}</cac:TaxSubtotal>`;

function lineXml(l: DocLine, n: number, cur: string): string {
  const net = money(l.net);
  const vat = money(l.vat);
  const disc = l.discount ? money(l.discount) : '0.00';
  const gross = cents(net) + cents(disc);
  const rounding = fromCents(cents(net) + cents(vat));
  const allowance = cents(disc) > 0n
    ? `\n        <cac:AllowanceCharge>\n            <cbc:ChargeIndicator>false</cbc:ChargeIndicator>\n            <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>\n            <cbc:Amount currencyID="${cur}">${disc}</cbc:Amount>\n        </cac:AllowanceCharge>`
    : '';
  void gross;
  return `    <cac:InvoiceLine>
        <cbc:ID>${n}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="${esc(l.unitCode || 'PCE')}">${qty(l.quantity)}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="${cur}">${net}</cbc:LineExtensionAmount>${allowance}
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="${cur}">${vat}</cbc:TaxAmount>
            <cbc:RoundingAmount currencyID="${cur}">${rounding}</cbc:RoundingAmount>
        </cac:TaxTotal>
        <cac:Item>
            <cbc:Name>${esc(l.name)}</cbc:Name>
${taxCategory('ClassifiedTaxCategory', '            ', l.category, l.rate)}
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="${cur}">${money(l.unitPrice)}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>`;
}

function prepaymentLineXml(p: PrepaymentRef, n: number, cur: string): string {
  return `    <cac:InvoiceLine>
        <cbc:ID>${n}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="PCE">0.000000</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="${cur}">0.00</cbc:LineExtensionAmount>
        <cac:DocumentReference>
            <cbc:ID>${esc(p.number)}</cbc:ID>
            <cbc:UUID>${esc(p.uuid)}</cbc:UUID>
            <cbc:IssueDate>${esc(p.issueDate)}</cbc:IssueDate>
            <cbc:IssueTime>${esc(p.issueTime)}</cbc:IssueTime>
            <cbc:DocumentTypeCode>386</cbc:DocumentTypeCode>
        </cac:DocumentReference>
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="${cur}">0.00</cbc:TaxAmount>
            <cbc:RoundingAmount currencyID="${cur}">0.00</cbc:RoundingAmount>
${SUBTOTAL('            ', { cat: p.category, rate: p.rate, code: p.exemptionReasonCode, reason: p.exemptionReason }, money(p.net), money(p.vat), cur)}
        </cac:TaxTotal>
        <cac:Item>
            <cbc:Name>${esc(`Advance payment — invoice ${p.number} | دفعة مقدمة — فاتورة ${p.number}`)}</cbc:Name>
${taxCategory('ClassifiedTaxCategory', '            ', p.category, p.rate)}
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="${cur}">0.00</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>`;
}

/** Build the UBL XML. Pure and deterministic: the same document always yields the same bytes. */
export function buildUbl(doc: EInvoiceDoc): string {
  const cur = doc.currency || 'SAR';
  const isNote = doc.kind === 'credit' || doc.kind === 'debit';
  const standard = doc.subtype === 'standard';
  const txName = `${standard ? '01' : '02'}${doc.flags && /^[01]{5}$/.test(doc.flags) ? doc.flags : '00000'}`;
  const t = docTotals(doc);
  const subs = subtotals(doc.lines);

  const billing = isNote && doc.billingReference
    ? `\n    <cac:BillingReference>\n        <cac:InvoiceDocumentReference>\n            <cbc:ID>${esc(doc.billingReference.number)}</cbc:ID>\n        </cac:InvoiceDocumentReference>\n    </cac:BillingReference>`
    : '';
  const qr = doc.qr
    ? `\n    <cac:AdditionalDocumentReference>\n        <cbc:ID>QR</cbc:ID>\n        <cac:Attachment>\n            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(doc.qr)}</cbc:EmbeddedDocumentBinaryObject>\n        </cac:Attachment>\n    </cac:AdditionalDocumentReference>`
    : '';
  const delivery = standard
    ? `\n    <cac:Delivery>\n        <cbc:ActualDeliveryDate>${esc(doc.supplyDate || doc.issueDate)}</cbc:ActualDeliveryDate>\n    </cac:Delivery>`
    : '';
  // Payment means is mandatory on a standard invoice and on every credit / debit note (the reason lives in InstructionNote).
  const instruction = isNote ? `\n        <cbc:InstructionNote>${esc(doc.billingReference?.reason || 'Adjustment to a previously issued invoice')}</cbc:InstructionNote>` : '';
  const payment = standard || isNote
    ? `\n    <cac:PaymentMeans>\n        <cbc:PaymentMeansCode>${esc(doc.paymentMeansCode || '1')}</cbc:PaymentMeansCode>${instruction}\n    </cac:PaymentMeans>`
    : '';
  const prepaid = (doc.prepayments?.length ?? 0) > 0 ? `\n        <cbc:PrepaidAmount currencyID="${cur}">${t.prepaid}</cbc:PrepaidAmount>` : '';
  const lines = [
    ...doc.lines.map((l, i) => lineXml(l, i + 1, cur)),
    ...(doc.prepayments ?? []).map((p, i) => prepaymentLineXml(p, doc.lines.length + i + 1, cur)),
  ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice ${XMLNS}>
    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>${esc(doc.number)}</cbc:ID>
    <cbc:UUID>${esc(doc.uuid)}</cbc:UUID>
    <cbc:IssueDate>${esc(doc.issueDate)}</cbc:IssueDate>
    <cbc:IssueTime>${esc(doc.issueTime)}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="${txName}">${TYPE_CODE[doc.kind]}</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>${cur}</cbc:TaxCurrencyCode>${billing}
    <cac:AdditionalDocumentReference>
        <cbc:ID>ICV</cbc:ID>
        <cbc:UUID>${doc.icv}</cbc:UUID>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>PIH</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(doc.pih)}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>${qr}
    <cac:Signature>
        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
    </cac:Signature>
${partyXml('AccountingSupplierParty', doc.seller)}
${partyXml('AccountingCustomerParty', doc.buyer ?? { name: '' })}${delivery}${payment}
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${cur}">${t.vat}</cbc:TaxAmount>
    </cac:TaxTotal>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${cur}">${t.vat}</cbc:TaxAmount>
${subs.map((s) => SUBTOTAL('        ', s, fromCents(s.taxable), fromCents(s.tax), cur)).join('\n')}
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="${cur}">${t.lineExtension}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="${cur}">${t.taxExclusive}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="${cur}">${t.taxInclusive}</cbc:TaxInclusiveAmount>
        <cbc:AllowanceTotalAmount currencyID="${cur}">0.00</cbc:AllowanceTotalAmount>${prepaid}
        <cbc:PayableAmount currencyID="${cur}">${t.payable}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}
