'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, ShieldCheck, ShieldOff, Star, Wrench } from 'lucide-react';
import { StatusBadge, clsx } from '@/components/ui';
import { date, dateTime, today } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Coverage, SlaPart } from './portal-api';

/** Status chips for the records a customer sees (tickets, work orders, agreements, visits…). */
const STATUS: Record<string, [string, string, string]> = {
  // tickets
  open: ['مفتوح', 'Open', 'bg-sky-100 text-sky-800'],
  in_progress: ['قيد المعالجة', 'In progress', 'bg-amber-100 text-amber-800'],
  resolved: ['تم الحل', 'Resolved', 'bg-emerald-100 text-emerald-800'],
  closed: ['مغلق', 'Closed', 'bg-gray-200 text-gray-600'],
  // work orders
  new: ['جديد', 'New', 'bg-sky-100 text-sky-800'],
  scheduled: ['مجدول', 'Scheduled', 'bg-indigo-100 text-indigo-800'],
  dispatched: ['تم إسناد الفني', 'Technician assigned', 'bg-indigo-100 text-indigo-800'],
  en_route: ['الفني في الطريق', 'Technician on the way', 'bg-violet-100 text-violet-800'],
  on_site: ['الفني في الموقع', 'Technician on site', 'bg-amber-100 text-amber-800'],
  awaiting_parts: ['بانتظار قطع غيار', 'Awaiting parts', 'bg-amber-100 text-amber-800'],
  completed: ['مكتمل', 'Completed', 'bg-emerald-100 text-emerald-800'],
  cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-600'],
  // agreements / visits / approvals / payment requests
  active: ['ساري', 'Active', 'bg-emerald-100 text-emerald-800'],
  expired: ['منتهي', 'Expired', 'bg-gray-200 text-gray-600'],
  renewed: ['تم التجديد', 'Renewed', 'bg-primary-50 text-primary'],
  draft: ['قيد الإعداد', 'Being prepared', 'bg-gray-100 text-gray-700'],
  planned: ['مخططة', 'Planned', 'bg-gray-100 text-gray-700'],
  generated: ['تم إنشاء أمر العمل', 'Work order created', 'bg-indigo-100 text-indigo-800'],
  sent: ['بانتظار قرارك', 'Awaiting your decision', 'bg-amber-100 text-amber-800'],
  approved: ['معتمد', 'Approved', 'bg-emerald-100 text-emerald-800'],
  rejected: ['مرفوض', 'Rejected', 'bg-rose-100 text-rose-800'],
  partially_paid: ['مدفوع جزئيًا', 'Partially paid', 'bg-amber-100 text-amber-800'],
  paid: ['مدفوع', 'Paid', 'bg-emerald-100 text-emerald-800'],
};

export function PortalStatus({ status, kind }: { status: string | null | undefined; kind?: 'payment' }) {
  const { bi } = useI18n();
  if (kind === 'payment' && status === 'sent') return <Chip className="bg-amber-100 text-amber-800">{bi('بانتظار الدفع', 'Awaiting payment')}</Chip>;
  const s = STATUS[status ?? ''];
  if (!s) return <StatusBadge status={status} />;
  return <Chip className={s[2]}>{bi(s[0], s[1])}</Chip>;
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', className)}>{children}</span>;
}

const COVERAGE: Record<Coverage, [string, string, string]> = {
  warranty: ['ضمن الضمان', 'Under warranty', 'bg-emerald-100 text-emerald-800'],
  amc: ['ضمن عقد الصيانة', 'Covered by maintenance contract', 'bg-sky-100 text-sky-800'],
  project: ['ضمن المشروع', 'Part of the project', 'bg-primary-50 text-primary'],
  chargeable: ['مدفوع', 'Chargeable', 'bg-amber-100 text-amber-900'],
};

/** Coverage "today" (warranty / AMC / project / chargeable) with the reason under it. */
export function CoverageBadge({ coverage, reasonAr, reasonEn, showReason = true }: { coverage: Coverage | null | undefined; reasonAr?: string | null; reasonEn?: string | null; showReason?: boolean }) {
  const { bi, locale } = useI18n();
  if (!coverage) return null;
  const c = COVERAGE[coverage] ?? [coverage, coverage, 'bg-gray-100 text-gray-700'];
  const Icon = coverage === 'chargeable' ? ShieldOff : coverage === 'project' ? Wrench : ShieldCheck;
  const reason = locale === 'en' ? reasonEn || reasonAr : reasonAr;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Chip className={c[2]}><Icon className="size-3" aria-hidden />{bi(c[0], c[1])}</Chip>
      {showReason && reason && <span className="text-[11px] leading-snug text-muted">{reason}</span>}
    </span>
  );
}

/** Warranty end date: green while valid, grey once it has passed. */
export function WarrantyBadge({ label, end }: { label: string; end: string | null | undefined }) {
  const { bi } = useI18n();
  if (!end) return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs"><span className="text-muted">{label}</span><span className="text-muted">—</span></div>
  );
  const valid = end >= today();
  return (
    <div className={clsx('flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs', valid ? 'bg-emerald-50' : 'bg-gray-50')}>
      <span className="font-bold text-ink">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="num font-bold" dir="ltr">{date(end)}</span>
        <Chip className={valid ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}>{valid ? bi('ساري', 'Valid') : bi('منتهي', 'Ended')}</Chip>
      </span>
    </div>
  );
}

export function SlaChip({ label, part }: { label: string; part: SlaPart | null | undefined }) {
  const { bi } = useI18n();
  if (!part) return null;
  const tone = { ok: 'bg-gray-100 text-gray-700', at_risk: 'bg-amber-100 text-amber-800', breached: 'bg-rose-100 text-rose-800', met: 'bg-emerald-100 text-emerald-800' }[part.state];
  const state = { ok: bi('ضمن الوقت', 'On time'), at_risk: bi('قارب الموعد', 'Due soon'), breached: bi('تجاوز الموعد', 'Overdue'), met: bi('تم في الوقت', 'Met') }[part.state];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1.5"><span className="num" dir="ltr">{dateTime(part.due)}</span><Chip className={tone}>{state}</Chip></span>
    </div>
  );
}

export function PageTitle({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode }) {
  const { dir } = useI18n();
  const Back = dir === 'rtl' ? ChevronRight : ChevronLeft;
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && <Link href={back.href} className="mb-1 inline-flex items-center gap-0.5 rounded text-xs font-bold text-gold-dark hover:underline"><Back className="size-3.5" aria-hidden />{back.label}</Link>}
        <h1 className="text-xl font-extrabold text-primary sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Loading() {
  const { bi } = useI18n();
  return <div role="status" className="flex items-center justify-center gap-2 py-16 text-muted"><Loader2 className="size-5 animate-spin" aria-hidden />{bi('جارٍ التحميل…', 'Loading…')}</div>;
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { bi } = useI18n();
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-danger">
      <span className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" aria-hidden />{(error as Error).message || bi('حدث خطأ', 'Something went wrong')}</span>
      {onRetry && <button onClick={onRetry} className="rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-bold hover:bg-rose-100">{bi('إعادة المحاولة', 'Try again')}</button>}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center">
      {icon && <div className="text-gold" aria-hidden>{icon}</div>}
      <p className="font-bold text-ink">{title}</p>
      {hint && <p className="max-w-md text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function Info({ label, value }: { label: ReactNode; value: ReactNode }) {
  return <div className="min-w-0"><dt className="text-[11px] font-bold text-muted">{label}</dt><dd className="mt-0.5 break-words font-bold text-ink">{value}</dd></div>;
}

export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('num', className)} dir="ltr">{children}</span>;
}

/** Read-only star row for a given CSAT score. */
export function Stars({ score }: { score: number | null | undefined }) {
  const { bi } = useI18n();
  if (!score) return null;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={bi(`التقييم ${score} من 5`, `Rated ${score} of 5`)}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={clsx('size-3.5', i <= score ? 'fill-gold text-gold' : 'text-gray-300')} aria-hidden />)}
    </span>
  );
}

/** ZATCA QR: the API's base64 TLV string is the QR content itself. */
export function ZatcaQr({ payload, size = 112, label }: { payload: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(payload, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' }).then((u) => live && setSrc(u)).catch(() => live && setSrc(null));
    return () => { live = false; };
  }, [payload, size]);
  return (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={label} width={size} height={size} /> : <span className="size-full animate-pulse bg-gray-50" />}
    </div>
  );
}

export const sectionTitle = 'mb-3 flex items-center gap-1.5 text-sm font-extrabold text-primary';
export const linkCard = 'block rounded-2xl border border-line bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,.05)] transition hover:border-gold/60 hover:shadow-md focus-visible:border-gold';
