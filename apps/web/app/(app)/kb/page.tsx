'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, MessageSquareText, PlayCircle, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Card, Empty, ErrorBox, LinkButton, PageHeader, SearchBox, Select, Spinner } from '@/components/ui';
import { RequirePerm } from '../settings/_components/common';
import { ArticleStats, KbStatusBadge, VisibilityBadge, titleOf, type KbMeta, type KbSummary } from './_components/common';

function KbList() {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const editor = can('kb.write');
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  const [status, setStatus] = useState(editor ? '' : 'published');
  const [visibility, setVisibility] = useState('');
  const [productId, setProductId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const meta = useQuery({ queryKey: ['kb-meta'], queryFn: () => api.get<KbMeta>('/kb/meta'), staleTime: 300_000 });
  const list = useQuery({
    queryKey: ['kb-articles', term, status, visibility, productId, categoryId],
    queryFn: () => api.get<{ rows: KbSummary[]; total: number }>(`/kb/articles${qs({ q: term, status, visibility, productId, categoryId })}`),
  });
  const rows = list.data?.rows ?? [];

  return (
    <>
      <PageHeader
        title={bi('قاعدة المعرفة', 'Knowledge base')}
        subtitle={bi('أدلة الأعطال والتركيب ومقاطع الشرح — الداخلية للفريق والعامة لبوابة العملاء.', 'Troubleshooting, installation guides and how-to videos — internal for the team, public for the customer portal.')}
        actions={<>
          <LinkButton href="/kb/replies" icon={<MessageSquareText className="size-4" />}>{bi('الردود الجاهزة', 'Canned replies')}</LinkButton>
          {editor && <LinkButton href="/kb/new" variant="primary" icon={<Plus className="size-4" />}>{bi('مقال جديد', 'New article')}</LinkButton>}
        </>}
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder={bi('ابحث في العناوين والنصوص والوسوم…', 'Search titles, text and tags…')} />
          {editor && (
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[10rem]" aria-label={bi('الحالة', 'Status')}>
              <option value="">{bi('كل الحالات', 'All statuses')}</option>
              <option value="published">{bi('منشور', 'Published')}</option>
              <option value="draft">{bi('مسودة', 'Draft')}</option>
              <option value="archived">{bi('مؤرشف', 'Archived')}</option>
            </Select>
          )}
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="max-w-[10rem]" aria-label={bi('الظهور', 'Visibility')}>
            <option value="">{bi('داخلي وعام', 'Internal & public')}</option>
            <option value="internal">{bi('داخلي', 'Internal')}</option>
            <option value="public">{bi('عام (البوابة)', 'Public (portal)')}</option>
          </Select>
          {!!meta.data?.products.length && (
            <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="max-w-[14rem]" aria-label={bi('المنتج', 'Product')}>
              <option value="">{bi('كل المنتجات', 'All products')}</option>
              {meta.data.products.map((p) => <option key={p.id} value={p.id}>{p.code} — {locale === 'en' ? p.nameEn || p.nameAr : p.nameAr}</option>)}
            </Select>
          )}
          {!!meta.data?.categories.length && (
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="max-w-[12rem]" aria-label={bi('التصنيف', 'Category')}>
              <option value="">{bi('كل التصنيفات', 'All categories')}</option>
              {meta.data.categories.map((c) => <option key={c.id} value={c.id}>{locale === 'en' ? c.nameEn || c.nameAr : c.nameAr}</option>)}
            </Select>
          )}
          <span className="ms-auto text-xs text-muted">{bi(`${rows.length} مقال`, `${rows.length} articles`)}</span>
        </div>
      </Card>
      <ErrorBox error={list.error} />
      {list.isLoading ? <Spinner /> : rows.length === 0 ? (
        <Card><Empty icon={<BookOpen className="size-8" />} title={term ? bi('لا نتائج مطابقة', 'No matching articles') : bi('لا توجد مقالات بعد', 'No articles yet')}
          hint={editor ? bi('ابدأ بكتابة أكثر الأعطال تكرارًا وحلولها.', 'Start with the most frequent faults and their fixes.') : undefined}
          action={editor ? <LinkButton href="/kb/new" variant="primary" icon={<Plus className="size-4" />}>{bi('مقال جديد', 'New article')}</LinkButton> : undefined} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((a) => (
            <Link key={a.id} href={`/kb/${a.id}`} className="group rounded-[var(--radius-card)] border border-line bg-white p-4 transition hover:border-gold hover:shadow-sm">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {editor && <KbStatusBadge status={a.status} />}
                <VisibilityBadge visibility={a.visibility} />
                {a.hasVideo && <span className="inline-flex items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-gold-dark"><PlayCircle className="size-3" />{bi('فيديو', 'Video')}</span>}
                {a.category && <span className="text-[11px] font-bold text-muted">{locale === 'en' ? a.category.nameEn || a.category.nameAr : a.category.nameAr}</span>}
              </div>
              <h2 className="font-extrabold text-primary group-hover:underline">{titleOf(a, locale)}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{locale === 'en' ? a.excerptEn || a.excerptAr : a.excerptAr}</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap gap-1">{a.tags.slice(0, 5).map((t) => <span key={t} className="rounded bg-gray-100 px-1.5 text-[11px] text-gray-700">#{t}</span>)}</span>
                <span className="flex items-center gap-3"><ArticleStats a={a} /><span className="num text-xs text-muted">{date(a.updatedAt)}</span></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function KbPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="kb.read" title={bi('قاعدة المعرفة', 'Knowledge base')}><Suspense fallback={<Spinner />}><KbList /></Suspense></RequirePerm>;
}
