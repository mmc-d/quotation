'use client';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, MessagesSquare, Send, X } from 'lucide-react';
import { InlineError, PublicCard } from '@/app/_public/public-shell';
import { Button, Textarea, clsx } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { PreparedFile } from '@/lib/upload';
import { portalFetch, type PortalMessage, type PortalTicketDetail } from './portal-api';
import { preparePhoto } from './portal-photos';
import { Num, sectionTitle } from './portal-ui';

const MAX_PHOTOS = 3;

/** Request conversation: service-team replies and the customer's messages (+ photos). */
export function PortalConversation({ ticketId, messages, canMessage, status }: { ticketId: string; messages: PortalMessage[]; canMessage: boolean; status: string }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<(PreparedFile & { preview: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    try {
      const out: (PreparedFile & { preview: string })[] = [];
      for (const f of [...files].slice(0, MAX_PHOTOS - photos.length)) {
        try { out.push(await preparePhoto(f)); } catch (e) {
          setError((e as Error).message === 'too_large' ? bi('الصورة كبيرة جدًا (الحد 1.5 ميجابايت).', 'The photo is too large (limit 1.5 MB).') : bi('نوع الملف غير مدعوم — أرفق صورة.', 'Unsupported file — please attach a photo.'));
        }
      }
      setPhotos((p) => [...p, ...out].slice(0, MAX_PHOTOS));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const send = useMutation({
    mutationFn: () => portalFetch<PortalTicketDetail>(`/tickets/${ticketId}/messages`, { body: { body: body.trim(), photos: photos.map(({ name, contentType, data }) => ({ name, contentType, data })) } }),
    onSuccess: (t) => {
      qc.setQueryData(['portal', 'ticket', ticketId], t);
      qc.invalidateQueries({ queryKey: ['portal', 'tickets'] });
      setBody('');
      setPhotos([]);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <PublicCard>
      <h2 className={sectionTitle}><MessagesSquare className="size-4" aria-hidden />{bi('المحادثة مع فريق الخدمة', 'Conversation with the service team')}</h2>
      {messages.length === 0 ? (
        <p className="text-sm text-muted">{bi('لا توجد رسائل بعد — سيظهر هنا رد فريق الخدمة.', 'No messages yet — the service team’s replies will appear here.')}</p>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => {
            const mine = m.author === 'customer';
            return (
              <li key={m.id} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
                <div className={clsx('max-w-[85%] rounded-2xl px-3 py-2 text-sm', mine ? 'bg-primary text-white' : 'border border-line bg-tint/40 text-ink')}>
                  <div className={clsx('mb-0.5 flex flex-wrap items-center gap-2 text-[11px] font-bold', mine ? 'text-white/80' : 'text-gold-dark')}>
                    <span>{mine ? bi('أنت', 'You') : m.authorName ? bi(`${m.authorName} — فريق الخدمة`, `${m.authorName} — service team`) : bi('فريق الخدمة', 'Service team')}</span>
                    <Num className="font-normal">{dateTime(m.createdAt)}</Num>
                  </div>
                  <p className="whitespace-pre-line leading-relaxed">{m.body}</p>
                  {m.files.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {m.files.map((f, i) => (
                        <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="block size-16 overflow-hidden rounded-lg border border-white/40" aria-label={bi(`فتح الصورة ${i + 1}`, `Open photo ${i + 1}`)}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={f.url} alt={f.filename} loading="lazy" className="size-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canMessage ? (
        <form className="mt-4 space-y-2 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }}>
          <label className="block">
            <span className="sr-only">{bi('رسالتك', 'Your message')}</span>
            <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000}
              placeholder={status === 'resolved' ? bi('ما زالت المشكلة قائمة؟ اكتب لنا وسنعيد فتح الطلب.', 'Still not working? Write to us and we will reopen the request.') : bi('اكتب رسالة لفريق الخدمة…', 'Write a message to the service team…')} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative size-14 overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={bi(`صورة ${i + 1}`, `Photo ${i + 1}`)} className="size-full object-cover" />
                <button type="button" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="absolute end-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/60 text-white" aria-label={bi(`إزالة الصورة ${i + 1}`, `Remove photo ${i + 1}`)}><X className="size-3" aria-hidden /></button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className={clsx('inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs font-bold text-muted hover:border-gold hover:text-gold-dark focus-within:border-gold', busy && 'animate-pulse')}>
                <Camera className="size-4" aria-hidden />{bi('صورة', 'Photo')}
                <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} disabled={busy} aria-label={bi('إرفاق صور', 'Attach photos')} />
              </label>
            )}
            <Button type="submit" className="ms-auto" loading={send.isPending} disabled={!body.trim() || busy} icon={<Send className="size-4 rtl:-scale-x-100" aria-hidden />}>{bi('إرسال', 'Send')}</Button>
          </div>
          <InlineError message={error} />
        </form>
      ) : (
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{bi('هذا الطلب مغلق — إذا عادت المشكلة افتح طلب صيانة جديدًا.', 'This request is closed — if the problem comes back, open a new service request.')}</p>
      )}
    </PublicCard>
  );
}
