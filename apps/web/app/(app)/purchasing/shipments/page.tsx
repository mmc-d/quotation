'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Ship } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, clsx, Empty, ErrorBox, PageHeader, SearchBox, Spinner, Table, Td, Th } from '@/components/ui';
import { Ltr, SHIP_MODE, SHIP_STATUS, ShipStatusBadge, chipCls, useLabel } from '../_components/common';
import { ShipmentDialog } from '../_components/shipment-form';
import type { ShipmentRow } from '../_components/types';

const PAGE = 50;
const OPEN = ['ordered', 'shipped', 'arrived', 'clearing', 'released'];

function ShipmentsList() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { bi } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const term = useDeferredValue(q.trim());
  const [statuses, setStatuses] = useState<string[]>(() => (sp.get('status') ?? OPEN.join(',')).split(',').filter(Boolean));
  const [limit, setLimit] = useState(PAGE);
  const [creating, setCreating] = useState(false);
  const filters = { q: term, status: statuses.join(','), limit };
  const list = useQuery({
    queryKey: ['shipments', filters],
    queryFn: () => api.get<{ rows: ShipmentRow[]; total: number }>(`/inventory/shipments${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const toggle = (s: string) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={bi('الشحنات المستوردة', 'Import shipments')}
        subtitle={list.data ? bi(`${list.data.total} شحنة`, `${list.data.total} shipments`) : undefined}
        actions={can('purchase.write') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{bi('شحنة جديدة', 'New shipment')}</Button>}
      />
      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم الشحنة أو البوليصة أو فسح…', 'Shipment, B/L or FASAH number…')} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setStatuses([])} className={chipCls(statuses.length === 0)}>{bi('الكل', 'All')}</button>
            {Object.keys(SHIP_STATUS).map((s) => <button key={s} type="button" aria-pressed={statuses.includes(s)} onClick={() => toggle(s)} className={chipCls(statuses.includes(s))}>{label(SHIP_STATUS, s)}</button>)}
          </div>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<Ship className="size-8" />} title={bi('لا توجد شحنات مطابقة', 'No matching shipments')} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('المورد', 'Supplier')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('الطريقة', 'Mode')}</Th>
                <Th>{bi('البوليصة', 'B/L')}</Th><Th>ETA</Th><Th>{bi('أوامر الشراء', 'POs')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((r) => {
                  const late = r.eta && r.eta < today && ['ordered', 'shipped'].includes(r.status);
                  return (
                    <tr key={r.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/purchasing/shipments/${r.id}`)}>
                      <Td><Link href={`/purchasing/shipments/${r.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{r.number}</Link></Td>
                      <Td className="font-bold">{r.supplierName ?? <span className="font-normal text-muted">—</span>}</Td>
                      <Td><ShipStatusBadge status={r.status} /></Td>
                      <Td className="text-xs">{label(SHIP_MODE, r.mode)}</Td>
                      <Td><Ltr className="text-xs">{r.blNumber}</Ltr></Td>
                      <Td><span className={clsx('num text-xs', late && 'font-bold text-danger')}>{date(r.eta)}</span></Td>
                      <Td><span className="num">{r.orderIds.length}</span></Td>
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
      {creating && (
        <ShipmentDialog open onClose={() => setCreating(false)} onDone={(s) => { setCreating(false); qc.invalidateQueries({ queryKey: ['shipments'] }); router.push(`/purchasing/shipments/${s.id}`); }} />
      )}
    </>
  );
}

export default function ShipmentsPage() {
  return <Suspense fallback={<Spinner />}><ShipmentsList /></Suspense>;
}
