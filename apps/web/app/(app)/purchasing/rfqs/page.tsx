'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileQuestion, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, clsx, Empty, ErrorBox, LinkButton, PageHeader, SearchBox, Spinner, Table, Td, Th } from '@/components/ui';
import { Chip, Ltr, RFQ_STATUS, chipCls, useLabel } from '../_components/common';
import type { RfqRow } from '../_components/types';

const PAGE = 50;

function RfqList() {
  const router = useRouter();
  const { bi } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  const [statuses, setStatuses] = useState<string[]>(['draft', 'sent']);
  const [limit, setLimit] = useState(PAGE);
  const filters = { q: term, status: statuses.join(','), limit };
  const list = useQuery({
    queryKey: ['rfq-list', filters],
    queryFn: () => api.get<{ rows: RfqRow[]; total: number }>(`/inventory/rfqs${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const toggle = (s: string) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <>
      <PageHeader
        title={bi('طلبات عروض الأسعار', 'Requests for quotation')}
        subtitle={list.data ? bi(`${list.data.total} طلب`, `${list.data.total} RFQs`) : bi('اطلب عروضًا من عدة موردين وقارن التكلفة الواصلة ومدة التوريد', 'Ask several suppliers and compare landed cost and lead time')}
        actions={can('purchase.write') && <LinkButton variant="primary" href="/purchasing/rfqs/new" icon={<Plus className="size-4" />}>{bi('طلب عروض جديد', 'New RFQ')}</LinkButton>}
      />
      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم الطلب…', 'RFQ number…')} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setStatuses([])} className={chipCls(statuses.length === 0)}>{bi('الكل', 'All')}</button>
            {Object.keys(RFQ_STATUS).map((s) => <button key={s} type="button" aria-pressed={statuses.includes(s)} onClick={() => toggle(s)} className={chipCls(statuses.includes(s))}>{label(RFQ_STATUS, s)}</button>)}
          </div>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<FileQuestion className="size-8" />} title={bi('لا توجد طلبات عروض أسعار', 'No RFQs')} hint={bi('أنشئ طلبًا من طلب مواد أو ببنود يدوية.', 'Create one from a material request or with manual lines.')} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('طلب المواد', 'Material request')}</Th>
                <Th className="text-end">{bi('البنود', 'Lines')}</Th><Th className="text-end">{bi('العروض', 'Quotes')}</Th><Th>{bi('آخر موعد', 'Reply by')}</Th><Th>{bi('أمر الشراء', 'Purchase order')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/purchasing/rfqs/${r.id}`)}>
                    <Td><Link href={`/purchasing/rfqs/${r.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{r.number}</Link></Td>
                    <Td><Chip map={RFQ_STATUS} value={r.status} /></Td>
                    <Td><Ltr className="text-xs">{r.materialRequestNumber}</Ltr></Td>
                    <Td className="text-end"><Ltr>{r.lineCount}</Ltr></Td>
                    <Td className="text-end"><Ltr>{`${r.quoteCount} / ${r.supplierCount}`}</Ltr></Td>
                    <Td><span className="num text-xs">{date(r.dueDate)}</span></Td>
                    <Td>{r.purchaseOrderId ? <Link href={`/purchasing/orders/${r.purchaseOrderId}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num text-xs font-bold text-primary hover:underline">{r.purchaseOrderNumber}</Link> : <span className="text-muted">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.data && list.data.total > rows.length && limit < 200 && (
              <div className="flex justify-center border-t border-line p-3">
                <Button variant="outline" size="sm" loading={list.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>{bi('عرض المزيد', 'Show more')}</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

export default function RfqsPage() {
  return <Suspense fallback={<Spinner />}><RfqList /></Suspense>;
}
