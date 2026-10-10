'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Landmark, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Spinner, Table, Textarea, Td, Th } from '@/components/ui';
import { errMsg } from '../../quotes/_components/common';
import { RequirePerm } from '../../settings/_components/common';
import { AccountPicker, Amt } from '../_components/ledger-kit';

interface Row { id: string; account: { id: string; code: string; nameAr: string }; reference: string | null; dateFrom: string; dateTo: string; closingBalance: string; status: 'open' | 'reconciled'; unmatchedBank: number; difference: string }
interface ParsedLine { date: string; description: string; ref: string; debit: string; credit: string }

const num = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,\s]/g, '').replace('٫', '.').trim();
const toIso = (s: string): string | null => {
  const t = num(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
};

/** date, description, reference, money in, money out — comma, semicolon or tab separated; a header row is skipped. */
function parseStatement(text: string): { lines: ParsedLine[]; errors: string[] } {
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const lines: ParsedLine[] = [];
  const errors: string[] = [];
  rows.forEach((raw, i) => {
    const sep = raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : ',';
    const c = raw.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
    const d = toIso(c[0] ?? '');
    if (!d) { if (i > 0) errors.push(`السطر ${i + 1}: تاريخ غير مفهوم «${c[0] ?? ''}»`); return; }
    const inn = num(c[3] ?? '') || '0';
    const out = num(c[4] ?? '') || '0';
    if (!/^\d+(\.\d{1,2})?$/.test(inn) || !/^\d+(\.\d{1,2})?$/.test(out)) { errors.push(`السطر ${i + 1}: مبلغ غير صالح`); return; }
    if (Number(inn) > 0 && Number(out) > 0) { errors.push(`السطر ${i + 1}: إما إيداع أو سحب`); return; }
    if (Number(inn) === 0 && Number(out) === 0) { errors.push(`السطر ${i + 1}: بلا مبلغ`); return; }
    lines.push({ date: d, description: c[1] ?? '', ref: c[2] ?? '', debit: inn, credit: out });
  });
  return { lines, errors };
}

export default function BankPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="ledger.read" title={bi('التسوية البنكية', 'Bank reconciliation')}><Screen /></RequirePerm>;
}

function Screen() {
  const { bi } = useI18n();
  const { can } = useMe();
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['bank-statements'], queryFn: () => api.get<Row[]>('/accounting/bank-statements') });
  return (
    <>
      <PageHeader title={bi('التسوية البنكية', 'Bank reconciliation')} subtitle={bi('طابق كشف البنك مع حركة حساب البنك في الدفتر حتى يصير الفرق صفرًا.', 'Match the bank statement with the ledger until the difference is zero.')}
        actions={can('ledger.write') && <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{bi('كشف جديد', 'New statement')}</Button>} />
      <ErrorBox error={list.error} />
      <Card padded={false}>
        {list.isLoading ? <Spinner /> : !list.data?.length ? <Empty icon={<Landmark className="size-8" />} title={bi('لا توجد كشوف بعد', 'No statements yet')} /> : (
          <Table>
            <thead><tr><Th>{bi('الحساب', 'Account')}</Th><Th>{bi('الكشف', 'Statement')}</Th><Th>{bi('الفترة', 'Period')}</Th><Th className="text-end">{bi('الرصيد الختامي', 'Closing')}</Th><Th className="text-end">{bi('غير مطابق', 'Unmatched')}</Th><Th className="text-end">{bi('الفرق', 'Difference')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} className="hover:bg-tint/50">
                  <Td><span className="num text-xs text-gold-dark" dir="ltr">{r.account.code}</span> {r.account.nameAr}</Td>
                  <Td><Link href={`/accounting/bank/${r.id}`} className="font-bold text-primary hover:underline">{r.reference || bi('بدون مرجع', 'No reference')}</Link></Td>
                  <Td className="num text-xs"><span dir="ltr">{date(r.dateFrom)} → {date(r.dateTo)}</span></Td>
                  <Td className="text-end"><Amt v={r.closingBalance} /></Td><Td className="num text-end text-xs">{r.unmatchedBank}</Td><Td className="text-end"><Amt v={r.difference} strong /></Td>
                  <Td>{r.status === 'reconciled' ? <Badge tone="green">{bi('مُسوّى', 'Reconciled')}</Badge> : <Badge tone="gold">{bi('قيد التسوية', 'In progress')}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {adding && <NewStatement onClose={() => setAdding(false)} />}
    </>
  );
}

function NewStatement({ onClose }: { onClose: () => void }) {
  const { bi } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({ accountId: '', reference: '', dateFrom: `${today().slice(0, 7)}-01`, dateTo: today(), openingBalance: '0', closingBalance: '', text: '' });
  const parsed = useMemo(() => parseStatement(f.text), [f.text]);
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/accounting/bank-statements', { accountId: f.accountId, reference: f.reference || null, dateFrom: f.dateFrom, dateTo: f.dateTo, openingBalance: f.openingBalance || '0', closingBalance: f.closingBalance, lines: parsed.lines }),
    onSuccess: (r) => { toast.success(bi('أُنشئ الكشف وجرت المطابقة التلقائية', 'Statement created and auto-matched')); router.push(`/accounting/bank/${r.id}`); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onClose={onClose} wide title={bi('كشف حساب بنكي جديد', 'New bank statement')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={create.isPending} disabled={!f.accountId || f.closingBalance === '' || !!parsed.errors.length} onClick={() => create.mutate()}>{bi('إنشاء ومطابقة', 'Create & match')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('حساب البنك في الدفتر *', 'Bank account *')} className="sm:col-span-2"><AccountPicker value={f.accountId} onChange={(id) => setF({ ...f, accountId: id })} /></Field>
        <Field label={bi('مرجع الكشف', 'Reference')}><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <span />
        <Field label={bi('من', 'From')}><Input type="date" value={f.dateFrom} onChange={(e) => setF({ ...f, dateFrom: e.target.value })} /></Field>
        <Field label={bi('إلى', 'To')}><Input type="date" value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })} /></Field>
        <Field label={bi('الرصيد الافتتاحي (حسب الكشف)', 'Opening balance')}><Input value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} inputMode="decimal" dir="ltr" /></Field>
        <Field label={bi('الرصيد الختامي (حسب الكشف) *', 'Closing balance *')}><Input value={f.closingBalance} onChange={(e) => setF({ ...f, closingBalance: e.target.value })} inputMode="decimal" dir="ltr" /></Field>
        <Field className="sm:col-span-2" label={bi('حركات الكشف (الصقها من Excel أو CSV)', 'Statement lines (paste from Excel / CSV)')}
          hint={bi('الأعمدة بالترتيب: التاريخ، البيان، المرجع، إيداع، سحب. صف الترويسة اختياري.', 'Columns: date, description, reference, money in, money out. A header row is optional.')}>
          <Textarea rows={7} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} dir="ltr" placeholder={'2026-10-02,تحويل عميل,TRX-1,5750.00,\n2026-10-05,رسوم بنكية,,,25.00'} />
        </Field>
      </div>
      <p className="mt-2 text-xs"><span className="font-bold">{parsed.lines.length}</span> {bi('حركة مفهومة', 'lines understood')}{parsed.errors.length > 0 && <span className="ms-3 text-danger">{parsed.errors.slice(0, 3).join(' · ')}</span>}</p>
    </Dialog>
  );
}
