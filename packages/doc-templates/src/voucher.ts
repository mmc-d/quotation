import { formatSar2, tafqitHalalas, type Halalas } from '@mmc/domain';
import { esc, footer, header, page, riyal, type CompanyBlock } from './base.js';

export interface VoucherDoc {
  company: CompanyBlock;
  kind: 'payment' | 'receipt';
  number: string;
  date: string;
  counterpartyName: string;
  counterpartyIdNumber?: string | null;
  counterpartyMobile?: string | null;
  amount: Halalas;
  purpose: string;
  method: string;
  methodRef?: string | null;
  bankName?: string | null;
  methodDate?: string | null;
  project?: string | null;
  costCenter?: string | null;
  docRef?: string | null;
  notes?: string | null;
  status: 'draft' | 'approved' | 'cancelled';
  createdByName?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  cancelReason?: string | null;
}

const METHOD_AR: Record<string, string> = { cash: 'نقدًا', cheque: 'شيك', transfer: 'تحويل بنكي', card: 'بطاقة / مدى', other: 'أخرى' };

const CSS = `
.vhead{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:8px 0 10px}
.vtitle{background:var(--primary);color:#fff;border-radius:8px;padding:6px 22px;text-align:center;box-shadow:inset 0 -3px 0 var(--gold)}
.vtitle b{display:block;font-size:20px;line-height:1.3}
.vtitle span{font-size:9px;letter-spacing:2px;color:#e9dcb4}
.vamt{border:1.5px solid var(--primary);border-radius:8px;overflow:hidden;min-width:190px}
.vamt .k{background:var(--primary);color:#fff;font-size:10px;font-weight:700;padding:3px 10px}
.vamt .v{font-size:18px;font-weight:800;padding:6px 10px;text-align:left}
.vrows{border:1px solid var(--line);border-radius:6px;overflow:hidden}
.vrow{display:flex;gap:10px;padding:7px 10px;border-bottom:1px solid var(--line)}
.vrow:last-child{border-bottom:0}
.vrow .k{color:var(--gold-dk);font-weight:700;min-width:120px}
.vrow .v{font-weight:700;flex:1}
.vrow.words .v{font-weight:500}
.vsig{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:22px;page-break-inside:avoid}
.vsig .col{text-align:center;min-height:120px}
.vsig .line{border-bottom:1px solid var(--ink);height:40px;margin:6px 16px}
.vsig small{color:var(--muted)}
.seal{width:148px;height:148px;border:3px double #1f5fae;border-radius:50%;color:#1f5fae;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0 auto;transform:rotate(-9deg);opacity:.9;font-weight:800;text-align:center;line-height:1.25}
.seal .t{font-size:19px;letter-spacing:1px}
.seal .n{font-size:10.5px;font-weight:700;max-width:120px}
.seal .d{font-size:10.5px;direction:ltr}
.vsig img.stamp{display:block;width:163px;height:163px;margin:2px auto 0;transform:rotate(-7deg);opacity:.95}
.vsig .by{display:block;color:#1f5fae;font-weight:700;font-size:10px}
.wm{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:90px;font-weight:800;color:rgba(192,57,43,.12);transform:rotate(-20deg);pointer-events:none}
.ack{margin-top:12px;background:var(--tint);border-inline-start:3px solid var(--gold);padding:7px 10px;border-radius:4px}
`;

/** Payment voucher (سند صرف) / receipt voucher (سند قبض). Approved vouchers carry the company stamp + the approver's seal. */
export function renderVoucherHtml(d: VoucherDoc): string {
  const pay = d.kind === 'payment';
  const row = (k: string, v: string | null | undefined, cls = '') => (v ? `<div class="vrow ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>` : '');
  const method = [METHOD_AR[d.method] ?? esc(d.method), d.methodRef ? `رقم <span class="ltr">${esc(d.methodRef)}</span>` : '', d.bankName ? `على ${esc(d.bankName)}` : '', d.methodDate ? `بتاريخ <span class="ltr">${esc(d.methodDate)}</span>` : ''].filter(Boolean).join(' · ');
  const approved = d.status === 'approved';
  const seal = approved
    ? d.company.stampDataUrl
      // the company stamp itself is the approval mark; who/when goes underneath
      ? `<img class="stamp" src="${esc(d.company.stampDataUrl)}" alt=""><small class="by">معتمد · ${esc(d.approvedByName ?? '')} · <span class="ltr">${esc((d.approvedAt ?? '').slice(0, 10))}</span></small>`
      : `<div class="seal"><span class="t">معتمد</span><span class="n">${esc(d.approvedByName ?? '')}</span><span class="d">${esc((d.approvedAt ?? '').slice(0, 10))}</span></div>`
    : '<div class="line"></div>';
  const body = `${header(d.company)}
${d.status === 'draft' ? '<div class="wm">مسودة</div>' : d.status === 'cancelled' ? '<div class="wm">ملغى</div>' : ''}
<div class="vhead">
  <div class="grid" style="grid-template-columns:auto auto;margin:0">
    <div class="cell"><span class="k">رقم السند</span><span class="v ltr">${esc(d.number)}</span></div>
    <div class="cell"><span class="k">التاريخ</span><span class="v ltr">${esc(d.date)}</span></div>
  </div>
  <div class="vtitle"><b>${pay ? 'سند صرف' : 'سند قبض'}</b><span>${pay ? 'PAYMENT VOUCHER' : 'RECEIPT VOUCHER'}</span></div>
  <div class="vamt"><div class="k">المبلغ / Amount</div><div class="v">${formatSar2(d.amount)} ${riyal}</div></div>
</div>
<div class="vrows">
  ${row(pay ? 'اصرفوا للسيد / السادة' : 'استلمنا من السيد / السادة', esc(d.counterpartyName))}
  ${row('رقم الهوية / السجل', d.counterpartyIdNumber ? `<span class="ltr">${esc(d.counterpartyIdNumber)}</span>` : null)}
  ${row('الجوال', d.counterpartyMobile ? `<span class="ltr">${esc(d.counterpartyMobile)}</span>` : null)}
  ${row('مبلغًا وقدره', `${esc(tafqitHalalas(d.amount))} فقط لا غير`, 'words')}
  ${row('وذلك مقابل', esc(d.purpose))}
  ${row(pay ? 'طريقة الصرف' : 'طريقة القبض', method)}
  ${row('المشروع', d.project ? esc(d.project) : null)}
  ${row('مركز التكلفة', d.costCenter ? esc(d.costCenter) : null)}
  ${row('المرجع', d.docRef ? `<span class="ltr">${esc(d.docRef)}</span>` : null)}
  ${row('ملاحظات', d.notes ? esc(d.notes) : null)}
  ${d.status === 'cancelled' ? row('سبب الإلغاء', esc(d.cancelReason ?? '')) : ''}
</div>
<div class="vsig">
  <div class="col"><b>المحاسب</b><div class="line"></div><small>${esc(d.createdByName ?? '')}</small></div>
  <div class="col"><b>الاعتماد والختم</b>${seal}${approved ? '' : '<small>بانتظار الاعتماد</small>'}</div>
  <div class="col"><b>${pay ? 'المستلم' : 'المسلِّم'}</b><div class="line"></div><small>الاسم والتوقيع</small></div>
</div>
${pay ? `<div class="ack">أقر أنا الموقّع أعلاه بأنني استلمت المبلغ المذكور كاملًا من <b>${esc(d.company.legalNameAr)}</b> عن البيان الموضّح أعلاه.</div>` : ''}
${footer(d.company, `<span class="ltr">${esc(d.number)}</span>`)}`;
  return page(`${pay ? 'سند صرف' : 'سند قبض'} ${d.number}`, `<style>${CSS}</style>${body}`);
}
