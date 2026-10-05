'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Hourglass } from 'lucide-react';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { Card, Empty, ErrorBox, Money, PageHeader, Spinner, Table, Td, Th, clsx } from '@/components/ui';

type Bucket = 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
type Amounts = Record<Bucket, number> & { total: number };
interface Aging { asOf: string; rows: (Amounts & { partyId: string | null; partyName: string })[]; totals: Amounts }

const BUCKETS: { key: Bucket; label: string; color: string }[] = [
  { key: 'current', label: 'غير مستحق بعد', color: 'bg-emerald-600' },
  { key: '1_30', label: '1–30 يوم', color: 'bg-gold' },
  { key: '31_60', label: '31–60 يوم', color: 'bg-amber-500' },
  { key: '61_90', label: '61–90 يوم', color: 'bg-orange-600' },
  { key: '90_plus', label: 'أكثر من 90', color: 'bg-rose-600' },
];

function Cell({ v, late }: { v: number; late?: boolean }) {
  return v ? <Money value={v} className={clsx(late && 'text-danger')} /> : <span className="text-muted">—</span>;
}

export default function AgingPage() {
  const q = useQuery({ queryKey: ['ar-aging'], queryFn: () => api.get<Aging>('/finance/ar-aging') });
  const d = q.data;
  return (
    <>
      <PageHeader title="أعمار الذمم المدينة" subtitle={d ? <>حتى تاريخ <span className="num">{date(d.asOf)}</span> — من أرصدة الفواتير غير المسددة</> : 'AR aging'} />
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : !d || !d.rows.length ? (
        <Card><Empty icon={<Hourglass className="size-8" />} title="لا توجد ذمم مدينة" hint="جميع الفواتير مسددة." /></Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-bold text-muted">إجمالي المستحق</span>
              <span className="text-2xl font-extrabold text-primary"><Money value={d.totals.total} /></span>
            </div>
            <div className="flex h-4 overflow-hidden rounded-full bg-gray-100">
              {BUCKETS.map((b) => d.totals[b.key] > 0 && (
                <div key={b.key} className={clsx('h-full', b.color)} style={{ width: `${(d.totals[b.key] / d.totals.total) * 100}%` }} title={b.label} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
              {BUCKETS.map((b) => (
                <span key={b.key} className="inline-flex items-center gap-1.5">
                  <span className={clsx('size-2.5 rounded-full', b.color)} />
                  <span className="text-muted">{b.label}</span>
                  <Money value={d.totals[b.key]} className="font-bold" />
                  <span className="num text-muted">({d.totals.total ? Math.round((d.totals[b.key] / d.totals.total) * 100) : 0}%)</span>
                </span>
              ))}
            </div>
          </Card>
          <Card padded={false}>
            <Table>
              <thead><tr><Th>العميل</Th>{BUCKETS.map((b) => <Th key={b.key} className="text-end">{b.label}</Th>)}<Th className="text-end">الإجمالي</Th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.partyId ?? 'none'} className="hover:bg-tint/50">
                    <Td>{r.partyId ? <Link href={`/finance/statement/${r.partyId}`} className="font-bold text-primary hover:underline">{r.partyName}</Link> : <span className="text-muted">{r.partyName}</span>}</Td>
                    {BUCKETS.map((b) => <Td key={b.key} className="text-end"><Cell v={r[b.key]} late={b.key !== 'current'} /></Td>)}
                    <Td className="text-end font-extrabold"><Money value={r.total} /></Td>
                  </tr>
                ))}
                <tr className="bg-tint/60 font-extrabold">
                  <Td>الإجمالي</Td>
                  {BUCKETS.map((b) => <Td key={b.key} className="text-end"><Cell v={d.totals[b.key]} late={b.key !== 'current'} /></Td>)}
                  <Td className="text-end text-primary"><Money value={d.totals.total} /></Td>
                </tr>
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
