'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Send, Trash2, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, dateTime, today } from '@/lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, PageHeader, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { ConfirmDialog, errMsg } from '../../../quotes/_components/common';
import { RequirePerm } from '../../../settings/_components/common';
import { EntryStatus, KindBadge, Amt, Strip } from '../../_components/ledger-kit';
import { JournalEditor, type Entry } from '../../_components/journal-kit';

export default function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  return <RequirePerm perm="ledger.read" title="قيد يومية"><EntryView id={use(params).id} /></RequirePerm>;
}

const SOURCE_HREF: Record<string, (id: string) => string | null> = {};

function EntryView({ id }: { id: string }) {
  const { me, can } = useMe();
  const { bi } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['journal-entry', id], queryFn: () => api.get<Entry>(`/accounting/journal/${id}`) });
  const [editing, setEditing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [revDate, setRevDate] = useState(today());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const e = q.data;
  const apply = (n: Entry) => { qc.setQueryData(['journal-entry', id], n); void qc.invalidateQueries({ queryKey: ['journal'] }); void qc.invalidateQueries({ queryKey: ['ledger-accounts'] }); };
  const own = e.createdBy === me?.user.id && !me?.user.roles.includes('owner');
  const act = async (key: string, fn: () => Promise<Entry>, ok: string) => {
    setBusy(key);
    try { apply(await fn()); toast.success(ok); return true; } catch (err) { toast.error(errMsg(err)); return false; } finally { setBusy(null); }
  };
  const reverse = async () => {
    setBusy('rev');
    try {
      const rev = await api.post<Entry>(`/accounting/journal/${e.id}/reverse`, { date: revDate, reason: reason.trim() });
      toast.success(bi('تم إنشاء القيد العكسي', 'Reversal created'));
      void qc.invalidateQueries({ queryKey: ['journal-entry', id] });
      void qc.invalidateQueries({ queryKey: ['journal'] });
      void qc.invalidateQueries({ queryKey: ['ledger-accounts'] });
      setReversing(false); setReason('');
      router.push(`/accounting/journal/${rev.id}`);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(null); }
  };
  const totalDebit = e.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = e.lines.reduce((s, l) => s + Number(l.credit), 0);
  const href = e.sourceType ? SOURCE_HREF[e.sourceType]?.(e.id) ?? null : null;

  return (
    <>
      <PageHeader back="/accounting/journal" title={<span className="flex items-center gap-2">{bi('قيد يومية', 'Journal entry')} <span className="num" dir="ltr">{e.number}</span></span>}
        subtitle={<span className="flex flex-wrap items-center gap-2"><EntryStatus status={e.status} reversed={!!e.reversedById} /><KindBadge kind={e.kind} /><span className="num">{date(e.entryDate)}</span></span>}
        actions={!editing && <>
          {e.status === 'draft' && can('ledger.write') && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{bi('تعديل', 'Edit')}</Button>}
          {e.status === 'draft' && can('ledger.write') && <Button variant="outline" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>{bi('حذف المسودة', 'Delete draft')}</Button>}
          {e.status === 'draft' && can('ledger.post') && <Button icon={<Send className="size-4" />} disabled={own} title={own ? bi('أنت من أعدّ هذا القيد — يرحّله شخص آخر', 'You prepared this entry — someone else posts it') : undefined} onClick={() => setPosting(true)}>{bi('ترحيل', 'Post')}</Button>}
          {e.status === 'posted' && !e.reversedById && e.kind !== 'reversal' && can('ledger.post') && <Button variant="outline" icon={<Undo2 className="size-4" />} onClick={() => setReversing(true)}>{bi('عكس القيد', 'Reverse')}</Button>}
        </>} />

      {editing ? (
        <JournalEditor entry={e} onCancel={() => setEditing(false)} onSaved={(n) => { apply(n); setEditing(false); }} />
      ) : (
        <div className="grid gap-4">
          <Card>
            <Strip items={[
              { label: bi('البيان', 'Description'), value: e.memo },
              { label: bi('الفترة', 'Period'), value: <span className="num">{e.period}</span> },
              { label: bi('أعدّه', 'Prepared by'), value: e.createdByName },
              { label: bi('رحّله', 'Posted by'), value: e.postedByName ? <>{e.postedByName} <span className="num text-xs text-muted">{e.postedAt && dateTime(e.postedAt)}</span></> : null },
              { label: bi('المصدر', 'Source'), value: e.sourceRef ? (href ? <Link href={href} className="num text-primary hover:underline" dir="ltr">{e.sourceRef}</Link> : <span className="num" dir="ltr">{e.sourceRef}</span>) : null },
              { label: bi('يعكس القيد', 'Reverses'), value: e.reverses && <Link className="num text-primary hover:underline" dir="ltr" href={`/accounting/journal/${e.reverses.id}`}>{e.reverses.number}</Link> },
              { label: bi('عُكس بالقيد', 'Reversed by'), value: e.reversedBy && <Link className="num text-primary hover:underline" dir="ltr" href={`/accounting/journal/${e.reversedBy.id}`}>{e.reversedBy.number}</Link> },
            ]} />
            {e.status === 'draft' && <p className="mt-3 text-xs text-muted">{own ? bi('أنت من أعدّ هذا القيد، لذا يرحّله شخص آخر لديه صلاحية الترحيل (المالك يرحّل قيوده).', 'You prepared this entry, so someone else with posting permission posts it (the owner may post their own).') : bi('راجع الأسطر ثم رحّل القيد. بعد الترحيل يُقفل.', 'Review the lines, then post. Once posted it is locked.')}</p>}
          </Card>
          <Card padded={false} title={bi('الأسطر', 'Lines')}>
            <Table>
              <thead><tr><Th>#</Th><Th>{bi('الحساب', 'Account')}</Th><Th>{bi('العميل / المورد', 'Party')}</Th><Th>{bi('المشروع', 'Project')}</Th><Th>{bi('البيان', 'Memo')}</Th><Th className="text-end">{bi('مدين', 'Debit')}</Th><Th className="text-end">{bi('دائن', 'Credit')}</Th></tr></thead>
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="num text-xs text-muted">{l.lineNo}</Td>
                    <Td><Link href={`/accounting/reports?tab=ledger&account=${l.accountId}`} className="hover:underline"><span className="num font-bold text-gold-dark" dir="ltr">{l.code}</span> {l.nameAr}</Link></Td>
                    <Td className="text-xs">{l.partyName}{l.costCenter && <Badge tone="gray">{l.costCenter}</Badge>}</Td>
                    <Td className="num text-xs"><span dir="ltr">{l.projectNumber}</span></Td>
                    <Td className="text-xs text-muted">{l.memo}</Td>
                    <Td className="text-end"><Amt v={l.debit} /></Td>
                    <Td className="text-end"><Amt v={l.credit} /></Td>
                  </tr>
                ))}
                <tr className="bg-tint/50 font-extrabold"><Td colSpan={5} className="text-end text-xs text-gold-dark">{bi('الإجمالي', 'Total')}</Td><Td className="text-end"><Amt v={totalDebit.toFixed(2)} strong /></Td><Td className="text-end"><Amt v={totalCredit.toFixed(2)} strong /></Td></tr>
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      <ConfirmDialog open={posting} title={bi(`ترحيل القيد ${e.number}`, `Post entry ${e.number}`)} confirmLabel={bi('ترحيل', 'Post')} loading={busy === 'post'}
        message={bi('بعد الترحيل يظهر القيد في الأستاذ والتقارير ولا يمكن تعديله أو حذفه — يُصحَّح فقط بقيد عكسي.', 'Once posted the entry appears in the ledger and reports and can no longer be edited or deleted — only reversed.')}
        onClose={() => setPosting(false)} onConfirm={() => void act('post', () => api.post<Entry>(`/accounting/journal/${e.id}/post`), bi('تم ترحيل القيد', 'Entry posted')).then((ok) => ok && setPosting(false))} />
      <ConfirmDialog open={deleting} danger title={bi('حذف المسودة', 'Delete draft')} confirmLabel={bi('حذف', 'Delete')} message={e.number}
        onClose={() => setDeleting(false)} onConfirm={() => { setBusy('del'); api.del(`/accounting/journal/${e.id}`).then(() => { toast.success(bi('حُذفت المسودة', 'Draft deleted')); void qc.invalidateQueries({ queryKey: ['journal'] }); router.push('/accounting/journal'); }).catch((err) => toast.error(errMsg(err))).finally(() => setBusy(null)); }} />
      <Dialog open={reversing} onClose={() => setReversing(false)} title={bi(`عكس القيد ${e.number}`, `Reverse entry ${e.number}`)}
        footer={<><Button variant="outline" onClick={() => setReversing(false)}>{bi('إلغاء', 'Cancel')}</Button><Button variant="danger" loading={busy === 'rev'} disabled={!reason.trim()} onClick={() => void reverse()}>{bi('عكس القيد', 'Reverse')}</Button></>}>
        <div className="grid gap-3">
          <p className="text-sm text-muted">{bi('يُنشأ قيد جديد بنفس الأسطر وجوانب معكوسة ويُرحَّل فورًا، ويبقى القيد الأصلي كما هو.', 'A new entry with the sides swapped is created and posted at once; the original stays as it is.')}</p>
          <Field label={bi('تاريخ القيد العكسي', 'Reversal date')}><Input type="date" value={revDate} onChange={(ev) => setRevDate(ev.target.value)} /></Field>
          <Field label={bi('السبب *', 'Reason *')}><Textarea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
        </div>
      </Dialog>
    </>
  );
}
