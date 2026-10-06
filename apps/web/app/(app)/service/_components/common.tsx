'use client';
import { Star } from 'lucide-react';
import { TIER_DEFAULTS, type AgreementTier } from '@mmc/domain';
import { useI18n } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import { clsx } from '@/components/ui';
import { Chip, useLabel } from '../../field/_components/common';
import type { SlaPart, TicketSla } from './types';

/** value → [Arabic, English, chip classes] (same shape as the field-service maps). */
type L = Record<string, [string, string, string?]>;

export const AGREEMENT_STATUS: L = {
  draft: ['مسودة', 'Draft', 'bg-gray-100 text-gray-700'],
  active: ['ساري', 'Active', 'bg-emerald-100 text-emerald-800'],
  renewed: ['مُجدَّد', 'Renewed', 'bg-sky-100 text-sky-800'],
  expired: ['منتهي', 'Expired', 'bg-gray-200 text-gray-600'],
  cancelled: ['ملغى', 'Cancelled', 'bg-rose-100 text-rose-800'],
};

export const VISIT_STATUS: L = {
  planned: ['مخططة', 'Planned', 'bg-gray-100 text-gray-700'],
  generated: ['أُنشئ أمر عمل', 'Work order created', 'bg-indigo-100 text-indigo-800'],
  done: ['تمت', 'Done', 'bg-emerald-100 text-emerald-800'],
  skipped: ['متجاوزة', 'Skipped', 'bg-gray-200 text-gray-500'],
};

export const BILLING_LABEL: L = {
  annual: ['سنوي', 'Annual'],
  semiannual: ['نصف سنوي', 'Semi-annual'],
  quarterly: ['ربع سنوي', 'Quarterly'],
  monthly: ['شهري', 'Monthly'],
};

export const COVERAGE_WINDOW: L = {
  business: ['ساعات العمل', 'Business hours'],
  '24x7': ['على مدار الساعة 24/7', '24/7'],
};

export const PR_STATUS: L = {
  draft: ['مسودة', 'Draft', 'bg-gray-100 text-gray-700'],
  sent: ['مُرسل', 'Sent', 'bg-indigo-100 text-indigo-800'],
  partially_paid: ['مدفوع جزئيًا', 'Partially paid', 'bg-amber-100 text-amber-800'],
  paid: ['مدفوع', 'Paid', 'bg-emerald-100 text-emerald-800'],
  cancelled: ['ملغى', 'Cancelled', 'bg-gray-200 text-gray-500'],
  expired: ['منتهي', 'Expired', 'bg-gray-200 text-gray-600'],
};

export const SLA_STATE: L = {
  ok: ['ضمن الوقت', 'On track', 'bg-sky-50 text-sky-700'],
  at_risk: ['مهدد', 'At risk', 'bg-amber-100 text-amber-800'],
  breached: ['متجاوز', 'Breached', 'bg-rose-100 text-rose-800'],
  met: ['تم الالتزام', 'Met', 'bg-emerald-100 text-emerald-800'],
};

export const TIER_TONE: Record<string, string> = {
  basic: 'bg-gray-100 text-gray-700',
  standard: 'bg-sky-100 text-sky-800',
  premium: 'bg-tint text-gold-dark ring-1 ring-gold/40',
};

export const AgreementStatusBadge = ({ status }: { status: string }) => <Chip map={AGREEMENT_STATUS} value={status} />;

export function TierBadge({ tier }: { tier: string }) {
  const { locale } = useI18n();
  const t = TIER_DEFAULTS[tier as AgreementTier];
  return <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', TIER_TONE[tier] ?? 'bg-gray-100 text-gray-700')}>{t ? (locale === 'en' ? t.en : t.ar) : tier}</span>;
}

/** One SLA clock (response or resolution): state chip + due time. */
export function SlaPartBadge({ part, kind, compact }: { part: SlaPart | null; kind: 'response' | 'resolution'; compact?: boolean }) {
  const { bi } = useI18n();
  const label = useLabel();
  if (!part) return null;
  const name = kind === 'response' ? bi('استجابة', 'Response') : bi('حل', 'Resolution');
  const done = part.state === 'met' || (part.state === 'breached' && part.doneAt);
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px]" title={`${name}: ${label(SLA_STATE, part.state)} — ${bi('الاستحقاق', 'due')} ${dateTime(part.due)}`}>
      <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-bold', SLA_STATE[part.state]?.[2])}>{name}: {label(SLA_STATE, part.state)}</span>
      {!compact && !done && <span dir="ltr" className="num whitespace-nowrap text-muted">{dateTime(part.due)}</span>}
    </span>
  );
}

/** Both clocks for a ticket row. */
export function SlaBadges({ sla, compact }: { sla: TicketSla | null | undefined; compact?: boolean }) {
  if (!sla || (!sla.response && !sla.resolution)) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <SlaPartBadge part={sla.response} kind="response" compact={compact} />
      <SlaPartBadge part={sla.resolution} kind="resolution" compact={compact} />
    </div>
  );
}

/** 1–5 stars (read-only). */
export function Stars({ score, className }: { score: number | null | undefined; className?: string }) {
  const { bi } = useI18n();
  if (!score) return <span className="text-muted">—</span>;
  return (
    <span className={clsx('inline-flex items-center gap-0.5', className)} role="img" aria-label={bi(`${score} من 5`, `${score} of 5`)} title={`${score}/5`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={clsx('size-3.5', i <= score ? 'fill-gold text-gold' : 'text-gray-300')} />)}
    </span>
  );
}

/** "YYYY-MM-DD → YYYY-MM-DD" in LTR. */
export function Period({ from, to, className }: { from: string | null | undefined; to: string | null | undefined; className?: string }) {
  if (!from && !to) return <span className="text-muted">—</span>;
  return <span dir="ltr" className={clsx('num whitespace-nowrap', className)}>{from ?? '…'} → {to ?? '…'}</span>;
}

/** Days from today (Riyadh) to a date — negative when past. */
export function daysUntil(day: string): number {
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}
