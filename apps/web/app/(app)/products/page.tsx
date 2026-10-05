'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Plus, Upload } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, Table, Td, Th } from '@/components/ui';
import { ImportDialog } from './_components/import-dialog';
import { CURRENCY_AR, num, type Product } from './_components/types';

const PAGE = 100;

export default function ProductsPage() {
  const { can } = useMe();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const showCost = can('product.cost.read');
  const list = useQuery({
    queryKey: ['products', q, archived, offset],
    queryFn: () => api.get<{ rows: Product[]; total: number }>(`/products${qs({ q, includeArchived: archived || undefined, limit: PAGE, offset })}`),
  });
  const total = list.data?.total ?? 0;
  return (
    <>
      <PageHeader
        title="المنتجات"
        subtitle={list.data ? `${total} صنف` : 'Products catalog'}
        actions={can('product.write') && <>
          <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>استيراد من الشيت</Button>
          <LinkButton href="/products/new" variant="primary" icon={<Plus className="size-4" />}>منتج جديد</LinkButton>
        </>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="الكود أو الاسم…" />
          <Checkbox label="إظهار المؤرشفة" checked={archived} onChange={(v) => { setArchived(v); setOffset(0); }} />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<Package className="size-8" />} title={q ? 'لا توجد نتائج' : 'لا توجد منتجات بعد'} hint={q ? 'جرّب كلمة بحث أخرى.' : 'أضف منتجًا، أو استورد شيت المنتجات القديم (CSV).'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-14" />
                <Th>الكود</Th>
                <Th>الاسم</Th>
                <Th>سعر البيع</Th>
                <Th>التركيب</Th>
                {showCost && <Th>التكلفة</Th>}
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.rows.map((p) => (
                <tr key={p.id} className="hover:bg-tint/50">
                  <Td>
                    {p.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.imageUrl} alt="" className="size-10 rounded-md border border-line bg-white object-contain" loading="lazy" />
                      : <div className="grid size-10 place-items-center rounded-md bg-tint text-gold"><Package className="size-4" /></div>}
                  </Td>
                  <Td><Link href={`/products/${p.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{p.code}</Link></Td>
                  <Td>
                    <div className="font-bold">{p.nameAr}</div>
                    {p.nameEn && <div className="text-xs text-muted" dir="ltr">{p.nameEn}</div>}
                  </Td>
                  <Td><Money value={p.listPrice} /></Td>
                  <Td><Money value={p.installCost} /></Td>
                  {showCost && <Td className="num whitespace-nowrap">{p.costPrice ? <>{num(p.costPrice, 4)} <span className="text-xs text-muted">{CURRENCY_AR[p.costCurrency] ?? p.costCurrency}</span></> : '—'}</Td>}
                  <Td>{p.archivedAt ? <Badge tone="red">مؤرشف</Badge> : p.status === 'active' ? <Badge tone="green">نشط</Badge> : <Badge>متوقف</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {total > PAGE && (
          <div className="flex items-center justify-between gap-2 p-3 text-sm">
            <span className="text-muted num">{offset + 1}–{Math.min(offset + PAGE, total)} من {total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>السابق</Button>
              <Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>التالي</Button>
            </div>
          </div>
        )}
      </Card>
      {can('product.write') && <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />}
    </>
  );
}
