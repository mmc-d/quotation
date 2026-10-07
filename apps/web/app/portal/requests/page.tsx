'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Wrench } from 'lucide-react';
import { LinkButton, clsx } from '@/components/ui';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalTicket, type Rows } from '../_components/portal-api';
import { CoverageBadge, EmptyState, ErrorBlock, Loading, Num, PageTitle, PortalStatus } from '../_components/portal-ui';

type Filter = 'open' | 'done' | 'all';
const OPEN = ['open', 'in_progress'];

export default function RequestsPage() {
  const { bi } = useI18n();
  const [filter, setFilter] = useState<Filter>('open');
  const q = useQuery({ queryKey: ['portal', 'tickets', 'all'], queryFn: () => portalFetch<Rows<PortalTicket>>('/tickets'), retry: portalRetry });
  const all = q.data?.rows ?? [];
  const rows = all.filter((t) => filter === 'all' || (filter === 'open' ? OPEN.includes(t.status) : !OPEN.includes(t.status)));
  const tabs: { v: Filter; label: string; n: number }[] = [
    { v: 'open', label: bi('المفتوحة', 'Open'), n: all.filter((t) => OPEN.includes(t.status)).length },
    { v: 'done', label: bi('المنتهية', 'Finished'), n: all.filter((t) => !OPEN.includes(t.status)).length },
    { v: 'all', label: bi('الكل', 'All'), n: all.length },
  ];

  return (
    <div>
      <PageTitle title={bi('طلبات الصيانة', 'Service requests')} subtitle={bi('تابع حالة طلباتك وزيارات الفنيين.', 'Follow your requests and technician visits.')}
        actions={<LinkButton href="/portal/requests/new" variant="primary" icon={<Plus className="size-4" aria-hidden />}>{bi('طلب جديد', 'New request')}</LinkButton>} />

      <div role="tablist" aria-label={bi('تصفية الطلبات', 'Filter requests')} className="mb-4 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t.v} role="tab" aria-selected={filter === t.v} onClick={() => setFilter(t.v)} className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-bold transition', filter === t.v ? 'border-gold text-primary' : 'border-transparent text-muted hover:text-ink')}>
            {t.label}<span className="ms-1.5 rounded-full bg-tint px-1.5 text-[11px] text-gold-dark"><Num>{t.n}</Num></span>
          </button>
        ))}
      </div>

      {q.isLoading ? <Loading /> : q.error ? <ErrorBlock error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={<Wrench className="size-8" />} title={filter === 'open' ? bi('لا توجد طلبات مفتوحة', 'No open requests') : bi('لا توجد طلبات', 'No requests')}
          action={<LinkButton href="/portal/requests/new" size="sm" variant="primary">{bi('طلب صيانة جديد', 'New service request')}</LinkButton>} />
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/portal/requests/${t.id}`} className="block rounded-2xl border border-line bg-white p-4 transition hover:border-gold/60 hover:shadow-md">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><Num className="font-bold">{t.number}</Num>·<Num>{date(t.createdAt)}</Num></div>
                    <p className="mt-0.5 font-bold text-ink">{t.subject}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {t.siteName ?? bi('بدون موقع', 'No site')}
                      {t.asset && <> · <Num>{t.asset.code}</Num>{t.asset.serial && <> (<Num>{t.asset.serial}</Num>)</>}</>}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <PortalStatus status={t.status} />
                    <CoverageBadge coverage={t.coverage} showReason={false} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
