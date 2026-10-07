'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, FolderKanban } from 'lucide-react';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalProject, type Rows } from '../_components/portal-api';
import { ClockSummary, StageStepper } from '../_components/project-kit';
import { Chip, EmptyState, ErrorBlock, Loading, Num, PageTitle, linkCard } from '../_components/portal-ui';

export default function ProjectsPage() {
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['portal', 'projects'], queryFn: () => portalFetch<Rows<PortalProject>>('/projects'), retry: portalRetry });

  return (
    <div>
      <PageTitle title={bi('المشاريع', 'Projects')} subtitle={bi('مراحل مشاريعك والاعتمادات المطلوبة منك.', 'Your project stages and the approvals we need from you.')} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBlock error={q.error} onRetry={() => q.refetch()} /> : !q.data?.rows.length ? (
        <EmptyState icon={<FolderKanban className="size-8" />} title={bi('لا توجد مشاريع', 'No projects')} hint={bi('تظهر مشاريع التوريد والتركيب هنا بعد توقيع العقد.', 'Supply and installation projects appear here once the contract is signed.')} />
      ) : (
        <ul className="space-y-3">
          {q.data.rows.map((p) => (
            <li key={p.id}>
              <Link href={`/portal/projects/${p.id}`} className={linkCard}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Num className="text-xs font-bold text-muted">{p.number}</Num>
                    <p className="font-extrabold text-ink">{p.name ?? p.number}</p>
                    {p.acceptedOn && <p className="text-xs text-muted">{bi('تاريخ القبول', 'Accepted on')} <Num>{date(p.acceptedOn)}</Num></p>}
                  </div>
                  {p.approvalsPending > 0 && (
                    <Chip className="bg-amber-100 text-amber-900"><ClipboardCheck className="size-3" aria-hidden /><Num>{p.approvalsPending}</Num> {bi('بانتظار موافقتك', 'awaiting your approval')}</Chip>
                  )}
                </div>
                <StageStepper stage={p.stage} compact />
                <div className="mt-3 border-t border-line pt-3"><ClockSummary clock={p.clock} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
