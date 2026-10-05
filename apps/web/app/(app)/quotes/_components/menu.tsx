'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from '@/components/ui';

export interface MenuItem { label: ReactNode; icon?: ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean; disabled?: boolean }

/** Small dropdown for secondary actions. */
export function Menu({ label, items, icon }: { label: ReactNode; items: MenuItem[]; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-bold text-ink transition hover:bg-tint">
        {icon}{label}<ChevronDown className={clsx('size-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute end-0 z-30 mt-1 min-w-[13rem] overflow-hidden rounded-xl border border-line bg-white py-1 shadow-xl">
          {visible.map((it, i) => (
            <button key={i} type="button" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-start text-sm font-bold transition disabled:opacity-40', it.danger ? 'text-danger hover:bg-rose-50' : 'text-ink hover:bg-tint')}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
