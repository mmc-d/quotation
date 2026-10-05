/** CRM rules (module 02): lead sources/statuses, scoring, default pipeline, follow-up automation. */

export const LEAD_SOURCES = ['whatsapp', 'website', 'snapchat', 'instagram', 'tiktok', 'google', 'referral', 'walk_in', 'exhibition', 'phone', 'email', 'other'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const INTERESTS = ['intercom', 'smart_home', 'locks', 'cctv', 'iot', 'networking', 'access_control', 'other'] as const;

export const SEGMENTS = ['contractor', 'developer', 'building_owner', 'villa_owner', 'consultant', 'government', 'hotel', 'office', 'other'] as const;

export const PROJECT_TYPES = ['villa', 'building', 'compound', 'hotel', 'office', 'other'] as const;

export interface PipelineStageSpec {
  key: string;
  name_ar: string;
  name_en: string;
  probability: number;
  kind: 'open' | 'won' | 'lost';
}

export const DEFAULT_PIPELINE: PipelineStageSpec[] = [
  { key: 'new', name_ar: 'جديد', name_en: 'New', probability: 10, kind: 'open' },
  { key: 'site_survey', name_ar: 'معاينة الموقع', name_en: 'Site survey', probability: 25, kind: 'open' },
  { key: 'quoted', name_ar: 'تم إرسال العرض', name_en: 'Quoted', probability: 50, kind: 'open' },
  { key: 'negotiation', name_ar: 'تفاوض', name_en: 'Negotiation', probability: 70, kind: 'open' },
  { key: 'won', name_ar: 'تم الفوز', name_en: 'Won', probability: 100, kind: 'won' },
  { key: 'lost', name_ar: 'خسارة', name_en: 'Lost', probability: 0, kind: 'lost' },
];

export const DEFAULT_LOST_REASONS = [
  { key: 'price', name_ar: 'السعر', name_en: 'Price' },
  { key: 'competitor', name_ar: 'منافس', name_en: 'Went with a competitor' },
  { key: 'timing', name_ar: 'التوقيت', name_en: 'Timing / postponed' },
  { key: 'no_response', name_ar: 'لا يوجد رد', name_en: 'No response' },
  { key: 'scope', name_ar: 'خارج النطاق', name_en: 'Out of scope' },
  { key: 'other', name_ar: 'أخرى', name_en: 'Other' },
];

/** Simple, explainable lead score 0–100. */
export function scoreLead(l: { source?: string | null; estimatedUnits?: number | null; hasMobile?: boolean; hasEmail?: boolean; interest?: string | null; city?: string | null }): number {
  let s = 0;
  if (l.hasMobile) s += 20;
  if (l.hasEmail) s += 5;
  if (l.source === 'referral') s += 25;
  else if (l.source === 'walk_in' || l.source === 'exhibition') s += 15;
  else if (l.source === 'whatsapp' || l.source === 'website' || l.source === 'phone') s += 10;
  else s += 5;
  const u = l.estimatedUnits ?? 0;
  s += u >= 50 ? 30 : u >= 10 ? 20 : u >= 1 ? 10 : 0;
  if (l.interest) s += 10;
  if (l.city) s += 5;
  return Math.min(100, s);
}

/** Weighted pipeline value. */
export function weightedAmount(amountHalalas: number, probability: number): number {
  return Math.round((amountHalalas * probability) / 100);
}

export type FollowUpRule = 'quote_not_viewed' | 'quote_expiring' | 'stale_opportunity' | 'new_lead_untouched';

export interface FollowUpCandidate {
  rule: FollowUpRule;
  entityType: 'quote' | 'opportunity' | 'lead';
  entityId: string;
  ownerId: string | null;
  message_ar: string;
  message_en: string;
}

export const FOLLOW_UP_THRESHOLDS = { quoteNotViewedDays: 2, quoteExpiringDays: 3, staleOpportunityDays: 14, newLeadHours: 4 };

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86400000;
}

/** Decide which follow-ups are due (pure — the worker loads candidates and creates activities). */
export function followUpsDue(
  now: Date,
  data: {
    quotes: { id: string; number: string; ownerId: string | null; status: string; sentAt: Date | null; viewedAt: Date | null; validUntil: Date | null }[];
    opportunities: { id: string; title: string; ownerId: string | null; open: boolean; lastActivityAt: Date }[];
    leads: { id: string; name: string; ownerId: string | null; status: string; createdAt: Date; firstContactAt: Date | null }[];
  },
): FollowUpCandidate[] {
  const out: FollowUpCandidate[] = [];
  const t = FOLLOW_UP_THRESHOLDS;
  for (const q of data.quotes) {
    if (q.status === 'sent' && q.sentAt && !q.viewedAt && daysBetween(q.sentAt, now) >= t.quoteNotViewedDays) {
      out.push({ rule: 'quote_not_viewed', entityType: 'quote', entityId: q.id, ownerId: q.ownerId, message_ar: `العرض ${q.number} لم يُفتح بعد — تواصل مع العميل`, message_en: `Quote ${q.number} not viewed yet — follow up` });
    }
    if ((q.status === 'sent' || q.status === 'viewed') && q.validUntil) {
      const left = daysBetween(now, q.validUntil);
      if (left >= 0 && left <= t.quoteExpiringDays) {
        out.push({ rule: 'quote_expiring', entityType: 'quote', entityId: q.id, ownerId: q.ownerId, message_ar: `صلاحية العرض ${q.number} تنتهي قريبًا`, message_en: `Quote ${q.number} expires soon` });
      }
    }
  }
  for (const o of data.opportunities) {
    if (o.open && daysBetween(o.lastActivityAt, now) >= t.staleOpportunityDays) {
      out.push({ rule: 'stale_opportunity', entityType: 'opportunity', entityId: o.id, ownerId: o.ownerId, message_ar: `لا يوجد نشاط على الفرصة «${o.title}» منذ أسبوعين`, message_en: `No activity on “${o.title}” for 2 weeks` });
    }
  }
  for (const l of data.leads) {
    if (l.status === 'new' && !l.firstContactAt && daysBetween(l.createdAt, now) * 24 >= t.newLeadHours) {
      out.push({ rule: 'new_lead_untouched', entityType: 'lead', entityId: l.id, ownerId: l.ownerId, message_ar: `عميل محتمل جديد «${l.name}» لم يتم التواصل معه`, message_en: `New lead “${l.name}” not contacted yet` });
    }
  }
  return out;
}

/** OTP for online quote acceptance: 6 digits, compared in constant time by the caller. */
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
