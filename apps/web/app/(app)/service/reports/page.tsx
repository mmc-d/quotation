'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Card, clsx, Empty, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { Stars, TierBadge } from '../_components/common';
import type { AgreementsReport, CsatReport, SlaReport } from '../_components/types';
import Link from 'next/link';

/** Horizontal bar 0–100% (logical direction, so it grows from the start edge in RTL and LTR). */
function Bar({ pct, tone = 'primary' }: { pct: number; tone?: 'primary' | 'gold' | 'red' | 'green' }) {
  const cls = { primary: 'bg-primary', gold: 'bg-gold', red: 'bg-danger', green: 'bg-ok' }[tone];
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-tint">
      <div className={clsx('h-full rounded-full transition-[width]', cls)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

const pctTone = (p: number | null) => (p === null ? 'primary' : p >= 90 ? 'green' : p >= 75 ? 'gold' : 'red') as 'primary' | 'gold' | 'red' | 'green';

export default function ServiceReportsPage() {
  const { bi } = useI18n();
  const { can } = useMe();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [months, setMonths] = useState(12);
  const canCsat = can('workorder.read');
  const canSla = can('ticket.read');
  const csat = useQuery({ queryKey: ['csat-report', from, to], queryFn: () => api.get<CsatReport>(`/service/reports/csat${qs({ from, to })}`), enabled: canCsat });
  const sla = useQuery({ queryKey: ['sla-report', months], queryFn: () => api.get<SlaReport>(`/service/reports/sla${qs({ months })}`), enabled: canSla });
  const agr = useQuery({ queryKey: ['agreements-report'], queryFn: () => api.get<AgreementsReport>('/service/reports/agreements'), enabled: can('agreement.read') });

  const c = csat.data;
  const maxDist = c ? Math.max(1, ...Object.values(c.distribution)) : 1;
  const totals = sla.data?.months.reduce((t, m) => ({ rm: t.rm + m.response.met, rb: t.rb + m.response.breached, sm: t.sm + m.resolution.met, sb: t.sb + m.resolution.breached, n: t.n + m.tickets }), { rm: 0, rb: 0, sm: 0, sb: 0, n: 0 });
  const pct = (a: number, b: number) => (a + b ? Math.round((a / (a + b)) * 1000) / 10 : null);

  return (
    <>
      <PageHeader title={bi('تقارير الخدمة', 'Service reports')} subtitle={bi('رضا العملاء والالتزام بمستوى الخدمة وعقود الصيانة', 'Customer satisfaction, SLA compliance and service agreements')} />

      {agr.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={bi('العقود السارية', 'Active agreements')} value={<span className="num">{agr.data.activeCount}</span>} tone="green" />
          <Stat label={bi('القيمة السنوية', 'Annual value')} value={<Money value={agr.data.annualValue} />} />
          <Stat label={bi('تجديدات خلال 30 يومًا', 'Renewals due in 30 days')} value={<span className="num">{agr.data.renewalsDue.length}</span>} tone={agr.data.renewalsDue.length ? 'gold' : undefined} />
          <div className="rounded-[var(--radius-card)] border border-line bg-white p-4">
            <div className="text-xs font-bold text-muted">{bi('حسب الباقة', 'By tier')}</div>
            <div className="mt-2 flex flex-wrap gap-2">{Object.keys(agr.data.byTier).length === 0 ? <span className="text-sm text-muted">—</span> : Object.entries(agr.data.byTier).map(([k, n]) => <span key={k} className="inline-flex items-center gap-1"><TierBadge tier={k} /><span className="num text-sm font-bold">{n}</span></span>)}</div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {canCsat && (
          <Card title={bi('رضا العملاء (CSAT)', 'Customer satisfaction (CSAT)')}>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <Field label={bi('من', 'From')}><Input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label={bi('إلى', 'To')}><Input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <ErrorBox error={csat.error} />
            {csat.isLoading ? <Spinner /> : !c || c.count === 0 ? <Empty title={bi('لا توجد تقييمات في هذه الفترة', 'No ratings in this period')} /> : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-4">
                  <div>
                    <div className="num text-4xl font-extrabold text-primary">{c.average?.toFixed(2) ?? '—'}</div>
                    <Stars score={c.average ? Math.round(c.average) : null} />
                  </div>
                  <div className="text-sm text-muted">{bi(`من ${c.count} تقييم`, `from ${c.count} ratings`)}</div>
                </div>
                <div className="space-y-1.5">
                  {[5, 4, 3, 2, 1].map((k) => {
                    const n = c.distribution[String(k)] ?? 0;
                    return (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="num w-6 shrink-0 font-bold">{k}★</span>
                        <Bar pct={(n / maxDist) * 100} tone={k >= 4 ? 'green' : k === 3 ? 'gold' : 'red'} />
                        <span className="num w-14 shrink-0 text-end text-muted">{n} · {Math.round((n / c.count) * 100)}%</span>
                      </div>
                    );
                  })}
                </div>
                <h3 className="mb-2 mt-5 text-xs font-extrabold text-gold-dark">{bi('حسب الفني', 'By technician')}</h3>
                <Table>
                  <thead><tr><Th>{bi('الفني', 'Technician')}</Th><Th>{bi('المتوسط', 'Average')}</Th><Th className="text-end">{bi('التقييمات', 'Ratings')}</Th></tr></thead>
                  <tbody>
                    {c.byTechnician.map((t) => (
                      <tr key={t.technicianId ?? 'none'}>
                        <Td className="text-sm">{t.name ?? <span className="text-muted">{bi('بدون فني', 'No technician')}</span>}</Td>
                        <Td><span className="inline-flex items-center gap-2"><span className="num font-bold">{t.average?.toFixed(2) ?? '—'}</span><span className="w-24"><Bar pct={((t.average ?? 0) / 5) * 100} tone={(t.average ?? 0) >= 4 ? 'green' : (t.average ?? 0) >= 3 ? 'gold' : 'red'} /></span></span></Td>
                        <Td className="num text-end">{t.count}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </Card>
        )}

        {canSla && (
          <Card title={bi('الالتزام بمستوى الخدمة (SLA)', 'SLA compliance')} actions={
            <Select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-auto py-1 text-xs" aria-label={bi('الفترة', 'Period')}>
              {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{bi(`آخر ${m} شهرًا`, `Last ${m} months`)}</option>)}
            </Select>
          }>
            <ErrorBox error={sla.error} />
            {sla.isLoading ? <Spinner /> : !sla.data || sla.data.months.length === 0 ? <Empty title={bi('لا توجد بلاغات بمستوى خدمة في هذه الفترة', 'No service calls with an SLA in this period')} /> : (
              <>
                {totals && (
                  <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-tint/60 p-2"><div className="text-xs text-muted">{bi('البلاغات', 'Calls')}</div><div className="num text-xl font-extrabold text-primary">{totals.n}</div></div>
                    <div className="rounded-lg bg-tint/60 p-2"><div className="text-xs text-muted">{bi('استجابة ضمن الوقت', 'Response met')}</div><div className="num text-xl font-extrabold text-primary">{pct(totals.rm, totals.rb) ?? '—'}{pct(totals.rm, totals.rb) !== null && '%'}</div></div>
                    <div className="rounded-lg bg-tint/60 p-2"><div className="text-xs text-muted">{bi('حل ضمن الوقت', 'Resolution met')}</div><div className="num text-xl font-extrabold text-primary">{pct(totals.sm, totals.sb) ?? '—'}{pct(totals.sm, totals.sb) !== null && '%'}</div></div>
                  </div>
                )}
                <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-primary" />{bi('الاستجابة', 'Response')}</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-gold" />{bi('الحل', 'Resolution')}</span>
                </div>
                <div className="space-y-3">
                  {sla.data.months.map((m) => (
                    <div key={m.month} className="text-xs">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span dir="ltr" className="num font-bold">{m.month}</span>
                        <span className="text-muted">{bi(`${m.tickets} بلاغ`, `${m.tickets} calls`)}{(m.response.open + m.resolution.open) > 0 && <> · {bi(`${m.resolution.open} مفتوح`, `${m.resolution.open} open`)}</>}</span>
                      </div>
                      <div className="flex items-center gap-2"><Bar pct={m.responseMetPct ?? 0} /><span className={clsx('num w-12 shrink-0 text-end font-bold', pctTone(m.responseMetPct) === 'red' && 'text-danger')}>{m.responseMetPct ?? '—'}{m.responseMetPct !== null && '%'}</span></div>
                      <div className="mt-1 flex items-center gap-2"><Bar pct={m.resolutionMetPct ?? 0} tone="gold" /><span className={clsx('num w-12 shrink-0 text-end font-bold', pctTone(m.resolutionMetPct) === 'red' && 'text-danger')}>{m.resolutionMetPct ?? '—'}{m.resolutionMetPct !== null && '%'}</span></div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted">{bi('النسبة = ما التُزم به ÷ (ما التُزم به + المتجاوز)؛ البلاغات المفتوحة ضمن الوقت لا تُحتسب بعد.', 'Rate = met ÷ (met + breached); open calls still within their window are not counted yet.')}</p>
              </>
            )}
          </Card>
        )}
      </div>

      {agr.data && agr.data.renewalsDue.length > 0 && (
        <Card padded={false} className="mt-4" title={bi('تجديدات قادمة (30 يومًا)', 'Upcoming renewals (30 days)')}>
          <Table>
            <thead><tr><Th>{bi('العقد', 'Agreement')}</Th><Th>{bi('العميل', 'Customer')}</Th><Th>{bi('ينتهي', 'Ends')}</Th><Th className="text-end">{bi('القيمة', 'Price')}</Th><Th>{bi('التجديد', 'Renewal')}</Th></tr></thead>
            <tbody>
              {agr.data.renewalsDue.map((r) => (
                <tr key={r.id} className="hover:bg-tint/40">
                  <Td><Link href={`/service/agreements/${r.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{r.number}</Link></Td>
                  <Td className="text-sm">{r.partyName ?? '—'}</Td>
                  <Td className="num whitespace-nowrap text-xs">{r.endDate}</Td>
                  <Td className="text-end"><Money value={r.price} /></Td>
                  <Td className="text-xs">{r.renewalDrafted ? bi('أُنشئت مسودة', 'Draft created') : r.autoRenew ? bi('تلقائي', 'Automatic') : <span className="font-bold text-danger">{bi('بحاجة لإجراء', 'Needs action')}</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
