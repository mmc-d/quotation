'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileStack, Minus, Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Card, Empty, ErrorBox, Input, LinkButton, Money, PageHeader, SearchBox, Select, Spinner, Stat, StatusBadge, Table, Tabs, Td, Th } from '@/components/ui';
import { KIND_LABEL, METHODS, type VoucherKind } from './_components/voucher-kit';

interface Row { id: string; kind: VoucherKind; number: string; voucherDate: string; counterpartyName: string; amount: string; purpose: string; method: string; status: string; approvedByName: string | null; projectNumber: string | null }
interface ListResult { rows: Row[]; total: number; summary: { paid: string; received: string; pending: number } }

export default function VouchersPage() {
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const [kind, setKind] = useState<'' | VoucherKind>('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useQuery({
    queryKey: ['vouchers', kind, status, q, from, to],
    queryFn: () => api.get<ListResult>(`/vouchers${qs({ kind: kind || undefined, status: status || undefined, q: q || undefined, from: from || undefined, to: to || undefined, limit: 200 })}`),
  });
  const s = list.data?.summary;
  const methodLabel = (m: string) => { const x = METHODS.find((y) => y.value === m); return x ? (locale === 'en' ? x.en : x.ar) : m; };

  return (
    <>
      <PageHeader
        title={bi('سندات القبض والصرف', 'Receipt & payment vouchers')}
        subtitle={bi('يُدخل المحاسب السند كمسودة، ثم يعتمده ويختمه مسؤول آخر.', 'Finance enters a draft; a second person approves and stamps it.')}
        actions={can('voucher.write') && <>
          <LinkButton href="/finance/vouchers/new?kind=receipt" icon={<Plus className="size-4" />}>{bi('سند قبض', 'Receipt voucher')}</LinkButton>
          <LinkButton href="/finance/vouchers/new?kind=payment" variant="primary" icon={<Minus className="size-4" />}>{bi('سند صرف', 'Payment voucher')}</LinkButton>
        </>}
      />
      {s && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label={bi('المقبوض المعتمد', 'Approved receipts')} value={<Money value={s.received} />} tone="green" />
          <Stat label={bi('المصروف المعتمد', 'Approved payments')} value={<Money value={s.paid} />} tone="red" />
          <Stat label={bi('بانتظار الاعتماد والختم', 'Awaiting approval & stamp')} value={s.pending} tone={s.pending ? 'gold' : undefined} hint={s.pending && can('voucher.approve') ? <button className="font-bold text-gold-dark hover:underline" onClick={() => setStatus('draft')}>{bi('عرضها', 'Show them')}</button> : undefined} />
        </div>
      )}
      <Card padded={false}>
        <div className="border-b border-line px-3 pt-2">
          <Tabs value={kind || 'all'} onChange={(v) => setKind(v === 'all' ? '' : v)} items={[
            { value: 'all', label: bi('الكل', 'All') },
            { value: 'receipt', label: bi('سندات القبض', 'Receipts') },
            { value: 'payment', label: bi('سندات الصرف', 'Payments') },
          ]} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم السند، الاسم، البيان، المرجع…', 'Number, name, purpose, reference…')} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[12rem]">
            <option value="">{bi('كل الحالات', 'All statuses')}</option>
            <option value="draft">{bi('مسودة (بانتظار الاعتماد)', 'Draft (awaiting approval)')}</option>
            <option value="approved">{bi('معتمد', 'Approved')}</option>
            <option value="cancelled">{bi('ملغى', 'Cancelled')}</option>
          </Select>
          <label className="flex items-center gap-1 text-xs text-muted">{bi('من', 'From')}<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" /></label>
          <label className="flex items-center gap-1 text-xs text-muted">{bi('إلى', 'To')}<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" /></label>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<FileStack className="size-8" />} title={bi('لا توجد سندات', 'No vouchers')} hint={can('voucher.write') ? bi('أنشئ سند قبض أو صرف من الأزرار أعلاه.', 'Create a receipt or payment voucher with the buttons above.') : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th>{bi('البيان', 'Purpose')}</Th><Th>{bi('الطريقة', 'Method')}</Th><Th className="text-end">{bi('المبلغ', 'Amount')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
            <tbody>
              {list.data.rows.map((r) => (
                <tr key={r.id} className="hover:bg-tint/50">
                  <Td><Link href={`/finance/vouchers/${r.id}`} className="num font-bold text-primary hover:underline" dir="ltr">{r.number}</Link></Td>
                  <Td><Badge tone={r.kind === 'receipt' ? 'green' : 'red'}>{locale === 'en' ? KIND_LABEL[r.kind][1] : KIND_LABEL[r.kind][0]}</Badge></Td>
                  <Td className="num text-xs">{date(r.voucherDate)}</Td>
                  <Td className="font-bold">{r.counterpartyName}</Td>
                  <Td className="max-w-[18rem] truncate text-xs text-muted" >{r.purpose}{r.projectNumber && <span className="num ms-1 text-gold-dark" dir="ltr">· {r.projectNumber}</span>}</Td>
                  <Td className="text-xs">{methodLabel(r.method)}</Td>
                  <Td className="text-end"><Money value={r.amount} fixed className={r.status === 'cancelled' ? 'text-muted line-through' : r.kind === 'receipt' ? 'text-ok' : 'text-danger'} /></Td>
                  <Td>{r.status === 'draft' ? <Badge tone="gold">{bi('بانتظار الاعتماد', 'Awaiting approval')}</Badge> : <StatusBadge status={r.status} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
