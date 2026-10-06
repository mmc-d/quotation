'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Card, clsx, Empty, ErrorBox, LinkButton, PageHeader, SearchBox, Select, Spinner, Table, Td, Th, Button } from '@/components/ui';
import { CoverageBadge, WO_STATUS, WO_TYPE, WoStatusBadge, WoTypeBadge, riyadhDay, riyadhTime, useLabel } from '../_components/common';
import { useStaffOptions } from '../_components/schedule-dialog';
import type { WoSummary } from '../_components/types';

const PAGE = 50;
const OPEN = ['new', 'scheduled', 'dispatched', 'en_route', 'on_site', 'awaiting_parts', 'completed'];

function WorkOrdersList() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { bi } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const staff = useStaffOptions();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const term = useDeferredValue(q.trim());
  const [statuses, setStatuses] = useState<string[]>(() => (sp.get('status') ?? OPEN.join(',')).split(',').filter(Boolean));
  const [type, setType] = useState(sp.get('type') ?? '');
  const [technicianId, setTechnicianId] = useState(sp.get('technicianId') ?? '');
  const [projectId, setProjectId] = useState(sp.get('projectId'));
  const [ticketId, setTicketId] = useState(sp.get('ticketId'));
  const [assetId, setAssetId] = useState(sp.get('assetId'));
  const [limit, setLimit] = useState(PAGE);
  const status = statuses.join(',');

  useEffect(() => {
    const next = qs({ q: term, status, type, technicianId, projectId, ticketId, assetId });
    if (next !== (sp.toString() ? `?${sp.toString()}` : '')) router.replace(`${pathname}${next}`, { scroll: false });
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, status, type, technicianId, projectId, ticketId, assetId]);

  const filters = { q: term, status, type, technicianId, projectId, ticketId, assetId, limit };
  const list = useQuery({
    queryKey: ['field-wos', filters],
    queryFn: () => api.get<{ rows: WoSummary[]; total: number }>(`/field/work-orders${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const toggle = (s: string) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const chip = (on: boolean) => clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', on ? 'border-gold bg-tint text-primary' : 'border-line text-muted hover:bg-tint/60');
  const ctx = [
    projectId && { k: 'p', label: bi('مشروع محدد', 'One project'), clear: () => setProjectId(null) },
    ticketId && { k: 't', label: bi('بلاغ محدد', 'One service call'), clear: () => setTicketId(null) },
    assetId && { k: 'a', label: bi('جهاز محدد', 'One device'), clear: () => setAssetId(null) },
  ].filter(Boolean) as { k: string; label: string; clear: () => void }[];
  const newHref = `/field/work-orders/new${qs({ projectId, ticketId, assetId })}`;

  return (
    <>
      <PageHeader
        title={bi('أوامر العمل', 'Work orders')}
        subtitle={list.data ? bi(`${list.data.total} أمر عمل`, `${list.data.total} work orders`) : undefined}
        actions={<>
          {can('workorder.dispatch') && <LinkButton href="/field/dispatch">{bi('لوحة التوزيع', 'Dispatch board')}</LinkButton>}
          {can('workorder.write') && <LinkButton variant="primary" href={newHref} icon={<Plus className="size-4" />}>{bi('أمر عمل جديد', 'New work order')}</LinkButton>}
        </>}
      />
      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={q} onChange={setQ} placeholder={bi('رقم أمر العمل أو العنوان…', 'Work order number or title…')} />
            <div className="w-full max-w-[12rem]">
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">{bi('كل الأنواع', 'All types')}</option>
                {Object.keys(WO_TYPE).map((k) => <option key={k} value={k}>{label(WO_TYPE, k)}</option>)}
              </Select>
            </div>
            <div className="w-full max-w-[14rem]">
              <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                <option value="">{bi('كل الفنيين', 'All technicians')}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setStatuses([])} className={chip(statuses.length === 0)}>{bi('الكل', 'All')}</button>
            {Object.keys(WO_STATUS).map((s) => <button key={s} type="button" aria-pressed={statuses.includes(s)} onClick={() => toggle(s)} className={chip(statuses.includes(s))}>{label(WO_STATUS, s)}</button>)}
          </div>
          {ctx.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ctx.map((c) => <button key={c.k} type="button" onClick={c.clear} className="inline-flex items-center gap-1 rounded-full bg-tint px-2.5 py-1 text-xs font-bold text-primary">{c.label} <X className="size-3" /></button>)}
            </div>
          )}
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<ClipboardList className="size-8" />} title={bi('لا توجد أوامر عمل مطابقة', 'No matching work orders')} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('العنوان', 'Title')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('التغطية', 'Coverage')}</Th>
                <Th>{bi('العميل / الموقع', 'Customer / site')}</Th><Th>{bi('الفني', 'Technician')}</Th><Th>{bi('الموعد', 'Scheduled')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((w) => (
                  <tr key={w.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/field/work-orders/${w.id}`)}>
                    <Td><Link href={`/field/work-orders/${w.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{w.number}</Link></Td>
                    <Td className="font-bold">{w.title}</Td>
                    <Td><WoTypeBadge type={w.type} /></Td>
                    <Td><WoStatusBadge status={w.status} /></Td>
                    <Td><CoverageBadge coverage={w.coverage} /></Td>
                    <Td className="text-xs"><div>{w.partyName ?? '—'}</div>{w.siteName && <div className="text-muted">{w.siteName}{w.locationPath && <> · <span dir="ltr" className="num">{w.locationPath}</span></>}</div>}</Td>
                    <Td className="text-xs">{w.technicianName ?? <span className="text-muted">—</span>}{w.crewNames.length > 0 && <span className="text-muted"> +{w.crewNames.length}</span>}</Td>
                    <Td className="num whitespace-nowrap text-xs">{w.scheduledStart ? `${riyadhDay(w.scheduledStart)} ${riyadhTime(w.scheduledStart)}` : '—'}</Td>
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
    </>
  );
}

export default function WorkOrdersPage() {
  return <Suspense fallback={<Spinner />}><WorkOrdersList /></Suspense>;
}
