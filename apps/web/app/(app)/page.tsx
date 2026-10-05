'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, UserPlus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { h, money } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Card, ErrorBox, Field, Input, LinkButton, Money, PageHeader, Spinner, Stat, Table, Td, Th } from '@/components/ui';

interface Cockpit {
  range: { from: string; to: string };
  quotes: { count: number; value: string; sent: number; accepted: number; acceptedValue: string; lost: number; pendingApproval: number; winRate: number | null; avgDiscountPercent: number; marginPercent: number | null };
  byDay: { day: string; count: number; value: string }[];
  byRep: { id: string; name: string; quotes: number; won: number; won_value: string; value: string }[];
  pipeline: { key: string; name_ar: string; kind: string; count: number; amount: string; weighted: string }[];
  leads: { total: number; fresh: number; converted: number } | null;
  tasks: { open: number; overdue: number };
  ar: { outstanding: string; overdue: string } | null;
  requested: { open: string } | null;
}

function Bars({ data }: { data: { day: string; value: string }[] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...data.map((d) => h(d.value)));
  if (!data.length) return <p className="py-8 text-center text-sm text-muted">{t('cockpit.noQuotes')}</p>;
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label={t('cockpit.dailyValue')}>
      {data.map((d) => (
        <div key={d.day} className="group relative flex-1">
          <div className="rounded-t bg-gold/80 transition group-hover:bg-primary" style={{ height: `${Math.max(4, (h(d.value) / max) * 150)}px` }} />
          <div className="pointer-events-none absolute bottom-full start-1/2 z-10 mb-1 hidden whitespace-nowrap rounded bg-ink px-2 py-1 text-[11px] text-white group-hover:block">{d.day.slice(5)} · {money(d.value)}</div>
        </div>
      ))}
    </div>
  );
}

export default function CockpitPage() {
  const { me, can } = useMe();
  const { t } = useI18n();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const q = useQuery({ queryKey: ['cockpit', range], queryFn: () => api.get<Cockpit>(`/dashboard/cockpit${qs(range)}`) });
  const d = q.data;
  const pipeMax = Math.max(1, ...(d?.pipeline ?? []).filter((p) => p.kind === 'open').map((p) => h(p.amount)));
  return (
    <>
      <PageHeader
        title={t('cockpit.hello', { name: me?.user.name ?? '' })}
        subtitle={d ? t('cockpit.period', { from: d.range.from, to: d.range.to }) : t('cockpit.title')}
        actions={<>
          <Field label={t('common.from')} className="w-36"><Input type="date" value={range.from ?? d?.range.from ?? ''} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></Field>
          <Field label={t('common.to')} className="w-36"><Input type="date" value={range.to ?? d?.range.to ?? ''} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></Field>
          {can('quote.write') && <LinkButton href="/quotes/new" variant="primary" icon={<FilePlus2 className="size-4" />}>{t('cockpit.newQuote')}</LinkButton>}
          {can('lead.write') && <LinkButton href="/crm/leads?new=1" icon={<UserPlus className="size-4" />}>{t('cockpit.newLead')}</LinkButton>}
        </>}
      />
      <ErrorBox error={q.error} />
      {!d ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Stat label={t('cockpit.quotes')} value={d.quotes.count} hint={<Money value={d.quotes.value} />} />
            <Stat label={t('cockpit.accepted')} value={d.quotes.accepted} hint={<Money value={d.quotes.acceptedValue} />} tone="green" />
            <Stat label={t('cockpit.winRate')} value={d.quotes.winRate === null ? '—' : `${d.quotes.winRate}%`} hint={t('cockpit.lostN', { n: d.quotes.lost })} tone="gold" />
            <Stat label={t('cockpit.pendingApproval')} value={d.quotes.pendingApproval} hint={<Link href="/quotes?status=pending_approval" className="text-gold-dark hover:underline">{t('common.view')}</Link>} />
            <Stat label={t('cockpit.avgDiscount')} value={`${d.quotes.avgDiscountPercent}%`} />
            {d.quotes.marginPercent !== null ? <Stat label={t('cockpit.margin')} value={`${d.quotes.marginPercent}%`} tone={d.quotes.marginPercent < 20 ? 'red' : 'green'} /> : <Stat label={t('cockpit.overdueTasks')} value={d.tasks.overdue} hint={t('cockpit.openN', { n: d.tasks.open })} tone={d.tasks.overdue ? 'red' : undefined} />}
          </div>
          {(d.ar || d.leads) && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {d.ar && <Stat label={t('cockpit.arOutstanding')} value={<Money value={d.ar.outstanding} />} hint={<>{t('cockpit.overdue')} <Money value={d.ar.overdue} /></>} tone={h(d.ar.overdue) > 0 ? 'red' : undefined} />}
              {d.requested && <Stat label={t('cockpit.openRequests')} value={<Money value={d.requested.open} />} />}
              {d.leads && <Stat label={t('cockpit.leads')} value={d.leads.total} hint={t('cockpit.leadsHint', { fresh: d.leads.fresh, converted: d.leads.converted })} />}
              <Stat label={t('cockpit.myTasks')} value={d.tasks.open} hint={d.tasks.overdue ? t('cockpit.overdueN', { n: d.tasks.overdue }) : t('cockpit.noOverdue')} tone={d.tasks.overdue ? 'red' : undefined} />
            </div>
          )}
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title={t('cockpit.dailyValue')}><Bars data={d.byDay} /></Card>
            {d.pipeline.length > 0 && (
              <Card title={t('cockpit.pipeline')} actions={<Link href="/crm/pipeline" className="text-xs font-bold text-gold-dark hover:underline">{t('common.open')}</Link>}>
                <div className="space-y-2">
                  {d.pipeline.filter((p) => p.kind === 'open').map((p) => (
                    <div key={p.key}>
                      <div className="mb-0.5 flex justify-between text-xs"><b>{p.name_ar} <span className="font-normal text-muted">({p.count})</span></b><span className="text-muted">{t('cockpit.weighted')} <Money value={p.weighted} /></span></div>
                      <div className="h-2.5 rounded-full bg-tint"><div className="h-2.5 rounded-full bg-primary" style={{ width: `${(h(p.amount) / pipeMax) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
          {d.byRep.length > 0 && (
            <Card title={t('cockpit.team')} padded={false}>
              <Table>
                <thead><tr><Th>{t('cockpit.rep')}</Th><Th className="text-center">{t('cockpit.repQuotes')}</Th><Th className="text-center">{t('cockpit.repWon')}</Th><Th>{t('cockpit.quotesValue')}</Th><Th>{t('cockpit.wonValue')}</Th></tr></thead>
                <tbody>{d.byRep.map((r) => <tr key={r.id}><Td className="font-bold">{r.name}</Td><Td className="text-center num">{r.quotes}</Td><Td className="text-center num">{r.won}</Td><Td><Money value={r.value} /></Td><Td><Money value={r.won_value} /></Td></tr>)}</tbody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
