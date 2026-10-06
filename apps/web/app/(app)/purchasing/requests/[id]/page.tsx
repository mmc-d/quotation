'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShoppingCart, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, Empty, ErrorBox, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { ConfirmDialog } from '../../../quotes/_components/common';
import { Chip, Info, Ltr, MrStatusBadge, PoStatusBadge, RESERVATION_STATUS, WarningList, qty } from '../../_components/common';
import { PoFromRequestDialog } from '../../_components/mr-dialogs';
import type { MrView } from '../../_components/types';

export default function MaterialRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const key = ['mr', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<MrView>(`/inventory/material-requests/${id}`) });
  const [confirm, setConfirm] = useState<'approve' | 'cancel' | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [created, setCreated] = useState<{ unmatched: string[]; reserved: number } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`mr-created-${id}`);
      if (raw) setCreated(JSON.parse(raw));
    } catch { /* storage blocked */ }
  }, [id]);

  const act = useMutation({
    mutationFn: (path: 'approve' | 'cancel') => api.post<MrView>(`/inventory/material-requests/${id}/${path}`),
    onSuccess: (mr) => {
      qc.setQueryData(key, mr);
      qc.invalidateQueries({ queryKey: ['mr-list'] });
      toast.success(bi('تم', 'Done'));
      setConfirm(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const mr = q.data;
  if (q.isLoading) return <Spinner />;
  if (!mr) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;

  const open = ['draft', 'approved'].includes(mr.status);
  const hasOpen = mr.lines.some((l) => Number(l.openQty) > 0);
  const dismiss = () => { setCreated(null); try { sessionStorage.removeItem(`mr-created-${id}`); } catch { /* storage blocked */ } };

  return (
    <>
      <PageHeader
        back="/purchasing/requests"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{mr.number}</span><MrStatusBadge status={mr.status} /></span>}
        subtitle={mr.project ? <>{bi('المشروع', 'Project')}: <Link href={`/projects/${mr.project.id}`} className="font-bold text-primary hover:underline"><span dir="ltr" className="num">{mr.project.number}</span> — {mr.project.name}</Link></> : undefined}
        actions={<>
          {mr.status === 'draft' && can('purchase.approve') && <Button variant="outline" icon={<CheckCircle2 className="size-4" />} onClick={() => setConfirm('approve')}>{bi('اعتماد', 'Approve')}</Button>}
          {open && hasOpen && can('purchase.write') && <Button icon={<ShoppingCart className="size-4" />} onClick={() => setOrdering(true)}>{bi('إنشاء أمر شراء', 'Create purchase order')}</Button>}
          {open && (can('purchase.write') || can('inventory.write')) && <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setConfirm('cancel')}>{bi('إلغاء الطلب', 'Cancel request')}</Button>}
        </>}
      />

      {created && created.unmatched.length > 0 && (
        <WarningList className="mb-4" title={bi('بنود في العقد بدون منتج مطابق في الكتالوج (لم تُحتسب)', 'Contract lines with no matching catalogue product (not counted)')}
          items={created.unmatched.map((c) => ({ ar: c, en: c }))} />
      )}
      {created && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2 text-sm text-emerald-900">
          <span>{bi(`تم حجز ${created.reserved} بند من المخزون المتوفر لهذا المشروع.`, `${created.reserved} line(s) reserved from available stock for this project.`)}</span>
          <Button size="sm" variant="ghost" onClick={dismiss}>{bi('إخفاء', 'Dismiss')}</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={bi('النواقص المطلوب شراؤها', 'Shortage to purchase')} padded={false}>
            {mr.lines.length === 0 ? <Empty title={bi('لا نواقص — كل المواد محجوزة من المخزون', 'No shortage — everything is reserved from stock')} /> : (
              <Table>
                <thead><tr>
                  <Th>{bi('الكود', 'Code')}</Th><Th>{bi('الوصف', 'Description')}</Th><Th className="text-end">{bi('المطلوب', 'Qty')}</Th>
                  <Th className="text-end">{bi('تم طلبه', 'Ordered')}</Th><Th className="text-end">{bi('المتبقي', 'Open')}</Th>
                </tr></thead>
                <tbody>
                  {mr.lines.map((l) => (
                    <tr key={l.id}>
                      <Td><Ltr className="font-bold">{l.code}</Ltr></Td>
                      <Td className="text-xs">{l.description ?? '—'}</Td>
                      <Td className="text-end"><Ltr>{qty(l.qty)}</Ltr></Td>
                      <Td className="text-end"><Ltr>{qty(l.orderedQty)}</Ltr></Td>
                      <Td className="text-end"><Ltr className={Number(l.openQty) > 0 ? 'font-bold text-gold-dark' : 'text-ok'}>{qty(l.openQty)}</Ltr></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title={bi('الحجوزات القائمة للمشروع', 'Active reservations for the project')} padded={false}>
            {mr.reservations.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد حجوزات.', 'No reservations.')}</p> : (
              <Table>
                <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('المستودع', 'Warehouse')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
                <tbody>
                  {mr.reservations.map((r) => (
                    <tr key={r.id}>
                      <Td><Ltr className="font-bold">{r.code}</Ltr></Td>
                      <Td><Ltr>{r.warehouseCode}</Ltr></Td>
                      <Td className="text-end"><Ltr>{qty(r.qty)}</Ltr></Td>
                      <Td><Chip map={RESERVATION_STATUS} value={r.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={bi('التفاصيل', 'Details')}>
            <Info label={bi('مطلوب بتاريخ', 'Needed by')}><Ltr>{mr.neededBy ? date(mr.neededBy) : null}</Ltr></Info>
            <Info label={bi('تاريخ الإنشاء', 'Created')}><Ltr>{date(mr.createdAt)}</Ltr></Info>
            {mr.notes && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{mr.notes}</p>}
          </Card>
          <Card title={bi('أوامر الشراء', 'Purchase orders')}>
            {mr.purchaseOrders.length === 0 ? <p className="text-sm text-muted">{bi('لم يُنشأ أمر شراء بعد.', 'No purchase order yet.')}</p> : (
              <ul className="space-y-1.5">
                {mr.purchaseOrders.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link href={`/purchasing/orders/${p.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{p.number}</Link>
                    <PoStatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'approve' ? bi('اعتماد طلب المواد', 'Approve the material request') : bi('إلغاء طلب المواد', 'Cancel the material request')}
        message={confirm === 'approve'
          ? bi('سيصبح الطلب معتمدًا وجاهزًا لإنشاء أوامر الشراء.', 'The request becomes approved and ready for purchase orders.')
          : bi('لن يمكن الطلب بعد الإلغاء. الحجوزات القائمة تبقى كما هي.', 'The request can no longer be ordered. Existing reservations stay as they are.')}
        danger={confirm === 'cancel'}
        loading={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
        onClose={() => setConfirm(null)}
      />
      {ordering && <PoFromRequestDialog mr={mr} open onClose={() => setOrdering(false)} />}
    </>
  );
}
