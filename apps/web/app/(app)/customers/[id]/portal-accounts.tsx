'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Globe, MessageCircle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Select, Spinner } from '@/components/ui';
import type { PortalAccount } from '../../service/_components/types';

interface ContactLite { id: string; name: string; mobile: string | null; whatsapp: string | null }

/** Staff side of the customer portal: accounts (one per mobile), enable/disable, WhatsApp invitation. */
export function PortalAccountsCard({ partyId, contacts }: { partyId: string; contacts: ContactLite[] }) {
  const { can } = useMe();
  const { bi } = useI18n();
  const qc = useQueryClient();
  const key = ['portal-accounts', partyId];
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ rows: PortalAccount[] }>(`/portal/accounts${qs({ partyId })}`), enabled: can('portal.manage') });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'disable' | 'enable' | 'invite' }) => api.post<{ to?: string; status: string }>(`/portal/accounts/${id}/${action}`),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: key });
      toast.success(v.action === 'invite' ? bi(`أُرسلت الدعوة إلى ${r.to} (${r.status})`, `Invitation sent to ${r.to} (${r.status})`) : v.action === 'disable' ? bi('تم إيقاف الحساب', 'Account disabled') : bi('تم تفعيل الحساب', 'Account enabled'));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!can('portal.manage')) return null;
  const rows = q.data?.rows ?? [];
  return (
    <Card
      title={<span className="flex items-center gap-1.5"><Globe className="size-4" />{bi('بوابة العملاء', 'Customer portal')}</span>}
      actions={<Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>{bi('إضافة حساب', 'Add account')}</Button>}
    >
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? (
        <p className="text-sm text-muted">{bi('لا توجد حسابات — أضف جوال جهة اتصال ليدخل العميل إلى البوابة برمز تحقق.', 'No accounts — add a contact’s mobile so the customer can sign in to the portal with a one-time code.')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <div className="flex items-center gap-1.5 font-bold">{a.name ?? '—'} {a.status === 'active' ? <Badge tone="green">{bi('فعّال', 'Active')}</Badge> : <Badge tone="red">{bi('موقوف', 'Disabled')}</Badge>}</div>
                <div className="text-xs text-muted"><span dir="ltr" className="num">{a.phone}</span> · {a.lastLoginAt ? <>{bi('آخر دخول', 'Last sign-in')} <span className="num">{dateTime(a.lastLoginAt)}</span></> : bi('لم يدخل بعد', 'Never signed in')}</div>
              </div>
              <div className="flex gap-1">
                {a.status === 'active' && <Button size="sm" variant="gold" icon={<MessageCircle className="size-3.5" />} loading={act.isPending && act.variables?.id === a.id && act.variables.action === 'invite'} onClick={() => act.mutate({ id: a.id, action: 'invite' })}>{bi('إرسال دعوة', 'Send invitation')}</Button>}
                {a.status === 'active'
                  ? <Button size="sm" variant="ghost" icon={<Ban className="size-3.5" />} loading={act.isPending && act.variables?.id === a.id && act.variables.action === 'disable'} onClick={() => act.mutate({ id: a.id, action: 'disable' })}>{bi('إيقاف', 'Disable')}</Button>
                  : <Button size="sm" variant="ghost" icon={<CheckCircle2 className="size-3.5" />} loading={act.isPending && act.variables?.id === a.id && act.variables.action === 'enable'} onClick={() => act.mutate({ id: a.id, action: 'enable' })}>{bi('تفعيل', 'Enable')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddAccountDialog partyId={partyId} contacts={contacts} onClose={() => setAdding(false)} onDone={() => { qc.invalidateQueries({ queryKey: key }); setAdding(false); }} />}
    </Card>
  );
}

function AddAccountDialog({ partyId, contacts, onClose, onDone }: { partyId: string; contacts: ContactLite[]; onClose: () => void; onDone: () => void }) {
  const { bi } = useI18n();
  const [contactId, setContactId] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const pickContact = (id: string) => {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (c) { setPhone(c.mobile ?? c.whatsapp ?? ''); setName(c.name); }
  };
  const save = useMutation({
    mutationFn: () => api.post<PortalAccount>('/portal/accounts', { partyId, contactId: contactId || null, phone: phone.trim(), name: name.trim() || null }),
    onSuccess: () => { toast.success(bi('تمت إضافة الحساب', 'Account added')); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} title={bi('حساب بوابة جديد', 'New portal account')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={phone.trim().length < 7} onClick={() => save.mutate()}>{bi('إضافة', 'Add')}</Button></>}>
      <div className="grid gap-3">
        {contacts.length > 0 && (
          <Field label={bi('جهة الاتصال', 'Contact')}>
            <Select value={contactId} onChange={(e) => pickContact(e.target.value)}>
              <option value="">{bi('— بدون جهة اتصال (أدخل الجوال) —', '— No contact (enter the mobile) —')}</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.mobile ? ` — ${c.mobile}` : ''}</option>)}
            </Select>
          </Field>
        )}
        <Field label={bi('الجوال *', 'Mobile *')} hint={bi('جوال سعودي — يُرسل رمز الدخول عليه عبر واتساب', 'Saudi mobile — the sign-in code is sent to it by WhatsApp')}>
          <Input dir="ltr" type="tel" className="text-start" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" />
        </Field>
        <Field label={bi('الاسم', 'Name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
