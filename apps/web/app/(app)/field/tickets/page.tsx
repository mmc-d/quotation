'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LifeBuoy, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, clsx, Empty, ErrorBox, PageHeader, SearchBox, Spinner, Table, Td, Th } from '@/components/ui';
import { CHANNEL, COVERAGE, CoverageBadge, DeviceRef, PriorityBadge, TICKET_STATUS, TicketStatusBadge, useLabel } from '../_components/common';
import { NewTicketDialog } from '../_components/ticket-dialog';
import type { TicketRow } from '../_components/types';
import { SLA_STATE, SlaBadges } from '../../service/_components/common';

const PAGE = 50;

function chipCls(on: boolean) {
  return clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', on ? 'border-gold bg-tint text-primary' : 'border-line text-muted hover:bg-tint/60');
}

function TicketsList() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { bi } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const term = useDeferredValue(q.trim());
  const [statuses, setStatuses] = useState<string[]>(() => (sp.get('status') ?? 'open,in_progress').split(',').filter(Boolean));
  const [coverage, setCoverage] = useState<string[]>(() => (sp.get('coverage') ?? '').split(',').filter(Boolean));
  const [sla, setSla] = useState<string>(() => (['at_risk', 'breached'].includes(sp.get('sla') ?? '') ? sp.get('sla')! : ''));
  const [limit, setLimit] = useState(PAGE);
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const presetAsset = sp.get('assetId');
  const status = statuses.join(',');
  const cov = coverage.join(',');

  useEffect(() => {
    const next = qs({ q: term, status, coverage: cov, sla, new: creating ? '1' : undefined, assetId: creating ? presetAsset : undefined });
    if (next !== (sp.toString() ? `?${sp.toString()}` : '')) router.replace(`${pathname}${next}`, { scroll: false });
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, status, cov, sla, creating]);

  const list = useQuery({
    queryKey: ['field-tickets', term, status, cov, sla, limit],
    queryFn: () => api.get<{ rows: TicketRow[]; total: number }>(`/field/tickets${qs({ q: term, status, coverage: cov, sla, limit })}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const toggle = (set: typeof setStatuses) => (v: string) => set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  return (
    <>
      <PageHeader
        title={bi('بلاغات الأعطال', 'Service calls')}
        subtitle={list.data ? bi(`${list.data.total} بلاغ`, `${list.data.total} service calls`) : undefined}
        actions={can('ticket.write') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{bi('بلاغ جديد', 'New service call')}</Button>}
      />
      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('الرقم، الموضوع، اسم أو جوال المتصل…', 'Number, subject, caller name or phone…')} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-muted">{bi('الحالة', 'Status')}:</span>
            <button type="button" onClick={() => setStatuses([])} className={chipCls(statuses.length === 0)}>{bi('الكل', 'All')}</button>
            {Object.keys(TICKET_STATUS).map((s) => <button key={s} type="button" aria-pressed={statuses.includes(s)} onClick={() => toggle(setStatuses)(s)} className={chipCls(statuses.includes(s))}>{label(TICKET_STATUS, s)}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-muted">{bi('التغطية', 'Coverage')}:</span>
            <button type="button" onClick={() => setCoverage([])} className={chipCls(coverage.length === 0)}>{bi('الكل', 'All')}</button>
            {Object.keys(COVERAGE).map((s) => <button key={s} type="button" aria-pressed={coverage.includes(s)} onClick={() => toggle(setCoverage)(s)} className={chipCls(coverage.includes(s))}>{label(COVERAGE, s)}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-muted">{bi('مستوى الخدمة', 'SLA')}:</span>
            <button type="button" onClick={() => setSla('')} className={chipCls(!sla)}>{bi('الكل', 'All')}</button>
            {['at_risk', 'breached'].map((s) => <button key={s} type="button" aria-pressed={sla === s} onClick={() => setSla(sla === s ? '' : s)} className={chipCls(sla === s)}>{label(SLA_STATE, s)}</button>)}
          </div>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<LifeBuoy className="size-8" />} title={bi('لا توجد بلاغات مطابقة', 'No matching service calls')} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('الموضوع', 'Subject')}</Th><Th>{bi('العميل / الموقع', 'Customer / site')}</Th><Th>{bi('الجهاز', 'Device')}</Th>
                <Th>{bi('الأولوية', 'Priority')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('التغطية', 'Coverage')}</Th><Th>{bi('مستوى الخدمة', 'SLA')}</Th><Th>{bi('القناة', 'Channel')}</Th><Th>{bi('التاريخ', 'Date')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/field/tickets/${t.id}`)}>
                    <Td><Link href={`/field/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{t.number}</Link></Td>
                    <Td><div className="font-bold">{t.subject}</div>{(t.contactName || t.contactPhone) && <div className="text-xs text-muted">{t.contactName} <span dir="ltr" className="num">{t.contactPhone}</span></div>}</Td>
                    <Td className="text-xs"><div>{t.partyName ?? '—'}</div>{t.siteName && <div className="text-muted">{t.siteName}{t.locationPath && <> · <span dir="ltr" className="num">{t.locationPath}</span></>}</div>}</Td>
                    <Td className="text-xs">{t.asset ? <DeviceRef code={t.asset.code} serial={t.asset.serial} /> : '—'}</Td>
                    <Td><PriorityBadge priority={t.priority} /></Td>
                    <Td><TicketStatusBadge status={t.status} /></Td>
                    <Td><CoverageBadge coverage={t.coverage} reason={t.coverageReason} />{t.agreementNumber && <div dir="ltr" className="num mt-0.5 text-[11px] text-muted">{t.agreementNumber}</div>}</Td>
                    <Td><SlaBadges sla={t.sla} /></Td>
                    <Td className="whitespace-nowrap text-xs">{label(CHANNEL, t.channel)}</Td>
                    <Td className="num whitespace-nowrap text-xs">{dateTime(t.createdAt)}</Td>
                  </tr>
                ))}
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
      <NewTicketDialog open={creating} assetId={presetAsset} onClose={() => setCreating(false)} />
    </>
  );
}

export default function TicketsPage() {
  return <Suspense fallback={<Spinner />}><TicketsList /></Suspense>;
}
