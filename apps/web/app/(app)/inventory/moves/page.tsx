'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, History } from 'lucide-react';
import { toast } from 'sonner';
import { STOCK_MOVE_KINDS } from '@mmc/domain';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Th, clsx } from '@/components/ui';
import { downloadCsv } from '../../reports/_components/csv';
import { InventoryNav, MOVE_KIND, ProductPicker, ProjectPicker, WarehouseSelect, errMsg, useLabel, useRefLabel, type PickedProduct, type PickedProject, type StockMove } from '../_components/common';
import { MoveRow } from '../_components/move-row';

const PAGE = 100;

function Ledger() {
  const sp = useSearchParams();
  const { bi } = useI18n();
  const { can } = useMe();
  const canCost = can('purchase.cost.read');
  const label = useLabel();
  const refLabel = useRefLabel();
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [project, setProject] = useState<PickedProject | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(sp.get('warehouseId'));
  const [kind, setKind] = useState(sp.get('kind') ?? '');
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [to, setTo] = useState(sp.get('to') ?? '');
  const [limit, setLimit] = useState(PAGE);
  const [exporting, setExporting] = useState(false);

  // ?productId= / ?projectId= deep links: load the label once
  useEffect(() => {
    const pid = sp.get('productId');
    if (pid) api.get<PickedProduct>(`/products/${pid}`).then(setProduct).catch(() => {});
    const prj = sp.get('projectId');
    if (prj) api.get<PickedProject>(`/projects/${prj}`).then((p) => setProject({ id: p.id, number: p.number, name: p.name })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setLimit(PAGE), [product, project, warehouseId, kind, from, to]);

  const filters = { productId: product?.id, projectId: project?.id, warehouseId, kind, from, to };
  const pending = (!!sp.get('productId') && !product) || (!!sp.get('projectId') && !project);
  const list = useQuery({
    queryKey: ['inv-moves', filters, limit],
    queryFn: () => api.get<{ rows: StockMove[]; total: number }>(`/inventory/moves${qs({ ...filters, limit })}`),
    placeholderData: (prev) => prev,
    enabled: !pending,
  });
  const rows = list.data?.rows ?? [];

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: StockMove[] = [];
      for (let offset = 0; offset < 20_000; offset += 200) {
        const r = await api.get<{ rows: StockMove[]; total: number }>(`/inventory/moves${qs({ ...filters, limit: 200, offset })}`);
        all.push(...r.rows);
        if (all.length >= r.total || r.rows.length === 0) break;
      }
      const header = ['posted_at', 'kind', 'product_code', 'product_name', 'from', 'to', 'qty', ...(canCost ? ['unit_cost_sar'] : []), 'serials', 'reference', 'note', 'posted_by'];
      downloadCsv(`stock-ledger_${from || 'all'}_${to || 'now'}.csv`, header, all.map((m) => [
        dateTime(m.postedAt), label(MOVE_KIND, m.kind), m.productCode, m.productName, m.fromCode, m.toCode, m.qty, ...(canCost ? [m.unitCostSar] : []), m.serials.join(' '), refLabel(m.refType), m.note, m.postedByName,
      ]));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader title={bi('حركة المخزون', 'Stock ledger')} subtitle={list.data ? bi(`${list.data.total} حركة`, `${list.data.total} moves`) : undefined}
        actions={<Button variant="outline" icon={<Download className="size-4" />} loading={exporting} disabled={!rows.length} onClick={() => void exportCsv()}>{bi('تصدير CSV', 'Export CSV')}</Button>} />
      <InventoryNav />
      <Card padded={false} className="mb-4">
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={bi('الصنف', 'Product')}><ProductPicker value={product} onChange={setProduct} /></Field>
          <Field label={bi('المستودع', 'Warehouse')}><WarehouseSelect value={warehouseId} onChange={setWarehouseId} emptyLabel={bi('كل المستودعات', 'All warehouses')} /></Field>
          <Field label={bi('المشروع', 'Project')}><ProjectPicker value={project} onChange={setProject} /></Field>
          <Field label={bi('نوع الحركة', 'Move kind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{bi('كل الأنواع', 'All kinds')}</option>
              {STOCK_MOVE_KINDS.map((k) => <option key={k} value={k}>{label(MOVE_KIND, k)}</option>)}
            </Select>
          </Field>
          <Field label={bi('من تاريخ', 'From date')}><Input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={bi('إلى تاريخ', 'To date')}><Input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </Card>
      <Card padded={false}>
        <ErrorBox error={list.error} />
        {list.isLoading || pending ? <Spinner /> : rows.length === 0 ? <Empty icon={<History className="size-8" />} title={bi('لا حركات مطابقة', 'No matching moves')} /> : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('الصنف', 'Product')}</Th><Th>{bi('النوع', 'Kind')}</Th><Th>{bi('من ← إلى', 'From → to')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th>
                {canCost && <Th className="text-end">{bi('تكلفة الوحدة', 'Unit cost')}</Th>}<Th>{bi('المرجع', 'Reference')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((m) => <MoveRow key={m.id} m={m} canCost={canCost} refLabel={refLabel} showProduct />)}
              </tbody>
            </Table>
            {list.data && list.data.total > rows.length && limit < 200 && (
              <div className="flex justify-center border-t border-line p-3">
                <Button variant="outline" size="sm" loading={list.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>{bi('عرض المزيد', 'Show more')} (<span className="num">{list.data.total - rows.length}</span>)</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

export default function MovesPage() {
  return <Suspense fallback={<Spinner />}><Ledger /></Suspense>;
}
