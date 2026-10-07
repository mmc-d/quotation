'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Package, Plus, Tags, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, Table, Td, Th } from '@/components/ui';
import { ImportDialog } from './_components/import-dialog';
import { ExcelImportDialog, downloadProductsExcel } from './_components/excel-dialog';
import { CURRENCY_AR, CURRENCY_EN, num, type Product } from './_components/types';

const PAGE = 100;

export default function ProductsPage() {
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try { await downloadProductsExcel(); } catch (e) { toast.error((e as Error).message); } finally { setDownloading(false); }
  };
  const showCost = can('product.cost.read');
  const list = useQuery({
    queryKey: ['products', q, archived, offset],
    queryFn: () => api.get<{ rows: Product[]; total: number }>(`/products${qs({ q, includeArchived: archived || undefined, limit: PAGE, offset })}`),
  });
  const total = list.data?.total ?? 0;
  return (
    <>
      <PageHeader
        title={bi('المنتجات', 'Products')}
        subtitle={list.data ? bi(`${total} صنف`, `${total} items`) : 'Products catalog'}
        actions={<>
          <Button variant="outline" icon={<Download className="size-4" />} loading={downloading} onClick={download}>{bi('تنزيل Excel (القالب)', 'Download Excel (template)')}</Button>
          {can('product.write') && <>
          <Button variant="outline" icon={<FileSpreadsheet className="size-4" />} onClick={() => setExcelOpen(true)}>{bi('رفع ملف Excel', 'Upload Excel')}</Button>
          <Button variant="ghost" icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>{bi('استيراد من الشيت', 'Import from sheet')}</Button>
          <LinkButton href="/products/price-lists" icon={<Tags className="size-4" />}>{bi('قوائم الأسعار', 'Price lists')}</LinkButton>
          <LinkButton href="/products/new" variant="primary" icon={<Plus className="size-4" />}>{bi('منتج جديد', 'New product')}</LinkButton>
          </>}
        </>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder={bi('الكود أو الاسم…', 'Code or name…')} />
          <Checkbox label={bi('إظهار المؤرشفة', 'Show archived')} checked={archived} onChange={(v) => { setArchived(v); setOffset(0); }} />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<Package className="size-8" />} title={q ? bi('لا توجد نتائج', 'No results') : bi('لا توجد منتجات بعد', 'No products yet')} hint={q ? bi('جرّب كلمة بحث أخرى.', 'Try another search term.') : bi('أضف منتجًا، أو استورد شيت المنتجات القديم (CSV).', 'Add a product, or import the old products sheet (CSV).')} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-14" />
                <Th>{bi('الكود', 'Code')}</Th>
                <Th>{bi('الاسم', 'Name')}</Th>
                <Th>{bi('سعر البيع', 'Selling price')}</Th>
                <Th>{bi('التركيب', 'Installation')}</Th>
                {showCost && <Th>{bi('التكلفة', 'Cost')}</Th>}
                <Th>{bi('الحالة', 'Status')}</Th>
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
                    <div className="font-bold">{p.nameAr}{p.type === 'kit' && <span className="ms-1.5 align-middle"><Badge tone="gold">{bi('باقة', 'Package')}</Badge></span>}</div>
                    {p.nameEn && <div className="text-xs text-muted" dir="ltr">{p.nameEn}</div>}
                  </Td>
                  <Td><Money value={p.listPrice} /></Td>
                  <Td><Money value={p.installCost} /></Td>
                  {showCost && <Td className="num whitespace-nowrap">{p.costPrice ? <>{num(p.costPrice, 4)} <span className="text-xs text-muted">{(locale === 'en' ? CURRENCY_EN : CURRENCY_AR)[p.costCurrency] ?? p.costCurrency}</span></> : '—'}</Td>}
                  <Td>{p.archivedAt ? <Badge tone="red">{bi('مؤرشف', 'Archived')}</Badge> : p.status === 'active' ? <Badge tone="green">{bi('نشط', 'Active')}</Badge> : <Badge>{bi('متوقف', 'Discontinued')}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {total > PAGE && (
          <div className="flex items-center justify-between gap-2 p-3 text-sm">
            <span className="text-muted num">{offset + 1}–{Math.min(offset + PAGE, total)} {bi('من', 'of')} {total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{bi('السابق', 'Previous')}</Button>
              <Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{bi('التالي', 'Next')}</Button>
            </div>
          </div>
        )}
      </Card>
      {can("product.write") && <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />}
      {can("product.write") && <ExcelImportDialog open={excelOpen} onClose={() => setExcelOpen(false)} />}
    </>
  );
}
