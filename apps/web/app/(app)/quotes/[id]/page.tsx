'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { QuoteEditor } from '../_components/quote-editor';
import { draftFromView, type QuoteView } from '../_components/types';

export default function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['quote', id], queryFn: () => api.get<QuoteView>(`/quotes/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <><PageHeader back="/quotes" title={bi('عرض السعر', 'Quote')} /><ErrorBox error={q.error} /></>;
  return <QuoteEditor key={q.data.id} view={q.data} initial={draftFromView(q.data)} />;
}
