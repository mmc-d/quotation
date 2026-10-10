'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Button, Card, Dialog, ErrorBox, Field, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { errMsg } from '../../quotes/_components/common';
import { RequirePerm } from '../../settings/_components/common';
import { AccountPicker, Amt } from '../_components/ledger-kit';

interface Suspense { entryId: string; number: string; entryDate: string; memo: string | null; sourceType: string | null; sourceRef: string | null; lineId: string; amount: string; side: 'debit' | 'credit'; partyId: string | null; canReclassify: boolean }
interface Exceptions {
  live: boolean; goLiveDate: string | null; suspense: Suspense[];
  errors: { sourceType: string; sourceId: string; ref: string | null; error: string; at: string }[];
  changed: { sourceType: string; sourceId: string; ref: string; postedAmounts: string; currentAmounts: string }[];
  shifted: { entryId: string; number: string; entryDate: string; memo: string | null }[];
}
interface Check { key: string; ok: boolean; labelAr: string; ledger?: string; source?: string; diff?: string; note?: string }

const SOURCE_LABEL: Record<string, [string, string]> = {
  invoice: ['فاتورة', 'Invoice'], payment: ['دفعة عميل', 'Customer payment'], voucher: ['سند', 'Voucher'], bill: ['فاتورة مورد', 'Supplier bill'], bill_payment: ['دفعة مورد', 'Supplier payment'],
  stock: ['حركة مخزون', 'Stock move'], stock_move: ['حركة مخزون', 'Stock move'], import_vat: ['ضريبة استيراد', 'Import VAT'], landed_cost: ['تكاليف استيراد', 'Landed cost'],
  payroll: ['مسير رواتب', 'Payroll'], payroll_paid: ['صرف رواتب', 'Payroll payment'], commission: ['عمولة', 'Commission'],
};

export default function ExceptionsPage() {
  return <RequirePerm perm="ledger.read" title="بانتظار التوجيه المحاسبي"><Screen /></RequirePerm>;
}

function Screen() {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const ex = useQuery({ queryKey: ['gl-exceptions'], queryFn: () => api.get<Exceptions>('/accounting/posting/exceptions') });
  const checks = useQuery({ queryKey: ['gl-reconciliation'], queryFn: () => api.get<Check[]>('/accounting/reports/reconciliation') });
  const grni = useQuery({ queryKey: ['gl-grni'], queryFn: () => api.get<{ rows: { order: string; code: string; supplier: string; received: string; billed: string; unitCostSar: string; valueSar: string }[]; total: string }>('/accounting/reports/grni') });
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Suspense | null>(null);
  const [accountId, setAccountId] = useState('');
  const sourceName = (t: string | null) => (t ? (SOURCE_LABEL[t] ? (locale === 'en' ? SOURCE_LABEL[t]![1] : SOURCE_LABEL[t]![0]) : t) : bi('يدوي', 'Manual'));
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['gl-exceptions'] }); void qc.invalidateQueries({ queryKey: ['gl-reconciliation'] }); void qc.invalidateQueries({ queryKey: ['gl-grni'] }); void qc.invalidateQueries({ queryKey: ['ledger-dashboard'] }); void qc.invalidateQueries({ queryKey: ['ledger-accounts'] }); };

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ live: boolean; posted: number; reversed: number; errors: number }>('/accounting/posting/run', {});
      if (!r.live) toast.message(bi('حدّد تاريخ بدء النظام المحاسبي أولًا (الأرصدة الافتتاحية)', 'Set the go-live date first (opening balances)'));
      else toast.success(bi(`رُحِّل ${r.posted} مستند، وعُكس ${r.reversed}${r.errors ? `، وتعذّر ${r.errors}` : ''}`, `Posted ${r.posted}, reversed ${r.reversed}${r.errors ? `, ${r.errors} failed` : ''}`));
      refresh();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const reclassify = async () => {
    if (!pick || !accountId) return;
    setBusy(true);
    try {
      const r = await api.post<{ reversal: { number: string }; entry: { number: string } }>('/accounting/posting/reclassify', { entryId: pick.entryId, lineId: pick.lineId, accountId });
      toast.success(bi(`عُكس القيد ${pick.number} ورُحِّل ${r.entry.number}`, `Reversed ${pick.number}, posted ${r.entry.number}`));
      setPick(null); setAccountId(''); refresh();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  if (ex.isLoading) return <Spinner />;
  if (!ex.data) return <ErrorBox error={ex.error} />;
  const d = ex.data;
  return (
    <>
      <PageHeader title={bi('بانتظار التوجيه المحاسبي', 'Awaiting accounting classification')} subtitle={bi('كل ما رُحِّل تلقائيًا ويحتاج مراجعة المحاسب', 'Automatic postings that need the accountant')}
        actions={can('ledger.post') && <Button icon={<RefreshCw className="size-4" />} loading={busy} onClick={() => void run()}>{bi('رحّل الآن', 'Post now')}</Button>} />
      {!d.live && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-gold/40 bg-tint/60 px-4 py-3 text-sm"><AlertTriangle className="size-4 text-gold-dark" />{bi('الترحيل التلقائي متوقف حتى يُحدَّد تاريخ بدء النظام المحاسبي.', 'Auto-posting is off until the go-live date is set.')} <Link href="/accounting/opening" className="font-bold text-primary hover:underline">{bi('الأرصدة الافتتاحية', 'Opening balances')}</Link></div>
      )}
      <div className="grid gap-4">
        <Card title={bi('مطابقة الدفتر مع المستندات', 'Ledger reconciliation')}>
          {checks.data ? (
            <ul className="space-y-2 text-sm">
              {checks.data.map((c) => (
                <li key={c.key} className="flex items-start gap-2">
                  {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />}
                  <div><span className={c.ok ? '' : 'font-bold text-danger'}>{c.labelAr}</span>
                    {!c.ok && c.diff !== undefined && <span className="ms-2 text-xs text-muted">{bi('الدفتر', 'Ledger')} <Amt v={c.ledger} /> · {bi('المستندات', 'Documents')} <Amt v={c.source} /> · {bi('الفرق', 'Difference')} <Amt v={c.diff} /></span>}
                    {!c.ok && c.note && <p className="text-xs text-muted">{c.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <Spinner />}
        </Card>

        {grni.data && grni.data.rows.length > 0 && (
          <Card padded={false} title={`${bi('بضائع مستلمة لم تُفوتر (GRNI)', 'Goods received not invoiced')} — ${grni.data.total}`}>
            <Table>
              <thead><tr><Th>{bi('أمر الشراء', 'PO')}</Th><Th>{bi('المورد', 'Supplier')}</Th><Th>{bi('الصنف', 'Item')}</Th><Th className="text-end">{bi('المستلم', 'Received')}</Th><Th className="text-end">{bi('المفوتر', 'Billed')}</Th><Th className="text-end">{bi('القيمة', 'Value')}</Th></tr></thead>
              <tbody>{grni.data.rows.map((r, i) => <tr key={i}><Td className="num text-xs"><span dir="ltr">{r.order}</span></Td><Td className="text-xs">{r.supplier}</Td><Td className="num text-xs"><span dir="ltr">{r.code}</span></Td><Td className="num text-end text-xs">{r.received}</Td><Td className="num text-end text-xs">{r.billed}</Td><Td className="text-end"><Amt v={r.valueSar} /></Td></tr>)}</tbody>
            </Table>
          </Card>
        )}

        <Card padded={false} title={`${bi('أسطر في حساب التسوية', 'Lines on the suspense account')} (${d.suspense.length})`}>
          <Table>
            <thead><tr><Th>{bi('القيد', 'Entry')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('المصدر', 'Source')}</Th><Th>{bi('البيان', 'Description')}</Th><Th className="text-end">{bi('مدين', 'Debit')}</Th><Th className="text-end">{bi('دائن', 'Credit')}</Th><Th /></tr></thead>
            <tbody>
              {d.suspense.map((s) => (
                <tr key={s.lineId} className="hover:bg-tint/50">
                  <Td><Link href={`/accounting/journal/${s.entryId}`} className="num font-bold text-primary hover:underline" dir="ltr">{s.number}</Link></Td>
                  <Td className="num text-xs">{date(s.entryDate)}</Td>
                  <Td className="text-xs">{sourceName(s.sourceType)} {s.sourceRef && <span className="num" dir="ltr">{s.sourceRef}</span>}</Td>
                  <Td className="max-w-[18rem] truncate text-xs">{s.memo}</Td>
                  <Td className="text-end"><Amt v={s.side === 'debit' ? s.amount : null} /></Td><Td className="text-end"><Amt v={s.side === 'credit' ? s.amount : null} /></Td>
                  <Td className="text-end">{can('ledger.post') && (s.canReclassify ? <Button size="sm" variant="outline" onClick={() => { setPick(s); setAccountId(''); }}>{bi('توجيه', 'Classify')}</Button> : <span className="text-xs text-muted">{bi('عكس يدوي', 'reverse manually')}</span>)}</Td>
                </tr>
              ))}
              {!d.suspense.length && <tr><Td colSpan={7} className="py-6 text-center text-muted"><CheckCircle2 className="mx-auto mb-1 size-5 text-ok" />{bi('لا توجد أسطر بانتظار التوجيه.', 'Nothing waiting.')}</Td></tr>}
            </tbody>
          </Table>
        </Card>

        {d.errors.length > 0 && (
          <Card padded={false} title={`${bi('أخطاء وتنبيهات الترحيل', 'Posting errors and warnings')} (${d.errors.length})`}>
            <Table>
              <thead><tr><Th>{bi('المصدر', 'Source')}</Th><Th>{bi('المرجع', 'Ref')}</Th><Th>{bi('التفاصيل', 'Details')}</Th><Th>{bi('آخر تحديث', 'Updated')}</Th></tr></thead>
              <tbody>{d.errors.map((e) => <tr key={e.sourceType + e.sourceId}><Td className="text-xs">{sourceName(e.sourceType)}</Td><Td className="num text-xs"><span dir="ltr">{e.ref}</span></Td><Td className="text-xs">{e.error}</Td><Td className="num text-xs">{date(e.at)}</Td></tr>)}</tbody>
            </Table>
          </Card>
        )}

        {d.changed.length > 0 && (
          <Card padded={false} title={`${bi('مبالغ تغيّرت بعد الترحيل', 'Amounts changed after posting')} (${d.changed.length})`}>
            <Table>
              <thead><tr><Th>{bi('المصدر', 'Source')}</Th><Th>{bi('المرجع', 'Ref')}</Th><Th>{bi('عند الترحيل', 'When posted')}</Th><Th>{bi('الآن', 'Now')}</Th></tr></thead>
              <tbody>{d.changed.map((c) => <tr key={c.sourceType + c.sourceId}><Td className="text-xs">{sourceName(c.sourceType)}</Td><Td className="num text-xs"><span dir="ltr">{c.ref}</span></Td><Td className="num text-xs"><span dir="ltr">{c.postedAmounts}</span></Td><Td className="num text-xs font-bold text-danger"><span dir="ltr">{c.currentAmounts}</span></Td></tr>)}</tbody>
            </Table>
            <p className="px-4 py-2 text-xs text-muted">{bi('لا يُعاد ترحيل هذه المستندات تلقائيًا؛ صحّح بقيد عكسي أو تسوية.', 'These are not re-posted automatically; correct them with a reversal or adjustment.')}</p>
          </Card>
        )}

        {d.shifted.length > 0 && (
          <Card padded={false} title={`${bi('قيود نُقلت من فترة مقفلة', 'Entries moved out of a locked period')} (${d.shifted.length})`}>
            <Table>
              <thead><tr><Th>{bi('القيد', 'Entry')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('البيان', 'Description')}</Th></tr></thead>
              <tbody>{d.shifted.map((s) => <tr key={s.entryId}><Td><Link href={`/accounting/journal/${s.entryId}`} className="num font-bold text-primary hover:underline" dir="ltr">{s.number}</Link></Td><Td className="num text-xs">{date(s.entryDate)}</Td><Td className="text-xs">{s.memo}</Td></tr>)}</tbody>
            </Table>
          </Card>
        )}
      </div>

      <Dialog open={!!pick} onClose={() => setPick(null)} title={bi('توجيه السطر إلى حساب', 'Classify the line')}
        footer={<><Button variant="outline" onClick={() => setPick(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={busy} disabled={!accountId} onClick={() => void reclassify()}>{bi('عكس وإعادة الترحيل', 'Reverse and re-post')}</Button></>}>
        {pick && (
          <div className="grid gap-3 text-sm">
            <p>{bi('سيُعكس القيد', 'Entry')} <b className="num" dir="ltr">{pick.number}</b> {bi('ويُرحَّل من جديد بالحساب المختار، ويُربط القيدان.', 'will be reversed and re-posted with the chosen account; the two stay linked.')}</p>
            <p><Badge tone="gray">{pick.side === 'debit' ? bi('مدين', 'Debit') : bi('دائن', 'Credit')}</Badge> <Amt v={pick.amount} strong /></p>
            <Field label={bi('الحساب *', 'Account *')}><AccountPicker value={accountId} onChange={(id) => setAccountId(id)} /></Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
