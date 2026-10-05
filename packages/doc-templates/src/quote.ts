import { formatSar, tafqitHalalas, type Halalas } from '@mmc/domain';
import { esc, escLines, footer, header, page, riyal, type CompanyBlock } from './base.js';

export interface QuoteDocLine {
  code: string;
  description: string;
  qty: string;
  unitPrice: Halalas;
  amount: Halalas;
  listAmount: Halalas;
  isFree: boolean;
  struck: boolean;
  isOptional: boolean;
  isIns: boolean;
  imageUrl?: string | null;
}

export interface QuoteDoc {
  company: CompanyBlock;
  number: string;
  revision: number;
  date: string;
  validUntil?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  projectName?: string | null;
  projectLocation?: string | null;
  salesRep?: string | null;
  lines: QuoteDocLine[];
  totals: { subtotal: Halalas; discount: Halalas; taxable: Halalas; vat: Halalas; total: Halalas; vatApplied: boolean; vatRate: number; optionalTotal: Halalas };
  notes?: string | null;
  terms?: string | null;
  showImages?: boolean;
}

const money = (h: Halalas) => `${formatSar(h)} ${riyal}`;

export function renderQuoteHtml(q: QuoteDoc): string {
  const rows = q.lines.map((l, i) => {
    const total = l.isFree ? `${l.struck ? `<span class="strike">${formatSar(l.listAmount)}</span>` : ''}<span class="free">FREE</span>` : `${l.struck ? `<span class="strike">${formatSar(l.listAmount)}</span>` : ''}${money(l.amount)}`;
    return `<tr class="${l.isIns ? 'ins' : ''}${l.isOptional ? ' optional' : ''}">
      <td class="num">${i + 1}</td>
      <td><span class="code">${esc(l.code)}</span></td>
      ${q.showImages !== false ? `<td class="num">${l.imageUrl ? `<img class="pic" src="${esc(l.imageUrl)}" alt="">` : ''}</td>` : ''}
      <td>${esc(l.description)}${l.isOptional ? ' <span class="badge">اختياري / Optional</span>' : ''}</td>
      <td class="num">${esc(l.qty)}</td>
      <td class="money">${l.isFree ? '<span class="free">FREE</span>' : money(l.unitPrice)}</td>
      <td class="money">${total}</td>
    </tr>`;
  }).join('');
  const t = q.totals;
  const rev = q.revision > 0 ? ` <span class="badge">R${q.revision}</span>` : '';
  const body = `${header(q.company)}
<h1 class="doc">عرض سعر${rev}</h1><div class="doc-en">Quotation</div>
<div class="accent"></div>
<div class="grid">
  <div class="cell"><span class="k">رقم العرض / No.</span><span class="v ltr">${esc(q.number)}</span></div>
  <div class="cell"><span class="k">التاريخ / Date</span><span class="v ltr">${esc(q.date)}</span></div>
  <div class="cell"><span class="k">صالح حتى / Valid until</span><span class="v ltr">${esc(q.validUntil ?? '')}</span></div>
  <div class="cell"><span class="k">مسؤول المبيعات / Sales</span><span class="v">${esc(q.salesRep ?? '')}</span></div>
  <div class="cell"><span class="k">العميل / Client</span><span class="v">${esc(q.clientName ?? '')}</span></div>
  <div class="cell"><span class="k">الجوال / Mobile</span><span class="v ltr">${esc(q.clientPhone ?? '')}</span></div>
  <div class="cell"><span class="k">المشروع / Project</span><span class="v">${esc(q.projectName ?? '')}</span></div>
  <div class="cell"><span class="k">الموقع / Location</span><span class="v">${esc(q.projectLocation ?? '')}</span></div>
</div>
<table class="items"><thead><tr>
  <th class="num">#</th><th>الموديل<br>Model</th>${q.showImages !== false ? '<th class="num">صورة</th>' : ''}<th>الوصف / Description</th><th class="num">الكمية<br>Qty</th><th class="num">السعر<br>Price</th><th class="num">الإجمالي<br>Total</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="totals">
  <div class="row"><span>المجموع / Subtotal</span><span>${money(t.subtotal)}</span></div>
  ${t.discount > 0 ? `<div class="row"><span>الخصم / Discount</span><span class="ltr">- ${money(t.discount)}</span></div><div class="row"><span>بعد الخصم / After discount</span><span>${money(t.taxable)}</span></div>` : ''}
  ${t.vatApplied ? `<div class="row"><span>ضريبة القيمة المضافة ${t.vatRate}% / VAT</span><span>${money(t.vat)}</span></div>` : ''}
  <div class="row grand"><span>الإجمالي${t.vatApplied ? ' شامل الضريبة' : ''} / Total</span><span>${money(t.total)}</span></div>
</div>
<div class="words">${esc(tafqitHalalas(t.total))} فقط لا غير</div>
${t.optionalTotal > 0 ? `<div class="words">البنود الاختيارية غير مشمولة في الإجمالي: ${money(t.optionalTotal)}</div>` : ''}
${!t.vatApplied ? `<div class="words">الأسعار لا تشمل ضريبة القيمة المضافة — المنشأة غير مسجلة في ضريبة القيمة المضافة.</div>` : ''}
${q.notes ? `<div class="box"><h3>ملاحظات فنية / Technical notes</h3>${escLines(q.notes)}</div>` : ''}
${q.terms ? `<div class="box"><h3>الشروط والأحكام / Terms</h3>${escLines(q.terms)}</div>` : ''}
${footer(q.company, `<span class="ltr">${esc(q.number)}</span>`)}`;
  return page(`عرض سعر ${q.number}`, body);
}
