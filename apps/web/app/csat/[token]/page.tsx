'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileX2, Frown, Laugh, Meh, Smile, Star, Annoyed } from 'lucide-react';
import { Button, Textarea, clsx } from '@/components/ui';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { InlineError, PublicCard, PublicLoading, PublicShell, PublicState } from '@/app/_public/public-shell';
import { portalMessage } from '@/app/portal/_components/portal-api';

interface CsatView {
  company: { legalNameAr: string; legalNameEn: string | null; phone: string | null };
  number: string; title: string | null; technicianName: string | null; date: string; rated: boolean; score: number | null;
}

class CsatError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** /api/service/public/csat/:token — public, no session. */
async function csatFetch<T>(token: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/service/public/csat/${encodeURIComponent(token)}`, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: { message?: string } | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new CsatError(portalMessage(json?.message ?? (res.status === 404 ? 'not found' : `HTTP ${res.status}`)), res.status);
  return json as T;
}

const FACES = [
  { score: 1, icon: Frown, ar: 'سيئة جدًا', en: 'Very poor', tone: 'text-rose-600 border-rose-300 bg-rose-50' },
  { score: 2, icon: Annoyed, ar: 'سيئة', en: 'Poor', tone: 'text-orange-600 border-orange-300 bg-orange-50' },
  { score: 3, icon: Meh, ar: 'مقبولة', en: 'Okay', tone: 'text-amber-600 border-amber-300 bg-amber-50' },
  { score: 4, icon: Smile, ar: 'جيدة', en: 'Good', tone: 'text-emerald-600 border-emerald-300 bg-emerald-50' },
  { score: 5, icon: Laugh, ar: 'ممتازة', en: 'Excellent', tone: 'text-primary border-primary/40 bg-primary-50' },
] as const;

export default function CsatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['public-csat', token], queryFn: () => csatFetch<CsatView>(token), retry: false });
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<number | null>(null);

  const submit = useMutation({
    mutationFn: () => csatFetch<{ ok: boolean; score: number }>(token, { score, comment: comment.trim() || undefined }),
    onSuccess: (r) => { setThanks(r.score); qc.setQueryData<CsatView>(['public-csat', token], (d) => (d ? { ...d, rated: true, score: r.score } : d)); },
    onError: (e: Error) => {
      if (e instanceof CsatError && e.status === 409) { qc.invalidateQueries({ queryKey: ['public-csat', token] }); return; }
      setError(e.message);
    },
  });

  if (q.isLoading) return <PublicLoading />;
  if (q.error || !q.data) {
    return (
      <PublicShell narrow>
        <PublicState icon={<FileX2 className="size-8" />} tone="danger" title={bi('تعذر فتح الاستبيان', 'Could not open the survey')}>{(q.error as Error)?.message ?? bi('الرابط غير صالح أو انتهت صلاحيته.', 'This link is invalid or has expired.')}</PublicState>
      </PublicShell>
    );
  }
  const d = q.data;
  const company = locale === 'en' ? d.company.legalNameEn || d.company.legalNameAr : d.company.legalNameAr;
  const subtitle = <>{bi('تقييم الخدمة', 'Service rating')}<br /><span className="num">{d.number}</span></>;

  if (thanks || d.rated) {
    const s = thanks ?? d.score ?? 0;
    return (
      <PublicShell narrow companyName={company} subtitle={subtitle}>
        <PublicState icon={<CheckCircle2 className="size-8" />} title={thanks ? bi('شكرًا لك على تقييمك!', 'Thank you for your feedback!') : bi('تم تقييم هذه الزيارة مسبقًا', 'This visit has already been rated')}>
          {s > 0 && (
            <span className="mb-2 flex justify-center gap-1" aria-label={bi(`التقييم ${s} من 5`, `Rated ${s} of 5`)}>
              {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={clsx('size-7', i <= s ? 'fill-gold text-gold' : 'text-gray-300')} aria-hidden />)}
            </span>
          )}
          {thanks
            ? (thanks <= 2
              ? bi('نأسف لأن الخدمة لم تكن بالمستوى المطلوب. سيتواصل معك أحد مسؤولي الخدمة قريبًا.', 'We are sorry the service fell short. A service manager will contact you shortly.')
              : bi('رأيك يساعدنا على تحسين خدماتنا باستمرار.', 'Your feedback helps us keep improving our service.'))
            : bi('شكرًا لك — استلمنا تقييمك لهذه الزيارة.', 'Thank you — we already have your rating for this visit.')}
          {d.company.phone && <span className="mt-2 block">{bi('للتواصل', 'Contact us')}: <a href={`tel:${d.company.phone}`} className="num font-bold text-primary" dir="ltr">{d.company.phone}</a></span>}
        </PublicState>
      </PublicShell>
    );
  }

  const chosen = FACES.find((f) => f.score === score);

  return (
    <PublicShell narrow companyName={company} subtitle={subtitle}>
      <div className="space-y-4">
        <PublicCard>
          <h1 className="text-xl font-extrabold text-ink">{bi('كيف كانت زيارة الصيانة؟', 'How was the service visit?')}</h1>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-[11px] font-bold text-muted">{bi('أمر العمل', 'Work order')}</dt><dd className="num mt-0.5 font-bold text-ink" dir="ltr">{d.number}</dd></div>
            <div><dt className="text-[11px] font-bold text-muted">{bi('التاريخ', 'Date')}</dt><dd className="num mt-0.5 font-bold text-ink" dir="ltr">{date(d.date)}</dd></div>
            {d.technicianName && <div><dt className="text-[11px] font-bold text-muted">{bi('الفني', 'Technician')}</dt><dd className="mt-0.5 font-bold text-ink">{d.technicianName}</dd></div>}
          </dl>
          {d.title && <p className="mt-2 text-sm text-muted">{d.title}</p>}
        </PublicCard>

        <PublicCard>
          <form onSubmit={(e) => { e.preventDefault(); if (score) { setError(null); submit.mutate(); } }} className="space-y-4">
            <fieldset>
              <legend className="mb-3 text-sm font-extrabold text-primary">{bi('اختر تقييمك', 'Choose your rating')}</legend>
              <div role="radiogroup" aria-label={bi('التقييم من 1 إلى 5', 'Rating from 1 to 5')} className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {FACES.map((f) => {
                  const on = score === f.score;
                  return (
                    <button
                      key={f.score} type="button" role="radio" aria-checked={on} aria-label={`${f.score} — ${bi(f.ar, f.en)}`}
                      onClick={() => setScore(f.score)}
                      className={clsx('flex flex-col items-center gap-1 rounded-2xl border-2 px-1 py-3 transition active:scale-95', on ? f.tone : 'border-line bg-white text-gray-400 hover:border-gold/60 hover:text-gray-600')}
                    >
                      <f.icon className="size-9 sm:size-10" strokeWidth={on ? 2.25 : 1.75} aria-hidden />
                      <span className="flex gap-px" aria-hidden>{Array.from({ length: f.score }, (_, i) => <Star key={i} className={clsx('size-2.5', on ? 'fill-current' : 'fill-gray-300 text-gray-300')} />)}</span>
                      <span dir="auto" className="text-[10px] font-bold leading-tight sm:text-xs">{bi(f.ar, f.en)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {score !== null && (
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gold-dark">
                  {score <= 2 ? bi('ما الذي لم يعجبك؟ (اختياري)', 'What went wrong? (optional)') : bi('هل لديك ملاحظة؟ (اختياري)', 'Any comment? (optional)')}
                </span>
                <Textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={bi('اكتب ملاحظتك هنا…', 'Write your comment here…')} />
              </label>
            )}

            <InlineError message={error} />
            <Button type="submit" className="w-full py-3 text-base" disabled={!score} loading={submit.isPending}>
              {chosen ? bi(`إرسال التقييم (${chosen.ar})`, `Send rating (${chosen.en})`) : bi('اختر تقييمًا أولًا', 'Choose a rating first')}
            </Button>
            <p className="text-center text-[11px] text-muted">{bi('يمكن إرسال التقييم مرة واحدة فقط.', 'The rating can be sent only once.')}</p>
          </form>
        </PublicCard>
      </div>
    </PublicShell>
  );
}
