'use client';
import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Check, Package, Plus, Search, Tags, Wrench } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { clsx, ErrorBox, Input, Money, Spinner } from '@/components/ui';
import type { Product, ResolvedPrices } from './types';

/**
 * Searchable product catalog: click a product to add it; products already in the quote show ✓.
 * With a customer on a price list, the customer's price shows next to the list price and is passed to `onAdd`.
 * Packages (kits) carry a «باقة» badge.
 */
export function CatalogPanel({ addedIds, addedCodes, onAdd, onAddIns, insAvailable, className, partyId }: { addedIds: Set<string>; addedCodes: Set<string>; onAdd: (p: Product, customerPrice?: string) => void; onAddIns?: () => void; insAvailable?: boolean; className?: string; partyId?: string | null }) {
  const { can } = useMe();
  const { bi } = useI18n();
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  const res = useQuery({
    queryKey: ['products-pick', term],
    queryFn: () => api.get<{ rows: Product[]; total: number }>(`/products${qs({ q: term, limit: 100 })}`),
    staleTime: 60_000,
  });
  const rows = res.data?.rows ?? [];
  const ids = rows.map((p) => p.id).join(',');
  const priced = useQuery({
    queryKey: ['price-resolve', partyId, ids],
    queryFn: () => api.get<ResolvedPrices>(`/price-lists/resolve${qs({ partyId, productIds: ids })}`),
    enabled: !!partyId && !!ids && can('product.read'),
    staleTime: 60_000,
  });
  const prices = priced.data?.priceList ? priced.data.prices : {};
  return (
    <div className={clsx('flex min-h-0 flex-col', className)}>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={bi('ابحث بالموديل أو الوصف…', 'Search by model or description…')} className="ps-9" />
      </div>
      {onAddIns && insAvailable && (
        <button type="button" onClick={onAddIns} className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-gold/60 bg-tint/40 px-3 py-2 text-start text-xs font-bold text-gold-dark hover:bg-tint">
          <Wrench className="size-4" /> {bi('إعادة صف التركيب والبرمجة', 'Restore the installation & programming line')}
        </button>
      )}
      {priced.data?.priceList && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-primary-50/70 px-3 py-1.5 text-[11px] font-bold text-primary">
          <Tags className="size-3.5" />{bi(`أسعار العميل حسب قائمة «${priced.data.priceList.name}»`, `Customer prices per price list “${priced.data.priceList.name}”`)}
        </div>
      )}
      <ErrorBox error={res.error} />
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line">
        {res.isLoading ? <Spinner /> : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 p-6 text-center text-sm text-muted"><Package className="size-6 text-gold" />{bi('لا توجد منتجات مطابقة', 'No matching products')}</div>
        ) : (
          <ul className="divide-y divide-line/70">
            {rows.map((p) => {
              const added = addedIds.has(p.id) || addedCodes.has(p.code);
              const special = prices[p.id]?.source === 'price_list' ? prices[p.id]!.price : undefined;
              const isKit = p.type === 'kit';
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onAdd(p, special)}
                    className={clsx('flex w-full items-start gap-2 px-3 py-2 text-start transition', added ? 'bg-primary-50/60' : 'hover:bg-tint/70')}
                    title={added ? bi('موجود في العرض', 'Already in the quote') : isKit ? bi('إضافة الباقة (مفصّلة أو كبند واحد)', 'Add the package (itemized or as one line)') : bi('إضافة إلى العرض', 'Add to the quote')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="num truncate text-xs font-extrabold text-primary" dir="ltr">{p.code}</span>
                          {isKit && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gold/15 px-1.5 text-[10px] font-extrabold text-gold-dark"><Boxes className="size-3" />{bi('باقة', 'Package')}</span>}
                        </span>
                        {special !== undefined ? (
                          <span className="flex flex-col items-end leading-tight" title={bi('سعر العميل حسب قائمة الأسعار', 'Customer price per price list')}>
                            <Money value={special} className="text-xs font-extrabold text-primary" />
                            {Number(special) !== Number(p.listPrice) && <Money value={p.listPrice} className="text-[10px] text-muted line-through" />}
                          </span>
                        ) : Number(p.listPrice) > 0 ? <Money value={p.listPrice} className="text-xs font-bold" /> : <span className="text-xs text-muted">—</span>}
                      </div>
                      <div className="line-clamp-2 text-xs leading-relaxed text-ink/80">{p.description || p.nameAr}</div>
                    </div>
                    <span className={clsx('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full', added ? 'bg-primary text-white' : 'border border-line text-primary')}>
                      {added ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {res.data && res.data.total > rows.length && <p className="mt-1 text-[11px] text-muted">{bi(`يظهر ${rows.length} من ${res.data.total} — حدّد البحث لعرض المزيد`, `Showing ${rows.length} of ${res.data.total} — refine the search to see more`)}</p>}
    </div>
  );
}
