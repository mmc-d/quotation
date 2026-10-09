'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, PageHeader, Select, Spinner, Stat, Table, Tabs, Td, Th } from '@/components/ui';
import { DecideDialog, LEAVE, LeaveBadge, LeaveStatus, type Leave, type LeaveType } from '../_components/pay-kit';

interface ListResult { rows: Leave[]; summary: { pending: number; onLeaveToday: number } }

export default function LeavesPage() {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('');
  const [deciding, setDeciding] = useState<Leave | null>(null);
  const list = useQuery({
    queryKey: ['hr-leaves', status, type],
    queryFn: () => api.get<ListResult>(`/hr/leaves${qs({ status: status === 'all' ? undefined : status, type: type || undefined })}`),
  });
  const s = list.data?.summary;
  return (
    <>
      <PageHeader title={bi('الإجازات', 'Leave')}
        subtitle={bi('طلبات الموظفين بانتظار موافقة المدير المباشر أو الموارد البشرية، وكل الإجازات المسجّلة.', "Employees' requests awaiting the manager or HR, and all recorded leave.")} />
      {s && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Stat label={bi('طلبات بانتظار الموافقة', 'Requests awaiting approval')} value={s.pending} tone={s.pending ? 'gold' : undefined} />
          <Stat label={bi('في إجازة اليوم', 'On leave today')} value={s.onLeaveToday} />
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 pt-2">
          <Tabs value={status} onChange={setStatus} items={[
            { value: 'pending', label: bi('بانتظار الموافقة', 'Pending') },
            { value: 'approved', label: bi('معتمدة', 'Approved') },
            { value: 'rejected', label: bi('مرفوضة', 'Rejected') },
            { value: 'all', label: bi('الكل', 'All') },
          ]} />
          <Select value={type} onChange={(e) => setType(e.target.value)} className="mb-2 max-w-[12rem]">
            <option value="">{bi('كل الأنواع', 'All types')}</option>
            {(Object.keys(LEAVE) as LeaveType[]).map((k) => <option key={k} value={k}>{locale === 'en' ? LEAVE[k].en : LEAVE[k].ar}</option>)}
          </Select>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<CalendarCheck className="size-8" />} title={status === 'pending' ? bi('لا توجد طلبات معلّقة', 'No pending requests') : bi('لا توجد إجازات', 'No leave')} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'No.')}</Th><Th>{bi('الموظف', 'Employee')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('الفترة', 'Dates')}</Th><Th>{bi('الأيام', 'Days')}</Th><Th>{bi('السبب', 'Reason')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th /></tr></thead>
            <tbody>
              {list.data.rows.map((l) => (
                <tr key={l.id} className="hover:bg-tint/50">
                  <Td className="num text-xs">{l.number}</Td>
                  <Td><Link className="font-bold hover:underline" href={`/hr/employees/${l.employeeId}`}>{l.employeeName}</Link>{l.department && <div className="text-[11px] text-muted">{l.department}</div>}</Td>
                  <Td><LeaveBadge type={l.type} /></Td>
                  <Td className="num text-xs">{date(l.startDate)} → {date(l.endDate)}</Td>
                  <Td className="num font-bold">{l.days}</Td>
                  <Td className="max-w-[16rem] text-xs text-muted">{l.reason}{l.attachmentFileId && <a className="ms-1 text-primary" href={`/api/files/${l.attachmentFileId}`} target="_blank" rel="noopener">📎</a>}</Td>
                  <Td><LeaveStatus status={l.status} /></Td>
                  <Td className="text-end">{l.status === 'pending' && <Button size="sm" onClick={() => setDeciding(l)}>{bi('قرار', 'Decide')}</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <DecideDialog leave={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); void qc.invalidateQueries({ queryKey: ['hr-leaves'] }); }} />
    </>
  );
}
