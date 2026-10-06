'use client';
import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { formatNationalAddress } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { QuoteEditor, type PartyDetail } from '../_components/quote-editor';
import { emptyDraft, type QuoteDraft } from '../_components/types';

function NewQuote() {
  const sp = useSearchParams();
  const partyId = sp.get('partyId');
  const opportunityId = sp.get('opportunityId');
  const { me, can } = useMe();
  const { bi } = useI18n();
  const vatRegistered = me?.company?.vatRegistered ?? true;
  const partyQ = useQuery({
    queryKey: ['party', partyId],
    queryFn: () => api.get<PartyDetail>(`/parties/${partyId}`),
    enabled: !!partyId && can('party.read'),
  });
  const initial = useMemo<QuoteDraft | null>(() => {
    const d = emptyDraft(vatRegistered);
    d.opportunityId = opportunityId;
    if (!partyId) return d;
    const p = partyQ.data;
    if (!p) return partyQ.isError || !can('party.read') ? { ...d, partyId } : null;
    const contact = p.contacts.find((c) => c.isPrimary) ?? p.contacts[0];
    const site = p.sites.find((s) => s.type === 'project') ?? p.sites[0];
    return {
      ...d,
      partyId: p.id,
      contactId: contact?.id ?? null,
      siteId: site?.id ?? null,
      clientName: p.nameAr,
      clientPhone: contact?.mobile ?? contact?.whatsapp ?? p.phone ?? '',
      clientEmail: contact?.email ?? p.email ?? '',
      projectLocation: site ? formatNationalAddress(site) || site.name : '',
    };
  }, [partyId, opportunityId, partyQ.data, partyQ.isError, vatRegistered, can]);

  if (!can('quote.write')) return <><PageHeader back="/quotes" title={bi('عرض سعر جديد', 'New quote')} /><ErrorBox error={new Error(bi('لا تملك صلاحية إنشاء عروض الأسعار', 'You do not have permission to create quotes'))} /></>;
  if (!initial) return <Spinner />;
  return (
    <>
      {partyQ.isError && <div className="mb-3"><ErrorBox error={partyQ.error} /></div>}
      <QuoteEditor initial={initial} />
    </>
  );
}

export default function NewQuotePage() {
  return <Suspense fallback={<Spinner />}><NewQuote /></Suspense>;
}
