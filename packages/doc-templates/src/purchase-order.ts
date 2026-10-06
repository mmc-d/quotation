import { formatSar, type Halalas } from '@mmc/domain';
import { esc, escLines, footer, header, page, riyal, type CompanyBlock } from './base.js';

/** Purchase order (module 07, INV-61): bilingual, multi-currency, Incoterm and deposit. */
export interface PurchaseOrderDocLine {
  code: string;
  description?: string | null;
  qty: string;
  /** minor units of the PO currency (cents / fen / halalas) */
  unitPrice: Halalas;
  amount: Halalas;
}

export interface PurchaseOrderDoc {
  company: CompanyBlock;
  number: string;
  date: string;
  expectedOn?: string | null;
  status?: string | null;
  supplier: { name: string; nameEn?: string | null; vatNumber?: string | null; crNumber?: string | null; phone?: string | null; email?: string | null };
  currency: string;
  /** SAR per 1 unit of the currency */
  rateToSar: string;
  incoterm?: string | null;
  depositPercent: number;
  projectRef?: string | null;
  lines: PurchaseOrderDocLine[];
  totals: { subtotal: Halalas; vat: Halalas; total: Halalas; totalSar: Halalas; deposit: Halalas };
  approvedBy?: string | null;
  notes?: string | null;
}

/** Money in the PO currency: SAR uses the riyal glyph, other currencies their ISO code. */
function money(h: Halalas, currency: string): string {
  return currency === 'SAR' ? `${formatSar(h)} ${riyal}` : `<span class="ltr">${esc(formatSar(h))} ${esc(currency)}</span>`;
}

export function renderPurchaseOrderHtml(po: PurchaseOrderDoc): string {
  const cur = po.currency;
  const rows = po.lines.map((l, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td><span class="code">${esc(l.code)}</span></td>
      <td>${esc(l.description ?? '')}</td>
      <td class="num">${esc(l.qty)}</td>
      <td class="money">${money(l.unitPrice, cur)}</td>
      <td class="money">${money(l.amount, cur)}</td>
    </tr>`).join('');
  const s = po.supplier;
  const t = po.totals;
  const body = `${header(po.company)}
<h1 class="doc">أمر شراء</h1><div class="doc-en">Purchase Order</div>
<div class="accent"></div>
<div class="grid">
  <div class="cell"><span class="k">رقم الأمر / PO No.</span><span class="v ltr">${esc(po.number)}</span></div>
  <div class="cell"><span class="k">التاريخ / Date</span><span class="v ltr">${esc(po.date)}</span></div>
  <div class="cell"><span class="k">التسليم المتوقع / Expected</span><span class="v ltr">${esc(po.expectedOn ?? '')}</span></div>
  <div class="cell"><span class="k">شروط التسليم / Incoterm</span><span class="v ltr">${esc(po.incoterm ?? '')}</span></div>
  <div class="cell"><span class="k">المورد / Supplier</span><span class="v">${esc(s.name)}${s.nameEn ? `<br><span class="ltr">${esc(s.nameEn)}</span>` : ''}</span></div>
  <div class="cell"><span class="k">الرقم الضريبي / VAT No.</span><span class="v ltr">${esc(s.vatNumber ?? '')}</span></div>
  <div class="cell"><span class="k">العملة / Currency</span><span class="v ltr">${esc(cur)}${cur !== 'SAR' ? ` (1 ${esc(cur)} = ${esc(po.rateToSar)} SAR)` : ''}</span></div>
  <div class="cell"><span class="k">المشروع / Project</span><span class="v">${esc(po.projectRef ?? '')}</span></div>
</div>
<table class="items"><thead><tr>
  <th class="num">#</th><th>الموديل<br>Model</th><th>الوصف / Description</th><th class="num">الكمية<br>Qty</th><th class="num">سعر الوحدة<br>Unit price</th><th class="num">الإجمالي<br>Amount</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="totals">
  <div class="row"><span>المجموع / Subtotal</span><span>${money(t.subtotal, cur)}</span></div>
  ${t.vat > 0 ? `<div class="row"><span>ضريبة القيمة المضافة 15% / VAT</span><span>${money(t.vat, cur)}</span></div>` : ''}
  <div class="row grand"><span>الإجمالي / Total</span><span>${money(t.total, cur)}</span></div>
  ${cur !== 'SAR' ? `<div class="row"><span>المعادل بالريال / SAR equivalent</span><span>${money(t.totalSar, 'SAR')}</span></div>` : ''}
  ${po.depositPercent > 0 ? `<div class="row"><span>الدفعة المقدمة ${esc(po.depositPercent)}% / Deposit</span><span>${money(t.deposit, cur)}</span></div>` : ''}
</div>
${cur !== 'SAR' ? '<div class="words">ضريبة الاستيراد تُسدَّد عند التخليص الجمركي. / Import VAT is paid at customs clearance.</div>' : ''}
${po.notes ? `<div class="box"><h3>ملاحظات / Notes</h3>${escLines(po.notes)}</div>` : ''}
<div class="sig">
  <div class="col"><b>المعتمد / Approved by</b><div class="line"></div>${esc(po.approvedBy ?? '')}</div>
  <div class="col"><b>المورد / Supplier acceptance</b><div class="line"></div></div>
</div>
${footer(po.company, `<span class="ltr">${esc(po.number)}</span>`)}`;
  return page(`أمر شراء ${po.number}`, body);
}
