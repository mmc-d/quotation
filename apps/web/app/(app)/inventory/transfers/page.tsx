'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, PackageMinus, PackagePlus, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, PageHeader, Select, Spinner, Table, Td, Th, clsx } from '@/components/ui';
import { Chip, InventoryNav, Ltr, TRANSFER_STATUS, WarehouseSelect, useLabel } from '../_components/common';
import { NewTransferDialog, ProjectStockDialog } from '../_components/stock-dialogs';

const PAGE = 50;

interface TransferRow {
  id: string; number: string; status: string; fromWarehouseId: string; toWarehouseId: string; projectId: string | null; notes: string | null;
  lines: { productId: string; code: string; qty: string; serials?: string[] }[]; shippedAt: string | null; receivedAt: string | null; createdAt: string;
  from: { id: string; code: string; nameAr: string } | null; to: { id: string; code: string; nameAr: string } | null;
}

export default function TransfersPage() {
  const { bi } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const label = useLabel();
  const canWrite = can('inventory.write');
  const [status, setStatus] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [dialog, setDialog] = useState<null | 'new' | 'issue' | 'return'>(null);
  const filters = { status, warehouseId, limit };
  const list = useQuery({
    queryKey: ['inv-transfers', filters],
    queryFn: () => api.get<{ rows: TransferRow[]; total: number }>(`/inventory/transfers${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  return (
    <>
      <PageHeader title={bi('التحويلات المخزنية', 'Stock transfers')} subtitle={list.data ? bi(`${list.data.total} تحويل`, `${list.data.total} transfers`) : undefined}
        actions={canWrite && <>
          <Button variant="outline" icon={<PackageMinus className="size-4" />} onClick={() => setDialog('issue')}>{bi('صرف لمشروع', 'Issue to project')}</Button>
          <Button variant="outline" icon={<PackagePlus className="size-4" />} onClick={() => setDialog('return')}>{bi('مرتجع من مشروع', 'Return from project')}</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setDialog('new')}>{bi('تحويل جديد', 'New transfer')}</Button>
        </>} />
      <InventoryNav />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[12rem]">
            <option value="">{bi('كل الحالات', 'All statuses')}</option>
            {Object.keys(TRANSFER_STATUS).map((s) => <option key={s} value={s}>{label(TRANSFER_STATUS, s)}</option>)}
          </Select>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} emptyLabel={bi('كل المستودعات', 'All warehouses')} className="max-w-xs" />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<ArrowLeftRight className="size-8" />} title={bi('لا تحويلات', 'No transfers')} /> : (
          <>
            <Table>
              <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('من ← إلى', 'From → to')}</Th><Th className="text-end">{bi('الأسطر', 'Lines')}</Th><Th>{bi('أُنشئ', 'Created')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/inventory/transfers/${t.id}`)}>
                    <Td><Link href={`/inventory/transfers/${t.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num font-bold text-primary hover:underline">{t.number}</Link></Td>
                    <Td className="whitespace-nowrap text-xs"><Ltr>{`${t.from?.code ?? '?'} → ${t.to?.code ?? '?'}`}</Ltr></Td>
                    <Td className="text-end"><Ltr>{t.lines.length}</Ltr></Td>
                    <Td className="num whitespace-nowrap text-xs">{dateTime(t.createdAt)}</Td>
                    <Td><Chip map={TRANSFER_STATUS} value={t.status} /></Td>
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
      <NewTransferDialog open={dialog === 'new'} onClose={() => setDialog(null)} />
      <ProjectStockDialog mode="issue" open={dialog === 'issue'} onClose={() => setDialog(null)} />
      <ProjectStockDialog mode="return" open={dialog === 'return'} onClose={() => setDialog(null)} />
    </>
  );
}
