'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calculator, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Field, Input, Money, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { errMsg } from '../../quotes/_components/common';
import { PayrollStatus, type PayrollRun } from '../_components/run-kit';

export default function PayrollPage() {
  const { bi } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['hr-payroll'], queryFn: () => api.get<PayrollRun[]>('/hr/payroll') });
  const [month, setMonth] = useState(today().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const prepare = async () => {
    setBusy(true);
    try {
      const r = await api.post<PayrollRun>('/hr/payroll', { month });
      void qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      router.push(`/hr/payroll/${r.id}`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title={bi('مسير الرواتب', 'Payroll')}
        subtitle={bi('يُحسب الراتب من بيانات الموظف والإجازات والمكافآت والخصومات؛ يعتمده مسؤول آخر فيُقفل الشهر، ثم يُسجَّل الصرف.', "Pay is calculated from each employee's record, leave, bonuses and deductions; a second person approves it (locking the month), then it is marked paid.")} />
      {can('hr.write') && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={bi('الشهر', 'Month')}><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
            <Button loading={busy} icon={<Calculator className="size-4" />} onClick={() => void prepare()}>{bi('إعداد / إعادة حساب المسير', 'Prepare / recalculate')}</Button>
            <p className="text-xs text-muted">{bi('إن وُجد مسير مسودة لنفس الشهر يُعاد حسابه.', 'An existing draft for that month is recalculated.')}</p>
          </div>
        </Card>
      )}
      <Card padded={false}>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.length ? (
          <Empty icon={<Wallet className="size-8" />} title={bi('لا توجد مسيرات بعد', 'No payrolls yet')} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('الشهر', 'Month')}</Th><Th>{bi('الموظفون', 'Employees')}</Th><Th className="text-end">{bi('الإجمالي', 'Gross')}</Th><Th className="text-end">{bi('الاستقطاعات', 'Deductions')}</Th><Th className="text-end">{bi('الصافي', 'Net')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} className="hover:bg-tint/50">
                  <Td><Link className="num font-bold text-primary hover:underline" href={`/hr/payroll/${r.id}`}>{r.month}</Link></Td>
                  <Td className="num">{r.employeeCount}</Td>
                  <Td className="text-end"><Money value={r.gross} fixed /></Td>
                  <Td className="text-end"><Money value={r.totalDeductions} fixed className="text-danger" /></Td>
                  <Td className="text-end"><Money value={r.net} fixed className="font-bold" /></Td>
                  <Td><PayrollStatus status={r.status} />{r.paidAt && <span className="num ms-1 text-[11px] text-muted">{date(r.paidAt)}</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
