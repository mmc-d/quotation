'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, HandCoins, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Money, Spinner, StatusBadge, Table, Td, Th } from '@/components/ui';
import { ConfirmDialog, errMsg, ReasonDialog } from '../../quotes/_components/common';
import { AdjustmentDialog, BalanceTiles, DecideDialog, LeaveBadge, LeaveDialog, LeaveStatus, type Adjustment, type Balance, type Leave } from './pay-kit';

interface TimeOff { balance: Balance; leaves: Leave[]; adjustments: Adjustment[] }

function useTimeOff(employeeId: string) {
  return useQuery({ queryKey: ['hr-time-off', employeeId], queryFn: () => api.get<TimeOff>(`/hr/employees/${employeeId}/time-off`) });
}

/** Leave tab of the employee page: balance, history, record leave directly, decide pending requests. */
export function EmployeeLeaveTab({ employeeId, active }: { employeeId: string; active: boolean }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const q = useTimeOff(employeeId);
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<Leave | null>(null);
  const [cancelling, setCancelling] = useState<Leave | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['hr-time-off', employeeId] }); void qc.invalidateQueries({ queryKey: ['hr-leaves'] }); };
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const { balance, leaves } = q.data;
  return (
    <div className="grid gap-4">
      <Card title={bi('رصيد الإجازة السنوية (أيام)', 'Annual leave balance (days)')} actions={can('hr.write') && active && <Button size="sm" icon={<CalendarPlus className="size-4" />} onClick={() => setAdding(true)}>{bi('تسجيل إجازة', 'Record leave')}</Button>}>
        <BalanceTiles b={balance} />
      </Card>
      <Card padded={false} title={bi('الإجازات', 'Leave')}>
        {!leaves.length ? <Empty title={bi('لا توجد إجازات', 'No leave yet')} /> : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'No.')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('الفترة', 'Dates')}</Th><Th>{bi('الأيام', 'Days')}</Th><Th>{bi('السبب', 'Reason')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th /></tr></thead>
            <tbody>
              {leaves.map((l) => (
                <tr key={l.id}>
                  <Td className="num text-xs" >{l.number}</Td>
                  <Td><LeaveBadge type={l.type} /></Td>
                  <Td className="num text-xs">{date(l.startDate)} → {date(l.endDate)}</Td>
                  <Td className="num font-bold">{l.days}</Td>
                  <Td className="max-w-[16rem] text-xs text-muted">{l.reason}{l.attachmentFileId && <a className="ms-1 text-primary" href={`/api/files/${l.attachmentFileId}`} target="_blank" rel="noopener">📎</a>}{l.decisionNote && <div className="text-danger">{l.decisionNote}</div>}</Td>
                  <Td><div className="flex flex-col items-start gap-0.5"><LeaveStatus status={l.status} /><span className="text-[10px] text-muted">{l.source === 'hr' ? bi('سجّلها', 'by') : l.decidedByName ? bi('قرّرها', 'decided by') : bi('طلب الموظف', 'employee request')} {l.decidedByName}</span></div></Td>
                  <Td className="whitespace-nowrap text-end">
                    {l.status === 'pending' && <Button size="sm" onClick={() => setDeciding(l)}>{bi('قرار', 'Decide')}</Button>}
                    {(l.status === 'pending' || l.status === 'approved') && can('hr.write') && <Button size="sm" variant="ghost" onClick={() => setCancelling(l)}>{bi('إلغاء', 'Cancel')}</Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <LeaveDialog open={adding} onClose={() => setAdding(false)} employeeId={employeeId} available={balance.available} onSaved={() => { setAdding(false); refresh(); }} />
      <DecideDialog leave={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); refresh(); }} />
      <ReasonDialog open={!!cancelling} required danger title={bi(`إلغاء الإجازة ${cancelling?.number ?? ''}`, `Cancel leave ${cancelling?.number ?? ''}`)} confirmLabel={bi('إلغاء الإجازة', 'Cancel leave')} loading={busy}
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => {
          if (!cancelling) return;
          setBusy(true);
          api.post(`/hr/leaves/${cancelling.id}/cancel`, { reason }).then(() => { toast.success(bi('أُلغيت الإجازة', 'Leave cancelled')); setCancelling(null); refresh(); })
            .catch((e) => toast.error(errMsg(e))).finally(() => setBusy(false));
        }} />
    </div>
  );
}

/** Bonuses & deductions tab: per month; a bonus may be paid at once by payment voucher. */
export function EmployeePayTab({ employeeId, active }: { employeeId: string; active: boolean }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const q = useTimeOff(employeeId);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Adjustment | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr-time-off', employeeId] });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const rows = q.data.adjustments;
  return (
    <div className="grid gap-4">
      <Card padded={false} title={bi('المكافآت والخصومات', 'Bonuses and deductions')}
        actions={can('hr.write') && active && <Button size="sm" icon={<HandCoins className="size-4" />} onClick={() => setAdding(true)}>{bi('مكافأة / خصم', 'Bonus / deduction')}</Button>}>
        {!rows.length ? <Empty title={bi('لا توجد مكافآت أو خصومات', 'No bonuses or deductions')} /> : (
          <Table>
            <thead><tr><Th>{bi('الشهر', 'Month')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('السبب', 'Reason')}</Th><Th>{bi('طريقة الصرف', 'Paid via')}</Th><Th className="text-end">{bi('المبلغ', 'Amount')}</Th><Th /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <Td className="num text-xs">{a.month}</Td>
                  <Td>{a.kind === 'bonus' ? <Badge tone="green">{bi('مكافأة', 'Bonus')}</Badge> : <Badge tone="red">{bi('خصم', 'Deduction')}</Badge>}</Td>
                  <Td className="text-xs">{a.reason}</Td>
                  <Td className="text-xs">
                    {a.payMethod === 'voucher'
                      ? <span className="flex items-center gap-1">{bi('سند صرف', 'Voucher')} <Link className="num font-bold text-primary hover:underline" dir="ltr" href={`/finance/vouchers/${a.voucherId}`}>{a.voucherNumber}</Link>{a.voucherStatus === 'draft' ? <Badge tone="gold">{bi('بانتظار الاعتماد', 'awaiting approval')}</Badge> : <StatusBadge status={a.voucherStatus} />}</span>
                      : <>{bi('مسير الرواتب', 'Payroll')}{a.locked && <Badge tone="gray">{bi('مُقفل', 'locked')}</Badge>}</>}
                  </Td>
                  <Td className="text-end"><Money value={a.amount} fixed className={a.kind === 'bonus' ? 'text-ok' : 'text-danger'} /></Td>
                  <Td className="text-end">{can('hr.write') && !a.locked && a.voucherStatus !== 'approved' && <Button size="sm" variant="ghost" aria-label={bi('حذف', 'Delete')} onClick={() => setRemoving(a)}><Trash2 className="size-4" /></Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <AdjustmentDialog open={adding} onClose={() => setAdding(false)} employeeId={employeeId} canVoucher={can('voucher.write')} onSaved={() => { setAdding(false); refresh(); void qc.invalidateQueries({ queryKey: ['vouchers'] }); }} />
      <ConfirmDialog open={!!removing} danger title={bi('حذف', 'Delete')} confirmLabel={bi('حذف', 'Delete')} loading={busy}
        message={removing?.voucherNumber ? bi(`سيُلغى سند الصرف ${removing.voucherNumber} (مسودة) أيضًا.`, `Draft payment voucher ${removing.voucherNumber} is cancelled too.`) : bi('حذف هذا البند من راتب الشهر؟', "Remove this item from the month's pay?")}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          setBusy(true);
          api.del(`/hr/employees/${employeeId}/adjustments/${removing.id}`).then(() => { toast.success(bi('حُذف', 'Deleted')); setRemoving(null); refresh(); })
            .catch((e) => toast.error(errMsg(e))).finally(() => setBusy(false));
        }} />
    </div>
  );
}
