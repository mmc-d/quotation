'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe2, Lock, MessageCircle, Send, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Checkbox, Textarea, clsx } from '@/components/ui';
import { AttachmentList } from '@/components/attachments';
import { CannedReplies } from '@/components/canned-replies';

export interface TicketMessage {
  id: string; author: 'staff' | 'customer' | 'system' | string; authorName: string | null; body: string; internal: boolean; deliveredVia: string | null; createdAt: string;
  files: { id: string; filename: string; mime: string; url: string }[];
}

function Delivered({ via }: { via: string | null }) {
  const { bi } = useI18n();
  if (!via || via === 'none') return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {via.split(',').map((v) => (
        <span key={v} className="inline-flex items-center gap-0.5">
          {v === 'whatsapp' ? <><MessageCircle className="size-3" />{bi('واتساب', 'WhatsApp')}</> : v === 'portal' ? <><Globe2 className="size-3" />{bi('البوابة', 'Portal')}</> : v}
        </span>
      ))}
    </span>
  );
}

/** Ticket conversation: customer messages, staff replies (delivered to the customer) and internal notes. */
export function TicketConversation({ ticketId, status, messages, canWrite, onUpdated }: {
  ticketId: string; status: string; messages: TicketMessage[]; canWrite: boolean; onUpdated: (t: unknown) => void;
}) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  const send = useMutation({
    mutationFn: () => internal
      ? api.post(`/field/tickets/${ticketId}/notes`, { note: text.trim() })
      : api.post(`/field/tickets/${ticketId}/respond`, { note: text.trim() }),
    onSuccess: (t) => {
      onUpdated(t);
      qc.invalidateQueries({ queryKey: ['field-tickets'] });
      setText('');
      toast.success(internal ? bi('تمت إضافة الملاحظة الداخلية', 'Internal note added') : bi('تم إرسال الرد للعميل', 'Reply sent to the customer'));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const closed = status === 'closed';
  const canSend = canWrite && !!text.trim() && !(closed && !internal);

  return (
    <Card title={bi('المحادثة', 'Conversation')} padded={false}>
      <div className="max-h-[28rem] space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-center text-sm text-muted">{bi('لا توجد رسائل بعد. الرد الأول يوقف عدّاد زمن الاستجابة.', 'No messages yet. The first reply stops the response clock.')}</p>}
        {messages.map((m) => {
          const staff = m.author === 'staff';
          return (
            <div key={m.id} className={clsx('flex', staff ? 'justify-end' : 'justify-start')}>
              <div className={clsx('max-w-[85%] rounded-xl px-3 py-2 text-sm',
                m.internal ? 'border border-dashed border-amber-300 bg-amber-50 text-amber-950' : staff ? 'bg-primary-50 text-ink' : 'border border-line bg-white text-ink')}>
                <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[11px] font-bold text-muted">
                  {m.internal && <span className="inline-flex items-center gap-1 text-amber-800"><Lock className="size-3" />{bi('ملاحظة داخلية', 'Internal note')}</span>}
                  <span>{staff ? m.authorName ?? bi('الفريق', 'Team') : m.author === 'customer' ? bi('العميل', 'Customer') : bi('النظام', 'System')}</span>
                  <span className="num font-normal">{dateTime(m.createdAt)}</span>
                  {staff && !m.internal && <Delivered via={m.deliveredVia} />}
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                {m.files.length > 0 && <AttachmentList className="mt-1.5" size="sm" ids={m.files.map((f) => f.id)} files={Object.fromEntries(m.files.map((f) => [f.id, f]))} />}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {canWrite && (
        <footer className={clsx('space-y-2 border-t border-line p-3', internal && 'bg-amber-50/60')}>
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            placeholder={internal ? bi('ملاحظة للفريق فقط — لا تظهر للعميل', 'Note for the team only — never shown to the customer') : bi('اكتب ردًا للعميل… (اكتب / لاختيار رد جاهز)', 'Write a reply to the customer… (type / for a canned reply)')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Checkbox label={<span className="inline-flex items-center gap-1"><StickyNote className="size-3.5 text-amber-700" />{bi('ملاحظة داخلية', 'Internal note')}</span>} checked={internal} onChange={setInternal} />
            <CannedReplies scope="ticket" ticketId={ticketId} text={text} onInsert={(b, replace) => setText(replace || !text.trim() ? b : `${text}\n${b}`)} />
            <span className="ms-auto text-[11px] text-muted">
              {closed && !internal ? bi('البلاغ مغلق — أعد فتحه للرد على العميل.', 'The call is closed — reopen it to reply.') : internal ? '' : bi('يصل الرد للعميل عبر البوابة وواتساب.', 'The customer gets it on the portal and WhatsApp.')}
            </span>
            <Button size="sm" variant={internal ? 'gold' : 'primary'} disabled={!canSend} loading={send.isPending} icon={<Send className="size-4 rtl:-scale-x-100" />} onClick={() => send.mutate()}>
              {internal ? bi('إضافة ملاحظة', 'Add note') : bi('إرسال الرد', 'Send reply')}
            </Button>
          </div>
        </footer>
      )}
    </Card>
  );
}
