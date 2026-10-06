'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Hourglass } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { h, money } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Money, PageHeader, Spinner, Stat, Table, Td, Th, clsx } from '@/components/ui';
import { SourceNote, type Bucket, type FinanceInsights } from '../_components/insights';

const BUCKETS: { key: Bucket; ar: string; en: string }[] = [
  { key: 'current', ar: 'غير مستحق', en: 'Not due' },
  { key: '1_30', ar: '1–30 يومًا', en: '1–30 days' },
  { key: '31_60', ar: '31–60 يومًا', en: '31–60 days' },
  { key: '61_90', ar: '61–90 يومًا', en: '61–90 days' },
  { key: '90_plus', ar: 'أكثر من 90', en: '90+ days' },
];

export default function FinanceDashboardPage() {
  const { can, me } = useMe();
  const { bi, locale } = useI18n();
  const [months, setMonths] = useState(12);
  const q = useQuery({ queryKey: ['insights-finance', months], queryFn: () => api.get<FinanceInsights>(`/insights/finance?months=${months}`), enabled: can('report.finance') });

  if (me && !can('report.finance')) {
    return <><PageHeader title={bi('التقارير المالية', 'Finance dashboard')} /><Card><Empty title={bi('لا تملك صلاحية التقارير المالية', 'You do not have permission for finance reports')} /></Card></>;
  }
  const d = q.data;
  const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ar-u-ca-gregory-nu-latn', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const max = Math.max(1, ...(d?.months ?? []).flatMap((m) => [h(m.collected), h(m.invoicedNet)]));
  const arTotal = h(d?.ar.outstanding);

  return (
    <>
      <PageHeader
        title={bi('التقارير المالية', 'Finance dashboard')}
        subtitle={bi('التحصيل والفوترة والذمم والالتزامات', 'Collections, invoicing, receivables and commitments')}
        actions={<div className="flex gap-1">{[6, 12, 24].map((n) => <Button key={n} size="sm" variant={months === n ? 'primary' : 'ghost'} onClick={() => setMonths(n)}>{bi(`${n} شهرًا`, `${n} months`)}</Button>)}</div>}
      />
      <SourceNote className="mb-4" />
      <ErrorBox error={q.error} />
      {q.isLoading || !d ? <Spinner /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={bi('المحصَّل في الفترة', 'Collected in period')} tone="green" value={<span className="num text-xl">{money(d.totals.collected)}</span>} hint={bi('ر.س شامل الضريبة', 'SAR incl. VAT')} />
            <Stat label={bi('المفوتر (صافي) في الفترة', 'Invoiced (net) in period')} value={<span className="num text-xl">{money(d.totals.invoicedNet)}</span>} hint={bi('ر.س بدون الضريبة', 'SAR excl. VAT')} />
            <Stat label={bi('الذمم المدينة القائمة', 'AR outstanding')} tone={arTotal > 0 ? 'gold' : undefined} value={<span className="num text-xl">{money(d.ar.outstanding)}</span>} hint={bi(`${d.ar.invoices} فاتورة`, `${d.ar.invoices} invoices`)} />
            <Stat label={bi('متوسط أيام التحصيل (DSO)', 'Days sales outstanding (DSO)')} value={<span className="num">{d.dso.days ?? '—'}</span>} hint={bi('الذمم ÷ مبيعات آخر 90 يومًا × 90', 'AR ÷ last-90-day sales × 90')} />
            <Stat label={bi('طلبات دفع مفتوحة', 'Open payment requests')} value={<span className="num">{d.paymentRequests.open}</span>} hint={<span className="num">{money(d.paymentRequests.outstanding)} {bi('ر.س', 'SAR')}</span>} />
            <Stat label={bi('طلبات دفع متأخرة', 'Overdue payment requests')} tone={d.paymentRequests.overdueCount ? 'red' : undefined} value={<span className="num">{d.paymentRequests.overdueCount}</span>} hint={<span className="num">{money(d.paymentRequests.overdue)} {bi('ر.س', 'SAR')}</span>} />
            {d.costVisible && d.ap && <Stat label={bi('فواتير موردين معتمدة غير مدفوعة', 'Approved supplier bills unpaid')} value={<span className="num text-xl">{money(d.ap.open)}</span>} hint={bi(`${d.ap.bills} فاتورة — ر.س`, `${d.ap.bills} bills — SAR`)} />}
            {d.costVisible && d.commitments && <Stat label={bi('التزامات شراء لم تُستلم', 'Purchase commitments not received')} value={<span className="num text-xl">{money(d.commitments.open)}</span>} hint={bi(`${d.commitments.orders} أمر شراء — ر.س`, `${d.commitments.orders} POs — SAR`)} />}
            {d.costVisible && d.stock && <Stat label={bi('قيمة المخزون (متوسط التكلفة)', 'Stock value (average cost)')} value={<span className="num text-xl">{money(d.stock.value)}</span>} hint={d.stock.withoutCost ? bi(`${d.stock.withoutCost} صنف بلا تكلفة`, `${d.stock.withoutCost} items without cost`) : bi(`${d.stock.products} صنف`, `${d.stock.products} items`)} />}
          </div>

          <Card className="mb-4" title={<span className="inline-flex items-center gap-2"><BarChart3 className="size-4" />{bi('التحصيل والفوترة شهريًا', 'Collections and invoicing by month')}</span>}
            actions={<div className="flex items-center gap-3 text-xs"><span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-primary" />{bi('المحصَّل', 'Collected')}</span><span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-gold" />{bi('المفوتر صافي', 'Invoiced net')}</span></div>}>
            <div className="overflow-x-auto">
              <div className="flex min-w-[36rem] items-end gap-2" role="img" aria-label={bi('رسم أعمدة شهري', 'Monthly bar chart')}>
                {d.months.map((m) => (
                  <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-44 w-full items-end justify-center gap-0.5">
                      <div className="w-1/3 max-w-5 rounded-t bg-primary" style={{ height: `${(h(m.collected) / max) * 100}%` }} title={`${bi('المحصَّل', 'Collected')}: ${money(m.collected)}`} />
                      <div className={clsx('w-1/3 max-w-5 rounded-t', h(m.invoicedNet) < 0 ? 'bg-danger' : 'bg-gold')} style={{ height: `${(Math.abs(h(m.invoicedNet)) / max) * 100}%` }} title={`${bi('المفوتر صافي', 'Invoiced net')}: ${money(m.invoicedNet)}`} />
                    </div>
                    <div className="text-[10px] text-muted">{monthLabel(m.month)}</div>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-[11px] text-muted">{bi('المفوتر صافي = فواتير الدفعات المقدمة (386) + النهائية (388) بعد خصم الدفعات − الإشعارات الدائنة (381)، بدون الضريبة.', 'Invoiced net = advance invoices (386) + final invoices (388) after the advances they deduct − credit notes (381), excluding VAT.')}</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card padded={false} title={<span className="inline-flex items-center gap-2"><Hourglass className="size-4" />{bi('أعمار الذمم', 'Receivables aging')}</span>} actions={<Link href="/finance/aging" className="text-xs font-bold text-gold-dark hover:underline">{bi('حسب العميل', 'By customer')}</Link>}>
              <Table>
                <thead><tr><Th>{bi('الفترة', 'Bucket')}</Th><Th className="text-end">{bi('المبلغ', 'Amount')}</Th><Th className="w-2/5">{bi('النسبة', 'Share')}</Th></tr></thead>
                <tbody>
                  {BUCKETS.map((b) => {
                    const v = h(d.ar.buckets[b.key]);
                    const pct = arTotal > 0 ? (v / arTotal) * 100 : 0;
                    return (
                      <tr key={b.key}>
                        <Td>{locale === 'en' ? b.en : b.ar}</Td>
                        <Td className="text-end"><Money value={d.ar.buckets[b.key]} /></Td>
                        <Td><div className="h-2 w-full rounded-full bg-tint"><div className={clsx('h-2 rounded-full', b.key === 'current' ? 'bg-primary' : b.key === '90_plus' ? 'bg-danger' : 'bg-gold')} style={{ width: `${pct}%` }} /></div></Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr className="bg-tint/60 font-extrabold"><Td>{bi('الإجمالي', 'Total')}</Td><Td className="text-end"><Money value={d.ar.outstanding} /></Td><Td /></tr></tfoot>
              </Table>
            </Card>
            <Card padded={false} title={bi('أكبر الأرصدة المستحقة', 'Largest balances')}>
              {d.ar.topDebtors.length === 0 ? <Empty title={bi('لا توجد ذمم قائمة', 'No outstanding receivables')} /> : (
                <Table>
                  <thead><tr><Th>{bi('العميل', 'Customer')}</Th><Th className="text-end">{bi('الرصيد', 'Balance')}</Th></tr></thead>
                  <tbody>
                    {d.ar.topDebtors.map((t) => (
                      <tr key={t.partyId ?? 'none'}>
                        <Td>{t.partyId ? <Link href={`/customers/${t.partyId}`} className="font-bold text-primary hover:underline">{t.name}</Link> : t.name}</Td>
                        <Td className="text-end"><Money value={t.outstanding} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
          {!d.costVisible && <p className="mt-4 text-xs text-muted">{bi('أرقام الموردين والمخزون تحتاج صلاحية عرض تكاليف الشراء.', 'Supplier and stock figures need the purchase-cost permission.')}</p>}
        </>
      )}
    </>
  );
}
