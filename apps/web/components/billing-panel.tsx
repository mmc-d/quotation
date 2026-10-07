'use client';
/**
 * Contract billing cockpit: milestones → payment requests → 386 prepayment / 388 final invoices → payments.
 * Change orders are billed on their own milestones (labelled «أمر تغيير MMC-CO-…»): a separate 388 per paid
 * change order, or a 381 credit note for a reduction — never part of the contract's 50/40/10 or its final 388.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Banknote, FileText, HandCoins, Receipt, ReceiptText } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, h, money, today } from '@/lib/format';
import { Button, Card, Dialog, Empty, ErrorBox, Field, Input, Money, Select, Spinner, StatusBadge, Table, Td, Textarea, Th, clsx } from '@/components/ui';
import {
  InvoiceTypeBadge, PAYMENT_METHODS, paymentMethodLabel, RequestLinkActions, SendRequestButton, isOverdue,
  type InvoiceRow, type PaymentRequestRow, type PaymentRow,
} from '@/app/(app)/finance/_components/finance-kit';

interface Milestone { id: string; sort: number; nameAr: string; nameEn: string | null; percent: string; amount: string; paidAmount: string; dueDate: string | null; status: string; trigger: string }
interface CoMilestone extends Milestone { changeOrder: string | null }
interface Billing {
  contract: { id: string; number: string; status: string; total: string; partyId: string | null };
  milestones: Milestone[];
  changeOrderMilestones?: CoMilestone[];
  changeOrders?: { rows: { id: string; number: string; description: string; status: string; amountDelta: string; milestoneId: string | null }[]; approvedTotal: string; paid: string; adjustedTotal: string };
  requests: PaymentRequestRow[];
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  summary: { total: string; paid: string; remaining: string; adjustedTotal?: string; credited?: string };
  nextMilestoneId: string | null;
}

const OPEN = ['draft', 'sent', 'partially_paid'];
const fixed = (halalas: number) => (halalas / 100).toFixed(2);

export function BillingPanel({ contractId }: { contractId: string }) {
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing', contractId], queryFn: () => api.get<Billing>(`/finance/contracts/${contractId}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['billing', contractId] });

  const [requestFor, setRequestFor] = useState<Milestone | null>(null);
  const [payFor, setPayFor] = useState<PaymentRequestRow | null>(null);
  const [cancelFor, setCancelFor] = useState<PaymentRequestRow | null>(null);
  const [creditFor, setCreditFor] = useState<InvoiceRow | null>(null);

  if (q.isLoading) return <Card title={bi('الفوترة والمدفوعات', 'Billing & payments')}><Spinner /></Card>;
  if (q.error || !q.data) return <Card title={bi('الفوترة والمدفوعات', 'Billing & payments')}><ErrorBox error={q.error ?? new Error(bi('تعذر تحميل بيانات الفوترة', 'Could not load billing data'))} /></Card>;
  const d = q.data;
  const totalH = h(d.summary.total);
  const paidH = h(d.summary.paid);
  const creditedH = h(d.summary.credited ?? '0');
  const pct = totalH > 0 ? Math.min(100, Math.round(((paidH + creditedH) / totalH) * 100)) : 0;
  const signed = ['signed', 'active', 'completed'].includes(d.contract.status);
  const lastId = d.milestones[d.milestones.length - 1]?.id;
  const coMs = d.changeOrderMilestones ?? [];
  const coLabel = new Map(coMs.map((m) => [m.id, m.changeOrder ? bi(`أمر تغيير ${m.changeOrder}`, `Change order ${m.changeOrder}`) : m.nameAr]));
  const msName = new Map(d.milestones.map((m) => [m.id, m.nameAr]));
  const hasCo = !!d.changeOrders && h(d.changeOrders.approvedTotal) !== 0;
  const reqNumber = new Map(d.requests.map((r) => [r.id, r.number]));
  const canWrite = can('billing.write');
  const todayStr = today();

  return (
    <div className="space-y-4">
      <Card title={bi('الفوترة والمدفوعات', 'Billing & payments')}>
        <p className="mb-4 rounded-lg bg-tint/60 px-3 py-2 text-xs leading-relaxed text-gold-dark">
          {bi('اطلب كل دفعة حسب الجدول ← كل دفعة مقدمة تُستلم تُصدر فاتورة دفعة مقدمة (386) شاملة الضريبة ← الدفعة الأخيرة تُصدر الفاتورة الضريبية النهائية (388) للعقد كاملًا مخصومًا منها الدفعات المقدمة ويُطلب رصيدها — والتصحيح بإشعار دائن (381) فقط. أوامر التغيير تُفوتر منفصلة: فاتورة 388 مستقلة لكل أمر تغيير مدفوع، أو إشعار دائن للتخفيض.', 'Request each payment per the schedule → each advance payment received issues an advance (prepayment) invoice (386) incl. VAT → the last payment issues the final tax invoice (388) for the whole contract minus the advance payments, and its balance is requested — corrections only by credit note (381). Change orders are billed separately: a separate 388 invoice per paid change order, or a credit note for a reduction.')}
        </p>
        {hasCo && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/40 bg-white px-3 py-2 text-sm">
            <span>{bi('قيمة العقد شاملة أوامر التغيير:', 'Contract value incl. change orders:')} <b className="text-gold-dark"><Money value={d.changeOrders!.adjustedTotal} fixed /></b></span>
            <span className="text-xs text-muted">{bi('أوامر التغيير المعتمدة', 'Approved change orders')} <span className={clsx('num font-bold', h(d.changeOrders!.approvedTotal) < 0 ? 'text-danger' : 'text-ok')}>{h(d.changeOrders!.approvedTotal) < 0 ? '−' : '+'}{money(Math.abs(h(d.changeOrders!.approvedTotal)), { fixed: true })}</span> · {bi('المحصّل منها', 'collected')} <Money value={d.changeOrders!.paid} fixed /></span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div><div className="text-xs font-bold text-muted">{bi('قيمة العقد', 'Contract value')}</div><div className="mt-0.5 text-xl font-extrabold text-primary"><Money value={d.summary.total} fixed /></div></div>
          <div><div className="text-xs font-bold text-muted">{bi('المحصّل', 'Collected')}</div><div className="mt-0.5 text-xl font-extrabold text-ok"><Money value={d.summary.paid} fixed /></div></div>
          <div><div className="text-xs font-bold text-muted">{bi('المتبقي', 'Remaining')}</div><div className={clsx('mt-0.5 text-xl font-extrabold', h(d.summary.remaining) > 0 ? 'text-gold-dark' : 'text-ok')}><Money value={d.summary.remaining} fixed /></div>{creditedH > 0 && <div className="mt-0.5 text-[11px] text-muted">{bi('بعد خصم إشعارات دائنة على الدفعات المقدمة:', 'After credit notes on advance payments:')} <span className="num font-bold">{money(creditedH, { fixed: true })}</span></div>}</div>
        </div>
        <div className="mt-3">
          <div className="h-2.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-muted"><span className="num">{pct}%</span> {bi('محصّل', 'collected')}</div>
        </div>
        {!signed && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{bi('لا يمكن طلب الدفعات قبل توقيع العقد.', 'Payments cannot be requested before the contract is signed.')}</div>}
      </Card>

      <Card title={bi('جدول الدفعات', 'Payment schedule')} padded={false}>
        {!d.milestones.length ? <Empty title={bi('لا يوجد جدول دفعات لهذا العقد', 'This contract has no payment schedule')} /> : (
          <Table>
            <thead><tr><Th>#</Th><Th>{bi('الدفعة', 'Payment')}</Th><Th>{bi('النسبة', 'Percent')}</Th><Th>{bi('المبلغ', 'Amount')}</Th><Th>{bi('المدفوع', 'Paid')}</Th><Th>{bi('الاستحقاق', 'Due')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th /></tr></thead>
            <tbody>
              {d.milestones.map((m) => {
                const open = d.requests.find((r) => r.milestoneId === m.id && OPEN.includes(r.status));
                const canRequest = canWrite && signed && !open && m.status !== 'paid';
                return (
                  <tr key={m.id} className={clsx(m.id === d.nextMilestoneId && 'bg-tint/40')}>
                    <Td className="num text-muted">{m.sort}</Td>
                    <Td className="font-bold">{locale === 'en' && m.nameEn ? m.nameEn : m.nameAr}{m.id === lastId && <div className="text-[11px] font-normal text-muted">{bi('الدفعة الأخيرة — تُصدر الفاتورة النهائية 388', 'Last payment — issues the final invoice 388')}</div>}</Td>
                    <Td className="num">{Number(m.percent).toLocaleString('en', { maximumFractionDigits: 2 })}%</Td>
                    <Td><Money value={m.amount} fixed /></Td>
                    <Td><Money value={m.paidAmount} fixed className={h(m.paidAmount) > 0 ? 'text-ok' : 'text-muted'} /></Td>
                    <Td className="num text-xs">{date(m.dueDate)}</Td>
                    <Td><StatusBadge status={m.status} /></Td>
                    <Td className="text-end">
                      {canRequest && <Button size="sm" variant={m.id === d.nextMilestoneId ? 'primary' : 'outline'} icon={<HandCoins className="size-3.5" />} onClick={() => setRequestFor(m)}>{bi('طلب الدفعة', 'Request payment')}</Button>}
                      {open && <span className="text-xs text-muted">{bi('طلب', 'Request')} <span className="num">{open.number}</span></span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {coMs.length > 0 && (
        <Card title={bi('فوترة أوامر التغيير', 'Change order billing')} padded={false}>
          <Table>
            <thead><tr><Th>{bi('أمر التغيير', 'Change order')}</Th><Th>{bi('المبلغ', 'Amount')}</Th><Th>{bi('المدفوع', 'Paid')}</Th><Th>{bi('الاستحقاق', 'Due')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th /></tr></thead>
            <tbody>
              {coMs.map((m) => {
                const open = d.requests.find((r) => r.milestoneId === m.id && OPEN.includes(r.status));
                const negative = h(m.amount) < 0;
                const canRequest = canWrite && signed && !open && !negative && m.status === 'pending';
                const inv = d.invoices.find((i) => i.milestoneId === m.id);
                return (
                  <tr key={m.id}>
                    <Td className="font-bold"><span className="rounded bg-tint px-1.5 py-0.5 text-xs text-gold-dark">{coLabel.get(m.id)}</span>
                      <div className="text-[11px] font-normal text-muted">{negative ? bi('تخفيض — إشعار دائن (381)', 'Reduction — credit note (381)') : bi('فاتورة ضريبية مستقلة (388) عند الدفع', 'Separate tax invoice (388) on payment')}</div></Td>
                    <Td><Money value={m.amount} fixed className={negative ? 'text-danger' : undefined} /></Td>
                    <Td>{negative ? <span className="text-muted">—</span> : <Money value={m.paidAmount} fixed className={h(m.paidAmount) > 0 ? 'text-ok' : 'text-muted'} />}</Td>
                    <Td className="num text-xs">{date(m.dueDate)}</Td>
                    <Td><StatusBadge status={m.status} /></Td>
                    <Td className="text-end">
                      {canRequest && <Button size="sm" variant="outline" icon={<HandCoins className="size-3.5" />} onClick={() => setRequestFor(m)}>{bi('طلب الدفعة', 'Request payment')}</Button>}
                      {open && <span className="text-xs text-muted">{bi('طلب', 'Request')} <span className="num">{open.number}</span></span>}
                      {inv && <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => openFile(`/finance/invoices/${inv.id}/pdf`)}><span className="num">{inv.number}</span></Button>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <Card title={bi('طلبات الدفع', 'Payment requests')} padded={false}>
        {!d.requests.length ? <Empty icon={<Receipt className="size-7" />} title={bi('لم تُطلب أي دفعة بعد', 'No payment requested yet')} hint={bi('ابدأ بطلب الدفعة الأولى من جدول الدفعات.', 'Start by requesting the first payment from the payment schedule.')} /> : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('الدفعة', 'Payment')}</Th><Th>{bi('المبلغ', 'Amount')}</Th><Th>{bi('المدفوع', 'Paid')}</Th><Th>{bi('الاستحقاق', 'Due')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('إجراءات', 'Actions')}</Th></tr></thead>
            <tbody>
              {d.requests.map((r) => {
                const remaining = h(r.amount) - h(r.paidAmount);
                const overdue = isOverdue(r, todayStr);
                return (
                  <tr key={r.id}>
                    <Td className="num font-bold">{r.number}</Td>
                    <Td>{r.milestoneId && coLabel.has(r.milestoneId) ? <span className="rounded bg-tint px-1.5 py-0.5 text-xs font-bold text-gold-dark">{coLabel.get(r.milestoneId)}</span> : (r.milestoneId && msName.get(r.milestoneId)) ?? '—'}</Td>
                    <Td><Money value={r.amount} fixed /></Td>
                    <Td><Money value={r.paidAmount} fixed className={h(r.paidAmount) > 0 ? 'text-ok' : 'text-muted'} /></Td>
                    <Td className={clsx('num text-xs', overdue && 'font-bold text-danger')}>{date(r.dueDate)}{overdue && <span className="ms-1">{bi('(متأخر)', '(overdue)')}</span>}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        {canWrite && <SendRequestButton pr={r} onDone={refresh} />}
                        <RequestLinkActions pr={r} />
                        {can('payment.record') && OPEN.includes(r.status) && remaining > 0 && <Button size="sm" variant="gold" icon={<Banknote className="size-3.5" />} onClick={() => setPayFor(r)}>{bi('تسجيل دفعة', 'Record payment')}</Button>}
                        {canWrite && OPEN.includes(r.status) && h(r.paidAmount) === 0 && <Button size="sm" variant="ghost" className="text-danger" icon={<Ban className="size-3.5" />} onClick={() => setCancelFor(r)}>{bi('إلغاء', 'Cancel')}</Button>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={bi('الفواتير', 'Invoices')} padded={false}>
        {!d.invoices.length ? <Empty icon={<ReceiptText className="size-7" />} title={bi('لا توجد فواتير بعد', 'No invoices yet')} hint={bi('تُصدر الفواتير تلقائيًا عند تسجيل الدفعات.', 'Invoices are issued automatically when payments are recorded.')} /> : (
          <Table>
            <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('الخاضع للضريبة', 'Taxable')}</Th><Th>{bi('الضريبة', 'VAT')}</Th><Th>{bi('الإجمالي', 'Total')}</Th><Th>{bi('دفعات مقدمة', 'Advance payments')}</Th><Th>{bi('الرصيد', 'Balance')}</Th><Th>{bi('زاتكا', 'ZATCA')}</Th><Th /></tr></thead>
            <tbody>
              {d.invoices.map((i) => (
                <tr key={i.id} className={clsx(i.status === 'cancelled' && 'opacity-50')}>
                  <Td className="num font-bold">{i.number}</Td>
                  <Td><InvoiceTypeBadge code={i.typeCode} />{i.milestoneId && coLabel.has(i.milestoneId) && <div className="mt-0.5 text-[11px] font-bold text-gold-dark">{coLabel.get(i.milestoneId)}</div>}</Td>
                  <Td className="num text-xs">{date(i.issueDate)}</Td>
                  <Td><Money value={i.taxable} fixed /></Td>
                  <Td><Money value={i.vatAmount} fixed /></Td>
                  <Td className="font-bold"><Money value={i.total} fixed /></Td>
                  <Td>{h(i.prepaidAmount) > 0 ? <Money value={i.prepaidAmount} fixed /> : <span className="text-muted">—</span>}</Td>
                  <Td><Money value={i.balanceDue} fixed className={h(i.balanceDue) > 0 ? 'font-bold text-gold-dark' : 'text-ok'} /></Td>
                  <Td><StatusBadge status={i.zatcaStatus} /></Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => openFile(`/finance/invoices/${i.id}/pdf`)}>PDF</Button>
                      {can('invoice.issue') && i.typeCode !== '381' && i.status !== 'cancelled' && <Button size="sm" variant="ghost" onClick={() => setCreditFor(i)}>{bi('إشعار دائن', 'Credit note')}</Button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={bi('المدفوعات المستلمة', 'Payments received')} padded={false}>
        {!d.payments.length ? <Empty title={bi('لم تُستلم أي مدفوعات بعد', 'No payments received yet')} /> : (
          <Table>
            <thead><tr><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('المبلغ', 'Amount')}</Th><Th>{bi('الطريقة', 'Method')}</Th><Th>{bi('طلب الدفع', 'Payment request')}</Th><Th>{bi('المرجع', 'Reference')}</Th><Th>{bi('سند القبض', 'Receipt')}</Th></tr></thead>
            <tbody>
              {d.payments.map((p) => (
                <tr key={p.id}>
                  <Td className="num text-xs">{date(p.paidOn)}</Td>
                  <Td className="font-bold text-ok"><Money value={p.amount} fixed /></Td>
                  <Td>{paymentMethodLabel(p.method, locale)}</Td>
                  <Td className="num text-xs">{(p.paymentRequestId && reqNumber.get(p.paymentRequestId)) ?? '—'}</Td>
                  <Td className="num max-w-[14rem] truncate text-xs text-muted" title={p.reference ?? undefined}>{displayRef(p.reference)}</Td>
                  <Td className="num text-xs text-muted">{p.erpName}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog open={!!requestFor} onClose={() => setRequestFor(null)} title={bi(`طلب الدفعة: ${requestFor?.nameAr ?? ''}`, `Request payment: ${(requestFor?.nameEn || requestFor?.nameAr) ?? ''}`)}>
        {requestFor && <RequestForm key={requestFor.id} milestone={requestFor} isFinal={requestFor.id === lastId} onClose={() => setRequestFor(null)} onDone={refresh} />}
      </Dialog>
      <Dialog open={!!payFor} onClose={() => setPayFor(null)} title={bi(`تسجيل دفعة — ${payFor?.number ?? ''}`, `Record payment — ${payFor?.number ?? ''}`)}>
        {payFor && <RecordPaymentForm key={payFor.id} pr={payFor} onClose={() => setPayFor(null)} onDone={refresh} />}
      </Dialog>
      <Dialog open={!!cancelFor} onClose={() => setCancelFor(null)} title={bi(`إلغاء طلب الدفع ${cancelFor?.number ?? ''}`, `Cancel payment request ${cancelFor?.number ?? ''}`)}>
        {cancelFor && <CancelForm key={cancelFor.id} pr={cancelFor} onClose={() => setCancelFor(null)} onDone={refresh} />}
      </Dialog>
      <Dialog open={!!creditFor} onClose={() => setCreditFor(null)} title={bi(`إشعار دائن على الفاتورة ${creditFor?.number ?? ''}`, `Credit note on invoice ${creditFor?.number ?? ''}`)}>
        {creditFor && <CreditNoteForm key={creditFor.id} invoice={creditFor} onClose={() => setCreditFor(null)} onDone={refresh} />}
      </Dialog>
    </div>
  );
}

function FormFooter({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const { bi } = useI18n();
  return (
    <div className="-mx-4 -mb-4 mt-4 flex justify-end gap-2 border-t border-line bg-tint/40 px-4 py-3">
      <Button type="button" variant="ghost" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button>
      {children}
    </div>
  );
}

function RequestForm({ milestone, isFinal, onClose, onDone }: { milestone: Milestone; isFinal: boolean; onClose: () => void; onDone: () => void }) {
  const { bi } = useI18n();
  const [dueDate, setDueDate] = useState(milestone.dueDate ?? '');
  const [send, setSend] = useState<'' | 'whatsapp' | 'email'>('whatsapp');
  const m = useMutation({
    mutationFn: () => api.post<PaymentRequestRow>(`/finance/milestones/${milestone.id}/request`, { dueDate: dueDate || null, send: send || null }),
    onSuccess: (pr) => { toast.success(bi(`أُنشئ طلب الدفع ${pr.number}${send ? ' وأُرسل للعميل' : ''}`, `Payment request ${pr.number} created${send ? ' and sent to the customer' : ''}`)); onClose(); onDone(); },
    onError: (e: Error) => { toast.error(e.message); onDone(); },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="space-y-3">
        <div className="rounded-lg bg-tint/60 px-3 py-2 text-sm">
          {bi('المبلغ المطلوب:', 'Amount requested:')} <b><Money value={h(milestone.amount) - h(milestone.paidAmount)} fixed /></b>
          {isFinal && <div className="mt-1 text-xs text-gold-dark">{bi('هذه الدفعة الأخيرة: ستُصدر الفاتورة الضريبية النهائية (388) أولًا، ويُطلب رصيدها بعد خصم الدفعات المقدمة.', 'This is the last payment: the final tax invoice (388) is issued first, and its balance is requested after deducting the advance payments.')}</div>}
        </div>
        <Field label={bi('تاريخ الاستحقاق', 'Due date')} hint={bi('اتركه فارغًا: اليوم + مدة السداد للعميل، مُرحّلًا إلى أول يوم عمل حسب تقويم المنشأة.', 'Leave empty: today + the customer’s payment terms, rolled to the next business day per the company calendar.')}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label={bi('إرسال للعميل', 'Send to customer')}>
          <Select value={send} onChange={(e) => setSend(e.target.value as '' | 'whatsapp' | 'email')}>
            <option value="whatsapp">{bi('واتساب', 'WhatsApp')}</option>
            <option value="email">{bi('البريد الإلكتروني', 'E-mail')}</option>
            <option value="">{bi('لا ترسل الآن (مسودة)', 'Don’t send now (draft)')}</option>
          </Select>
        </Field>
      </div>
      <FormFooter onClose={onClose}><Button loading={m.isPending} icon={<HandCoins className="size-4" />}>{bi('إنشاء الطلب', 'Create request')}</Button></FormFooter>
    </form>
  );
}

function RecordPaymentForm({ pr, onClose, onDone }: { pr: PaymentRequestRow; onClose: () => void; onDone: () => void }) {
  const { bi, locale } = useI18n();
  const remaining = h(pr.amount) - h(pr.paidAmount);
  const [amount, setAmount] = useState(fixed(remaining));
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ invoice: { number: string } | null; changeOrderInvoice?: { number: string } | null; duplicate?: boolean }>(`/finance/payment-requests/${pr.id}/payments`, { amount: amount.trim(), paidOn, method, reference: reference.trim() || null }),
    onSuccess: (r) => {
      if (r.duplicate) toast.info(bi('هذه الدفعة مسجلة مسبقًا', 'This payment is already recorded'));
      else if (r.changeOrderInvoice) toast.success(bi(`سُجلت الدفعة وخُصصت على فاتورة أمر التغيير ${r.changeOrderInvoice.number} (388)`, `Payment recorded and allocated to change order invoice ${r.changeOrderInvoice.number} (388)`));
      else toast.success(r.invoice ? bi(`سُجلت الدفعة وأُصدرت فاتورة الدفعة المقدمة ${r.invoice.number}`, `Payment recorded and advance invoice ${r.invoice.number} issued`) : bi('سُجلت الدفعة وخُصصت على الفاتورة النهائية', 'Payment recorded and allocated to the final invoice'));
      onClose();
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="space-y-3">
        <div className="rounded-lg bg-tint/60 px-3 py-2 text-sm">{bi('المتبقي على الطلب:', 'Remaining on request:')} <b><Money value={remaining} fixed /></b></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bi('المبلغ المستلم (شامل الضريبة)', 'Amount received (incl. VAT)')}><Input inputMode="decimal" className="num" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={bi('تاريخ الاستلام', 'Date received')}><Input type="date" required value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <Field label={bi('طريقة الدفع', 'Payment method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.keys(PAYMENT_METHODS).map((k) => <option key={k} value={k}>{paymentMethodLabel(k, locale)}</option>)}
            </Select>
          </Field>
          <Field label={bi('المرجع', 'Reference')} hint={bi('رقم الحوالة أو الشيك', 'Transfer or cheque number')}><Input value={reference} maxLength={140} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-muted">{bi('تأكد من وصول المبلغ إلى الحساب البنكي قبل التسجيل — يُصدر النظام الفاتورة فورًا ولا يمكن تعديلها لاحقًا.', 'Make sure the amount has reached the bank account before recording — the system issues the invoice immediately and it cannot be edited later.')}</p>
      </div>
      <FormFooter onClose={onClose}><Button loading={m.isPending} icon={<Banknote className="size-4" />}>{bi('تسجيل الدفعة', 'Record payment')}</Button></FormFooter>
    </form>
  );
}

function CancelForm({ pr, onClose, onDone }: { pr: PaymentRequestRow; onClose: () => void; onDone: () => void }) {
  const { bi } = useI18n();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/finance/payment-requests/${pr.id}/cancel`, { reason: reason.trim() }),
    onSuccess: () => { toast.success(bi(`أُلغي طلب الدفع ${pr.number}`, `Payment request ${pr.number} cancelled`)); onClose(); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="mb-3 text-sm text-muted">{bi('ستعود الدفعة إلى حالة «قادم» ويمكن طلبها لاحقًا، ويتوقف رابط الدفع الحالي.', 'The payment returns to “Upcoming” and can be requested later; the current payment link stops working.')}</p>
      <Field label={bi('سبب الإلغاء', 'Cancellation reason')}><Textarea rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <FormFooter onClose={onClose}><Button variant="danger" disabled={!reason.trim()} loading={m.isPending}>{bi('إلغاء الطلب', 'Cancel request')}</Button></FormFooter>
    </form>
  );
}

function CreditNoteForm({ invoice, onClose, onDone }: { invoice: InvoiceRow; onClose: () => void; onDone: () => void }) {
  const { bi } = useI18n();
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<InvoiceRow>(`/finance/invoices/${invoice.id}/credit-note`, { reason: reason.trim(), amount: amount.trim() || null }),
    onSuccess: (r) => { toast.success(bi(`أُصدر الإشعار الدائن ${r.number}`, `Credit note ${r.number} issued`)); onClose(); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{bi('الفواتير الصادرة لا تُعدّل — التصحيح يكون بإشعار دائن مرتبط بالفاتورة الأصلية ويُبلّغ إلى زاتكا.', 'Issued invoices cannot be edited — corrections are made with a credit note linked to the original invoice and reported to ZATCA.')}</p>
        <Field label={bi('السبب', 'Reason')}><Textarea rows={3} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={bi('مثال: خصم متفق عليه، إرجاع جهاز…', 'e.g. agreed discount, returned device…')} /></Field>
        <Field label={bi('المبلغ (شامل الضريبة)', 'Amount (incl. VAT)')} hint={<>{bi('اتركه فارغًا لإلغاء كامل الفاتورة', 'Leave empty to credit the full invoice')} (<span className="num">{money(invoice.total, { fixed: true })}</span> {bi('ر.س', 'SAR')})</>}>
          <Input inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <FormFooter onClose={onClose}><Button variant="danger" disabled={reason.trim().length < 3} loading={m.isPending}>{bi('إصدار الإشعار الدائن (381)', 'Issue credit note (381)')}</Button></FormFooter>
    </form>
  );
}

/** Payment references carry an idempotency prefix ("manual:<request id>:<what the user typed>"); show the user's part. */
function displayRef(ref: string | null | undefined): string {
  if (!ref) return '—';
  const m = /^manual:[0-9a-f-]{36}:?(.*)$/i.exec(ref);
  return m ? m[1] || '—' : ref;
}

