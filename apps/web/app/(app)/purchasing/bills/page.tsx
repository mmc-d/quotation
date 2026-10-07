'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, ReceiptText } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Card, clsx, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, Stat, Table, Td, Th, Button } from '@/components/ui';
import { AGING_BUCKETS, Amount, BILL_STATUS, Chip, MATCH_STATUS, chipCls } from '../_components/common';
import type { BillRow, PayablesAging } from '../_components/types';

const PAGE = 50;
type View = 'all' | 'unpaid' | 'overdue' | 'paid' | 'exception' | 'direct';

function BillsList() {
  const sp = useSearchParams();
  const router = useRouter();
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const canCost = can('purchase.cost.read');
  const [q, setQ] = useState(sp.get('q') ?? '');
  const term = useDeferredValue(q.trim());
  const [view, setView] = useState<View>(sp.get('view') === 'payables' ? 'unpaid' : ((sp.get('view') as View) || 'all'));
  const [limit, setLimit] = useState(PAGE);
  const supplierId = sp.get('supplierId');
  const filters = {
    q: term, limit, supplierId,
    unpaid: view === 'unpaid' || undefined, overdue: view === 'overdue' || undefined,
    status: view === 'paid' ? 'paid' : undefined, matchStatus: view === 'exception' ? 'exception' : undefined, kind: view === 'direct' ? 'direct' : undefined,
  };
  const list = useQuery({
    queryKey: ['bills', filters],
    queryFn: () => api.get<{ rows: BillRow[]; total: number }>(`/inventory/bills${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const aging = useQuery({ queryKey: ['bills-aging'], queryFn: () => api.get<PayablesAging>('/inventory/bills/aging'), enabled: canCost });
  const rows = list.data?.rows ?? [];
  const views: [View, string, string][] = [
    ['all', 'الكل', 'All'], ['unpaid', 'غير مدفوعة', 'Unpaid'], ['overdue', 'متأخرة', 'Overdue'], ['paid', 'مدفوعة', 'Paid'],
    ['exception', 'استثناء مطابقة', 'Match exception'], ['direct', 'بدون أمر شراء', 'Without PO'],
  ];

  const exportCsv = async () => {
    const all = await api.get<{ rows: BillRow[] }>(`/inventory/bills${qs({ ...filters, limit: 200, offset: 0 })}`);
    const head = ['number', 'supplier_invoice', 'supplier', 'po', 'bill_date', 'due_date', 'currency', 'subtotal', 'vat', 'total', 'paid', 'status'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head.join(','), ...all.rows.map((r) => [r.number, r.supplierInvoiceNo, r.supplierName, r.orderNumber ?? '', r.billDate, r.dueDate ?? '', r.currency, r.subtotal ?? '', r.vat ?? '', r.total ?? '', r.paidAmount ?? '', r.status].map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `supplier-bills-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title={bi('فواتير المشتريات', 'Supplier bills')}
        subtitle={bi('فواتير الموردين مع أوامر الشراء أو بدونها، والمدفوع والمتبقي لكل مورد', 'Supplier invoices with or without a PO, what is paid and what is owed')}
        actions={<>
          <Button variant="outline" icon={<Download className="size-4" />} onClick={exportCsv}>{bi('تصدير CSV', 'Export CSV')}</Button>
          {can('purchase.write') && <LinkButton variant="primary" href="/purchasing/bills/new" icon={<Plus className="size-4" />}>{bi('فاتورة مشتريات جديدة', 'New supplier bill')}</LinkButton>}
        </>}
      />

      {canCost && aging.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={bi('إجمالي المستحق للموردين', 'Total owed to suppliers')} value={<Money value={aging.data.totals.total} />} hint={bi(`${aging.data.totals.bills} فاتورة`, `${aging.data.totals.bills} bills`)} />
          <Stat label={bi('متأخر عن موعده', 'Overdue')} value={<Money value={aging.data.totals.overdue} />} tone={Number(aging.data.totals.overdue) > 0 ? 'red' : undefined} />
          <Stat label={bi('يستحق خلال 7 أيام', 'Due in the next 7 days')} value={<Money value={aging.data.totals.dueThisWeek} />} tone="gold" />
          <Stat label={bi('لم يحن موعده', 'Not yet due')} value={<Money value={aging.data.totals.current} />} tone="green" />
        </div>
      )}

      {canCost && aging.data && aging.data.suppliers.length > 0 && (view === 'unpaid' || view === 'overdue') && (
        <Card title={bi('أعمار الذمم الدائنة حسب المورد', 'Payables aging by supplier')} padded={false} className="mb-4">
          <Table>
            <thead><tr>
              <Th>{bi('المورد', 'Supplier')}</Th>
              {AGING_BUCKETS.map(([k, ar, en]) => <Th key={k} className="text-end">{locale === 'en' ? en : ar}</Th>)}
              <Th className="text-end">{bi('الإجمالي', 'Total')}</Th>
            </tr></thead>
            <tbody>
              {aging.data.suppliers.map((s) => (
                <tr key={s.supplierId} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/purchasing/bills${qs({ supplierId: s.supplierId, view: 'unpaid' })}`)}>
                  <Td className="font-bold">{locale === 'en' ? s.supplierNameEn || s.supplierName : s.supplierName} <span className="text-xs font-normal text-muted">({s.bills})</span></Td>
                  {AGING_BUCKETS.map(([k]) => <Td key={k} className={clsx('text-end', k !== 'current' && Number(s[k]) > 0 && 'text-danger')}>{Number(s[k]) ? <Money value={s[k]} /> : <span className="text-muted">—</span>}</Td>)}
                  <Td className="text-end font-extrabold"><Money value={s.total} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم الفاتورة أو رقم فاتورة المورد أو اسم المورد…', 'Bill no., supplier invoice no. or supplier…')} />
          <div className="flex flex-wrap items-center gap-1.5">
            {views.map(([v, ar, en]) => <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); setLimit(PAGE); }} className={chipCls(view === v)}>{locale === 'en' ? en : ar}</button>)}
            {supplierId && <Link href="/purchasing/bills" className="ms-2 text-xs font-bold text-primary hover:underline">{bi('إلغاء تصفية المورد', 'Clear supplier filter')}</Link>}
          </div>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<ReceiptText className="size-8" />} title={bi('لا توجد فواتير مطابقة', 'No matching bills')}
            hint={bi('سجّل فاتورة المورد من أمر الشراء، أو أدخلها مباشرة بدون أمر شراء.', 'Record a bill from its purchase order, or enter it directly without one.')}
            action={can('purchase.write') ? <LinkButton variant="primary" href="/purchasing/bills/new" icon={<Plus className="size-4" />}>{bi('فاتورة مشتريات جديدة', 'New supplier bill')}</LinkButton> : undefined} />
        ) : (
          <>
            <Table>
              <thead><tr>
                <Th>{bi('الرقم', 'Number')}</Th><Th>{bi('فاتورة المورد', 'Supplier invoice')}</Th><Th>{bi('المورد', 'Supplier')}</Th><Th>{bi('أمر الشراء', 'PO')}</Th>
                <Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('الاستحقاق', 'Due')}</Th><Th className="text-end">{bi('الإجمالي', 'Total')}</Th><Th className="text-end">{bi('المتبقي (ر.س)', 'Owed (SAR)')}</Th><Th>{bi('الحالة', 'Status')}</Th>
              </tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/purchasing/bills/${r.id}`)}>
                    <Td><Link href={`/purchasing/bills/${r.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{r.number}</Link></Td>
                    <Td><span dir="ltr" className="num text-xs">{r.supplierInvoiceNo}</span></Td>
                    <Td className="font-bold">{locale === 'en' ? r.supplierNameEn || r.supplierName : r.supplierName}</Td>
                    <Td>{r.orderNumber ? <span dir="ltr" className="num text-xs">{r.orderNumber}</span> : <Chip map={MATCH_STATUS} value="direct" />}</Td>
                    <Td><span className="num text-xs">{date(r.billDate)}</span></Td>
                    <Td><span className={clsx('num text-xs', r.overdue && 'font-bold text-danger')}>{date(r.dueDate)}</span></Td>
                    <Td className="text-end"><Amount value={r.total} currency={r.currency} /></Td>
                    <Td className="text-end">{r.owedSar === null || r.owedSar === undefined ? <span className="text-muted">—</span> : Number(r.owedSar) ? <Money value={r.owedSar} className={r.overdue ? 'font-bold text-danger' : undefined} /> : <span className="text-muted">—</span>}</Td>
                    <Td><div className="flex flex-wrap gap-1"><Chip map={BILL_STATUS} value={r.status} />{r.matchStatus === 'exception' && <Chip map={MATCH_STATUS} value="exception" />}</div></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.data && list.data.total > rows.length && (
              <div className="border-t border-line p-3 text-center"><Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>{bi('عرض المزيد', 'Show more')}</Button></div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

export default function BillsPage() {
  return <Suspense fallback={<Spinner />}><BillsList /></Suspense>;
}
