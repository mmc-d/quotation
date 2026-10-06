'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, X } from 'lucide-react';
import { money } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export { clsx };

type Variant = 'primary' | 'gold' | 'outline' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-600 shadow-sm',
  gold: 'bg-gold text-white hover:bg-gold-dark shadow-sm',
  outline: 'border border-line bg-white text-ink hover:bg-tint',
  ghost: 'text-ink hover:bg-black/5',
  danger: 'bg-danger text-white hover:opacity-90',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button ref={ref} disabled={disabled || loading} className={clsx('inline-flex items-center justify-center gap-1.5 rounded-lg font-bold transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm', VARIANTS[variant], className)} {...rest}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

export function LinkButton({ href, variant = 'outline', size = 'md', icon, children, className }: { href: string; variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={clsx('inline-flex items-center justify-center gap-1.5 rounded-lg font-bold transition whitespace-nowrap', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm', VARIANTS[variant], className)}>
      {icon}
      {children}
    </Link>
  );
}

const field = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:bg-gray-50 disabled:text-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(field, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(field, 'leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={clsx(field, 'pe-8', className)} {...rest}>{children}</select>;
});

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-bold text-gold-dark">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={clsx('inline-flex items-center gap-2 text-sm', disabled && 'opacity-60')}>
      <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('rounded-[var(--radius-card)] border border-line bg-white shadow-[0_1px_2px_rgba(0,0,0,.04)]', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-extrabold text-primary">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  const { t } = useI18n();
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && <Link href={back} className="mb-1 inline-block text-xs font-bold text-gold-dark hover:underline">{t('common.back')}</Link>}
        <h1 className="text-2xl font-extrabold text-primary">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Status → [Arabic fallback label, chip classes]. Labels are translated via `status.*` in lib/i18n.tsx. */
const STATUS: Record<string, [string, string]> = {
  draft: ['مسودة', 'bg-gray-100 text-gray-700'],
  pending_approval: ['بانتظار الموافقة', 'bg-amber-100 text-amber-800'],
  approved: ['معتمد', 'bg-sky-100 text-sky-800'],
  sent: ['مُرسل', 'bg-indigo-100 text-indigo-800'],
  viewed: ['تمت المشاهدة', 'bg-violet-100 text-violet-800'],
  accepted: ['مقبول', 'bg-emerald-100 text-emerald-800'],
  rejected: ['مرفوض', 'bg-rose-100 text-rose-800'],
  expired: ['منتهي', 'bg-gray-200 text-gray-600'],
  lost: ['خسارة', 'bg-rose-100 text-rose-800'],
  superseded: ['مُستبدل بنسخة أحدث', 'bg-gray-100 text-gray-500'],
  sent_for_signature: ['بانتظار التوقيع', 'bg-amber-100 text-amber-800'],
  signed: ['موقّع', 'bg-emerald-100 text-emerald-800'],
  active: ['ساري', 'bg-emerald-100 text-emerald-800'],
  completed: ['مكتمل', 'bg-primary-50 text-primary'],
  terminated: ['منتهٍ', 'bg-rose-100 text-rose-800'],
  cancelled: ['ملغى', 'bg-gray-200 text-gray-600'],
  pending: ['قادم', 'bg-gray-100 text-gray-700'],
  requested: ['مطلوب', 'bg-indigo-100 text-indigo-800'],
  invoiced: ['مفوتر', 'bg-sky-100 text-sky-800'],
  partially_paid: ['مدفوع جزئيًا', 'bg-amber-100 text-amber-800'],
  paid: ['مدفوع', 'bg-emerald-100 text-emerald-800'],
  billed: ['مفوتر', 'bg-sky-100 text-sky-800'],
  issued: ['صادرة', 'bg-sky-100 text-sky-800'],
  new: ['جديد', 'bg-sky-100 text-sky-800'],
  contacted: ['تم التواصل', 'bg-indigo-100 text-indigo-800'],
  qualified: ['مؤهل', 'bg-emerald-100 text-emerald-800'],
  unqualified: ['غير مؤهل', 'bg-gray-200 text-gray-600'],
  converted: ['تم التحويل', 'bg-primary-50 text-primary'],
  invited: ['مدعو', 'bg-amber-100 text-amber-800'],
  suspended: ['موقوف', 'bg-rose-100 text-rose-800'],
  cleared: ['معتمدة من زاتكا', 'bg-emerald-100 text-emerald-800'],
  reported: ['مُبلّغ عنها لزاتكا', 'bg-emerald-100 text-emerald-800'],
  not_applicable: ['غير خاضعة', 'bg-gray-100 text-gray-600'],
  open: ['مفتوحة', 'bg-sky-100 text-sky-800'],
  closed: ['مغلقة', 'bg-gray-200 text-gray-600'],
  legacy: ['مستورد من النظام القديم', 'bg-gray-100 text-gray-600'],
  legacy_phase1: ['المرحلة الأولى (النظام القديم)', 'bg-gray-100 text-gray-600'],
  warning: ['معتمدة مع تحذير', 'bg-amber-100 text-amber-800'],
  error: ['خطأ', 'bg-rose-100 text-rose-800'],
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { tx } = useI18n();
  const known = STATUS[status ?? ''];
  const label = known ? tx(`status.${status}`, known[0]) : status ?? '—';
  const cls = known?.[1] ?? 'bg-gray-100 text-gray-700';
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold', cls)}>{label}</span>;
}

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'gold' | 'green' | 'red' | 'blue' }) {
  const tones = { gray: 'bg-gray-100 text-gray-700', gold: 'bg-tint text-gold-dark', green: 'bg-emerald-100 text-emerald-800', red: 'bg-rose-100 text-rose-800', blue: 'bg-sky-100 text-sky-800' };
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold', tones[tone])}>{children}</span>;
}

/** Saudi Riyal amount. Accepts halalas (number) or the API's NUMERIC string. */
export function Money({ value, fixed, className }: { value: number | string | null | undefined; fixed?: boolean; className?: string }) {
  const { t } = useI18n();
  return <span className={clsx('num whitespace-nowrap', className)}>{money(value, { fixed })}<span className="ms-1 text-[0.8em] text-muted">{t('common.sar')}</span></span>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('overflow-x-auto', className)}><table className="w-full text-sm">{children}</table></div>;
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx('border-b border-line bg-tint/60 px-3 py-2 text-start text-xs font-extrabold text-gold-dark', className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={clsx('border-b border-line/70 px-3 py-2 align-middle', className)}>{children}</td>;
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-gold">{icon}</div>}
      <p className="font-bold text-ink">{title}</p>
      {hint && <p className="max-w-md text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return <div className="flex items-center justify-center gap-2 py-10 text-muted"><Loader2 className="size-5 animate-spin" />{label ?? t('common.loading')}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-danger">{(error as Error).message ?? String(error)}</div>;
}

/** Native <dialog> modal (focus trap, Esc to close). */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t, dir } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} className={clsx('m-auto w-[calc(100%-2rem)] rounded-xl border border-line p-0 shadow-2xl backdrop:bg-black/40', wide ? 'max-w-3xl' : 'max-w-lg')}>
      {open && (
        <div dir={dir}>
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="font-extrabold text-primary">{title}</h3>
            <button onClick={onClose} className="rounded p-1 text-muted hover:bg-black/5" aria-label={t('common.close')}><X className="size-4" /></button>
          </header>
          <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line bg-tint/40 px-4 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {items.map((it) => (
        <button key={it.value} onClick={() => onChange(it.value)} className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-bold transition', value === it.value ? 'border-gold text-primary' : 'border-transparent text-muted hover:text-ink')}>
          {it.label}{it.count !== undefined && <span className="ms-1.5 rounded-full bg-tint px-1.5 text-[11px] text-gold-dark">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'gold' | 'green' | 'red' }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-4">
      <div className="text-xs font-bold text-muted">{label}</div>
      <div className={clsx('mt-1 text-2xl font-extrabold', tone === 'green' ? 'text-ok' : tone === 'red' ? 'text-danger' : tone === 'gold' ? 'text-gold-dark' : 'text-primary')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useI18n();
  return <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t('common.search')} className="max-w-xs" />;
}
