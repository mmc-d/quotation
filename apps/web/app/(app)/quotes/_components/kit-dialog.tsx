'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, ListTree, Package } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Badge, Button, clsx, Dialog, ErrorBox, Field, Money, Spinner } from '@/components/ui';
import { NumInput } from './common';
import { cleanQty, newKey, productUnitCost, trimNum, type EditLine, type KitComponent, type Product, type ResolvedPrices } from './types';

type Mode = 'expand' | 'single';

/** A product → editor line at the customer's price (price list) or the list price. */
export function productLine(p: Product, qty: string, opts: { price?: string; optional?: boolean; sectionKey?: string | null } = {}): EditLine {
  return {
    key: newKey(), productId: p.id, code: p.code, description: p.description || p.nameAr,
    listPrice: trimNum(p.listPrice), unitPrice: trimNum(opts.price ?? p.listPrice), qty, installCost: trimNum(p.installCost),
    unitCost: productUnitCost(p), isOptional: !!opts.optional, manualPrice: false, imageUrl: p.imageUrl, sectionKey: opts.sectionKey ?? null,
  };
}

/**
 * Adding a package (CPQ-14): (a) expand into its component lines — each at its own (customer) price,
 * qty × package qty, optional components as optional lines — or (b) one line at the package's own price.
 */
export function KitDialog({ kit, kitPrice, partyId, sectionKey, onClose, onAdd }: { kit: Product; kitPrice?: string; partyId?: string | null; sectionKey: string | null; onClose: () => void; onAdd: (lines: EditLine[], mode: Mode) => void }) {
  const { can } = useMe();
  const [mode, setMode] = useState<Mode>('expand');
  const [qty, setQty] = useState('1');
  const comps = useQuery({ queryKey: ['kit', kit.id], queryFn: () => api.get<KitComponent[]>(`/products/${kit.id}/kit`), staleTime: 30_000 });
  const ids = (comps.data ?? []).map((c) => c.product.id).join(',');
  const priced = useQuery({
    queryKey: ['price-resolve', partyId, ids],
    queryFn: () => api.get<ResolvedPrices>(`/price-lists/resolve${qs({ partyId, productIds: ids })}`),
    enabled: !!partyId && !!ids && can('product.read'),
    staleTime: 60_000,
  });
  const priceOf = (p: Product) => (priced.data?.priceList && priced.data.prices[p.id]?.source === 'price_list' ? priced.data.prices[p.id]!.price : undefined);
  const k = Number(cleanQty(qty));
  const list = comps.data ?? [];
  const expandedTotal = list.filter((c) => !c.optional).reduce((s, c) => s + Number(priceOf(c.product) ?? c.product.listPrice) * Number(c.qty) * k, 0);
  const canExpand = list.length > 0;
  const effMode: Mode = canExpand ? mode : 'single';

  const confirm = () => {
    const kq = cleanQty(qty);
    if (effMode === 'single') { onAdd([productLine(kit, kq, { price: kitPrice, sectionKey })], 'single'); return; }
    onAdd(list.map((c) => productLine(c.product, trimNum(Number(c.qty) * Number(kq)), { price: priceOf(c.product), optional: c.optional, sectionKey })), 'expand');
  };

  return (
    <Dialog open onClose={onClose} wide title={<span className="flex items-center gap-2"><Boxes className="size-5 text-gold" />إضافة الباقة <span className="num" dir="ltr">{kit.code}</span></span>}
      footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={confirm} disabled={comps.isLoading}>إضافة إلى العرض</Button></>}>
      <p className="mb-3 text-sm text-muted">{kit.description || kit.nameAr}</p>
      <ErrorBox error={comps.error} />
      {comps.isLoading ? <Spinner /> : (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <ModeCard active={effMode === 'expand'} disabled={!canExpand} onClick={() => setMode('expand')} icon={<ListTree className="size-5" />} title="تفصيل المكونات" hint={canExpand ? `${list.length} بند — كل مكوّن بسعره` : 'لا توجد مكونات معرّفة لهذه الباقة'} />
            <ModeCard active={effMode === 'single'} onClick={() => setMode('single')} icon={<Package className="size-5" />} title="بند واحد" hint={<>بسعر الباقة <Money value={kitPrice ?? kit.listPrice} /></>} />
          </div>
          <Field label="عدد الباقات" className="mb-3 max-w-[10rem]"><NumInput value={qty} onChange={setQty} min={0} ariaLabel="عدد الباقات" className="text-center" /></Field>
          {effMode === 'expand' && (
            <div className="rounded-lg border border-line">
              <div className="grid grid-cols-[minmax(0,1fr)_4rem_6.5rem] gap-2 border-b border-line bg-tint/60 px-3 py-1.5 text-[11px] font-extrabold text-gold-dark"><span>المكوّن</span><span className="text-center">الكمية</span><span className="text-end">سعر الوحدة</span></div>
              {list.map((c) => {
                const special = priceOf(c.product);
                return (
                  <div key={c.id} className={clsx('grid grid-cols-[minmax(0,1fr)_4rem_6.5rem] items-center gap-2 border-b border-line/60 px-3 py-1.5 text-xs last:border-b-0', c.optional && 'bg-gray-50 text-muted')}>
                    <span className="min-w-0"><span className="num font-extrabold text-primary" dir="ltr">{c.product.code}</span> {c.optional && <Badge>اختياري</Badge>}<span className="block truncate">{c.product.nameAr}</span></span>
                    <span className="num text-center">{trimNum(Number(c.qty) * k)}</span>
                    <span className="text-end">
                      <Money value={special ?? c.product.listPrice} className={clsx(special !== undefined && 'font-extrabold text-primary')} />
                      {special !== undefined && Number(special) !== Number(c.product.listPrice) && <Money value={c.product.listPrice} className="block text-[10px] text-muted line-through" />}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between bg-tint/40 px-3 py-1.5 text-xs font-bold"><span>إجمالي المكونات (بدون الاختيارية)</span><Money value={Math.round(expandedTotal * 100)} /></div>
            </div>
          )}
          {effMode === 'expand' && <p className="mt-2 text-[11px] text-muted">المكونات الموجودة مسبقًا في العرض تُزاد كميتها بدل تكرارها.</p>}
        </>
      )}
    </Dialog>
  );
}

function ModeCard({ active, disabled, onClick, icon, title, hint }: { active: boolean; disabled?: boolean; onClick: () => void; icon: React.ReactNode; title: string; hint: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={clsx('flex items-start gap-2 rounded-xl border p-3 text-start transition disabled:opacity-40', active ? 'border-primary bg-primary-50/70 ring-1 ring-primary' : 'border-line hover:bg-tint/50')}>
      <span className={clsx('mt-0.5', active ? 'text-primary' : 'text-muted')}>{icon}</span>
      <span><span className="block text-sm font-extrabold">{title}</span><span className="block text-xs text-muted">{hint}</span></span>
    </button>
  );
}
