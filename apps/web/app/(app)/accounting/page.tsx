'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, CheckCircle2, ListTree, Plus, Scale } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Card, ErrorBox, LinkButton, Money, PageHeader, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { RequirePerm } from '../settings/_components/common';
import { Amt, EntryStatus, KindBadge } from './_components/ledger-kit';

interface Bal { code: string; nameAr: string; balance: string }
interface Dash {
  today: string; fiscalYear: { label: string; start: string; end: string }; lockedThrough: string | null; goLiveDate: string | null;
  balances: Record<'cash' | 'bank' | 'ar' | 'ap' | 'inventory' | 'vatInput' | 'vatOutput', Bal | null>;
  profit: { month: string; year: string; monthRevenue: string; yearRevenue: string }; draftEntries: number;
  recent: { id: string; number: string; date: string; memo: string | null; kind: string; total: string; status: string }[];
  checks: { key: string; ok: boolean; labelAr: string }[];
}

export default function AccountingHome() {
  return <RequirePerm perm="ledger.read" title="الحسابات"><Home /></RequirePerm>;
}

function Home() {
  const { bi } = useI18n();
  const { can } = useMe();
  const q = useQuery({ queryKey: ['ledger-dashboard'], queryFn: () => api.get<Dash>('/accounting/dashboard') });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  const profitTone = (v: string) => (Number(v) < 0 ? 'red' : 'green');
  return (
    <>
      <PageHeader title={bi('الحسابات', 'Accounting')} subtitle={`${bi('السنة المالية', 'Fiscal year')} ${d.fiscalYear.label}${d.lockedThrough ? ` · ${bi('مقفلة حتى', 'locked through')} ${date(d.lockedThrough)}` : ''}`}
        actions={can('ledger.write') && <LinkButton href="/accounting/journal/new" variant="primary" icon={<Plus className="size-4" />}>{bi('قيد جديد', 'New entry')}</LinkButton>} />
      {!d.goLiveDate && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gold/40 bg-tint/60 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 text-gold-dark" />{bi('لم يُحدَّد تاريخ بدء النظام المحاسبي بعد.', 'The ledger go-live date is not set yet.')}
          {can('ledger.close') && <Link href="/accounting/opening" className="font-bold text-primary hover:underline">{bi('أدخل الأرصدة الافتتاحية', 'Enter opening balances')}</Link>}
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={bi('الصندوق', 'Cash')} value={d.balances.cash ? <Money value={d.balances.cash.balance} fixed /> : '—'} />
        <Stat label={bi('البنك', 'Bank')} value={d.balances.bank ? <Money value={d.balances.bank.balance} fixed /> : '—'} />
        <Stat label={bi('العملاء (مدينون)', 'Receivables')} value={d.balances.ar ? <Money value={d.balances.ar.balance} fixed /> : '—'} tone="gold" />
        <Stat label={bi('الموردون (دائنون)', 'Payables')} value={d.balances.ap ? <Money value={d.balances.ap.balance} fixed /> : '—'} tone="red" />
        <Stat label={bi('صافي ربح الشهر', 'This month’s net profit')} value={<Money value={d.profit.month} fixed />} tone={profitTone(d.profit.month)} hint={`${bi('الإيرادات', 'Revenue')} ${Number(d.profit.monthRevenue).toLocaleString('en-US')}`} />
        <Stat label={bi('صافي ربح السنة المالية', 'Fiscal-year net profit')} value={<Money value={d.profit.year} fixed />} tone={profitTone(d.profit.year)} hint={`${bi('الإيرادات', 'Revenue')} ${Number(d.profit.yearRevenue).toLocaleString('en-US')}`} />
        <Stat label={bi('المخزون', 'Inventory')} value={d.balances.inventory ? <Money value={d.balances.inventory.balance} fixed /> : '—'} />
        <Stat label={bi('قيود بانتظار الترحيل', 'Drafts to post')} value={d.draftEntries} tone={d.draftEntries ? 'gold' : undefined} hint={d.draftEntries ? <Link href="/accounting/journal?status=draft" className="font-bold text-gold-dark hover:underline">{bi('عرضها', 'Show them')}</Link> : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card padded={false} title={bi('آخر القيود', 'Recent entries')} actions={<Link href="/accounting/journal" className="text-xs font-bold text-gold-dark hover:underline">{bi('كل القيود', 'All entries')}</Link>}>
          <Table>
            <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('البيان', 'Description')}</Th><Th>{bi('النوع', 'Kind')}</Th><Th className="text-end">{bi('المبلغ', 'Amount')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
            <tbody>
              {d.recent.map((r) => (
                <tr key={r.id} className="hover:bg-tint/50">
                  <Td><Link href={`/accounting/journal/${r.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{r.number}</Link></Td>
                  <Td className="num text-xs">{date(r.date)}</Td><Td className="max-w-[16rem] truncate text-xs">{r.memo}</Td><Td><KindBadge kind={r.kind} /></Td><Td className="text-end"><Amt v={r.total} /></Td><Td><EntryStatus status={r.status} /></Td>
                </tr>
              ))}
              {!d.recent.length && <tr><Td colSpan={6} className="py-8 text-center text-muted">{bi('لا توجد قيود بعد.', 'No entries yet.')}</Td></tr>}
            </tbody>
          </Table>
        </Card>
        <div className="grid content-start gap-4">
          <Card title={bi('فحوصات السلامة', 'Integrity checks')}>
            <ul className="space-y-2 text-sm">
              {d.checks.map((c) => <li key={c.key} className="flex items-start gap-2">{c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />}<span className={c.ok ? '' : 'font-bold text-danger'}>{c.labelAr}</span></li>)}
            </ul>
          </Card>
          <Card title={bi('اختصارات', 'Shortcuts')}>
            <div className="grid gap-2 text-sm">
              <Link href="/accounting/reports" className="flex items-center gap-2 font-bold text-primary hover:underline"><Scale className="size-4" />{bi('ميزان المراجعة والقوائم المالية', 'Trial balance & statements')}</Link>
              <Link href="/accounting/accounts" className="flex items-center gap-2 font-bold text-primary hover:underline"><ListTree className="size-4" />{bi('دليل الحسابات', 'Chart of accounts')}</Link>
              <Link href="/accounting/journal" className="flex items-center gap-2 font-bold text-primary hover:underline"><BookOpen className="size-4" />{bi('قيود اليومية', 'Journal entries')}</Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
