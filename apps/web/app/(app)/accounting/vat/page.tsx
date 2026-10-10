'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, FileDown, FileSpreadsheet, Percent, Plus } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { ReasonDialog, errMsg } from '../../quotes/_components/common';
import { RequirePerm } from '../../settings/_components/common';
import { Amt } from '../_components/ledger-kit';

interface Box { base: string; vat: string }
interface ReturnView {
  id: string; label: string; periodFrom: string; periodTo: string; status: 'draft' | 'filed'; filedOn: string | null;
  boxes: Record<string, Box | string>; outputVat: string; inputVat: string; netVat: string; ledgerNet: string; difference: string;
  settlementEntry: { id: string; number: string } | null; draftsInPeriod: number;
}
interface Threshold {
  asOf: string; rolling12: string; level: 'below' | 'voluntary' | 'mandatory'; pctOfMandatory: number; remainingToMandatory: string; registered: boolean; alert: string | null;
  months: { month: string; taxable: string }[];
}

const BOXES: [string, string, string][] = [
  ['box1', '1', 'المبيعات الخاضعة للنسبة الأساسية (15٪)'], ['box3', '3', 'الصادرات'], ['box5', '5', 'المبيعات المحلية الخاضعة لنسبة الصفر'], ['box6', '6', 'المبيعات المعفاة'], ['box7', '7', 'إجمالي المبيعات'],
  ['box8', '8', 'المشتريات المحلية الخاضعة للنسبة الأساسية'], ['box9', '9', 'الاستيرادات — ضريبة مدفوعة في الجمارك'], ['box10', '10', 'الاستيرادات — الاحتساب العكسي'], ['box11', '11', 'المشتريات الخاضعة لنسبة الصفر'], ['box12', '12', 'المشتريات المعفاة'], ['box13', '13', 'إجمالي المشتريات'],
];

export default function VatPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="ledger.read" title={bi('ضريبة القيمة المضافة', 'VAT return')}><Screen /></RequirePerm>;
}

function Screen() {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const th = useQuery({ queryKey: ['vat-threshold'], queryFn: () => api.get<Threshold>('/accounting/vat/threshold') });
  const list = useQuery({ queryKey: ['vat-returns'], queryFn: () => api.get<{ frequency: string; suggested: { from: string; to: string; label: string }; items: ReturnView[] }>('/accounting/vat-returns') });
  const [open, setOpen] = useState<string | null>(null);
  const [prep, setPrep] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['vat-returns'] }); void qc.invalidateQueries({ queryKey: ['vat-return'] }); void qc.invalidateQueries({ queryKey: ['ledger-dashboard'] }); void qc.invalidateQueries({ queryKey: ['gl-reconciliation'] }); };

  const prepare = useMutation({
    mutationFn: () => api.post<ReturnView>('/accounting/vat-returns', range.from && range.to ? { from: range.from, to: range.to } : {}),
    onSuccess: (r) => { toast.success(bi('جُهِّز الإقرار', 'Return prepared')); setPrep(false); setOpen(r.id); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const t = th.data;
  const tone = t?.level === 'mandatory' ? 'bg-danger' : t?.level === 'voluntary' ? 'bg-gold' : 'bg-ok';
  return (
    <>
      <PageHeader title={bi('ضريبة القيمة المضافة', 'VAT return')} subtitle={bi('الإقرار يُبنى من قيود الدفتر المُرمَّزة بكود ضريبي، ويُسوّى بقيد واحد عند التقديم.', 'Built from the VAT-coded ledger lines; filing posts one settlement entry.')}
        actions={can('ledger.write') && <Button icon={<Plus className="size-4" />} onClick={() => { setRange({ from: list.data?.suggested.from ?? '', to: list.data?.suggested.to ?? '' }); setPrep(true); }}>{bi('تجهيز إقرار', 'Prepare return')}</Button>} />

      <Card className="mb-4" title={bi('مراقبة حد التسجيل', 'Registration threshold monitor')}>
        {!t ? <Spinner /> : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone={t.registered ? 'green' : 'gray'}>{t.registered ? bi('المنشأة مسجلة في الضريبة', 'VAT-registered') : bi('المنشأة غير مسجلة', 'Not registered')}</Badge>
              <span>{bi('التوريدات الخاضعة خلال آخر 12 شهرًا', 'Taxable supplies, last 12 months')}: <Amt v={t.rolling12} strong /> {bi('ر.س', 'SAR')}</span>
              <span className="text-muted">{bi('المتبقي حتى الحد الإلزامي', 'Left to mandatory')}: <Amt v={t.remainingToMandatory} /></span>
            </div>
            <div className="relative h-3 overflow-hidden rounded-full bg-tint" aria-label={bi('نسبة الاستهلاك من الحد الإلزامي', 'Share of the mandatory threshold')}>
              <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, t.pctOfMandatory)}%` }} />
              <div className="absolute inset-y-0 w-px bg-ink/50" style={{ insetInlineStart: '50%' }} title="187,500" />
            </div>
            <div className="flex justify-between text-xs text-muted"><span>0</span><span>187,500 {bi('(اختياري)', '(voluntary)')}</span><span>375,000 {bi('(إلزامي)', '(mandatory)')}</span></div>
            {t.alert && <div className="flex items-start gap-2 rounded-lg border border-gold/40 bg-tint/60 px-3 py-2 text-sm font-bold"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold-dark" />{t.alert}</div>}
          </div>
        )}
      </Card>

      <ErrorBox error={list.error} />
      <Card padded={false} title={bi('الإقرارات', 'Returns')}>
        {list.isLoading ? <Spinner /> : !list.data?.items.length ? (
          <Empty icon={<Percent className="size-8" />} title={bi('لا توجد إقرارات بعد', 'No returns yet')} hint={bi('تتوفر الإقرارات عند تسجيل المنشأة في ضريبة القيمة المضافة (من إعدادات المنشأة).', 'Available once the company is VAT-registered (company settings).')} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('الفترة', 'Period')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th className="text-end">{bi('ضريبة المخرجات', 'Output VAT')}</Th><Th className="text-end">{bi('ضريبة المدخلات', 'Input VAT')}</Th><Th className="text-end">{bi('الصافي', 'Net')}</Th><Th>{bi('مطابقة الدفتر', 'Ledger match')}</Th><Th /></tr></thead>
            <tbody>
              {list.data.items.map((r) => (
                <tr key={r.id} className="hover:bg-tint/50">
                  <Td><b className="num" dir="ltr">{r.label}</b><div className="num text-xs text-muted" dir="ltr">{date(r.periodFrom)} → {date(r.periodTo)}</div></Td>
                  <Td>{r.status === 'filed' ? <Badge tone="green">{bi('مُقدَّم', 'Filed')} {r.filedOn ? date(r.filedOn) : ''}</Badge> : <Badge tone="gold">{bi('مسودة', 'Draft')}</Badge>}</Td>
                  <Td className="text-end"><Amt v={r.outputVat} /></Td><Td className="text-end"><Amt v={r.inputVat} /></Td><Td className="text-end"><Amt v={r.netVat} strong /></Td>
                  <Td>{Number(r.difference) === 0 ? <CheckCircle2 className="size-4 text-ok" /> : <span className="text-xs font-bold text-danger">{r.difference}</span>}</Td>
                  <Td className="text-end"><Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>{bi('فتح', 'Open')}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog open={prep} onClose={() => setPrep(false)} title={bi('تجهيز إقرار ضريبي', 'Prepare a VAT return')}
        footer={<><Button variant="outline" onClick={() => setPrep(false)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={prepare.isPending} onClick={() => prepare.mutate()}>{bi('تجهيز', 'Prepare')}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bi('من', 'From')}><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label={bi('إلى', 'To')}><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </div>
        <p className="mt-2 text-xs text-muted">{bi('الفترة المقترحة حسب تكرار الإقرار في إعدادات الحسابات.', 'The suggested period follows the return frequency in ledger settings.')}</p>
      </Dialog>

      {open && <Detail id={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </>
  );
}

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const q = useQuery({ queryKey: ['vat-return', id], queryFn: () => api.get<ReturnView>(`/accounting/vat-returns/${id}`) });
  const [unfile, setUnfile] = useState(false);
  const [ack, setAck] = useState(false);
  const file = useMutation({
    mutationFn: () => api.post<ReturnView>(`/accounting/vat-returns/${id}/file`, { acknowledgeDifference: ack }),
    onSuccess: () => { toast.success(bi('قُدِّم الإقرار ورُحِّل قيد التسوية', 'Return filed and settlement posted')); onChanged(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const r = q.data;
  const diff = r ? Number(r.difference) !== 0 : false;
  return (
    <Dialog open onClose={onClose} wide title={r ? `${bi('إقرار', 'Return')} ${r.label}` : bi('الإقرار', 'Return')}
      footer={r && <>
        <Button variant="outline" icon={<FileDown className="size-4" />} onClick={() => openFile(`/accounting/vat-returns/${id}?format=pdf`)}>PDF</Button>
        <Button variant="outline" icon={<FileSpreadsheet className="size-4" />} onClick={() => openFile(`/accounting/vat-returns/${id}?format=xlsx`)}>Excel</Button>
        {r.status === 'draft' && can('ledger.post') && <Button loading={file.isPending} disabled={diff && !ack} onClick={() => file.mutate()}>{bi('تقديم وترحيل التسوية', 'File & post settlement')}</Button>}
        {r.status === 'filed' && can('ledger.close') && <Button variant="danger" onClick={() => setUnfile(true)}>{bi('إلغاء التقديم', 'Un-file')}</Button>}
      </>}>
      {q.isLoading ? <Spinner /> : !r ? <ErrorBox error={q.error} /> : (
        <div className="grid gap-3">
          <p className="num text-xs text-muted" dir="ltr">{date(r.periodFrom)} → {date(r.periodTo)}{r.settlementEntry ? ` · ${r.settlementEntry.number}` : ''}</p>
          {diff && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
              <b className="text-danger">{bi('صافي الإقرار لا يطابق حركة حسابات الضريبة بالدفتر', 'The return does not match the VAT accounts')}</b> — {bi('الفرق', 'difference')} <Amt v={r.difference} strong />.
              {bi(' غالبًا قيد يدوي على حساب الضريبة بلا كود ضريبي؛ اعكسه وأعد إدخاله بكود، أو أقرّ بالفرق.', ' Usually a manual entry on a VAT account without a VAT code; reverse and re-enter it with a code, or acknowledge the difference.')}
              {r.status === 'draft' && <div className="mt-2"><Checkbox label={bi('أقرّ بوجود الفرق وأريد التقديم', 'I acknowledge the difference and want to file')} checked={ack} onChange={setAck} /></div>}
            </div>
          )}
          {r.draftsInPeriod > 0 && <div className="rounded-lg border border-gold/40 bg-tint/60 px-3 py-2 text-sm font-bold">{bi(`يوجد ${r.draftsInPeriod} قيد مسودة ضمن الفترة — رحّلها أو احذفها قبل التقديم.`, `${r.draftsInPeriod} draft entries in the period — post or delete them before filing.`)}</div>}
          <Table>
            <thead><tr><Th>{bi('البند', 'Box')}</Th><Th className="text-end">{bi('المبلغ الخاضع', 'Amount')}</Th><Th className="text-end">{bi('الضريبة', 'VAT')}</Th></tr></thead>
            <tbody>
              {BOXES.map(([k, n, label]) => {
                const b = r.boxes[k] as Box | undefined;
                const total = k === 'box7' || k === 'box13';
                return <tr key={k} className={total ? 'bg-tint/50 font-extrabold' : ''}><Td><span className="num text-gold-dark" dir="ltr">{n}</span> — {label}</Td><Td className="text-end"><Amt v={b?.base} strong={total} /></Td><Td className="text-end"><Amt v={b?.vat} strong={total} /></Td></tr>;
              })}
              <tr><Td>14 — {bi('إجمالي ضريبة المخرجات المستحقة', 'Total VAT due')}</Td><Td /><Td className="text-end"><Amt v={r.boxes.box14 as string} strong /></Td></tr>
              <tr><Td>15 — {bi('إجمالي ضريبة المدخلات القابلة للخصم', 'Total VAT deductible')}</Td><Td /><Td className="text-end"><Amt v={r.boxes.box15 as string} strong /></Td></tr>
              <tr className="bg-primary text-white"><Td className="font-extrabold">16 — {Number(r.netVat) < 0 ? bi('صافي الضريبة القابلة للاسترداد', 'Net VAT reclaimable') : bi('صافي الضريبة المستحقة للهيئة', 'Net VAT payable')}</Td><Td /><Td className="text-end font-extrabold"><Amt v={r.netVat} strong className="text-white" /></Td></tr>
            </tbody>
          </Table>
        </div>
      )}
      <ReasonDialog open={unfile} required danger title={bi('إلغاء تقديم الإقرار', 'Un-file the return')} hint={bi('يُعكس قيد التسوية ويعود الإقرار مسودة.', 'The settlement entry is reversed and the return goes back to draft.')}
        onClose={() => setUnfile(false)} onConfirm={async (reason) => { try { await api.post(`/accounting/vat-returns/${id}/unfile`, { reason }); toast.success(bi('أُلغي التقديم', 'Un-filed')); setUnfile(false); onChanged(); void q.refetch(); } catch (e) { toast.error(errMsg(e)); } }} />
    </Dialog>
  );
}
