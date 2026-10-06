'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isValidUnifiedNumber, isValidVatNumber, SEGMENTS } from '@mmc/domain';
import { Button, Checkbox, ErrorBox, Field, Input, Select, Textarea } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';

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
  /** customer price list (CPQ-05); null = catalog list prices / the segment's default list */
  priceListId?: string | null;
}

interface PriceListOption { id: string; name: string; segment: string | null; isDefault: boolean; active: boolean }

export const emptyParty: PartyInput = { kind: 'organization', nameAr: '', isCustomer: true, isSupplier: false, isPartner: false, b2b: true, paymentTermsDays: 0 };

export function PartyForm({ initial, onSubmit, submitLabel, extra }: { initial: PartyInput; onSubmit: (p: PartyInput) => Promise<unknown>; submitLabel: string; extra?: React.ReactNode }) {
  const { t, tx, bi } = useI18n();
  const [p, setP] = useState<PartyInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof PartyInput>(k: K, v: PartyInput[K]) => setP((x) => ({ ...x, [k]: v }));
  const { can } = useMe();
  const priceLists = useQuery({ queryKey: ['price-lists'], queryFn: () => api.get<PriceListOption[]>('/price-lists'), enabled: can('product.read'), staleTime: 60_000 });
  const vatErr = p.vatNumber && !isValidVatNumber(p.vatNumber) ? t('partyForm.vatErr') : null;
  const unifiedErr = p.unifiedNumber && !isValidUnifiedNumber(p.unifiedNumber) ? t('partyForm.unifiedErr') : null;
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
        <Field label={t('partyForm.kind')}>
          <Select value={p.kind} onChange={(e) => { const k = e.target.value as PartyInput['kind']; setP((x) => ({ ...x, kind: k, b2b: k === 'organization' })); }}>
            <option value="organization">{t('partyForm.org')}</option><option value="individual">{t('partyForm.individual')}</option>
          </Select>
        </Field>
        <Field label={t('partyForm.segment')}>
          <Select value={p.segment ?? ''} onChange={(e) => set('segment', e.target.value || null)}>
            <option value="">—</option>{SEGMENTS.map((s) => <option key={s} value={s}>{tx(`segment.${s}`, s)}</option>)}
          </Select>
        </Field>
        <Field label={t('partyForm.nameAr')}><Input required dir="rtl" value={p.nameAr} onChange={(e) => set('nameAr', e.target.value)} /></Field>
        <Field label={t('partyForm.nameEn')}><Input dir="ltr" value={p.nameEn ?? ''} onChange={(e) => set('nameEn', e.target.value)} /></Field>
        {p.kind === 'organization' && <>
          <Field label={t('partyForm.unified')} error={unifiedErr}><Input dir="ltr" inputMode="numeric" value={p.unifiedNumber ?? ''} onChange={(e) => set('unifiedNumber', e.target.value.trim() || null)} /></Field>
          <Field label={t('partyForm.vat')} error={vatErr} hint={t('partyForm.vatHint')}><Input dir="ltr" inputMode="numeric" value={p.vatNumber ?? ''} onChange={(e) => set('vatNumber', e.target.value.trim() || null)} /></Field>
        </>}
        <Field label={t('common.mobile')}><Input dir="ltr" inputMode="tel" value={p.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="05XXXXXXXX" /></Field>
        <Field label={t('common.email')}><Input dir="ltr" type="email" value={p.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={t('partyForm.terms')}><Input type="number" min={0} max={365} value={p.paymentTermsDays} onChange={(e) => set('paymentTermsDays', Number(e.target.value) || 0)} /></Field>
        {(priceLists.data?.length ?? 0) > 0 && (
          <Field label={bi('قائمة الأسعار', 'Price list')} hint={bi('تُسعَّر البنود الجديدة في عروض هذا العميل حسب القائمة', 'New lines in this customer\'s quotes are priced from this list')}>
            <Select value={p.priceListId ?? ''} onChange={(e) => set('priceListId', e.target.value || null)}>
              <option value="">{bi('أسعار الكتالوج (أو القائمة الافتراضية للشريحة)', 'Catalog prices (or the segment\'s default list)')}</option>
              {priceLists.data!.map((l) => <option key={l.id} value={l.id}>{l.name}{l.active ? '' : ` (${bi('غير سارية', 'inactive')})`}</option>)}
            </Select>
          </Field>
        )}
        <Field label={t('partyForm.source')}><Input value={p.source ?? ''} onChange={(e) => set('source', e.target.value)} placeholder={t('partyForm.sourcePh')} /></Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <Checkbox label={t('partyForm.isCustomer')} checked={p.isCustomer} onChange={(v) => set('isCustomer', v)} />
        <Checkbox label={t('partyForm.isSupplier')} checked={p.isSupplier} onChange={(v) => set('isSupplier', v)} />
        <Checkbox label={t('partyForm.isPartner')} checked={p.isPartner} onChange={(v) => set('isPartner', v)} />
        <Checkbox label={t('partyForm.b2b')} checked={p.b2b} onChange={(v) => set('b2b', v)} />
      </div>
      <Field label={t('common.notes')}><Textarea rows={3} value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      {extra}
      <ErrorBox error={error} />
      <div className="flex justify-end"><Button loading={busy}>{submitLabel}</Button></div>
    </form>
  );
}
