'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { clsx, Input } from './ui';
import { useI18n } from '@/lib/i18n';

export interface PickedParty { id: string; nameAr: string; nameEn: string | null; phone: string | null; email: string | null; vatNumber: string | null }

/** Searchable customer picker (Arabic-normalised server search). */
export function PartyPicker({ value, onChange, placeholder }: { value: PickedParty | null; onChange: (p: PickedParty | null) => void; placeholder?: string }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const res = useQuery({ queryKey: ['party-pick', q], queryFn: () => api.get<{ rows: PickedParty[] }>(`/parties${qs({ q, limit: 12, role: 'customer' })}`), enabled: open });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-tint/50 px-3 py-2 text-sm">
        <span className="flex items-center gap-2 font-bold"><Building2 className="size-4 text-gold" />{locale === 'en' ? value.nameEn || value.nameAr : value.nameAr}</span>
        <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 text-muted hover:bg-black/5" aria-label={t('common.remove')}><X className="size-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative" ref={box}>
      <Input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder ?? t('partyPicker.placeholder')} />
      {open && (
        <div className="absolute inset-x-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-white shadow-lg">
          {(res.data?.rows ?? []).length === 0 ? <p className="p-3 text-sm text-muted">{res.isLoading ? t('common.searching') : t('common.noResults')}</p> : res.data!.rows.map((p) => (
            <button type="button" key={p.id} onClick={() => { onChange(p); setOpen(false); setQ(''); }} className={clsx('block w-full px-3 py-2 text-start text-sm hover:bg-tint')}>
              <b>{locale === 'en' ? p.nameEn || p.nameAr : p.nameAr}</b> <span className="num text-xs text-muted">{p.phone ?? ''} {p.vatNumber ?? ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
