'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, FileDown, FileSpreadsheet, Link2, Trash2, Unlink, Wand2 } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, PageHeader, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { ConfirmDialog, errMsg } from '../../../quotes/_components/common';
import { RequirePerm } from '../../../settings/_components/common';
import { Amt } from '../../_components/ledger-kit';

interface Line { id: string; lineNo: number; date: string; description: string | null; ref: string | null; debit: string; credit: string; matched: boolean; matchedBy: string | null; entryId: string | null; entryNumber: string | null }
interface Book { id: string; entryId: string; number: string; date: string; memo: string | null; party: string | null; debit: string; credit: string }
interface Detail {
  id: string; account: { id: string; code: string; nameAr: string }; reference: string | null; dateFrom: string; dateTo: string; openingBalance: string; closingBalance: string; status: 'open' | 'reconciled';
  lines: Line[]; unmatchedBook: Book[];
  summary: { bookBalance: string; bankBalance: string; depositsInTransit: string; outstanding: string; unmatchedBank: string; unmatchedBook: string; difference: string; footing: string; matched: number; total: number; reconciled: boolean };
}

export default function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  return <RequirePerm perm="ledger.read" title={bi('التسوية البنكية', 'Bank reconciliation')}><Screen id={id} /></RequirePerm>;
}

function Screen({ id }: { id: string }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bank-statement', id], queryFn: () => api.get<Detail>(`/accounting/bank-statements/${id}`) });
  const [pick, setPick] = useState<Line | null>(null);
  const [del, setDel] = useState(false);
  const set = (d: Detail) => { qc.setQueryData(['bank-statement', id], d); void qc.invalidateQueries({ queryKey: ['bank-statements'] }); };
  const act = <T,>(path: string, ok?: string) => api.post<T>(`/accounting/bank-statements/${id}${path}`, {}).then((r) => { if (ok) toast.success(ok); return r; });
  const auto = useMutation({ mutationFn: () => act<Detail & { matched: number }>('/auto-match'), onSuccess: (r) => { set(r); toast.success(bi(`طُوبق ${r.matched} حركة`, `${r.matched} matched`)); }, onError: (e) => toast.error(errMsg(e)) });
  const reconcile = useMutation({ mutationFn: () => act<Detail>('/reconcile', bi('سُوّي الكشف', 'Reconciled')), onSuccess: set, onError: (e) => toast.error(errMsg(e)) });
  const unmatch = useMutation({ mutationFn: (lineId: string) => act<Detail>(`/lines/${lineId}/unmatch`), onSuccess: set, onError: (e) => toast.error(errMsg(e)) });
  const match = useMutation({
    mutationFn: (v: { lineId: string; journalLineId: string }) => api.post<Detail>(`/accounting/bank-statements/${id}/lines/${v.lineId}/match`, { journalLineId: v.journalLineId }),
    onSuccess: (r) => { set(r); setPick(null); }, onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/accounting/bank-statements/${id}`),
    onSuccess: () => { toast.success(bi('حُذف الكشف', 'Statement deleted')); void qc.invalidateQueries({ queryKey: ['bank-statements'] }); router.push('/accounting/bank'); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return <ErrorBox error={q.error} />;
  const s = d.summary;
  const open = d.status === 'open';
  const candidates = pick ? d.unmatchedBook.filter((b) => (Number(pick.debit) > 0 ? Number(b.debit) === Number(pick.debit) : Number(b.credit) === Number(pick.credit))) : [];
  return (
    <>
      <PageHeader back="/accounting/bank" title={`${d.account.code} ${d.account.nameAr}${d.reference ? ` — ${d.reference}` : ''}`}
        subtitle={<span className="num" dir="ltr">{date(d.dateFrom)} → {date(d.dateTo)}</span>}
        actions={<>
          <Button variant="outline" icon={<FileDown className="size-4" />} onClick={() => openFile(`/accounting/bank-statements/${id}?format=pdf`)}>PDF</Button>
          <Button variant="outline" icon={<FileSpreadsheet className="size-4" />} onClick={() => openFile(`/accounting/bank-statements/${id}?format=xlsx`)}>Excel</Button>
          {open && can('ledger.write') && <Button variant="outline" icon={<Wand2 className="size-4" />} loading={auto.isPending} onClick={() => auto.mutate()}>{bi('مطابقة تلقائية', 'Auto-match')}</Button>}
          {open && can('ledger.post') && <Button icon={<CheckCircle2 className="size-4" />} loading={reconcile.isPending} disabled={!s.reconciled} onClick={() => reconcile.mutate()}>{bi('اعتماد التسوية', 'Reconcile')}</Button>}
        </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={bi('رصيد الكشف', 'Bank balance')} value={<Amt v={s.bankBalance} strong />} />
        <Stat label={bi('رصيد الدفتر', 'Ledger balance')} value={<Amt v={s.bookBalance} strong />} />
        <Stat label={bi('بنود دفترية معلقة', 'Open ledger items')} value={<Amt v={s.unmatchedBook} />} hint={`${bi('إيداعات في الطريق', 'Deposits in transit')} ${s.depositsInTransit} · ${bi('مدفوعات معلقة', 'Outstanding')} ${s.outstanding}`} />
        <Stat label={bi('الفرق', 'Difference')} value={<Amt v={s.difference} strong />} tone={s.reconciled ? 'green' : 'red'} hint={Number(s.footing) !== 0 ? bi(`الكشف لا يتزن: ${s.footing}`, `Statement does not foot: ${s.footing}`) : `${s.matched}/${s.total} ${bi('مطابقة', 'matched')}`} />
      </div>
      <ErrorBox error={q.error} />
      <Card padded={false} title={bi('حركات الكشف', 'Statement lines')} actions={open && can('ledger.write') ? <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDel(true)}>{bi('حذف الكشف', 'Delete')}</Button> : undefined}>
        <Table>
          <thead><tr><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('البيان', 'Description')}</Th><Th>{bi('المرجع', 'Ref')}</Th><Th className="text-end">{bi('إيداع', 'In')}</Th><Th className="text-end">{bi('سحب', 'Out')}</Th><Th>{bi('القيد المطابق', 'Matched entry')}</Th><Th /></tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="hover:bg-tint/50">
                <Td className="num text-xs">{date(l.date)}</Td><Td className="max-w-[18rem] truncate text-xs">{l.description}</Td><Td className="num text-xs"><span dir="ltr">{l.ref}</span></Td>
                <Td className="text-end"><Amt v={l.debit} /></Td><Td className="text-end"><Amt v={l.credit} /></Td>
                <Td>{l.matched && l.entryId ? <><Link href={`/accounting/journal/${l.entryId}`} className="num font-bold text-primary hover:underline" dir="ltr">{l.entryNumber}</Link> <Badge tone="gray">{l.matchedBy === 'auto' ? bi('تلقائي', 'auto') : bi('يدوي', 'manual')}</Badge></> : <Badge tone="red">{bi('غير مطابق', 'Unmatched')}</Badge>}</Td>
                <Td className="text-end whitespace-nowrap">{open && can('ledger.write') && (l.matched
                  ? <Button size="sm" variant="ghost" icon={<Unlink className="size-4" />} onClick={() => unmatch.mutate(l.id)}>{bi('فك', 'Unmatch')}</Button>
                  : <Button size="sm" variant="outline" icon={<Link2 className="size-4" />} onClick={() => setPick(l)}>{bi('مطابقة', 'Match')}</Button>)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card padded={false} className="mt-4" title={`${bi('بنود الدفتر غير المطابقة', 'Unmatched ledger items')} (${d.unmatchedBook.length})`}>
        <Table>
          <thead><tr><Th>{bi('القيد', 'Entry')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('البيان', 'Description')}</Th><Th>{bi('العميل / المورد', 'Party')}</Th><Th className="text-end">{bi('مدين (إيداع)', 'Debit (in)')}</Th><Th className="text-end">{bi('دائن (سحب)', 'Credit (out)')}</Th></tr></thead>
          <tbody>
            {d.unmatchedBook.map((b) => (
              <tr key={b.id} className="hover:bg-tint/50"><Td><Link href={`/accounting/journal/${b.entryId}`} className="num font-bold text-primary hover:underline" dir="ltr">{b.number}</Link></Td><Td className="num text-xs">{date(b.date)}</Td><Td className="max-w-[20rem] truncate text-xs">{b.memo}</Td><Td className="text-xs">{b.party}</Td><Td className="text-end"><Amt v={b.debit} /></Td><Td className="text-end"><Amt v={b.credit} /></Td></tr>
            ))}
            {!d.unmatchedBook.length && <tr><Td colSpan={6} className="py-6 text-center text-muted">{bi('كل بنود الدفتر مطابقة.', 'Everything in the ledger is matched.')}</Td></tr>}
          </tbody>
        </Table>
      </Card>

      <Dialog open={!!pick} onClose={() => setPick(null)} wide title={bi('مطابقة حركة الكشف مع بند من الدفتر', 'Match to a ledger item')} footer={<Button variant="outline" onClick={() => setPick(null)}>{bi('إغلاق', 'Close')}</Button>}>
        {pick && (
          <div className="grid gap-3 text-sm">
            <p>{date(pick.date)} — {pick.description} — <Badge tone="gray">{Number(pick.debit) > 0 ? bi('إيداع', 'In') : bi('سحب', 'Out')}</Badge> <Amt v={Number(pick.debit) > 0 ? pick.debit : pick.credit} strong /></p>
            {!candidates.length ? <p className="text-muted">{bi('لا يوجد بند دفتري بنفس المبلغ والاتجاه. سجّل القيد الناقص (رسوم بنكية، تحويل…) ثم ارجع.', 'No ledger item with the same amount and direction. Post the missing entry (bank charges, transfer…) and come back.')}</p> : (
              <Table>
                <thead><tr><Th>{bi('القيد', 'Entry')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('البيان', 'Description')}</Th><Th /></tr></thead>
                <tbody>{candidates.map((b) => <tr key={b.id}><Td className="num text-xs"><span dir="ltr">{b.number}</span></Td><Td className="num text-xs">{date(b.date)}</Td><Td className="text-xs">{b.memo}</Td><Td className="text-end"><Button size="sm" loading={match.isPending} onClick={() => match.mutate({ lineId: pick.id, journalLineId: b.id })}>{bi('مطابقة', 'Match')}</Button></Td></tr>)}</tbody>
              </Table>
            )}
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={del} danger loading={remove.isPending} title={bi('حذف الكشف', 'Delete the statement')} message={bi('تُحذف حركات الكشف ومطابقاتها (لا تتأثر القيود).', 'Statement lines and matches are removed (ledger entries are untouched).')}
        confirmLabel={bi('حذف', 'Delete')} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} />
    </>
  );
}
