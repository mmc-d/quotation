'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MessageCircle, Smile } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Spinner } from '@/components/ui';
import { Stars } from './common';
import type { CsatInfo } from './types';

/** Customer rating of a completed work order + (re)send the one-tap survey by WhatsApp. */
export function CsatCard({ woId, canSend }: { woId: string; canSend: boolean }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const key = ['wo-csat', woId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<CsatInfo>(`/service/work-orders/${woId}/csat`) });
  const send = useMutation({
    mutationFn: () => api.post<{ to: string; link: string; status: string }>(`/service/work-orders/${woId}/csat/send`),
    onSuccess: (r) => { toast.success(bi(`أُرسل الاستبيان إلى ${r.to} (${r.status})`, `Survey sent to ${r.to} (${r.status})`)); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const c = q.data;
  return (
    <Card title={<span className="flex items-center gap-1.5"><Smile className="size-4" />{bi('رضا العميل', 'Customer satisfaction')}</span>}>
      {q.isLoading ? <Spinner /> : !c ? <p className="text-sm text-muted">—</p> : c.at ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2"><Stars score={c.score} className="[&_svg]:size-5" /><span className="num text-sm font-bold">{c.score}/5</span></div>
          {c.comment && <p className="whitespace-pre-wrap rounded-lg bg-tint/60 px-2 py-1.5 text-sm">{c.comment}</p>}
          <p className="text-xs text-muted">{bi('قُيّم في', 'Rated on')} <span className="num">{dateTime(c.at)}</span></p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{bi('لم يقيّم العميل الزيارة بعد.', 'The customer has not rated this visit yet.')}</p>
          {canSend && c.available && <Button variant="gold" loading={send.isPending} icon={<MessageCircle className="size-4" />} onClick={() => send.mutate()}>{bi('إعادة إرسال الاستبيان', 'Resend survey')}</Button>}
          {c.available && (
            <Button variant="outline" size="sm" icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard?.writeText(c.url).then(() => toast.success(bi('تم نسخ الرابط', 'Link copied'))); }}>
              {bi('نسخ رابط الاستبيان', 'Copy survey link')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
