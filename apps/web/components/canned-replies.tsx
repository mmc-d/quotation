'use client';
/**
 * Canned replies (FSM-84): a "Replies" button (searchable dialog) and the "/" shortcut — typing
 * `/vis` in a reply box lists matching replies. The chosen reply is rendered by the API with the
 * ticket / conversation placeholders filled ({customer_name}, {ticket_number}, {technician_name}).
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquareText, Settings2 } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Badge, Button, Dialog, Empty, Input, Spinner, clsx } from './ui';

export interface CannedReply { id: string; shortcut: string; title: string; bodyAr: string; bodyEn: string | null; scope: 'inbox' | 'ticket' | 'both'; shared: boolean; mine: boolean; updatedAt: string }

export function useCannedReplies(scope?: 'inbox' | 'ticket', enabled = true) {
  return useQuery({
    queryKey: ['canned-replies', scope ?? 'all'],
    queryFn: () => api.get<{ rows: CannedReply[]; canShare: boolean; placeholders: string[] }>(`/kb/replies${qs({ scope })}`),
    staleTime: 60_000,
    enabled,
  });
}

const matches = (r: CannedReply, q: string) => {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return r.shortcut.toLowerCase().startsWith(t) || `${r.title} ${r.bodyAr} ${r.bodyEn ?? ''}`.toLowerCase().includes(t);
};

/** `/abc` (a slash and no space yet) → "abc"; anything else → null. */
export function slashQuery(text: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(text);
  return m ? m[1]! : null;
}

export function CannedReplies({ scope, ticketId, conversationId, text, onInsert, size = 'sm' }: {
  scope: 'inbox' | 'ticket';
  ticketId?: string;
  conversationId?: string;
  /** current reply text — drives the "/" suggestions */
  text: string;
  /** rendered body; `replace` is true when it came from the "/" shortcut (the text was only the shortcut) */
  onInsert: (body: string, replace: boolean) => void;
  size?: 'sm' | 'md';
}) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const allowed = can('kb.read') || can('ticket.write') || can('message.send');
  const list = useCannedReplies(scope, allowed);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const slash = slashQuery(text);
  const rows = list.data?.rows ?? [];
  const slashHits = useMemo(() => (slash === null ? [] : rows.filter((r) => matches(r, slash)).slice(0, 6)), [rows, slash]);

  const render = useMutation({
    mutationFn: ({ r }: { r: CannedReply; replace: boolean }) => api.post<{ body: string }>(`/kb/replies/${r.id}/render`, { ticketId: ticketId ?? null, conversationId: conversationId ?? null, locale }),
    onSuccess: (out, v) => { onInsert(out.body, v.replace); setOpen(false); setQ(''); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!allowed) return null;

  const pick = (r: CannedReply, replace: boolean) => render.mutate({ r, replace });

  return (
    <div className="relative shrink-0">
      <Button type="button" variant="outline" size={size} icon={<MessageSquareText className="size-4 text-gold" />} onClick={() => setOpen(true)} title={bi('اكتب / في خانة الرد للاختصار', 'Type / in the reply box as a shortcut')}>
        {bi('ردود جاهزة', 'Canned replies')}
      </Button>
      {slash !== null && slashHits.length > 0 && (
        <ul role="listbox" aria-label={bi('ردود جاهزة', 'Canned replies')} className="absolute bottom-full end-0 z-20 mb-1 max-h-64 w-80 max-w-[85vw] overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {slashHits.map((r) => (
            <li key={r.id}>
              <button type="button" role="option" aria-selected={false} disabled={render.isPending} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r, true)}
                className="flex w-full items-start gap-2 px-3 py-1.5 text-start text-sm hover:bg-tint">
                <span dir="ltr" className="shrink-0 font-mono text-xs font-bold text-primary">/{r.shortcut}</span>
                <span className="min-w-0"><span className="block truncate font-bold">{r.title}</span><span className="block truncate text-xs text-muted">{locale === 'en' && r.bodyEn ? r.bodyEn : r.bodyAr}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && createPortal(
        <Dialog open={open} onClose={() => setOpen(false)} wide title={<span className="flex items-center gap-2"><MessageSquareText className="size-4 text-gold" />{bi('ردود جاهزة', 'Canned replies')}</span>}
          footer={<><Link href="/kb/replies" className="me-auto inline-flex items-center gap-1 text-xs font-bold text-gold-dark hover:underline"><Settings2 className="size-3.5" />{bi('إدارة الردود', 'Manage replies')}</Link><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{bi('إغلاق', 'Close')}</Button></>}>
          <Input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={bi('ابحث بالاختصار أو النص…', 'Search shortcut or text…')} className="mb-3" />
          {list.isLoading ? <Spinner /> : (() => {
            const hits = rows.filter((r) => matches(r, q));
            if (!hits.length) return <Empty title={bi('لا توجد ردود جاهزة', 'No canned replies')} hint={bi('أضف ردودًا من صفحة إدارة الردود.', 'Add replies from the manage replies page.')} />;
            return (
              <ul className="divide-y divide-line/70">
                {hits.map((r) => (
                  <li key={r.id}>
                    <button type="button" disabled={render.isPending} onClick={() => pick(r, false)} className={clsx('w-full rounded-lg px-2 py-2 text-start hover:bg-tint', render.isPending && 'opacity-60')}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span dir="ltr" className="font-mono text-xs font-bold text-primary">/{r.shortcut}</span>
                        <span className="text-sm font-bold">{r.title}</span>
                        {r.shared ? <Badge tone="green">{bi('مشترك', 'Shared')}</Badge> : <Badge>{bi('شخصي', 'Personal')}</Badge>}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap text-xs text-muted">{locale === 'en' && r.bodyEn ? r.bodyEn : r.bodyAr}</span>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
        </Dialog>,
        document.body,
      )}
    </div>
  );
}
