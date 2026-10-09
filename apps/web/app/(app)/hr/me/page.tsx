'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Money, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { errMsg } from '../../quotes/_components/common';
import { BalanceTiles, DecideDialog, LeaveBadge, LeaveDialog, LeaveStatus, type Balance, type Leave } from '../_components/pay-kit';

interface Me {
  employee: { id: string; number: string; nameAr: string; jobTitleAr: string; department: string | null; hireDate: string; annualLeaveDays: number; status: string } | null;
  balance: Balance | null; leaves: Leave[]; adjustments: { id: string; month: string; kind: 'bonus' | 'deduction'; amount: string; reason: string; payMethod: string }[]; teamPending: Leave[];
}

/** Self-service: my leave balance and requests; managers also see their team's pending requests. */
export default function MyHrPage() {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr-me'], queryFn: () => api.get<Me>('/hr/me') });
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<Leave | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr-me'] });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const { employee: e, balance, leaves, adjustments, teamPending } = q.data;
  const withdraw = (l: Leave) => api.post(`/hr/me/leaves/${l.id}/cancel`).then(() => { toast.success(bi('سُحب الطلب', 'Request withdrawn')); refresh(); }).catch((err) => toast.error(errMsg(err)));

  return (
    <>
      <PageHeader title={bi('إجازاتي وطلباتي', 'My leave')}
        subtitle={e ? <span>{e.nameAr} · {e.jobTitleAr} · <span className="num" dir="ltr">{e.number}</span></span> : undefined}
        actions={e && e.status === 'active' && <Button icon={<CalendarPlus className="size-4" />} onClick={() => setRequesting(true)}>{bi('طلب إجازة', 'Request leave')}</Button>} />

      {teamPending.length > 0 && (
        <Card padded={false} className="mb-4" title={bi('طلبات فريقي بانتظار موافقتي', "My team's requests awaiting me")}>
          <Table>
            <thead><tr><Th>{bi('الموظف', 'Employee')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('الفترة', 'Dates')}</Th><Th>{bi('الأيام', 'Days')}</Th><Th /></tr></thead>
            <tbody>
              {teamPending.map((l) => (
                <tr key={l.id}>
                  <Td className="font-bold">{l.employeeName}</Td><Td><LeaveBadge type={l.type} /></Td>
                  <Td className="num text-xs">{date(l.startDate)} → {date(l.endDate)}</Td><Td className="num font-bold">{l.days}</Td>
                  <Td className="text-end"><Button size="sm" onClick={() => setDeciding(l)}>{bi('قرار', 'Decide')}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {!e ? (
        <Card><Empty icon={<UserRound className="size-8" />} title={bi('حسابك غير مرتبط بملف موظف', 'Your login is not linked to an employee record')} hint={bi('اطلب من الموارد البشرية ربط حسابك من صفحة الموظف (حساب الدخول للنظام).', 'Ask HR to link your login on your employee page (System login).')} /></Card>
      ) : (
        <div className="grid gap-4">
          {balance && <Card title={bi('رصيد الإجازة السنوية (أيام)', 'Annual leave balance (days)')}><BalanceTiles b={balance} /></Card>}
          <Card padded={false} title={bi('طلباتي', 'My requests')}>
            {!leaves.length ? <Empty title={bi('لا توجد طلبات بعد', 'No requests yet')} /> : (
              <Table>
                <thead><tr><Th>{bi('الرقم', 'No.')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('الفترة', 'Dates')}</Th><Th>{bi('الأيام', 'Days')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th /></tr></thead>
                <tbody>
                  {leaves.map((l) => (
                    <tr key={l.id}>
                      <Td className="num text-xs">{l.number}</Td><Td><LeaveBadge type={l.type} /></Td>
                      <Td className="num text-xs">{date(l.startDate)} → {date(l.endDate)}</Td><Td className="num font-bold">{l.days}</Td>
                      <Td><LeaveStatus status={l.status} />{l.decisionNote && <div className="text-[11px] text-muted">{l.decisionNote}</div>}</Td>
                      <Td className="text-end">{l.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => void withdraw(l)}>{bi('سحب الطلب', 'Withdraw')}</Button>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {adjustments.length > 0 && (
            <Card padded={false} title={bi('المكافآت والخصومات', 'Bonuses and deductions')}>
              <Table>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id}>
                      <Td className="num text-xs">{a.month}</Td>
                      <Td>{a.kind === 'bonus' ? <Badge tone="green">{bi('مكافأة', 'Bonus')}</Badge> : <Badge tone="red">{bi('خصم', 'Deduction')}</Badge>}</Td>
                      <Td className="text-xs">{a.reason}</Td>
                      <Td className="text-end"><Money value={a.amount} fixed /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}
      <LeaveDialog open={requesting} onClose={() => setRequesting(false)} available={balance?.available} onSaved={() => { setRequesting(false); refresh(); }} />
      <DecideDialog leave={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); refresh(); }} />
    </>
  );
}
