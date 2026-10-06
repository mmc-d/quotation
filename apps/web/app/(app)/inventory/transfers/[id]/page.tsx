'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Truck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import { Button, Card, ErrorBox, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { ConfirmDialog } from '../../../quotes/_components/common';
import { Chip, InventoryNav, Ltr, Qty, TRANSFER_STATUS, WhKindChip, errMsg, useRefLabel, type StockMove } from '../../_components/common';
import { MoveRow } from '../../_components/move-row';

interface TransferView {
  id: string; number: string; status: string; projectId: string | null; notes: string | null; createdAt: string; shippedAt: string | null; receivedAt: string | null;
  lines: { productId: string; code: string; qty: string; serials?: string[] }[];
  from: { id: string; code: string; nameAr: string; kind: string } | null; to: { id: string; code: string; nameAr: string; kind: string } | null;
  moves: StockMove[];
}

type Action = 'ship' | 'receive' | 'cancel';

export default function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const refLabel = useRefLabel();
  const canWrite = can('inventory.write');
  const canCost = can('purchase.cost.read');
  const q = useQuery({ queryKey: ['inv-transfer', id], queryFn: () => api.get<TransferView>(`/inventory/transfers/${id}`) });
  const [confirm, setConfirm] = useState<Action | null>(null);
  const act = useMutation({
    mutationFn: (a: Action) => api.post<TransferView>(`/inventory/transfers/${id}/${a}`),
    onSuccess: (t, a) => {
      qc.setQueryData(['inv-transfer', id], t);
      for (const k of ['inv-transfers', 'inv-stock', 'inv-moves', 'inv-stock-one']) qc.invalidateQueries({ queryKey: [k] });
      toast.success(a === 'ship' ? bi('تم الشحن — البضاعة في الطريق', 'Shipped — goods in transit') : a === 'receive' ? bi('تم الاستلام', 'Received') : bi('أُلغي التحويل', 'Transfer cancelled'));
      setConfirm(null);
    },
    onError: (e) => { toast.error(errMsg(e)); setConfirm(null); },
  });

  if (q.isLoading) return <Spinner />;
  const t = q.data;
  if (!t) return <><PageHeader back="/inventory/transfers" title={bi('تحويل', 'Transfer')} /><ErrorBox error={q.error} /></>;

  const whCode = (wid: string | null) => (!wid ? null : wid === t.from?.id ? t.from.code : wid === t.to?.id ? t.to.code : 'TRANSIT');
  const confirmText: Record<Action, [string, string]> = {
    ship: [bi('شحن التحويل', 'Ship the transfer'), bi('تخرج البضاعة من المستودع المصدر إلى «بضاعة في الطريق».', 'Goods leave the source warehouse into “in transit”.')],
    receive: [bi('استلام التحويل', 'Receive the transfer'), bi('تدخل البضاعة المستودع الوجهة، وتنتقل حجوزات المشروع معها.', "Goods enter the destination warehouse; the project's reservations follow them.")],
    cancel: [bi('إلغاء التحويل', 'Cancel the transfer'), bi('لن تتحرك أي بضاعة.', 'No goods will move.')],
  };

  return (
    <>
      <PageHeader back="/inventory/transfers"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{t.number}</span><Chip map={TRANSFER_STATUS} value={t.status} /></span>}
        actions={canWrite && <>
          {t.status === 'draft' && <Button variant="outline" icon={<XCircle className="size-4" />} onClick={() => setConfirm('cancel')}>{bi('إلغاء', 'Cancel')}</Button>}
          {t.status === 'draft' && <Button icon={<Truck className="size-4" />} onClick={() => setConfirm('ship')}>{bi('شحن', 'Ship')}</Button>}
          {t.status === 'in_transit' && <Button icon={<PackageCheck className="size-4" />} onClick={() => setConfirm('receive')}>{bi('استلام', 'Receive')}</Button>}
        </>} />
      <InventoryNav />

      <Card className="mb-5">
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><div className="text-[11px] font-bold text-muted">{bi('من', 'From')}</div><div className="flex flex-wrap items-center gap-1.5 font-bold"><Ltr>{t.from?.code}</Ltr><span className="text-xs font-normal">{t.from?.nameAr}</span><WhKindChip kind={t.from?.kind} /></div></div>
          <div><div className="text-[11px] font-bold text-muted">{bi('إلى', 'To')}</div><div className="flex flex-wrap items-center gap-1.5 font-bold"><Ltr>{t.to?.code}</Ltr><span className="text-xs font-normal">{t.to?.nameAr}</span><WhKindChip kind={t.to?.kind} /></div></div>
          <div><div className="text-[11px] font-bold text-muted">{bi('شُحن', 'Shipped')}</div><div className="num text-xs">{dateTime(t.shippedAt)}</div></div>
          <div><div className="text-[11px] font-bold text-muted">{bi('استُلم', 'Received')}</div><div className="num text-xs">{dateTime(t.receivedAt)}</div></div>
        </div>
        {t.projectId && <div className="mt-3 text-sm"><span className="text-xs font-bold text-muted">{bi('المشروع', 'Project')}: </span><Link href={`/projects/${t.projectId}`} className="font-bold text-primary hover:underline">{bi('فتح المشروع', 'Open project')}</Link></div>}
        {t.notes && <p className="mt-3 text-sm text-muted">{t.notes}</p>}
      </Card>

      <Card padded={false} className="mb-5" title={bi('الأصناف', 'Items')}>
        <Table>
          <thead><tr><Th>#</Th><Th>{bi('الكود', 'Code')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th>{bi('الأرقام التسلسلية', 'Serials')}</Th></tr></thead>
          <tbody>
            {t.lines.map((l, i) => (
              <tr key={`${l.productId}-${i}`}>
                <Td className="num text-xs text-muted">{i + 1}</Td>
                <Td><Link href={`/inventory/${l.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{l.code}</Link></Td>
                <Td className="text-end font-bold"><Qty value={l.qty} /></Td>
                <Td className="text-xs">{l.serials?.length ? <span dir="ltr" className="num break-all">{l.serials.join(', ')}</span> : <span className="text-muted">—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {t.moves.length > 0 && (
        <Card padded={false} title={bi('الحركات المرحّلة', 'Posted moves')}>
          <Table>
            <thead><tr><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('النوع', 'Kind')}</Th><Th>{bi('من ← إلى', 'From → to')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th>{canCost && <Th className="text-end">{bi('تكلفة الوحدة', 'Unit cost')}</Th>}<Th>{bi('المرجع', 'Reference')}</Th></tr></thead>
            <tbody>{t.moves.map((m) => ({ ...m, fromCode: whCode(m.fromWarehouseId), toCode: whCode(m.toWarehouseId) })).map((m) => <MoveRow key={m.id} m={m} canCost={canCost} refLabel={refLabel} />)}</tbody>
          </Table>
        </Card>
      )}

      <ConfirmDialog open={!!confirm} danger={confirm === 'cancel'} title={confirm ? confirmText[confirm][0] : ''} message={confirm ? confirmText[confirm][1] : ''}
        loading={act.isPending} onConfirm={() => confirm && act.mutate(confirm)} onClose={() => setConfirm(null)} />
    </>
  );
}
