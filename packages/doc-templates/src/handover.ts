import { esc, footer, header, page, type CompanyBlock } from './base.js';

/**
 * Handover package (module 05 PRJ-30): bilingual (Arabic + English) project handover with the device
 * schedule grouped by location, warranty terms, the approvals list and the acceptance certificate.
 * Device credentials are NEVER part of this document (PRJ-31) — the input type has no field for them.
 */
export interface HandoverDevice {
  code: string;
  description?: string | null;
  serial?: string | null;
  mac?: string | null;
  ip?: string | null;
  firmware?: string | null;
  installedOn?: string | null;
  testPassed?: boolean | null;
  labourWarrantyEnd?: string | null;
  partsWarrantyEnd?: string | null;
}

export interface HandoverDoc {
  company: CompanyBlock;
  project: { number: string; name: string; contractNumber?: string | null; managerName?: string | null };
  customer: { name: string; phone?: string | null; vatNumber?: string | null };
  site?: { name?: string | null; address?: string | null } | null;
  /** generation date (YYYY-MM-DD) */
  date: string;
  /** devices grouped by location path ("Building A / Floor 1 / Unit 3"); null location → unassigned */
  groups: { location: string | null; devices: HandoverDevice[] }[];
  warranty: { labourMonths: number; partsMonths: number; startsOn?: string | null; labourEnd?: string | null; partsEnd?: string | null };
  approvals: { kindAr: string; kindEn: string; title: string; revision: number; approvedOn?: string | null; approvedByName?: string | null }[];
  acceptance: { acceptedOn?: string | null; acceptedByName?: string | null };
}

const CSS = `
.h2{margin:12px 0 4px;color:var(--primary);font-size:13px;font-weight:800;border-inline-start:3px solid var(--gold);padding-inline-start:7px;page-break-after:avoid}
.h2 small{color:var(--gold-dk);font-weight:700;font-size:10.5px;margin-inline-start:6px}
.loc{margin:8px 0 2px;font-weight:800;color:var(--gold-dk);page-break-after:avoid}
table.items td.mono{font-family:monospace;font-size:10px;direction:ltr;text-align:left}
.ok{color:#1e7d46;font-weight:800}.no{color:#c0392b;font-weight:800}
.muted{color:var(--muted)}
`;

const h2 = (ar: string, en: string) => `<div class="h2">${esc(ar)}<small class="ltr">${esc(en)}</small></div>`;
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : esc(v));

export function renderHandoverHtml(d: HandoverDoc): string {
  const co = d.company;
  const total = d.groups.reduce((s, g) => s + g.devices.length, 0);
  const cell = (kAr: string, kEn: string, v: unknown) => `<div class="cell"><span class="k">${esc(kAr)} / <span class="ltr">${esc(kEn)}</span></span><span class="v">${dash(v)}</span></div>`;
  const devices = d.groups.length === 0
    ? '<p class="muted">لا توجد أجهزة مسجلة / No devices registered</p>'
    : d.groups.map((g) => `<div class="loc">${g.location ? esc(g.location) : 'غير محدد الموقع / Unassigned'} <span class="muted">(${g.devices.length})</span></div>
<table class="items"><thead><tr><th class="num">#</th><th>الموديل<br><small>Model</small></th><th>الوصف<br><small>Description</small></th><th>الرقم التسلسلي<br><small>Serial</small></th><th>MAC</th><th>IP</th><th>البرنامج<br><small>Firmware</small></th><th class="num">الاختبار<br><small>Test</small></th></tr></thead><tbody>${g.devices.map((x, i) => `<tr><td class="num">${i + 1}</td><td><span class="code">${esc(x.code)}</span></td><td>${dash(x.description)}</td><td class="mono">${dash(x.serial)}</td><td class="mono">${dash(x.mac)}</td><td class="mono">${dash(x.ip)}</td><td class="mono">${dash(x.firmware)}</td><td class="num">${x.testPassed === true ? '<span class="ok">✓</span>' : x.testPassed === false ? '<span class="no">✗</span>' : '—'}</td></tr>`).join('')}</tbody></table>`).join('');
  const w = d.warranty;
  const approvals = d.approvals.length === 0
    ? '<p class="muted">—</p>'
    : `<table class="items"><thead><tr><th>البند<br><small>Item</small></th><th>العنوان<br><small>Title</small></th><th class="num">المراجعة<br><small>Rev.</small></th><th class="num">تاريخ الاعتماد<br><small>Approved on</small></th><th>المعتمِد<br><small>Approved by</small></th></tr></thead><tbody>${d.approvals.map((a) => `<tr><td>${esc(a.kindAr)} / <span class="ltr">${esc(a.kindEn)}</span></td><td>${esc(a.title)}</td><td class="num">${esc(a.revision)}</td><td class="num">${dash(a.approvedOn)}</td><td>${dash(a.approvedByName)}</td></tr>`).join('')}</tbody></table>`;
  const body = `${header(co)}
<style>${CSS}</style>
<div style="text-align:center"><h1 class="doc">ملف تسليم المشروع</h1><div class="doc-en" style="font-size:13px">Project Handover Package</div><div class="badge ltr">${esc(d.project.number)} · ${esc(d.date)}</div></div>
<div class="accent"></div>
<div class="grid">
  ${cell('المشروع', 'Project', d.project.name)}
  ${cell('رقم العقد', 'Contract', d.project.contractNumber)}
  ${cell('العميل', 'Customer', d.customer.name)}
  ${cell('مدير المشروع', 'Project manager', d.project.managerName)}
  ${cell('الموقع', 'Site', d.site?.name)}
  ${cell('العنوان', 'Address', d.site?.address)}
  ${cell('عدد الأجهزة', 'Devices', total)}
  ${cell('تاريخ الاستلام', 'Accepted on', d.acceptance.acceptedOn)}
</div>
${h2('جدول الأجهزة المركبة', 'Installed device schedule')}
${devices}
<p class="muted" style="font-size:9.5px">بيانات الدخول وكلمات المرور لا تُطبع في هذا الملف وتُسلَّم بشكل منفصل وآمن. / Login details are not printed in this document; they are handed over separately and securely.</p>
${h2('الضمان', 'Warranty')}
<div class="box">
  <div>يبدأ الضمان من تاريخ توقيع محضر الاستلام / The warranty starts on the acceptance date: <b class="ltr">${dash(w.startsOn)}</b></div>
  <div>ضمان التركيب والعمالة: ${esc(w.labourMonths)} شهرًا — ينتهي في <b class="ltr">${dash(w.labourEnd)}</b> / Labour warranty: ${esc(w.labourMonths)} months — ends <span class="ltr">${dash(w.labourEnd)}</span></div>
  <div>ضمان القطع: ${esc(w.partsMonths)} شهرًا — ينتهي في <b class="ltr">${dash(w.partsEnd)}</b> / Parts warranty: ${esc(w.partsMonths)} months — ends <span class="ltr">${dash(w.partsEnd)}</span></div>
  <div class="muted" style="font-size:10px">لا يشمل الضمان سوء الاستخدام أو الكسر أو التعديل من غير فنيي الشركة. / The warranty excludes misuse, physical damage and modifications by anyone other than the company's technicians.</div>
</div>
${h2('اعتمادات العميل', 'Client approvals')}
${approvals}
${h2('محضر الاستلام', 'Acceptance certificate')}
<div class="box">يقر العميل باستلام الأعمال والأجهزة الموضحة أعلاه بحالة سليمة وعاملة، وبتلقي التدريب على استخدامها.<br><span class="ltr">The customer confirms receipt of the works and devices listed above in good working order, and that training on their use was provided.</span>
${d.acceptance.acceptedByName ? `<div style="margin-top:4px">المستلم / Accepted by: <b>${esc(d.acceptance.acceptedByName)}</b>${d.acceptance.acceptedOn ? ` — <span class="ltr">${esc(d.acceptance.acceptedOn)}</span>` : ''}</div>` : ''}</div>
<div class="sig">
  <div class="col"><b style="color:var(--gold-dk)">العميل / Customer</b><div>${esc(d.customer.name)}</div><div style="color:var(--muted)">${esc(d.acceptance.acceptedByName ?? '')}</div><div class="line"></div><small>الاسم والتوقيع والتاريخ / Name, signature &amp; date</small></div>
  <div class="col"><b style="color:var(--gold-dk)">المورد / Contractor</b><div>${esc(co.legalNameAr)}</div><div style="color:var(--muted)">${esc(d.project.managerName ?? co.representativeName ?? '')}</div><div class="line"></div><small>الاسم والتوقيع والختم / Name, signature &amp; stamp</small></div>
</div>
${footer(co, `<span class="ltr">${esc(d.project.number)}</span>`)}`;
  return page(`ملف تسليم ${d.project.number}`, body);
}
