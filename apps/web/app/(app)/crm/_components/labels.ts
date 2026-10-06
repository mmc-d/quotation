import { INTERESTS, LEAD_SOURCES, PROJECT_TYPES } from '@mmc/domain';

export { INTERESTS, LEAD_SOURCES, PROJECT_TYPES };

export const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'واتساب',
  website: 'الموقع',
  snapchat: 'سناب شات',
  instagram: 'إنستغرام',
  tiktok: 'تيك توك',
  google: 'قوقل',
  referral: 'إحالة',
  walk_in: 'زيارة',
  exhibition: 'معرض',
  phone: 'اتصال',
  email: 'بريد',
  other: 'أخرى',
};

export const INTEREST_LABELS: Record<string, string> = {
  intercom: 'انتركوم',
  smart_home: 'منزل ذكي',
  locks: 'أقفال',
  cctv: 'كاميرات',
  iot: 'إنترنت الأشياء',
  networking: 'شبكات',
  access_control: 'تحكم بالدخول',
  other: 'أخرى',
};

export const PROJECT_LABELS: Record<string, string> = {
  villa: 'فيلا',
  building: 'عمارة',
  compound: 'مجمع',
  hotel: 'فندق',
  office: 'مكتب',
  other: 'أخرى',
};

export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'جديد',
  contacted: 'تم التواصل',
  qualified: 'مؤهل',
  unqualified: 'غير مؤهل',
  converted: 'تم التحويل',
};

export const label = (map: Record<string, string>, v: string | null | undefined) => (v ? map[v] ?? v : '—');

// English twins of the label tables above (same keys). Pick with `labelL(locale, AR, EN, v)`.
export const SOURCE_LABELS_EN: Record<string, string> = {
  whatsapp: 'WhatsApp',
  website: 'Website',
  snapchat: 'Snapchat',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  google: 'Google',
  referral: 'Referral',
  walk_in: 'Walk-in',
  exhibition: 'Exhibition',
  phone: 'Phone call',
  email: 'E-mail',
  other: 'Other',
};

export const INTEREST_LABELS_EN: Record<string, string> = {
  intercom: 'Intercom',
  smart_home: 'Smart home',
  locks: 'Locks',
  cctv: 'CCTV',
  iot: 'IoT',
  networking: 'Networking',
  access_control: 'Access control',
  other: 'Other',
};

export const PROJECT_LABELS_EN: Record<string, string> = {
  villa: 'Villa',
  building: 'Building',
  compound: 'Compound',
  hotel: 'Hotel',
  office: 'Office',
  other: 'Other',
};

export const LEAD_STATUS_LABELS_EN: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  unqualified: 'Unqualified',
  converted: 'Converted',
};

export const ENTITY_LABELS_EN: Record<string, string> = { party: 'Customer', lead: 'Lead', opportunity: 'Opportunity', quote: 'Quote', contract: 'Contract' };

/** Locale-aware `label`: the Arabic table for 'ar', the English twin for 'en' (falls back to the raw value). */
export const labelL = (locale: string, ar: Record<string, string>, en: Record<string, string>, v: string | null | undefined) =>
  label(locale === 'en' ? en : ar, v);

/** wa.me link from any phone format (digits only, Saudi local 05… → 9665…). */
export function waLink(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  let d = mobile.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('05') && d.length === 10) d = `966${d.slice(1)}`;
  if (d.startsWith('5') && d.length === 9) d = `966${d}`;
  return d ? `https://wa.me/${d}` : null;
}

export interface Lead {
  id: string;
  number: string | null;
  source: string;
  campaignId: string | null;
  name: string;
  companyName: string | null;
  mobile: string | null;
  waBsuid: string | null;
  email: string | null;
  city: string | null;
  interest: string | null;
  projectType: string | null;
  estimatedUnits: number | null;
  message: string | null;
  score: number;
  status: string;
  ownerId: string | null;
  ownerName?: string | null;
  unqualifiedReason: string | null;
  convertedAt: string | null;
  convertedPartyId: string | null;
  convertedOpportunityId: string | null;
  createdAt: string;
}

export interface Stage { id: string; key: string; nameAr: string; nameEn: string; probability: number; kind: 'open' | 'won' | 'lost' | string; sort: number }
export interface LostReason { id: string; key: string; nameAr: string; nameEn: string | null }

export interface Opportunity {
  id: string;
  title: string;
  partyId: string | null;
  contactId: string | null;
  pipelineId: string;
  stageId: string;
  amount: string;
  probability: number;
  expectedClose: string | null;
  projectType: string | null;
  competitors: string[];
  lostReasonKey: string | null;
  lostNote: string | null;
  wonAt: string | null;
  lostAt: string | null;
  ownerId: string | null;
  leadId: string | null;
  lastActivityAt: string;
  updatedAt: string;
  partyName?: string | null;
  ownerName?: string | null;
}

/** Link for an activity's polymorphic entity. */
export function entityHref(type: string, id: string): string | null {
  switch (type) {
    case 'party': return `/customers/${id}`;
    case 'lead': return `/crm/leads/${id}`;
    case 'opportunity': return `/crm/opportunities/${id}`;
    case 'quote': return `/quotes/${id}`;
    case 'contract': return `/contracts/${id}`;
    default: return null;
  }
}

export const ENTITY_LABELS: Record<string, string> = { party: 'عميل', lead: 'عميل محتمل', opportunity: 'فرصة', quote: 'عرض سعر', contract: 'عقد' };
