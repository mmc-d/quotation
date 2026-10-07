'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { today } from '@/lib/format';
import { Button, Card, clsx, Input, Select, Spinner } from './ui';

interface SplitRow { userId: string; sharePercent: string; userName?: string }

/**
 * Commission split between reps on a contract (HR-53), for commission.manage. Shares must total 100;
 * an empty split sends the whole commission to the contract owner.
 */
export function CommissionSplitCard({ contractId }: { contractId: string }) {
  const { can } = useMe();
  if (!can('commission.manage')) return null;
  return <SplitInner contractId={contractId} />;
}

function SplitInner({ contractId }: { contractId: string }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['commission-split', contractId], queryFn: () => api.get<{ ownerId: string | null; rows: SplitRow[] }>(`/commissions/splits/${contractId}`) });
  const reps = useQuery({ queryKey: ['commission-reps'], queryFn: () => api.get<{ reps: { id: string; name: string }[] }>(`/commissions/quotas${qs({ period: today().slice(0, 7) })}`), staleTime: 300_000 });
  const [draft, setDraft] = useState<SplitRow[] | null>(null);
  const rows = draft ?? q.data?.rows ?? [];
  const total = rows.reduce((s, r) => s + (Number(r.sharePercent) || 0), 0);
  const valid = rows.length === 0 || (Math.abs(total - 100) < 1e-9 && rows.every((r) => r.userId && Number(r.sharePercent) > 0) && new Set(rows.map((r) => r.userId)).size === rows.length);
  const save = useMutation({
    mutationFn: () => api.put(`/commissions/splits/${contractId}`, { splits: rows.map((r) => ({ userId: r.userId, sharePercent: r.sharePercent })) }),
    onSuccess: () => { toast.success(bi('تم حفظ تقسيم العمولة', 'Commission split saved')); setDraft(null); qc.invalidateQueries({ queryKey: ['commission-split', contractId] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const edit = (i: number, patch: Partial<SplitRow>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const repName = (id: string) => reps.data?.reps.find((r) => r.id === id)?.name ?? id.slice(0, 8);
  return (
    <Card title={bi('تقسيم العمولة', 'Commission split')}>
      {q.isLoading ? <Spinner /> : (
        <div className="space-y-2 text-sm">
          {rows.length === 0 && (
            <p className="text-xs text-muted">{bi('بدون تقسيم: العمولة كاملة لمالك العقد', 'No split: the whole commission goes to the contract owner')}{q.data?.ownerId ? ` (${repName(q.data.ownerId)})` : ''}.</p>
          )}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select className="min-w-0 flex-1" value={r.userId} onChange={(e) => edit(i, { userId: e.target.value })} aria-label={bi('المندوب', 'Rep')}>
                <option value="">{bi('اختر المندوب', 'Pick a rep')}</option>
                {(reps.data?.reps ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
              <Input dir="ltr" inputMode="decimal" className="num w-20 text-start" value={r.sharePercent} onChange={(e) => edit(i, { sharePercent: e.target.value })} aria-label={bi('النسبة %', 'Share %')} />
              <span className="text-muted">%</span>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label={bi('حذف', 'Remove')} onClick={() => setDraft(rows.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setDraft([...rows, { userId: rows.length === 0 && q.data?.ownerId ? q.data.ownerId : '', sharePercent: rows.length === 0 ? '100' : String(Math.max(0, 100 - total)) }])}>{bi('إضافة مندوب', 'Add rep')}</Button>
            {rows.length > 0 && <span className={clsx('text-xs font-bold', valid ? 'text-primary' : 'text-danger')}>{bi('المجموع', 'Total')} <span className="num">{Number(total.toFixed(4))}%</span></span>}
          </div>
          {draft && (
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setDraft(null)}>{bi('إلغاء', 'Cancel')}</Button>
              <Button size="sm" icon={<Users className="size-3.5" />} disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button>
            </div>
          )}
          {!valid && <p className="text-xs text-danger">{bi('يجب أن يكون مجموع النسب 100٪ دون تكرار المندوب.', 'Shares must total 100% with each rep once.')}</p>}
        </div>
      )}
    </Card>
  );
}
