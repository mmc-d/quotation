'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Ban, CheckCircle2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { date, dateTime, today } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { AttachmentList } from '@/components/attachments';
import { Button, Card, Dialog, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { NumInput } from '../../../quotes/_components/common';
import { Amount, BILL_STATUS, Chip, Info, Ltr, MATCH_STATUS, PAYMENT_METHOD, WarningList, fixed, qty, useLabel } from '../../_components/common';
import type { BillView } from '../../_components/types';

export default function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { bi, locale } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const q = useQuery({ queryKey: ['bill', id], queryFn: () => api.get<BillView>(`/inventory/bills/${id}`) });
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const canPay = can('payment.record') || can('purchase.approve');

  const done = (b: BillView, msg: string) => {
    qc.setQueryData(['bill', id], b);
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['bills-aging'] });
    toast.success(msg);
  };
  const approve = useMutation({
    mutationFn: () => api.post(`/inventory/bills/${id}/approve`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bill', id] }); toast.success(bi('تم قبول الاستثناء واعتماد الفاتورة', 'Exception accepted, bill approved')); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const b = q.data;
  const open = ['approved', 'partially_paid'].includes(b.status);
  const supplierName = b.supplier ? (locale === 'en' ? b.supplier.nameEn || b.supplier.nameAr : b.supplier.nameAr) : '—';

  return (
    <>
      <PageHeader
        back="/purchasing/bills"
        title={<>{bi('فاتورة مشتريات', 'Supplier bill')} <span dir="ltr" className="num">{b.number}</span></>}
        subtitle={<span className="flex flex-wrap items-center gap-1.5">{supplierName} · <Ltr>{b.supplierInvoiceNo}</Ltr> <Chip map={BILL_STATUS} value={b.status} /> <Chip map={MATCH_STATUS} value={b.matchStatus} /></span>}
        actions={<>
          {b.status === 'draft' && can('purchase.approve') && <Button variant="outline" icon={<CheckCircle2 className="size-4" />} loading={approve.isPending} onClick={() => approve.mutate()}>{bi('قبول الاستثناء', 'Accept exception')}</Button>}
          {open && canPay && <Button icon={<Banknote className="size-4" />} onClick={() => setPaying(true)}>{bi('تسجيل دفعة للمورد', 'Record a payment')}</Button>}
          {['draft', 'approved'].includes(b.status) && can('purchase.approve') && <Button variant="outline" icon={<Ban className="size-4" />} onClick={() => setCancelling(true)}>{bi('إلغاء الفاتورة', 'Cancel bill')}</Button>}
        </>}
      />
      <div className="space-y-4">
        <WarningList title={bi('ملاحظات المطابقة الثلاثية', '3-way match issues')} tone="red" items={b.matchIssues} />
        {b.overdue && b.owed !== null && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
            {bi(`متأخرة — تجاوزت تاريخ الاستحقاق ${date(b.dueDate ?? b.billDate)}`, `Overdue — past the due date ${date(b.dueDate ?? b.billDate)}`)}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={bi('البيانات', 'Details')}>
            <Info label={bi('المورد', 'Supplier')}>{supplierName}</Info>
            {b.supplier?.vatNumber && <Info label={bi('الرقم الضريبي', 'VAT no.')}><Ltr>{b.supplier.vatNumber}</Ltr></Info>}
            <Info label={bi('رقم فاتورة المورد', 'Supplier invoice no.')}><Ltr>{b.supplierInvoiceNo}</Ltr></Info>
            <Info label={bi('تاريخ الفاتورة', 'Invoice date')}><span className="num">{date(b.billDate)}</span></Info>
            <Info label={bi('الاستحقاق', 'Due')}><span className="num">{date(b.dueDate)}</span></Info>
            <Info label={bi('أمر الشراء', 'Purchase order')}>{b.order ? <Link href={`/purchasing/orders/${b.order.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{b.order.number}</Link> : bi('بدون — فاتورة مباشرة', 'None — direct bill')}</Info>
            {b.warehouse && <Info label={bi('استُلمت في', 'Received into')}>{b.warehouse.code} — {locale === 'en' ? b.warehouse.nameEn || b.warehouse.nameAr : b.warehouse.nameAr}</Info>}
            {b.project && <Info label={bi('المشروع', 'Project')}><Link href={`/projects/${b.project.id}`} className="font-bold text-primary hover:underline"><span dir="ltr" className="num">{b.project.number}</span> {b.project.name}</Link></Info>}
            <Info label={bi('العملة / الصرف', 'Currency / rate')}><Ltr>{b.currency} × {Number(b.rateToSar)}</Ltr></Info>
            {b.fileId && <div className="pt-2"><AttachmentList ids={[b.fileId]} /></div>}
            {b.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{b.notes}</p>}
          </Card>

          <Card title={bi('المبالغ', 'Amounts')}>
            <Info label={bi('قبل الضريبة', 'Subtotal')}><Amount value={b.subtotal} currency={b.currency} /></Info>
            <Info label={bi('الضريبة', 'VAT')}><Amount value={b.vat} currency={b.currency} /></Info>
            <Info label={bi('الإجمالي', 'Total')}><Amount value={b.total} currency={b.currency} className="font-extrabold" /></Info>
            <Info label={bi('المدفوع', 'Paid')}><Amount value={b.paidAmount} currency={b.currency} className="text-emerald-700" /></Info>
            <Info label={bi('المتبقي', 'Owed')}><Amount value={b.owed} currency={b.currency} className={Number(b.owed) > 0 ? 'font-extrabold text-danger' : undefined} /></Info>
            {b.currency !== 'SAR' && b.owedSar !== null && <Info label={bi('المتبقي بالريال', 'Owed in SAR')}><Money value={b.owedSar} /></Info>}
          </Card>

          <Card title={bi('الدفعات', 'Payments')} padded={false}>
            {b.payments.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد دفعات بعد.', 'No payments yet.')}</p> : (
              <ul className="divide-y divide-line">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm">
                    <div>
                      <div className="font-bold"><Amount value={p.amount} currency={b.currency} /> · {label(PAYMENT_METHOD, p.method)}</div>
                      <div className="text-xs text-muted"><span className="num">{date(p.paidOn)}</span>{p.reference && <> · <Ltr>{p.reference}</Ltr></>}{p.note && <> · {p.note}</>}</div>
                    </div>
                    {canPay && <button type="button" onClick={() => setVoiding(p.id)} className="rounded p-1 text-muted hover:bg-rose-50 hover:text-danger" title={bi('إلغاء الدفعة', 'Void payment')} aria-label={bi('إلغاء الدفعة', 'Void payment')}><Undo2 className="size-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title={bi('البنود', 'Lines')} padded={false}>
          <Table>
            <thead><tr><Th>#</Th><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الوصف', 'Description')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th className="text-end">{bi('سعر الوحدة', 'Unit price')}</Th><Th className="text-end">{bi('الضريبة', 'VAT')}</Th><Th className="text-end">{bi('الإجمالي', 'Total')}</Th></tr></thead>
            <tbody>
              {b.lines.map((l, i) => (
                <tr key={i}>
                  <Td className="text-muted">{i + 1}</Td>
                  <Td>{l.productId ? <Link href={`/inventory/${l.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{l.code}</Link> : <Ltr>{l.code || null}</Ltr>}</Td>
                  <Td>{l.description ?? '—'}{l.serials?.length ? <div dir="ltr" className="num mt-0.5 text-[11px] text-muted">{l.serials.join(', ')}</div> : null}</Td>
                  <Td className="text-end"><span className="num">{qty(l.qty)}</span></Td>
                  <Td className="text-end"><Amount value={l.unitPrice} currency={b.currency} /></Td>
                  <Td className="text-end"><span className="num text-xs">{l.vatPercent !== undefined ? `${Number(l.vatPercent)}%` : '—'}</span></Td>
                  <Td className="text-end"><Amount value={l.unitPrice === null ? null : fixed(Number(l.qty) * Number(l.unitPrice))} currency={b.currency} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        {b.moves.length > 0 && (
          <Card title={bi('ما دخل المخزون من هذه الفاتورة', 'Received into stock from this bill')} padded={false}>
            <Table>
              <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th className="text-end">{bi('تكلفة الوحدة (ر.س)', 'Unit cost (SAR)')}</Th><Th>{bi('الأرقام التسلسلية', 'Serials')}</Th><Th>{bi('الوقت', 'Posted')}</Th></tr></thead>
              <tbody>
                {b.moves.map((m) => (
                  <tr key={m.id}>
                    <Td><Link href={`/inventory/${m.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{m.code}</Link></Td>
                    <Td className="text-end"><span className="num">{qty(m.qty)}</span></Td>
                    <Td className="text-end">{m.unitCostSar === null ? <span className="text-muted">—</span> : <Money value={m.unitCostSar} />}</Td>
                    <Td><span dir="ltr" className="num text-xs">{m.serials.join(', ') || '—'}</span></Td>
                    <Td><span className="num text-xs text-muted">{dateTime(m.postedAt)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>

      {paying && <PaymentDialog bill={b} onClose={() => setPaying(false)} onDone={(nb) => { setPaying(false); done(nb, bi('تم تسجيل الدفعة', 'Payment recorded')); }} />}
      {cancelling && <CancelBillDialog billId={b.id} onClose={() => setCancelling(false)} onDone={(nb) => { setCancelling(false); done(nb, bi('أُلغيت الفاتورة وعُكس قيدها', 'Bill cancelled and its entry reversed')); }} />}
      {voiding && <VoidDialog billId={b.id} paymentId={voiding} onClose={() => setVoiding(null)} onDone={(nb) => { setVoiding(null); done(nb, bi('أُلغيت الدفعة', 'Payment voided')); }} />}
    </>
  );
}

function PaymentDialog({ bill, onClose, onDone }: { bill: BillView; onClose: () => void; onDone: (b: BillView) => void }) {
  const { bi } = useI18n();
  const label = useLabel();
  const [amount, setAmount] = useState(bill.owed ? String(Number(bill.owed)) : '');
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<BillView>(`/inventory/bills/${bill.id}/payments`, { amount: fixed(Number(amount), 2), paidOn, method, reference: reference.trim() || null, note: note.trim() || null }),
    onSuccess: onDone,
    onError: (e) => toast.error((e as Error).message),
  });
  const over = bill.owed !== null && Number(amount) > Number(bill.owed);
  return (
    <Dialog open onClose={onClose} title={<>{bi('دفعة للمورد على', 'Payment against')} <span dir="ltr" className="num">{bill.number}</span></>}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={m.isPending} disabled={!(Number(amount) > 0) || over || !paidOn} onClick={() => m.mutate()}>{bi('تسجيل الدفعة', 'Record payment')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={<>{bi('المبلغ', 'Amount')} ({bill.currency})</>} hint={bill.owed !== null ? bi(`المتبقي ${bill.owed}`, `Owed ${bill.owed}`) : undefined} error={over ? bi('أكبر من المتبقي', 'More than what is owed') : null}>
          <NumInput value={amount} onChange={setAmount} step="0.01" />
        </Field>
        <Field label={bi('تاريخ الدفع', 'Paid on')}><Input type="date" dir="ltr" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        <Field label={bi('طريقة الدفع', 'Method')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>{Object.keys(PAYMENT_METHOD).map((k) => <option key={k} value={k}>{label(PAYMENT_METHOD, k)}</option>)}</Select>
        </Field>
        <Field label={bi('المرجع (رقم الحوالة/الشيك)', 'Reference (transfer/cheque no.)')}><Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label={bi('ملاحظة', 'Note')} className="sm:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function VoidDialog({ billId, paymentId, onClose, onDone }: { billId: string; paymentId: string; onClose: () => void; onDone: (b: BillView) => void }) {
  const { bi } = useI18n();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<BillView>(`/inventory/bills/${billId}/payments/${paymentId}/void`, { reason: reason.trim() }),
    onSuccess: onDone,
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} title={bi('إلغاء دفعة', 'Void a payment')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('رجوع', 'Back')}</Button><Button variant="danger" loading={m.isPending} disabled={!reason.trim()} onClick={() => m.mutate()}>{bi('إلغاء الدفعة', 'Void payment')}</Button></>}>
      <p className="mb-3 text-sm text-muted">{bi('تُحذف الدفعة من الفاتورة ويبقى أثرها في سجل التدقيق.', 'The payment is removed from the bill; the audit log keeps a record.')}</p>
      <Field label={bi('السبب *', 'Reason *')}><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Dialog>
  );
}

function CancelBillDialog({ billId, onClose, onDone }: { billId: string; onClose: () => void; onDone: (b: BillView) => void }) {
  const { bi } = useI18n();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<BillView>(`/inventory/bills/${billId}/cancel`, { reason: reason.trim() }),
    onSuccess: onDone,
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} title={bi('إلغاء فاتورة المورد', 'Cancel the supplier bill')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('رجوع', 'Back')}</Button><Button variant="danger" loading={m.isPending} disabled={!reason.trim()} onClick={() => m.mutate()}>{bi('إلغاء الفاتورة', 'Cancel bill')}</Button></>}>
      <p className="mb-3 text-sm text-muted">{bi('للفواتير غير المدفوعة فقط. يُعكس قيدها المحاسبي ويعود ما فُوتر على أمر الشراء. الفاتورة التي استلمت بضاعة في المخزون لا تُلغى من هنا.', 'Unpaid bills only. Its ledger entry is reversed and the billed quantities go back to the order. A bill that received goods into stock cannot be cancelled here.')}</p>
      <Field label={bi('السبب *', 'Reason *')}><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Dialog>
  );
}
