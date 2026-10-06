'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, ReceiptText, RefreshCw } from 'lucide-react';
import { api, openFile, qs } from '@/lib/api';
import { date, h } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Checkbox, Empty, ErrorBox, Money, PageHeader, SearchBox, Select, Spinner, StatusBadge, Table, Td, Th, clsx } from '@/components/ui';
import { BackofficeBanner, INVOICE_TYPES, InvoiceTypeBadge, type InvoiceRow } from '../_components/finance-kit';

export default function InvoicesPage() {
  const qc = useQueryClient();
  const { bi, locale } = useI18n();
  const [q, setQ] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [unpaid, setUnpaid] = useState(false);
  const list = useQuery({ queryKey: ['invoices', q, typeCode, unpaid], queryFn: () => api.get<InvoiceRow[]>(`/finance/invoices${qs({ q, typeCode, unpaid: unpaid || undefined, limit: 200 })}`) });
  const sync = useMutation({
    mutationFn: () => api.post<{ checked: number; updated: number; drift: string[] }>('/finance/sync'),
    onSuccess: (r) => {
      const msg = bi(`فُحصت ${r.checked} فاتورة · حُدّثت ${r.updated}`, `${r.checked} invoices checked · ${r.updated} updated`);
      if (r.drift.length) toast.warning(bi(`${msg} · ${r.drift.length} فروقات`, `${msg} · ${r.drift.length} differences`), { description: r.drift.slice(0, 6).join('\n'), duration: 12_000 });
      else toast.success(bi(`${msg} · لا توجد فروقات`, `${msg} · no differences`));
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = list.data ?? [];

  return (
    <>
      <PageHeader
        title={bi('الفواتير', 'Invoices')}
        subtitle={bi('نسخة من الفواتير الصادرة في النظام المحاسبي (ERPNext) — للقراءة فقط', 'Copy of the invoices issued in the accounting system (ERPNext) — read-only')}
        actions={<Button variant="outline" loading={sync.isPending} icon={<RefreshCw className="size-4" />} onClick={() => sync.mutate()}>{bi('مزامنة', 'Sync')}</Button>}
      />
      <BackofficeBanner />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم الفاتورة أو العميل…', 'Invoice number or customer…')} />
          <Select value={typeCode} onChange={(e) => setTypeCode(e.target.value)} className="max-w-[14rem]">
            <option value="">{bi('كل الأنواع', 'All types')}</option>
            {Object.entries(INVOICE_TYPES).map(([code, t]) => <option key={code} value={code}>{locale === 'en' ? t.labelEn : t.label} ({code})</option>)}
          </Select>
          <Checkbox label={bi('غير المسددة فقط', 'Unpaid only')} checked={unpaid} onChange={setUnpaid} />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !rows.length ? (
          <Empty icon={<ReceiptText className="size-8" />} title={bi('لا توجد فواتير', 'No invoices')} hint={bi('تُصدر الفواتير تلقائيًا عند تسجيل دفعات العقود.', 'Invoices are issued automatically when contract payments are recorded.')} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('العميل', 'Customer')}</Th><Th>{bi('العقد', 'Contract')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('الإجمالي', 'Total')}</Th><Th>{bi('الرصيد', 'Balance')}</Th><Th>{bi('زاتكا', 'ZATCA')}</Th><Th /></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={clsx('hover:bg-tint/50', i.status === 'cancelled' && 'opacity-50')}>
                  <Td className="num font-bold">{i.number}</Td>
                  <Td><InvoiceTypeBadge code={i.typeCode} /></Td>
                  <Td>{i.partyId ? <Link href={`/finance/statement/${i.partyId}`} className="hover:underline">{i.partyName ?? '—'}</Link> : (i.partyName ?? '—')}</Td>
                  <Td>{i.contractId ? <Link href={`/contracts/${i.contractId}`} className="num font-bold text-primary hover:underline">{i.contractNumber ?? bi('العقد', 'Contract')}</Link> : '—'}</Td>
                  <Td className="num text-xs">{date(i.issueDate)}</Td>
                  <Td className="font-bold"><Money value={i.total} fixed /></Td>
                  <Td><Money value={i.balanceDue} fixed className={h(i.balanceDue) > 0 ? 'font-bold text-gold-dark' : 'text-ok'} /></Td>
                  <Td><StatusBadge status={i.zatcaStatus} /></Td>
                  <Td><Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => openFile(`/finance/invoices/${i.id}/pdf`)}>PDF</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
