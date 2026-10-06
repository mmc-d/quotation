'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import { Button, Card, Dialog, Empty, ErrorBox, Field, PageHeader, Select, Spinner, Table, Td, Th, clsx } from '@/components/ui';
import { COUNT_STATUS, Chip, InventoryNav, Ltr, WarehouseSelect, errMsg, useLabel } from '../_components/common';

interface CountRow { id: string; number: string; status: string; warehouseId: string; warehouseCode: string; warehouseName: string; lineCount: number; accuracy: string | null; createdAt: string; postedAt: string | null }

export default function CountsPage() {
  const { bi } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const label = useLabel();
  const canCount = can('inventory.count') || can('inventory.write');
  const [status, setStatus] = useState('');
  const [starting, setStarting] = useState(false);
  const [wh, setWh] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['inv-counts', status],
    queryFn: () => api.get<{ rows: CountRow[]; total: number }>(`/inventory/counts${qs({ status, limit: 100 })}`),
    placeholderData: (prev) => prev,
  });
  const start = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>('/inventory/counts', { warehouseId: wh }),
    onSuccess: (c) => {
      toast.success(bi(`بدأ الجرد ${c.number}`, `Count ${c.number} started`));
      qc.invalidateQueries({ queryKey: ['inv-counts'] });
      setStarting(false);
      router.push(`/inventory/counts/${c.id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const rows = list.data?.rows ?? [];
  return (
    <>
      <PageHeader title={bi('الجرد', 'Stock counts')} subtitle={list.data ? bi(`${list.data.total} جرد`, `${list.data.total} counts`) : undefined}
        actions={canCount && <Button icon={<Plus className="size-4" />} onClick={() => setStarting(true)}>{bi('بدء جرد', 'Start a count')}</Button>} />
      <InventoryNav />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[12rem]">
            <option value="">{bi('كل الحالات', 'All statuses')}</option>
            {Object.keys(COUNT_STATUS).map((s) => <option key={s} value={s}>{label(COUNT_STATUS, s)}</option>)}
          </Select>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<ClipboardList className="size-8" />} title={bi('لا عمليات جرد', 'No counts yet')} /> : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('المستودع', 'Warehouse')}</Th><Th className="text-end">{bi('الأسطر', 'Lines')}</Th><Th>{bi('أُنشئ', 'Created')}</Th><Th className="text-end">{bi('الدقة', 'Accuracy')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
            <tbody className={clsx(list.isFetching && 'opacity-70')}>
              {rows.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/inventory/counts/${c.id}`)}>
                  <Td><Link href={`/inventory/counts/${c.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num font-bold text-primary hover:underline">{c.number}</Link></Td>
                  <Td className="text-xs"><Ltr className="font-bold">{c.warehouseCode}</Ltr> {c.warehouseName}</Td>
                  <Td className="text-end"><Ltr>{c.lineCount}</Ltr></Td>
                  <Td className="num whitespace-nowrap text-xs">{dateTime(c.createdAt)}</Td>
                  <Td className="text-end">{c.accuracy !== null ? <span dir="ltr" className={clsx('num font-bold', Number(c.accuracy) >= 0.98 ? 'text-ok' : 'text-danger')}>{(Number(c.accuracy) * 100).toFixed(1)}%</span> : <span className="text-muted">—</span>}</Td>
                  <Td><Chip map={COUNT_STATUS} value={c.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={starting} onClose={() => setStarting(false)} title={bi('بدء جرد', 'Start a count')}
        footer={<><Button variant="outline" onClick={() => setStarting(false)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={start.isPending} disabled={!wh} onClick={() => start.mutate()}>{bi('بدء', 'Start')}</Button></>}>
        <Field label={bi('المستودع', 'Warehouse')} hint={bi('تُلتقط الكميات المتوقعة لكل صنف له رصيد في هذه اللحظة.', 'The expected quantity of every item in stock is captured now.')}>
          <WarehouseSelect value={wh} onChange={setWh} excludeTransit />
        </Field>
      </Dialog>
    </>
  );
}
