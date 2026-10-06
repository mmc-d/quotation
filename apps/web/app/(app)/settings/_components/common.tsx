'use client';
import { ShieldAlert } from 'lucide-react';
import { ROLE_TEMPLATES } from '@mmc/domain';
import { Card, Empty, PageHeader, Spinner } from '@/components/ui';
import { useMe } from '@/lib/me';
import { bi as biNow, useI18n, type Locale } from '@/lib/i18n';
import type { ReactNode } from 'react';

/** Renders children only when the user holds `perm` (the API would refuse anyway). */
export function RequirePerm({ perm, title, children }: { perm: string | string[]; title: string; children: ReactNode }) {
  const { can, loading, me } = useMe();
  const { bi } = useI18n();
  if (loading || !me) return <Spinner />;
  const perms = Array.isArray(perm) ? perm : [perm];
  if (!perms.some((p) => can(p))) {
    return (
      <>
        <PageHeader title={title} />
        <Card><Empty icon={<ShieldAlert className="size-8" />} title={bi('لا تملك صلاحية الوصول إلى هذه الصفحة', 'You do not have access to this page')} hint={bi('تواصل مع مدير النظام إذا كنت تحتاج هذه الصلاحية.', 'Contact your system administrator if you need this permission.')} /></Card>
      </>
    );
  }
  return <>{children}</>;
}

export const SCOPES = ['own', 'team', 'branch', 'company', 'all'] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_AR: Record<Scope, string> = { own: 'الخاصة', team: 'الفريق', branch: 'الفرع', company: 'المنشأة', all: 'الكل' };
export const SCOPE_EN: Record<Scope, string> = { own: 'Own', team: 'Team', branch: 'Branch', company: 'Company', all: 'All' };

export const PERM_GROUP_AR: Record<string, string> = {
  admin: 'الإدارة', party: 'العملاء والموردون', product: 'المنتجات', quote: 'عروض الأسعار', contract: 'العقود',
  lead: 'العملاء المحتملون', opportunity: 'الفرص', activity: 'المهام والأنشطة', message: 'الرسائل',
  billing: 'طلبات الدفع', invoice: 'الفواتير', payment: 'المدفوعات', report: 'التقارير',
};
export const PERM_GROUP_EN: Record<string, string> = {
  admin: 'Administration', party: 'Customers & suppliers', product: 'Products', quote: 'Quotations', contract: 'Contracts',
  lead: 'Leads', opportunity: 'Opportunities', activity: 'Tasks & activities', message: 'Messages',
  billing: 'Payment requests', invoice: 'Invoices', payment: 'Payments', report: 'Reports',
};
export const PERM_GROUP_ORDER = ['admin', 'party', 'product', 'quote', 'contract', 'lead', 'opportunity', 'activity', 'message', 'billing', 'invoice', 'payment', 'report'];

export const PERM_AR: Record<string, string> = {
  'admin.users': 'إدارة المستخدمين', 'admin.roles': 'تعديل الأدوار والصلاحيات', 'admin.settings': 'إعدادات المنشأة', 'admin.audit': 'سجل التدقيق',
  'party.read': 'عرض العملاء', 'party.write': 'إضافة وتعديل العملاء',
  'product.read': 'عرض المنتجات', 'product.write': 'إضافة وتعديل المنتجات', 'product.cost.read': 'رؤية سعر الشراء',
  'quote.read': 'عرض العروض', 'quote.write': 'إنشاء وتعديل العروض', 'quote.approve': 'اعتماد العروض', 'quote.send': 'إرسال العروض', 'quote.cost.read': 'رؤية التكلفة والهامش',
  'contract.read': 'عرض العقود', 'contract.write': 'إنشاء وتعديل العقود', 'contract.sign': 'توقيع العقود', 'contract.stamp': 'طباعة العقد بالختم',
  'lead.read': 'عرض العملاء المحتملين', 'lead.write': 'إضافة وتعديل العملاء المحتملين',
  'opportunity.read': 'عرض الفرص', 'opportunity.write': 'إدارة الفرص',
  'activity.read': 'عرض الأنشطة', 'activity.write': 'تسجيل الأنشطة',
  'message.read': 'قراءة الرسائل', 'message.send': 'إرسال الرسائل',
  'billing.read': 'عرض طلبات الدفع', 'billing.write': 'إنشاء طلبات الدفع',
  'invoice.read': 'عرض الفواتير', 'invoice.issue': 'إصدار الفواتير',
  'payment.read': 'عرض المدفوعات', 'payment.record': 'تسجيل المدفوعات',
  'report.sales': 'تقارير المبيعات', 'report.finance': 'التقارير المالية',
};

export const PERM_EN: Record<string, string> = {
  'admin.users': 'Manage users', 'admin.roles': 'Edit roles & permissions', 'admin.settings': 'Company settings', 'admin.audit': 'Audit log',
  'party.read': 'View customers', 'party.write': 'Add & edit customers',
  'product.read': 'View products', 'product.write': 'Add & edit products', 'product.cost.read': 'See purchase price',
  'quote.read': 'View quotations', 'quote.write': 'Create & edit quotations', 'quote.approve': 'Approve quotations', 'quote.send': 'Send quotations', 'quote.cost.read': 'See cost & margin',
  'contract.read': 'View contracts', 'contract.write': 'Create & edit contracts', 'contract.sign': 'Sign contracts', 'contract.stamp': 'Print contract with stamp',
  'lead.read': 'View leads', 'lead.write': 'Add & edit leads',
  'opportunity.read': 'View opportunities', 'opportunity.write': 'Manage opportunities',
  'activity.read': 'View activities', 'activity.write': 'Log activities',
  'message.read': 'Read messages', 'message.send': 'Send messages',
  'billing.read': 'View payment requests', 'billing.write': 'Create payment requests',
  'invoice.read': 'View invoices', 'invoice.issue': 'Issue invoices',
  'payment.read': 'View payments', 'payment.record': 'Record payments',
  'report.sales': 'Sales reports', 'report.finance': 'Financial reports',
};

export interface RoleRow { id: string; key: string; nameAr: string; nameEn: string; grants: Record<string, Scope>; maxDiscountPercent: number; isSystem: boolean }

/** Role display name; pass `locale` ('en') to prefer the English name when there is one. */
export function roleLabel(key: string, roles?: RoleRow[], locale: Locale = 'ar'): string {
  const r = roles?.find((x) => x.key === key);
  if (locale === 'en') return r?.nameEn || ROLE_TEMPLATES[key]?.name_en || r?.nameAr || key;
  return r?.nameAr ?? ROLE_TEMPLATES[key]?.name_ar ?? key;
}

/** File → base64 (no data: prefix). */
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result ?? ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error(biNow('تعذّرت قراءة الملف', 'Could not read the file')));
    r.readAsDataURL(file);
  });
}

export function InfoNote({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'amber' | 'blue' }) {
  const cls = tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : tone === 'blue' ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-gold/40 bg-tint/60 text-ink';
  return <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${cls}`}>{children}</div>;
}
