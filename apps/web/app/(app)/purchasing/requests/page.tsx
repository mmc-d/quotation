'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, clsx, Empty, ErrorBox, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { MR_STATUS, MrStatusBadge, chipCls, useLabel } from '../_components/common';
import { NewRequestDialog } from '../_components/mr-dialogs';
import type { MrRow } from '../_components/types';

const PAGE = 50;

function RequestsList() {
  const sp = useSearchParams();
  const router = useRouter();
  const { bi } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const [statuses, setStatuses] = useState<string[]>(() => (sp.get('status') ?? 'draft,approved').split(',').filter(Boolean));
  const [limit, setLimit] = useState(PAGE);
  const [creating, setCreating] = useState(false);
  const projectId = sp.get('projectId');
  const filters = { status: statuses.join(','), projectId, limit };
  const list = useQuery({
    queryKey: ['mr-list', filters],
    queryFn: () => api.get<{ rows: MrRow[]; total: number }>(`/inventory/material-requests${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const toggle = (s: string) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const canCreate = can('purchase.write') && can('inventory.write');

  return (
    <>
      <PageHeader
        title={bi('طلبات المواد', 'Material requests')}
        subtitle={list.data ? bi(`${list.data.total} طلب`, `${list.data.total} requests`) : undefined}
        actions={canCreate && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{bi('طلب جديد من مشروع', 'New request from project')}</Button>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-3">
          <button type="button" onClick={() => setStatuses([])} className={chipCls(statuses.length === 0)}>{bi('الكل', 'All')}</button>
          {Object.keys(MR_STATUS).map((s) => <button key={s} type="button" aria-pressed={statuses.includes(s)} onClick={() => toggle(s)} className={chipCls(statuses.includes(s))}>{label(MR_STATUS, s)}</button>)}
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<ClipboardCheck className="size-8" />} title={bi('لا توجد طلبات مواد مطابقة', 'No matching material requests')}
            hint={bi('أنشئ طلبًا من مشروع له عقد لحساب النواقص.', 'Create one from a project with a contract to work out the shortage.')} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('المشروع', 'Project')}</Th><Th>{bi('الحالة', 'Status')}</Th>
                <Th>{bi('البنود', 'Lines')}</Th><Th>{bi('مطلوب بتاريخ', 'Needed by')}</Th><Th>{bi('تاريخ الإنشاء', 'Created')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/purchasing/requests/${r.id}`)}>
                    <Td><Link href={`/purchasing/requests/${r.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{r.number}</Link></Td>
                    <Td className="text-xs">
                      {r.projectId ? <Link href={`/projects/${r.projectId}`} onClick={(e) => e.stopPropagation()} className="hover:underline"><span dir="ltr" className="num font-bold">{r.projectNumber}</span> {r.projectName}</Link> : <span className="text-muted">—</span>}
                    </Td>
                    <Td><MrStatusBadge status={r.status} /></Td>
                    <Td><span className="num">{r.lineCount}</span></Td>
                    <Td><span className="num text-xs">{date(r.neededBy)}</span></Td>
                    <Td><span className="num text-xs">{date(r.createdAt)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.data && list.data.total > rows.length && limit < 200 && (
              <div className="flex justify-center border-t border-line p-3">
                <Button variant="outline" size="sm" loading={list.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>{bi('عرض المزيد', 'Show more')}</Button>
              </div>
            )}
          </>
        )}
      </Card>
      {creating && <NewRequestDialog open onClose={() => setCreating(false)} />}
    </>
  );
}

export default function RequestsPage() {
  return <Suspense fallback={<Spinner />}><RequestsList /></Suspense>;
}
