'use client';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cpu, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clsx, Input } from '@/components/ui';
import type { AssetRow } from './types';

export type PickedAsset = Pick<AssetRow, 'id' | 'code' | 'serial' | 'mac' | 'description' | 'siteId' | 'partyId' | 'locationId' | 'locationPath'>;

/** Search a registered device by code / serial / MAC / IP (optionally within one site or customer). */
export function AssetSearch({ value, onChange, siteId, partyId, placeholder }: { value: PickedAsset | null; onChange: (a: PickedAsset | null) => void; siteId?: string | null; partyId?: string | null; placeholder?: string }) {
  const { bi } = useI18n();
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const res = useQuery({
    queryKey: ['field-asset-pick', term, siteId ?? '', partyId ?? ''],
    queryFn: () => api.get<{ rows: AssetRow[] }>(`/field/assets${qs({ q: term, siteId, partyId: siteId ? undefined : partyId, limit: 12, status: 'active' })}`),
    enabled: open && (term.length >= 2 || !!siteId),
  });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-tint/50 px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <Cpu className="size-4 shrink-0 text-gold" />
          <span dir="ltr" className="num truncate font-bold">{value.code}{value.serial ? ` · ${value.serial}` : ''}</span>
          {value.locationPath && <span dir="ltr" className="num truncate text-xs text-muted">{value.locationPath}</span>}
        </span>
        <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 text-muted hover:bg-black/5" aria-label={bi('إزالة', 'Remove')}><X className="size-4" /></button>
      </div>
    );
  }
  const rows = res.data?.rows ?? [];
  return (
    <div className="relative" ref={box}>
      <Input dir="ltr" className="text-start" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder ?? bi('الرقم التسلسلي، MAC، الكود…', 'Serial, MAC, code…')} />
      {open && (term.length >= 2 || siteId) && (
        <div className="absolute inset-x-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-white shadow-lg">
          {rows.length === 0 ? <p className="p-3 text-sm text-muted">{res.isLoading ? bi('جارٍ البحث…', 'Searching…') : bi('لا نتائج', 'No results')}</p> : rows.map((a) => (
            <button type="button" key={a.id} onClick={() => { onChange(a); setOpen(false); setQ(''); }} className={clsx('block w-full px-3 py-2 text-start text-sm hover:bg-tint')}>
              <span dir="ltr" className="num font-bold">{a.code}{a.serial ? ` · ${a.serial}` : ''}</span>
              <span dir="ltr" className="num ms-2 text-xs text-muted">{[a.mac, a.locationPath].filter(Boolean).join(' · ')}</span>
              {a.description && <div className="truncate text-xs text-muted">{a.description}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
