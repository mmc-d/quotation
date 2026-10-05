'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Badge, Card, Empty, ErrorBox, LinkButton, PageHeader, SearchBox, Select, Spinner, Table, Td, Th } from '@/components/ui';

interface Party { id: string; nameAr: string; nameEn: string | null; vatNumber: string | null; unifiedNumber: string | null; phone: string | null; segment: string | null; isCustomer: boolean; isSupplier: boolean; isPartner: boolean; b2b: boolean }

export default function CustomersPage() {
  const { can } = useMe();
  const { t, tx, locale } = useI18n();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const list = useQuery({ queryKey: ['parties', q, role], queryFn: () => api.get<{ rows: Party[]; total: number }>(`/parties${qs({ q, role, limit: 100 })}`) });
  return (
    <>
      <PageHeader title={t('customers.title')} subtitle={list.data ? t('customers.count', { n: list.data.total }) : undefined} actions={can('party.write') && <LinkButton href="/customers/new" variant="primary" icon={<Plus className="size-4" />}>{t('customers.new')}</LinkButton>} />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={t('customers.searchPh')} />
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="max-w-[10rem]">
            <option value="">{t('common.all')}</option><option value="customer">{t('customers.roleCustomers')}</option><option value="supplier">{t('customers.roleSuppliers')}</option><option value="partner">{t('customers.rolePartners')}</option>
          </Select>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<Building2 className="size-8" />} title={t('customers.empty')} hint={t('customers.emptyHint')} />
        ) : (
          <Table>
            <thead><tr><Th>{t('customers.colName')}</Th><Th>{t('customers.colIds')}</Th><Th>{t('customers.colMobile')}</Th><Th>{t('customers.colType')}</Th><Th>{t('customers.colSegment')}</Th></tr></thead>
            <tbody>
              {list.data.rows.map((p) => (
                <tr key={p.id} className="hover:bg-tint/50">
                  <Td>{locale === 'en' && p.nameEn ? <><Link href={`/customers/${p.id}`} className="font-bold text-primary hover:underline" dir="ltr">{p.nameEn}</Link><div className="text-xs text-muted" dir="rtl">{p.nameAr}</div></> : <><Link href={`/customers/${p.id}`} className="font-bold text-primary hover:underline">{p.nameAr}</Link>{p.nameEn && <div className="text-xs text-muted" dir="ltr">{p.nameEn}</div>}</>}</Td>
                  <Td className="num text-xs">{p.vatNumber ?? p.unifiedNumber ?? '—'}</Td>
                  <Td className="num">{p.phone ?? '—'}</Td>
                  <Td><div className="flex flex-wrap gap-1">{p.isCustomer && <Badge tone="green">{t('customers.customer')}</Badge>}{p.isSupplier && <Badge tone="blue">{t('customers.supplier')}</Badge>}{p.isPartner && <Badge tone="gold">{t('customers.partner')}</Badge>}<Badge>{p.b2b ? t('customers.b2b') : t('customers.b2c')}</Badge></div></Td>
                  <Td className="text-muted">{p.segment ? tx(`segment.${p.segment}`, p.segment) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
