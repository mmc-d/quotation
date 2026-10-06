'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpDown, Download, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { h, money } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Money, PageHeader, Spinner, Stat, Table, Td, Th, clsx } from '@/components/ui';
import { stageLabel } from '../../projects/_components/kit';
import { downloadCsv } from '../_components/csv';
import { FlagBadges, MarginBadge, SourceNote, type ProjectProfitRow, type ProjectsInsights } from '../_components/insights';

type SortKey = 'number' | 'customer' | 'contractValue' | 'invoiced' | 'collected' | 'materialCost' | 'committedCost' | 'labourCost' | 'margin' | 'marginPct';
type StatusFilter = 'open' | 'active' | 'all';

const sar = (v: string | null | undefined) => (v == null ? '' : (h(v) / 100).toFixed(2));

export default function ProjectProfitabilityPage() {
  const { can, me } = useMe();
  const { bi, locale } = useI18n();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'marginPct', dir: 1 });
  const q = useQuery({ queryKey: ['insights-projects', status], queryFn: () => api.get<ProjectsInsights>(`/insights/projects?status=${status}`), enabled: can('report.finance') && can('project.read') });

  const rows = useMemo(() => {
    const list = [...(q.data?.rows ?? [])];
    const val = (r: ProjectProfitRow): number | string => {
      if (sort.key === 'number') return r.number;
      if (sort.key === 'customer') return r.customer ?? '';
      if (sort.key === 'marginPct') return r.marginPct ?? Number.POSITIVE_INFINITY;
      return h(r[sort.key] as string | undefined);
    };
    list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir;
    });
    return list;
  }, [q.data, sort]);

  if (me && !(can('report.finance') && can('project.read'))) {
    return <><PageHeader title={bi('ربحية المشاريع', 'Project profitability')} /><Card><Empty title={bi('لا تملك صلاحية هذا التقرير', 'You do not have permission for this report')} /></Card></>;
  }
  const d = q.data;
  const cost = !!d?.costVisible;

  const SortTh = ({ k, children, end }: { k: SortKey; children: React.ReactNode; end?: boolean }) => (
    <Th className={end ? 'text-end' : undefined}>
      <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === 'number' || k === 'customer' || k === 'marginPct' ? 1 : -1 }))}>
        {children}<ArrowUpDown className={clsx('size-3', sort.key === k ? 'opacity-100' : 'opacity-30')} />
      </button>
    </Th>
  );

  const exportCsv = () => {
    const header = [bi('المشروع', 'Project'), bi('الاسم', 'Name'), bi('العقد', 'Contract'), bi('العميل', 'Customer'), bi('المرحلة', 'Stage'), bi('قيمة العقد (بدون ضريبة)', 'Contract value (excl. VAT)'), bi('المفوتر', 'Invoiced'), bi('المحصَّل', 'Collected'), bi('ساعات العمل', 'Labour hours'),
      ...(cost ? [bi('تكلفة المواد', 'Material cost'), bi('مشتريات ملتزم بها', 'Committed purchases'), bi('تكلفة العمالة', 'Labour cost'), bi('التكلفة المتوقعة', 'Cost at completion'), bi('الهامش', 'Margin'), bi('الهامش %', 'Margin %'), bi('تنبيهات', 'Flags')] : [])];
    const body = rows.map((r) => [r.number, r.name, r.contractNumber ?? '', r.customer ?? '', stageLabel(r.stage, locale), sar(r.contractValue), sar(r.invoiced), sar(r.collected), r.labourHours,
      ...(cost ? [sar(r.materialCost), sar(r.committedCost), sar(r.labourCost), sar(r.costAtCompletion), sar(r.margin), r.marginPct ?? '', (r.flags ?? []).join(' ')] : [])]);
    downloadCsv(`project-profitability_${new Date().toISOString().slice(0, 10)}.csv`, header, body);
  };

  return (
    <>
      <PageHeader title={bi('ربحية المشاريع', 'Project profitability')} subtitle={bi('قيمة العقد مقابل المواد والمشتريات الملتزم بها والعمالة', 'Contract value against materials, committed purchases and labour')} />
      <SourceNote className="mb-4" />
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {([['open', 'المفتوحة', 'Open'], ['active', 'النشطة', 'Active'], ['all', 'الكل', 'All']] as const).map(([v, ar, en]) => (
          <Button key={v} size="sm" variant={status === v ? 'primary' : 'ghost'} onClick={() => setStatus(v)}>{bi(ar, en)}</Button>
        ))}
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading || !d ? <Spinner /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={bi('عدد المشاريع', 'Projects')} value={<span className="num">{d.totals.projects}</span>} />
            <Stat label={bi('قيمة العقود', 'Contract value')} value={<span className="num text-xl">{money(d.totals.contractValue)}</span>} hint={bi('ر.س بدون الضريبة', 'SAR excl. VAT')} />
            <Stat label={bi('المحصَّل', 'Collected')} tone="green" value={<span className="num text-xl">{money(d.totals.collected)}</span>} hint={<span className="num">{bi('المفوتر', 'Invoiced')} {money(d.totals.invoiced)}</span>} />
            {cost
              ? <Stat label={bi('الهامش المتوقع', 'Expected margin')} tone={d.totals.marginPct != null && d.totals.marginPct < d.assumptions.lowMarginPercent ? 'red' : 'gold'} value={<span className="num text-xl">{money(d.totals.margin)}</span>} hint={<span className="num">{d.totals.marginPct != null ? `${d.totals.marginPct.toFixed(1)}%` : '—'}</span>} />
              : <Stat label={bi('الهامش', 'Margin')} value="—" hint={bi('يحتاج صلاحية تكاليف الشراء', 'Needs the purchase-cost permission')} />}
          </div>
          <Card padded={false} title={<span className="inline-flex items-center gap-2"><TrendingUp className="size-4" />{bi('المشاريع', 'Projects')}</span>} actions={<Button size="sm" variant="outline" icon={<Download className="size-3.5" />} disabled={!rows.length} onClick={exportCsv}>{bi('تصدير CSV', 'Export CSV')}</Button>}>
            {rows.length === 0 ? <Empty icon={<TrendingUp className="size-8" />} title={bi('لا توجد مشاريع', 'No projects')} /> : (
              <Table>
                <thead>
                  <tr>
                    <SortTh k="number">{bi('المشروع', 'Project')}</SortTh>
                    <SortTh k="customer">{bi('العميل', 'Customer')}</SortTh>
                    <Th>{bi('المرحلة', 'Stage')}</Th>
                    <SortTh k="contractValue" end>{bi('قيمة العقد', 'Contract value')}</SortTh>
                    <SortTh k="invoiced" end>{bi('المفوتر', 'Invoiced')}</SortTh>
                    <SortTh k="collected" end>{bi('المحصَّل', 'Collected')}</SortTh>
                    {cost && <>
                      <SortTh k="materialCost" end>{bi('المواد', 'Materials')}</SortTh>
                      <SortTh k="committedCost" end>{bi('ملتزم به', 'Committed')}</SortTh>
                      <SortTh k="labourCost" end>{bi('العمالة', 'Labour')}</SortTh>
                      <SortTh k="margin" end>{bi('الهامش', 'Margin')}</SortTh>
                      <SortTh k="marginPct">{bi('الهامش %', 'Margin %')}</SortTh>
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-tint/50">
                      <Td className="whitespace-nowrap"><Link href={`/projects/${r.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{r.number}</Link><div className="max-w-[14rem] truncate text-[11px] text-muted">{r.name}</div></Td>
                      <Td className="max-w-[12rem] truncate">{r.customer ?? '—'}</Td>
                      <Td className="whitespace-nowrap"><Badge>{stageLabel(r.stage, locale)}</Badge></Td>
                      <Td className="text-end"><Money value={r.contractValue} /></Td>
                      <Td className="text-end"><Money value={r.invoiced} />{r.invoicedPct != null && <div className="num text-[11px] text-muted">{r.invoicedPct}%</div>}</Td>
                      <Td className="text-end"><Money value={r.collected} /></Td>
                      {cost && <>
                        <Td className="text-end"><Money value={r.materialCost} /></Td>
                        <Td className="text-end"><Money value={r.committedCost} /></Td>
                        <Td className="text-end"><Money value={r.labourCost} /><div className="num text-[11px] text-muted">{r.labourHours} {bi('س', 'h')}</div></Td>
                        <Td className={clsx('text-end font-bold', h(r.margin) < 0 && 'text-danger')}><Money value={r.margin} /></Td>
                        <Td><div className="flex flex-wrap items-center gap-1"><MarginBadge pct={r.marginPct} low={d.assumptions.lowMarginPercent} /><FlagBadges flags={r.flags} /></div></Td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <p className="mt-3 text-[11px] text-muted">
            {bi(
              `الهامش المتوقع = قيمة العقد − (المواد المصروفة + أوامر الشراء المفتوحة للمشروع + ساعات العمل × ${d.assumptions.labourRateSar} ر.س). تنبيه «هامش منخفض» تحت ${d.assumptions.lowMarginPercent}%.`,
              `Expected margin = contract value − (materials issued + open project POs + labour hours × SAR ${d.assumptions.labourRateSar}). "Low margin" below ${d.assumptions.lowMarginPercent}%.`,
            )}
          </p>
        </>
      )}
    </>
  );
}
