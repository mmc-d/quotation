'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronLeft, ChevronRight, Lightbulb, PlayCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalKbSummary, type Rows } from './portal-api';

/** One help-article row (portal). */
export function KbRow({ a }: { a: PortalKbSummary }) {
  const { bi, locale, dir } = useI18n();
  const Chevron = dir === 'rtl' ? ChevronLeft : ChevronRight;
  return (
    <Link href={`/portal/help/${encodeURIComponent(a.slug)}`} className="group flex items-start gap-3 rounded-xl px-2 py-3 transition hover:bg-tint/50 focus-visible:bg-tint/50">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-tint text-gold-dark">{a.hasVideo ? <PlayCircle className="size-4" aria-label={bi('فيديو', 'Video')} /> : <BookOpen className="size-4" aria-hidden />}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-primary group-hover:underline">{locale === 'en' ? a.titleEn || a.titleAr : a.titleAr}</span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{locale === 'en' ? a.excerptEn || a.excerptAr : a.excerptAr}</span>
      </span>
      <Chevron className="mt-2 size-4 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}

/** "Before you send: these may help" — up to 3 public articles for the chosen device. */
export function SuggestedArticles({ assetId }: { assetId: string | null }) {
  const { bi } = useI18n();
  const q = useQuery({
    queryKey: ['portal', 'kb-suggest', assetId],
    queryFn: () => portalFetch<Rows<PortalKbSummary>>(`/kb/suggest?assetId=${encodeURIComponent(assetId!)}`),
    enabled: !!assetId,
    retry: portalRetry,
    staleTime: 300_000,
  });
  const rows = q.data?.rows ?? [];
  if (!assetId || rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-gold/50 bg-tint/40 p-3" role="note">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-primary"><Lightbulb className="size-4 text-gold-dark" aria-hidden />{bi('قبل الإرسال: قد تحل هذه الإرشادات المشكلة', 'Before you send: these guides may solve it')}</p>
      <div className="divide-y divide-line/70">{rows.map((a) => <KbRow key={a.id} a={a} />)}</div>
    </div>
  );
}
