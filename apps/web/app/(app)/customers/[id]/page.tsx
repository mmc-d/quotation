'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, MapPin, Pencil, Plus, Star } from 'lucide-react';
import { toast } from 'sonner';
import { formatNationalAddress } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Input, LinkButton, Money, PageHeader, Select, Spinner, StatusBadge, Table, Tabs, Td, Th } from '@/components/ui';
import { Timeline, type Activity } from '@/components/timeline';
import { PartyForm, type PartyInput } from '../party-form';

interface Contact { id: string; name: string; jobTitle: string | null; mobile: string | null; whatsapp: string | null; email: string | null; isPrimary: boolean; preferredChannel: string }
interface Site { id: string; type: string; name: string; buildingNumber: string | null; street: string | null; district: string | null; city: string | null; postalCode: string | null; additionalNumber: string | null; mapLink: string | null }
interface PartyView extends PartyInput {
  id: string; ownerId: string | null; contacts: Contact[]; sites: Site[];
  quotes: { id: string; number: string; revision: number; status: string; total: string; quoteDate: string }[];
  contracts: { id: string; number: string; status: string; total: string; contractDate: string }[];
  opportunities: { id: string; title: string; amount: string; probability: number }[];
  invoices: { id: string; number: string; typeCode: string; total: string; balanceDue: string; issueDate: string; zatcaStatus: string }[];
  activities: Activity[]; balanceDue: number;
}

function ContactDialog({ partyId, contact, onClose }: { partyId: string; contact: Partial<Contact> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [c, setC] = useState<Partial<Contact>>(contact ?? {});
  const save = useMutation({
    mutationFn: () => api.put(`/parties/${partyId}/contacts/${c.id ?? 'new'}`, { name: c.name, jobTitle: c.jobTitle || null, mobile: c.mobile || null, whatsapp: c.whatsapp || c.mobile || null, email: c.email || null, isPrimary: !!c.isPrimary, preferredChannel: c.preferredChannel ?? 'whatsapp' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['party', partyId] }); toast.success(t('common.saved')); onClose(); },
  });
  return (
    <Dialog open={!!contact} onClose={onClose} title={c.id ? t('customers.editContact') : t('customers.newContact')} footer={<><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate()} disabled={!c.name}>{t('common.save')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t('customers.nameReq')}><Input value={c.name ?? ''} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
        <Field label={t('customers.jobTitle')}><Input value={c.jobTitle ?? ''} onChange={(e) => setC({ ...c, jobTitle: e.target.value })} /></Field>
        <Field label={t('common.mobile')}><Input dir="ltr" value={c.mobile ?? ''} onChange={(e) => setC({ ...c, mobile: e.target.value })} /></Field>
        <Field label={t('customers.whatsapp')}><Input dir="ltr" value={c.whatsapp ?? ''} onChange={(e) => setC({ ...c, whatsapp: e.target.value })} placeholder={t('customers.whatsappPh')} /></Field>
        <Field label={t('customers.contactEmail')}><Input dir="ltr" type="email" value={c.email ?? ''} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
        <Field label={t('customers.preferredChannel')}><Select value={c.preferredChannel ?? 'whatsapp'} onChange={(e) => setC({ ...c, preferredChannel: e.target.value })}><option value="whatsapp">{t('customers.chWhatsapp')}</option><option value="phone">{t('customers.chPhone')}</option><option value="email">{t('customers.chEmail')}</option><option value="sms">{t('customers.chSms')}</option></Select></Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.isPrimary} onChange={(e) => setC({ ...c, isPrimary: e.target.checked })} /> {t('customers.isPrimary')}</label>
      <ErrorBox error={save.error} />
    </Dialog>
  );
}

function SiteDialog({ partyId, site, onClose }: { partyId: string; site: Partial<Site> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [s, setS] = useState<Partial<Site>>(site ?? { type: 'project' });
  const save = useMutation({
    mutationFn: () => api.put(`/parties/${partyId}/sites/${s.id ?? 'new'}`, { type: s.type ?? 'project', name: s.name, buildingNumber: s.buildingNumber || null, street: s.street || null, district: s.district || null, city: s.city || null, postalCode: s.postalCode || null, additionalNumber: s.additionalNumber || null, mapLink: s.mapLink || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['party', partyId] }); toast.success(t('common.saved')); onClose(); },
  });
  const F = (k: keyof Site, label: string, ltr = false) => <Field label={label}><Input dir={ltr ? 'ltr' : undefined} value={(s[k] as string) ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></Field>;
  return (
    <Dialog open={!!site} onClose={onClose} title={t('customers.siteTitle')} footer={<><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate()} disabled={!s.name}>{t('common.save')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        {F('name', t('customers.siteName'))}
        <Field label={t('common.type')}><Select value={s.type ?? 'project'} onChange={(e) => setS({ ...s, type: e.target.value })}><option value="project">{t('customers.siteTypeProject')}</option><option value="billing">{t('customers.siteTypeBilling')}</option><option value="site">{t('customers.siteTypeSite')}</option></Select></Field>
        {F('buildingNumber', t('customers.buildingNumber'), true)}{F('street', t('customers.street'))}{F('district', t('customers.district'))}{F('city', t('customers.city'))}{F('postalCode', t('customers.postalCode'), true)}{F('additionalNumber', t('customers.additionalNumber'), true)}{F('mapLink', t('customers.mapLink'), true)}
      </div>
      <ErrorBox error={save.error} />
    </Dialog>
  );
}

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useMe();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'quotes' | 'contracts' | 'invoices' | 'timeline' | 'edit'>('overview');
  const [contact, setContact] = useState<Partial<Contact> | null>(null);
  const [site, setSite] = useState<Partial<Site> | null>(null);
  const q = useQuery({ queryKey: ['party', id], queryFn: () => api.get<PartyView>(`/parties/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const p = q.data;
  return (
    <>
      <PageHeader
        back="/customers"
        title={locale === 'en' && p.nameEn ? <span dir="ltr">{p.nameEn}</span> : p.nameAr}
        subtitle={<span className="flex flex-wrap items-center gap-2">{locale === 'en' && p.nameEn ? <span dir="rtl">{p.nameAr}</span> : p.nameEn && <span dir="ltr">{p.nameEn}</span>}{p.vatNumber && <Badge tone="gold">{t('customers.vatBadge', { v: p.vatNumber })}</Badge>}{p.unifiedNumber && <Badge>{t('customers.unifiedBadge', { v: p.unifiedNumber })}</Badge>}{p.balanceDue > 0 && <Badge tone="red">{t('customers.balanceDue')} <Money value={Math.round(p.balanceDue * 100)} /></Badge>}</span>}
        actions={can('quote.write') && <LinkButton href={`/quotes/new?partyId=${p.id}`} variant="primary" icon={<FilePlus2 className="size-4" />}>{t('customers.quote')}</LinkButton>}
      />
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'overview', label: t('customers.tabOverview') },
        { value: 'quotes', label: t('customers.tabQuotes'), count: p.quotes.length },
        { value: 'contracts', label: t('customers.tabContracts'), count: p.contracts.length },
        ...(can('invoice.read') ? [{ value: 'invoices' as const, label: t('customers.tabInvoices'), count: p.invoices.length }] : []),
        { value: 'timeline', label: t('customers.tabTimeline'), count: p.activities.length },
        ...(can('party.write') ? [{ value: 'edit' as const, label: <span className="inline-flex items-center gap-1"><Pencil className="size-3.5" />{t('common.edit')}</span> }] : []),
      ]} />
      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={t('customers.contacts')} actions={can('party.write') && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setContact({})}>{t('common.add')}</Button>}>
            {p.contacts.length === 0 ? <p className="text-sm text-muted">{t('customers.noContacts')}</p> : (
              <ul className="divide-y divide-line">
                {p.contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <div className="font-bold">{c.name} {c.isPrimary && <Star className="inline size-3.5 fill-gold text-gold" />} <span className="text-xs font-normal text-muted">{c.jobTitle}</span></div>
                      <div className="num text-xs text-muted">{[c.mobile, c.email].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="flex gap-1">
                      {c.whatsapp && <a className="rounded-lg border border-line px-2 py-1 text-xs font-bold text-ok hover:bg-emerald-50" href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{t('customers.whatsapp')}</a>}
                      {can('party.write') && <Button size="sm" variant="ghost" onClick={() => setContact(c)}>{t('common.edit')}</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('customers.sites')} actions={can('party.write') && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setSite({ type: 'project' })}>{t('common.add')}</Button>}>
            {p.sites.length === 0 ? <p className="text-sm text-muted">{t('customers.noSites')}</p> : (
              <ul className="divide-y divide-line">
                {p.sites.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-2 py-2">
                    <div className="flex gap-2"><MapPin className="mt-0.5 size-4 text-gold" /><div><div className="font-bold">{s.name} <Badge>{s.type === 'billing' ? t('customers.siteBilling') : t('customers.siteProject')}</Badge></div><div className="text-xs text-muted">{formatNationalAddress(s) || '—'}</div></div></div>
                    {can('party.write') && <Button size="sm" variant="ghost" onClick={() => setSite(s)}>{t('common.edit')}</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {p.opportunities.length > 0 && (
            <Card title={t('customers.opportunities')}>
              <ul className="divide-y divide-line">{p.opportunities.map((o) => <li key={o.id} className="flex justify-between py-2"><Link className="font-bold text-primary hover:underline" href={`/crm/opportunities/${o.id}`}>{o.title}</Link><span><Money value={o.amount} /> · {o.probability}%</span></li>)}</ul>
            </Card>
          )}
          {p.notes && <Card title={t('common.notes')}><p className="whitespace-pre-line text-sm">{p.notes}</p></Card>}
        </div>
      )}
      {tab === 'quotes' && (
        <Card padded={false}>
          {p.quotes.length === 0 ? <Empty title={t('customers.noQuotes')} /> : (
            <Table><thead><tr><Th>{t('common.number')}</Th><Th>{t('common.date')}</Th><Th>{t('common.status')}</Th><Th>{t('common.total')}</Th></tr></thead>
              <tbody>{p.quotes.map((x) => <tr key={x.id}><Td><Link className="num font-bold text-primary hover:underline" href={`/quotes/${x.id}`}>{x.number}{x.revision ? `-R${x.revision}` : ''}</Link></Td><Td className="num">{date(x.quoteDate)}</Td><Td><StatusBadge status={x.status} /></Td><Td><Money value={x.total} /></Td></tr>)}</tbody></Table>
          )}
        </Card>
      )}
      {tab === 'contracts' && (
        <Card padded={false}>
          {p.contracts.length === 0 ? <Empty title={t('customers.noContracts')} /> : (
            <Table><thead><tr><Th>{t('common.number')}</Th><Th>{t('common.date')}</Th><Th>{t('common.status')}</Th><Th>{t('customers.colValue')}</Th></tr></thead>
              <tbody>{p.contracts.map((x) => <tr key={x.id}><Td><Link className="num font-bold text-primary hover:underline" href={`/contracts/${x.id}`}>{x.number}</Link></Td><Td className="num">{date(x.contractDate)}</Td><Td><StatusBadge status={x.status} /></Td><Td><Money value={x.total} /></Td></tr>)}</tbody></Table>
          )}
        </Card>
      )}
      {tab === 'invoices' && (
        <Card padded={false} actions={<Link href={`/finance/statement/${p.id}`} className="text-xs font-bold text-gold-dark hover:underline">{t('customers.statement')}</Link>} title={t('customers.tabInvoices')}>
          {p.invoices.length === 0 ? <Empty title={t('customers.noInvoices')} /> : (
            <Table><thead><tr><Th>{t('common.number')}</Th><Th>{t('common.type')}</Th><Th>{t('common.date')}</Th><Th>{t('common.total')}</Th><Th>{t('customers.colRemaining')}</Th><Th>{t('customers.colZatca')}</Th></tr></thead>
              <tbody>{p.invoices.map((x) => <tr key={x.id}><Td className="num font-bold">{x.number}</Td><Td>{x.typeCode}</Td><Td className="num">{date(x.issueDate)}</Td><Td><Money value={x.total} /></Td><Td><Money value={x.balanceDue} /></Td><Td><StatusBadge status={x.zatcaStatus} /></Td></tr>)}</tbody></Table>
          )}
        </Card>
      )}
      {tab === 'timeline' && <Card><Timeline entityType="party" entityId={p.id} items={p.activities} invalidate={['party', id]} canWrite={can('activity.write')} /></Card>}
      {tab === 'edit' && (
        <Card>
          <PartyForm initial={p} submitLabel={t('customers.saveChanges')} onSubmit={async (v) => { await api.put(`/parties/${p.id}`, v); await qc.invalidateQueries({ queryKey: ['party', id] }); toast.success(t('common.saved')); setTab('overview'); }} />
        </Card>
      )}
      {contact && <ContactDialog partyId={p.id} contact={contact} onClose={() => setContact(null)} />}
      {site && <SiteDialog partyId={p.id} site={site} onClose={() => setSite(null)} />}
    </>
  );
}
