'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Card, Field, Input, PageHeader } from '@/components/ui';
import { emptyParty, PartyForm } from '../party-form';

export default function NewCustomerPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [contact, setContact] = useState({ name: '', mobile: '', email: '' });
  const [siteCity, setSiteCity] = useState('');
  return (
    <>
      <PageHeader title={t('customers.new')} back="/customers" />
      <Card>
        <PartyForm
          initial={emptyParty}
          submitLabel={t('customers.saveCustomer')}
          extra={
            <div className="rounded-xl border border-line bg-tint/40 p-3">
              <div className="mb-2 text-sm font-bold text-primary">{t('customers.primaryContact')}</div>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label={t('common.name')}><Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></Field>
                <Field label={t('customers.whatsappMobile')}><Input dir="ltr" value={contact.mobile} onChange={(e) => setContact({ ...contact, mobile: e.target.value })} placeholder="05XXXXXXXX" /></Field>
                <Field label={t('customers.contactEmail')}><Input dir="ltr" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Field>
                <Field label={t('customers.siteCity')}><Input value={siteCity} onChange={(e) => setSiteCity(e.target.value)} placeholder={t('customers.siteCityPh')} /></Field>
              </div>
            </div>
          }
          onSubmit={async (p) => {
            const body = {
              ...p,
              contacts: contact.name ? [{ name: contact.name, mobile: contact.mobile || null, whatsapp: contact.mobile || null, email: contact.email || null, isPrimary: true }] : [],
              sites: siteCity ? [{ name: p.nameAr, type: 'project', city: siteCity }] : [],
            };
            const r = await api.post<{ id: string }>('/parties', body);
            toast.success(t('customers.savedCustomer'));
            router.push(`/customers/${r.id}`);
          }}
        />
      </Card>
    </>
  );
}
