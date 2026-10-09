'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pause, Pencil, Play, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Money, PageHeader, Spinner, Tabs, Textarea } from '@/components/ui';
import { errMsg, ReasonDialog } from '../../../quotes/_components/common';
import { CONTRACT, EMP_STATUS, EMPLOYMENT, EmployeeForm, ID_TYPE, useLabel, type Employee } from '../../_components/hr-kit';
import { EmployeeLeaveTab, EmployeePayTab } from '../../_components/employee-tabs';

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const label = useLabel();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr-employee', id], queryFn: () => api.get<Employee>(`/hr/employees/${id}`) });
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'info' | 'leave' | 'pay'>('info');
  const [dialog, setDialog] = useState<null | 'suspend' | 'reinstate' | 'terminate'>(null);
  const [term, setTerm] = useState({ date: today(), reason: '' });
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const e = q.data;
  const apply = (n: Employee) => { qc.setQueryData(['hr-employee', id], n); void qc.invalidateQueries({ queryKey: ['hr-employees'] }); };
  const setStatus = async (body: { status: string; date?: string; reason?: string }, ok: string) => {
    setBusy(true);
    try { apply(await api.post<Employee>(`/hr/employees/${e.id}/status`, body)); toast.success(ok); setDialog(null); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const st = EMP_STATUS[e.status];
  const t = today();
  const write = can('hr.write');

  const sections: { title: string; rows: [string, React.ReactNode][] }[] = [
    {
      title: bi('البيانات الشخصية', 'Personal'), rows: [
        [bi('الاسم', 'Name'), <>{e.nameAr}{e.nameEn && <span className="text-muted" dir="ltr">{e.nameEn}</span>}</>],
        [bi('الجنسية', 'Nationality'), e.nationality],
        [bi('الهوية', 'ID'), e.idNumber && <>{label(ID_TYPE, e.idType)} <span className="num" dir="ltr">{e.idNumber}</span>{e.idExpiry && <span className={`num text-xs ${e.idExpiry < t ? 'text-danger' : 'text-muted'}`}>{bi('تنتهي', 'expires')} {date(e.idExpiry)}</span>}</>],
        [bi('تاريخ الميلاد', 'Born'), e.birthDate && <span className="num">{date(e.birthDate)}</span>],
        [bi('الجنس', 'Gender'), e.gender && (e.gender === 'male' ? bi('ذكر', 'Male') : bi('أنثى', 'Female'))],
        [bi('التواصل', 'Contact'), (e.mobile || e.email) && <span className="num" dir="ltr">{[e.mobile, e.email].filter(Boolean).join(' · ')}</span>],
      ],
    },
    {
      title: bi('الوظيفة', 'Job'), rows: [
        [bi('المسمى', 'Title'), <>{e.jobTitleAr}{e.jobTitleEn && <span className="text-muted" dir="ltr">{e.jobTitleEn}</span>}</>],
        [bi('القسم', 'Department'), e.department],
        [bi('المدير المباشر', 'Manager'), e.manager && <Link className="text-primary hover:underline" href={`/hr/employees/${e.manager.id}`}>{e.manager.nameAr} <span className="num" dir="ltr">({e.manager.number})</span></Link>],
        [bi('مقر العمل', 'Location'), e.workLocation],
        [bi('المباشرة', 'Hired'), <span className="num">{date(e.hireDate)}</span>],
        [bi('العقد', 'Contract'), `${label(CONTRACT, e.contractType)}${e.contractEndDate ? ` — ${bi('حتى', 'until')} ${date(e.contractEndDate)}` : ''} · ${label(EMPLOYMENT, e.employmentType)}`],
        [bi('نهاية التجربة', 'Probation ends'), e.probationEndDate && <span className="num">{date(e.probationEndDate)}{e.probationEndDate >= t && <Badge tone="blue">{bi('تحت التجربة', 'on probation')}</Badge>}</span>],
        [bi('الإجازة السنوية', 'Annual leave'), `${e.annualLeaveDays} ${bi('يومًا', 'days')}`],
        [bi('حساب النظام', 'System login'), e.user && (e.user.nameAr || e.user.email)],
        [bi('العرض الوظيفي', 'Job offer'), e.offer && <Link className="num text-primary hover:underline" dir="ltr" href={`/hr/offers/${e.offer.id}`}>{e.offer.number}</Link>],
      ],
    },
    {
      title: bi('البنك والتأمينات', 'Bank and GOSI'), rows: [
        [bi('البنك', 'Bank'), e.bankName],
        [bi('الآيبان', 'IBAN'), e.iban && <span className="num" dir="ltr">{e.iban}</span>],
        [bi('رقم التأمينات', 'GOSI no.'), e.gosiNumber && <span className="num" dir="ltr">{e.gosiNumber}</span>],
        [bi('حصة الموظف في التأمينات', 'Employee GOSI share'), Number(e.gosiEmployeePercent) > 0 && <span className="num">{Number(e.gosiEmployeePercent)}%</span>],
        [bi('ملاحظات', 'Notes'), e.notes && <span className="whitespace-pre-line">{e.notes}</span>],
      ],
    },
  ];
  const pay: [string, string][] = [
    [bi('الراتب الأساسي', 'Basic salary'), e.basicSalary],
    [bi('بدل السكن', 'Housing'), e.housingAllowance],
    [bi('بدل النقل', 'Transport'), e.transportAllowance],
    ...e.otherAllowances.map((a): [string, string] => [a.label, a.amount]),
  ];

  return (
    <>
      <PageHeader back="/hr/employees" title={<span className="flex items-center gap-2">{e.nameAr} <span className="num text-base text-muted" dir="ltr">{e.number}</span></span>}
        subtitle={<span className="flex items-center gap-2">{st && <Badge tone={st[2]}>{locale === 'en' ? st[1] : st[0]}</Badge>}{e.jobTitleAr}</span>}
        actions={!editing && write && <>
          {e.status !== 'terminated' && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{bi('تعديل', 'Edit')}</Button>}
          {e.status === 'active' && <Button variant="outline" icon={<Pause className="size-4" />} onClick={() => setDialog('suspend')}>{bi('إيقاف', 'Suspend')}</Button>}
          {e.status !== 'active' && <Button variant="outline" icon={<Play className="size-4" />} onClick={() => setDialog('reinstate')}>{bi('إعادة للعمل', 'Reinstate')}</Button>}
          {e.status !== 'terminated' && <Button variant="danger" icon={<UserX className="size-4" />} onClick={() => { setTerm({ date: today(), reason: '' }); setDialog('terminate'); }}>{bi('إنهاء الخدمة', 'End service')}</Button>}
        </>}
      />

      {!editing && (
        <div className="mb-4 border-b border-line">
          <Tabs value={tab} onChange={setTab} items={[
            { value: 'info', label: bi('البيانات', 'Details') },
            { value: 'leave', label: bi('الإجازات', 'Leave') },
            { value: 'pay', label: bi('المكافآت والخصومات', 'Bonuses & deductions') },
          ]} />
        </div>
      )}
      {editing ? (
        <EmployeeForm employee={e} onCancel={() => setEditing(false)} onSaved={(n) => { apply(n); setEditing(false); }} />
      ) : tab === 'leave' ? (
        <EmployeeLeaveTab employeeId={e.id} active={e.status !== 'terminated'} />
      ) : tab === 'pay' ? (
        <EmployeePayTab employeeId={e.id} active={e.status !== 'terminated'} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="grid content-start gap-4">
            {e.status === 'terminated' && (
              <Card><p className="text-sm text-danger"><b>{bi('انتهت الخدمة في', 'Service ended on')} <span className="num">{date(e.terminationDate)}</span></b> — {e.terminationReason}</p></Card>
            )}
            {sections.map((s) => ({ ...s, rows: s.rows.filter(([, v]) => v) })).filter((s) => s.rows.length).map((s) => (
              <Card key={s.title} title={s.title}>
                <dl className="divide-y divide-line">
                  {s.rows.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 py-2 text-sm"><dt className="font-bold text-gold-dark">{k}</dt><dd className="flex flex-wrap items-center gap-2">{v}</dd></div>
                  ))}
                </dl>
              </Card>
            ))}
          </div>
          <Card title={bi('الأجر الشهري', 'Monthly pay')} className="content-start self-start">
            <dl className="grid gap-1 text-sm">
              {pay.filter(([, v]) => Number(v) > 0).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd><Money value={v} fixed /></dd></div>)}
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-extrabold text-primary"><dt>{bi('الإجمالي', 'Total')}</dt><dd><Money value={e.monthlyTotal} fixed /></dd></div>
            </dl>
          </Card>
        </div>
      )}

      <ReasonDialog open={dialog === 'suspend'} required title={bi('إيقاف الموظف', 'Suspend employee')} confirmLabel={bi('إيقاف', 'Suspend')} loading={busy}
        onClose={() => setDialog(null)} onConfirm={(reason) => void setStatus({ status: 'suspended', reason }, bi('أُوقف الموظف', 'Employee suspended'))} />
      <ReasonDialog open={dialog === 'reinstate'} title={bi('إعادة الموظف للعمل', 'Reinstate employee')} confirmLabel={bi('إعادة للعمل', 'Reinstate')} loading={busy}
        onClose={() => setDialog(null)} onConfirm={(reason) => void setStatus({ status: 'active', reason: reason || undefined }, bi('أُعيد الموظف للعمل', 'Employee reinstated'))} />
      <Dialog open={dialog === 'terminate'} onClose={() => setDialog(null)} title={bi('إنهاء خدمة الموظف', 'End of service')}
        footer={<>
          <Button variant="outline" onClick={() => setDialog(null)}>{bi('إلغاء', 'Cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={!term.reason.trim() || !term.date} onClick={() => void setStatus({ status: 'terminated', date: term.date, reason: term.reason.trim() }, bi('سُجّل إنهاء الخدمة', 'End of service recorded'))}>{bi('إنهاء الخدمة', 'End service')}</Button>
        </>}>
        <div className="grid gap-3">
          <Field label={bi('آخر يوم عمل', 'Last working day')}><Input type="date" min={e.hireDate} value={term.date} onChange={(ev) => setTerm((x) => ({ ...x, date: ev.target.value }))} /></Field>
          <Field label={bi('السبب', 'Reason')}><Textarea rows={2} value={term.reason} onChange={(ev) => setTerm((x) => ({ ...x, reason: ev.target.value }))} placeholder={bi('مثال: استقالة، انتهاء العقد…', 'e.g. resignation, contract ended…')} /></Field>
          <p className="text-xs text-muted">{bi('يبقى الملف محفوظًا للقراءة، ويمكن إعادة الموظف للعمل لاحقًا.', 'The record stays read-only and can be reinstated later.')}</p>
        </div>
      </Dialog>
    </>
  );
}
