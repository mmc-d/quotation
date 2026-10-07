'use client';
import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search, Wrench } from 'lucide-react';
import { PublicCard } from '@/app/_public/public-shell';
import { Input } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalKbSummary, type Rows } from '../_components/portal-api';
import { EmptyState, ErrorBlock, Loading, PageTitle } from '../_components/portal-ui';
import { KbRow } from '../_components/portal-kb';

/** Help centre: published public knowledge-base articles (FSM-85). */
export default function HelpPage() {
  const { bi } = useI18n();
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  const list = useQuery({
    queryKey: ['portal', 'kb', term],
    queryFn: () => portalFetch<Rows<PortalKbSummary>>(`/kb${term ? `?q=${encodeURIComponent(term)}` : ''}`),
    retry: portalRetry,
  });
  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <PageTitle title={bi('مركز المساعدة', 'Help centre')} subtitle={bi('إرشادات وحلول سريعة لأجهزتكم ومقاطع شرح.', 'Quick guides, fixes for your devices and how-to videos.')} />
      <label className="relative block">
        <span className="sr-only">{bi('ابحث في المساعدة', 'Search help')}</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={bi('مثال: إعادة ضبط القفل، البطارية…', 'e.g. reset the lock, battery…')} className="ps-9 py-3 text-base" />
      </label>
      {list.isLoading ? <Loading /> : list.error ? <ErrorBlock error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-8" />} title={term ? bi('لا توجد نتائج مطابقة', 'No matching articles') : bi('لا توجد مقالات بعد', 'No articles yet')}
          hint={bi('لم تجد الحل؟ افتح طلب صيانة وسيتواصل معك فريق الخدمة.', 'Could not find a fix? Open a service request and our team will contact you.')}
          action={<Link href="/portal/requests/new" className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-white hover:bg-primary-600"><Wrench className="size-4" aria-hidden />{bi('طلب صيانة جديد', 'New service request')}</Link>} />
      ) : (
        <PublicCard className="!p-2 sm:!p-3">
          <div className="divide-y divide-line/70">{rows.map((a) => <KbRow key={a.id} a={a} />)}</div>
        </PublicCard>
      )}
    </div>
  );
}
