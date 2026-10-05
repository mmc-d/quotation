'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link2, Mail, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, clsx, Dialog, ErrorBox, Field, Input, Select } from '@/components/ui';
import { CopyLink, errMsg } from './common';
import type { QuoteView } from './types';

export interface PartyContact { id: string; name: string; mobile: string | null; whatsapp: string | null; email: string | null; isPrimary: boolean }

type Channel = 'whatsapp' | 'email' | 'link';

const CHANNELS: { value: Channel; label: string; icon: React.ReactNode }[] = [
  { value: 'whatsapp', label: 'واتساب', icon: <MessageSquare className="size-4" /> },
  { value: 'email', label: 'البريد', icon: <Mail className="size-4" /> },
  { value: 'link', label: 'رابط فقط', icon: <Link2 className="size-4" /> },
];

/** Send the quote (WhatsApp / e-mail / link): archives the PDF and returns the public view link. */
export function SendDialog({ open, onClose, quote, contacts, onSent }: { open: boolean; onClose: () => void; quote: QuoteView; contacts: PartyContact[]; onSent: (v: QuoteView) => void }) {
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [contactId, setContactId] = useState<string>(quote.contactId ?? '');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<{ link: string; message: { status?: string } | null } | null>(null);
  const send = useMutation({
    mutationFn: () => api.post<{ link: string; fileId: string; message: { status?: string } | null; quote: QuoteView }>(`/quotes/${quote.id}/send`, { channel, contactId: contactId || null, to: to.trim() || null }),
    onSuccess: (r) => {
      setResult({ link: r.link, message: r.message });
      onSent(r.quote);
      toast.success(channel === 'link' ? 'تم إنشاء رابط العرض' : 'تم إرسال العرض');
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const close = () => { setResult(null); send.reset(); onClose(); };
  const contact = contacts.find((c) => c.id === contactId);
  const fallback = channel === 'email' ? (contact?.email ?? quote.clientEmail) : (contact?.whatsapp ?? contact?.mobile ?? quote.clientPhone);
  return (
    <Dialog
      open={open}
      onClose={close}
      title={`إرسال العرض ${quote.number}${quote.revision ? `-R${quote.revision}` : ''}`}
      footer={result ? <Button onClick={close}>تم</Button> : <><Button variant="outline" onClick={close}>إلغاء</Button><Button icon={<Send className="size-4" />} loading={send.isPending} onClick={() => send.mutate()} disabled={channel !== 'link' && !to.trim() && !fallback}>إرسال</Button></>}
    >
      {result ? (
        <div className="space-y-3">
          <CopyLink url={result.link} label="رابط العرض للعميل (عرض وقبول إلكتروني)" />
          {result.message?.status && <p className="text-xs text-muted">حالة الرسالة: {result.message.status}</p>}
          <p className="text-xs text-muted">تم أرشفة نسخة PDF من العرض كما أُرسلت.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {CHANNELS.map((c) => (
              <button key={c.value} type="button" onClick={() => setChannel(c.value)} className={clsx('flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-sm font-bold transition', channel === c.value ? 'border-gold bg-tint text-primary ring-2 ring-gold/20' : 'border-line text-muted hover:bg-tint/50')}>
                {c.icon}{c.label}
              </button>
            ))}
          </div>
          {channel !== 'link' && (
            <>
              {contacts.length > 0 && (
                <Field label="جهة الاتصال">
                  <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">— بيانات العميل في العرض —</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isPrimary ? ' ★' : ''} {channel === 'email' ? c.email ?? '' : c.whatsapp ?? c.mobile ?? ''}</option>)}
                  </Select>
                </Field>
              )}
              <Field label={channel === 'email' ? 'البريد الإلكتروني' : 'رقم الجوال / واتساب'} hint={fallback && !to ? `سيُرسل إلى: ${fallback}` : 'اتركه فارغًا لاستخدام بيانات جهة الاتصال'}>
                <Input dir="ltr" type={channel === 'email' ? 'email' : 'tel'} value={to} onChange={(e) => setTo(e.target.value)} placeholder={fallback ?? (channel === 'email' ? 'name@example.com' : '05XXXXXXXX')} />
              </Field>
            </>
          )}
          {channel === 'link' && <p className="text-sm text-muted">سيتم إنشاء رابط عام للعرض تنسخه وترسله بنفسك. يُعلَّم العرض كمُرسل.</p>}
          {quote.status === 'draft' && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">العرض مسودة — سيُعتمد تلقائيًا عند الإرسال لأنه لا يحتاج إلى موافقة.</p>}
          <ErrorBox error={send.error ? new Error(errMsg(send.error)) : null} />
        </div>
      )}
    </Dialog>
  );
}
