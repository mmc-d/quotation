'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Save, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { AttachmentPicker, type AttachmentMeta } from '@/components/attachments';
import { Markdown } from '@/components/markdown';
import { RequirePerm } from '../../settings/_components/common';
import { ProductPicker, type PickedProduct } from '../../inventory/_components/common';
import type { KbArticle, KbMeta } from '../_components/common';

type ProductRef = { id: string; code: string; nameAr: string; nameEn: string | null };

function BodyEditor({ label, value, onChange, dir, placeholder }: { label: string; value: string; onChange: (v: string) => void; dir: 'rtl' | 'ltr'; placeholder?: string }) {
  const { bi } = useI18n();
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-gold-dark">{label}</span>
        <button type="button" onClick={() => setPreview((p) => !p)} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
          {preview ? <><Pencil className="size-3.5" />{bi('تحرير', 'Edit')}</> : <><Eye className="size-3.5" />{bi('معاينة', 'Preview')}</>}
        </button>
      </div>
      {preview
        ? <div dir={dir} className="min-h-[12rem] rounded-lg border border-line bg-tint/20 p-3">{value.trim() ? <Markdown source={value} /> : <p className="text-sm text-muted">{bi('لا يوجد محتوى', 'Nothing to preview')}</p>}</div>
        : <Textarea dir={dir} rows={14} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="font-[inherit]" />}
    </div>
  );
}

function ArticleForm() {
  const sp = useSearchParams();
  const editId = sp.get('edit');
  const router = useRouter();
  const qc = useQueryClient();
  const { bi, locale } = useI18n();
  const meta = useQuery({ queryKey: ['kb-meta'], queryFn: () => api.get<KbMeta>('/kb/meta'), staleTime: 300_000 });
  const existing = useQuery({ queryKey: ['kb-article', editId], queryFn: () => api.get<KbArticle>(`/kb/articles/${editId}`), enabled: !!editId });

  const [titleAr, setTitleAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [visibility, setVisibility] = useState<'internal' | 'public'>('internal');
  const [categoryId, setCategoryId] = useState('');
  const [products, setProducts] = useState<ProductRef[]>([]);
  const [tags, setTags] = useState('');
  const [files, setFiles] = useState<AttachmentMeta[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [slug, setSlug] = useState('');
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [loaded, setLoaded] = useState(!editId);

  useEffect(() => {
    const a = existing.data;
    if (!a || loaded) return;
    setTitleAr(a.titleAr); setTitleEn(a.titleEn ?? ''); setBodyAr(a.bodyAr); setBodyEn(a.bodyEn ?? ''); setVisibility(a.visibility);
    setCategoryId(a.categoryId ?? ''); setProducts(a.products); setTags(a.tags.join('، ')); setVideoUrl(a.videoUrl ?? ''); setSlug(a.slug); setVersion(a.version);
    setFiles(a.files.map((f) => ({ id: f.id, url: f.url, filename: f.filename, mime: f.mime })));
    setLoaded(true);
  }, [existing.data, loaded]);

  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const body = {
        titleAr: titleAr.trim(), titleEn: titleEn.trim() || null, bodyAr, bodyEn: bodyEn.trim() ? bodyEn : null, visibility, categoryId: categoryId || null,
        productIds: products.map((p) => p.id), tags: tags.split(/[,،\n]/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean), fileIds: files.map((f) => f.id),
        videoUrl: videoUrl.trim() || null, slug: editId ? slug.trim() || null : null, ...(editId ? { version } : {}),
      };
      let a = editId ? await api.put<KbArticle>(`/kb/articles/${editId}`, body) : await api.post<KbArticle>('/kb/articles', body);
      if (publish && a.status !== 'published') a = await api.post<KbArticle>(`/kb/articles/${a.id}/publish`);
      return a;
    },
    onSuccess: (a) => {
      qc.setQueryData(['kb-article', a.id], a);
      qc.invalidateQueries({ queryKey: ['kb-articles'] });
      qc.invalidateQueries({ queryKey: ['kb-meta'] });
      toast.success(a.status === 'published' ? bi('تم الحفظ والنشر', 'Saved and published') : bi('تم الحفظ', 'Saved'));
      router.push(`/kb/${a.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (editId && (existing.isLoading || !loaded)) return existing.error ? <ErrorBox error={existing.error} /> : <Spinner />;
  const valid = titleAr.trim().length >= 2 && bodyAr.trim().length > 0;
  const addProduct = (p: PickedProduct | null) => { if (p && !products.some((x) => x.id === p.id)) setProducts([...products, { id: p.id, code: p.code, nameAr: p.nameAr, nameEn: p.nameEn }]); };

  return (
    <>
      <PageHeader
        back={editId ? `/kb/${editId}` : '/kb'}
        title={editId ? bi('تعديل مقال', 'Edit article') : bi('مقال جديد', 'New article')}
        subtitle={bi('يدعم النص تنسيقًا بسيطًا: # عنوان، - قائمة، 1. قائمة مرقمة، **غامق**، [نص](https://رابط).', 'Simple formatting: # heading, - list, 1. numbered list, **bold**, [text](https://link).')}
        actions={<>
          <Button variant="outline" icon={<Save className="size-4" />} disabled={!valid} loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>{bi('حفظ', 'Save')}</Button>
          <Button icon={<Send className="size-4 rtl:-scale-x-100" />} disabled={!valid} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>{existing.data?.status === 'published' ? bi('حفظ (منشور)', 'Save (published)') : bi('حفظ ونشر', 'Save & publish')}</Button>
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={bi('بالعربية', 'Arabic')}>
            <div className="grid gap-3">
              <Field label={bi('العنوان *', 'Title *')}><Input dir="rtl" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} maxLength={300} placeholder={bi('مثال: القفل لا يتعرف على البصمة', 'e.g. The lock does not recognise the fingerprint')} /></Field>
              <BodyEditor label={bi('المحتوى *', 'Content *')} value={bodyAr} onChange={setBodyAr} dir="rtl" placeholder={'## الأعراض\n- …\n\n## الحل\n1. …'} />
            </div>
          </Card>
          <Card title={bi('بالإنجليزية (اختياري)', 'English (optional)')}>
            <div className="grid gap-3">
              <Field label={bi('العنوان', 'Title')}><Input dir="ltr" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} maxLength={300} /></Field>
              <BodyEditor label={bi('المحتوى', 'Content')} value={bodyEn} onChange={setBodyEn} dir="ltr" placeholder={'## Symptoms\n- …\n\n## Fix\n1. …'} />
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={bi('النشر', 'Publishing')}>
            <div className="grid gap-3">
              <Field label={bi('الظهور', 'Visibility')} hint={visibility === 'public' ? bi('يظهر للعملاء في بوابة العملاء بعد النشر.', 'Customers see it in the portal once published.') : bi('للفريق والفنيين فقط.', 'Team and technicians only.')}>
                <Select value={visibility} onChange={(e) => setVisibility(e.target.value as 'internal' | 'public')}>
                  <option value="internal">{bi('داخلي', 'Internal')}</option>
                  <option value="public">{bi('عام (بوابة العملاء)', 'Public (customer portal)')}</option>
                </Select>
              </Field>
              {!!meta.data?.categories.length && (
                <Field label={bi('التصنيف', 'Category')}>
                  <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">{bi('— بدون —', '— None —')}</option>
                    {meta.data.categories.map((c) => <option key={c.id} value={c.id}>{locale === 'en' ? c.nameEn || c.nameAr : c.nameAr}</option>)}
                  </Select>
                </Field>
              )}
              {editId && <Field label={bi('المعرّف في الرابط', 'URL slug')} hint={bi('اتركه كما هو ما لم تحتج تغييره.', 'Keep it unless you need to change it.')}><Input dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={100} /></Field>}
            </div>
          </Card>
          <Card title={bi('المنتجات', 'Products')}>
            <p className="mb-2 text-xs text-muted">{bi('يظهر المقال في بلاغات وأوامر عمل الأجهزة من هذه المنتجات.', 'The article is suggested on calls and jobs for devices of these products.')}</p>
            <ProductPicker value={null} onChange={addProduct} />
            {products.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {products.map((p) => (
                  <li key={p.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-tint/40 py-0.5 pe-1 ps-2 text-xs">
                    <span dir="ltr" className="font-bold text-primary">{p.code}</span>
                    <button type="button" onClick={() => setProducts(products.filter((x) => x.id !== p.id))} className="rounded-full p-0.5 text-muted hover:bg-black/5" aria-label={bi('إزالة', 'Remove')}><X className="size-3" /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={bi('وسائط ووسوم', 'Media & tags')}>
            <div className="grid gap-3">
              <Field label={bi('الوسوم', 'Tags')} hint={bi('افصل بينها بفاصلة', 'Separate with commas')}><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={bi('قفل، بطارية، إعادة ضبط', 'lock, battery, reset')} /></Field>
              <Field label={bi('رابط فيديو الشرح', 'How-to video link')} hint={bi('يوتيوب أو Google Drive', 'YouTube or Google Drive')}><Input dir="ltr" type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://" /></Field>
              <Field label={bi('المرفقات', 'Attachments')}><AttachmentPicker value={files} onChange={setFiles} max={20} /></Field>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function KbNewPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="kb.write" title={bi('مقال جديد', 'New article')}><Suspense fallback={<Spinner />}><ArticleForm /></Suspense></RequirePerm>;
}
