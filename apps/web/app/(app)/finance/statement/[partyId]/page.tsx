'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, today } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Money, PageHeader, Spinner, Table, Td, Th, clsx } from '@/components/ui';

interface Statement {
  party: { id: string; nameAr: string; vatNumber: string | null };
  entries: { date: string; kind: 'invoice' | 'credit_note' | 'payment'; number: string; debit: number; credit: number; balance: number }[];
  balance: number;
}

const KIND: Record<string, string> = { invoice: 'فاتورة', credit_note: 'إشعار دائن', payment: 'دفعة مستلمة' };

/** Hide the staff shell when printing — only the statement sheet is printed. */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #statement-sheet, #statement-sheet * { visibility: visible !important; }
  #statement-sheet { position: absolute; inset: 0 0 auto 0; width: 100%; }
  @page { size: A4; margin: 14mm; }
}`;

export default function StatementPage({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = use(params);
  const { me } = useMe();
  const q = useQuery({ queryKey: ['statement', partyId], queryFn: () => api.get<Statement>(`/finance/statement/${partyId}`) });
  const d = q.data;
  const totals = d?.entries.reduce((t, e) => ({ debit: t.debit + e.debit, credit: t.credit + e.credit }), { debit: 0, credit: 0 });

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader back="/finance/aging" title="كشف حساب عميل" subtitle={d?.party.nameAr} actions={d && <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => window.print()}>طباعة</Button>} />
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : d && (
        <div id="statement-sheet">
          <Card className="print:border-0 print:shadow-none">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
              <div>
                <div className="hidden text-lg font-extrabold text-primary print:block">{me?.company?.legalNameAr ?? 'المدى المبارك'}</div>
                <div className="text-base font-extrabold">كشف حساب: {d.party.nameAr}</div>
                {d.party.vatNumber && <div className="text-xs text-muted">الرقم الضريبي: <span className="num">{d.party.vatNumber}</span></div>}
              </div>
              <div className="text-end text-xs text-muted">
                <div>تاريخ الكشف: <span className="num">{today()}</span></div>
                <div className="mt-1 text-sm">الرصيد الختامي: <b className={clsx(d.balance > 0 ? 'text-gold-dark' : 'text-ok')}><Money value={d.balance} fixed /></b></div>
              </div>
            </div>
            {!d.entries.length ? <Empty icon={<ScrollText className="size-8" />} title="لا توجد حركات على هذا العميل" /> : (
              <Table className="print:overflow-visible">
                <thead><tr><Th>التاريخ</Th><Th>البيان</Th><Th>الرقم</Th><Th className="text-end">مدين</Th><Th className="text-end">دائن</Th><Th className="text-end">الرصيد</Th></tr></thead>
                <tbody>
                  {d.entries.map((e, i) => (
                    <tr key={`${e.number}-${i}`} className="print:break-inside-avoid">
                      <Td className="num text-xs">{date(e.date)}</Td>
                      <Td>{KIND[e.kind] ?? e.kind}</Td>
                      <Td className="num text-xs">{e.number}</Td>
                      <Td className="text-end">{e.debit ? <Money value={e.debit} fixed /> : <span className="text-muted">—</span>}</Td>
                      <Td className="text-end">{e.credit ? <Money value={e.credit} fixed className="text-ok" /> : <span className="text-muted">—</span>}</Td>
                      <Td className="text-end font-bold"><Money value={e.balance} fixed /></Td>
                    </tr>
                  ))}
                  <tr className="bg-tint/60 font-extrabold">
                    <Td colSpan={3}>الإجمالي / الرصيد الختامي</Td>
                    <Td className="text-end"><Money value={totals!.debit} fixed /></Td>
                    <Td className="text-end"><Money value={totals!.credit} fixed /></Td>
                    <Td className="text-end text-primary"><Money value={d.balance} fixed /></Td>
                  </tr>
                </tbody>
              </Table>
            )}
            <p className="mt-4 text-[11px] text-muted">الفواتير تظهر بصافي المستحق بعد خصم الدفعات المقدمة. الرصيد الموجب مستحق على العميل.</p>
          </Card>
        </div>
      )}
    </>
  );
}
