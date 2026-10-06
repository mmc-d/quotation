'use client';
import { use, useDeferredValue, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, Plus, Save, Search, Trash2 } from 'lucide-react';
import { SEGMENTS } from '@mmc/domain';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Checkbox, Dialog, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner } from '@/components/ui';
import { num, type Product } from '../../_components/types';
import { SEGMENT_FALLBACK, type PriceListDetail } from '../../_components/price-list-types';

interface HeadForm { name: string; currency: string; validFrom: string; validTo: string; segment: string; isDefault: boolean }
interface ItemRow { key: string; productId: string; code: string; nameAr: string; listPrice: string; price: string; minQty: string }

const amountOk = (v: string) => /^\d+(\.\d{1,4})?$/.test(v.trim());
const qtyOk = (v: string) => /^\d+(\.\d{1,3})?$/.test(v.trim()) && Number(v) > 0;
let seq = 0;
const rowKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

export default function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useMe();
  const { tx, bi } = useI18n();
  const canWrite = can('product.write');
  const q = useQuery({ queryKey: ['price-list', id], queryFn: () => api.get<PriceListDetail>(`/price-lists/${id}`) });

  const [head, setHead] = useState<HeadForm>({ name: '', currency: 'SAR', validFrom: '', validTo: '', segment: '', isDefault: false });
  const [items, setItems] = useState<ItemRow[]>([]);
  const [itemsBase, setItemsBase] = useState('[]');
  const [busy, setBusy] = useState<null | 'head' | 'items' | 'archive'>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const seg = (s: string) => tx(`segment.${s}`, SEGMENT_FALLBACK[s] ?? s);

  useEffect(() => {
    const d = q.data;
    if (!d) return;
    setHead({ name: d.name, currency: d.currency, validFrom: d.validFrom ?? '', validTo: d.validTo ?? '', segment: d.segment ?? '', isDefault: d.isDefault });
    const rows = d.items.map((i) => ({ key: i.id, productId: i.productId, code: i.code, nameAr: i.nameAr, listPrice: i.listPrice, price: String(Number(i.price)), minQty: String(Number(i.minQty)) }));
    setItems(rows);
    setItemsBase(JSON.stringify(rows));
  }, [q.data]);

  const found = useQuery({
    queryKey: ['products-pick', term],
    queryFn: () => api.get<{ rows: Product[] }>(`/products${qs({ q: term, limit: 20 })}`),
    enabled: term.length > 0,
    staleTime: 60_000,
  });

  const dateErr = head.validFrom && head.validTo && head.validFrom > head.validTo ? bi('تاريخ البداية بعد تاريخ النهاية', 'Start date is after end date') : null;
  const rowErr = (r: ItemRow) => (!amountOk(r.price) ? bi('سعر غير صالح', 'Invalid price') : !qtyOk(r.minQty) ? bi('كمية غير صالحة', 'Invalid quantity') : items.some((x) => x !== r && x.productId === r.productId && Number(x.minQty) === Number(r.minQty)) ? bi('مكرر', 'Duplicate') : null);
  const itemsInvalid = items.some((r) => rowErr(r));
  const itemsDirty = JSON.stringify(items) !== itemsBase;

  const saveHead = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (dateErr || !head.name.trim()) return;
    setBusy('head'); setError(null);
    try {
      await api.put(`/price-lists/${id}`, { name: head.name.trim(), currency: head.currency.trim().toUpperCase() || 'SAR', validFrom: head.validFrom || null, validTo: head.validTo || null, segment: head.segment || null, isDefault: head.isDefault });
      toast.success(bi('تم حفظ بيانات القائمة', 'List details saved'));
      qc.invalidateQueries({ queryKey: ['price-list', id] });
      qc.invalidateQueries({ queryKey: ['price-lists'] });
    } catch (err) { setError(err); } finally { setBusy(null); }
  };

  const saveItems = async () => {
    if (itemsInvalid) return;
    setBusy('items'); setError(null);
    try {
      await api.put(`/price-lists/${id}/items`, items.map((r) => ({ productId: r.productId, price: r.price.trim(), minQty: r.minQty.trim() })));
      toast.success(bi(`تم حفظ الأسعار (${items.length} صنف)`, `Prices saved (${items.length} items)`));
      setItemsBase(JSON.stringify(items));
      qc.invalidateQueries({ queryKey: ['price-list', id] });
      qc.invalidateQueries({ queryKey: ['price-lists'] });
      qc.invalidateQueries({ queryKey: ['price-resolve'] });
    } catch (err) { setError(err); } finally { setBusy(null); }
  };

  const archive = async () => {
    setBusy('archive'); setError(null);
    try {
      await api.del(`/price-lists/${id}`);
      toast.success(bi('أُرشفت القائمة', 'List archived'));
      qc.invalidateQueries({ queryKey: ['price-lists'] });
      router.push('/products/price-lists');
    } catch (err) { setError(err); } finally { setBusy(null); }
  };

  const addProduct = (p: Product) => {
    setItems((x) => [...x, { key: rowKey(), productId: p.id, code: p.code, nameAr: p.nameAr, listPrice: p.listPrice, price: String(Number(p.listPrice)), minQty: '1' }]);
    setSearch('');
  };
  const patch = (i: number, v: Partial<ItemRow>) => setItems((x) => x.map((r, j) => (j === i ? { ...r, ...v } : r)));

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title={bi('قائمة الأسعار', 'Price list')} back="/products/price-lists" /><ErrorBox error={q.error} /></>;
  const d = q.data;
  const readOnly = !canWrite || !!d.archivedAt;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{d.name}{d.isDefault && <Badge tone="gold">{bi('افتراضية للشريحة', 'Segment default')}</Badge>}{d.archivedAt ? <Badge tone="red">{bi('مؤرشفة', 'Archived')}</Badge> : d.active ? <Badge tone="green">{bi('سارية', 'Active')}</Badge> : <Badge>{bi('غير سارية اليوم', 'Not active today')}</Badge>}</span>}
        subtitle={bi('تُطبَّق أسعار القائمة على البنود الجديدة لعملائها؛ يبقى سعر الكتالوج ظاهرًا كسعر القائمة المشطوب', 'The list’s prices apply to new lines for its customers; the catalog price stays visible as the struck-through list price')}
        back="/products/price-lists"
        actions={!readOnly && <Button variant="outline" icon={<Archive className="size-4" />} onClick={() => setConfirmArchive(true)}>{bi('أرشفة', 'Archive')}</Button>}
      />
      <ErrorBox error={error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <form onSubmit={saveHead} className="lg:col-span-1">
          <fieldset disabled={readOnly}>
            <Card title={bi('بيانات القائمة', 'List details')}>
              <div className="space-y-3">
                <Field label={bi('الاسم *', 'Name *')}><Input required value={head.name} onChange={(e) => setHead((h) => ({ ...h, name: e.target.value }))} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={bi('العملة', 'Currency')}><Input dir="ltr" maxLength={3} value={head.currency} onChange={(e) => setHead((h) => ({ ...h, currency: e.target.value }))} /></Field>
                  <Field label={bi('الشريحة', 'Segment')}>
                    <Select value={head.segment} onChange={(e) => setHead((h) => ({ ...h, segment: e.target.value }))}>
                      <option value="">—</option>
                      {SEGMENTS.map((s) => <option key={s} value={s}>{seg(s)}</option>)}
                    </Select>
                  </Field>
                  <Field label={bi('سارية من', 'Valid from')}><Input type="date" value={head.validFrom} onChange={(e) => setHead((h) => ({ ...h, validFrom: e.target.value }))} /></Field>
                  <Field label={bi('سارية حتى', 'Valid until')} error={dateErr}><Input type="date" value={head.validTo} onChange={(e) => setHead((h) => ({ ...h, validTo: e.target.value }))} /></Field>
                </div>
                <Checkbox label={bi('افتراضية لعملاء الشريحة (بدون قائمة خاصة)', 'Default for the segment’s customers (without their own list)')} checked={head.isDefault} onChange={(v) => setHead((h) => ({ ...h, isDefault: v }))} />
                {head.isDefault && !head.segment && <p className="text-xs text-amber-800">{bi('اختر شريحة لتُطبَّق القائمة الافتراضية على عملائها.', 'Choose a segment so the default list applies to its customers.')}</p>}
                {!readOnly && <Button className="w-full" loading={busy === 'head'} disabled={!!dateErr || !head.name.trim()} icon={<Save className="size-4" />}>{bi('حفظ البيانات', 'Save details')}</Button>}
              </div>
            </Card>
          </fieldset>
        </form>

        <Card
          className="lg:col-span-2"
          padded={false}
          title={<span className="flex items-center gap-2">{bi('الأصناف والأسعار', 'Items & prices')} <span className="rounded-full bg-tint px-2 text-[11px] text-gold-dark">{items.length}</span></span>}
          actions={!readOnly && <Button size="sm" icon={<Save className="size-3.5" />} loading={busy === 'items'} disabled={!itemsDirty || itemsInvalid} onClick={saveItems}>{bi('حفظ الأسعار', 'Save prices')}</Button>}
        >
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">{bi('لا توجد أصناف في القائمة — ابحث عن صنف بالأسفل لإضافة سعره الخاص.', 'No items in the list — search for an item below to add its special price.')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-tint/60 text-xs text-gold-dark">
                  <tr>
                    <th className="px-3 py-2 text-start">{bi('الصنف', 'Item')}</th>
                    <th className="px-2 py-2 text-start">{bi('سعر الكتالوج', 'Catalog price')}</th>
                    <th className="w-32 px-2 py-2 text-start">{bi('سعر القائمة', 'List price')}</th>
                    <th className="w-24 px-2 py-2 text-start">{bi('من كمية', 'From qty')}</th>
                    <th className="px-2 py-2 text-start">{bi('الخصم', 'Discount')}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => {
                    const err = rowErr(r);
                    const disc = Number(r.listPrice) > 0 && amountOk(r.price) ? ((Number(r.listPrice) - Number(r.price)) / Number(r.listPrice)) * 100 : null;
                    return (
                      <tr key={r.key} className="border-t border-line/70 align-top">
                        <td className="px-3 py-2"><span className="num font-bold text-primary" dir="ltr">{r.code}</span><div className="text-xs text-muted">{r.nameAr}</div>{err && <div className="text-[11px] font-bold text-danger">{err}</div>}</td>
                        <td className="px-2 py-2"><Money value={r.listPrice} /></td>
                        <td className="px-2 py-2"><Input dir="ltr" inputMode="decimal" disabled={readOnly} value={r.price} onChange={(e) => patch(i, { price: e.target.value })} aria-label={bi('سعر القائمة', 'List price')} /></td>
                        <td className="px-2 py-2"><Input dir="ltr" inputMode="decimal" disabled={readOnly} value={r.minQty} onChange={(e) => patch(i, { minQty: e.target.value })} aria-label={bi('من كمية', 'From qty')} className="text-center" /></td>
                        <td className="num px-2 py-2 pt-3 text-xs">{disc === null ? '—' : <span className={disc < 0 ? 'text-danger' : 'text-ok'}>{num(disc, 1)}%</span>}</td>
                        <td className="px-2 py-2">{!readOnly && <button type="button" onClick={() => setItems((x) => x.filter((_, j) => j !== i))} className="rounded p-1 text-danger hover:bg-rose-50" aria-label={bi('حذف', 'Delete')}><Trash2 className="size-4" /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!readOnly && (
            <div className="border-t border-line p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={bi('ابحث عن صنف لإضافته إلى القائمة…', 'Search for an item to add to the list…')} className="ps-9" />
              </div>
              {term && (
                <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-line">
                  {found.isLoading ? <Spinner /> : !(found.data?.rows.length) ? <div className="p-3 text-center text-xs text-muted">{bi('لا توجد أصناف مطابقة', 'No matching items')}</div> : (
                    <ul className="divide-y divide-line/70">
                      {found.data.rows.map((p) => (
                        <li key={p.id}>
                          <button type="button" onClick={() => addProduct(p)} className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-tint/60">
                            <Plus className="size-4 text-primary" />
                            <span className="num font-bold text-primary" dir="ltr">{p.code}</span>
                            <span className="min-w-0 flex-1 truncate text-xs">{p.nameAr}</span>
                            {items.some((x) => x.productId === p.id) && <Badge>{bi('في القائمة', 'In list')}</Badge>}
                            <Money value={p.listPrice} className="text-xs" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <p className="mt-2 text-[11px] text-muted">{bi('«من كمية» لأسعار الكميات: يُطبَّق السعر عند طلب هذه الكمية أو أكثر. يمكن إضافة الصنف أكثر من مرة بكميات مختلفة.', '“From qty” is for volume pricing: the price applies when this quantity or more is ordered. An item can be added more than once with different quantities.')}</p>
            </div>
          )}
        </Card>
      </div>
      <Dialog open={confirmArchive} onClose={() => setConfirmArchive(false)} title={bi('أرشفة قائمة الأسعار', 'Archive price list')} footer={<>
        <Button variant="outline" onClick={() => setConfirmArchive(false)}>{bi('إلغاء', 'Cancel')}</Button>
        <Button variant="danger" loading={busy === 'archive'} onClick={archive}>{bi('أرشفة', 'Archive')}</Button>
      </>}>
        <p className="text-sm">{bi('لن تُطبَّق القائمة على العروض الجديدة. العروض السابقة تبقى بأسعارها.', 'The list will not apply to new quotations. Earlier quotations keep their prices.')}</p>
      </Dialog>
    </>
  );
}
