import { formatSar2, offerPackage, tafqitHalalas, toHalalas, type Allowance } from '@mmc/domain';
import { esc, escLines, footer, header, page, riyal, type CompanyBlock } from './base.js';

export interface OfferDoc {
  company: CompanyBlock;
  number: string;
  offerDate: string;
  validUntil: string;
  candidateNameAr: string;
  candidateNameEn?: string | null;
  nationality?: string | null;
  idNumber?: string | null;
  mobile?: string | null;
  email?: string | null;
  jobTitleAr: string;
  jobTitleEn?: string | null;
  department?: string | null;
  reportsTo?: string | null;
  workLocation?: string | null;
  contractType: string;
  durationMonths?: number | null;
  employmentType: string;
  startDate: string;
  probationDays: number;
  weeklyHours: number;
  workDays?: string | null;
  annualLeaveDays: number;
  noticeDays?: number | null;
  basicSalary: string;
  housingAllowance: string;
  transportAllowance: string;
  otherAllowances: Allowance[];
  medicalInsurance: string;
  annualTicket: string;
  otherBenefits?: string | null;
  termsAr?: string | null;
  status: string;
  approvedByName?: string | null;
  approvedAt?: string | null;
  respondedAt?: string | null;
}

const EMPLOYMENT_AR: Record<string, string> = { full_time: 'دوام كامل', part_time: 'دوام جزئي', temporary: 'عمل مؤقت' };
const COVER_AR: Record<string, string> = { none: 'لا يشمل', employee: 'للموظف', family: 'للموظف وأسرته' };

const CSS = `
.otitle{display:flex;justify-content:space-between;align-items:flex-end;margin:8px 0 10px}
.otitle .t{background:var(--primary);color:#fff;border-radius:8px;padding:6px 22px;text-align:center;box-shadow:inset 0 -3px 0 var(--gold)}
.otitle .t b{display:block;font-size:20px;line-height:1.3}
.otitle .t span{font-size:9px;letter-spacing:2px;color:#e9dcb4}
.greet{margin:6px 0 10px;line-height:1.9}
h3.sec{color:var(--primary);font-size:13px;margin:9px 0 4px;border-inline-start:3px solid var(--gold);padding-inline-start:7px}
table.kv{width:100%;border-collapse:collapse}
table.kv td{border:1px solid var(--line);padding:4px 8px}
table.kv td.k{background:var(--tint);color:var(--gold-dk);font-weight:700;width:28%}
table.kv.pairs td.k{width:17%}
table.kv.pairs td{width:33%}
table.kv td.money{text-align:left;font-weight:700;white-space:nowrap}
table.kv tr.total td{background:var(--primary);color:#fff;font-weight:800}
table.kv tr.total .sar{filter:brightness(10)}
ol.terms{margin:2px 0;padding-inline-start:20px;line-height:1.65}
.osig{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:18px;page-break-inside:avoid}
.osig .col{border:1px solid var(--line);border-radius:6px;padding:8px 10px;min-height:130px}
.osig .col b{color:var(--primary)}
.osig .line{border-bottom:1px dotted var(--ink);height:26px;margin:2px 0}
.osig img.stamp{display:block;width:120px;height:120px;margin:4px auto 0;transform:rotate(-7deg);opacity:.95}
.osig .by{display:block;text-align:center;color:#1f5fae;font-weight:700;font-size:10px}
.wm{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:90px;font-weight:800;color:rgba(192,57,43,.12);transform:rotate(-20deg);pointer-events:none}
`;

/** Job offer letter (عرض وظيفي). Issued offers carry the company stamp; the candidate signs the acceptance box. */
export function renderOfferHtml(d: OfferDoc): string {
  const pkg = offerPackage(d);
  const sar = (h: number) => `${formatSar2(h)} ${riyal}`;
  // two label/value pairs per row
  const pairs = (items: [string, string | null | undefined][]) => {
    const xs = items.filter(([, v]) => v) as [string, string][];
    const out: string[] = [];
    for (let i = 0; i < xs.length; i += 2) out.push(`<tr>${xs.slice(i, i + 2).map(([k, v]) => `<td class="k">${k}</td><td>${v}</td>`).join('')}${i + 1 < xs.length ? '' : '<td class="k"></td><td></td>'}</tr>`);
    return `<table class="kv pairs">${out.join('')}</table>`;
  };
  const contract = d.contractType === 'fixed'
    ? `محدد المدة — ${esc(d.durationMonths ?? '')} شهرًا`
    : 'غير محدد المدة';
  const issued = ['approved', 'accepted'].includes(d.status);
  const wm = d.status === 'draft' ? 'مسودة' : d.status === 'cancelled' ? 'ملغى' : d.status === 'rejected' ? 'مرفوض' : d.status === 'expired' ? 'منتهي' : '';
  const stamp = issued && d.company.stampDataUrl
    ? `<img class="stamp" src="${esc(d.company.stampDataUrl)}" alt=""><small class="by">${esc(d.approvedByName ?? '')} · <span class="ltr">${esc((d.approvedAt ?? '').slice(0, 10))}</span></small>`
    : issued ? `<div class="line"></div><small class="by">${esc(d.approvedByName ?? '')} · <span class="ltr">${esc((d.approvedAt ?? '').slice(0, 10))}</span></small>` : '<div class="line"></div><div class="line"></div>';
  const standardTerms = [
    'يخضع هذا العرض لأحكام نظام العمل في المملكة العربية السعودية ولائحته التنفيذية، ويُوقَّع عقد العمل الرسمي ويوثَّق عبر منصة «قوى» عند المباشرة.',
    'العرض مشروط بصحة البيانات والمستندات المقدّمة واستكمال متطلبات التعيين النظامية.',
    'يُسجَّل الموظف في المؤسسة العامة للتأمينات الاجتماعية، وتُستقطع حصته النظامية من الأجر.',
    'يستحق الموظف مكافأة نهاية الخدمة وفق نظام العمل.',
    `يسري هذا العرض حتى <span class="ltr">${esc(d.validUntil)}</span>، ويُعدّ لاغيًا ما لم يُقبل كتابيًا قبل ذلك التاريخ.`,
  ];
  const extra = (d.termsAr ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const body = `${header(d.company)}
${wm ? `<div class="wm">${wm}</div>` : ''}
<div class="otitle">
  <div class="grid" style="grid-template-columns:auto auto auto;margin:0">
    <div class="cell"><span class="k">رقم العرض</span><span class="v ltr">${esc(d.number)}</span></div>
    <div class="cell"><span class="k">التاريخ</span><span class="v ltr">${esc(d.offerDate)}</span></div>
    <div class="cell"><span class="k">صالح حتى</span><span class="v ltr">${esc(d.validUntil)}</span></div>
  </div>
  <div class="t"><b>عرض وظيفي</b><span>JOB OFFER</span></div>
</div>
<div class="greet">
  السيد / السيدة <b>${esc(d.candidateNameAr)}</b>${d.candidateNameEn ? ` (<span class="ltr">${esc(d.candidateNameEn)}</span>)` : ''} المحترم/ة،<br>
  تحية طيبة وبعد،<br>
  يسرّ <b>${esc(d.company.legalNameAr)}</b> أن تقدّم لكم عرضًا للعمل لديها بوظيفة <b>${esc(d.jobTitleAr)}</b>${d.jobTitleEn ? ` (<span class="ltr">${esc(d.jobTitleEn)}</span>)` : ''} وفق الشروط التالية:
</div>

<h3 class="sec">بيانات الوظيفة</h3>
${pairs([
  ['المسمى الوظيفي', esc(d.jobTitleAr)],
  ['الإدارة / القسم', d.department ? esc(d.department) : null],
  ['المرجع المباشر', d.reportsTo ? esc(d.reportsTo) : null],
  ['مقر العمل', d.workLocation ? esc(d.workLocation) : null],
  ['تاريخ المباشرة', `<span class="ltr">${esc(d.startDate)}</span>`],
  ['نوع العقد', `${contract} · ${EMPLOYMENT_AR[d.employmentType] ?? esc(d.employmentType)}`],
  ['فترة التجربة', d.probationDays ? `${esc(d.probationDays)} يومًا` : 'بدون فترة تجربة'],
  ['ساعات العمل', `${esc(d.weeklyHours)} ساعة أسبوعيًا${d.workDays ? ` · ${esc(d.workDays)}` : ''}`],
  ['مدة الإشعار', d.noticeDays ? `${esc(d.noticeDays)} يومًا` : null],
])}

<h3 class="sec">الأجر الشهري</h3>
${pairs([
  ['الراتب الأساسي', pkg.basic ? sar(pkg.basic) : null],
  ['بدل السكن', pkg.housing ? sar(pkg.housing) : null],
  ['بدل النقل', pkg.transport ? sar(pkg.transport) : null],
  ...d.otherAllowances.map((a): [string, string] => [esc(a.label), sar(toHalalas(a.amount))]),
])}
<table class="kv pairs" style="border-top:0">
  <tr class="total"><td class="k" style="background:var(--primary);color:#fff">الإجمالي الشهري</td><td class="money">${sar(pkg.monthly)}</td><td class="k">الإجمالي السنوي</td><td class="money" style="background:#fff;color:var(--ink)">${sar(pkg.annual)}</td></tr>
  <tr><td class="k">كتابةً</td><td colspan="3">${esc(tafqitHalalas(pkg.monthly))} شهريًا فقط لا غير</td></tr>
</table>

<h3 class="sec">المزايا</h3>
${pairs([
  ['الإجازة السنوية', `${esc(d.annualLeaveDays)} يومًا مدفوعة الأجر`],
  ['التأمين الطبي', COVER_AR[d.medicalInsurance] ?? esc(d.medicalInsurance)],
  ['تذكرة السفر السنوية', COVER_AR[d.annualTicket] ?? esc(d.annualTicket)],
  ['مزايا أخرى', d.otherBenefits ? escLines(d.otherBenefits) : null],
])}

<h3 class="sec">الشروط</h3>
<ol class="terms">${[...extra.map(esc), ...standardTerms].map((t) => `<li>${t}</li>`).join('')}</ol>

<div class="osig">
  <div class="col"><b>عن ${esc(d.company.legalNameAr)}</b>${stamp}</div>
  <div class="col"><b>قبول المرشّح</b><br><small>أقرّ بأنني اطلعت على هذا العرض وأوافق على ما ورد فيه.</small>
    <div>الاسم: ${esc(d.candidateNameAr)}</div><div class="line"></div>
    <div>التوقيع والتاريخ: ${d.status === 'accepted' && d.respondedAt ? `<span class="ltr">${esc(d.respondedAt)}</span>` : ''}</div><div class="line"></div>
  </div>
</div>
${footer(d.company, `<span class="ltr">${esc(d.number)}</span>`)}`;
  return page(`عرض وظيفي ${d.number}`, `<style>${CSS}</style>${body}`);
}
