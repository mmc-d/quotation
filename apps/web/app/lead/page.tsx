'use client';
import { Suspense, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Send } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { InlineError, PublicCard, PublicShell, PublicState, publicFetch } from '@/app/_public/public-shell';
import { useI18n } from '@/lib/i18n';

const INTEREST_LABELS: Record<string, [string, string]> = {
  intercom: ['الإنتركم والاتصال الداخلي', 'Intercom & internal communication'],
  smart_home: ['المنزل الذكي', 'Smart home'],
  locks: ['الأقفال الذكية', 'Smart locks'],
  cctv: ['كاميرات المراقبة', 'CCTV cameras'],
  iot: ['إنترنت الأشياء (IoT)', 'Internet of Things (IoT)'],
  networking: ['الشبكات', 'Networking'],
  access_control: ['أنظمة التحكم بالدخول', 'Access control systems'],
  other: ['أخرى', 'Other'],
};

const CITIES = ['الرياض', 'جدة', 'مكة المكرمة', 'المدينة المنورة', 'الدمام', 'الخبر', 'الظهران', 'الطائف', 'أبها', 'تبوك', 'بريدة', 'حائل', 'جازان', 'نجران', 'الأحساء', 'ينبع'];
/** English labels for the city list (the stored value stays Arabic). */
const CITIES_EN: Record<string, string> = {
  'الرياض': 'Riyadh', 'جدة': 'Jeddah', 'مكة المكرمة': 'Makkah', 'المدينة المنورة': 'Madinah', 'الدمام': 'Dammam', 'الخبر': 'Khobar',
  'الظهران': 'Dhahran', 'الطائف': 'Taif', 'أبها': 'Abha', 'تبوك': 'Tabuk', 'بريدة': 'Buraydah', 'حائل': 'Hail', 'جازان': 'Jazan',
  'نجران': 'Najran', 'الأحساء': 'Al-Ahsa', 'ينبع': 'Yanbu',
};

function isSaudiMobile(v: string) {
  const digits = v.replace(/[\s-]/g, '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  return /^(?:\+?966|00966|0)?5\d{8}$/.test(digits);
}

function LeadForm() {
  const { bi, locale } = useI18n();
  const params = useSearchParams();
  const utm = useMemo(() => {
    const u: Record<string, string> = {};
    params.forEach((v, k) => { if ((k.startsWith('utm_') || k === 'gclid' || k === 'fbclid' || k === 'ref') && v) u[k] = v.slice(0, 200); });
    return Object.keys(u).length ? u : null;
  }, [params]);

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [interest, setInterest] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => publicFetch<{ ok: boolean; reference?: string }>('/leads', {
      name: name.trim(), mobile: mobile.trim(), email: email.trim() || null, city: city || null, interest: interest || null,
      message: message.trim() || null, consent, website, utm,
    }),
    onError: (e: Error) => setErr(e.message),
  });

  if (submit.isSuccess) {
    return (
      <PublicState icon={<CheckCircle2 className="size-8" />} title={bi('شكرًا لك — استلمنا طلبك', 'Thank you — we have received your request')}>
        {bi('سيتواصل معك أحد مستشارينا خلال يوم عمل.', 'One of our consultants will contact you within one business day.')}
        {submit.data.reference && <div className="mt-3 rounded-lg bg-tint px-3 py-2 text-ink">{bi('رقم المرجع:', 'Reference number:')} <b className="num">{submit.data.reference}</b></div>}
      </PublicState>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) return setErr(bi('يرجى إدخال الاسم.', 'Please enter your name.'));
    if (!isSaudiMobile(mobile)) return setErr(bi('أدخل رقم جوال سعودي صحيح (05XXXXXXXX).', 'Enter a valid Saudi mobile number (05XXXXXXXX).'));
    if (!consent) return setErr(bi('يرجى الموافقة على سياسة الخصوصية للمتابعة.', 'Please accept the privacy policy to continue.'));
    submit.mutate();
  };

  return (
    <PublicCard>
      <h1 className="text-xl font-extrabold text-primary">{bi('اطلب عرض سعر', 'Request a quote')}</h1>
      <p className="mb-5 mt-1 text-sm text-muted">{bi('أخبرنا عن مشروعك وسنرسل لك عرض سعر مناسب — أنظمة الإنتركم، المنزل الذكي، الأقفال، الكاميرات والشبكات.', 'Tell us about your project and we will send you a suitable quote — intercom systems, smart home, locks, cameras and networking.')}</p>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bi('الاسم *', 'Name *')}><Input required maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={bi('رقم الجوال *', 'Mobile number *')}><Input required type="tel" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="05XXXXXXXX" maxLength={20} value={mobile} onChange={(e) => setMobile(e.target.value)} className="text-end" /></Field>
          <Field label={bi('البريد الإلكتروني', 'Email')}><Input type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="text-end" /></Field>
          <Field label={bi('المدينة', 'City')}>
            <Select value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">{bi('اختر المدينة', 'Select city')}</option>
              {CITIES.map((c) => <option key={c} value={c}>{locale === 'en' ? CITIES_EN[c] ?? c : c}</option>)}
              <option value="أخرى">{bi('أخرى', 'Other')}</option>
            </Select>
          </Field>
        </div>
        <Field label={bi('ما الذي تحتاجه؟', 'What do you need?')}>
          <Select value={interest} onChange={(e) => setInterest(e.target.value)}>
            <option value="">{bi('اختر', 'Select')}</option>
            {Object.entries(INTEREST_LABELS).map(([k, v]) => <option key={k} value={k}>{bi(v[0], v[1])}</option>)}
          </Select>
        </Field>
        <Field label={bi('تفاصيل المشروع', 'Project details')}><Textarea rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={bi('نوع المبنى، عدد الوحدات، الموقع، الموعد المتوقع…', 'Building type, number of units, location, expected timeline…')} /></Field>

        {/* Honeypot — hidden from people, filled by bots. */}
        <div aria-hidden="true" className="absolute -start-[10000px] top-auto h-px w-px overflow-hidden">
          <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        </div>

        <label className="flex items-start gap-2 rounded-lg bg-tint/50 p-3 text-xs leading-relaxed text-ink">
          <input type="checkbox" required className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{bi('أوافق على جمع بياناتي ومعالجتها لغرض التواصل معي وتقديم عرض السعر، وفق نظام حماية البيانات الشخصية في المملكة العربية السعودية. لن نشارك بياناتك مع أي طرف ثالث لأغراض تسويقية.', 'I agree to the collection and processing of my data so you can contact me and provide a quote, in line with the Saudi Personal Data Protection Law. We will not share your data with any third party for marketing purposes.')}</span>
        </label>

        <InlineError message={err} />
        <Button className="w-full py-3 text-base" loading={submit.isPending} icon={<Send className="size-5" />}>{bi('إرسال الطلب', 'Send request')}</Button>
      </form>
    </PublicCard>
  );
}

export default function LeadPage() {
  const { bi } = useI18n();
  return (
    <PublicShell narrow privateLink={false} subtitle={bi('اطلب عرض سعر', 'Request a quote')}>
      <Suspense fallback={null}><LeadForm /></Suspense>
    </PublicShell>
  );
}
