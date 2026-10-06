'use client';
import { normalizePhone, type WorkOrderStatus, type WorkOrderType } from '@mmc/domain';
import { ApiError } from '@/lib/api';
import { bi as biNow } from '@/lib/i18n';
import { clsx } from '@/components/ui';

/** Row of GET /field/my-day (decorated work order + contact). */
export interface WOItem {
  id: string;
  number: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  title: string;
  coverage: string | null;
  projectId: string | null;
  ticketId: string | null;
  partyId: string | null;
  siteId: string | null;
  locationId: string | null;
  assetId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  checkInAt: string | null;
  completedAt: string | null;
  partyName: string | null;
  siteName: string | null;
  siteCity: string | null;
  navUrl: string | null;
  locationPath: string | null;
  technicianName: string | null;
  crewNames: string[];
  contactName?: string | null;
  contactPhone?: string | null;
  ticketNumber?: string | null;
}

export interface MyDay { date: string; today: WOItem[]; overdue: WOItem[] }

export interface ChecklistItem { key: string; labelAr: string; labelEn: string; required: boolean; done?: boolean; value?: string | null }
export interface Part { code: string; description?: string | null; qty: string; serial?: string | null }
export interface Missing { key: string; ar: string; en: string }
export interface AssetRow { id: string; code: string; description: string | null; serial: string | null; mac: string | null; ip: string | null; firmware: string | null; locationId: string | null; locationPath: string | null }

/** GET /field/work-orders/:id */
export interface WOView extends WOItem {
  description: string | null;
  findings: string | null;
  checklist: ChecklistItem[];
  photos: { fileId: string; filename: string; mime: string; size: number; url: string }[];
  parts: Part[];
  assets: AssetRow[];
  missing: Missing[];
  allowedTransitions: WorkOrderStatus[];
  signatureName: string | null;
  signatureFileId: string | null;
  reportFileId: string | null;
  reportUrl: string | null;
  reportError?: string | null;
  ticket: { id: string; number: string; subject: string; status: string; contactName: string | null; contactPhone: string | null } | null;
  project: { id: string; number: string; name: string } | null;
  site: { id: string; name: string; city: string | null; district: string | null; street: string | null; buildingNumber: string | null; lat: string | null; lng: string | null; mapLink: string | null; accessNotes: string | null } | null;
  party: { id: string; nameAr: string; phone: string | null } | null;
}

/** Statuses in which evidence may still change (mirrors the API's EDITABLE). */
export const EDITABLE: WorkOrderStatus[] = ['new', 'scheduled', 'dispatched', 'en_route', 'on_site', 'awaiting_parts'];

export const TYPE_LABEL: Record<WorkOrderType, [string, string]> = {
  survey: ['معاينة', 'Survey'],
  installation: ['تركيب', 'Installation'],
  commissioning: ['تشغيل واختبار', 'Commissioning'],
  corrective: ['صيانة عطل', 'Corrective'],
  preventive: ['صيانة وقائية', 'Preventive'],
  warranty: ['ضمان', 'Warranty'],
  inspection: ['فحص', 'Inspection'],
};

const STATUS_LABEL: Record<WorkOrderStatus, [string, string, string]> = {
  new: ['جديد', 'New', 'bg-gray-100 text-gray-700'],
  scheduled: ['مجدول', 'Scheduled', 'bg-sky-100 text-sky-800'],
  dispatched: ['مُسند', 'Dispatched', 'bg-indigo-100 text-indigo-800'],
  en_route: ['في الطريق', 'On the way', 'bg-amber-100 text-amber-800'],
  on_site: ['في الموقع', 'On site', 'bg-violet-100 text-violet-800'],
  awaiting_parts: ['بانتظار قطع غيار', 'Awaiting parts', 'bg-orange-100 text-orange-800'],
  completed: ['مكتمل', 'Completed', 'bg-emerald-100 text-emerald-800'],
  closed: ['مغلق', 'Closed', 'bg-gray-200 text-gray-600'],
  cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-600'],
};

export function StatusChip({ status, bi }: { status: WorkOrderStatus; bi: (a: string, e: string) => string }) {
  const s = STATUS_LABEL[status];
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold', s?.[2] ?? 'bg-gray-100 text-gray-700')}>{s ? bi(s[0], s[1]) : status}</span>;
}

/** HH:mm in Riyadh time. */
export function timeOf(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' });
}

export function telHref(phone: string | null | undefined): string | null {
  const p = normalizePhone(phone ?? '');
  return p ? `tel:${p}` : null;
}

export function waHref(phone: string | null | undefined): string | null {
  const p = normalizePhone(phone ?? '');
  return p ? `https://wa.me/${p.replace(/^\+/, '')}` : null;
}

export function mapsHref(wo: { navUrl?: string | null; site?: WOView['site'] }): string | null {
  if (wo.navUrl) return wo.navUrl;
  const s = wo.site;
  if (!s) return null;
  const q = [s.buildingNumber, s.street, s.district, s.city].filter(Boolean).join(' ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return biNow('تعذّر الاتصال — تحقق من الشبكة', 'Connection failed — check the network');
  return (e as Error)?.message ?? String(e);
}

/** Network failure or server error (worth queueing / retrying), as opposed to a 4xx rejection. */
export function isTransient(e: unknown): boolean {
  return !(e instanceof ApiError) || e.status >= 500 || e.status === 408 || e.status === 429;
}

/** Big touch-friendly button/link classes. */
export const tap = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-bold transition active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed';
export const tapTone = {
  primary: 'bg-primary text-white shadow-sm',
  gold: 'bg-gold text-white shadow-sm',
  outline: 'border border-line bg-white text-ink',
  green: 'bg-emerald-600 text-white shadow-sm',
  danger: 'bg-danger text-white',
} as const;

export function Section({ id, title, step, children, highlight }: { id: string; title: string; step?: number; children: React.ReactNode; highlight?: boolean }) {
  return (
    <section id={id} className={clsx('scroll-mt-20 rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.04)] transition', highlight ? 'border-danger ring-2 ring-danger/30' : 'border-line')}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-primary">
        {step !== undefined && <span className="num inline-flex size-7 items-center justify-center rounded-full bg-tint text-sm text-gold-dark">{step}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}
