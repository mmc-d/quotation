'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, FileCode2, Plus, ShoppingCart } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, clsx, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, Table, Td, Th } from '@/components/ui';
import { Amount, PO_STATUS, PoStatusBadge, chipCls, useLabel } from '../_components/common';
import { EInvoiceImportDialog } from '../_components/po-dialogs';
import type { PoRow } from '../_components/types';

const PAGE = 50;
const OPEN = ['draft', 'pending_approval', 'approved', 'sent', 'partially_received'];

function OrdersList() {
  const sp = useSearchParams();
  const router = useRouter();
  const { bi } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const term = useDeferredValue(q.trim());
  const [statuses, setStatuses] = useState<string[]>(() => (sp.get('status') ?? OPEN.join(',')).split(',').filter(Boolean));
  const [limit, setLimit] = useState(PAGE);
  const [importing, setImporting] = useState(false);
  const filters = { q: term, status: statuses.join(','), supplierId: sp.get('supplierId'), projectId: sp.get('projectId'), limit };
  const list = useQuery({
    queryKey: ['po-list', filters],
    queryFn: () => api.get<{ rows: PoRow[]; total: number }>(`/inventory/purchase-orders${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const toggle = (s: string) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={bi('أوامر الشراء', 'Purchase orders')}
        subtitle={list.data ? bi(`${list.data.total} أمر شراء`, `${list.data.total} purchase orders`) : undefined}
        actions={<>
          {can('purchase.write') && <Button variant="outline" icon={<FileCode2 className="size-4" />} onClick={() => setImporting(true)}>{bi('استيراد فاتورة إلكترونية', 'Import e-invoice')}</Button>}
          <LinkButton href="/purchasing/suppliers" icon={<BookOpen className="size-4" />}>{bi('كتالوج الموردين', 'Supplier catalogue')}</LinkButton>
          {can('purchase.write') && <LinkButton variant="primary" href="/purchasing/orders/new" icon={<Plus className="size-4" />}>{bi('أمر شراء جديد', 'New purchase order')}</LinkButton>}
        </>}
      />
      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم الأمر أو اسم المورد…', 'PO number or supplier…')} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setStatuses([])} className={chipCls(statuses.length === 0)}>{bi('الكل', 'All')}</button>
            {Object.keys(PO_STATUS).map((s) => <button key={s} type="button" aria-pressed={statuses.includes(s)} onClick={() => toggle(s)} className={chipCls(statuses.includes(s))}>{label(PO_STATUS, s)}</button>)}
          </div>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<ShoppingCart className="size-8" />} title={bi('لا توجد أوامر شراء مطابقة', 'No matching purchase orders')} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('المورد', 'Supplier')}</Th><Th>{bi('المشروع', 'Project')}</Th><Th>{bi('الحالة', 'Status')}</Th>
                <Th className="text-end">{bi('الإجمالي', 'Total')}</Th><Th className="text-end">{bi('بالريال', 'In SAR')}</Th><Th>{bi('الوصول المتوقع', 'Expected')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((r) => {
                  const late = r.expectedOn && r.expectedOn < today && ['approved', 'sent', 'partially_received'].includes(r.status);
                  return (
                    <tr key={r.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/purchasing/orders/${r.id}`)}>
                      <Td><Link href={`/purchasing/orders/${r.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{r.number}</Link></Td>
                      <Td className="font-bold">{r.supplierName}</Td>
                      <Td>{r.projectNumber ? <span dir="ltr" className="num text-xs">{r.projectNumber}</span> : <span className="text-muted">—</span>}</Td>
                      <Td><PoStatusBadge status={r.status} /></Td>
                      <Td className="text-end"><Amount value={r.total} currency={r.currency} /></Td>
                      <Td className="text-end">{r.totalSar === null ? <span className="text-muted">—</span> : <Money value={r.totalSar} />}</Td>
                      <Td><span className={clsx('num text-xs', late && 'font-bold text-danger')}>{date(r.expectedOn)}</span></Td>
                    </tr>
                  );
                })}
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
      {importing && <EInvoiceImportDialog open onClose={() => setImporting(false)} onDone={(b) => { setImporting(false); if (b.orderId) router.push(`/purchasing/orders/${b.orderId}`); }} />}
    </>
  );
}

export default function OrdersPage() {
  return <Suspense fallback={<Spinner />}><OrdersList /></Suspense>;
}
