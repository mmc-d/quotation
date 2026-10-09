'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, Calculator, FileDown, Stamp, Trash2 } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { dateTime, today } from '@/lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Money, PageHeader, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { ConfirmDialog, errMsg } from '../../../quotes/_components/common';
import { PayrollStatus, WARNING, type PayrollLine, type PayrollRun } from '../../_components/run-kit';
import { LEAVE, type LeaveType } from '../../_components/pay-kit';

export default function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, can } = useMe();
  const { bi, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr-payroll', id], queryFn: () => api.get<PayrollRun>(`/hr/payroll/${id}`) });
  const [dialog, setDialog] = useState<null | 'approve' | 'paid' | 'delete'>(null);
  const [paid, setPaid] = useState({ date: today(), ref: '' });
  const [open, setOpen] = useState<PayrollLine | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const r = q.data;
  const lines = r.lines ?? [];
  const apply = (n: PayrollRun) => { qc.setQueryData(['hr-payroll', id], n); void qc.invalidateQueries({ queryKey: ['hr-payroll'], exact: true }); };
  const act = async (fn: () => Promise<PayrollRun>, ok: string) => {
    setBusy(true);
    try { apply(await fn()); toast.success(ok); setDialog(null); } catch (e) { toast.error(errMsg(e)); void q.refetch(); } finally { setBusy(false); }
  };
  const own = r.createdBy === me?.user.id && !me?.user.roles.includes('owner');
  const warned = lines.filter((l) => l.details.warnings?.length);
  const sum = (k: keyof PayrollLine) => lines.reduce((s, l) => s + Math.round(Number(l[k]) * 100), 0);
  const leaveText = (l: PayrollLine) => Object.entries(l.details.leaveDays ?? {}).map(([k, v]) => `${locale === 'en' ? LEAVE[k as LeaveType]?.en ?? k : LEAVE[k as LeaveType]?.ar ?? k} ${v}`).join(' · ');

  return (
    <>
      <PageHeader back="/hr/payroll" title={<span className="flex items-center gap-2">{bi('مسير رواتب', 'Payroll')} <span className="num">{r.month}</span></span>}
        subtitle={<span className="flex flex-wrap items-center gap-2"><PayrollStatus status={r.status} />{r.calculatedAt && <span className="text-xs text-muted">{bi('حُسب', 'calculated')} <span className="num">{dateTime(r.calculatedAt)}</span></span>}{r.approvedByName && <span className="text-xs text-muted">· {bi('اعتمده', 'approved by')} <b>{r.approvedByName}</b></span>}{r.paidAt && <span className="text-xs text-muted">· {bi('صُرف', 'paid')} <span className="num">{r.paidAt}</span>{r.paidRef && <> ({r.paidRef})</>}</span>}</span>}
        actions={<>
          <Button variant="outline" icon={<FileDown className="size-4" />} onClick={() => openFile(`/hr/payroll/${r.id}/csv`)}>{bi('ملف البنك (CSV)', 'Bank file (CSV)')}</Button>
          {r.status === 'draft' && can('hr.write') && <Button variant="outline" icon={<Calculator className="size-4" />} loading={busy && !dialog} onClick={() => void act(() => api.post<PayrollRun>('/hr/payroll', { month: r.month }), bi('أُعيد الحساب', 'Recalculated'))}>{bi('إعادة الحساب', 'Recalculate')}</Button>}
          {r.status === 'draft' && can('hr.write') && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDialog('delete')}>{bi('حذف المسودة', 'Delete draft')}</Button>}
          {r.status === 'draft' && can('hr.approve') && <Button icon={<Stamp className="size-4" />} disabled={own} title={own ? bi('أعددت هذا المسير — يعتمده مسؤول آخر', 'You prepared it — another approver must approve') : undefined} onClick={() => setDialog('approve')}>{bi('اعتماد المسير', 'Approve payroll')}</Button>}
          {r.status === 'approved' && can('hr.approve') && <Button icon={<Banknote className="size-4" />} onClick={() => setDialog('paid')}>{bi('تسجيل الصرف', 'Mark as paid')}</Button>}
        </>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label={bi('الموظفون', 'Employees')} value={r.employeeCount} />
        <Stat label={bi('الإجمالي المستحق', 'Gross')} value={<Money value={r.gross} fixed />} />
        <Stat label={bi('الاستقطاعات', 'Deductions')} value={<Money value={r.totalDeductions} fixed />} tone="red" />
        <Stat label={bi('صافي الرواتب', 'Net pay')} value={<Money value={r.net} fixed />} tone="green" />
      </div>
      {warned.length > 0 && (
        <Card className="mb-4" title={bi('تنبيهات', 'Warnings')}>
          <ul className="grid gap-1 text-sm text-gold-dark">
            {warned.map((l) => <li key={l.id}><b>{l.nameAr}</b>: {l.details.warnings!.map((w) => (WARNING[w] ? (locale === 'en' ? WARNING[w][1] : WARNING[w][0]) : w)).join('، ')}</li>)}
          </ul>
        </Card>
      )}
      <Card padded={false}>
        <Table>
          <thead><tr>
            <Th>{bi('الموظف', 'Employee')}</Th><Th>{bi('الأيام', 'Days')}</Th><Th className="text-end">{bi('الأساسي', 'Basic')}</Th><Th className="text-end">{bi('البدلات', 'Allowances')}</Th>
            <Th className="text-end">{bi('مكافآت', 'Bonuses')}</Th><Th className="text-end">{bi('الإجمالي', 'Gross')}</Th><Th className="text-end">{bi('إجازات', 'Leave')}</Th>
            <Th className="text-end">{bi('خصومات', 'Deductions')}</Th><Th className="text-end">{bi('التأمينات', 'GOSI')}</Th><Th className="text-end">{bi('الصافي', 'Net')}</Th>
          </tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="cursor-pointer hover:bg-tint/50" onClick={() => setOpen(l)}>
                <Td><Link className="font-bold hover:underline" href={`/hr/employees/${l.employeeId}`} onClick={(e) => e.stopPropagation()}>{l.nameAr}</Link><div className="num text-[11px] text-muted" dir="ltr">{l.employeeNumber}</div>{!!l.details.warnings?.length && <Badge tone="gold">!</Badge>}</Td>
                <Td className="num">{l.workedDays}</Td>
                <Td className="text-end"><Money value={l.basic} fixed /></Td>
                <Td className="text-end"><Money value={(Number(l.housing) + Number(l.transport) + Number(l.other)).toFixed(2)} fixed /></Td>
                <Td className="text-end">{Number(l.bonuses) > 0 ? <Money value={l.bonuses} fixed className="text-ok" /> : '—'}</Td>
                <Td className="text-end"><Money value={l.gross} fixed /></Td>
                <Td className="text-end">{Number(l.unpaidLeave) + Number(l.sickDeduction) > 0 ? <Money value={(Number(l.unpaidLeave) + Number(l.sickDeduction)).toFixed(2)} fixed className="text-danger" /> : '—'}</Td>
                <Td className="text-end">{Number(l.deductions) > 0 ? <Money value={l.deductions} fixed className="text-danger" /> : '—'}</Td>
                <Td className="text-end">{Number(l.gosi) > 0 ? <Money value={l.gosi} fixed /> : '—'}</Td>
                <Td className="text-end"><Money value={l.net} fixed className="font-extrabold text-primary" /></Td>
              </tr>
            ))}
            <tr className="bg-tint/60 font-bold">
              <Td>{bi('المجموع', 'Total')}</Td><Td />
              <Td className="text-end"><Money value={sum('basic')} fixed /></Td>
              <Td className="text-end"><Money value={sum('housing') + sum('transport') + sum('other')} fixed /></Td>
              <Td className="text-end"><Money value={sum('bonuses')} fixed /></Td>
              <Td className="text-end"><Money value={sum('gross')} fixed /></Td>
              <Td className="text-end"><Money value={sum('unpaidLeave') + sum('sickDeduction')} fixed /></Td>
              <Td className="text-end"><Money value={sum('deductions')} fixed /></Td>
              <Td className="text-end"><Money value={sum('gosi')} fixed /></Td>
              <Td className="text-end"><Money value={sum('net')} fixed /></Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? `${open.nameAr} — ${r.month}` : ''}>
        {open && (
          <dl className="grid gap-1 text-sm">
            {([
              [bi('أيام الاستحقاق', 'Days paid'), `${open.workedDays} / 30`],
              [bi('الأساسي', 'Basic'), <Money key="b" value={open.basic} fixed />],
              [bi('السكن', 'Housing'), <Money key="h" value={open.housing} fixed />],
              [bi('النقل', 'Transport'), <Money key="t" value={open.transport} fixed />],
              [bi('بدلات أخرى', 'Other allowances'), <Money key="o" value={open.other} fixed />],
              ...(open.details.adjustments ?? []).map((a, i): [string, React.ReactNode] => [`${a.kind === 'bonus' ? bi('مكافأة', 'Bonus') : bi('خصم', 'Deduction')}: ${a.reason}`, <Money key={`a${i}`} value={a.amount} fixed className={a.kind === 'bonus' ? 'text-ok' : 'text-danger'} />]),
              [bi('الإجازات', 'Leave'), leaveText(open) || '—'],
              [bi('خصم بدون أجر', 'Unpaid leave'), <Money key="u" value={open.unpaidLeave} fixed />],
              [bi('خصم المرضية (المادة 117)', 'Sick-leave deduction (Art. 117)'), <span key="s"><Money value={open.sickDeduction} fixed />{open.details.sickDays && <span className="ms-1 text-[11px] text-muted">({bi('كامل', 'full')} {open.details.sickDays.full} · 75% {open.details.sickDays.threeQuarter} · {bi('بدون', 'unpaid')} {open.details.sickDays.unpaid})</span>}</span>],
              [bi('التأمينات (حصة الموظف)', 'GOSI (employee share)'), <Money key="g" value={open.gosi} fixed />],
              [bi('الصافي', 'Net'), <Money key="n" value={open.net} fixed className="font-extrabold text-primary" />],
              [bi('الآيبان', 'IBAN'), open.iban ? <span key="i" className="num" dir="ltr">{open.iban}</span> : '—'],
            ] as [string, React.ReactNode][]).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}
          </dl>
        )}
      </Dialog>

      <ConfirmDialog open={dialog === 'approve'} title={bi(`اعتماد مسير ${r.month}`, `Approve ${r.month} payroll`)} confirmLabel={bi('اعتماد', 'Approve')} loading={busy}
        message={<>{bi('يُعاد الحساب قبل الاعتماد؛ إن تغيّر شيء تظهر الأرقام الجديدة لمراجعتها. بعد الاعتماد تُقفل إجازات ومكافآت وخصومات هذا الشهر.', 'It is recalculated first; if anything changed you will see the new figures to review. Approval locks the month\'s leave, bonuses and deductions.')}<div className="mt-2 font-bold">{bi('الصافي', 'Net')}: <Money value={r.net} fixed /></div></>}
        onClose={() => setDialog(null)} onConfirm={() => void act(() => api.post<PayrollRun>(`/hr/payroll/${r.id}/approve`, { expectedNet: r.net }), bi('اعتُمد المسير', 'Payroll approved'))} />
      <ConfirmDialog open={dialog === 'delete'} danger title={bi('حذف المسودة', 'Delete draft')} confirmLabel={bi('حذف', 'Delete')} loading={busy}
        onClose={() => setDialog(null)} onConfirm={() => { setBusy(true); api.del(`/hr/payroll/${r.id}`).then(() => { void qc.invalidateQueries({ queryKey: ['hr-payroll'] }); router.replace('/hr/payroll'); }).catch((e) => toast.error(errMsg(e))).finally(() => setBusy(false)); }} />
      <Dialog open={dialog === 'paid'} onClose={() => setDialog(null)} title={bi('تسجيل صرف الرواتب', 'Mark payroll as paid')}
        footer={<><Button variant="outline" onClick={() => setDialog(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={busy} onClick={() => void act(() => api.post<PayrollRun>(`/hr/payroll/${r.id}/paid`, { date: paid.date, ref: paid.ref.trim() || null }), bi('سُجّل الصرف وأُشعر الموظفون', 'Marked paid; employees notified'))}>{bi('تسجيل الصرف', 'Mark paid')}</Button></>}>
        <div className="grid gap-3">
          <Field label={bi('تاريخ الصرف', 'Payment date')}><Input type="date" max={today()} value={paid.date} onChange={(e) => setPaid((x) => ({ ...x, date: e.target.value }))} /></Field>
          <Field label={bi('المرجع (رقم الحوالة / حماية الأجور)', 'Reference (transfer / WPS)')}><Input dir="ltr" value={paid.ref} onChange={(e) => setPaid((x) => ({ ...x, ref: e.target.value }))} /></Field>
        </div>
      </Dialog>
    </>
  );
}
