'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { CHANNEL, CoverageBadge, PRIORITY, SiteSelect, useLabel, useReason } from './common';
import { LocationPicker } from './locations';
import { AssetSearch, type PickedAsset } from './asset-search';
import type { AssetDetail, TicketDetail } from './types';

export const partyStub = (p: { id: string; nameAr: string } | null | undefined): PickedParty | null => (p ? { id: p.id, nameAr: p.nameAr, nameEn: null, phone: null, email: null, vatNumber: null } : null);

/** "New service call" — after saving, shows the coverage decision and whether the caller was matched by phone. */
export function NewTicketDialog({ open, assetId, onClose }: { open: boolean; assetId?: string | null; onClose: () => void }) {
  const { bi } = useI18n();
  const label = useLabel();
  const reason = useReason();
  const qc = useQueryClient();
  const [channel, setChannel] = useState('phone');
  const [party, setParty] = useState<PickedParty | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [created, setCreated] = useState<TicketDetail | null>(null);

  const preset = useQuery({ queryKey: ['field-asset', assetId], queryFn: () => api.get<AssetDetail>(`/field/assets/${assetId}`), enabled: open && !!assetId });
  useEffect(() => {
    const a = preset.data;
    if (!a || !open) return;
    setAsset(a);
    setParty(partyStub(a.party));
    setSiteId(a.siteId);
    setLocationId(a.locationId);
  }, [preset.data, open]);

  const reset = () => {
    setChannel('phone'); setParty(null); setSiteId(null); setLocationId(null); setAsset(null); setContactName(''); setContactPhone(''); setSubject(''); setDescription(''); setPriority('normal'); setCreated(null);
  };
  const close = () => { reset(); onClose(); };

  const pickAsset = (a: PickedAsset | null) => {
    setAsset(a);
    if (a) {
      if (a.siteId) setSiteId(a.siteId);
      if (a.locationId) setLocationId(a.locationId);
    }
  };

  const save = useMutation({
    mutationFn: () => api.post<TicketDetail>('/field/tickets', {
      channel, partyId: party?.id ?? null, siteId, locationId, assetId: asset?.id ?? null,
      contactName: contactName.trim() || null, contactPhone: contactPhone.trim() || null, subject: subject.trim(), description: description.trim() || null, priority,
    }),
    onSuccess: (t) => { setCreated(t); qc.invalidateQueries({ queryKey: ['field-tickets'] }); toast.success(bi(`تم تسجيل البلاغ ${t.number}`, `Service call ${t.number} logged`)); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (created) {
    return (
      <Dialog open={open} onClose={close} title={<>{bi('تم تسجيل البلاغ', 'Service call logged')} <span dir="ltr" className="num">{created.number}</span></>}
        footer={<><Button variant="outline" onClick={close}>{bi('إغلاق', 'Close')}</Button><Link href={`/field/tickets/${created.id}`} onClick={close} className="inline-flex items-center rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-white hover:bg-primary-600">{bi('فتح البلاغ', 'Open service call')}</Link></>}>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-ok"><CheckCircle2 className="size-5" />{created.subject}</div>
          <div>
            <div className="mb-1 text-xs font-bold text-gold-dark">{bi('قرار التغطية', 'Coverage decision')}</div>
            <CoverageBadge block coverage={created.coverage} reason={reason(created.coverageReason, created.coverageReasonEn)} />
          </div>
          {created.matchedBy === 'phone' && (
            <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
              <Phone className="mt-0.5 size-4 shrink-0 text-sky-700" />
              <span>{bi('تم التعرّف على العميل من رقم الجوال:', 'Customer matched by phone number:')} <b>{created.partyName}</b>{created.contactName && <> — {created.contactName}</>}</span>
            </div>
          )}
          {!created.partyId && <p className="text-xs text-muted">{bi('لم يُربط البلاغ بعميل — يمكنك تعديله لاحقًا.', 'The call is not linked to a customer — you can edit it later.')}</p>}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={close} wide title={bi('بلاغ عطل جديد', 'New service call')}
      footer={<><Button variant="outline" onClick={close}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!subject.trim()} onClick={() => save.mutate()}>{bi('تسجيل البلاغ', 'Log service call')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('قناة الاستلام', 'Channel')}>
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>{Object.keys(CHANNEL).map((c) => <option key={c} value={c}>{label(CHANNEL, c)}</option>)}</Select>
        </Field>
        <Field label={bi('الأولوية', 'Priority')}>
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>{Object.keys(PRIORITY).map((c) => <option key={c} value={c}>{label(PRIORITY, c)}</option>)}</Select>
        </Field>
        <Field label={bi('اسم المتصل', 'Contact name')}><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></Field>
        <Field label={bi('جوال المتصل', 'Contact phone')} hint={!party ? bi('يُستخدم للتعرّف على العميل تلقائيًا', 'Used to match the customer automatically') : undefined}>
          <Input dir="ltr" type="tel" className="text-start" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="05xxxxxxxx" />
        </Field>
        <Field label={`${bi('العميل', 'Customer')} (${bi('اختياري', 'optional')})`} className="sm:col-span-2">
          <PartyPicker value={party} onChange={(p) => { setParty(p); setSiteId(null); setLocationId(null); }} />
        </Field>
        <Field label={bi('الموقع', 'Site')}>
          <SiteSelect partyId={party?.id} value={siteId} onChange={(s) => { setSiteId(s); setLocationId(null); }} />
        </Field>
        <Field label={bi('المكان (مبنى/طابق/وحدة)', 'Location (building/floor/unit)')}>
          <LocationPicker siteId={siteId} value={locationId} onChange={setLocationId} />
        </Field>
        <Field label={bi('الجهاز', 'Device')} hint={bi('ابحث بالرقم التسلسلي أو MAC — يحدد الضمان تلقائيًا', 'Search by serial or MAC — decides warranty automatically')} className="sm:col-span-2">
          <AssetSearch value={asset} onChange={pickAsset} siteId={siteId} partyId={party?.id} />
        </Field>
        <Field label={bi('الموضوع', 'Subject')} className="sm:col-span-2"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={bi('مثال: الإنتركم لا يفتح الباب', 'e.g. Intercom does not unlock the door')} /></Field>
        <Field label={bi('الوصف', 'Description')} className="sm:col-span-2"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
