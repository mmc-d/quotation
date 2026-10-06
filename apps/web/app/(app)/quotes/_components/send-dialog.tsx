'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link2, Mail, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, clsx, Dialog, ErrorBox, Field, Input, Select } from '@/components/ui';
import { CopyLink, errMsg } from './common';
import type { QuoteView } from './types';

export interface PartyContact { id: string; name: string; mobile: string | null; whatsapp: string | null; email: string | null; isPrimary: boolean }

type Channel = 'whatsapp' | 'email' | 'link';

const CHANNELS: { value: Channel; label: string; en: string; icon: React.ReactNode }[] = [
  { value: 'whatsapp', label: 'واتساب', en: 'WhatsApp', icon: <MessageSquare className="size-4" /> },
  { value: 'email', label: 'البريد', en: 'E-mail', icon: <Mail className="size-4" /> },
  { value: 'link', label: 'رابط فقط', en: 'Link only', icon: <Link2 className="size-4" /> },
];

/** Send the quote (WhatsApp / e-mail / link): archives the PDF and returns the public view link. */
export function SendDialog({ open, onClose, quote, contacts, onSent }: { open: boolean; onClose: () => void; quote: QuoteView; contacts: PartyContact[]; onSent: (v: QuoteView) => void }) {
  const { bi } = useI18n();
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [contactId, setContactId] = useState<string>(quote.contactId ?? '');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<{ link: string; message: { status?: string } | null } | null>(null);
  const send = useMutation({
    mutationFn: () => api.post<{ link: string; fileId: string; message: { status?: string } | null; quote: QuoteView }>(`/quotes/${quote.id}/send`, { channel, contactId: contactId || null, to: to.trim() || null }),
    onSuccess: (r) => {
      setResult({ link: r.link, message: r.message });
      onSent(r.quote);
      toast.success(channel === 'link' ? bi('تم إنشاء رابط العرض', 'Quote link created') : bi('تم إرسال العرض', 'Quote sent'));
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
      title={bi(`إرسال العرض ${quote.number}${quote.revision ? `-R${quote.revision}` : ''}`, `Send quote ${quote.number}${quote.revision ? `-R${quote.revision}` : ''}`)}
      footer={result ? <Button onClick={close}>{bi('تم', 'Done')}</Button> : <><Button variant="outline" onClick={close}>{bi('إلغاء', 'Cancel')}</Button><Button icon={<Send className="size-4" />} loading={send.isPending} onClick={() => send.mutate()} disabled={channel !== 'link' && !to.trim() && !fallback}>{bi('إرسال', 'Send')}</Button></>}
    >
      {result ? (
        <div className="space-y-3">
          <CopyLink url={result.link} label={bi('رابط العرض للعميل (عرض وقبول إلكتروني)', 'Customer quote link (view and accept online)')} />
          {result.message?.status && <p className="text-xs text-muted">{bi('حالة الرسالة:', 'Message status:')} {result.message.status}</p>}
          <p className="text-xs text-muted">{bi('تم أرشفة نسخة PDF من العرض كما أُرسلت.', 'A PDF copy of the quote was archived as sent.')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {CHANNELS.map((c) => (
              <button key={c.value} type="button" onClick={() => setChannel(c.value)} className={clsx('flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-sm font-bold transition', channel === c.value ? 'border-gold bg-tint text-primary ring-2 ring-gold/20' : 'border-line text-muted hover:bg-tint/50')}>
                {c.icon}{bi(c.label, c.en)}
              </button>
            ))}
          </div>
          {channel !== 'link' && (
            <>
              {contacts.length > 0 && (
                <Field label={bi('جهة الاتصال', 'Contact')}>
                  <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">{bi('— بيانات العميل في العرض —', '— Customer details on the quote —')}</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isPrimary ? ' ★' : ''} {channel === 'email' ? c.email ?? '' : c.whatsapp ?? c.mobile ?? ''}</option>)}
                  </Select>
                </Field>
              )}
              <Field label={channel === 'email' ? bi('البريد الإلكتروني', 'E-mail') : bi('رقم الجوال / واتساب', 'Mobile / WhatsApp number')} hint={fallback && !to ? bi(`سيُرسل إلى: ${fallback}`, `Will be sent to: ${fallback}`) : bi('اتركه فارغًا لاستخدام بيانات جهة الاتصال', 'Leave empty to use the contact details')}>
                <Input dir="ltr" type={channel === 'email' ? 'email' : 'tel'} value={to} onChange={(e) => setTo(e.target.value)} placeholder={fallback ?? (channel === 'email' ? 'name@example.com' : '05XXXXXXXX')} />
              </Field>
            </>
          )}
          {channel === 'link' && <p className="text-sm text-muted">{bi('سيتم إنشاء رابط عام للعرض تنسخه وترسله بنفسك. يُعلَّم العرض كمُرسل.', 'A public link to the quote will be created for you to copy and send yourself. The quote is marked as sent.')}</p>}
          {quote.status === 'draft' && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">{bi('العرض مسودة — سيُعتمد تلقائيًا عند الإرسال لأنه لا يحتاج إلى موافقة.', 'The quote is a draft — it will be approved automatically on sending since it needs no approval.')}</p>}
          <ErrorBox error={send.error ? new Error(errMsg(send.error)) : null} />
        </div>
      )}
    </Dialog>
  );
}
