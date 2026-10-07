'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PackagePlus, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { date, dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Card, Empty, ErrorBox, LinkButton, Money, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { InventoryNav } from '../_components/common';

interface OpeningRow { id: string; number: string; openedOn: string; warehouseCode: string; warehouseName: string; lines: number; totalSar: string | null; notes: string | null; createdAt: string }

export default function OpeningListPage() {
  const { bi } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const list = useQuery({ queryKey: ['inv-openings'], queryFn: () => api.get<OpeningRow[]>('/inventory/opening-balances') });
  const rows = list.data ?? [];
  const canPost = can('inventory.count');
  return (
    <>
      <PageHeader
        title={bi('الرصيد الافتتاحي', 'Opening stock')}
        subtitle={bi('إدخال الكميات الموجودة فعلًا في المستودعات عند بدء استخدام النظام، مع تكلفة كل صنف', 'Enter the quantities on hand when you start using the system, with each item\'s cost')}
        actions={canPost && <LinkButton variant="primary" href="/inventory/opening/new" icon={<Plus className="size-4" />}>{bi('رصيد افتتاحي جديد', 'New opening stock')}</LinkButton>}
      />
      <InventoryNav />
      <Card padded={false}>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<PackagePlus className="size-8" />} title={bi('لم يُدخل رصيد افتتاحي بعد', 'No opening stock yet')}
            hint={bi('ابدأ بالمستودع الرئيسي: الصق قائمة الأصناف من Excel (الكود، الكمية، التكلفة) أو أدخلها صنفًا صنفًا.', 'Start with the main store: paste the list from Excel (code, qty, cost) or add items one by one.')}
            action={canPost ? <LinkButton variant="primary" href="/inventory/opening/new" icon={<Plus className="size-4" />}>{bi('رصيد افتتاحي جديد', 'New opening stock')}</LinkButton> : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('المستودع', 'Warehouse')}</Th><Th className="text-end">{bi('الأصناف', 'Items')}</Th><Th className="text-end">{bi('القيمة', 'Value')}</Th><Th>{bi('أُدخل', 'Entered')}</Th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/inventory/opening/${o.id}`)}>
                  <Td><Link href={`/inventory/opening/${o.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num font-bold text-primary hover:underline">{o.number}</Link></Td>
                  <Td><span className="num text-xs">{date(o.openedOn)}</span></Td>
                  <Td>{o.warehouseCode} — {o.warehouseName}</Td>
                  <Td className="text-end"><span className="num">{o.lines}</span></Td>
                  <Td className="text-end">{o.totalSar === null ? <span className="text-muted">—</span> : <Money value={o.totalSar} />}</Td>
                  <Td><span className="num text-xs text-muted">{dateTime(o.createdAt)}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
