'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileText } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, h, money, today } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Field, Input, Money, PageHeader, Spinner, Stat, StatusBadge, Table, Td, Th, clsx } from '@/components/ui';
import { downloadCsv } from './_components/csv';

interface RegisterRow {
  id: string; number: string; revision: number; quote_date: string; status: string; client: string | null; owner: string | null;
  subtotal: string; discount_amount: string; discount_percent: string | null; total: string;
  cost_total?: string | null; margin_total?: string | null; margin_percent?: string | null;
}
interface LostRow { reason: string; count: number; amount: string }

const REASON_AR: Record<string, string> = { price: 'السعر', competitor: 'منافس', timing: 'التوقيت', no_response: 'لا يوجد رد', scope: 'خارج النطاق', other: 'أخرى' };
const STATUS_AR: Record<string, string> = { draft: 'مسودة', pending_approval: 'بانتظار الموافقة', approved: 'معتمد', sent: 'مُرسل', viewed: 'تمت المشاهدة', accepted: 'مقبول', rejected: 'مرفوض', expired: 'منتهي', lost: 'خسارة' };

function monthStart(d: string) { return `${d.slice(0, 8)}01`; }
const sar = (halalas: number) => (halalas / 100).toFixed(2);

export default function ReportsPage() {
  const { can, me } = useMe();
  const t = today();
  const [from, setFrom] = useState(monthStart(t));
  const [to, setTo] = useState(t);
  const range = from && to && from <= to ? { from, to } : null;

  const register = useQuery({ queryKey: ['quote-register', range], queryFn: () => api.get<RegisterRow[]>(`/dashboard/quote-register${qs(range!)}`), enabled: !!range && can('report.sales') });
  const lost = useQuery({ queryKey: ['lost-reasons', range], queryFn: () => api.get<LostRow[]>(`/dashboard/lost-reasons${qs(range!)}`), enabled: !!range && can('report.sales') });

  const rows = register.data ?? [];
  const hasMargin = rows.some((r) => r.cost_total !== undefined);
  const totals = useMemo(() => {
    const sum = (k: keyof RegisterRow) => rows.reduce((a, r) => a + h(r[k] as string | null | undefined), 0);
    const subtotal = sum('subtotal');
    const discount = sum('discount_amount');
    const total = sum('total');
    const withCost = rows.filter((r) => h(r.cost_total) > 0);
    const cost = withCost.reduce((a, r) => a + h(r.cost_total), 0);
    const margin = withCost.reduce((a, r) => a + h(r.margin_total), 0);
    // Rows carry margin % on their taxable base (not returned); recover it as margin / pct to weight the aggregate.
    const weighted = withCost.filter((r) => r.margin_percent != null && Number(r.margin_percent) !== 0);
    const taxableBase = weighted.reduce((a, r) => a + h(r.margin_total) / (Number(r.margin_percent) / 100), 0);
    const accepted = rows.filter((r) => r.status === 'accepted');
    return {
      subtotal, discount, total, cost, margin,
      discountPct: subtotal > 0 ? (discount / subtotal) * 100 : null,
      marginPct: taxableBase > 0 ? (weighted.reduce((a, r) => a + h(r.margin_total), 0) / taxableBase) * 100 : null,
      acceptedCount: accepted.length,
      acceptedValue: accepted.reduce((a, r) => a + h(r.total), 0),
    };
  }, [rows]);

  const exportCsv = () => {
    const header = ['رقم العرض', 'المراجعة', 'التاريخ', 'الحالة', 'العميل', 'المسؤول', 'الإجمالي قبل الخصم', 'الخصم', 'نسبة الخصم %', 'الإجمالي', ...(hasMargin ? ['التكلفة', 'الهامش', 'نسبة الهامش %'] : [])];
    const body = rows.map((r) => [
      r.number, `R${r.revision}`, date(r.quote_date), STATUS_AR[r.status] ?? r.status, r.client ?? '', r.owner ?? '',
      sar(h(r.subtotal)), sar(h(r.discount_amount)), r.discount_percent ?? '', sar(h(r.total)),
      ...(hasMargin ? [r.cost_total ? sar(h(r.cost_total)) : '', r.margin_total ? sar(h(r.margin_total)) : '', r.margin_percent ?? ''] : []),
    ]);
    body.push(['الإجمالي', '', '', `${rows.length} عرض`, '', '', sar(totals.subtotal), sar(totals.discount), totals.discountPct != null ? totals.discountPct.toFixed(1) : '', sar(totals.total), ...(hasMargin ? [sar(totals.cost), sar(totals.margin), totals.marginPct != null ? totals.marginPct.toFixed(1) : ''] : [])]);
    downloadCsv(`quote-register_${from}_${to}.csv`, header, body);
  };

  if (me && !can('report.sales')) {
    return <><PageHeader title="تقارير المبيعات" /><Card><Empty title="لا تملك صلاحية تقارير المبيعات" /></Card></>;
  }

  const lostRows = lost.data ?? [];
  const lostMax = Math.max(1, ...lostRows.map((r) => r.count));
  const lostTotal = lostRows.reduce((a, r) => a + r.count, 0);

  return (
    <>
      <PageHeader title="تقارير المبيعات" subtitle="سجل العروض وأسباب الخسارة" />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="من"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="إلى"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-1 pb-0.5">
            <Button size="sm" variant="ghost" onClick={() => { setFrom(monthStart(t)); setTo(t); }}>هذا الشهر</Button>
            <Button size="sm" variant="ghost" onClick={() => { const d = new Date(`${monthStart(t)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); const s = d.toISOString().slice(0, 10); const e = new Date(`${monthStart(t)}T12:00:00Z`); e.setUTCDate(0); setFrom(s); setTo(e.toISOString().slice(0, 10)); }}>الشهر الماضي</Button>
            <Button size="sm" variant="ghost" onClick={() => { setFrom(`${t.slice(0, 4)}-01-01`); setTo(t); }}>منذ بداية السنة</Button>
          </div>
          {!range && <span className="pb-2 text-xs text-danger">تاريخ البداية يجب أن يسبق النهاية</span>}
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="عدد العروض" value={<span className="num">{rows.length}</span>} />
        <Stat label="قيمة العروض" value={<span className="num text-xl">{money(totals.total)}</span>} hint="ر.س" />
        <Stat label="المقبولة" tone="green" value={<span className="num">{totals.acceptedCount}</span>} hint={<span className="num">{money(totals.acceptedValue)} ر.س</span>} />
        <Stat label="متوسط الخصم" tone="gold" value={<span className="num">{totals.discountPct != null ? `${totals.discountPct.toFixed(1)}%` : '—'}</span>} hint={hasMargin && totals.marginPct != null ? <span className="num">الهامش {totals.marginPct.toFixed(1)}%</span> : undefined} />
      </div>

      <Card padded={false} title={<span className="inline-flex items-center gap-2"><FileText className="size-4" />سجل عروض الأسعار</span>} actions={<Button size="sm" variant="outline" icon={<Download className="size-3.5" />} disabled={!rows.length} onClick={exportCsv}>تصدير CSV</Button>}>
        <ErrorBox error={register.error} />
        {register.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<FileText className="size-8" />} title="لا توجد عروض في هذه الفترة" /> : (
          <Table>
            <thead>
              <tr>
                <Th>الرقم</Th><Th>التاريخ</Th><Th>الحالة</Th><Th>العميل</Th><Th>المسؤول</Th>
                <Th className="text-end">قبل الخصم</Th><Th className="text-end">الخصم</Th><Th className="text-end">%</Th><Th className="text-end">الإجمالي</Th>
                {hasMargin && <><Th className="text-end">التكلفة</Th><Th className="text-end">الهامش</Th><Th className="text-end">هامش %</Th></>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-tint/50">
                  <Td className="whitespace-nowrap"><Link href={`/quotes/${r.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{r.number}</Link> <span className="text-[11px] text-muted">R{r.revision}</span></Td>
                  <Td className="num whitespace-nowrap text-xs">{date(r.quote_date)}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td className="max-w-[14rem] truncate">{r.client ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-xs">{r.owner ?? '—'}</Td>
                  <Td className="text-end"><Money value={r.subtotal} /></Td>
                  <Td className="text-end"><Money value={r.discount_amount} /></Td>
                  <Td className="num text-end text-xs">{r.discount_percent != null ? Number(r.discount_percent).toFixed(1) : '—'}</Td>
                  <Td className="text-end font-bold"><Money value={r.total} /></Td>
                  {hasMargin && <>
                    <Td className="text-end">{r.cost_total && h(r.cost_total) > 0 ? <Money value={r.cost_total} /> : '—'}</Td>
                    <Td className="text-end">{r.cost_total && h(r.cost_total) > 0 ? <Money value={r.margin_total} /> : '—'}</Td>
                    <Td className={clsx('num text-end text-xs', r.margin_percent != null && Number(r.margin_percent) < 0 && 'text-danger')}>{r.margin_percent != null ? Number(r.margin_percent).toFixed(1) : '—'}</Td>
                  </>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-tint/60 font-extrabold">
                <Td colSpan={5}>الإجمالي ({rows.length} عرض)</Td>
                <Td className="text-end"><Money value={totals.subtotal} /></Td>
                <Td className="text-end"><Money value={totals.discount} /></Td>
                <Td className="num text-end text-xs">{totals.discountPct != null ? totals.discountPct.toFixed(1) : '—'}</Td>
                <Td className="text-end"><Money value={totals.total} /></Td>
                {hasMargin && <>
                  <Td className="text-end"><Money value={totals.cost} /></Td>
                  <Td className="text-end"><Money value={totals.margin} /></Td>
                  <Td className="num text-end text-xs">{totals.marginPct != null ? totals.marginPct.toFixed(1) : '—'}</Td>
                </>}
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      <Card className="mt-4" title={<span className="inline-flex items-center gap-2"><BarChart3 className="size-4" />أسباب خسارة الفرص</span>}>
        <ErrorBox error={lost.error} />
        {lost.isLoading ? <Spinner /> : lostRows.length === 0 ? <p className="text-sm text-muted">لا توجد فرص خاسرة في هذه الفترة.</p> : (
          <ul className="space-y-2.5">
            {lostRows.map((r) => (
              <li key={r.reason}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-bold">{REASON_AR[r.reason] ?? r.reason}</span>
                  <span className="num text-xs text-muted"><b className="text-ink">{r.count}</b> ({Math.round((r.count / lostTotal) * 100)}%) · {money(r.amount)} ر.س</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-gold" style={{ width: `${(r.count / lostMax) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
