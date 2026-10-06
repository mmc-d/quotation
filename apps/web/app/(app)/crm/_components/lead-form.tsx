'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button, clsx, Dialog, ErrorBox, Field, Input, Select, Textarea } from '@/components/ui';
import { UserSelect } from '@/components/user-select';
import { useI18n } from '@/lib/i18n';
import { INTEREST_LABELS, INTEREST_LABELS_EN, INTERESTS, LEAD_SOURCES, PROJECT_LABELS, PROJECT_LABELS_EN, PROJECT_TYPES, SOURCE_LABELS, SOURCE_LABELS_EN, type Lead } from './labels';

export interface LeadFormValues {
  source: string;
  name: string;
  companyName: string;
  mobile: string;
  email: string;
  city: string;
  interest: string;
  projectType: string;
  estimatedUnits: string;
  message: string;
  ownerId: string | null;
  campaignId?: string | null;
}

export const emptyLead = (): LeadFormValues => ({ source: 'phone', name: '', companyName: '', mobile: '', email: '', city: '', interest: '', projectType: '', estimatedUnits: '', message: '', ownerId: null });

export function leadToForm(l: Lead): LeadFormValues {
  return {
    source: l.source,
    name: l.name,
    companyName: l.companyName ?? '',
    mobile: l.mobile ?? '',
    email: l.email ?? '',
    city: l.city ?? '',
    interest: l.interest ?? '',
    projectType: l.projectType ?? '',
    estimatedUnits: l.estimatedUnits == null ? '' : String(l.estimatedUnits),
    message: l.message ?? '',
    ownerId: l.ownerId,
    campaignId: l.campaignId,
  };
}

export function leadPayload(v: LeadFormValues) {
  const units = v.estimatedUnits.trim() === '' ? null : Math.max(0, Math.round(Number(v.estimatedUnits)));
  return {
    source: v.source,
    name: v.name.trim(),
    companyName: v.companyName.trim() || null,
    mobile: v.mobile.trim() || null,
    email: v.email.trim() || null,
    city: v.city.trim() || null,
    interest: v.interest || null,
    projectType: v.projectType || null,
    estimatedUnits: units != null && Number.isFinite(units) ? units : null,
    message: v.message.trim() || null,
    ownerId: v.ownerId || null,
    campaignId: v.campaignId || null,
  };
}

export function LeadFields({ value, onChange }: { value: LeadFormValues; onChange: (v: LeadFormValues) => void }) {
  const { bi, locale } = useI18n();
  const en = locale === 'en';
  const set = <K extends keyof LeadFormValues>(k: K, val: LeadFormValues[K]) => onChange({ ...value, [k]: val });
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={bi('الاسم *', 'Name *')}><Input value={value.name} onChange={(e) => set('name', e.target.value)} required /></Field>
      <Field label={bi('المصدر', 'Source')}>
        <Select value={value.source} onChange={(e) => set('source', e.target.value)}>
          {LEAD_SOURCES.map((s) => <option key={s} value={s}>{(en ? SOURCE_LABELS_EN : SOURCE_LABELS)[s] ?? s}</option>)}
        </Select>
      </Field>
      <Field label={bi('الشركة / المنشأة', 'Company / organization')}><Input value={value.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
      <Field label={bi('الجوال', 'Mobile')}><Input dir="ltr" inputMode="tel" value={value.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="05xxxxxxxx" /></Field>
      <Field label={bi('البريد الإلكتروني', 'E-mail')}><Input dir="ltr" type="email" value={value.email} onChange={(e) => set('email', e.target.value)} /></Field>
      <Field label={bi('المدينة', 'City')}><Input value={value.city} onChange={(e) => set('city', e.target.value)} /></Field>
      <Field label={bi('الاهتمام', 'Interest')}>
        <Select value={value.interest} onChange={(e) => set('interest', e.target.value)}>
          <option value="">—</option>
          {INTERESTS.map((s) => <option key={s} value={s}>{(en ? INTEREST_LABELS_EN : INTEREST_LABELS)[s] ?? s}</option>)}
        </Select>
      </Field>
      <Field label={bi('نوع المشروع', 'Project type')}>
        <Select value={value.projectType} onChange={(e) => set('projectType', e.target.value)}>
          <option value="">—</option>
          {PROJECT_TYPES.map((s) => <option key={s} value={s}>{(en ? PROJECT_LABELS_EN : PROJECT_LABELS)[s] ?? s}</option>)}
        </Select>
      </Field>
      <Field label={bi('عدد الوحدات التقديري', 'Estimated units')}><Input type="number" min={0} inputMode="numeric" value={value.estimatedUnits} onChange={(e) => set('estimatedUnits', e.target.value)} /></Field>
      <Field label={bi('المسؤول', 'Owner')}><UserSelect value={value.ownerId} onChange={(id) => set('ownerId', id)} /></Field>
      <Field label={bi('الرسالة / الملاحظات', 'Message / notes')} className="md:col-span-2"><Textarea rows={3} value={value.message} onChange={(e) => set('message', e.target.value)} /></Field>
    </div>
  );
}

/** Extracts the existing lead id from the API's duplicate-mobile 400. */
export function duplicateLeadId(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 400 && e.details && typeof e.details === 'object' && !Array.isArray(e.details)) {
    const id = (e.details as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

export function NewLeadDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (lead: Lead) => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [v, setV] = useState<LeadFormValues>(emptyLead);
  const save = useMutation({
    mutationFn: () => api.post<Lead>('/crm/leads', leadPayload(v)),
    onSuccess: (lead) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success(bi(`أُضيف العميل المحتمل ${lead.number ?? ''}`, `Lead ${lead.number ?? ''} added`));
      setV(emptyLead());
      onClose();
      onCreated?.(lead);
    },
  });
  const dupe = duplicateLeadId(save.error);
  return (
    <Dialog
      open={open}
      onClose={() => { save.reset(); onClose(); }}
      title={bi('عميل محتمل جديد', 'New lead')}
      wide
      footer={<><Button variant="outline" onClick={() => { save.reset(); onClose(); }}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!v.name.trim()} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (v.name.trim()) save.mutate(); }}>
        <LeadFields value={v} onChange={setV} />
        <button type="submit" className="hidden" />
      </form>
      {save.error && (
        <div className={clsx('mt-3')}>
          {dupe ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {bi('يوجد عميل محتمل مفتوح بنفس رقم الجوال.', 'An open lead with the same mobile number already exists.')}{' '}
              <Link href={`/crm/leads/${dupe}`} className="font-bold text-primary underline" onClick={onClose}>{bi('فتح السجل الموجود', 'Open the existing record')}</Link>
            </div>
          ) : <ErrorBox error={save.error} />}
        </div>
      )}
    </Dialog>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const { bi } = useI18n();
  const tone = score >= 60 ? 'bg-ok' : score >= 35 ? 'bg-gold' : 'bg-gray-300';
  return (
    <div className="flex items-center gap-1.5" title={bi(`التقييم ${score}/100`, `Score ${score}/100`)}>
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-100"><div className={clsx('h-full rounded-full', tone)} style={{ width: `${Math.min(100, Math.max(0, score))}%` }} /></div>
      <span className="num text-[11px] text-muted">{score}</span>
    </div>
  );
}
