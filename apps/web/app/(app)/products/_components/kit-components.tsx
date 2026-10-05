'use client';
import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Boxes, Plus, Save, Search, Trash2 } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { Badge, Button, Card, Checkbox, ErrorBox, Input, Money, Spinner } from '@/components/ui';
import { num, type Product } from './types';

interface KitRow { id: string; qty: string; optional: boolean; product: Product }
interface EditRow { componentId: string; code: string; nameAr: string; listPrice: string; qty: string; optional: boolean }

const qtyOk = (v: string) => /^\d+(\.\d{1,3})?$/.test(v.trim()) && Number(v) > 0;

/**
 * Package components (CPQ-14), e.g. "Villa intercom package" → products × qty (+ optional ones).
 * Saving components turns the product into a package (type `kit`); in the quote editor a package can be
 * expanded into these lines or added as one line at the package's own price.
 */
export function KitComponentsCard({ product, canWrite }: { product: Product; canWrite: boolean }) {
  const qc = useQueryClient();
  const kit = useQuery({ queryKey: ['kit', product.id], queryFn: () => api.get<KitRow[]>(`/products/${product.id}/kit`) });
  const [rows, setRows] = useState<EditRow[]>([]);
  const [baseline, setBaseline] = useState('[]');
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!kit.data) return;
    const r = kit.data.map((k) => ({ componentId: k.product.id, code: k.product.code, nameAr: k.product.nameAr, listPrice: k.product.listPrice, qty: String(Number(k.qty)), optional: k.optional }));
    setRows(r);
    setBaseline(JSON.stringify(r));
  }, [kit.data]);

  const search = useQuery({
    queryKey: ['products-pick', term],
    queryFn: () => api.get<{ rows: Product[] }>(`/products${qs({ q: term, limit: 20 })}`),
    enabled: term.length > 0,
    staleTime: 60_000,
  });
  const results = (search.data?.rows ?? []).filter((p) => p.id !== product.id && !rows.some((r) => r.componentId === p.id));

  const add = (p: Product) => {
    setRows((x) => [...x, { componentId: p.id, code: p.code, nameAr: p.nameAr, listPrice: p.listPrice, qty: '1', optional: false }]);
    setQ('');
  };
  const patch = (i: number, v: Partial<EditRow>) => setRows((x) => x.map((r, j) => (j === i ? { ...r, ...v } : r)));
  const invalid = rows.some((r) => !qtyOk(r.qty));
  const dirty = JSON.stringify(rows) !== baseline;
  const componentsTotal = rows.filter((r) => !r.optional && qtyOk(r.qty)).reduce((s, r) => s + Number(r.listPrice) * Number(r.qty), 0);

  const save = async () => {
    if (invalid) return;
    setBusy(true); setError(null);
    try {
      await api.put(`/products/${product.id}/kit`, { components: rows.map((r) => ({ componentId: r.componentId, qty: r.qty.trim(), optional: r.optional })) });
      toast.success(rows.length ? 'تم حفظ مكونات الباقة' : 'أُزيلت مكونات الباقة');
      setBaseline(JSON.stringify(rows));
      qc.invalidateQueries({ queryKey: ['kit', product.id] });
      qc.invalidateQueries({ queryKey: ['product', product.id] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products-pick'] });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Card
      title={<span className="flex items-center gap-2"><Boxes className="size-4 text-gold" />مكونات الباقة {product.type === 'kit' && <Badge tone="gold">باقة</Badge>}</span>}
      actions={canWrite && <Button size="sm" icon={<Save className="size-3.5" />} loading={busy} disabled={!dirty || invalid} onClick={save}>حفظ المكونات</Button>}
    >
      <p className="mb-3 text-xs text-muted">أضف الأصناف التي تتكوّن منها الباقة وكمياتها. عند إضافة الباقة لعرض سعر يمكن تفصيلها إلى مكوناتها (كل مكوّن بسعره) أو إضافتها كبند واحد بسعر الباقة. حفظ مكونات لأي منتج يحوّله إلى «باقة».</p>
      {kit.isLoading ? <Spinner /> : (
        <>
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-muted">لا توجد مكونات — هذا المنتج ليس باقة بعد.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-tint/60 text-xs text-gold-dark">
                  <tr><th className="px-3 py-2 text-start">المكوّن</th><th className="px-2 py-2 text-start">سعر القائمة</th><th className="w-24 px-2 py-2 text-start">الكمية</th><th className="px-2 py-2 text-start">اختياري</th><th className="w-10" /></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.componentId} className="border-t border-line/70">
                      <td className="px-3 py-2"><span className="num font-bold text-primary" dir="ltr">{r.code}</span><div className="text-xs text-muted">{r.nameAr}</div></td>
                      <td className="px-2 py-2"><Money value={r.listPrice} /></td>
                      <td className="px-2 py-2"><Input dir="ltr" inputMode="decimal" value={r.qty} disabled={!canWrite} onChange={(e) => patch(i, { qty: e.target.value })} aria-label="الكمية" className={qtyOk(r.qty) ? 'text-center' : 'border-danger text-center'} /></td>
                      <td className="px-2 py-2"><Checkbox label="" checked={r.optional} disabled={!canWrite} onChange={(v) => patch(i, { optional: v })} /></td>
                      <td className="px-2 py-2">{canWrite && <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="rounded p-1 text-danger hover:bg-rose-50" aria-label="حذف"><Trash2 className="size-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-gray-50/70 px-3 py-2 text-xs">
                <span>مجموع المكونات بأسعار القائمة (بدون الاختيارية): <b className="num">{num(componentsTotal)}</b></span>
                <span>سعر الباقة: <b className="num">{num(product.listPrice)}</b>{componentsTotal > 0 && Number(product.listPrice) > 0 && <span className="text-muted"> · فرق <span className="num">{num(componentsTotal - Number(product.listPrice))}</span></span>}</span>
              </div>
            </div>
          )}
          {canWrite && (
            <div className="mt-3">
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن صنف لإضافته إلى الباقة…" className="ps-9" />
              </div>
              {term && (
                <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-line">
                  {search.isLoading ? <Spinner /> : results.length === 0 ? <div className="p-3 text-center text-xs text-muted">لا توجد أصناف مطابقة</div> : (
                    <ul className="divide-y divide-line/70">
                      {results.map((p) => (
                        <li key={p.id}>
                          <button type="button" onClick={() => add(p)} className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-tint/60">
                            <Plus className="size-4 text-primary" />
                            <span className="num font-bold text-primary" dir="ltr">{p.code}</span>
                            <span className="min-w-0 flex-1 truncate text-xs">{p.nameAr}</span>
                            <Money value={p.listPrice} className="text-xs" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          <ErrorBox error={error ?? kit.error} />
        </>
      )}
    </Card>
  );
}
