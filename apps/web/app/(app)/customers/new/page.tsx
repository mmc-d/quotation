'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, Field, Input, PageHeader } from '@/components/ui';
import { emptyParty, PartyForm } from '../party-form';

export default function NewCustomerPage() {
  const router = useRouter();
  const [contact, setContact] = useState({ name: '', mobile: '', email: '' });
  const [siteCity, setSiteCity] = useState('');
  return (
    <>
      <PageHeader title="عميل جديد" back="/customers" />
      <Card>
        <PartyForm
          initial={emptyParty}
          submitLabel="حفظ العميل"
          extra={
            <div className="rounded-xl border border-line bg-tint/40 p-3">
              <div className="mb-2 text-sm font-bold text-primary">جهة الاتصال الرئيسية (اختياري)</div>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="الاسم"><Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></Field>
                <Field label="الجوال / واتساب"><Input dir="ltr" value={contact.mobile} onChange={(e) => setContact({ ...contact, mobile: e.target.value })} placeholder="05XXXXXXXX" /></Field>
                <Field label="البريد"><Input dir="ltr" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Field>
                <Field label="مدينة الموقع"><Input value={siteCity} onChange={(e) => setSiteCity(e.target.value)} placeholder="جدة" /></Field>
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
            toast.success('تم حفظ العميل');
            router.push(`/customers/${r.id}`);
          }}
        />
      </Card>
    </>
  );
}
