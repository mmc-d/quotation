import { formatSar2, tafqitHalalas, type Halalas } from '@mmc/domain';
import { esc, escLines, footer, header, page, riyal, type CompanyBlock } from './base.js';

export interface ContractDoc {
  company: CompanyBlock;
  number: string;
  date: string;
  title: string;
  subtitle?: string | null;
  client: { name?: string; representative?: string; idNumber?: string; crNumber?: string; vatNumber?: string; address?: string; mobile?: string };
  clauses: { titleAr: string; bodyAr: string }[];
  lines: { code: string; description: string; qty: string; unitPrice: Halalas; amount: Halalas }[];
  totals: { subtotal: Halalas; discount: Halalas; vat: Halalas; total: Halalas; vatOn: boolean };
  milestones: { nameAr: string; percent: number; amount: Halalas }[];
  /** stamp only on approved contracts, applied explicitly by an authorised user */
  applyStamp: boolean;
}

const m2 = (h: Halalas) => `${formatSar2(h)} ${riyal}`;

export function renderContractHtml(c: ContractDoc): string {
  const co = c.company;
  const second = `<b>${esc(co.legalNameAr)}</b>${co.representativeName ? `، ويمثلها الأستاذ/ <b>${esc(co.representativeName)}</b>` : ''}، ويشار إليها لاحقًا بـ "الطرف الثاني"${co.addressLine ? `، ومقرها ${esc(co.addressLine)}` : ''}${co.unifiedNumber || co.crNumber ? `، سجل تجاري رقم ${esc(co.unifiedNumber || co.crNumber)}` : ''}${co.representativeMobile ? `، جوال: <span class="ltr">${esc(co.representativeMobile)}</span>` : ''}.`;
  const cl = c.client;
  const first = `<b>${esc(cl.name ?? '')}</b>${cl.crNumber ? `، سجل تجاري رقم <b>${esc(cl.crNumber)}</b>` : ''}${cl.vatNumber ? `، الرقم الضريبي <b>${esc(cl.vatNumber)}</b>` : ''}${cl.representative ? `، ويمثلها الأستاذ/ <b>${esc(cl.representative)}</b>` : ''}${cl.idNumber ? ` (هوية رقم ${esc(cl.idNumber)})` : ''}، ويشار إليه لاحقًا بـ "الطرف الأول"${cl.address ? `، ومقره: <b>${esc(cl.address)}</b>` : ''}${cl.mobile ? ` جوال: <b class="ltr">${esc(cl.mobile)}</b>` : ''}`;
  const rows = c.lines.map((l, i) => `<tr><td class="num">${i + 1}</td><td><span class="code">${esc(l.code)}</span></td><td>${esc(l.description)}</td><td class="num">${esc(l.qty)}</td><td class="money">${m2(l.unitPrice)}</td><td class="money">${m2(l.amount)}</td></tr>`).join('');
  const t = c.totals;
  const pay = c.milestones.map((m, i) => `<p><b>${i + 1}- ${esc(m.nameAr)}:</b> بنسبة ${m.percent}% من إجمالي قيمة العقد، وقدرها (<b>${m2(m.amount)}</b>) فقط ${esc(tafqitHalalas(m.amount))} لا غير.</p>`).join('');
  let article = 0;
  const clause = (title: string, bodyHtml: string) => `<div class="section"><div class="t">المادة (${++article}): ${esc(title)}</div><div class="b">${bodyHtml}</div></div>`;
  const preamble = c.clauses.find((x) => x.titleAr === 'تمهيد');
  const others = c.clauses.filter((x) => x !== preamble);
  const specs = others.find((x) => x.titleAr.includes('المواصفات'));
  const beforeSpecs = specs ? others.slice(0, others.indexOf(specs)) : others.slice(0, 1);
  const afterSpecs = specs ? others.slice(others.indexOf(specs) + 1) : others.slice(1);
  const scopeIdx = afterSpecs.findIndex((x) => x.titleAr.includes('نطاق'));
  const beforePayments = scopeIdx >= 0 ? afterSpecs.slice(0, scopeIdx + 1) : [];
  const afterPayments = scopeIdx >= 0 ? afterSpecs.slice(scopeIdx + 1) : afterSpecs;
  const body = `${header(co)}
<div style="text-align:center"><h1 class="doc">${esc(c.title)}</h1>${c.subtitle ? `<div class="doc-en" style="font-size:13px">${esc(c.subtitle)}</div>` : ''}<div class="badge ltr">${esc(c.number)} · ${esc(c.date)}</div></div>
<div class="accent"></div>
<div class="section"><div class="t">الطرف الأول (العميل / First Party)</div><div class="b">${first}</div></div>
<div class="section"><div class="t">الطرف الثاني (المورد / Second Party)</div><div class="b">${second}</div></div>
${preamble ? `<div class="section"><div class="t">تمهيد</div><div class="b">${escLines(preamble.bodyAr)}</div></div>` : ''}
${beforeSpecs.map((x) => clause(x.titleAr, escLines(x.bodyAr))).join('')}
${clause(specs?.titleAr ?? 'المواصفات الفنية والأسعار', `${specs ? `<p>${escLines(specs.bodyAr)}</p>` : ''}
<table class="items"><thead><tr><th class="num">#</th><th>الموديل</th><th>الوصف</th><th class="num">الكمية</th><th class="num">سعر الوحدة</th><th class="num">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals">
  ${t.discount > 0 ? `<div class="row"><span>المجموع</span><span>${m2(t.subtotal)}</span></div><div class="row"><span>خصم / Discount</span><span class="ltr">- ${m2(t.discount)}</span></div>` : ''}
  ${t.vatOn ? `<div class="row"><span>ضريبة القيمة المضافة 15%</span><span>${m2(t.vat)}</span></div>` : ''}
  <div class="row grand"><span>الإجمالي${t.vatOn ? ' شامل الضريبة' : ''}</span><span>${m2(t.total)}</span></div>
</div>`)}
${beforePayments.map((x) => clause(x.titleAr, escLines(x.bodyAr))).join('')}
${clause('الدفعات وآلية السداد', `<p>يتم سداد قيمة هذا العقد على دفعات وفقًا لآلية السداد التالية:</p>
<p><b>إجمالي قيمة العقد${t.vatOn ? ' (شامل ضريبة القيمة المضافة)' : ''}:</b> مبلغ وقدره (<b>${m2(t.total)}</b>) فقط ${esc(tafqitHalalas(t.total))} لا غير.</p>
${pay}
${co.bankName || co.iban ? `<p>يتم تحويل الدفعات إلى الحساب البنكي التالي الخاص بالطرف الثاني:</p><div class="box">${esc(co.bankName ?? '')}${co.iban ? `<br><span class="ltr">IBAN: ${esc(co.iban)}</span>` : ''}</div>` : ''}`)}
${afterPayments.map((x) => clause(x.titleAr, escLines(x.bodyAr))).join('')}
<div class="sig">
  <div class="col"><b style="color:var(--gold-dk)">الطرف الأول / First Party</b><div>${esc(cl.name ?? '')}</div><div style="color:var(--muted)">${esc(cl.representative ?? '')}</div><div class="line"></div><small>التوقيع والختم / Signature &amp; Stamp</small></div>
  <div class="col"><b style="color:var(--gold-dk)">الطرف الثاني / Second Party</b><div>${esc(co.legalNameAr)}</div><div style="color:var(--muted)">${esc(co.representativeName ?? '')}</div>
    ${c.applyStamp && co.stampDataUrl ? `<img class="stamp" src="${esc(co.stampDataUrl)}" alt="">` : '<div class="line"></div>'}<small>التوقيع والختم / Signature &amp; Stamp</small></div>
</div>
${footer(co, `<span class="ltr">${esc(c.number)}</span>`)}`;
  return page(`عقد ${c.number}`, body);
}
