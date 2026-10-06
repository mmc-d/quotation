'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban } from 'lucide-react';
import { PROJECT_STAGES } from '@mmc/domain';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, clsx, Empty, ErrorBox, PageHeader, SearchBox, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import type { StaffUser } from '@/components/user-select';
import { Chip, ClockBar, MapChip, stageLabel } from './_components/kit';
import { CLOCK_LEVEL, PROJECT_STATUS, type ProjectRow, type ProjectSummary } from './_components/types';

const PAGE = 50;

function ProjectsList() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { bi, locale } = useI18n();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [stage, setStage] = useState(sp.get('stage') ?? '');
  const [limit, setLimit] = useState(PAGE);
  const term = useDeferredValue(q.trim());

  useEffect(() => {
    const next = qs({ q: term, stage });
    if (next !== (sp.toString() ? `?${sp.toString()}` : '')) router.replace(`${pathname}${next}`, { scroll: false });
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, stage]);

  const summary = useQuery({ queryKey: ['projects', 'summary'], queryFn: () => api.get<ProjectSummary>('/projects/dashboard/summary') });
  const list = useQuery({
    queryKey: ['projects', term, stage, limit],
    queryFn: () => api.get<{ rows: ProjectRow[]; total: number }>(`/projects${qs({ q: term, stage, limit: Math.min(limit, 200) })}`),
    placeholderData: (prev) => prev,
  });
  const users = useQuery({ queryKey: ['users-min'], queryFn: () => api.get<StaffUser[]>('/users').catch(() => [] as StaffUser[]), staleTime: 300_000 });
  const userName = (id: string | null) => (id ? (users.data ?? []).find((u) => u.id === id) : undefined);
  const rows = list.data?.rows ?? [];
  const s = summary.data;
  const atRisk = s ? s.clocks.warn70 + s.clocks.warn90 + s.clocks.overdue : null;

  const chip = (value: string, label: string, count?: number) => (
    <button key={value || 'all'} type="button" onClick={() => setStage(value)} aria-pressed={stage === value}
      className={clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition whitespace-nowrap', stage === value ? (value ? 'border-gold bg-tint text-primary' : 'border-primary bg-primary text-white') : 'border-line text-muted hover:bg-tint/60')}>
      {label}{count !== undefined && <span className="num ms-1 opacity-70">{count}</span>}
    </button>
  );

  return (
    <>
      <PageHeader title={bi('المشاريع', 'Projects')} subtitle={list.data ? bi(`${list.data.total} مشروع`, `${list.data.total} projects`) : undefined} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={bi('مشاريع نشطة', 'Active projects')} value={<span className="num">{s?.total ?? '—'}</span>} />
        <Stat label={bi('مُدد توريد في خطر', 'Delivery clocks at risk')} tone={atRisk ? 'red' : undefined} value={<span className="num">{atRisk ?? '—'}</span>}
          hint={s && <span className="num">{bi(`متأخر ${s.clocks.overdue} · فوق 90% ${s.clocks.warn90} · فوق 70% ${s.clocks.warn70}`, `overdue ${s.clocks.overdue} · >90% ${s.clocks.warn90} · >70% ${s.clocks.warn70}`)}</span>} />
        <Stat label={bi('ملاحظات مفتوحة', 'Open snags')} tone={s?.openSnags ? 'gold' : undefined} value={<span className="num">{s?.openSnags ?? '—'}</span>} />
        <Stat label={bi('بانتظار بدء المدة', 'Clock not started')} value={<span className="num">{s?.clocks.not_started ?? '—'}</span>} />
      </div>

      {s && s.atRisk.length > 0 && (
        <Card title={bi('مشاريع تحتاج انتباهًا', 'Projects needing attention')} className="mb-5" padded={false}>
          <ul className="divide-y divide-line/70">
            {s.atRisk.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Link href={`/projects/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm hover:bg-tint/50">
                  <span className="num font-bold text-primary" dir="ltr">{r.number}</span>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="num text-xs text-muted" dir="ltr">{r.elapsed}/{r.maxDays}</span>
                  <Chip chip={CLOCK_LEVEL[r.level].chip}>{locale === 'en' ? CLOCK_LEVEL[r.level].en : CLOCK_LEVEL[r.level].ar}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم المشروع، الاسم، العميل، رقم العقد…', 'Project number, name, customer, contract number…')} />
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:flex-wrap">
            {chip('', bi('الكل', 'All'), s?.total)}
            {PROJECT_STAGES.map((st) => chip(st, stageLabel(st, locale), s?.byStage[st]))}
          </div>
        </div>
        <ErrorBox error={list.error ?? summary.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<FolderKanban className="size-8" />} title={term || stage ? bi('لا توجد مشاريع مطابقة', 'No matching projects') : bi('لا توجد مشاريع بعد', 'No projects yet')}
            hint={term || stage ? bi('جرّب تغيير البحث أو المرحلة.', 'Try changing the search or the stage.') : bi('يُنشأ المشروع تلقائيًا عند توقيع العقد.', 'A project is created automatically when a contract is signed.')} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('المشروع', 'Project')}</Th><Th>{bi('العميل', 'Customer')}</Th><Th>{bi('المرحلة', 'Stage')}</Th><Th>{bi('مدير المشروع', 'Manager')}</Th>
                <Th className="min-w-[10rem]">{bi('مدة التوريد (أيام عمل)', 'Delivery clock (working days)')}</Th><Th>{bi('الموعد الأقصى', 'Target (max)')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/projects/${r.id}`)}>
                    <Td><Link href={`/projects/${r.id}`} onClick={(e) => e.stopPropagation()} className="num whitespace-nowrap font-bold text-primary hover:underline" dir="ltr">{r.number}</Link></Td>
                    <Td>
                      <div className="font-bold">{r.name}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {r.contractNumber && <span className="num" dir="ltr">{r.contractNumber}</span>}
                        {r.status !== 'active' && <MapChip map={PROJECT_STATUS} value={r.status} />}
                      </div>
                    </Td>
                    <Td>{r.customerName ?? '—'}</Td>
                    <Td><Chip chip="bg-tint text-gold-dark">{stageLabel(r.stage, locale)}</Chip></Td>
                    <Td className="text-xs">{(() => { const u = userName(r.managerId); return u ? u.nameAr ?? u.email : r.managerId ? '…' : <span className="text-muted">—</span>; })()}</Td>
                    <Td>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={clsx('num font-bold', CLOCK_LEVEL[r.clock.level].text)} dir="ltr">{r.clock.level === 'not_started' ? '—' : `${r.clock.elapsed} / ${r.clock.maxDays}`}</span>
                        <span className="text-[11px] text-muted">{r.clock.paused ? bi('متوقفة مؤقتًا', 'Paused') : locale === 'en' ? CLOCK_LEVEL[r.clock.level].en : CLOCK_LEVEL[r.clock.level].ar}</span>
                      </div>
                      <ClockBar level={r.clock.level} ratio={r.clock.ratio} className="mt-1" />
                    </Td>
                    <Td className="num whitespace-nowrap text-xs">{date(r.clock.targetMax)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.data && list.data.total > rows.length && limit < 200 && (
              <div className="flex justify-center border-t border-line p-3">
                <Button variant="outline" size="sm" loading={list.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>{bi('عرض المزيد', 'Show more')} ({list.data.total - rows.length})</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

export default function ProjectsPage() {
  return <Suspense fallback={<Spinner />}><ProjectsList /></Suspense>;
}
