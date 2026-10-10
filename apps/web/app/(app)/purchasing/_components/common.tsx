'use client';
import type { ReactNode } from 'react';
import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { clsx, Money } from '@/components/ui';

/** value → [Arabic, English, chip classes] */
export type L = Record<string, [string, string, string?]>;

export const PO_STATUS: L = {
  draft: ['مسودة', 'Draft', 'bg-gray-100 text-gray-700'],
  pending_approval: ['بانتظار الموافقة', 'Pending approval', 'bg-amber-100 text-amber-800'],
  approved: ['معتمد', 'Approved', 'bg-sky-100 text-sky-800'],
  sent: ['مُرسل للمورد', 'Sent to supplier', 'bg-indigo-100 text-indigo-800'],
  partially_received: ['مستلم جزئيًا', 'Partially received', 'bg-amber-100 text-amber-800'],
  received: ['مستلم بالكامل', 'Received', 'bg-emerald-100 text-emerald-800'],
  closed: ['مغلق', 'Closed', 'bg-gray-200 text-gray-600'],
  cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-500'],
};

export const MR_STATUS: L = {
  draft: ['مسودة', 'Draft', 'bg-gray-100 text-gray-700'],
  approved: ['معتمد', 'Approved', 'bg-sky-100 text-sky-800'],
  ordered: ['تم الطلب', 'Ordered', 'bg-indigo-100 text-indigo-800'],
  closed: ['مغلق', 'Closed', 'bg-gray-200 text-gray-600'],
  cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-500'],
};

export const RFQ_STATUS: L = {
  draft: ['مسودة', 'Draft', 'bg-gray-100 text-gray-700'],
  sent: ['مُرسل للموردين', 'Sent to suppliers', 'bg-indigo-100 text-indigo-800'],
  closed: ['تمت الترسية', 'Awarded', 'bg-emerald-100 text-emerald-800'],
  cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-500'],
};

export const SHIP_STATUS: L = {
  ordered: ['مطلوبة', 'Ordered', 'bg-gray-100 text-gray-700'],
  shipped: ['تم الشحن', 'Shipped', 'bg-indigo-100 text-indigo-800'],
  arrived: ['وصلت الميناء', 'Arrived', 'bg-violet-100 text-violet-800'],
  clearing: ['قيد التخليص', 'Clearing', 'bg-amber-100 text-amber-800'],
  released: ['مفسوحة', 'Released', 'bg-sky-100 text-sky-800'],
  received: ['مستلمة', 'Received', 'bg-emerald-100 text-emerald-800'],
};

export const SHIP_MODE: L = {
  sea: ['بحري', 'Sea'],
  air: ['جوي', 'Air'],
  land: ['بري', 'Land'],
  courier: ['شحن سريع', 'Courier'],
};

export const MATCH_STATUS: L = {
  matched: ['مطابقة', 'Matched', 'bg-emerald-100 text-emerald-800'],
  exception: ['استثناء', 'Exception', 'bg-rose-100 text-rose-800'],
  direct: ['مباشرة', 'Direct', 'bg-violet-100 text-violet-800'],
};

export const BILL_STATUS: L = {
  draft: ['مسودة', 'Draft', 'bg-gray-100 text-gray-700'],
  approved: ['غير مدفوعة', 'Unpaid', 'bg-sky-100 text-sky-800'],
  partially_paid: ['مدفوعة جزئيًا', 'Partly paid', 'bg-amber-100 text-amber-800'],
  paid: ['مدفوعة', 'Paid', 'bg-emerald-100 text-emerald-800'],
  cancelled: ['ملغاة', 'Cancelled', 'bg-rose-100 text-rose-800'],
};

export const PAYMENT_METHOD: L = {
  bank_transfer: ['تحويل بنكي', 'Bank transfer'],
  cash: ['نقدًا', 'Cash'],
  cheque: ['شيك', 'Cheque'],
  card: ['بطاقة', 'Card'],
  other: ['أخرى', 'Other'],
};

export const AGING_BUCKETS = [
  ['current', 'لم يحن موعدها', 'Not due'],
  ['1_30', '1–30 يومًا', '1–30 days'],
  ['31_60', '31–60 يومًا', '31–60 days'],
  ['61_90', '61–90 يومًا', '61–90 days'],
  ['90_plus', 'أكثر من 90', '90+ days'],
] as const;

export const RESERVATION_STATUS: L = {
  active: ['محجوز', 'Reserved', 'bg-sky-100 text-sky-800'],
  released: ['محرر', 'Released', 'bg-gray-200 text-gray-600'],
  consumed: ['مستهلك', 'Consumed', 'bg-emerald-100 text-emerald-800'],
};

export const APPROVER_ROLE: L = {
  purchaser: ['مسؤول المشتريات', 'Purchaser', 'bg-sky-100 text-sky-800'],
  general_manager: ['المدير العام', 'General manager', 'bg-violet-100 text-violet-800'],
  owner: ['المالك', 'Owner', 'bg-amber-100 text-amber-800'],
};

export const LANDED_BASIS: L = {
  value: ['حسب القيمة', 'By value'],
  qty: ['حسب الكمية', 'By quantity'],
  weight: ['حسب الوزن', 'By weight'],
  volume: ['حسب الحجم', 'By volume'],
};

export const CURRENCIES = ['USD', 'CNY', 'SAR', 'AED', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Default SAR rate per currency (USD pegged at 3.75); others must be typed. */
export function defaultRate(currency: string): string {
  return currency === 'SAR' ? '1' : currency === 'USD' ? '3.75' : '';
}

/** Localised label for a value of one of the maps above. */
export function useLabel() {
  const { locale } = useI18n();
  return (map: L, v: string | null | undefined) => {
    if (!v) return '—';
    const e = map[v];
    return e ? (locale === 'en' ? e[1] : e[0]) : v;
  };
}

export function Chip({ map, value, className, icon }: { map: L; value: string | null | undefined; className?: string; icon?: ReactNode }) {
  const label = useLabel();
  if (!value) return <span className="text-muted">—</span>;
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', map[value]?.[2] ?? 'bg-gray-100 text-gray-700', className)}>{icon}{label(map, value)}</span>;
}

export const PoStatusBadge = ({ status }: { status: string }) => <Chip map={PO_STATUS} value={status} />;
export const MrStatusBadge = ({ status }: { status: string }) => <Chip map={MR_STATUS} value={status} />;
export const ShipStatusBadge = ({ status }: { status: string }) => <Chip map={SHIP_STATUS} value={status} />;

/** Toggle-chip class (status filters). */
export const chipCls = (on: boolean) => clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', on ? 'border-gold bg-tint text-primary' : 'border-line text-muted hover:bg-tint/60');

/** LTR text (codes, serials, numbers). */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  if (children === null || children === undefined || children === '') return <span className="text-muted">—</span>;
  return <span dir="ltr" className={clsx('num', className)}>{children}</span>;
}

/** Definition-list row. */
export function Info({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 py-1.5 text-sm last:border-0">
      <span className="text-xs font-bold text-muted">{label}</span>
      <span className="text-end">{children}</span>
    </div>
  );
}

/** Quantity without trailing zeros ("12.500" → "12.5"). */
export function qty(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 3 }) : String(v);
}

/** Plain number with fixed decimals (foreign-currency amounts). */
export function num(v: string | number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) }) : String(v);
}

/** Round to at most `d` decimals and return a plain string (API money/qty fields). */
export function fixed(v: number, d = 2): string {
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 10 ** d) / 10 ** d);
}

/**
 * Amount in a currency (units, not halalas): SAR goes through <Money>; any other currency shows the number + its code
 * (Money always prints "ر.س"). `null` = hidden cost (no purchase.cost.read).
 */
export function Amount({ value, currency, className }: { value: string | number | null | undefined; currency: string | null | undefined; className?: string }) {
  const { bi } = useI18n();
  if (value === null || value === undefined) return <span className="text-xs text-muted" title={bi('يتطلب صلاحية عرض التكلفة', 'Needs the cost permission')}>—</span>;
  // numbers here are currency units (not halalas) — Money reads a number as halalas, so pass a string
  if (!currency || currency === 'SAR') return <Money value={typeof value === 'number' ? fixed(value) : value} fixed className={className} />;
  return <span dir="ltr" className={clsx('num whitespace-nowrap', className)}>{num(value)}<span className="ms-1 text-[0.8em] text-muted">{currency}</span></span>;
}

export interface ComplianceStatus { ok: boolean; issues: { key: string; level: 'block' | 'warn'; ar: string; en: string }[] }

/** SABER / CST status of a PO line's product. */
export function ComplianceBadge({ compliance }: { compliance: ComplianceStatus | null | undefined }) {
  const { bi, locale } = useI18n();
  if (!compliance) return <span className="text-xs text-muted">—</span>;
  const title = compliance.issues.map((i) => (locale === 'en' ? i.en : i.ar)).join('\n');
  if (!compliance.ok) return <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800"><ShieldAlert className="size-3" />{bi('شهادات ناقصة', 'Certificates missing')}</span>;
  if (compliance.issues.length) return <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"><AlertTriangle className="size-3" />{bi('تنتهي قريبًا', 'Expiring soon')}</span>;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800"><ShieldCheck className="size-3" />{bi('مطابق', 'Compliant')}</span>;
}

/** Amber box with a list of ar/en messages. */
export function WarningList({ title, items, tone = 'amber', className }: { title: ReactNode; items: { ar: string; en: string }[]; tone?: 'amber' | 'red'; className?: string }) {
  const { locale } = useI18n();
  if (!items.length) return null;
  return (
    <div className={clsx('rounded-xl border px-4 py-3', tone === 'red' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900', className)}>
      <div className="mb-1 flex items-center gap-2 text-sm font-extrabold"><AlertTriangle className="size-4" />{title}</div>
      <ul className="list-disc space-y-0.5 ps-5 text-xs leading-relaxed">
        {items.map((w, i) => <li key={i}>{locale === 'en' ? w.en : w.ar}</li>)}
      </ul>
    </div>
  );
}
