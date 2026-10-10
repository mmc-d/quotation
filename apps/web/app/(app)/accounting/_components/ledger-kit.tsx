'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { ACCOUNT_TYPE_LABELS, type AccountType } from '@mmc/domain';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { money } from '@/lib/format';
import { Badge, clsx, Input } from '@/components/ui';
import { SearchPicker } from '../../purchasing/_components/pickers';

export interface Account {
  id: string; code: string; nameAr: string; nameEn: string | null; type: AccountType; parentId: string | null; isGroup: boolean; isActive: boolean;
  postingKey: string | null; requiresParty: boolean; description: string | null; version: number; depth: number; balance: string; hasLines: boolean;
}

export const TYPE_TONE: Record<AccountType, 'blue' | 'red' | 'gold' | 'green' | 'gray'> = { asset: 'blue', liability: 'red', equity: 'gold', income: 'green', expense: 'gray' };

export function TypeBadge({ type }: { type: AccountType }) {
  const { locale } = useI18n();
  return <Badge tone={TYPE_TONE[type]}>{locale === 'en' ? ACCOUNT_TYPE_LABELS[type].en : ACCOUNT_TYPE_LABELS[type].ar}</Badge>;
}

/** The whole chart (flat, with roll-up balances). Cached; refetch after changes by invalidating ['ledger-accounts']. */
export function useAccounts() {
  return useQuery({ queryKey: ['ledger-accounts'], queryFn: () => api.get<Account[]>('/accounting/accounts'), staleTime: 30_000 });
}

export const accountName = (a: Pick<Account, 'nameAr' | 'nameEn'>, locale: string) => (locale === 'en' ? a.nameEn || a.nameAr : a.nameAr);

/** A money cell: blank for zero so statements stay readable. SAR, two decimals, no currency suffix (the column says it). */
export function Amt({ v, strong, className }: { v: string | number | null | undefined; strong?: boolean; className?: string }) {
  const zero = v === null || v === undefined || v === '' || Number(v) === 0;
  return <span dir="ltr" className={clsx('num whitespace-nowrap', strong && 'font-extrabold', zero && 'text-muted/40', className)}>{zero ? '—' : money(v, { fixed: true })}</span>;
}

/** Searchable account selector (code or name). `postable` hides group accounts and inactive ones. */
export function AccountPicker({ value, onChange, postable = true, placeholder, className, disabled }: { value: string; onChange: (id: string, a: Account | null) => void; postable?: boolean; placeholder?: string; className?: string; disabled?: boolean }) {
  const { bi, locale } = useI18n();
  const all = useAccounts();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useMemo(() => (all.data ?? []).filter((a) => (!postable || (!a.isGroup && a.isActive))), [all.data, postable]);
  const selected = (all.data ?? []).find((a) => a.id === value) ?? null;
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (term ? list.filter((a) => a.code.startsWith(term) || a.nameAr.toLowerCase().includes(term) || (a.nameEn ?? '').toLowerCase().includes(term) || a.code.includes(term)) : list).slice(0, 60);
  }, [list, q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className={clsx('relative', className)} ref={box}>
      <Input
        value={open ? q : selected ? `${selected.code} — ${accountName(selected, locale)}` : ''}
        disabled={disabled}
        placeholder={placeholder ?? bi('ابحث بالرمز أو الاسم…', 'Search code or name…')}
        onFocus={() => { setQ(''); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {open && (
        <div className="absolute inset-x-0 z-40 mt-1 max-h-72 min-w-[18rem] overflow-y-auto rounded-lg border border-line bg-white shadow-lg">
          {shown.length === 0 ? <p className="p-3 text-sm text-muted">{all.isLoading ? bi('جارٍ التحميل…', 'Loading…') : bi('لا توجد نتائج', 'No results')}</p> : shown.map((a) => (
            <button type="button" key={a.id} onClick={() => { onChange(a.id, a); setOpen(false); }} className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-tint', a.id === value && 'bg-tint')} style={{ paddingInlineStart: `${12 + (a.isGroup ? Math.max(0, a.depth - 1) * 10 : 0)}px` }}>
              <span className="num w-12 shrink-0 font-bold text-gold-dark" dir="ltr">{a.code}</span>
              <span className={clsx('min-w-0 flex-1 truncate', a.isGroup && 'font-extrabold')}>{accountName(a, locale)}</span>
              {a.requiresParty && <span className="text-[10px] text-muted">{bi('عميل/مورد', 'party')}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface PickedAnyParty { id: string; nameAr: string; nameEn: string | null; phone: string | null; vatNumber: string | null }

/** Customer or supplier (any party). */
export function AnyPartyPicker({ value, onChange, placeholder, disabled }: { value: PickedAnyParty | null; onChange: (p: PickedAnyParty | null) => void; placeholder?: string; disabled?: boolean }) {
  const { bi, locale } = useI18n();
  const name = (p: PickedAnyParty) => (locale === 'en' ? p.nameEn || p.nameAr : p.nameAr);
  return (
    <SearchPicker<PickedAnyParty>
      value={value} onChange={onChange} disabled={disabled}
      placeholder={placeholder ?? bi('ابحث عن عميل أو مورد…', 'Search customer or supplier…')}
      queryKey="party-any-pick"
      fetcher={(q) => api.get<{ rows: PickedAnyParty[] }>(`/parties${qs({ q, limit: 12 })}`).then((r) => r.rows)}
      icon={<Building2 className="size-4 shrink-0 text-gold" />}
      chip={name}
      render={(p) => <><b>{name(p)}</b> <span className="num text-xs text-muted">{p.phone ?? ''}</span></>}
    />
  );
}

export const KIND_LABELS: Record<string, [string, string]> = {
  manual: ['يدوي', 'Manual'], auto: ['تلقائي', 'Automatic'], opening: ['افتتاحي', 'Opening'], reversal: ['عكس قيد', 'Reversal'], closing: ['إقفال', 'Closing'], adjustment: ['تسوية', 'Adjustment'],
};

export function KindBadge({ kind }: { kind: string }) {
  const { locale } = useI18n();
  const l = KIND_LABELS[kind] ?? [kind, kind];
  return <Badge tone={kind === 'reversal' ? 'red' : kind === 'opening' ? 'gold' : kind === 'auto' ? 'blue' : 'gray'}>{locale === 'en' ? l[1] : l[0]}</Badge>;
}

export function EntryStatus({ status, reversed }: { status: string; reversed?: boolean }) {
  const { bi } = useI18n();
  if (reversed) return <Badge tone="red">{bi('معكوس', 'Reversed')}</Badge>;
  return status === 'posted' ? <Badge tone="green">{bi('مُرحَّل', 'Posted')}</Badge> : <Badge tone="gold">{bi('مسودة', 'Draft')}</Badge>;
}

/** Label/value strip used on the dashboard and entry headers. */
export function Strip({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '').map((i, n) => (
        <div key={n}><dt className="text-xs font-bold text-gold-dark">{i.label}</dt><dd className="font-bold">{i.value}</dd></div>
      ))}
    </dl>
  );
}
