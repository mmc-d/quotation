/**
 * Field service, installed base & helpdesk-lite (module 06): work-order lifecycle, completion evidence,
 * coverage (warranty / AMC / chargeable) decided — and stored with its reason — when a ticket or work
 * order is created.
 */

export const WORK_ORDER_TYPES = ['survey', 'installation', 'commissioning', 'corrective', 'preventive', 'warranty', 'inspection'] as const;
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

export const WORK_ORDER_STATUSES = ['new', 'scheduled', 'dispatched', 'en_route', 'on_site', 'awaiting_parts', 'completed', 'closed', 'cancelled'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

const WO_FLOW: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  new: ['scheduled', 'cancelled'],
  scheduled: ['dispatched', 'scheduled', 'cancelled'],
  dispatched: ['en_route', 'on_site', 'scheduled', 'cancelled'],
  en_route: ['on_site', 'scheduled'],
  on_site: ['awaiting_parts', 'completed'],
  awaiting_parts: ['scheduled'],
  completed: ['closed', 'on_site'],
  closed: [],
  cancelled: [],
};

export function canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WO_FLOW[from]?.includes(to) ?? false;
}

export interface ChecklistItem { key: string; labelAr: string; labelEn: string; required: boolean; done?: boolean; value?: string | null }

/** Default checklists per work-order type (Arabic + English labels); templates can override later. */
export const DEFAULT_CHECKLISTS: Record<WorkOrderType, Omit<ChecklistItem, 'done' | 'value'>[]> = {
  survey: [
    { key: 'door_hand', labelAr: 'اتجاه فتح الأبواب', labelEn: 'Door hand', required: true },
    { key: 'cable_route', labelAr: 'مسار الكابلات', labelEn: 'Cable route', required: true },
    { key: 'rack_position', labelAr: 'موقع الراك / سويتش PoE', labelEn: 'Rack / PoE switch position', required: false },
    { key: 'measurements', labelAr: 'المقاسات', labelEn: 'Measurements', required: false },
  ],
  installation: [
    { key: 'mounted', labelAr: 'تثبيت الأجهزة', labelEn: 'Devices mounted', required: true },
    { key: 'cabled', labelAr: 'توصيل الكابلات', labelEn: 'Cabling done', required: true },
    { key: 'labelled', labelAr: 'ترقيم الكابلات والأجهزة', labelEn: 'Cables and devices labelled', required: true },
    { key: 'site_clean', labelAr: 'تنظيف الموقع', labelEn: 'Site cleaned', required: true },
  ],
  commissioning: [
    { key: 'call', labelAr: 'اختبار الاتصال', labelEn: 'Call test', required: true },
    { key: 'video', labelAr: 'اختبار الصورة', labelEn: 'Video test', required: true },
    { key: 'unlock', labelAr: 'اختبار فتح الباب', labelEn: 'Unlock test', required: true },
    { key: 'fire_release', labelAr: 'فك الأقفال عند إنذار الحريق', labelEn: 'Fire-alarm release of maglocks', required: false },
  ],
  corrective: [
    { key: 'diagnosis', labelAr: 'تشخيص العطل', labelEn: 'Fault diagnosed', required: true },
    { key: 'fixed', labelAr: 'إصلاح العطل', labelEn: 'Fault fixed', required: true },
    { key: 'tested', labelAr: 'اختبار بعد الإصلاح', labelEn: 'Tested after repair', required: true },
  ],
  preventive: [
    { key: 'inspection', labelAr: 'فحص الأجهزة', labelEn: 'Devices inspected', required: true },
    { key: 'firmware', labelAr: 'مراجعة إصدار البرنامج', labelEn: 'Firmware checked', required: false },
    { key: 'cleaning', labelAr: 'تنظيف الأجهزة', labelEn: 'Devices cleaned', required: false },
  ],
  warranty: [
    { key: 'diagnosis', labelAr: 'تشخيص العطل', labelEn: 'Fault diagnosed', required: true },
    { key: 'fixed', labelAr: 'إصلاح أو استبدال', labelEn: 'Repaired or replaced', required: true },
    { key: 'tested', labelAr: 'اختبار بعد الإصلاح', labelEn: 'Tested after repair', required: true },
  ],
  inspection: [
    { key: 'inspection', labelAr: 'الفحص', labelEn: 'Inspection', required: true },
  ],
};

export function defaultChecklist(type: WorkOrderType): ChecklistItem[] {
  return DEFAULT_CHECKLISTS[type].map((i) => ({ ...i, done: false, value: null }));
}

/** Evidence on a work order at completion time. */
export interface CompletionEvidence {
  type: WorkOrderType;
  checklist: ChecklistItem[];
  photoCount: number;
  /** devices registered by this work order (installation needs at least one) */
  assetsRegistered: number;
  signatureName: string | null;
  checkedIn: boolean;
}

/**
 * Stage gate on completion (module 06 FSM-47): no "completed" without the required checklist items,
 * at least one photo, check-in, a customer signature, and — for installations — registered devices.
 * Returns the missing items (empty = may complete).
 */
export function missingForCompletion(e: CompletionEvidence): { key: string; ar: string; en: string }[] {
  const out: { key: string; ar: string; en: string }[] = [];
  if (!e.checkedIn) out.push({ key: 'check_in', ar: 'تسجيل الوصول للموقع', en: 'Site check-in' });
  for (const i of e.checklist) if (i.required && !i.done) out.push({ key: `check:${i.key}`, ar: i.labelAr, en: i.labelEn });
  if (e.photoCount < 1) out.push({ key: 'photos', ar: 'صورة واحدة على الأقل', en: 'At least one photo' });
  if (e.type === 'installation' && e.assetsRegistered < 1) out.push({ key: 'assets', ar: 'تسجيل الأجهزة المركبة (الرقم التسلسلي)', en: 'Register installed devices (serial)' });
  if (!e.signatureName?.trim()) out.push({ key: 'signature', ar: 'توقيع العميل', en: 'Customer signature' });
  return out;
}

export type Coverage = 'project' | 'warranty' | 'amc' | 'chargeable';

export interface CoverageInput {
  today: string;
  /** a project in progress (before acceptance) covers its own site's work */
  projectInProgress?: boolean;
  asset?: { labourWarrantyEnd: string | null; partsWarrantyEnd: string | null; manufacturerWarrantyEnd?: string | null } | null;
  /** active AMC agreement end date covering the site/asset (Phase 7b) */
  amcEnd?: string | null;
}

/** Entitlement check (module 06 FSM-60): which agreement pays for this visit, with a reason. */
export function decideCoverage(i: CoverageInput): { coverage: Coverage; reasonAr: string; reasonEn: string } {
  if (i.projectInProgress) return { coverage: 'project', reasonAr: 'ضمن مشروع قيد التنفيذ', reasonEn: 'Part of a project in progress' };
  const a = i.asset;
  if (a?.labourWarrantyEnd && i.today <= a.labourWarrantyEnd) {
    const parts = a.partsWarrantyEnd && i.today <= a.partsWarrantyEnd;
    return {
      coverage: 'warranty',
      reasonAr: `ضمان التركيب ساري حتى ${a.labourWarrantyEnd}${parts ? ` (القطع حتى ${a.partsWarrantyEnd})` : ' — القطع خارج الضمان'}`,
      reasonEn: `Installation warranty valid until ${a.labourWarrantyEnd}${parts ? ` (parts until ${a.partsWarrantyEnd})` : ' — parts out of warranty'}`,
    };
  }
  if (i.amcEnd && i.today <= i.amcEnd) return { coverage: 'amc', reasonAr: `عقد صيانة ساري حتى ${i.amcEnd}`, reasonEn: `Maintenance contract valid until ${i.amcEnd}` };
  if (!a) return { coverage: 'chargeable', reasonAr: 'لم يُحدَّد جهاز مسجل — مدفوع ما لم يثبت غير ذلك', reasonEn: 'No registered device identified — chargeable unless shown otherwise' };
  return {
    coverage: 'chargeable',
    reasonAr: a.labourWarrantyEnd ? `انتهى الضمان في ${a.labourWarrantyEnd}` : 'لا يوجد ضمان مسجل لهذا الجهاز',
    reasonEn: a.labourWarrantyEnd ? `Warranty ended on ${a.labourWarrantyEnd}` : 'No warranty recorded for this device',
  };
}

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Normalise a MAC address to AA:BB:CC:DD:EE:FF, or null if it is not one. */
export function normalizeMac(v: string | null | undefined): string | null {
  const hex = (v ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.length === 12 ? hex.match(/.{2}/g)!.join(':') : null;
}
