'use client';
import type { ReactNode } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { clsx } from '@/components/ui';

/** Branded, mobile-first frame for customer-facing pages (no staff shell). */
export function PublicShell({ children, companyName, subtitle, narrow, privateLink = true }: { children: ReactNode; companyName?: string | null; subtitle?: ReactNode; narrow?: boolean; privateLink?: boolean }) {
  return (
    <div dir="rtl" className="flex min-h-screen flex-col bg-[#f6f5f1]">
      <header className="relative overflow-hidden bg-primary text-white print:bg-white print:text-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(194,160,74,.35),transparent_55%)] print:hidden" />
        <div className={clsx('relative mx-auto flex items-center justify-between gap-3 px-4 py-4', narrow ? 'max-w-xl' : 'max-w-3xl')}>
          <div className="leading-tight">
            <div className="text-lg font-extrabold sm:text-xl">{companyName || 'المدى المبارك'}</div>
            <div className="text-[11px] font-bold text-gold-light">للتجارة والحلول الذكية</div>
          </div>
          {subtitle && <div className="text-end text-xs font-bold text-white/80 print:text-muted">{subtitle}</div>}
        </div>
        <div className="h-1 bg-gold" />
      </header>
      <main className={clsx('mx-auto w-full flex-1 px-4 py-5 sm:py-8', narrow ? 'max-w-xl' : 'max-w-3xl')}>{children}</main>
      <footer className="border-t border-line bg-white/60 py-4 text-center text-[11px] text-muted print:hidden">
        {privateLink && <div className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-primary" />رابط آمن ومخصص لك — لا تشاركه مع غيرك</div>}
        <div className="mt-1">© {new Date().getFullYear()} المدى المبارك · بيانات مستضافة في المملكة العربية السعودية</div>
      </footer>
    </div>
  );
}

export function PublicCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx('rounded-2xl border border-line bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,.05)] sm:p-6', className)}>{children}</section>;
}

export function PublicLoading() {
  return (
    <PublicShell narrow>
      <div className="flex items-center justify-center gap-2 py-24 text-muted"><Loader2 className="size-5 animate-spin" />جارٍ التحميل…</div>
    </PublicShell>
  );
}

export function PublicState({ icon, title, children, tone = 'primary' }: { icon: ReactNode; title: ReactNode; children?: ReactNode; tone?: 'primary' | 'gold' | 'danger' | 'muted' }) {
  const tones = { primary: 'bg-primary-50 text-primary', gold: 'bg-tint text-gold-dark', danger: 'bg-rose-50 text-danger', muted: 'bg-gray-100 text-muted' };
  return (
    <PublicCard className="text-center">
      <div className={clsx('mx-auto mb-3 grid size-16 place-items-center rounded-full', tones[tone])}>{icon}</div>
      <h1 className="text-xl font-extrabold text-ink">{title}</h1>
      {children && <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{children}</div>}
    </PublicCard>
  );
}

/** Server error messages are English; translate the ones a customer can hit. */
const MESSAGES: [RegExp, string][] = [
  [/wrong code/i, 'الرمز غير صحيح — تحقق من الرسالة وحاول مرة أخرى.'],
  [/too many wrong attempts/i, 'محاولات خاطئة كثيرة — اطلب رمزًا جديدًا.'],
  [/too many codes/i, 'طلبت رموزًا كثيرة — حاول بعد 10 دقائق.'],
  [/code expired/i, 'انتهت صلاحية الرمز — اطلب رمزًا جديدًا.'],
  [/no longer be accepted/i, 'لم يعد بالإمكان قبول هذا العرض إلكترونيًا — تواصل مع مندوب المبيعات.'],
  [/no mobile number/i, 'لا يوجد رقم جوال مسجل لهذا العرض — تواصل مع مندوب المبيعات.'],
  [/identity check failed/i, 'آخر 4 أرقام من الهوية غير مطابقة.'],
  [/too many submissions/i, 'تم استلام طلبات كثيرة من هذا الجهاز — حاول لاحقًا.'],
  [/saudi mobile/i, 'أدخل رقم جوال سعودي صحيح (05XXXXXXXX).'],
  [/sandbox .* disabled/i, 'الدفع التجريبي غير متاح.'],
  [/not found/i, 'الرابط غير صالح أو انتهت صلاحيته.'],
];

export class PublicError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function friendly(msg: string): string {
  for (const [re, ar] of MESSAGES) if (re.test(msg)) return ar;
  return msg;
}

/** fetch wrapper for /api/public/* (no session, no login redirect). */
export async function publicFetch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/public${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: { message?: string } | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const raw = json?.message ?? (res.status === 404 ? 'not found' : `HTTP ${res.status}`);
    throw new PublicError(friendly(raw), res.status);
  }
  return json as T;
}

export function InlineError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-danger">{message}</div>;
}
