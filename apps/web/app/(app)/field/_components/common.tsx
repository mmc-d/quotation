'use client';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clsx, Select } from '@/components/ui';
import type { ScheduleWarning } from './types';

/** value → [Arabic, English, chip classes] */
type L = Record<string, [string, string, string?]>;

export const WO_TYPE: L = {
  survey: ['مسح موقع', 'Site survey', 'bg-indigo-100 text-indigo-800'],
  installation: ['تركيب', 'Installation', 'bg-primary-50 text-primary'],
  commissioning: ['تشغيل واختبار', 'Commissioning', 'bg-sky-100 text-sky-800'],
  corrective: ['صيانة تصحيحية', 'Corrective repair', 'bg-amber-100 text-amber-800'],
  preventive: ['صيانة وقائية', 'Preventive maintenance', 'bg-teal-100 text-teal-800'],
  warranty: ['ضمان', 'Warranty', 'bg-emerald-100 text-emerald-800'],
  inspection: ['فحص', 'Inspection', 'bg-violet-100 text-violet-800'],
};

export const WO_STATUS: L = {
  new: ['جديد', 'New', 'bg-sky-100 text-sky-800'],
  scheduled: ['مجدول', 'Scheduled', 'bg-indigo-100 text-indigo-800'],
  dispatched: ['أُرسل للفني', 'Dispatched', 'bg-violet-100 text-violet-800'],
  en_route: ['في الطريق', 'En route', 'bg-amber-100 text-amber-800'],
  on_site: ['في الموقع', 'On site', 'bg-orange-100 text-orange-800'],
  awaiting_parts: ['بانتظار قطع', 'Awaiting parts', 'bg-rose-100 text-rose-800'],
  completed: ['مكتمل', 'Completed', 'bg-emerald-100 text-emerald-800'],
  closed: ['مغلق', 'Closed', 'bg-gray-200 text-gray-600'],
  cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-500'],
};

export const TICKET_STATUS: L = {
  open: ['مفتوح', 'Open', 'bg-sky-100 text-sky-800'],
  in_progress: ['قيد المعالجة', 'In progress', 'bg-amber-100 text-amber-800'],
  resolved: ['تم الحل', 'Resolved', 'bg-emerald-100 text-emerald-800'],
  closed: ['مغلق', 'Closed', 'bg-gray-200 text-gray-600'],
};

export const COVERAGE: L = {
  project: ['ضمن مشروع', 'Project', 'bg-primary-50 text-primary'],
  warranty: ['ضمان', 'Warranty', 'bg-emerald-100 text-emerald-800'],
  amc: ['عقد صيانة', 'Maintenance contract', 'bg-sky-100 text-sky-800'],
  chargeable: ['مدفوع', 'Chargeable', 'bg-amber-100 text-amber-800'],
};

export const CHANNEL: L = {
  phone: ['هاتف', 'Phone'],
  whatsapp: ['واتساب', 'WhatsApp'],
  web: ['الموقع الإلكتروني', 'Website'],
  email: ['بريد إلكتروني', 'E-mail'],
  walk_in: ['حضور شخصي', 'Walk-in'],
};

export const PRIORITY: L = {
  low: ['منخفضة', 'Low', 'bg-gray-100 text-gray-600'],
  normal: ['عادية', 'Normal', 'bg-sky-50 text-sky-700'],
  high: ['عالية', 'High', 'bg-amber-100 text-amber-800'],
  urgent: ['عاجلة', 'Urgent', 'bg-rose-100 text-rose-800'],
};

export const LOCATION_KIND: L = {
  building: ['مبنى', 'Building'],
  floor: ['طابق', 'Floor'],
  unit: ['وحدة', 'Unit'],
  room: ['غرفة', 'Room'],
  riser: ['رايزر', 'Riser'],
  rack: ['راك', 'Rack'],
  gate: ['بوابة', 'Gate'],
  other: ['أخرى', 'Other'],
};

export const ASSET_STATUS: L = {
  active: ['فعّال', 'Active', 'bg-emerald-100 text-emerald-800'],
  replaced: ['مُستبدل', 'Replaced', 'bg-amber-100 text-amber-800'],
  removed: ['مُزال', 'Removed', 'bg-gray-200 text-gray-600'],
};

export const TIME_KIND: L = { travel: ['تنقل', 'Travel'], work: ['عمل', 'Work'] };

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

export const WoStatusBadge = ({ status }: { status: string }) => <Chip map={WO_STATUS} value={status} />;
export const WoTypeBadge = ({ type }: { type: string }) => <Chip map={WO_TYPE} value={type} />;
export const TicketStatusBadge = ({ status }: { status: string }) => <Chip map={TICKET_STATUS} value={status} />;
export const PriorityBadge = ({ priority }: { priority: string }) => <Chip map={PRIORITY} value={priority} />;

export function CoverageBadge({ coverage, reason, block }: { coverage: string | null | undefined; reason?: string | null; block?: boolean }) {
  if (!block) return <span title={reason ?? undefined}><Chip map={COVERAGE} value={coverage} icon={<ShieldCheck className="size-3" />} /></span>;
  return (
    <div className={clsx('rounded-lg border px-3 py-2', coverage === 'chargeable' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50/70')}>
      <Chip map={COVERAGE} value={coverage} icon={<ShieldCheck className="size-3" />} />
      {reason && <p className="mt-1 text-xs leading-relaxed text-ink">{reason}</p>}
    </div>
  );
}

/** Pick ar/en reason when both exist. */
export function useReason() {
  const { locale } = useI18n();
  return (ar: string | null | undefined, en?: string | null) => (locale === 'en' && en ? en : ar ?? en ?? null);
}

// ───────────── time helpers (Riyadh, UTC+3, no DST) ─────────────

const RIYADH = 3 * 3600_000;
/** ISO instant → "YYYY-MM-DDTHH:mm" in Riyadh (for <input type="datetime-local">). */
export function toRiyadhLocal(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  return new Date(t + RIYADH).toISOString().slice(0, 16);
}
/** "YYYY-MM-DDTHH:mm" (Riyadh) → ISO instant. */
export function fromRiyadhLocal(v: string): string {
  return new Date(`${v}:00+03:00`).toISOString();
}
export function riyadhDay(iso: string | null | undefined): string {
  return iso ? toRiyadhLocal(iso).slice(0, 10) : '';
}
export function riyadhTime(iso: string | null | undefined): string {
  return iso ? toRiyadhLocal(iso).slice(11, 16) : '';
}
/** Fractional hour of day in Riyadh. */
export function riyadhHour(iso: string): number {
  const s = toRiyadhLocal(iso);
  return Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60;
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** Google Maps link (navUrl from the API, or built from the site). */
export function mapsUrl(site: { mapLink?: string | null; lat?: string | null; lng?: string | null; name?: string; city?: string | null; district?: string | null; street?: string | null } | null | undefined, navUrl?: string | null): string | null {
  if (navUrl) return navUrl;
  if (!site) return null;
  if (site.mapLink) return site.mapLink;
  if (site.lat && site.lng) return `https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lng}`;
  const q = [site.street, site.district, site.city].filter(Boolean).join(', ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

// ───────────── customer sites ─────────────

export interface PartySite { id: string; name: string; city: string | null; district: string | null }

export function usePartySites(partyId: string | null | undefined) {
  return useQuery({
    queryKey: ['party', partyId, 'sites'],
    queryFn: () => api.get<{ sites: PartySite[] }>(`/parties/${partyId}`).then((p) => p.sites ?? []),
    enabled: !!partyId,
    staleTime: 60_000,
  });
}

/** Site select fed by the customer's sites. */
export function SiteSelect({ partyId, value, onChange, emptyLabel, disabled }: { partyId: string | null | undefined; value: string | null; onChange: (id: string | null) => void; emptyLabel?: string; disabled?: boolean }) {
  const { bi } = useI18n();
  const sites = usePartySites(partyId);
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled || !partyId}>
      <option value="">{!partyId ? bi('اختر العميل أولًا', 'Pick the customer first') : sites.isLoading ? bi('جارٍ التحميل…', 'Loading…') : emptyLabel ?? bi('— اختر الموقع —', '— Select a site —')}</option>
      {(sites.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ''}</option>)}
    </Select>
  );
}

/** "Code · serial" in LTR. */
export function DeviceRef({ code, serial, className }: { code: string; serial?: string | null; className?: string }) {
  return <span dir="ltr" className={clsx('num whitespace-nowrap', className)}>{code}{serial ? ` · ${serial}` : ''}</span>;
}

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  if (children === null || children === undefined || children === '') return <span className="text-muted">—</span>;
  return <span dir="ltr" className={clsx('num', className)}>{children}</span>;
}

/** Definition list row. */
export function Info({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/60 py-1.5 text-sm last:border-0">
      <span className="text-xs font-bold text-muted">{label}</span>
      <span className="text-end">{children}</span>
    </div>
  );
}

/** Soft KSA scheduling warnings (FSM-27) — amber list; never blocks the booking. */
export function ScheduleWarnings({ warnings, className }: { warnings: ScheduleWarning[] | null | undefined; className?: string }) {
  const { bi, locale } = useI18n();
  if (!warnings?.length) return null;
  return (
    <div className={clsx('rounded-xl border border-amber-200 bg-amber-50 px-4 py-3', className)}>
      <div className="mb-1 flex items-center gap-2 text-sm font-extrabold text-amber-900"><AlertTriangle className="size-4" />{bi('تنبيهات الجدولة', 'Scheduling warnings')}</div>
      <ul className="list-disc space-y-0.5 ps-5 text-xs leading-relaxed text-amber-900">
        {warnings.map((w) => <li key={w.key}>{locale === 'en' ? w.en : w.ar}</li>)}
      </ul>
    </div>
  );
}

/** Tooltip text for a ⚠ marker. */
export function warningsTitle(warnings: ScheduleWarning[] | null | undefined, locale: string): string {
  return (warnings ?? []).map((w) => `⚠ ${locale === 'en' ? w.en : w.ar}`).join('\n');
}
