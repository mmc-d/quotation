'use client';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Card, ErrorBox, Money, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { Qty, whName } from '../../_components/common';

interface OpeningView {
  id: string; number: string; openedOn: string; notes: string | null; totalSar: string | null; createdAt: string;
  warehouse: { id: string; code: string; nameAr: string; nameEn: string | null } | null;
  lines: { productId: string; code: string; name: string; qty: string; unitCostSar: string | null; valueSar: string | null; serials?: string[] }[];
}

export default function OpeningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi, locale } = useI18n();
  const q = useQuery({ queryKey: ['inv-opening', id], queryFn: () => api.get<OpeningView>(`/inventory/opening-balances/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const o = q.data;
  return (
    <>
      <PageHeader back="/inventory/opening" title={<>{bi('رصيد افتتاحي', 'Opening stock')} <span dir="ltr" className="num">{o.number}</span></>}
        subtitle={<>{o.warehouse ? `${o.warehouse.code} — ${whName(o.warehouse, locale)}` : ''} · <span className="num">{date(o.openedOn)}</span> · {bi('أُدخل', 'entered')} <span className="num">{dateTime(o.createdAt)}</span></>} />
      {o.notes && <p className="mb-4 whitespace-pre-wrap rounded-xl border border-line bg-white px-4 py-3 text-sm">{o.notes}</p>}
      <Card padded={false} title={<>{bi('الأصناف', 'Items')} <span className="text-xs font-normal text-muted">({o.lines.length})</span></>}
        actions={o.totalSar !== null ? <span className="text-sm font-extrabold">{bi('القيمة', 'Value')}: <Money value={o.totalSar} /></span> : undefined}>
        <Table>
          <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th className="text-end">{bi('تكلفة الوحدة', 'Unit cost')}</Th><Th className="text-end">{bi('القيمة', 'Value')}</Th><Th>{bi('الأرقام التسلسلية', 'Serials')}</Th></tr></thead>
          <tbody>
            {o.lines.map((l) => (
              <tr key={l.productId}>
                <Td><Link href={`/inventory/${l.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{l.code}</Link></Td>
                <Td>{l.name}</Td>
                <Td className="text-end"><Qty value={l.qty} /></Td>
                <Td className="text-end">{l.unitCostSar === null ? <span className="text-muted">—</span> : <Money value={l.unitCostSar} />}</Td>
                <Td className="text-end">{l.valueSar === null ? <span className="text-muted">—</span> : <Money value={l.valueSar} />}</Td>
                <Td><span dir="ltr" className="num text-[11px] text-muted">{l.serials?.join(', ') || '—'}</span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
