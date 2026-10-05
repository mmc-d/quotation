'use client';
import { useState } from 'react';
import { isValidUnifiedNumber, isValidVatNumber, SEGMENTS } from '@mmc/domain';
import { Button, Checkbox, ErrorBox, Field, Input, Select, Textarea } from '@/components/ui';

export interface PartyInput {
  kind: 'organization' | 'individual';
  nameAr: string;
  nameEn?: string | null;
  unifiedNumber?: string | null;
  crNumber?: string | null;
  vatNumber?: string | null;
  segment?: string | null;
  source?: string | null;
  phone?: string | null;
  email?: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
  isPartner: boolean;
  b2b: boolean;
  paymentTermsDays: number;
  notes?: string | null;
}

const SEGMENT_AR: Record<string, string> = { contractor: 'مقاول', developer: 'مطور عقاري', building_owner: 'مالك مبنى', villa_owner: 'مالك فيلا', consultant: 'استشاري', government: 'جهة حكومية', hotel: 'فندق', office: 'مكاتب', other: 'أخرى' };

export const emptyParty: PartyInput = { kind: 'organization', nameAr: '', isCustomer: true, isSupplier: false, isPartner: false, b2b: true, paymentTermsDays: 0 };

export function PartyForm({ initial, onSubmit, submitLabel, extra }: { initial: PartyInput; onSubmit: (p: PartyInput) => Promise<unknown>; submitLabel: string; extra?: React.ReactNode }) {
  const [p, setP] = useState<PartyInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof PartyInput>(k: K, v: PartyInput[K]) => setP((x) => ({ ...x, [k]: v }));
  const vatErr = p.vatNumber && !isValidVatNumber(p.vatNumber) ? '15 رقمًا يبدأ وينتهي بالرقم 3' : null;
  const unifiedErr = p.unifiedNumber && !isValidUnifiedNumber(p.unifiedNumber) ? '10 أرقام تبدأ بالرقم 7' : null;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (vatErr || unifiedErr) return;
        setBusy(true);
        setError(null);
        try { await onSubmit(p); } catch (err) { setError(err); } finally { setBusy(false); }
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="النوع">
          <Select value={p.kind} onChange={(e) => { const k = e.target.value as PartyInput['kind']; setP((x) => ({ ...x, kind: k, b2b: k === 'organization' })); }}>
            <option value="organization">منشأة / شركة</option><option value="individual">فرد</option>
          </Select>
        </Field>
        <Field label="الشريحة">
          <Select value={p.segment ?? ''} onChange={(e) => set('segment', e.target.value || null)}>
            <option value="">—</option>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_AR[s] ?? s}</option>)}
          </Select>
        </Field>
        <Field label="الاسم بالعربية *"><Input required value={p.nameAr} onChange={(e) => set('nameAr', e.target.value)} /></Field>
        <Field label="Name (English)"><Input dir="ltr" value={p.nameEn ?? ''} onChange={(e) => set('nameEn', e.target.value)} /></Field>
        {p.kind === 'organization' && <>
          <Field label="الرقم الموحد (7xxxxxxxxx)" error={unifiedErr}><Input dir="ltr" inputMode="numeric" value={p.unifiedNumber ?? ''} onChange={(e) => set('unifiedNumber', e.target.value.trim() || null)} /></Field>
          <Field label="الرقم الضريبي" error={vatErr} hint="مطلوب لفواتير المنشآت (B2B)"><Input dir="ltr" inputMode="numeric" value={p.vatNumber ?? ''} onChange={(e) => set('vatNumber', e.target.value.trim() || null)} /></Field>
        </>}
        <Field label="الجوال"><Input dir="ltr" inputMode="tel" value={p.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="05XXXXXXXX" /></Field>
        <Field label="البريد الإلكتروني"><Input dir="ltr" type="email" value={p.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="مدة السداد (يوم)"><Input type="number" min={0} max={365} value={p.paymentTermsDays} onChange={(e) => set('paymentTermsDays', Number(e.target.value) || 0)} /></Field>
        <Field label="المصدر"><Input value={p.source ?? ''} onChange={(e) => set('source', e.target.value)} placeholder="إحالة، معرض، واتساب…" /></Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <Checkbox label="عميل" checked={p.isCustomer} onChange={(v) => set('isCustomer', v)} />
        <Checkbox label="مورد" checked={p.isSupplier} onChange={(v) => set('isSupplier', v)} />
        <Checkbox label="شريك / استشاري" checked={p.isPartner} onChange={(v) => set('isPartner', v)} />
        <Checkbox label="فاتورة ضريبية للمنشآت (B2B)" checked={p.b2b} onChange={(v) => set('b2b', v)} />
      </div>
      <Field label="ملاحظات"><Textarea rows={3} value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      {extra}
      <ErrorBox error={error} />
      <div className="flex justify-end"><Button loading={busy}>{submitLabel}</Button></div>
    </form>
  );
}
