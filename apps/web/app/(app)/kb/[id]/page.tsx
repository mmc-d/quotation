'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ExternalLink, Pencil, PlayCircle, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, ErrorBox, LinkButton, PageHeader, Spinner } from '@/components/ui';
import { AttachmentList } from '@/components/attachments';
import { Markdown, safeHref } from '@/components/markdown';
import { RequirePerm } from '../../settings/_components/common';
import { ArticleStats, KbStatusBadge, VisibilityBadge, type KbArticle } from '../_components/common';

function ArticleView({ id }: { id: string }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const editor = can('kb.write');
  const q = useQuery({ queryKey: ['kb-article', id], queryFn: () => api.get<KbArticle>(`/kb/articles/${id}`), staleTime: 60_000 });
  const [lang, setLang] = useState<'ar' | 'en' | null>(null);
  const [voted, setVoted] = useState<boolean | null>(null);

  const status = useMutation({
    mutationFn: (to: 'publish' | 'archive') => api.post<KbArticle>(`/kb/articles/${id}/${to}`),
    onSuccess: (a) => { qc.setQueryData(['kb-article', id], a); qc.invalidateQueries({ queryKey: ['kb-articles'] }); toast.success(a.status === 'published' ? bi('تم النشر', 'Published') : bi('تمت الأرشفة', 'Archived')); },
    onError: (e) => toast.error((e as Error).message),
  });
  const feedback = useMutation({
    mutationFn: (helpful: boolean) => api.post<{ helpfulYes: number; helpfulNo: number }>(`/kb/articles/${id}/feedback`, { helpful }),
    onSuccess: (r, helpful) => { setVoted(helpful); qc.setQueryData<KbArticle>(['kb-article', id], (a) => (a ? { ...a, ...r } : a)); toast.success(bi('شكرًا على ملاحظتك', 'Thanks for the feedback')); },
    onError: (e) => toast.error((e as Error).message),
  });

  const a = q.data;
  if (q.isLoading) return <Spinner />;
  if (!a) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;
  const shown = lang ?? (locale === 'en' && a.bodyEn ? 'en' : 'ar');
  const body = shown === 'en' && a.bodyEn ? a.bodyEn : a.bodyAr;
  const title = shown === 'en' ? a.titleEn || a.titleAr : a.titleAr;
  const video = a.videoUrl ? safeHref(a.videoUrl) : null;

  return (
    <>
      <PageHeader
        back="/kb"
        title={title}
        subtitle={<span className="flex flex-wrap items-center gap-2">{editor && <KbStatusBadge status={a.status} />}<VisibilityBadge visibility={a.visibility} /><ArticleStats a={a} /></span>}
        actions={editor && <>
          <LinkButton href={`/kb/new?edit=${a.id}`} icon={<Pencil className="size-4" />}>{bi('تعديل', 'Edit')}</LinkButton>
          {a.status !== 'published' && <Button icon={<Send className="size-4 rtl:-scale-x-100" />} loading={status.isPending} onClick={() => status.mutate('publish')}>{bi('نشر', 'Publish')}</Button>}
          {a.status !== 'archived' && <Button variant="outline" icon={<Archive className="size-4" />} loading={status.isPending} onClick={() => status.mutate('archive')}>{bi('أرشفة', 'Archive')}</Button>}
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card actions={a.bodyEn ? (
            <div className="flex rounded-lg border border-line p-0.5 text-xs font-bold">
              <button type="button" onClick={() => setLang('ar')} className={shown === 'ar' ? 'rounded-md bg-primary px-2 py-0.5 text-white' : 'px-2 py-0.5 text-muted'}>{bi('عربي', 'Arabic')}</button>
              <button type="button" onClick={() => setLang('en')} className={shown === 'en' ? 'rounded-md bg-primary px-2 py-0.5 text-white' : 'px-2 py-0.5 text-muted'}>{bi('إنجليزي', 'English')}</button>
            </div>
          ) : undefined} title={bi('المحتوى', 'Content')}>
            <div dir={shown === 'en' ? 'ltr' : 'rtl'}><Markdown source={body} /></div>
          </Card>
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-ink">{bi('هل كان هذا المقال مفيدًا؟', 'Was this article helpful?')}</span>
              <Button variant={voted === true ? 'primary' : 'outline'} size="sm" icon={<ThumbsUp className="size-4" />} disabled={voted !== null} loading={feedback.isPending && feedback.variables === true} onClick={() => feedback.mutate(true)}>{bi('نعم', 'Yes')}</Button>
              <Button variant={voted === false ? 'danger' : 'outline'} size="sm" icon={<ThumbsDown className="size-4" />} disabled={voted !== null} loading={feedback.isPending && feedback.variables === false} onClick={() => feedback.mutate(false)}>{bi('لا', 'No')}</Button>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          {video && (
            <Card title={bi('مقطع الشرح', 'How-to video')}>
              <a href={video} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-bold text-primary hover:underline"><PlayCircle className="size-5 text-gold" />{bi('مشاهدة الفيديو', 'Watch the video')}<ExternalLink className="size-3.5" /></a>
            </Card>
          )}
          {a.products.length > 0 && (
            <Card title={bi('المنتجات', 'Products')}>
              <ul className="space-y-1 text-sm">{a.products.map((p) => <li key={p.id}><span dir="ltr" className="num font-bold text-primary">{p.code}</span> <span className="text-muted">{locale === 'en' ? p.nameEn || p.nameAr : p.nameAr}</span></li>)}</ul>
            </Card>
          )}
          {a.files.length > 0 && (
            <Card title={bi('المرفقات', 'Attachments')}>
              <AttachmentList ids={a.files.map((f) => f.id)} files={Object.fromEntries(a.files.map((f) => [f.id, f]))} />
            </Card>
          )}
          <Card title={bi('معلومات', 'Info')}>
            <dl className="space-y-1 text-sm">
              {a.category && <div className="flex justify-between gap-2"><dt className="text-muted">{bi('التصنيف', 'Category')}</dt><dd>{locale === 'en' ? a.category.nameEn || a.category.nameAr : a.category.nameAr}</dd></div>}
              {a.tags.length > 0 && <div className="flex justify-between gap-2"><dt className="text-muted">{bi('الوسوم', 'Tags')}</dt><dd className="flex flex-wrap justify-end gap-1">{a.tags.map((t) => <span key={t} className="rounded bg-gray-100 px-1.5 text-[11px]">#{t}</span>)}</dd></div>}
              <div className="flex justify-between gap-2"><dt className="text-muted">{bi('آخر تحديث', 'Updated')}</dt><dd className="num">{dateTime(a.updatedAt)}</dd></div>
              {a.updatedByName && <div className="flex justify-between gap-2"><dt className="text-muted">{bi('بواسطة', 'By')}</dt><dd>{a.updatedByName}</dd></div>}
              {a.visibility === 'public' && <div className="flex justify-between gap-2"><dt className="text-muted">{bi('رابط البوابة', 'Portal link')}</dt><dd dir="ltr" className="truncate text-xs">/portal/help/{a.slug}</dd></div>}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function KbArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  return <RequirePerm perm="kb.read" title={bi('قاعدة المعرفة', 'Knowledge base')}><ArticleView id={id} /></RequirePerm>;
}
