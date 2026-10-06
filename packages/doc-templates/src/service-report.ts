import { esc, escLines, footer, header, page, type CompanyBlock } from './base.js';

/** Work-order service report (module 06 FSM-46): bilingual (Arabic first), handed to the customer. */
export interface ServiceReportDoc {
  company: CompanyBlock;
  number: string;
  /** survey | installation | commissioning | corrective | preventive | warranty | inspection */
  type: string;
  title: string;
  description?: string | null;
  date: string;
  customerName?: string | null;
  siteName?: string | null;
  siteAddress?: string | null;
  locationPath?: string | null;
  projectNumber?: string | null;
  ticketNumber?: string | null;
  /** project | warranty | amc | chargeable */
  coverage: string;
  coverageReason?: string | null;
  technicianName?: string | null;
  crewNames?: string[];
  checkInAt?: string | null;
  checkOutAt?: string | null;
  checklist: { labelAr: string; labelEn: string; done?: boolean; value?: string | null; required?: boolean }[];
  parts: { code: string; description?: string | null; qty: string; serial?: string | null }[];
  assets: { code: string; serial?: string | null; mac?: string | null; locationPath?: string | null }[];
  findings?: string | null;
  photoCount: number;
  signatureName?: string | null;
  /** PNG data URL of the customer's signature (optional) */
  signatureDataUrl?: string | null;
}

const TYPE_LABELS: Record<string, [string, string]> = {
  survey: ['معاينة', 'Site survey'],
  installation: ['تركيب', 'Installation'],
  commissioning: ['تشغيل واختبار', 'Commissioning'],
  corrective: ['إصلاح عطل', 'Corrective maintenance'],
  preventive: ['صيانة وقائية', 'Preventive maintenance'],
  warranty: ['زيارة ضمان', 'Warranty visit'],
  inspection: ['فحص', 'Inspection'],
};

const COVERAGE_LABELS: Record<string, [string, string]> = {
  project: ['ضمن المشروع', 'Project'],
  warranty: ['ضمن الضمان', 'Warranty'],
  amc: ['عقد صيانة', 'Maintenance contract'],
  chargeable: ['مدفوعة', 'Chargeable'],
};

const SR_CSS = `
.bi{display:block;color:var(--muted);font-size:9.5px;font-weight:500}
table.items td.ok{color:#1e7d4a;font-weight:800;text-align:center}
table.items td.no{color:#c0392b;font-weight:800;text-align:center}
.sigimg{max-height:70px;max-width:220px;object-fit:contain}
`;

const bi = (ar: string, en: string) => `${esc(ar)}<span class="bi ltr">${esc(en)}</span>`;

/** Only PNG/JPEG data URLs are embedded as images (anything else is dropped). */
const safeImage = (v: string | null | undefined) => (v && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null);

export function renderServiceReportHtml(d: ServiceReportDoc): string {
  const [typeAr, typeEn] = TYPE_LABELS[d.type] ?? [d.type, d.type];
  const [covAr, covEn] = COVERAGE_LABELS[d.coverage] ?? [d.coverage, d.coverage];
  const cell = (ar: string, en: string, v: unknown, opts: { span?: number; ltr?: boolean } = {}) =>
    `<div class="cell"${opts.span ? ` style="grid-column:span ${opts.span}"` : ''}><span class="k">${esc(ar)} · ${esc(en)}</span><span class="v${opts.ltr ? ' ltr' : ''}">${esc(v ?? '') || '—'}</span></div>`;
  const checklist = d.checklist.length
    ? `<div class="section"><div class="t">${bi('قائمة الفحص', 'Checklist')}</div>
<table class="items"><thead><tr><th>${bi('البند', 'Item')}</th><th class="num">${bi('الحالة', 'Status')}</th><th>${bi('ملاحظة', 'Note')}</th></tr></thead><tbody>
${d.checklist.map((i) => `<tr><td>${bi(i.labelAr, i.labelEn)}</td><td class="${i.done ? 'ok' : 'no'}">${i.done ? '✓' : '✗'}</td><td>${esc(i.value ?? '')}</td></tr>`).join('\n')}
</tbody></table></div>`
    : '';
  const assets = d.assets.length
    ? `<div class="section"><div class="t">${bi('الأجهزة المسجلة', 'Devices registered')}</div>
<table class="items"><thead><tr><th>${bi('الرمز', 'Code')}</th><th>${bi('الرقم التسلسلي', 'Serial')}</th><th>MAC</th><th>${bi('الموقع', 'Location')}</th></tr></thead><tbody>
${d.assets.map((a) => `<tr><td class="code">${esc(a.code)}</td><td class="ltr">${esc(a.serial ?? '')}</td><td class="ltr">${esc(a.mac ?? '')}</td><td>${esc(a.locationPath ?? '')}</td></tr>`).join('\n')}
</tbody></table></div>`
    : '';
  const parts = d.parts.length
    ? `<div class="section"><div class="t">${bi('القطع المستخدمة', 'Parts used')}</div>
<table class="items"><thead><tr><th>${bi('الرمز', 'Code')}</th><th>${bi('الوصف', 'Description')}</th><th class="num">${bi('الكمية', 'Qty')}</th><th>${bi('الرقم التسلسلي', 'Serial')}</th></tr></thead><tbody>
${d.parts.map((p) => `<tr><td class="code">${esc(p.code)}</td><td>${esc(p.description ?? '')}</td><td class="num">${esc(p.qty)}</td><td class="ltr">${esc(p.serial ?? '')}</td></tr>`).join('\n')}
</tbody></table></div>`
    : '';
  const sig = safeImage(d.signatureDataUrl);
  const body = `${header(d.company)}
<h1 class="doc">تقرير خدمة — ${esc(typeAr)}</h1><div class="doc-en">Service report — ${esc(typeEn)}</div>
<div class="accent"></div>
<div class="grid">
  ${cell('رقم أمر العمل', 'Work order', d.number, { ltr: true })}
  ${cell('التاريخ', 'Date', d.date, { ltr: true })}
  ${cell('التغطية', 'Coverage', `${covAr} / ${covEn}`)}
  ${cell('الفني', 'Technician', [d.technicianName, ...(d.crewNames ?? [])].filter(Boolean).join('، '))}
  ${cell('العميل', 'Customer', d.customerName, { span: 2 })}
  ${cell('الموقع', 'Site', [d.siteName, d.locationPath].filter(Boolean).join(' — '), { span: 2 })}
  ${d.siteAddress ? cell('العنوان', 'Address', d.siteAddress, { span: 4 }) : ''}
  ${cell('الوصول', 'Check-in', d.checkInAt, { ltr: true })}
  ${cell('المغادرة', 'Check-out', d.checkOutAt, { ltr: true })}
  ${cell('المشروع', 'Project', d.projectNumber, { ltr: true })}
  ${cell('البلاغ', 'Ticket', d.ticketNumber, { ltr: true })}
</div>
<div class="box"><h3>${esc(d.title)}</h3>${d.description ? escLines(d.description) : ''}${d.coverageReason ? `<div class="words">${esc(d.coverageReason)}</div>` : ''}</div>
${checklist}
${assets}
${parts}
${d.findings ? `<div class="section"><div class="t">${bi('الملاحظات والنتائج', 'Findings')}</div><div class="b">${escLines(d.findings)}</div></div>` : ''}
<div class="words">${esc(`عدد الصور المرفقة: ${d.photoCount}`)} · <span class="ltr">${esc(`Photos attached: ${d.photoCount}`)}</span></div>
<div class="sig">
  <div class="col"><b>${bi('الفني', 'Technician')}</b><div class="line"></div>${esc(d.technicianName ?? '')}</div>
  <div class="col"><b>${bi('توقيع العميل', 'Customer signature')}</b>${sig ? `<div><img class="sigimg" src="${esc(sig)}" alt=""></div>` : '<div class="line"></div>'}${esc(d.signatureName ?? '')}</div>
</div>
${footer(d.company, `<span class="ltr">${esc(d.number)}</span>`)}`;
  return page(`تقرير خدمة ${d.number}`, `<style>${SR_CSS}</style>${body}`);
}
