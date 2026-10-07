'use client';
import Link from 'next/link';
import { Fragment, Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ChevronDown, Download, PackageCheck, PackageMinus, PackagePlus, ReceiptText, ShieldAlert, ShoppingCart, Warehouse as WarehouseIcon } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, Stat, Table, Tabs, Td, Th, clsx } from '@/components/ui';
import { downloadCsv } from '../reports/_components/csv';
import { InventoryNav, Ltr, Qty, WarehouseSelect, WhKindChip, fmtQty } from './_components/common';
import { NewTransferDialog, ProjectStockDialog } from './_components/stock-dialogs';
import { WarehousesPanel } from './_components/warehouses';

const PAGE = 100;

interface StockRow {
  productId: string; code: string; nameAr: string; nameEn: string | null; uom: string; serialTracked: boolean; reorderLevel: string | null; reorderQty: string | null;
  byWarehouse: { warehouseId: string; code: string; nameAr: string; kind: string; qty: string; reserved: string }[];
  onHand: string; reserved: string; incoming: string; projected: string; avgCost: string | null; value: string | null; belowReorder: boolean;
}
interface ReorderRow {
  productId: string; code: string; nameAr: string; onHand: string; reserved: string; incoming: string; projected: string; reorderLevel: string; suggestQty: string;
  preferredSupplier: { id: string; name: string; leadTimeDays: number | null } | null;
}
interface ComplianceRow { id: string; code: string; nameAr: string; radio: boolean; ok: boolean; issues: { key: string; level: 'block' | 'warn'; ar: string; en: string }[] }
interface Valuation { rows: { productId: string; code: string; nameAr: string; qty: string; avgCostSar: string; value: string }[]; totalValue: string }

type Tab = 'stock' | 'warehouses' | 'valuation' | 'reorder' | 'compliance';

function Overview() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const canCost = can('purchase.cost.read');
  const canWrite = can('inventory.write');
  const canPurchase = can('purchase.read');
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) || 'stock');
  const [search, setSearch] = useState(sp.get('q') ?? '');
  const [term, setTerm] = useState(search);
  const [warehouseId, setWarehouseId] = useState<string | null>(sp.get('warehouseId'));
  const [below, setBelow] = useState(sp.get('below') === '1');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | 'transfer' | 'issue' | 'return'>(null);

  useEffect(() => { const t = setTimeout(() => setTerm(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => {
    const next = qs({ tab: tab === 'stock' ? undefined : tab, q: term, warehouseId, below: below ? 1 : undefined });
    if (next !== (sp.toString() ? `?${sp.toString()}` : '')) router.replace(`${pathname}${next}`, { scroll: false });
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, term, warehouseId, below]);

  const filters = { q: term, warehouseId, belowReorder: below || undefined, limit };
  const stock = useQuery({
    queryKey: ['inv-stock', filters],
    queryFn: () => api.get<{ rows: StockRow[]; total: number }>(`/inventory/stock${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const reorder = useQuery({ queryKey: ['inv-reorder'], queryFn: () => api.get<ReorderRow[]>('/inventory/reports/reorder'), enabled: canPurchase || can('inventory.read'), retry: false });
  const compliance = useQuery({ queryKey: ['inv-compliance', 'block'], queryFn: () => api.get<ComplianceRow[]>('/inventory/compliance?status=block'), retry: false });
  const valuation = useQuery({ queryKey: ['inv-valuation'], queryFn: () => api.get<Valuation>('/inventory/reports/stock-valuation'), enabled: canCost, retry: false });

  const rows = stock.data?.rows ?? [];
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const name = (r: { nameAr: string; nameEn?: string | null }) => (locale === 'en' ? r.nameEn || r.nameAr : r.nameAr);

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'stock', label: bi('الأرصدة', 'Stock') },
    { value: 'warehouses', label: bi('المستودعات', 'Warehouses') },
    ...(canCost ? [{ value: 'valuation' as Tab, label: bi('تقييم المخزون', 'Valuation') }] : []),
    { value: 'reorder', label: bi('إعادة الطلب', 'Reorder'), count: reorder.data?.length || undefined },
    { value: 'compliance', label: bi('الامتثال', 'Compliance'), count: compliance.data?.length || undefined },
  ];

  return (
    <>
      <PageHeader
        title={bi('المخزون', 'Stock')}
        subtitle={stock.data ? bi(`${stock.data.total} صنف`, `${stock.data.total} items`) : undefined}
        actions={<>
          {can('inventory.count') && <LinkButton href="/inventory/opening/new" icon={<PackageCheck className="size-4" />}>{bi('رصيد افتتاحي', 'Opening stock')}</LinkButton>}
          {can('purchase.write') && <LinkButton href="/purchasing/bills/new" icon={<ReceiptText className="size-4" />}>{bi('فاتورة مشتريات', 'Supplier bill')}</LinkButton>}
          {canWrite && <>
            <Button variant="outline" icon={<PackageMinus className="size-4" />} onClick={() => setDialog('issue')}>{bi('صرف لمشروع', 'Issue to project')}</Button>
            <Button variant="outline" icon={<PackagePlus className="size-4" />} onClick={() => setDialog('return')}>{bi('مرتجع من مشروع', 'Return from project')}</Button>
            <Button icon={<ArrowLeftRight className="size-4" />} onClick={() => setDialog('transfer')}>{bi('تحويل', 'Transfer')}</Button>
          </>}
        </>}
      />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        {canCost && <Stat label={bi('قيمة المخزون', 'Stock value')} value={valuation.data ? <Money value={valuation.data.totalValue} /> : '—'} hint={bi('بمتوسط التكلفة، بدون الحجر', 'At average cost, excl. quarantine')} />}
        <button type="button" className="text-start" onClick={() => setTab('reorder')}>
          <Stat label={bi('أصناف تحت حد الطلب', 'Items below reorder')} tone={reorder.data?.length ? 'red' : undefined} value={<span className="num">{reorder.data?.length ?? '—'}</span>} />
        </button>
        <button type="button" className="text-start" onClick={() => setTab('compliance')}>
          <Stat label={bi('مشاكل امتثال (سابر/CST)', 'Compliance problems (SABER/CST)')} tone={compliance.data?.length ? 'red' : undefined} value={<span className="num">{compliance.data?.length ?? '—'}</span>} />
        </button>
      </div>

      <Tabs value={tab} onChange={setTab} items={tabs} />

      {tab === 'stock' && (
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
            <SearchBox value={search} onChange={setSearch} placeholder={bi('الكود أو الاسم…', 'Code or name…')} />
            <WarehouseSelect value={warehouseId} onChange={setWarehouseId} emptyLabel={bi('كل المستودعات', 'All warehouses')} className="max-w-xs" />
            <Checkbox label={bi('تحت حد إعادة الطلب', 'Below reorder level')} checked={below} onChange={setBelow} />
          </div>
          <ErrorBox error={stock.error} />
          {stock.isLoading ? <Spinner /> : rows.length === 0 ? (
            <Empty icon={<WarehouseIcon className="size-8" />} title={term || warehouseId || below ? bi('لا نتائج مطابقة', 'No matching items') : bi('لا يوجد مخزون بعد', 'No stock yet')} />
          ) : (
            <>
              <Table>
                <thead><tr>
                  <Th className="w-8" /><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th>
                  <Th className="text-end">{bi('الرصيد', 'On hand')}</Th><Th className="text-end">{bi('محجوز', 'Reserved')}</Th><Th className="text-end">{bi('وارد', 'Incoming')}</Th><Th className="text-end">{bi('المتوقع', 'Projected')}</Th>
                  {canCost && <><Th className="text-end">{bi('متوسط التكلفة', 'Avg cost')}</Th><Th className="text-end">{bi('القيمة', 'Value')}</Th></>}
                </tr></thead>
                <tbody className={clsx(stock.isFetching && 'opacity-70')}>
                  {rows.map((r) => {
                    const isOpen = open.has(r.productId);
                    return (
                      <Fragment key={r.productId}>
                        <tr className="hover:bg-tint/40">
                          <Td>
                            {r.byWarehouse.length > 0 && (
                              <button type="button" onClick={() => toggle(r.productId)} className="rounded p-0.5 text-muted hover:bg-black/5" aria-expanded={isOpen} aria-label={bi('حسب المستودع', 'By warehouse')}>
                                <ChevronDown className={clsx('size-4 transition', isOpen ? '' : (locale === 'ar' ? 'rotate-90' : '-rotate-90'))} />
                              </button>
                            )}
                          </Td>
                          <Td className="whitespace-nowrap"><Link href={`/inventory/${r.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{r.code}</Link>{r.serialTracked && <span className="ms-1.5"><Badge tone="gold">{bi('تسلسلي', 'Serial')}</Badge></span>}</Td>
                          <Td className="max-w-[18rem] truncate text-xs">{name(r)}</Td>
                          <Td className="text-end font-bold"><Qty value={r.onHand} /></Td>
                          <Td className="text-end"><Qty value={r.reserved} /></Td>
                          <Td className="text-end"><Qty value={r.incoming} /></Td>
                          <Td className="text-end"><Qty value={r.projected} className={clsx(r.belowReorder && 'font-bold text-danger')} />{r.belowReorder && <span className="ms-1 text-[10px] font-bold text-danger" title={bi('تحت حد إعادة الطلب', 'Below reorder level')}>▼</span>}</Td>
                          {canCost && <><Td className="text-end"><Money value={r.avgCost} fixed /></Td><Td className="text-end"><Money value={r.value} /></Td></>}
                        </tr>
                        {isOpen && r.byWarehouse.map((b) => (
                          <tr key={b.warehouseId} className="bg-tint/30 text-xs">
                            <Td /><Td colSpan={2}><span className="inline-flex items-center gap-2"><Ltr className="font-bold">{b.code}</Ltr><span>{b.nameAr}</span><WhKindChip kind={b.kind} /></span></Td>
                            <Td className="text-end"><Qty value={b.qty} /></Td><Td className="text-end"><Qty value={b.reserved} /></Td><Td colSpan={canCost ? 4 : 2} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
              {stock.data && stock.data.total > rows.length && limit < 200 && (
                <div className="flex justify-center border-t border-line p-3">
                  <Button variant="outline" size="sm" loading={stock.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>{bi('عرض المزيد', 'Show more')} (<span className="num">{stock.data.total - rows.length}</span>)</Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {tab === 'warehouses' && <WarehousesPanel />}
      {tab === 'valuation' && canCost && <ValuationPanel q={valuation} />}
      {tab === 'reorder' && <ReorderPanel q={reorder} />}
      {tab === 'compliance' && <CompliancePanel q={compliance} />}

      <NewTransferDialog open={dialog === 'transfer'} onClose={() => setDialog(null)} defaultFrom={warehouseId} />
      <ProjectStockDialog mode="issue" open={dialog === 'issue'} onClose={() => setDialog(null)} />
      <ProjectStockDialog mode="return" open={dialog === 'return'} onClose={() => setDialog(null)} />
    </>
  );
}

function ValuationPanel({ q }: { q: { data?: Valuation; isLoading: boolean; error: unknown } }) {
  const { bi } = useI18n();
  const rows = q.data?.rows ?? [];
  const exportCsv = () => downloadCsv(`stock-valuation_${new Date().toISOString().slice(0, 10)}.csv`, ['code', 'name', 'qty', 'avg_cost_sar', 'value_sar'], rows.map((r) => [r.code, r.nameAr, r.qty, r.avgCostSar, r.value]));
  return (
    <Card padded={false} title={<>{bi('تقييم المخزون', 'Stock valuation')}{q.data && <span className="ms-2 text-xs font-bold text-muted">{bi('الإجمالي', 'Total')}: <Money value={q.data.totalValue} /></span>}</>}
      actions={<Button size="sm" variant="outline" icon={<Download className="size-3.5" />} disabled={!rows.length} onClick={exportCsv}>{bi('تصدير CSV', 'Export CSV')}</Button>}>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? <Empty title={bi('لا يوجد مخزون', 'No stock')} /> : (
        <Table>
          <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th className="text-end">{bi('متوسط التكلفة', 'Avg cost')}</Th><Th className="text-end">{bi('القيمة', 'Value')}</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <Td><Link href={`/inventory/${r.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{r.code}</Link></Td>
                <Td className="text-xs">{r.nameAr}</Td>
                <Td className="text-end"><Qty value={r.qty} /></Td>
                <Td className="text-end"><Money value={r.avgCostSar} fixed /></Td>
                <Td className="text-end font-bold"><Money value={r.value} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function ReorderPanel({ q }: { q: { data?: ReorderRow[]; isLoading: boolean; error: unknown } }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const rows = q.data ?? [];
  return (
    <Card padded={false} title={bi('اقتراحات إعادة الطلب', 'Reorder suggestions')}>
      <p className="border-b border-line px-4 py-2 text-xs text-muted">{bi('المتوقع = الرصيد − المحجوز + الوارد. يظهر الصنف عندما يقل المتوقع عن حد إعادة الطلب.', 'Projected = on hand − reserved + incoming. An item shows when projected falls below its reorder level.')}</p>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? <Empty title={bi('لا أصناف تحت حد الطلب', 'Nothing below the reorder level')} /> : (
        <Table>
          <thead><tr>
            <Th>{bi('الكود', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th className="text-end">{bi('الرصيد', 'On hand')}</Th><Th className="text-end">{bi('محجوز', 'Reserved')}</Th><Th className="text-end">{bi('وارد', 'Incoming')}</Th>
            <Th className="text-end">{bi('المتوقع', 'Projected')}</Th><Th className="text-end">{bi('حد الطلب', 'Reorder level')}</Th><Th className="text-end">{bi('الكمية المقترحة', 'Suggested qty')}</Th><Th>{bi('المورد المفضل', 'Preferred supplier')}</Th><Th />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <Td><Link href={`/inventory/${r.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{r.code}</Link></Td>
                <Td className="max-w-[14rem] truncate text-xs">{r.nameAr}</Td>
                <Td className="text-end"><Qty value={r.onHand} /></Td><Td className="text-end"><Qty value={r.reserved} /></Td><Td className="text-end"><Qty value={r.incoming} /></Td>
                <Td className="text-end font-bold text-danger"><Qty value={r.projected} /></Td>
                <Td className="text-end"><Qty value={r.reorderLevel} /></Td>
                <Td className="text-end font-bold"><Qty value={r.suggestQty} /></Td>
                <Td className="text-xs">{r.preferredSupplier ? <>{r.preferredSupplier.name}{r.preferredSupplier.leadTimeDays !== null && <span className="text-muted"> · <span className="num">{r.preferredSupplier.leadTimeDays}</span> {bi('يوم', 'd')}</span>}</> : <span className="text-muted">—</span>}</Td>
                <Td className="text-end">{can('purchase.write') && <LinkButton size="sm" href={`/purchasing/orders/new${qs({ productId: r.productId, qty: fmtQty(r.suggestQty).replace(/,/g, ''), supplierId: r.preferredSupplier?.id })}`} icon={<ShoppingCart className="size-3.5" />}>{bi('أمر شراء', 'Create PO')}</LinkButton>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function CompliancePanel({ q }: { q: { data?: ComplianceRow[]; isLoading: boolean; error: unknown } }) {
  const { bi, locale } = useI18n();
  const rows = q.data ?? [];
  return (
    <Card padded={false} title={<span className="inline-flex items-center gap-2"><ShieldAlert className="size-4" />{bi('أصناف تمنع شهاداتها الشراء أو البيع', 'Models blocked by missing / expired certificates')}</span>}>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? <Empty title={bi('لا مشاكل امتثال', 'No compliance problems')} /> : (
        <Table>
          <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th>{bi('جهاز لاسلكي', 'Radio')}</Th><Th>{bi('المشاكل', 'Issues')}</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/inventory/${r.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{r.code}</Link></Td>
                <Td className="text-xs">{r.nameAr}</Td>
                <Td>{r.radio ? <Badge tone="blue">{bi('نعم', 'Yes')}</Badge> : <span className="text-muted">—</span>}</Td>
                <Td className="text-xs"><ul className="space-y-0.5">{r.issues.map((i) => <li key={i.key} className={i.level === 'block' ? 'text-danger' : 'text-amber-700'}>{locale === 'en' ? i.en : i.ar}</li>)}</ul></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export default function InventoryPage() {
  return <Suspense fallback={<Spinner />}><Overview /></Suspense>;
}
