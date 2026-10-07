import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { dec, isValidVatNumber } from '@mmc/domain';

/**
 * Supplier ZATCA e-invoice ingestion (module 07, INV-66): parse a UBL 2.1 Invoice (as cleared /
 * reported by the supplier's e-invoicing solution) and check it deterministically — no OCR.
 *
 * Safety: the XML comes from outside. Any DOCTYPE / ENTITY declaration is refused before parsing
 * (ZATCA invoices never carry a DTD), and the parser runs with entity processing off, so neither
 * external (XXE, `SYSTEM "file:///…"`) nor internal (billion laughs) entities can be expanded.
 */

export const UBL_INVOICE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
export const MAX_XML_BYTES = 2_000_000;

export interface ZatcaInvoiceLine {
  id: string;
  name: string;
  sellersItemId: string | null;
  buyersItemId: string | null;
  qty: string;
  unitCode: string | null;
  lineExtension: string;
  unitPrice: string;
  baseQty: string;
  vatPercent: string | null;
  vatCategory: string | null;
  lineVat: string | null;
}

export interface ZatcaParty {
  name: string | null;
  vatNumber: string | null;
  crNumber: string | null;
  city: string | null;
}

export interface ZatcaInvoice {
  number: string;
  uuid: string | null;
  issueDate: string;
  issueTime: string | null;
  typeCode: string;
  /** ZATCA subtype (name attribute): 01xxxxx standard, 02xxxxx simplified */
  typeName: string | null;
  currency: string;
  supplier: ZatcaParty;
  customer: ZatcaParty;
  /** document VAT in the document currency */
  vat: string;
  /** VAT in SAR when a second TaxTotal in SAR is given (foreign-currency invoices) */
  vatSar: string | null;
  lineExtension: string | null;
  taxExclusive: string;
  taxInclusive: string;
  allowanceTotal: string;
  chargeTotal: string;
  prepaid: string;
  payable: string;
  lines: ZatcaInvoiceLine[];
  qr: string | null;
  qrFields: Record<number, string> | null;
}

export interface XmlIssue {
  level: 'error' | 'warning';
  code: string;
  ar: string;
  en: string;
}

export class ZatcaXmlError extends Error {
  constructor(message: string, readonly ar: string) {
    super(message);
  }
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  allowBooleanAttributes: false,
  isArray: (name) => ['InvoiceLine', 'AdditionalDocumentReference', 'TaxTotal', 'TaxSubtotal', 'PartyIdentification', 'AllowanceCharge'].includes(name),
});

/** Text of a node that may carry attributes (`{ '#text': '15.00', '@_currencyID': 'SAR' }`). */
function txt(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim() || null;
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === 'object') return txt((v as Node)['#text']);
  return null;
}
function attr(v: unknown, name: string): string | null {
  if (Array.isArray(v)) return attr(v[0], name);
  if (v && typeof v === 'object') return txt((v as Node)[`@_${name}`]);
  return null;
}
function node(v: unknown): Node {
  if (Array.isArray(v)) return node(v[0]);
  return v && typeof v === 'object' ? (v as Node) : {};
}
function arr(v: unknown): Node[] {
  return Array.isArray(v) ? (v as Node[]) : v ? [v as Node] : [];
}
function amount(v: unknown, field: string, required = true): string {
  const t = txt(v);
  if (t == null) {
    if (!required) return '0';
    throw new ZatcaXmlError(`missing ${field}`, `الحقل ${field} مفقود`);
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new ZatcaXmlError(`${field} is not a number: ${t.slice(0, 40)}`, `قيمة ${field} غير رقمية`);
  return t;
}

function partyOf(p: Node): ZatcaParty {
  const party = node(p.Party);
  const ids = arr(party.PartyIdentification);
  const cr = ids.find((i) => attr(i.ID, 'schemeID') === 'CRN');
  return {
    name: txt(node(party.PartyLegalEntity).RegistrationName) ?? txt(node(party.PartyName).Name),
    vatNumber: txt(node(party.PartyTaxScheme).CompanyID),
    crNumber: cr ? txt(cr.ID) : null,
    city: txt(node(party.PostalAddress).CityName),
  };
}

/** Decode a ZATCA TLV QR (base64; one-byte tags, BER lengths). Returns null when it is not valid TLV. */
export function decodeZatcaQr(b64: string): Record<number, string> | null {
  try {
    const buf = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
    const out: Record<number, string> = {};
    let i = 0;
    while (i < buf.length) {
      const tag = buf[i++]!;
      let len = buf[i++]!;
      if (len === 0x81) len = buf[i++]!;
      else if (len === 0x82) { len = (buf[i]! << 8) | buf[i + 1]!; i += 2; }
      else if (len > 0x82) return null;
      if (i + len > buf.length) return null;
      // tags 1–5 are UTF-8 text; 6–9 (Phase 2) are binary — keep them base64
      out[tag] = tag <= 5 ? buf.subarray(i, i + len).toString('utf8') : buf.subarray(i, i + len).toString('base64');
      i += len;
    }
    return out[1] !== undefined ? out : null;
  } catch {
    return null;
  }
}

/** Parse a ZATCA UBL 2.1 invoice. Throws ZatcaXmlError for unsafe, malformed or non-invoice XML. */
export function parseZatcaInvoice(xml: string): ZatcaInvoice {
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) throw new ZatcaXmlError('the XML is too large', 'ملف XML كبير جدًا');
  const src = xml.replace(/^﻿/, '');
  if (/<!DOCTYPE/i.test(src) || /<!ENTITY/i.test(src)) {
    throw new ZatcaXmlError('DOCTYPE / ENTITY declarations are not allowed in an e-invoice (XXE protection)', 'لا يُسمح بتعريفات DOCTYPE أو ENTITY في الفاتورة الإلكترونية');
  }
  const valid = XMLValidator.validate(src, { allowBooleanAttributes: false });
  if (valid !== true) throw new ZatcaXmlError(`malformed XML: ${valid.err.msg} (line ${valid.err.line})`, 'ملف XML غير سليم');
  if (!src.includes(UBL_INVOICE_NS)) throw new ZatcaXmlError('not a UBL 2.1 Invoice (namespace missing)', 'ليس فاتورة UBL 2.1');
  const doc = parser.parse(src) as Node;
  const inv = doc.Invoice as Node | undefined;
  if (!inv || typeof inv !== 'object') throw new ZatcaXmlError('the root element is not <Invoice>', 'العنصر الجذري ليس فاتورة');

  const currency = txt(inv.DocumentCurrencyCode) ?? 'SAR';
  const taxTotals = arr(inv.TaxTotal);
  const docTax = taxTotals.find((t) => (attr(t.TaxAmount, 'currencyID') ?? currency) === currency) ?? taxTotals[0];
  const sarTax = currency !== 'SAR' ? taxTotals.find((t) => attr(t.TaxAmount, 'currencyID') === 'SAR') : undefined;
  const lmt = node(inv.LegalMonetaryTotal);
  const refs = arr(inv.AdditionalDocumentReference);
  const qrRef = refs.find((r) => txt(r.ID) === 'QR');
  const qr = qrRef ? txt(node(node(qrRef.Attachment).EmbeddedDocumentBinaryObject)) ?? txt(node(qrRef.Attachment).EmbeddedDocumentBinaryObject) : null;

  const lines: ZatcaInvoiceLine[] = arr(inv.InvoiceLine).map((l, i) => {
    const item = node(l.Item);
    const cat = node(item.ClassifiedTaxCategory);
    const price = node(l.Price);
    const lineTax = node(arr(l.TaxTotal)[0]);
    return {
      id: txt(l.ID) ?? String(i + 1),
      name: txt(item.Name) ?? '',
      sellersItemId: txt(node(item.SellersItemIdentification).ID),
      buyersItemId: txt(node(item.BuyersItemIdentification).ID),
      qty: amount(l.InvoicedQuantity, `InvoiceLine ${i + 1} InvoicedQuantity`),
      unitCode: attr(l.InvoicedQuantity, 'unitCode'),
      lineExtension: amount(l.LineExtensionAmount, `InvoiceLine ${i + 1} LineExtensionAmount`),
      unitPrice: amount(price.PriceAmount, `InvoiceLine ${i + 1} PriceAmount`),
      baseQty: txt(price.BaseQuantity) ?? '1',
      vatPercent: txt(cat.Percent),
      vatCategory: txt(cat.ID),
      lineVat: txt(lineTax.TaxAmount),
    };
  });

  const number = txt(inv.ID);
  const issueDate = txt(inv.IssueDate);
  const typeCode = txt(inv.InvoiceTypeCode);
  if (!number || !issueDate || !typeCode) throw new ZatcaXmlError('the invoice has no ID, IssueDate or InvoiceTypeCode', 'الفاتورة بلا رقم أو تاريخ أو نوع');
  return {
    number,
    uuid: txt(inv.UUID),
    issueDate,
    issueTime: txt(inv.IssueTime),
    typeCode,
    typeName: attr(inv.InvoiceTypeCode, 'name'),
    currency,
    supplier: partyOf(node(inv.AccountingSupplierParty)),
    customer: partyOf(node(inv.AccountingCustomerParty)),
    vat: amount(docTax?.TaxAmount, 'TaxTotal/TaxAmount'),
    vatSar: sarTax ? txt(sarTax.TaxAmount) : null,
    lineExtension: txt(lmt.LineExtensionAmount),
    taxExclusive: amount(lmt.TaxExclusiveAmount, 'LegalMonetaryTotal/TaxExclusiveAmount'),
    taxInclusive: amount(lmt.TaxInclusiveAmount, 'LegalMonetaryTotal/TaxInclusiveAmount'),
    allowanceTotal: amount(lmt.AllowanceTotalAmount, 'AllowanceTotalAmount', false),
    chargeTotal: amount(lmt.ChargeTotalAmount, 'ChargeTotalAmount', false),
    prepaid: amount(lmt.PrepaidAmount, 'PrepaidAmount', false),
    payable: amount(lmt.PayableAmount, 'LegalMonetaryTotal/PayableAmount'),
    lines,
    qr,
    qrFields: qr ? decodeZatcaQr(qr) : null,
  };
}

const close = (a: Parameters<typeof dec>[0], b: Parameters<typeof dec>[0], tol: number) => dec(a).minus(dec(b)).abs().lte(tol);
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[\sً-ْـ.,،\-_()]+/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

/**
 * Deterministic checks of a parsed invoice. Errors: arithmetic that does not add up, a missing or
 * malformed supplier VAT number, no lines. Warnings: identity mismatches (supplier VAT vs our record,
 * buyer VAT / name vs the company), QR disagreeing with the XML, non-388 types, simplified invoices.
 */
export function validateZatcaInvoice(inv: ZatcaInvoice, ctx: { supplierVat?: string | null; supplierMatched: boolean; companyVat?: string | null; companyNames: string[] }): XmlIssue[] {
  const out: XmlIssue[] = [];
  const err = (code: string, en: string, ar: string) => out.push({ level: 'error', code, en, ar });
  const warn = (code: string, en: string, ar: string) => out.push({ level: 'warning', code, en, ar });

  // identities
  const sVat = inv.supplier.vatNumber;
  if (!sVat) err('supplier_vat_missing', 'the supplier VAT number (AccountingSupplierParty/PartyTaxScheme/CompanyID) is missing', 'الرقم الضريبي للمورد مفقود');
  else if (!isValidVatNumber(sVat)) err('supplier_vat_format', `supplier VAT ${sVat} is not 15 digits starting and ending with 3`, `الرقم الضريبي للمورد ${sVat} ليس 15 رقمًا يبدأ وينتهي بـ 3`);
  if (sVat && !ctx.supplierMatched) warn('supplier_unknown', `no supplier with VAT ${sVat} on file — choose the supplier`, `لا يوجد مورد مسجّل بالرقم الضريبي ${sVat} — اختر المورد`);
  if (sVat && ctx.supplierMatched && ctx.supplierVat && ctx.supplierVat !== sVat) warn('supplier_vat_mismatch', `supplier VAT ${sVat} differs from our record ${ctx.supplierVat}`, `الرقم الضريبي للمورد ${sVat} يختلف عن المسجّل ${ctx.supplierVat}`);
  const bVat = inv.customer.vatNumber;
  if (bVat && !isValidVatNumber(bVat)) warn('buyer_vat_format', `buyer VAT ${bVat} is not 15 digits starting and ending with 3`, `الرقم الضريبي للمشتري ${bVat} غير صالح`);
  if (ctx.companyVat && bVat !== ctx.companyVat) warn('buyer_vat_mismatch', `the invoice is addressed to VAT ${bVat ?? '—'}, ours is ${ctx.companyVat}`, `الفاتورة صادرة للرقم الضريبي ${bVat ?? '—'} والرقم الضريبي للمنشأة ${ctx.companyVat}`);
  if (!ctx.companyVat && bVat) warn('buyer_vat_unexpected', `the invoice carries buyer VAT ${bVat} but the company has no VAT number on file`, `الفاتورة تحمل رقمًا ضريبيًا للمشتري ${bVat} والمنشأة بلا رقم ضريبي مسجّل`);
  const bName = norm(inv.customer.name);
  if (!bName) warn('buyer_name_missing', 'the buyer name is missing', 'اسم المشتري مفقود');
  else if (!ctx.companyNames.map(norm).filter(Boolean).some((n) => n.includes(bName) || bName.includes(n))) warn('buyer_name_mismatch', `the buyer "${inv.customer.name}" does not match the company name`, `اسم المشتري «${inv.customer.name}» لا يطابق اسم المنشأة`);

  // type
  if (inv.typeCode === '386') warn('prepayment_invoice', 'this is a prepayment invoice (386)', 'هذه فاتورة دفعة مقدمة (386)');
  else if (inv.typeCode === '381' || inv.typeCode === '383') warn('note', `this is a ${inv.typeCode === '381' ? 'credit' : 'debit'} note (${inv.typeCode}), not an invoice`, `هذا إشعار ${inv.typeCode === '381' ? 'دائن' : 'مدين'} وليس فاتورة`);
  else if (inv.typeCode !== '388') err('type_code', `unknown InvoiceTypeCode ${inv.typeCode}`, `نوع فاتورة غير معروف ${inv.typeCode}`);
  if (inv.typeName?.startsWith('02')) warn('simplified', 'a simplified (B2C) invoice — a supplier should issue a standard tax invoice to a business', 'فاتورة مبسطة — يجب أن يصدر المورد فاتورة ضريبية للمنشآت');
  if (!inv.lines.length) err('no_lines', 'the invoice has no lines', 'الفاتورة بلا بنود');

  // line arithmetic
  let sumExt = dec(0);
  let sumVat = dec(0);
  for (const l of inv.lines) {
    const base = dec(l.baseQty || '1').gt(0) ? dec(l.baseQty || '1') : dec(1);
    const expected = dec(l.qty).times(l.unitPrice).div(base);
    if (!close(expected, l.lineExtension, 0.01)) err('line_amount', `line ${l.id}: ${l.qty} × ${l.unitPrice} = ${expected.toFixed(2)}, the invoice says ${l.lineExtension}`, `البند ${l.id}: ${l.qty} × ${l.unitPrice} = ${expected.toFixed(2)} والفاتورة تذكر ${l.lineExtension}`);
    const pct = l.vatPercent ?? (l.vatCategory === 'S' ? '15' : '0');
    const lv = dec(l.lineExtension).times(pct).div(100);
    if (l.lineVat != null && !close(lv, l.lineVat, 0.01)) err('line_vat', `line ${l.id}: VAT ${pct}% of ${l.lineExtension} = ${lv.toFixed(2)}, the invoice says ${l.lineVat}`, `البند ${l.id}: الضريبة ${pct}% من ${l.lineExtension} = ${lv.toFixed(2)} والفاتورة تذكر ${l.lineVat}`);
    if (l.vatCategory === 'S' && l.vatPercent && !dec(l.vatPercent).eq(15)) warn('line_rate', `line ${l.id}: standard-rated at ${l.vatPercent}% (expected 15%)`, `البند ${l.id}: نسبة ضريبة ${l.vatPercent}% بدل 15%`);
    sumExt = sumExt.plus(l.lineExtension);
    sumVat = sumVat.plus(lv);
  }
  const n = Math.max(1, inv.lines.length);
  if (inv.lineExtension != null && !close(sumExt, inv.lineExtension, 0.01)) err('lines_total', `the lines add up to ${sumExt.toFixed(2)}, LineExtensionAmount is ${inv.lineExtension}`, `مجموع البنود ${sumExt.toFixed(2)} والإجمالي المذكور ${inv.lineExtension}`);
  const taxEx = sumExt.minus(inv.allowanceTotal).plus(inv.chargeTotal);
  if (!close(taxEx, inv.taxExclusive, 0.01)) err('tax_exclusive', `lines − allowances + charges = ${taxEx.toFixed(2)}, TaxExclusiveAmount is ${inv.taxExclusive}`, `الإجمالي قبل الضريبة المحسوب ${taxEx.toFixed(2)} والمذكور ${inv.taxExclusive}`);
  // document-level allowances reduce the VAT base proportionally; compare against the line VAT within 0.01 per line
  const vatExpected = sumExt.gt(0) ? sumVat.times(dec(inv.taxExclusive).div(sumExt)) : sumVat;
  if (!close(vatExpected, inv.vat, 0.01 * n)) err('vat_total', `VAT should be ${vatExpected.toFixed(2)} (lines × rate), the invoice says ${inv.vat}`, `الضريبة المتوقعة ${vatExpected.toFixed(2)} (البنود × النسبة) والفاتورة تذكر ${inv.vat}`);
  if (!close(dec(inv.taxExclusive).plus(inv.vat), inv.taxInclusive, 0.01)) err('tax_inclusive', `${inv.taxExclusive} + VAT ${inv.vat} ≠ TaxInclusiveAmount ${inv.taxInclusive}`, `${inv.taxExclusive} + الضريبة ${inv.vat} لا يساوي الإجمالي شامل الضريبة ${inv.taxInclusive}`);
  if (!close(dec(inv.taxInclusive).minus(inv.prepaid), inv.payable, 0.01)) err('payable', `TaxInclusiveAmount − PrepaidAmount ≠ PayableAmount ${inv.payable}`, `المبلغ المستحق ${inv.payable} لا يساوي الإجمالي ناقص المدفوع مقدمًا`);
  if (inv.currency !== 'SAR' && inv.vatSar == null) warn('vat_sar_missing', 'a foreign-currency invoice should state the VAT in SAR (second TaxTotal)', 'فاتورة بعملة أجنبية دون بيان الضريبة بالريال');

  // QR (tags 1–5) must agree with the XML
  if (!inv.qr) warn('qr_missing', 'no QR code (AdditionalDocumentReference ID=QR)', 'لا يوجد رمز QR في الفاتورة');
  else if (!inv.qrFields) warn('qr_invalid', 'the QR code is not valid ZATCA TLV', 'رمز QR ليس بصيغة TLV المعتمدة');
  else {
    const q = inv.qrFields;
    if (q[2] && sVat && q[2] !== sVat) warn('qr_vat', `QR seller VAT ${q[2]} ≠ XML ${sVat}`, `الرقم الضريبي في QR ${q[2]} يختلف عن الفاتورة`);
    if (q[4] && !close(q[4], inv.taxInclusive, 0.01)) warn('qr_total', `QR total ${q[4]} ≠ XML ${inv.taxInclusive}`, `الإجمالي في QR ${q[4]} يختلف عن الفاتورة ${inv.taxInclusive}`);
    if (q[5] && !close(q[5], inv.vat, 0.01)) warn('qr_vat_amount', `QR VAT ${q[5]} ≠ XML ${inv.vat}`, `الضريبة في QR ${q[5]} تختلف عن الفاتورة ${inv.vat}`);
    if (q[3] && !q[3].startsWith(inv.issueDate)) warn('qr_date', `QR timestamp ${q[3]} ≠ issue date ${inv.issueDate}`, `تاريخ QR ${q[3]} يختلف عن تاريخ الفاتورة`);
  }
  return out;
}

/** Similarity 0..1 of two codes/descriptions (normalised exact = 1, containment = 0.8, shared tokens otherwise). */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  const ta = new Set((a ?? '').toLowerCase().split(/[\s,/\-_()]+/).filter((t) => t.length > 1));
  const tb = new Set((b ?? '').toLowerCase().split(/[\s,/\-_()]+/).filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (0.7 * common) / Math.max(ta.size, tb.size);
}
