'use client';
/**
 * Customer-portal API client. Every call goes to /api/portal/* on this origin, so the httpOnly
 * `mmc_portal` cookie is sent automatically (credentials: 'same-origin'). A 401 sends the customer to
 * /portal/login (with ?next= so they come back) — never to the staff login.
 */
import { bi as biNow } from '@/lib/i18n';
import { friendly } from '@/app/_public/public-shell';

export class PortalError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Portal-specific server messages (English) → bilingual, friendly text. Falls back to the public map. */
const MESSAGES: [RegExp, string, string][] = [
  [/portal sign-in required|unauthenticated/i, 'انتهت الجلسة — سجّل الدخول مرة أخرى.', 'Your session has ended — please sign in again.'],
  [/^wrong code$/i, 'الرمز غير صحيح — تحقق من رسالة واتساب وحاول مرة أخرى.', 'Wrong code — check the WhatsApp message and try again.'],
  [/too many wrong attempts/i, 'محاولات خاطئة كثيرة — اطلب رمزًا جديدًا.', 'Too many wrong attempts — request a new code.'],
  [/too many attempts/i, 'محاولات كثيرة — انتظر بضع دقائق ثم حاول مرة أخرى.', 'Too many attempts — wait a few minutes and try again.'],
  [/code expired/i, 'انتهت صلاحية الرمز أو لم يُطلب بعد — اطلب رمزًا جديدًا.', 'The code has expired (or none was requested) — request a new one.'],
  [/choose one of the listed accounts/i, 'اختر إحدى الجهات المعروضة.', 'Choose one of the listed accounts.'],
  [/device is on another site/i, 'الجهاز المختار في موقع آخر — غيّر الموقع أو الجهاز.', 'The selected device is on another site — change the site or the device.'],
  [/photo must be an image/i, 'كل صورة يجب ألا تتجاوز 1.5 ميجابايت.', 'Each photo must be at most 1.5 MB.'],
  [/more than 7 days ago|request is closed/i, 'هذا الطلب مغلق — يُرجى فتح طلب جديد.', 'This request is closed — please open a new request.'],
  [/validation failed/i, 'بعض البيانات غير مكتملة أو غير صحيحة — راجع الحقول.', 'Some details are missing or invalid — please check the fields.'],
  [/already been rated/i, 'تم تقييم هذه الزيارة مسبقًا.', 'This visit has already been rated.'],
  [/score must be/i, 'اختر تقييمًا من 1 إلى 5.', 'Choose a rating from 1 to 5.'],
  [/^HTTP 5\d\d$/i, 'حدث خطأ في الخادم — حاول مرة أخرى بعد قليل.', 'Server error — please try again shortly.'],
  [/failed to fetch|networkerror|load failed/i, 'تعذر الاتصال — تحقق من الإنترنت وحاول مرة أخرى.', 'Could not connect — check your internet connection and try again.'],
];

export function portalMessage(raw: string): string {
  for (const [re, ar, en] of MESSAGES) if (re.test(raw)) return biNow(ar, en);
  return friendly(raw);
}

function toLogin() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/portal/login')) return;
  const next = window.location.pathname + window.location.search;
  window.location.replace(`/portal/login?next=${encodeURIComponent(next)}`);
}

export async function portalFetch<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; redirectOn401?: boolean } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  let res: Response;
  try {
    res = await fetch(`/api/portal${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) {
    throw new PortalError(portalMessage((e as Error).message || 'failed to fetch'), 0);
  }
  const text = await res.text();
  let json: { message?: string | string[] } | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (res.status === 401 && init.redirectOn401 !== false) toLogin();
  if (!res.ok) {
    const m = Array.isArray(json?.message) ? json?.message.join(', ') : json?.message;
    throw new PortalError(portalMessage(m ?? (res.status === 404 ? 'not found' : `HTTP ${res.status}`)), res.status);
  }
  return json as T;
}

/** react-query retry: never retry auth / not-found / validation failures. */
export const portalRetry = (count: number, err: unknown) => !(err instanceof PortalError && err.status >= 400 && err.status < 500) && count < 2;

/**
 * Links the API builds with its public base URL (pay page, CSAT, service report). Same-app paths are
 * turned into relative ones so they open on this origin (and work in dev where the base URL differs).
 */
export function localHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, typeof window === 'undefined' ? 'http://x' : window.location.origin);
    if (/^\/(p|csat|q|sign)\//.test(u.pathname) || u.pathname.startsWith('/api/')) return u.pathname + u.search;
    return u.toString();
  } catch {
    return null;
  }
}

// ───────────────────────── response shapes (apps/api/src/modules/portal.service.ts) ─────────────────────────

export type Coverage = 'project' | 'warranty' | 'amc' | 'chargeable';

export interface PortalMe {
  account: { id: string; name: string | null; phone: string; lastLoginAt: string | null };
  party: { id: string; nameAr: string };
  sites: { id: string; name: string; type: string | null; city: string | null; district: string | null }[];
}

export interface PortalDevice {
  id: string; code: string; description: string | null; serial: string | null; mac: string | null; status: string; installedOn: string | null;
  siteId: string | null; siteName: string | null; locationPath: string | null;
  warranty: { labourEnd: string | null; partsEnd: string | null; manufacturerEnd: string | null };
  coverageToday: { coverage: Coverage; reasonAr: string; reasonEn: string; agreementNumber: string | null; date: string };
}

export interface PortalWorkOrder {
  id: string; number: string; type: string; status: string; title: string | null; scheduledStart: string | null; scheduledEnd: string | null; completedAt: string | null;
  technicianName?: string | null; reportUrl: string | null; csatUrl: string | null; csatScore: number | null;
}

export interface PortalDeviceDetail extends PortalDevice {
  tickets: { id: string; number: string; subject: string; status: string; createdAt: string }[];
  serviceHistory: PortalWorkOrder[];
}

export interface SlaPart { due: string; doneAt: string | null; state: 'ok' | 'at_risk' | 'breached' | 'met' }

export interface PortalTicket {
  id: string; number: string; channel: string; subject: string; description: string | null; status: string; priority: string;
  coverage: Coverage | null; coverageReason: string | null; createdAt: string; resolvedAt: string | null; siteId: string | null; assetId: string | null;
  siteName: string | null; asset: { code: string; serial: string | null } | null; sla: { response: SlaPart | null; resolution: SlaPart | null };
}

export interface PortalTicketDetail extends PortalTicket {
  timeline: { at: string; kind: 'opened' | 'status' | 'reply'; status?: string; note?: string; ar: string; en: string }[];
  workOrders: PortalWorkOrder[];
  photos: { id: string; filename: string; mime: string; size: number; url: string }[];
  /** conversation (never internal notes) */
  messages?: PortalMessage[];
  /** false when closed, or resolved more than 7 days ago (open a new request instead) */
  canMessage?: boolean;
}

export interface PortalMessage {
  id: string; author: 'staff' | 'customer' | 'system' | string; authorName: string | null; body: string; createdAt: string;
  files: { id: string; filename: string; mime: string; url: string }[];
}

export interface PortalKbSummary { id: string; slug: string; titleAr: string; titleEn: string | null; excerptAr: string; excerptEn: string | null; hasVideo: boolean; updatedAt: string }
export interface PortalKbArticle {
  id: string; slug: string; titleAr: string; titleEn: string | null; bodyAr: string; bodyEn: string | null; tags: string[]; videoUrl: string | null; updatedAt: string;
  products: { id: string; code: string; nameAr: string; nameEn: string | null }[];
  files: { id: string; filename: string; mime: string; size: number; url: string }[];
}

export type ClockLevel = 'not_started' | 'ok' | 'warn70' | 'warn90' | 'overdue' | 'stopped';
export interface PortalClock {
  started: boolean; startDate: string | null; elapsedDays: number; minDays: number; maxDays: number; targetMin: string | null; targetMax: string | null; paused: boolean; level: ClockLevel;
}
type Label = { ar: string; en: string } | null;

export interface PortalProject {
  id: string; number: string; name: string | null; stage: string; stageLabel: Label; status: string; clock: PortalClock; approvalsPending: number; acceptedOn: string | null;
}

export interface PortalApproval {
  id: string; kind: string; label: Label; title: string | null; revision: number; status: string; notes: string | null;
  approvedOn: string | null; approvedByName: string | null; rejectionReason: string | null; canDecide: boolean;
  files: { id: string; filename: string; mime: string; size: number; url: string }[];
}

export interface PortalProjectDetail extends Omit<PortalProject, 'approvalsPending'> {
  site: { id: string; name: string; city: string | null } | null;
  nextStep: { to: string; toLabel: Label; pending: { key: string; ar: string; en: string }[] } | null;
  approvals: PortalApproval[];
  workOrders: PortalWorkOrder[];
}

export interface PortalInvoice {
  id: string; number: string; typeCode: string; typeLabel: Label; issueDate: string; dueDate: string | null;
  taxable: string; vatAmount: string; total: string; balanceDue: string; status: string; zatcaStatus: string | null; qrPayload: string | null; pdfUrl: string | null;
}

export interface PortalPaymentRequest {
  id: string; number: string; amount: string; paidAmount: string; due: string; dueDate: string; status: string;
  contractNumber: string | null; agreementNumber: string | null; periodFrom: string | null; periodTo: string | null; payUrl: string | null;
}

export interface PortalAgreement {
  id: string; number: string; tier: { key: string; ar: string; en: string }; status: string; startDate: string; endDate: string; daysLeft: number;
  coverage: { hours: string; responseHours: number; resolutionHours: number; visitsPerYear: number; partsIncluded: boolean; sites: { id: string; name: string }[]; deviceCount: number | null };
  price: string; billingFrequency: string;
  nextVisits: { dueDate: string; status: string; siteName: string | null; workOrderNumber: string | null; workOrderStatus: string | null; scheduledStart: string | null }[];
  renewal: { id: string; renewalOfId: string | null; number: string; status: string; startDate: string; endDate: string; price: string } | null;
}

export type Rows<T> = { rows: T[] };

/** Latest of the warranty end dates (what the customer usually asks: "until when is it covered?"). */
export function warrantyUntil(w: PortalDevice['warranty']): string | null {
  return [w.labourEnd, w.partsEnd, w.manufacturerEnd].filter((x): x is string => !!x).sort().at(-1) ?? null;
}

