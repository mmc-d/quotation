'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileUser, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Card, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, Stat, Table, Tabs, Td, Th } from '@/components/ui';
import { OFFER_STATUS } from '../_components/hr-kit';

interface Row { id: string; number: string; offerDate: string; validUntil: string; candidateNameAr: string; jobTitleAr: string; department: string | null; startDate: string; status: string; employeeId: string | null; monthlyTotal: string }
interface ListResult { rows: Row[]; total: number; summary: { drafts: number; open: number; toHire: number } }

export default function OffersPage() {
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['hr-offers', status, q],
    queryFn: () => api.get<ListResult>(`/hr/offers${qs({ status: status === 'all' ? undefined : status, q: q || undefined, limit: 200 })}`),
  });
  const s = list.data?.summary;

  return (
    <>
      <PageHeader
        title={bi('العروض الوظيفية', 'Job offers')}
        subtitle={bi('يُعدّ مسؤول الموارد البشرية العرض كمسودة، ويصدره المدير العام بعد مراجعة نظام العمل، ثم يُسجَّل رد المرشح.', 'HR prepares a draft; the general manager issues it after the Labor Law check; then the candidate\'s answer is recorded.')}
        actions={can('hr.write') && <LinkButton href="/hr/offers/new" variant="primary" icon={<Plus className="size-4" />}>{bi('عرض وظيفي جديد', 'New job offer')}</LinkButton>}
      />
      {s && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label={bi('مسودات بانتظار الإصدار', 'Drafts awaiting issue')} value={s.drafts} tone={s.drafts ? 'gold' : undefined} />
          <Stat label={bi('عروض صادرة بانتظار الرد', 'Issued, awaiting answer')} value={s.open} />
          <Stat label={bi('مقبولة ولم يُنشأ ملف الموظف', 'Accepted, not yet hired')} value={s.toHire} tone={s.toHire ? 'green' : undefined} />
        </div>
      )}
      <Card padded={false}>
        <div className="border-b border-line px-3 pt-2">
          <Tabs value={status} onChange={setStatus} items={[
            { value: 'all', label: bi('الكل', 'All') },
            { value: 'draft', label: bi('مسودات', 'Drafts') },
            { value: 'approved', label: bi('صادرة', 'Issued') },
            { value: 'accepted', label: bi('مقبولة', 'Accepted') },
            { value: 'rejected', label: bi('مرفوضة', 'Declined') },
            { value: 'expired', label: bi('منتهية', 'Expired') },
            { value: 'cancelled', label: bi('مسحوبة', 'Withdrawn') },
          ]} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم العرض، المرشح، الوظيفة، القسم…', 'Number, candidate, job, department…')} />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<FileUser className="size-8" />} title={bi('لا توجد عروض', 'No offers')} hint={can('hr.write') ? bi('أنشئ عرضًا وظيفيًا من الزر أعلاه.', 'Create a job offer with the button above.') : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('المرشح', 'Candidate')}</Th><Th>{bi('الوظيفة', 'Job')}</Th><Th>{bi('المباشرة', 'Start')}</Th><Th className="text-end">{bi('الإجمالي الشهري', 'Monthly')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
            <tbody>
              {list.data.rows.map((r) => {
                const st = OFFER_STATUS[r.status];
                return (
                  <tr key={r.id} className="hover:bg-tint/50">
                    <Td><Link href={`/hr/offers/${r.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{r.number}</Link></Td>
                    <Td className="num text-xs">{date(r.offerDate)}</Td>
                    <Td className="font-bold">{r.candidateNameAr}</Td>
                    <Td className="text-xs">{r.jobTitleAr}{r.department && <span className="text-muted"> · {r.department}</span>}</Td>
                    <Td className="num text-xs">{date(r.startDate)}</Td>
                    <Td className="text-end"><Money value={r.monthlyTotal} fixed /></Td>
                    <Td><div className="flex items-center gap-1">{st && <Badge tone={st[2]}>{locale === 'en' ? st[1] : st[0]}</Badge>}{r.status === 'accepted' && !r.employeeId && <Badge tone="gold">{bi('بانتظار التعيين', 'To hire')}</Badge>}</div></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
