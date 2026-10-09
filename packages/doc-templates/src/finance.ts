import QRCode from 'qrcode';
import { formatSar2, tafqitHalalas, type Halalas } from '@mmc/domain';
import { esc, escLines, footer, header, page, riyal, type CompanyBlock } from './base.js';

const m2 = (h: Halalas) => `${formatSar2(h)} ${riyal}`;

export interface PaymentRequestDoc {
  company: CompanyBlock;
  number: string;
  date: string;
  dueDate: string;
  clientName: string;
  contractNumber?: string | null;
  milestoneName: string;
  amount: Halalas;
  paidAmount: Halalas;
  payUrl?: string | null;
}

const formatIban = (iban: string) => iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

/** Bank-transfer details with the bank's QR (uploaded image, else a QR of the IBAN). */
function bankBox(co: CompanyBlock, number: string, qr: string | null): string {
  if (!co.bankName && !co.iban && !co.bankAccountNumber) return '';
  const row = (k: string, v: string | null | undefined, ltr = false) => (v ? `<tr><td class="bk">${k}</td><td class="bv${ltr ? ' ltr' : ''}">${esc(v)}</td></tr>` : '');
  return `<div class="box" style="display:flex;gap:14px;align-items:center">
${qr ? `<div style="text-align:center"><img class="qr" src="${qr}" alt=""><div style="font-size:8.5px;color:var(--muted)">${co.bankQrDataUrl ? 'امسح للتحويل' : 'امسح لنسخ الآيبان'}</div></div>` : ''}
<div style="flex:1"><h3>التحويل البنكي</h3>
<table class="bank">${row('اسم المستفيد', co.bankAccountName || co.legalNameAr)}${row('البنك', co.bankName)}${row('رقم الحساب', co.bankAccountNumber, true)}${row('الآيبان IBAN', co.iban ? formatIban(co.iban) : null, true)}</table>
<div style="margin-top:4px">يرجى ذكر رقم الطلب <b class="ltr">${esc(number)}</b> في وصف التحويل.</div></div></div>`;
}

/** Payment request — NOT a tax invoice (the tax invoice is issued by the back office on receipt). */
export async function renderPaymentRequestHtml(d: PaymentRequestDoc): Promise<string> {
  const qr = d.payUrl ? await QRCode.toDataURL(d.payUrl, { margin: 1, width: 240 }) : null;
  const bankQr = d.company.bankQrDataUrl ?? (d.company.iban ? await QRCode.toDataURL(d.company.iban.replace(/\s+/g, ''), { margin: 1, width: 240 }) : null);
  const due = d.amount - d.paidAmount;
  const body = `${header(d.company)}
<h1 class="doc">طلب دفع</h1><div class="doc-en">Payment request — this is not a tax invoice</div>
<div class="accent"></div>
<div class="grid">
  <div class="cell"><span class="k">رقم الطلب</span><span class="v ltr">${esc(d.number)}</span></div>
  <div class="cell"><span class="k">التاريخ</span><span class="v ltr">${esc(d.date)}</span></div>
  <div class="cell"><span class="k">تاريخ الاستحقاق</span><span class="v ltr">${esc(d.dueDate)}</span></div>
  <div class="cell"><span class="k">العقد</span><span class="v ltr">${esc(d.contractNumber ?? '')}</span></div>
  <div class="cell" style="grid-column:span 4"><span class="k">العميل</span><span class="v">${esc(d.clientName)}</span></div>
</div>
<table class="items"><thead><tr><th>البيان</th><th class="num">المبلغ</th></tr></thead>
<tbody><tr><td>${esc(d.milestoneName)}</td><td class="money">${m2(d.amount)}</td></tr>
${d.paidAmount > 0 ? `<tr><td>المدفوع</td><td class="money"><span class="ltr">- ${m2(d.paidAmount)}</span></td></tr>` : ''}</tbody></table>
<div class="totals"><div class="row grand"><span>المبلغ المستحق</span><span>${m2(due)}</span></div></div>
<div class="words">${esc(tafqitHalalas(due))} فقط لا غير</div>
${bankBox(d.company, d.number, bankQr)}
${qr ? `<div class="box" style="display:flex;gap:12px;align-items:center"><img class="qr" src="${qr}" alt=""><div><h3>الدفع الإلكتروني</h3>مدى · Apple Pay · بطاقات ائتمانية<br><span class="ltr" style="font-size:9px">${esc(d.payUrl)}</span></div></div>` : ''}
${footer(d.company, `<span class="ltr">${esc(d.number)}</span>`)}`;
  return page(`طلب دفع ${d.number}`, body);
}

export interface InvoiceDoc {
  company: CompanyBlock;
  number: string;
  typeCode: string;
  subtype: string;
  issueDate: string;
  buyer: { name: string; vatNumber?: string | null; crNumber?: string | null; address?: string | null };
  contractNumber?: string | null;
  lines: { code: string; description: string; qty: string; unitPrice: string; net: Halalas; vat: Halalas; total: Halalas }[];
  taxable: Halalas;
  vat: Halalas;
  total: Halalas;
  prepaid: Halalas;
  balanceDue: Halalas;
  qrPayload?: string | null;
  zatcaStatus?: string | null;
  notes?: string | null;
}

const TITLES: Record<string, [string, string]> = {
  '388': ['فاتورة ضريبية', 'Tax Invoice'],
  '386': ['فاتورة ضريبية — دفعة مقدمة', 'Prepayment Tax Invoice'],
  '381': ['إشعار دائن', 'Credit Note'],
  '383': ['إشعار مدين', 'Debit Note'],
};

/** Mirror of a back-office invoice for the customer portal/WhatsApp (the legal original is the ERP one). */
export async function renderInvoiceHtml(d: InvoiceDoc): Promise<string> {
  const tax = d.company.vatRegistered;
  const [ar, en] = tax ? (TITLES[d.typeCode] ?? TITLES['388']!) : ['فاتورة', 'Invoice'];
  const simplified = tax && d.subtype === 'simplified' && d.typeCode === '388' ? ' مبسطة' : '';
  const qr = tax && d.qrPayload ? await QRCode.toDataURL(d.qrPayload, { margin: 1, width: 240, errorCorrectionLevel: 'M' }) : null;
  const rows = d.lines.map((l, i) => `<tr><td class="num">${i + 1}</td><td><span class="code">${esc(l.code)}</span> ${esc(l.description)}</td><td class="num">${esc(l.qty)}</td><td class="money">${esc(l.unitPrice)}</td><td class="money">${m2(l.net)}</td>${tax ? `<td class="money">${m2(l.vat)}</td>` : ''}<td class="money">${m2(l.total)}</td></tr>`).join('');
  const body = `${header(d.company)}
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
  <div><h1 class="doc">${ar}${simplified}</h1><div class="doc-en">${en}</div></div>
  ${qr ? `<img class="qr" src="${qr}" alt="ZATCA QR">` : ''}
</div>
<div class="accent"></div>
<div class="grid">
  <div class="cell"><span class="k">رقم الفاتورة</span><span class="v ltr">${esc(d.number)}</span></div>
  <div class="cell"><span class="k">تاريخ الإصدار</span><span class="v ltr">${esc(d.issueDate)}</span></div>
  <div class="cell"><span class="k">العقد</span><span class="v ltr">${esc(d.contractNumber ?? '')}</span></div>
  <div class="cell"><span class="k">حالة الربط مع زاتكا</span><span class="v">${esc(d.zatcaStatus ?? '')}</span></div>
  <div class="cell" style="grid-column:span 2"><span class="k">المشتري</span><span class="v">${esc(d.buyer.name)}</span></div>
  <div class="cell"><span class="k">الرقم الضريبي للمشتري</span><span class="v ltr">${esc(d.buyer.vatNumber ?? '')}</span></div>
  <div class="cell"><span class="k">س.ت المشتري</span><span class="v ltr">${esc(d.buyer.crNumber ?? '')}</span></div>
</div>
<table class="items"><thead><tr><th class="num">#</th><th>البيان</th><th class="num">الكمية</th><th class="num">سعر الوحدة</th><th class="num">الصافي</th>${tax ? '<th class="num">الضريبة</th>' : ''}<th class="num">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals">
  <div class="row"><span>الإجمالي غير شامل الضريبة</span><span>${m2(d.taxable)}</span></div>
  ${tax ? `<div class="row"><span>ضريبة القيمة المضافة 15%</span><span>${m2(d.vat)}</span></div>` : ''}
  <div class="row"><span>الإجمالي${tax ? ' شامل الضريبة' : ''}</span><span>${m2(d.total)}</span></div>
  ${d.prepaid > 0 ? `<div class="row"><span>دفعات مقدمة مخصومة</span><span class="ltr">- ${m2(d.prepaid)}</span></div>` : ''}
  <div class="row grand"><span>المبلغ المستحق</span><span>${m2(d.balanceDue)}</span></div>
</div>
${!tax ? '<div class="words">البائع غير مسجل في ضريبة القيمة المضافة.</div>' : ''}
${d.notes ? `<div class="box">${escLines(d.notes)}</div>` : ''}
${footer(d.company, `<span class="ltr">${esc(d.number)}</span>`)}`;
  return page(`${ar} ${d.number}`, body);
}
