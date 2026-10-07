'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Eye, Globe2, Lock, PlayCircle, ThumbsUp } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { clsx } from '@/components/ui';

export interface KbSummary {
  id: string; slug: string; titleAr: string; titleEn: string | null; visibility: 'internal' | 'public'; status: 'draft' | 'published' | 'archived';
  categoryId: string | null; category?: { nameAr: string; nameEn: string | null } | null; productIds: string[]; tags: string[]; hasVideo: boolean;
  views: number; helpfulYes: number; helpfulNo: number; excerptAr: string; excerptEn: string | null; updatedAt: string; createdAt: string;
}
export interface KbArticle {
  id: string; slug: string; titleAr: string; titleEn: string | null; bodyAr: string; bodyEn: string | null; visibility: 'internal' | 'public'; status: 'draft' | 'published' | 'archived';
  categoryId: string | null; category: { nameAr: string; nameEn: string | null } | null; productIds: string[]; tags: string[]; fileIds: string[]; videoUrl: string | null;
  views: number; helpfulYes: number; helpfulNo: number; version: number; createdAt: string; updatedAt: string; createdByName: string | null; updatedByName: string | null;
  products: { id: string; code: string; nameAr: string; nameEn: string | null }[];
  files: { id: string; filename: string; mime: string; size: number; url: string }[];
}
export interface KbMeta { categories: { id: string; nameAr: string; nameEn: string | null }[]; products: { id: string; code: string; nameAr: string; nameEn: string | null }[]; placeholders: string[] }

export const KB_STATUS: Record<string, [string, string, string]> = {
  draft: ['مسودة', 'Draft', 'bg-gray-100 text-gray-700'],
  published: ['منشور', 'Published', 'bg-emerald-100 text-emerald-800'],
  archived: ['مؤرشف', 'Archived', 'bg-gray-200 text-gray-600'],
};

export function KbStatusBadge({ status }: { status: string }) {
  const { locale } = useI18n();
  const s = KB_STATUS[status];
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold', s?.[2] ?? 'bg-gray-100 text-gray-700')}>{s ? (locale === 'en' ? s[1] : s[0]) : status}</span>;
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  const { bi } = useI18n();
  return visibility === 'public'
    ? <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800"><Globe2 className="size-3" />{bi('عام (البوابة)', 'Public (portal)')}</span>
    : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"><Lock className="size-3" />{bi('داخلي', 'Internal')}</span>;
}

export const titleOf = (a: { titleAr: string; titleEn: string | null }, locale: string) => (locale === 'en' ? a.titleEn || a.titleAr : a.titleAr);

/** Compact list of published articles (internal + public) for a device — ticket screen, technician app. */
export function DeviceArticles({ assetId, title, compact }: { assetId: string | null | undefined; title?: string; compact?: boolean }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const enabled = !!assetId && can('kb.read');
  const q = useQuery({
    queryKey: ['kb-device', assetId],
    queryFn: () => api.get<{ rows: KbSummary[] }>(`/kb/articles${qs({ assetId, status: 'published', limit: 10 })}`),
    enabled,
  });
  if (!enabled) return null;
  const rows = (q.data?.rows ?? []).filter((r) => r.status === 'published');
  return (
    <div>
      {title && <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-primary"><BookOpen className="size-4 text-gold" />{title}</h3>}
      {q.isLoading ? <p className="text-xs text-muted">{bi('جارٍ التحميل…', 'Loading…')}</p> : rows.length === 0 ? (
        <p className="text-xs text-muted">{bi('لا توجد مقالات لهذا الجهاز بعد.', 'No articles for this device yet.')}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, compact ? 5 : 10).map((a) => (
            <li key={a.id}>
              <Link href={`/kb/${a.id}`} className="group block rounded-lg border border-line/70 px-2.5 py-1.5 hover:border-gold hover:bg-tint/50">
                <span className="flex items-center gap-1.5 text-sm font-bold text-primary group-hover:underline">
                  {a.hasVideo && <PlayCircle className="size-3.5 shrink-0 text-gold" aria-label={bi('فيديو', 'Video')} />}
                  <span className="truncate">{titleOf(a, locale)}</span>
                  {a.visibility === 'internal' && <Lock className="size-3 shrink-0 text-amber-700" aria-label={bi('داخلي', 'Internal')} />}
                </span>
                {!compact && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{locale === 'en' ? a.excerptEn || a.excerptAr : a.excerptAr}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ArticleStats({ a }: { a: { views: number; helpfulYes: number; helpfulNo: number } }) {
  const { bi } = useI18n();
  return (
    <span className="inline-flex items-center gap-3 text-xs text-muted">
      <span className="inline-flex items-center gap-1" title={bi('المشاهدات', 'Views')}><Eye className="size-3.5" /><span className="num">{a.views}</span></span>
      <span className="inline-flex items-center gap-1" title={bi('مفيد / غير مفيد', 'Helpful / not helpful')}><ThumbsUp className="size-3.5" /><span className="num">{a.helpfulYes}/{a.helpfulNo}</span></span>
    </span>
  );
}

/** Technician app: "How-to" card for the job's device (hidden without kb.read). */
export function TechHowTo({ assetId }: { assetId: string }) {
  const { bi } = useI18n();
  const { can } = useMe();
  if (!can('kb.read')) return null;
  return (
    <section id="sec-howto" className="scroll-mt-20 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.04)]">
      <DeviceArticles assetId={assetId} title={bi('طريقة العمل (قاعدة المعرفة)', 'How-to (knowledge base)')} />
    </section>
  );
}
