'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Card, Empty, ErrorBox, Input, LinkButton, PageHeader, SearchBox, Select, Spinner, Stat, Money, Table, Td, Th } from '@/components/ui';
import { RequirePerm } from '../../settings/_components/common';
import { Amt, EntryStatus, KIND_LABELS, KindBadge } from '../_components/ledger-kit';

interface Row { id: string; number: string; entryDate: string; memo: string | null; kind: string; status: string; total: string; sourceRef: string | null; reversedById: string | null; reversesId: string | null; postedByName: string | null }

export default function JournalPage() {
  return <RequirePerm perm="ledger.read" title="قيود اليومية"><Journal /></RequirePerm>;
}

function Journal() {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useQuery({
    queryKey: ['journal', q, status, kind, from, to],
    queryFn: () => api.get<{ rows: Row[]; total: number; amount: string }>(`/accounting/journal${qs({ q: q || undefined, status: status || undefined, kind: kind || undefined, from: from || undefined, to: to || undefined, limit: 200 })}`),
  });
  return (
    <>
      <PageHeader title={bi('قيود اليومية', 'Journal entries')} subtitle={bi('يُعدّ القيد اليدوي كمسودة ويرحّله شخص آخر؛ القيود المرحّلة لا تُعدَّل.', 'A manual entry is a draft until someone else posts it; posted entries are never edited.')}
        actions={can('ledger.write') && <LinkButton href="/accounting/journal/new" variant="primary" icon={<Plus className="size-4" />}>{bi('قيد جديد', 'New entry')}</LinkButton>} />
      {list.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Stat label={bi('عدد القيود (حسب التصفية)', 'Entries (filtered)')} value={list.data.total} />
          <Stat label={bi('مجموع المدين = الدائن', 'Total debits = credits')} value={<Money value={list.data.amount} fixed />} />
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم القيد، البيان، المرجع…', 'Number, memo, reference…')} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[10rem]">
            <option value="">{bi('كل الحالات', 'All statuses')}</option><option value="draft">{bi('مسودة', 'Draft')}</option><option value="posted">{bi('مُرحَّل', 'Posted')}</option>
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="max-w-[10rem]">
            <option value="">{bi('كل الأنواع', 'All kinds')}</option>
            {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{locale === 'en' ? l[1] : l[0]}</option>)}
          </Select>
          <label className="flex items-center gap-1 text-xs text-muted">{bi('من', 'From')}<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /></label>
          <label className="flex items-center gap-1 text-xs text-muted">{bi('إلى', 'To')}<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" /></label>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? <Empty icon={<BookOpen className="size-8" />} title={bi('لا توجد قيود', 'No entries')} /> : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('البيان', 'Description')}</Th><Th>{bi('النوع', 'Kind')}</Th><Th>{bi('المرجع', 'Source')}</Th><Th className="text-end">{bi('المبلغ', 'Amount')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
            <tbody>
              {list.data.rows.map((r) => (
                <tr key={r.id} className="hover:bg-tint/50">
                  <Td><Link href={`/accounting/journal/${r.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{r.number}</Link></Td>
                  <Td className="num text-xs">{date(r.entryDate)}</Td>
                  <Td className="max-w-[22rem] truncate text-xs">{r.memo}</Td>
                  <Td><KindBadge kind={r.kind} /></Td>
                  <Td className="num text-xs"><span dir="ltr">{r.sourceRef}</span></Td>
                  <Td className="text-end"><Amt v={r.total} /></Td>
                  <Td><EntryStatus status={r.status} reversed={!!r.reversedById} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
