'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ExternalLink, History } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Button, Empty, ErrorBox, LinkButton, Money, Spinner, Table, Td, Th, clsx } from '@/components/ui';
import type { ProjectView } from './types';

interface ConsumptionRow { productId: string; code: string; nameAr: string; boqQty: string; issued: string; consumed: string; returned: string; used: string; reserved: string; variance: string; costSar: string | null }
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
      <p className="mt-2 text-xs text-muted">{bi('الفرق = (المصروف + المستهلك − المرتجع) − كمية العقد. موجب = استخدام أكثر من العقد.', 'Variance = (issued + consumed − returned) − BOQ. Positive = more used than contracted.')}</p>
    </div>
  );
}
