'use client';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FilePlus2, UserPlus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { ErrorBox, LinkButton, PageHeader, Spinner, clsx } from '@/components/ui';
import { PeriodPicker, initialPeriod, type PeriodState } from './_dashboard/period';
import { ActionInbox, CashStrip, FunnelCard, ProjectsCard, SalesStrip, TeamTable } from './_dashboard/sections';
import { TrendCard } from './_dashboard/trend-chart';
import type { Home } from './_dashboard/types';

/**
 * Home control room: what needs action now, where the cash is, how this period's quotes convert,
 * which projects are at risk, the trend and the sales team. Every section comes from
 * GET /dashboard/home and is present only when the viewer may read it (cost/margin need
 * quote.cost.read); empty sections collapse instead of showing rows of zeros.
 */
export default function HomePage() {
  const { me, can } = useMe();
  const { t, bi } = useI18n();
  const [period, setPeriod] = useState<PeriodState>(initialPeriod);
  const q = useQuery({
    queryKey: ['dashboard-home', period.from, period.to],
    queryFn: () => api.get<Home>(`/dashboard/home${qs({ from: period.from, to: period.to })}`),
    placeholderData: keepPreviousData, // refetch keeps the frame (dimmed) instead of flashing a spinner
  });
  const d = q.data;
  const showSales = !!d?.sales && (d.sales.count > 0 || d.sales.prev.count > 0);
  const showTeam = !!d?.team && d.team.length > 0;
  return (
    <>
      <PageHeader
        title={t('cockpit.hello', { name: me?.user.name ?? '' })}
        subtitle={d ? bi(`الفترة ${d.period.from} ← ${d.period.to} · مقارنة بـ ${d.previous.from} ← ${d.previous.to}`, `Period ${d.period.from} → ${d.period.to} · compared with ${d.previous.from} → ${d.previous.to}`) : bi('لوحة التحكم', 'Control room')}
        actions={<>
          {can('quote.write') && <LinkButton href="/quotes/new" variant="primary" icon={<FilePlus2 className="size-4" />}>{t('cockpit.newQuote')}</LinkButton>}
          {can('lead.write') && <LinkButton href="/crm/leads?new=1" icon={<UserPlus className="size-4" />}>{t('cockpit.newLead')}</LinkButton>}
        </>}
      />
      <div className="mb-5"><PeriodPicker value={period} onChange={setPeriod} /></div>
      <ErrorBox error={q.error} />
      {!d ? (q.isLoading && <Spinner />) : (
        <div className={clsx('space-y-5 transition-opacity', q.isPlaceholderData && 'opacity-60')} aria-busy={q.isFetching}>
          <ActionInbox items={d.actions} />
          <CashStrip cash={d.cash} />
          {(d.trend.series.length > 0 || d.funnel) && (
            <div className="grid gap-5 xl:grid-cols-3">
              {d.trend.series.length > 0 && <div className={d.funnel ? 'xl:col-span-2' : 'xl:col-span-3'}><TrendCard trend={d.trend} /></div>}
              {d.funnel && <FunnelCard funnel={d.funnel} />}
            </div>
          )}
          {showSales && <SalesStrip sales={d.sales!} />}
          {(d.projects?.total || showTeam) ? (
            <div className={clsx('grid gap-5', d.projects?.total && showTeam && 'xl:grid-cols-3')}>
              {!!d.projects?.total && <ProjectsCard projects={d.projects} />}
              {showTeam && <div className={d.projects?.total ? 'min-w-0 xl:col-span-2' : 'min-w-0'}><TeamTable team={d.team!} margin={d.visibility.margin} /></div>}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
