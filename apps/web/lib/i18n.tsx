'use client';
/**
 * Tiny i18n layer for the staff app — Arabic (RTL, default) and English (LTR).
 *
 * How the locale is chosen
 *  1. First paint: the root layout reads the `mmc_locale` cookie (server side) and renders
 *     `<html lang dir>` + passes it to `<I18nProvider initialLocale>`, so SSR and hydration agree.
 *  2. No cookie yet → localStorage `mmc_locale` is used after mount (rare; the cookie is the source).
 *  3. Once signed in, the Shell calls `syncUserLocale(me.user.locale)` and the account's saved
 *     locale wins — unless the user switched language while signed out (login page), in which case
 *     that choice is pushed to the account (`PATCH /api/me`) instead.
 *  `setLocale(l)` flips `<html lang/dir>`, writes the cookie + localStorage, PATCHes `/me` when
 *  signed in, and re-renders every component that uses `useI18n()`.
 *
 * How to translate a page (pattern)
 *  - In the component: `const { t, locale, bi } = useI18n();` then `t('customers.title')`,
 *    `t('customers.count', { n: total })` (`{name}` placeholders), or `bi('نص', 'Text')` for a
 *    one-off string that does not deserve a key.
 *  - Keys: `<area>.<thing>` in camelCase. Shared words live in `common.*` (save, cancel, edit…),
 *    status chips in `status.*` (used by `<StatusBadge>`), one block per module/page
 *    (`cockpit.*`, `customers.*`, `quotes.*`…). Add the key to BOTH `ar` and `en` below — `en` is
 *    typed as `typeof ar`, so `tsc` fails if a key is missing or misspelt.
 *  - Outside render (toasts in callbacks, `onSuccess`…), the hook's `t`/`bi` are fine; the
 *    standalone `bi(ar, en)` export reads the current locale at call time and is meant only for
 *    such non-render code (it does not subscribe to changes).
 *  - Layout: use logical Tailwind classes (`ms-/me-/ps-/pe-/start-/end-/text-start`), never
 *    `left/right` or `space-x-reverse`; use `dir` from the hook if a transform must be mirrored.
 *    Codes, phones, e-mails and numbers keep `dir="ltr"` / `.num`.
 *  - Data coming from the API in Arabic only (e.g. `name_ar`, `titleAr`) stays as is; prefer an
 *    English field when the record has one (`locale === 'en' ? p.nameEn || p.nameAr : p.nameAr`).
 *  - Reference implementation: `app/(app)/customers/**`, `app/(app)/page.tsx`, `components/shell.tsx`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type Locale = 'ar' | 'en';
export const LOCALES: Locale[] = ['ar', 'en'];
export const LOCALE_COOKIE = 'mmc_locale';
const PENDING_KEY = 'mmc_locale_pending';

export function isLocale(v: unknown): v is Locale {
  return v === 'ar' || v === 'en';
}
export function dirOf(l: Locale): 'rtl' | 'ltr' {
  return l === 'ar' ? 'rtl' : 'ltr';
}

// ───────────────────────────── dictionaries ─────────────────────────────

const ar = {
  common: {
    save: 'حفظ', cancel: 'إلغاء', edit: 'تعديل', add: 'إضافة', delete: 'حذف', close: 'إغلاق', back: '→ رجوع',
    loading: 'جارٍ التحميل…', searching: 'جارٍ البحث…', search: 'بحث…', noResults: 'لا نتائج', all: 'الكل',
    open: 'فتح', view: 'عرض', remove: 'إزالة', saved: 'تم الحفظ', done: 'تم', optional: 'اختياري',
    sar: 'ر.س', from: 'من', to: 'إلى', name: 'الاسم', email: 'البريد الإلكتروني', mobile: 'الجوال',
    notes: 'ملاحظات', type: 'النوع', status: 'الحالة', date: 'التاريخ', number: 'الرقم', total: 'الإجمالي',
    unassigned: '— غير مُسند —', language: 'اللغة', switchTo: 'English', switchToTitle: 'Switch to English',
  },
  shell: {
    brand: 'المدى المبارك', menu: 'القائمة', notifications: 'التنبيهات', markAllRead: 'تعليم الكل كمقروء',
    noNotifications: 'لا توجد تنبيهات', signOut: 'تسجيل الخروج', vatNotRegistered: 'المنشأة غير مسجلة في ضريبة القيمة المضافة',
  },
  status: {
    draft: 'مسودة', pending_approval: 'بانتظار الموافقة', approved: 'معتمد', sent: 'مُرسل', viewed: 'تمت المشاهدة',
    accepted: 'مقبول', rejected: 'مرفوض', expired: 'منتهي', lost: 'خسارة', superseded: 'مُستبدل بنسخة أحدث',
    sent_for_signature: 'بانتظار التوقيع', signed: 'موقّع', active: 'ساري', completed: 'مكتمل', terminated: 'منتهٍ',
    cancelled: 'ملغى', pending: 'قادم', requested: 'مطلوب', invoiced: 'مفوتر', partially_paid: 'مدفوع جزئيًا',
    paid: 'مدفوع', billed: 'مفوتر', issued: 'صادرة', new: 'جديد', contacted: 'تم التواصل', qualified: 'مؤهل', unqualified: 'غير مؤهل',
    converted: 'تم التحويل', invited: 'مدعو', suspended: 'موقوف', cleared: 'معتمدة من زاتكا', reported: 'مُبلّغ عنها لزاتكا',
    not_applicable: 'غير خاضعة', open: 'مفتوحة', closed: 'مغلقة', legacy: 'مستورد من النظام القديم',
    legacy_phase1: 'المرحلة الأولى (النظام القديم)', warning: 'معتمدة مع تحذير', error: 'خطأ',
  },
  login: {
    brandTag: 'للتجارة والحلول الذكية',
    pitch: 'عروض الأسعار، العقود، العملاء والفواتير — في منصة واحدة.',
    pitchSub: 'الدخول بالدعوة فقط.',
    hosted: 'MMC Core · بيانات مستضافة في المملكة العربية السعودية',
    titleSignin: 'تسجيل الدخول', titleSignup: 'تفعيل حسابك', title2fa: 'التحقق بخطوتين', titleSent: 'تحقق من بريدك',
    subSignin: 'الدخول إلى منصة MMC Core', subSignup: 'للموظفين المدعوين فقط — استخدم البريد الذي وصلتك عليه الدعوة.',
    sub2fa: 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.',
    sentText: 'أرسلنا رابط تفعيل إلى {email}. افتح الرابط لإكمال الدخول.', backToSignin: 'العودة لتسجيل الدخول',
    code: 'رمز التحقق', verify: 'تحقق', google: 'الدخول بحساب Google', passkey: 'الدخول بمفتاح المرور (Passkey)',
    orEmail: 'أو بالبريد وكلمة المرور', password: 'كلمة المرور', passwordHint: '12 حرفًا على الأقل — يُفضّل عبارة طويلة',
    activate: 'تفعيل الحساب', signIn: 'دخول', firstTime: 'أول مرة وتمت دعوتك؟', activateLink: 'فعّل حسابك',
    haveAccount: 'لدي حساب — تسجيل الدخول',
    errVerify: 'يرجى تأكيد بريدك الإلكتروني أولًا — أرسلنا لك رابط التفعيل.', errGeneric: 'تعذر تسجيل الدخول',
  },
  cockpit: {
    hello: 'أهلًا {name}', period: 'الفترة {from} — {to}', title: 'لوحة القيادة', newQuote: 'عرض سعر جديد', newLead: 'عميل محتمل',
    noQuotes: 'لا توجد عروض في هذه الفترة', dailyValue: 'قيمة العروض اليومية', quotes: 'عروض الأسعار', accepted: 'المقبولة',
    winRate: 'نسبة الفوز', lostN: '{n} خسارة', pendingApproval: 'بانتظار الموافقة', avgDiscount: 'متوسط الخصم',
    margin: 'هامش الربح', overdueTasks: 'مهامي المتأخرة', openN: '{n} مفتوحة', arOutstanding: 'ذمم مدينة قائمة',
    overdue: 'متأخرة:', openRequests: 'طلبات دفع مفتوحة', leads: 'عملاء محتملون', leadsHint: '{fresh} جديد · {converted} تم تحويله',
    myTasks: 'مهامي', overdueN: '{n} متأخرة', noOverdue: 'لا يوجد متأخر', pipeline: 'مسار الفرص', weighted: 'مرجّح:',
    team: 'أداء فريق المبيعات', rep: 'المندوب', repQuotes: 'العروض', repWon: 'المقبولة', quotesValue: 'قيمة العروض', wonValue: 'قيمة المقبول',
  },
  customers: {
    title: 'العملاء', count: '{n} سجل', new: 'عميل جديد', searchPh: 'الاسم، الرقم الضريبي، الجوال…',
    roleCustomers: 'عملاء', roleSuppliers: 'موردون', rolePartners: 'شركاء',
    empty: 'لا يوجد عملاء بعد', emptyHint: 'أضف أول عميل، أو حوّل عميلًا محتملًا من شاشة العملاء المحتملين.',
    colName: 'الاسم', colIds: 'الرقم الضريبي / الموحد', colMobile: 'الجوال', colType: 'النوع', colSegment: 'الشريحة',
    customer: 'عميل', supplier: 'مورد', partner: 'شريك', b2b: 'منشأة B2B', b2c: 'فرد B2C',
    saveCustomer: 'حفظ العميل', savedCustomer: 'تم حفظ العميل', primaryContact: 'جهة الاتصال الرئيسية (اختياري)',
    whatsappMobile: 'الجوال / واتساب', contactEmail: 'البريد', siteCity: 'مدينة الموقع', siteCityPh: 'جدة',
    // detail
    vatBadge: 'ضريبي {v}', unifiedBadge: 'موحد {v}', balanceDue: 'رصيد مستحق', quote: 'عرض سعر',
    tabOverview: 'نظرة عامة', tabQuotes: 'العروض', tabContracts: 'العقود', tabInvoices: 'الفواتير', tabTimeline: 'السجل',
    contacts: 'جهات الاتصال', noContacts: 'لا توجد جهات اتصال', whatsapp: 'واتساب', sites: 'العناوين والمواقع', noSites: 'لا توجد مواقع',
    siteBilling: 'فوترة', siteProject: 'مشروع', opportunities: 'الفرص', noQuotes: 'لا توجد عروض لهذا العميل', noContracts: 'لا توجد عقود',
    noInvoices: 'لا توجد فواتير', statement: 'كشف الحساب', colValue: 'القيمة', colRemaining: 'المتبقي', colZatca: 'زاتكا',
    saveChanges: 'حفظ التعديلات',
    // contact dialog
    editContact: 'تعديل جهة الاتصال', newContact: 'جهة اتصال جديدة', nameReq: 'الاسم *', jobTitle: 'المسمى الوظيفي',
    whatsappPh: 'نفس الجوال إن تُرك فارغًا', preferredChannel: 'قناة التواصل المفضلة', chWhatsapp: 'واتساب', chPhone: 'اتصال',
    chEmail: 'بريد', chSms: 'رسالة نصية', isPrimary: 'جهة الاتصال الرئيسية',
    // site dialog
    siteTitle: 'العنوان الوطني / موقع المشروع', siteName: 'اسم الموقع *', siteTypeProject: 'مشروع', siteTypeBilling: 'عنوان الفوترة',
    siteTypeSite: 'موقع', buildingNumber: 'رقم المبنى (4 أرقام)', street: 'الشارع', district: 'الحي', city: 'المدينة',
    postalCode: 'الرمز البريدي (5 أرقام)', additionalNumber: 'الرقم الإضافي', mapLink: 'رابط الخريطة',
  },
  partyForm: {
    kind: 'النوع', org: 'منشأة / شركة', individual: 'فرد', segment: 'الشريحة', nameAr: 'الاسم بالعربية *', nameEn: 'الاسم بالإنجليزية',
    unified: 'الرقم الموحد (7xxxxxxxxx)', unifiedErr: '10 أرقام تبدأ بالرقم 7', vat: 'الرقم الضريبي', vatErr: '15 رقمًا يبدأ وينتهي بالرقم 3',
    vatHint: 'مطلوب لفواتير المنشآت (B2B)', terms: 'مدة السداد (يوم)', source: 'المصدر', sourcePh: 'إحالة، معرض، واتساب…',
    isCustomer: 'عميل', isSupplier: 'مورد', isPartner: 'شريك / استشاري', b2b: 'فاتورة ضريبية للمنشآت (B2B)',
  },
  segment: {
    contractor: 'مقاول', developer: 'مطور عقاري', building_owner: 'مالك مبنى', villa_owner: 'مالك فيلا', consultant: 'استشاري',
    government: 'جهة حكومية', hotel: 'فندق', office: 'مكاتب', other: 'أخرى',
  },
  timeline: {
    note: 'ملاحظة', call: 'مكالمة', meeting: 'اجتماع', site_visit: 'زيارة موقع', task: 'مهمة', whatsapp: 'واتساب', email: 'بريد',
    added: 'أُضيف إلى السجل', whatNeeded: 'ما المطلوب؟', subject: 'العنوان', details: 'تفاصيل (اختياري)', empty: 'لا يوجد نشاط بعد',
    due: 'الاستحقاق {d}',
  },
  partyPicker: { placeholder: 'ابحث عن عميل بالاسم أو الجوال أو الرقم الضريبي…' },
};

export type Dict = typeof ar;

const en: Dict = {
  common: {
    save: 'Save', cancel: 'Cancel', edit: 'Edit', add: 'Add', delete: 'Delete', close: 'Close', back: '← Back',
    loading: 'Loading…', searching: 'Searching…', search: 'Search…', noResults: 'No results', all: 'All',
    open: 'Open', view: 'View', remove: 'Remove', saved: 'Saved', done: 'Done', optional: 'optional',
    sar: 'SAR', from: 'From', to: 'To', name: 'Name', email: 'Email', mobile: 'Mobile',
    notes: 'Notes', type: 'Type', status: 'Status', date: 'Date', number: 'Number', total: 'Total',
    unassigned: '— Unassigned —', language: 'Language', switchTo: 'عربي', switchToTitle: 'التبديل إلى العربية',
  },
  shell: {
    brand: 'Al-Mada Al-Mubarak', menu: 'Menu', notifications: 'Notifications', markAllRead: 'Mark all as read',
    noNotifications: 'No notifications', signOut: 'Sign out', vatNotRegistered: 'Company not registered for VAT',
  },
  status: {
    draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved', sent: 'Sent', viewed: 'Viewed',
    accepted: 'Accepted', rejected: 'Rejected', expired: 'Expired', lost: 'Lost', superseded: 'Superseded by newer revision',
    sent_for_signature: 'Awaiting signature', signed: 'Signed', active: 'Active', completed: 'Completed', terminated: 'Terminated',
    cancelled: 'Cancelled', pending: 'Upcoming', requested: 'Requested', invoiced: 'Invoiced', partially_paid: 'Partially paid',
    paid: 'Paid', billed: 'Billed', issued: 'Issued', new: 'New', contacted: 'Contacted', qualified: 'Qualified', unqualified: 'Unqualified',
    converted: 'Converted', invited: 'Invited', suspended: 'Suspended', cleared: 'Cleared by ZATCA', reported: 'Reported to ZATCA',
    not_applicable: 'Not applicable', open: 'Open', closed: 'Closed', legacy: 'Imported from legacy system',
    legacy_phase1: 'Phase 1 (legacy system)', warning: 'Accepted with warning', error: 'Error',
  },
  login: {
    brandTag: 'Trading & Smart Solutions',
    pitch: 'Quotes, contracts, customers and invoices — in one platform.',
    pitchSub: 'Access is by invitation only.',
    hosted: 'MMC Core · Data hosted in Saudi Arabia',
    titleSignin: 'Sign in', titleSignup: 'Activate your account', title2fa: 'Two-step verification', titleSent: 'Check your email',
    subSignin: 'Sign in to MMC Core', subSignup: 'Invited staff only — use the e-mail address your invitation was sent to.',
    sub2fa: 'Enter the 6-digit code from your authenticator app.',
    sentText: 'We sent an activation link to {email}. Open it to finish signing in.', backToSignin: 'Back to sign in',
    code: 'Verification code', verify: 'Verify', google: 'Sign in with Google', passkey: 'Sign in with a passkey',
    orEmail: 'or with e-mail and password', password: 'Password', passwordHint: 'At least 12 characters — a long phrase is best',
    activate: 'Activate account', signIn: 'Sign in', firstTime: 'First time and invited?', activateLink: 'Activate your account',
    haveAccount: 'I have an account — sign in',
    errVerify: 'Please verify your e-mail first — we sent you an activation link.', errGeneric: 'Could not sign in',
  },
  cockpit: {
    hello: 'Welcome, {name}', period: 'Period {from} — {to}', title: 'Cockpit', newQuote: 'New quote', newLead: 'New lead',
    noQuotes: 'No quotes in this period', dailyValue: 'Daily quote value', quotes: 'Quotes', accepted: 'Accepted',
    winRate: 'Win rate', lostN: '{n} lost', pendingApproval: 'Pending approval', avgDiscount: 'Average discount',
    margin: 'Margin', overdueTasks: 'My overdue tasks', openN: '{n} open', arOutstanding: 'Receivables outstanding',
    overdue: 'Overdue:', openRequests: 'Open payment requests', leads: 'Leads', leadsHint: '{fresh} new · {converted} converted',
    myTasks: 'My tasks', overdueN: '{n} overdue', noOverdue: 'Nothing overdue', pipeline: 'Pipeline', weighted: 'Weighted:',
    team: 'Sales team performance', rep: 'Rep', repQuotes: 'Quotes', repWon: 'Accepted', quotesValue: 'Quotes value', wonValue: 'Accepted value',
  },
  customers: {
    title: 'Customers', count: '{n} records', new: 'New customer', searchPh: 'Name, VAT number, mobile…',
    roleCustomers: 'Customers', roleSuppliers: 'Suppliers', rolePartners: 'Partners',
    empty: 'No customers yet', emptyHint: 'Add your first customer, or convert a lead from the Leads screen.',
    colName: 'Name', colIds: 'VAT / unified number', colMobile: 'Mobile', colType: 'Type', colSegment: 'Segment',
    customer: 'Customer', supplier: 'Supplier', partner: 'Partner', b2b: 'Business (B2B)', b2c: 'Individual (B2C)',
    saveCustomer: 'Save customer', savedCustomer: 'Customer saved', primaryContact: 'Primary contact (optional)',
    whatsappMobile: 'Mobile / WhatsApp', contactEmail: 'Email', siteCity: 'Site city', siteCityPh: 'Jeddah',
    vatBadge: 'VAT {v}', unifiedBadge: 'Unified {v}', balanceDue: 'Balance due', quote: 'Quote',
    tabOverview: 'Overview', tabQuotes: 'Quotes', tabContracts: 'Contracts', tabInvoices: 'Invoices', tabTimeline: 'Timeline',
    contacts: 'Contacts', noContacts: 'No contacts', whatsapp: 'WhatsApp', sites: 'Addresses & sites', noSites: 'No sites',
    siteBilling: 'Billing', siteProject: 'Project', opportunities: 'Opportunities', noQuotes: 'No quotes for this customer', noContracts: 'No contracts',
    noInvoices: 'No invoices', statement: 'Statement of account', colValue: 'Value', colRemaining: 'Remaining', colZatca: 'ZATCA',
    saveChanges: 'Save changes',
    editContact: 'Edit contact', newContact: 'New contact', nameReq: 'Name *', jobTitle: 'Job title',
    whatsappPh: 'Same as mobile if left empty', preferredChannel: 'Preferred channel', chWhatsapp: 'WhatsApp', chPhone: 'Phone call',
    chEmail: 'Email', chSms: 'SMS', isPrimary: 'Primary contact',
    siteTitle: 'National address / project site', siteName: 'Site name *', siteTypeProject: 'Project', siteTypeBilling: 'Billing address',
    siteTypeSite: 'Site', buildingNumber: 'Building number (4 digits)', street: 'Street', district: 'District', city: 'City',
    postalCode: 'Postal code (5 digits)', additionalNumber: 'Additional number', mapLink: 'Map link',
  },
  partyForm: {
    kind: 'Type', org: 'Organization / company', individual: 'Individual', segment: 'Segment', nameAr: 'Name (Arabic) *', nameEn: 'Name (English)',
    unified: 'Unified number (7xxxxxxxxx)', unifiedErr: '10 digits starting with 7', vat: 'VAT number', vatErr: '15 digits, starting and ending with 3',
    vatHint: 'Required for business (B2B) invoices', terms: 'Payment terms (days)', source: 'Source', sourcePh: 'Referral, exhibition, WhatsApp…',
    isCustomer: 'Customer', isSupplier: 'Supplier', isPartner: 'Partner / consultant', b2b: 'Business tax invoice (B2B)',
  },
  segment: {
    contractor: 'Contractor', developer: 'Real-estate developer', building_owner: 'Building owner', villa_owner: 'Villa owner', consultant: 'Consultant',
    government: 'Government', hotel: 'Hotel', office: 'Offices', other: 'Other',
  },
  timeline: {
    note: 'Note', call: 'Call', meeting: 'Meeting', site_visit: 'Site visit', task: 'Task', whatsapp: 'WhatsApp', email: 'Email',
    added: 'Added to the timeline', whatNeeded: 'What needs doing?', subject: 'Subject', details: 'Details (optional)', empty: 'No activity yet',
    due: 'due {d}',
  },
  partyPicker: { placeholder: 'Search customers by name, mobile or VAT number…' },
};

export const DICTS: Record<Locale, Dict> = { ar, en };

type Leaves<T, P extends string = ''> = { [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`> }[keyof T & string];
export type TKey = Leaves<Dict>;
export type TVars = Record<string, string | number | null | undefined>;

function lookup(locale: Locale, key: string): string | undefined {
  let cur: unknown = DICTS[locale];
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as object)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(s: string, vars?: TVars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

// ───────────────────────────── runtime ─────────────────────────────

let currentLocale: Locale = 'ar';

/** Two-language pair, resolved at call time. For render code prefer `useI18n().bi` (it re-renders on switch). */
export function bi(arText: string, enText: string): string {
  return currentLocale === 'en' ? enText : arText;
}

function readCookieLocale(): Locale | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)mmc_locale=(ar|en)\b/);
  return m ? (m[1] as Locale) : null;
}
function safeLS(fn: () => void) {
  try { fn(); } catch { /* storage blocked */ }
}
function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function persistLocal(l: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  safeLS(() => localStorage.setItem(LOCALE_COOKIE, l));
}
function applyDocument(l: Locale) {
  const el = document.documentElement;
  el.lang = l;
  el.dir = dirOf(l);
}

interface I18nCtx {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  t: (key: TKey, vars?: TVars) => string;
  /** Translate a dynamic key (e.g. `status.${s}`), falling back when it is missing. */
  tx: (key: string, fallback: string, vars?: TVars) => string;
  has: (key: string) => boolean;
  bi: (arText: string, enText: string) => string;
  setLocale: (l: Locale) => void;
  /** Called by the Shell once `/me` is loaded (see header comment). */
  syncUserLocale: (serverLocale: string | null | undefined) => void;
}

function makeCtx(locale: Locale, setLocale: (l: Locale) => void, syncUserLocale: (l: string | null | undefined) => void): I18nCtx {
  return {
    locale,
    dir: dirOf(locale),
    t: (key, vars) => interpolate(lookup(locale, key) ?? lookup('ar', key) ?? key, vars),
    tx: (key, fallback, vars) => interpolate(lookup(locale, key) ?? fallback, vars),
    has: (key) => lookup(locale, key) !== undefined,
    bi: (a, e) => (locale === 'en' ? e : a),
    setLocale,
    syncUserLocale,
  };
}

const Ctx = createContext<I18nCtx>(makeCtx('ar', () => {}, () => {}));

export function I18nProvider({ initialLocale = 'ar', children }: { initialLocale?: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const qc = useQueryClient();
  const signedIn = useRef(false);
  const synced = useRef<string | null>(null);
  const localeRef = useRef<Locale>(locale);
  localeRef.current = locale;
  currentLocale = locale;

  // No cookie (first visit after clearing cookies) → fall back to localStorage.
  useEffect(() => {
    if (readCookieLocale()) return;
    const stored = lsGet(LOCALE_COOKIE);
    if (isLocale(stored) && stored !== locale) {
      localeRef.current = stored;
      setLocaleState(stored);
      applyDocument(stored);
    }
    if (isLocale(stored)) persistLocal(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushToServer = useCallback((l: Locale) => {
    fetch('/api/me', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: l }) }).catch(() => {});
    qc.setQueryData(['me'], (old: { user: { locale: string } } | undefined) => (old ? { ...old, user: { ...old.user, locale: l } } : old));
    synced.current = l;
  }, [qc]);

  const setLocale = useCallback((l: Locale) => {
    if (!isLocale(l)) return;
    currentLocale = l;
    localeRef.current = l;
    setLocaleState(l);
    applyDocument(l);
    persistLocal(l);
    if (signedIn.current) pushToServer(l);
    else safeLS(() => localStorage.setItem(PENDING_KEY, '1'));
  }, [pushToServer]);

  const syncUserLocale = useCallback((serverLocale: string | null | undefined) => {
    signedIn.current = true;
    if (synced.current === (serverLocale ?? '')) return;
    synced.current = serverLocale ?? '';
    const pending = lsGet(PENDING_KEY) === '1';
    safeLS(() => localStorage.removeItem(PENDING_KEY));
    const cur = localeRef.current;
    if (pending || !isLocale(serverLocale)) {
      if (serverLocale !== cur) pushToServer(cur);
      return;
    }
    if (serverLocale !== cur) {
      currentLocale = serverLocale;
      localeRef.current = serverLocale;
      setLocaleState(serverLocale);
      applyDocument(serverLocale);
      persistLocal(serverLocale);
    }
  }, [pushToServer]);

  const value = useMemo(() => makeCtx(locale, setLocale, syncUserLocale), [locale, setLocale, syncUserLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

/** عربي / English switch button. */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, t, setLocale } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      title={t('common.switchToTitle')}
      aria-label={t('common.switchToTitle')}
      lang={locale === 'ar' ? 'en' : 'ar'}
      className={className ?? 'rounded-lg border border-line px-2.5 py-1 text-xs font-bold text-ink hover:bg-black/5'}
    >
      {t('common.switchTo')}
    </button>
  );
}
