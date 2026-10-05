'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Badge, Card, Empty, ErrorBox, LinkButton, PageHeader, SearchBox, Select, Spinner, Table, Td, Th } from '@/components/ui';

interface Party { id: string; nameAr: string; nameEn: string | null; vatNumber: string | null; unifiedNumber: string | null; phone: string | null; segment: string | null; isCustomer: boolean; isSupplier: boolean; isPartner: boolean; b2b: boolean }

export default function CustomersPage() {
  const { can } = useMe();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const list = useQuery({ queryKey: ['parties', q, role], queryFn: () => api.get<{ rows: Party[]; total: number }>(`/parties${qs({ q, role, limit: 100 })}`) });
  return (
    <>
      <PageHeader title="العملاء" subtitle={list.data ? `${list.data.total} سجل` : 'Customers'} actions={can('party.write') && <LinkButton href="/customers/new" variant="primary" icon={<Plus className="size-4" />}>عميل جديد</LinkButton>} />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder="الاسم، الرقم الضريبي، الجوال…" />
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="max-w-[10rem]">
            <option value="">الكل</option><option value="customer">عملاء</option><option value="supplier">موردون</option><option value="partner">شركاء</option>
          </Select>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<Building2 className="size-8" />} title="لا يوجد عملاء بعد" hint="أضف أول عميل، أو حوّل عميلًا محتملًا من شاشة العملاء المحتملين." />
        ) : (
          <Table>
            <thead><tr><Th>الاسم</Th><Th>الرقم الضريبي / الموحد</Th><Th>الجوال</Th><Th>النوع</Th><Th>الشريحة</Th></tr></thead>
            <tbody>
              {list.data.rows.map((p) => (
                <tr key={p.id} className="hover:bg-tint/50">
                  <Td><Link href={`/customers/${p.id}`} className="font-bold text-primary hover:underline">{p.nameAr}</Link>{p.nameEn && <div className="text-xs text-muted" dir="ltr">{p.nameEn}</div>}</Td>
                  <Td className="num text-xs">{p.vatNumber ?? p.unifiedNumber ?? '—'}</Td>
                  <Td className="num">{p.phone ?? '—'}</Td>
                  <Td className="space-x-1 space-x-reverse">{p.isCustomer && <Badge tone="green">عميل</Badge>}{p.isSupplier && <Badge tone="blue">مورد</Badge>}{p.isPartner && <Badge tone="gold">شريك</Badge>}<Badge>{p.b2b ? 'منشأة B2B' : 'فرد B2C'}</Badge></Td>
                  <Td className="text-muted">{p.segment ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
