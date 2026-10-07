import { esc, escLines, footer, header, page, type CompanyBlock } from './base.js';

/** Request for quotation to a supplier (module 07, INV-65): bilingual, quantities only — no prices. */
export interface RfqDocLine {
  code: string;
  description?: string | null;
  qty: string;
}

export interface RfqDoc {
  company: CompanyBlock;
  number: string;
  date: string;
  dueDate?: string | null;
  supplier: { name: string; nameEn?: string | null; vatNumber?: string | null; email?: string | null; phone?: string | null };
  lines: RfqDocLine[];
  notes?: string | null;
}

export function renderRfqHtml(r: RfqDoc): string {
  const rows = r.lines.map((l, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td><span class="code">${esc(l.code)}</span></td>
      <td>${esc(l.description ?? '')}</td>
      <td class="num">${esc(l.qty)}</td>
      <td class="num"></td>
      <td class="num"></td>
    </tr>`).join('');
  const s = r.supplier;
  const body = `${header(r.company)}
<h1 class="doc">طلب عرض سعر</h1><div class="doc-en">Request for Quotation</div>
<div class="accent"></div>
<div class="grid">
  <div class="cell"><span class="k">رقم الطلب / RFQ No.</span><span class="v ltr">${esc(r.number)}</span></div>
  <div class="cell"><span class="k">التاريخ / Date</span><span class="v ltr">${esc(r.date)}</span></div>
  <div class="cell"><span class="k">آخر موعد للرد / Reply by</span><span class="v ltr">${esc(r.dueDate ?? '')}</span></div>
  <div class="cell"><span class="k">المورد / Supplier</span><span class="v">${esc(s.name)}${s.nameEn ? `<br><span class="ltr">${esc(s.nameEn)}</span>` : ''}</span></div>
</div>
<table class="items"><thead><tr>
  <th class="num">#</th><th>الموديل<br>Model</th><th>الوصف / Description</th><th class="num">الكمية<br>Qty</th><th class="num">سعر الوحدة<br>Unit price</th><th class="num">مدة التوريد<br>Lead time</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="box"><h3>المطلوب في العرض / Please quote</h3>
  العملة وسعر الوحدة، شروط التسليم (Incoterm)، مدة التوريد بالأيام، وصلاحية العرض.<br>
  <span class="ltr">Currency and unit price, delivery terms (Incoterm), lead time in days and offer validity.</span>
</div>
${r.notes ? `<div class="box"><h3>ملاحظات / Notes</h3>${escLines(r.notes)}</div>` : ''}
${footer(r.company, `<span class="ltr">${esc(r.number)}</span>`)}`;
  return page(`طلب عرض سعر ${r.number}`, body);
}
