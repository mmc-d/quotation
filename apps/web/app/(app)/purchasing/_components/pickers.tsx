'use client';
import { useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, FolderKanban, Package, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clsx, Input, Select } from '@/components/ui';
import type { Warehouse } from './types';

export interface PickedSupplier { id: string; nameAr: string; nameEn: string | null; phone: string | null; email: string | null; vatNumber: string | null }
export interface PickedProduct { id: string; code: string; nameAr: string; nameEn: string | null; serialTracked?: boolean; costPrice?: string | null; costCurrency?: string; uom?: string }
export interface PickedProject { id: string; number: string; name: string; customerName?: string | null; contractId?: string | null }

/** Generic search-as-you-type picker with a dropdown (closes on outside click). */
export function SearchPicker<T extends { id: string }>({ value, onChange, placeholder, queryKey, fetcher, render, chip, icon, disabled }: {
  value: T | null; onChange: (v: T | null) => void; placeholder: string; queryKey: string; fetcher: (q: string) => Promise<T[]>;
  render: (v: T) => ReactNode; chip: (v: T) => ReactNode; icon: ReactNode; disabled?: boolean;
}) {
  const { bi } = useI18n();
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const res = useQuery({ queryKey: [queryKey, term], queryFn: () => fetcher(term), enabled: open, staleTime: 30_000 });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-tint/50 px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2 font-bold">{icon}<span className="truncate">{chip(value)}</span></span>
        {!disabled && <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 text-muted hover:bg-black/5" aria-label={bi('إزالة', 'Remove')}><X className="size-4" /></button>}
      </div>
    );
  }
  const rows = res.data ?? [];
  return (
    <div className="relative" ref={box}>
      <Input value={q} disabled={disabled} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder} />
      {open && (
        <div className="absolute inset-x-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-white shadow-lg">
          {res.error ? <p className="p-3 text-sm text-danger">{(res.error as Error).message}</p>
            : rows.length === 0 ? <p className="p-3 text-sm text-muted">{res.isLoading ? bi('جارٍ البحث…', 'Searching…') : bi('لا توجد نتائج', 'No results')}</p>
            : rows.map((r) => (
              <button type="button" key={r.id} onClick={() => { onChange(r); setOpen(false); setQ(''); }} className="block w-full px-3 py-2 text-start text-sm hover:bg-tint">
                {render(r)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** Supplier picker (parties with the supplier role). */
export function SupplierPicker({ value, onChange, placeholder, disabled }: { value: PickedSupplier | null; onChange: (p: PickedSupplier | null) => void; placeholder?: string; disabled?: boolean }) {
  const { bi, locale } = useI18n();
  const name = (p: PickedSupplier) => (locale === 'en' ? p.nameEn || p.nameAr : p.nameAr);
  return (
    <SearchPicker<PickedSupplier>
      value={value} onChange={onChange} disabled={disabled}
      placeholder={placeholder ?? bi('ابحث عن مورد…', 'Search suppliers…')}
      queryKey="supplier-pick"
      fetcher={(q) => api.get<{ rows: PickedSupplier[] }>(`/parties${qs({ q, limit: 12, role: 'supplier' })}`).then((r) => r.rows)}
      icon={<Building2 className="size-4 shrink-0 text-gold" />}
      chip={name}
      render={(p) => <><b>{name(p)}</b> {p.vatNumber && <span dir="ltr" className="num text-xs text-muted">{p.vatNumber}</span>}</>}
    />
  );
}

/** Product picker (GET /products?q=). */
export function ProductPicker({ value, onChange, placeholder, disabled }: { value: PickedProduct | null; onChange: (p: PickedProduct | null) => void; placeholder?: string; disabled?: boolean }) {
  const { bi, locale } = useI18n();
  const name = (p: PickedProduct) => (locale === 'en' ? p.nameEn || p.nameAr : p.nameAr);
  return (
    <SearchPicker<PickedProduct>
      value={value} onChange={onChange} disabled={disabled}
      placeholder={placeholder ?? bi('ابحث بالكود أو الاسم…', 'Search by code or name…')}
      queryKey="product-pick"
      fetcher={(q) => api.get<{ rows: PickedProduct[] }>(`/products${qs({ q, limit: 15 })}`).then((r) => r.rows)}
      icon={<Package className="size-4 shrink-0 text-gold" />}
      chip={(p) => <><span dir="ltr" className="num">{p.code}</span> <span className="font-normal text-muted">{name(p)}</span></>}
      render={(p) => <><b dir="ltr" className="num">{p.code}</b> <span className="text-xs text-muted">{name(p)}</span></>}
    />
  );
}

/** Project picker (GET /projects?q=). */
export function ProjectPicker({ value, onChange, placeholder, disabled }: { value: PickedProject | null; onChange: (p: PickedProject | null) => void; placeholder?: string; disabled?: boolean }) {
  const { bi } = useI18n();
  return (
    <SearchPicker<PickedProject>
      value={value} onChange={onChange} disabled={disabled}
      placeholder={placeholder ?? bi('ابحث برقم المشروع أو اسمه…', 'Search project number or name…')}
      queryKey="project-pick"
      fetcher={(q) => api.get<{ rows: PickedProject[] }>(`/projects${qs({ q, limit: 15 })}`).then((r) => r.rows)}
      icon={<FolderKanban className="size-4 shrink-0 text-gold" />}
      chip={(p) => <><span dir="ltr" className="num">{p.number}</span> — {p.name}</>}
      render={(p) => <><b dir="ltr" className="num">{p.number}</b> {p.name}{p.customerName && <span className="text-xs text-muted"> · {p.customerName}</span>}</>}
    />
  );
}

export function useWarehouses() {
  return useQuery({ queryKey: ['inv-warehouses'], queryFn: () => api.get<Warehouse[]>('/inventory/warehouses'), staleTime: 60_000 });
}

/** Warehouse select for receiving (no transit warehouses). */
export function WarehouseSelect({ value, onChange, className }: { value: string; onChange: (id: string) => void; className?: string }) {
  const { bi, locale } = useI18n();
  const wh = useWarehouses();
  const rows = (wh.data ?? []).filter((w) => w.kind !== 'transit' && !w.archivedAt);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={clsx(className)}>
      <option value="">{wh.isLoading ? bi('جارٍ التحميل…', 'Loading…') : bi('المستودع الرئيسي (افتراضي)', 'Main store (default)')}</option>
      {rows.map((w) => <option key={w.id} value={w.id}>{w.code} — {locale === 'en' ? w.nameEn || w.nameAr : w.nameAr}</option>)}
    </Select>
  );
}
