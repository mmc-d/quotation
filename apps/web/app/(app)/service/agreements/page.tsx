'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { Badge, Card, clsx, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, Stat, Table, Td, Th, Button } from '@/components/ui';
import { useLabel } from '../../field/_components/common';
import { AGREEMENT_STATUS, AgreementStatusBadge, daysUntil, Period, TierBadge } from '../_components/common';
import type { AgreementRow, AgreementsReport } from '../_components/types';

const PAGE = 50;
const EXPIRING = [30, 60, 90];

function chipCls(on: boolean) {
  return clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', on ? 'border-gold bg-tint text-primary' : 'border-line text-muted hover:bg-tint/60');
}

function AgreementsList() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { bi } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const term = useDeferredValue(q.trim());
  const [statuses, setStatuses] = useState<string[]>(() => (sp.get('status') ?? '').split(',').filter(Boolean));
  const [expiring, setExpiring] = useState<number | null>(() => (sp.get('expiring') ? Number(sp.get('expiring')) : null));
  const [party, setParty] = useState<PickedParty | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const status = statuses.join(',');

  useEffect(() => {
    const next = qs({ q: term, status, expiring: expiring ?? undefined });
    if (next !== (sp.toString() ? `?${sp.toString()}` : '')) router.replace(`${pathname}${next}`, { scroll: false });
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, status, expiring]);

  const report = useQuery({ queryKey: ['agreements-report'], queryFn: () => api.get<AgreementsReport>('/service/reports/agreements') });
  const list = useQuery({
    queryKey: ['agreements', term, status, expiring, party?.id, limit],
    queryFn: () => api.get<{ rows: AgreementRow[]; total: number }>(`/service/agreements${qs({ q: term, status, expiring: expiring ?? undefined, partyId: party?.id, limit })}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const toggle = (v: string) => setStatuses((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const r = report.data;

  return (
    <>
      <PageHeader
        title={bi('عقود الصيانة', 'Service agreements')}
        subtitle={list.data ? bi(`${list.data.total} عقد`, `${list.data.total} agreements`) : undefined}
        actions={can('agreement.write') && <LinkButton href="/service/agreements/new" variant="primary" icon={<Plus className="size-4" />}>{bi('عقد جديد', 'New agreement')}</LinkButton>}
      />

      {r && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={bi('العقود السارية', 'Active agreements')} value={<span className="num">{r.activeCount}</span>} tone="green" />
          <Stat label={bi('القيمة السنوية', 'Annual value')} value={<Money value={r.annualValue} />} hint={bi('بدون ضريبة', 'Excl. VAT')} />
          <Stat
            label={bi('تجديدات خلال 30 يومًا', 'Renewals due in 30 days')}
            value={<button type="button" className="num hover:underline" onClick={() => { setExpiring(30); setStatuses([]); }}>{r.renewalsDue.length}</button>}
            tone={r.renewalsDue.length ? 'gold' : undefined}
            hint={r.renewalsDue.filter((x) => !x.renewalDrafted).length ? bi(`${r.renewalsDue.filter((x) => !x.renewalDrafted).length} بلا مسودة تجديد`, `${r.renewalsDue.filter((x) => !x.renewalDrafted).length} without a renewal draft`) : undefined}
          />
          <div className="rounded-[var(--radius-card)] border border-line bg-white p-4">
            <div className="text-xs font-bold text-muted">{bi('حسب الباقة', 'By tier')}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.keys(r.byTier).length === 0 ? <span className="text-sm text-muted">—</span> : Object.entries(r.byTier).map(([k, n]) => <span key={k} className="inline-flex items-center gap-1"><TierBadge tier={k} /><span className="num text-sm font-bold">{n}</span></span>)}
            </div>
          </div>
        </div>
      )}

      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={q} onChange={setQ} placeholder={bi('رقم العقد أو اسم العميل…', 'Agreement number or customer…')} />
            <div className="w-full sm:w-72"><PartyPicker value={party} onChange={setParty} placeholder={bi('تصفية حسب العميل…', 'Filter by customer…')} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-muted">{bi('الحالة', 'Status')}:</span>
            <button type="button" onClick={() => setStatuses([])} className={chipCls(statuses.length === 0)}>{bi('الكل', 'All')}</button>
            {Object.keys(AGREEMENT_STATUS).map((s) => <button key={s} type="button" aria-pressed={statuses.includes(s)} onClick={() => toggle(s)} className={chipCls(statuses.includes(s))}>{label(AGREEMENT_STATUS, s)}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-muted">{bi('ينتهي خلال', 'Expiring within')}:</span>
            <button type="button" onClick={() => setExpiring(null)} className={chipCls(expiring === null)}>{bi('الكل', 'All')}</button>
            {EXPIRING.map((d) => <button key={d} type="button" aria-pressed={expiring === d} onClick={() => setExpiring(expiring === d ? null : d)} className={chipCls(expiring === d)}>{bi(`${d} يومًا`, `${d} days`)}</button>)}
          </div>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<ShieldCheck className="size-8" />} title={bi('لا توجد عقود مطابقة', 'No matching agreements')} action={can('agreement.write') && <LinkButton href="/service/agreements/new" variant="primary" icon={<Plus className="size-4" />}>{bi('عقد جديد', 'New agreement')}</LinkButton>} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('العميل / المواقع', 'Customer / sites')}</Th><Th>{bi('الباقة', 'Tier')}</Th><Th>{bi('المدة', 'Period')}</Th>
                <Th className="text-end">{bi('القيمة السنوية', 'Annual value')}</Th><Th>{bi('الزيارة القادمة', 'Next visit')}</Th><Th className="text-end">{bi('المستحق', 'Open balance')}</Th><Th>{bi('الحالة', 'Status')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((a) => {
                  const left = a.status === 'active' ? daysUntil(a.endDate) : null;
                  return (
                    <tr key={a.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/service/agreements/${a.id}`)}>
                      <Td><Link href={`/service/agreements/${a.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{a.number}</Link></Td>
                      <Td className="text-xs">
                        <div className="font-bold text-ink">{a.partyName ?? '—'}</div>
                        <div className="text-muted">{a.sites.map((s) => s.name).join('، ') || '—'}{a.assetCount > 0 && <> · {bi(`${a.assetCount} جهاز`, `${a.assetCount} devices`)}</>}</div>
                      </Td>
                      <Td><TierBadge tier={a.tier} /></Td>
                      <Td className="text-xs">
                        <Period from={a.startDate} to={a.endDate} />
                        {left !== null && left <= 60 && <div className="mt-0.5"><Badge tone={left < 0 ? 'red' : 'gold'}>{left < 0 ? bi('منتهٍ', 'Ended') : bi(`باقي ${left} يومًا`, `${left} days left`)}</Badge></div>}
                      </Td>
                      <Td className="text-end"><Money value={a.annualValue} /></Td>
                      <Td className="num whitespace-nowrap text-xs">{a.nextVisit ?? '—'}</Td>
                      <Td className="text-end">{Number(a.openBalance) > 0 ? <Money value={a.openBalance} className="font-bold text-danger" /> : <span className="text-muted">—</span>}</Td>
                      <Td><AgreementStatusBadge status={a.status} />{a.autoRenew && <div className="mt-0.5 text-[11px] text-muted">{bi('تجديد تلقائي', 'Auto-renew')}</div>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {list.data && list.data.total > rows.length && limit < 200 && (
              <div className="flex justify-center border-t border-line p-3">
                <Button variant="outline" size="sm" loading={list.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>{bi('عرض المزيد', 'Show more')} (<span className="num">{list.data.total - rows.length}</span>)</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

export default function AgreementsPage() {
  return <Suspense fallback={<Spinner />}><AgreementsList /></Suspense>;
}
