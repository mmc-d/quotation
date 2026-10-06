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
  /** section the line belongs to (CPQ-13); null/absent = no section */
  sectionKey?: string | null;
  sectionTitle?: string | null;
}

export interface QuoteDocSection {
  key: string;
  title: string;
  /** Σ line amounts of the section, optional lines excluded */
  subtotal: Halalas;
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
  /** sections in print order; lines are grouped under them with a subtotal row each */
  sections?: QuoteDocSection[];
  totals: { subtotal: Halalas; discount: Halalas; taxable: Halalas; vat: Halalas; total: Halalas; vatApplied: boolean; vatRate: number; optionalTotal: Halalas };
  notes?: string | null;
  terms?: string | null;
  showImages?: boolean;
}

const money = (h: Halalas) => `${formatSar(h)} ${riyal}`;

/**
 * Print order: lines without a section, then each section (header row → its lines → subtotal row),
 * then the INS line last. Without sections the stored order is kept.
 */
export type PrintRow<L extends PrintableLine = QuoteDocLine> = { kind: 'line'; line: L } | { kind: 'head'; section: QuoteDocSection } | { kind: 'sub'; section: QuoteDocSection };
type PrintableLine = { isIns: boolean; sectionKey?: string | null };

/** Shared by the PDF and the Excel export so both group sections the same way. */
export function quotePrintRows<L extends PrintableLine>(q: { lines: L[]; sections?: QuoteDocSection[] }): PrintRow<L>[] {
  const sections = (q.sections ?? []).filter((s) => q.lines.some((l) => !l.isIns && l.sectionKey === s.key));
  if (!sections.length) return q.lines.map((line) => ({ kind: 'line' as const, line }));
  const known = new Set(sections.map((s) => s.key));
  const out: PrintRow<L>[] = [];
  for (const line of q.lines) if (!line.isIns && !(line.sectionKey && known.has(line.sectionKey))) out.push({ kind: 'line', line });
  for (const section of sections) {
    out.push({ kind: 'head', section });
    for (const line of q.lines) if (!line.isIns && line.sectionKey === section.key) out.push({ kind: 'line', line });
    out.push({ kind: 'sub', section });
  }
  for (const line of q.lines) if (line.isIns) out.push({ kind: 'line', line });
  return out;
}

export function renderQuoteHtml(q: QuoteDoc): string {
  const cols = q.showImages !== false ? 7 : 6;
  let n = 0;
  const rows = quotePrintRows(q).map((r) => {
    if (r.kind === 'head') {
      return `<tr class="section-head"><td colspan="${cols}" style="background:var(--tint);border-top:2px solid var(--primary);color:var(--primary);font-weight:800;padding:6px 8px">${esc(r.section.title)}</td></tr>`;
    }
    if (r.kind === 'sub') {
      return `<tr class="section-sub"><td colspan="${cols - 1}" style="text-align:left;font-weight:700;color:var(--gold-dk);background:#fbfaf6">المجموع الفرعي — ${esc(r.section.title)} / Subtotal</td><td class="money" style="background:#fbfaf6;border-top:1px solid var(--gold)">${money(r.section.subtotal)}</td></tr>`;
    }
    const l = r.line;
    const i = n++;
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
