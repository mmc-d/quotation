'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ExternalLink, History, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Button, Dialog, Empty, ErrorBox, Field, Input, LinkButton, Money, Spinner, Table, Td, Textarea, Th, clsx } from '@/components/ui';
import { WarehouseSelect } from '../../inventory/_components/common';
import type { ProjectView } from './types';

interface ConsumptionRow { productId: string; code: string; nameAr: string; serialTracked?: boolean; boqQty: string; issued: string; consumed: string; returned: string; used: string; reserved: string; variance: string; costSar: string | null }
interface Consumption { project: { id: string; number: string; name: string }; rows: ConsumptionRow[]; totalCostSar: string | null }

const fmt = (v: string | number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });
const Q = ({ v, className }: { v: string; className?: string }) => <span dir="ltr" className={clsx('num whitespace-nowrap', className)}>{fmt(v)}</span>;

/** Materials of the project: contract BOQ vs reserved / issued / consumed / returned (module 07). */
export function MaterialsTab({ p }: { p: ProjectView }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const canCost = can('purchase.cost.read');
  const canRequest = can('purchase.write') || can('inventory.write');
  const [existing, setExisting] = useState<{ id: string | null; message: string } | null>(null);
  const [delivering, setDelivering] = useState(false);
  const canIssue = can('inventory.write');
  const q = useQuery({ queryKey: ['project-consumption', p.id], queryFn: () => api.get<Consumption>(`/inventory/reports/project-consumption/${p.id}`), retry: false });
  const mr = useMutation({
    mutationFn: () => api.post<{ id: string; number: string; status: string; lines: unknown[]; reserved: unknown[] }>(`/inventory/material-requests/from-project/${p.id}`, {}),
    onSuccess: (r) => {
      toast.success(r.status === 'closed'
        ? bi(`طلب المواد ${r.number}: لا نقص — حُجز المتوفر من المخزون`, `Material request ${r.number}: nothing short — available stock reserved`)
        : bi(`أُنشئ طلب المواد ${r.number}`, `Material request ${r.number} created`), { action: { label: bi('فتح', 'Open'), onClick: () => router.push(`/purchasing/requests/${r.id}`) } });
      qc.invalidateQueries({ queryKey: ['project-consumption', p.id] });
      qc.invalidateQueries({ queryKey: ['project', p.id] });
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.status === 409) {
        // find the open request of this project to link to it
        const open = await api.get<{ rows: { id: string; number: string }[] }>(`/inventory/material-requests?projectId=${p.id}&status=draft,approved&limit=1`).catch(() => null);
        setExisting({ id: open?.rows[0]?.id ?? null, message: e.message });
        return;
      }
      toast.error((e as Error).message);
    },
  });

  const rows = q.data?.rows ?? [];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          {canCost && q.data?.totalCostSar !== null && q.data?.totalCostSar !== undefined && <>{bi('تكلفة المواد المستخدمة', 'Cost of materials used')} <b><Money value={q.data.totalCostSar} /></b></>}
        </span>
        <div className="flex flex-wrap gap-2">
          <LinkButton size="sm" href={`/inventory/moves?projectId=${p.id}`} icon={<History className="size-3.5" />}>{bi('حركات المشروع', 'Project moves')}</LinkButton>
          {canIssue && (q.data?.rows ?? []).some((r) => Number(r.boqQty) - Number(r.used) > 0) && <Button size="sm" variant="gold" icon={<Truck className="size-3.5" />} onClick={() => setDelivering(true)}>{bi('تسليم المواد للمشروع', 'Deliver materials')}</Button>}
          {canRequest && <Button size="sm" icon={<ClipboardList className="size-3.5" />} loading={mr.isPending} disabled={!p.contract} title={!p.contract ? bi('المشروع غير مرتبط بعقد', 'The project has no contract') : undefined} onClick={() => { setExisting(null); mr.mutate(); }}>{bi('إنشاء طلب مواد', 'Create material request')}</Button>}
        </div>
      </div>
      {existing && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>{bi('يوجد طلب مواد مفتوح لهذا المشروع بالفعل.', 'This project already has an open material request.')}</span>
          {existing.id ? <Link href={`/purchasing/requests/${existing.id}`} className="inline-flex items-center gap-1 font-bold text-primary hover:underline"><ExternalLink className="size-3.5" />{bi('فتح الطلب', 'Open it')}</Link> : <span dir="ltr" className="text-xs">{existing.message}</span>}
        </div>
      )}
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? (
        <Empty title={bi('لا مواد بعد', 'No materials yet')} hint={!p.contract ? bi('اربط المشروع بعقد لحساب الكميات من جدول الكميات.', 'Link the project to a contract to plan from its BOQ.') : undefined} />
      ) : (
        <Table>
          <thead><tr>
            <Th>{bi('الكود', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th className="text-end">{bi('كمية العقد', 'BOQ qty')}</Th><Th className="text-end">{bi('محجوز', 'Reserved')}</Th>
            <Th className="text-end">{bi('مصروف', 'Issued')}</Th><Th className="text-end">{bi('مستهلك', 'Consumed')}</Th><Th className="text-end">{bi('مرتجع', 'Returned')}</Th><Th className="text-end">{bi('الفرق', 'Variance')}</Th>
            {canCost && <Th className="text-end">{bi('التكلفة', 'Cost')}</Th>}
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const v = Number(r.variance);
              return (
                <tr key={r.productId}>
                  <Td><Link href={`/inventory/${r.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{r.code}</Link></Td>
                  <Td className="max-w-[14rem] truncate text-xs">{r.nameAr}</Td>
                  <Td className="text-end font-bold"><Q v={r.boqQty} /></Td>
                  <Td className="text-end"><Q v={r.reserved} /></Td>
                  <Td className="text-end"><Q v={r.issued} /></Td>
                  <Td className="text-end"><Q v={r.consumed} /></Td>
                  <Td className="text-end"><Q v={r.returned} /></Td>
                  <Td className="text-end"><span dir="ltr" className={clsx('num font-bold', v > 0 ? 'text-danger' : v < 0 ? 'text-amber-700' : 'text-ok')}>{v > 0 ? '+' : ''}{fmt(v)}</span></Td>
                  {canCost && <Td className="text-end"><Money value={r.costSar} /></Td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {delivering && q.data && <DeliverDialog p={p} rows={q.data.rows} onClose={() => setDelivering(false)} />}
      <p className="mt-2 text-xs text-muted">{bi('الفرق = (المصروف + المستهلك − المرتجع) − كمية العقد. موجب = استخدام أكثر من العقد.', 'Variance = (issued + consumed − returned) − BOQ. Positive = more used than contracted.')}</p>
    </div>
  );
}

interface Reservation { productId: string; warehouseId: string; warehouseCode: string; qty: string; status: string }

/**
 * Deliver materials to the project site: one stock issue from a warehouse, prefilled with what the
 * contract still needs (BOQ − used). Stock leaves at average cost and the project's reservations are consumed.
 */
function DeliverDialog({ p, rows, onClose }: { p: ProjectView; rows: ConsumptionRow[]; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const res = useQuery({ queryKey: ['project-reservations', p.id], queryFn: () => api.get<Reservation[]>(`/inventory/reservations?projectId=${p.id}`) });
  const open = rows.filter((r) => Number(r.boqQty) - Number(r.used) > 0);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map((r) => [r.productId, String(Number(r.boqQty) - Number(r.used))])));
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  // default to the warehouse holding this project's reservations
  const reservedWh = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of res.data ?? []) by.set(r.warehouseId, (by.get(r.warehouseId) ?? 0) + Number(r.qty));
    return [...by].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [res.data]);
  const wh = warehouseId ?? reservedWh;
  const split = (v: string | undefined) => (v ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const lines = open.map((r) => ({ r, q: Number(qty[r.productId] || 0) })).filter((x) => x.q > 0);
  const problems = lines.filter((x) => x.r.serialTracked && split(serials[x.r.productId]).length !== x.q);
  const m = useMutation({
    mutationFn: () => api.post<{ moves: unknown[] }>('/inventory/issue', {
      fromWarehouseId: wh, projectId: p.id, note: note.trim() || null,
      lines: lines.map((x) => ({ productId: x.r.productId, qty: String(x.q), serials: x.r.serialTracked ? split(serials[x.r.productId]) : undefined })),
    }),
    onSuccess: (r) => {
      toast.success(bi(`تم تسليم ${r.moves.length} صنف للمشروع وخصمها من المخزون`, `${r.moves.length} item(s) delivered and deducted from stock`));
      qc.invalidateQueries({ queryKey: ['project-consumption', p.id] });
      qc.invalidateQueries({ queryKey: ['project', p.id] });
      qc.invalidateQueries({ queryKey: ['project-reservations', p.id] });
      qc.invalidateQueries({ queryKey: ['insights-project', p.id] });
      qc.invalidateQueries({ queryKey: ['inv-stock'] });
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open wide onClose={onClose} title={<>{bi('تسليم المواد للمشروع', 'Deliver materials to the project')} <span dir="ltr" className="num">{p.number}</span></>}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button icon={<Truck className="size-4" />} loading={m.isPending} disabled={!wh || !lines.length || problems.length > 0} onClick={() => m.mutate()}>{bi('تأكيد التسليم وخصم المخزون', 'Confirm delivery')}</Button></>}>
      <div className="space-y-3">
        <Field label={bi('من المستودع', 'From warehouse')} hint={reservedWh && wh === reservedWh ? bi('المستودع المحجوز منه لهذا المشروع', 'Where this project\'s stock is reserved') : undefined}>
          <WarehouseSelect value={wh} onChange={setWarehouseId} excludeTransit />
        </Field>
        <Table>
          <thead><tr><Th>{bi('الصنف', 'Item')}</Th><Th className="text-end">{bi('المتبقي من العقد', 'Still to deliver')}</Th><Th className="text-end">{bi('محجوز', 'Reserved')}</Th><Th className="w-28">{bi('الكمية المسلّمة', 'Deliver now')}</Th></tr></thead>
          <tbody>
            {open.map((r) => (
              <tr key={r.productId} className="align-top">
                <Td>
                  <span dir="ltr" className="num font-bold">{r.code}</span> <span className="text-xs text-muted">{r.nameAr}</span>
                  {r.serialTracked && Number(qty[r.productId] || 0) > 0 && (
                    <Textarea rows={2} dir="ltr" className="mt-1.5 font-mono text-xs" placeholder={bi('الأرقام التسلسلية المسلّمة — رقم في كل سطر', 'Serial numbers delivered — one per line')} value={serials[r.productId] ?? ''} onChange={(e) => setSerials((x) => ({ ...x, [r.productId]: e.target.value }))} />
                  )}
                </Td>
                <Td className="text-end"><Q v={String(Number(r.boqQty) - Number(r.used))} /></Td>
                <Td className="text-end"><Q v={r.reserved} /></Td>
                <Td><Input type="number" inputMode="decimal" dir="ltr" min={0} value={qty[r.productId] ?? ''} onChange={(e) => setQty((x) => ({ ...x, [r.productId]: e.target.value }))} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {problems.length > 0 && <p className="text-xs font-bold text-danger">{bi('أدخل رقمًا تسلسليًا لكل وحدة من الأصناف المتتبَّعة.', 'Enter one serial number per unit for tracked items.')}</p>}
        <Field label={bi('ملاحظة (رقم سند التسليم، اسم المستلم…)', 'Note (delivery note no., received by…)')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
