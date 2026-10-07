'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, PlayCircle, ThumbsDown, ThumbsUp, Wrench } from 'lucide-react';
import { PublicCard } from '@/app/_public/public-shell';
import { Button } from '@/components/ui';
import { Markdown, safeHref } from '@/components/markdown';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalKbArticle } from '../../_components/portal-api';
import { ErrorBlock, Loading, Num, PageTitle, sectionTitle } from '../../_components/portal-ui';

export default function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = use(params);
  const slug = decodeURIComponent(raw);
  const { bi, locale } = useI18n();
  const q = useQuery({ queryKey: ['portal', 'kb-article', slug], queryFn: () => portalFetch<PortalKbArticle>(`/kb/${encodeURIComponent(slug)}`), retry: portalRetry, staleTime: 300_000 });
  const [voted, setVoted] = useState<boolean | null>(null);
  const feedback = useMutation({
    mutationFn: (helpful: boolean) => portalFetch(`/kb/${encodeURIComponent(slug)}/feedback`, { body: { helpful } }),
    onSuccess: (_r, helpful) => setVoted(helpful),
  });
  const back = { href: '/portal/help', label: bi('مركز المساعدة', 'Help centre') };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <><PageTitle title={bi('مقال المساعدة', 'Help article')} back={back} /><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></>;
  const a = q.data;
  const en = locale === 'en' && !!a.bodyEn;
  const video = a.videoUrl ? safeHref(a.videoUrl) : null;

  return (
    <div className="space-y-4">
      <PageTitle back={back} title={en ? a.titleEn || a.titleAr : a.titleAr} subtitle={<>{bi('آخر تحديث', 'Updated')} <Num>{date(a.updatedAt)}</Num></>} />
      {a.products.length > 0 && (
        <p className="flex flex-wrap gap-1.5 text-xs">{a.products.map((p) => <span key={p.id} className="rounded-full bg-tint px-2 py-0.5 font-bold text-gold-dark"><Num>{p.code}</Num> · {locale === 'en' ? p.nameEn || p.nameAr : p.nameAr}</span>)}</p>
      )}
      {video && (
        <a href={video} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-2xl border border-gold/60 bg-tint/50 px-4 py-3 font-bold text-primary hover:bg-tint">
          <PlayCircle className="size-6 text-gold-dark" aria-hidden />{bi('شاهد مقطع الشرح', 'Watch the how-to video')}<ExternalLink className="ms-auto size-4" aria-hidden />
        </a>
      )}
      <PublicCard>
        <div dir={en ? 'ltr' : 'rtl'}><Markdown source={en ? a.bodyEn : a.bodyAr} className="text-[15px]" /></div>
      </PublicCard>
      {a.files.length > 0 && (
        <PublicCard>
          <h2 className={sectionTitle}><FileText className="size-4" aria-hidden />{bi('مرفقات', 'Attachments')}</h2>
          <ul className="flex flex-wrap gap-2">
            {a.files.map((f) => (
              <li key={f.id}>
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-line hover:border-gold">
                  {f.mime.startsWith('image/')
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={f.url} alt={f.filename} loading="lazy" className="size-24 object-cover" />
                    : <span className="flex h-24 w-32 flex-col items-center justify-center gap-1 px-2 text-xs text-primary"><FileText className="size-6" aria-hidden /><span dir="ltr" className="max-w-full truncate">{f.filename}</span></span>}
                </a>
              </li>
            ))}
          </ul>
        </PublicCard>
      )}
      <PublicCard>
        {voted === null ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-ink">{bi('هل ساعدك هذا المقال؟', 'Did this article help?')}</span>
            <Button variant="outline" size="sm" icon={<ThumbsUp className="size-4" aria-hidden />} loading={feedback.isPending && feedback.variables === true} onClick={() => feedback.mutate(true)}>{bi('نعم', 'Yes')}</Button>
            <Button variant="outline" size="sm" icon={<ThumbsDown className="size-4" aria-hidden />} loading={feedback.isPending && feedback.variables === false} onClick={() => feedback.mutate(false)}>{bi('لا', 'No')}</Button>
          </div>
        ) : voted ? (
          <p role="status" className="text-sm font-bold text-emerald-800">{bi('شكرًا لك! يسعدنا أن المشكلة حُلّت.', 'Thank you! Glad it is solved.')}</p>
        ) : (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink">{bi('نأسف لذلك — افتح طلب صيانة وسيتواصل معك فريق الخدمة.', 'Sorry about that — open a service request and our team will contact you.')}</p>
            <Link href="/portal/requests/new" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-white hover:bg-primary-600"><Wrench className="size-4" aria-hidden />{bi('طلب صيانة', 'Service request')}</Link>
          </div>
        )}
      </PublicCard>
    </div>
  );
}
