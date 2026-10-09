'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, FileDown, MessageSquareReply, Pencil, Stamp, UserPlus } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, dateTime, today } from '@/lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Money, PageHeader, Spinner, Textarea } from '@/components/ui';
import { ConfirmDialog, errMsg, ReasonDialog } from '../../../quotes/_components/common';
import { CONTRACT, COVER, EMPLOYMENT, ID_TYPE, IssueList, OFFER_STATUS, OfferForm, useLabel, type Employee, type Offer } from '../../_components/hr-kit';

export default function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { me, can } = useMe();
  const { bi, locale } = useI18n();
  const label = useLabel();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr-offer', id], queryFn: () => api.get<Offer>(`/hr/offers/${id}`) });
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<null | 'issue' | 'cancel' | 'respond' | 'hire'>(null);
  const [answer, setAnswer] = useState({ accepted: true, date: today(), note: '' });
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const o = q.data;
  const apply = (n: Offer) => { qc.setQueryData(['hr-offer', id], n); void qc.invalidateQueries({ queryKey: ['hr-offers'] }); };
  const act = async (fn: () => Promise<Offer>, ok: string) => {
    setBusy(true);
    try { apply(await fn()); toast.success(ok); setDialog(null); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const ownDraft = o.createdBy === me?.user.id && !me?.user.roles.includes('owner');
  const errors = o.issues.filter((i) => i.level === 'error');
  const st = OFFER_STATUS[o.status];
  const open = o.status === 'approved' || o.status === 'expired';

  const hire = async () => {
    setBusy(true);
    try {
      const e = await api.post<Employee>(`/hr/offers/${o.id}/hire`, {});
      toast.success(bi(`أُنشئ ملف الموظف ${e.number}`, `Employee ${e.number} created`));
      void qc.invalidateQueries({ queryKey: ['hr-employees'] });
      router.push(`/hr/employees/${e.id}`);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };

  const rows: [string, React.ReactNode][] = [
    [bi('المرشح', 'Candidate'), <>{o.candidateNameAr}{o.candidateNameEn && <span className="text-muted" dir="ltr">{o.candidateNameEn}</span>}</>],
    [bi('الجنسية', 'Nationality'), o.nationality],
    [bi('الهوية', 'ID'), o.idNumber && <>{label(ID_TYPE, o.idType)} <span className="num" dir="ltr">{o.idNumber}</span></>],
    [bi('التواصل', 'Contact'), (o.mobile || o.email) && <span className="num" dir="ltr">{[o.mobile, o.email].filter(Boolean).join(' · ')}</span>],
    [bi('الوظيفة', 'Job'), <>{o.jobTitleAr}{o.jobTitleEn && <span className="text-muted" dir="ltr">{o.jobTitleEn}</span>}</>],
    [bi('القسم / المرجع', 'Department / reports to'), [o.department, o.reportsTo].filter(Boolean).join(' · ')],
    [bi('مقر العمل', 'Location'), o.workLocation],
    [bi('العقد', 'Contract'), `${label(CONTRACT, o.contractType)}${o.contractType === 'fixed' ? ` — ${o.durationMonths} ${bi('شهرًا', 'months')}` : ''} · ${label(EMPLOYMENT, o.employmentType)}`],
    [bi('المباشرة', 'Start'), <span className="num">{date(o.startDate)}</span>],
    [bi('التجربة / الإشعار', 'Probation / notice'), `${o.probationDays} ${bi('يومًا', 'days')}${o.noticeDays ? ` · ${bi('إشعار', 'notice')} ${o.noticeDays} ${bi('يومًا', 'days')}` : ''}`],
    [bi('ساعات العمل', 'Hours'), `${o.weeklyHours} ${bi('ساعة أسبوعيًا', 'h / week')}${o.workDays ? ` · ${o.workDays}` : ''}`],
    [bi('الإجازة السنوية', 'Annual leave'), `${o.annualLeaveDays} ${bi('يومًا', 'days')}`],
    [bi('التأمين الطبي / التذكرة', 'Medical / ticket'), `${label(COVER, o.medicalInsurance)} · ${label(COVER, o.annualTicket)}`],
    [bi('مزايا أخرى', 'Other benefits'), o.otherBenefits && <span className="whitespace-pre-line">{o.otherBenefits}</span>],
    [bi('شروط إضافية', 'Extra terms'), o.termsAr && <span className="whitespace-pre-line">{o.termsAr}</span>],
    [bi('ملاحظات داخلية', 'Internal notes'), o.notes],
    [bi('أعدّه', 'Prepared by'), o.createdByName],
  ];
  const pay: [string, string][] = [
    [bi('الراتب الأساسي', 'Basic salary'), o.basicSalary],
    [bi('بدل السكن', 'Housing'), o.housingAllowance],
    [bi('بدل النقل', 'Transport'), o.transportAllowance],
    ...o.otherAllowances.map((a): [string, string] => [a.label, a.amount]),
  ];

  return (
    <>
      <PageHeader back="/hr/offers" title={<span className="flex items-center gap-2">{bi('عرض وظيفي', 'Job offer')} <span className="num" dir="ltr">{o.number}</span></span>}
        subtitle={<span className="flex flex-wrap items-center gap-2">{st && <Badge tone={st[2]}>{locale === 'en' ? st[1] : st[0]}</Badge>}<span className="num">{date(o.offerDate)}</span><span className="text-muted">{bi('صالح حتى', 'valid until')} <span className="num">{date(o.validUntil)}</span></span></span>}
        actions={!editing && <>
          <Button variant="outline" icon={<FileDown className="size-4" />} onClick={() => openFile(`/hr/offers/${o.id}/pdf`)}>PDF</Button>
          {o.status === 'draft' && can('hr.write') && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{bi('تعديل', 'Edit')}</Button>}
          {(o.status === 'draft' || open) && can('hr.write') && <Button variant="outline" icon={<Ban className="size-4" />} onClick={() => setDialog('cancel')}>{bi('سحب العرض', 'Withdraw')}</Button>}
          {open && can('hr.write') && <Button variant="outline" icon={<MessageSquareReply className="size-4" />} onClick={() => { setAnswer({ accepted: o.status === 'approved', date: today(), note: '' }); setDialog('respond'); }}>{bi('تسجيل رد المرشح', 'Record answer')}</Button>}
          {o.status === 'draft' && can('hr.approve') && (
            <Button icon={<Stamp className="size-4" />} disabled={ownDraft || errors.length > 0}
              title={ownDraft ? bi('لا يمكنك إصدار عرض أعددته — يصدره مسؤول آخر', 'You cannot issue an offer you prepared') : errors.length ? bi('صحّح ملاحظات نظام العمل أولًا', 'Fix the Labor Law issues first') : undefined}
              onClick={() => setDialog('issue')}>{bi('اعتماد وإصدار', 'Approve & issue')}</Button>
          )}
          {o.status === 'accepted' && !o.employee && can('hr.write') && <Button icon={<UserPlus className="size-4" />} onClick={() => setDialog('hire')}>{bi('إنشاء ملف الموظف', 'Create employee')}</Button>}
        </>}
      />

      {editing ? (
        <OfferForm offer={o} onCancel={() => setEditing(false)} onSaved={(n) => { apply(n); setEditing(false); }} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="grid content-start gap-4">
            {o.status === 'draft' && <IssueList issues={o.issues} />}
            <Card>
              <dl className="divide-y divide-line">
                {rows.filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[11rem_1fr] gap-3 py-2 text-sm"><dt className="font-bold text-gold-dark">{k}</dt><dd className="flex flex-wrap items-center gap-2">{v}</dd></div>
                ))}
              </dl>
            </Card>
          </div>
          <div className="grid content-start gap-4">
            <Card title={bi('الأجر الشهري', 'Monthly pay')}>
              <dl className="grid gap-1 text-sm">
                {pay.filter(([, v]) => Number(v) > 0).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd><Money value={v} fixed /></dd></div>)}
                <div className="mt-2 flex justify-between border-t border-line pt-2 font-extrabold text-primary"><dt>{bi('الإجمالي', 'Total')}</dt><dd><Money value={o.monthlyTotal} fixed /></dd></div>
                <div className="flex justify-between text-xs text-muted"><dt>{bi('سنويًا', 'Yearly')}</dt><dd><Money value={o.annualTotal} /></dd></div>
              </dl>
            </Card>
            <Card title={bi('المسار', 'Progress')}>
              <ol className="grid gap-2 text-sm">
                <li>✓ {bi('أُعدّ بواسطة', 'Prepared by')} <b>{o.createdByName ?? '—'}</b></li>
                <li className={o.approvedAt ? '' : 'text-muted'}>{o.approvedAt ? '✓' : '○'} {o.approvedAt ? <>{bi('صدر واعتمده', 'Issued by')} <b>{o.approvedByName}</b> <span className="num text-xs text-muted">{dateTime(o.approvedAt)}</span></> : bi('بانتظار الاعتماد والإصدار', 'Awaiting approval & issue')}</li>
                <li className={o.respondedAt ? '' : 'text-muted'}>{o.respondedAt ? '✓' : '○'} {o.respondedAt ? <>{o.status === 'accepted' ? bi('قبله المرشح', 'Accepted') : bi('رفضه المرشح', 'Declined')} <span className="num text-xs text-muted">{date(o.respondedAt)}</span>{o.responseNote && <div className="text-xs text-muted">{o.responseNote}</div>}</> : bi('رد المرشح', "Candidate's answer")}</li>
                <li className={o.employee ? '' : 'text-muted'}>{o.employee ? '✓' : '○'} {o.employee ? <Link className="font-bold text-primary hover:underline" href={`/hr/employees/${o.employee.id}`}>{bi('ملف الموظف', 'Employee')} <span className="num" dir="ltr">{o.employee.number}</span></Link> : bi('إنشاء ملف الموظف', 'Employee record')}</li>
                {o.status === 'cancelled' && <li className="text-danger">✕ {bi('سُحب العرض:', 'Withdrawn:')} {o.cancelReason}</li>}
              </ol>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog open={dialog === 'issue'} title={bi(`اعتماد وإصدار العرض ${o.number}`, `Approve & issue ${o.number}`)} confirmLabel={bi('اعتماد وإصدار', 'Approve & issue')} loading={busy}
        message={<>{bi('يُختم الخطاب بختم المنشأة ويُقفل للتعديل. أرسل نسخة PDF للمرشح ثم سجّل رده.', 'The letter gets the company stamp and is locked. Send the PDF to the candidate, then record the answer.')}{o.issues.length > 0 && <IssueList issues={o.issues} />}</>}
        onClose={() => setDialog(null)} onConfirm={() => void act(() => api.post<Offer>(`/hr/offers/${o.id}/approve`), bi('صدر العرض', 'Offer issued'))} />
      <ConfirmDialog open={dialog === 'hire'} title={bi('إنشاء ملف الموظف', 'Create the employee record')} confirmLabel={bi('إنشاء', 'Create')} loading={busy}
        message={bi(`يُنشأ ملف موظف لـ ${o.candidateNameAr} ببيانات العرض وتاريخ مباشرة ${date(o.startDate)}، ويمكنك تعديله بعد ذلك.`, `An employee record is created for ${o.candidateNameAr} from this offer, starting ${date(o.startDate)}; you can edit it afterwards.`)}
        onClose={() => setDialog(null)} onConfirm={() => void hire()} />
      <ReasonDialog open={dialog === 'cancel'} required danger title={bi('سحب العرض', 'Withdraw the offer')} confirmLabel={bi('سحب العرض', 'Withdraw')} loading={busy}
        hint={bi('يبقى رقم العرض محجوزًا ويظهر كمسحوب.', 'The number stays reserved and shows as withdrawn.')}
        onClose={() => setDialog(null)} onConfirm={(reason) => void act(() => api.post<Offer>(`/hr/offers/${o.id}/cancel`, { reason }), bi('سُحب العرض', 'Offer withdrawn'))} />
      <Dialog open={dialog === 'respond'} onClose={() => setDialog(null)} title={bi('تسجيل رد المرشح', "Record the candidate's answer")}
        footer={<>
          <Button variant="outline" onClick={() => setDialog(null)}>{bi('إلغاء', 'Cancel')}</Button>
          <Button loading={busy} variant={answer.accepted ? 'primary' : 'danger'} onClick={() => void act(() => api.post<Offer>(`/hr/offers/${o.id}/respond`, { accepted: answer.accepted, date: answer.date, note: answer.note.trim() || null }), answer.accepted ? bi('سُجّل قبول العرض', 'Acceptance recorded') : bi('سُجّل رفض العرض', 'Decline recorded'))}>
            {answer.accepted ? bi('تسجيل القبول', 'Record acceptance') : bi('تسجيل الرفض', 'Record decline')}
          </Button>
        </>}>
        <div className="grid gap-3">
          <div className="flex gap-2">
            <Button variant={answer.accepted ? 'primary' : 'outline'} onClick={() => setAnswer((a) => ({ ...a, accepted: true }))}>{bi('قبل العرض', 'Accepted')}</Button>
            <Button variant={!answer.accepted ? 'danger' : 'outline'} onClick={() => setAnswer((a) => ({ ...a, accepted: false }))}>{bi('رفض العرض', 'Declined')}</Button>
          </div>
          <Field label={bi('تاريخ الرد', 'Answer date')} hint={answer.accepted ? bi(`يجب أن يكون القبول قبل انتهاء العرض (${date(o.validUntil)})`, `Acceptance must be on or before ${date(o.validUntil)}`) : undefined}>
            <Input type="date" max={today()} min={o.offerDate} value={answer.date} onChange={(e) => setAnswer((a) => ({ ...a, date: e.target.value }))} />
          </Field>
          <Field label={bi('ملاحظة', 'Note')}><Textarea rows={2} value={answer.note} onChange={(e) => setAnswer((a) => ({ ...a, note: e.target.value }))} placeholder={answer.accepted ? bi('مثال: وقّع على النسخة الورقية', 'e.g. signed the paper copy') : bi('سبب الرفض إن وُجد', 'Reason, if given')} /></Field>
        </div>
      </Dialog>
    </>
  );
}
