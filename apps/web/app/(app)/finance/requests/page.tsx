'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, h, today } from '@/lib/format';
import { Card, Checkbox, Empty, ErrorBox, Money, PageHeader, SearchBox, Select, Spinner, StatusBadge, Table, Td, Th, clsx } from '@/components/ui';
import { RequestLinkActions, SendRequestButton, isOverdue, type PaymentRequestRow } from '../_components/finance-kit';

export default function PaymentRequestsPage() {
  const { can } = useMe();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const key = ['payment-requests', q, status, overdue];
  const list = useQuery({ queryKey: key, queryFn: () => api.get<PaymentRequestRow[]>(`/finance/payment-requests${qs({ q, status, overdue: overdue || undefined, limit: 200 })}`) });
  const todayStr = today();
  const rows = list.data ?? [];
  const outstanding = rows.filter((r) => ['draft', 'sent', 'partially_paid'].includes(r.status)).reduce((s, r) => s + h(r.amount) - h(r.paidAmount), 0);

  return (
    <>
      <PageHeader title="طلبات الدفع" subtitle={list.data ? <>{rows.length} طلب · مستحق غير محصّل <Money value={outstanding} /></> : 'Payment requests'} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder="رقم الطلب، العميل، رقم العقد…" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[12rem]">
            <option value="">كل الحالات</option>
            <option value="draft,sent,partially_paid">مفتوحة</option>
            <option value="draft">مسودة</option>
            <option value="sent">مُرسل</option>
            <option value="partially_paid">مدفوع جزئيًا</option>
            <option value="paid">مدفوع</option>
            <option value="cancelled">ملغى</option>
          </Select>
          <Checkbox label="المتأخرة فقط" checked={overdue} onChange={setOverdue} />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !rows.length ? (
          <Empty icon={<Receipt className="size-8" />} title="لا توجد طلبات دفع" hint="تُنشأ طلبات الدفع من شاشة العقد ← جدول الدفعات." />
        ) : (
          <Table>
            <thead><tr><Th>الرقم</Th><Th>العميل</Th><Th>العقد</Th><Th>المبلغ</Th><Th>المدفوع</Th><Th>الاستحقاق</Th><Th>الحالة</Th><Th>إجراءات</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const late = isOverdue(r, todayStr);
                return (
                  <tr key={r.id} className="hover:bg-tint/50">
                    <Td className="num font-bold">{r.number}</Td>
                    <Td>{r.partyName ?? '—'}</Td>
                    <Td>{r.contractId ? <Link href={`/contracts/${r.contractId}`} className="num font-bold text-primary hover:underline">{r.contractNumber ?? 'العقد'}</Link> : '—'}</Td>
                    <Td><Money value={r.amount} fixed /></Td>
                    <Td><Money value={r.paidAmount} fixed className={h(r.paidAmount) > 0 ? 'text-ok' : 'text-muted'} /></Td>
                    <Td className={clsx('num text-xs', late && 'font-bold text-danger')}>{date(r.dueDate)}{late && <span className="ms-1">(متأخر)</span>}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        {can('billing.write') && <SendRequestButton pr={r} onDone={() => qc.invalidateQueries({ queryKey: ['payment-requests'] })} />}
                        <RequestLinkActions pr={r} />
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
