'use client';
/** Change orders on a signed contract: list, create/edit (+/− quantities), approval workflow and billing. */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ChevronDown, FileText, FilePlus2, HandCoins, Minus, Pencil, Plus, Send, Signature, Trash2, XCircle } from 'lucide-react';
import { lineAmountHalalas, percentOf, VAT_RATE } from '@mmc/domain';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, dateTime, h } from '@/lib/format';
import { Badge, Button, Card, clsx, Dialog, Empty, ErrorBox, Field, Input, Money, Select, Spinner, StatusBadge, Table, Td, Textarea, Th } from '@/components/ui';
import { ConfirmDialog, errMsg, NumInput, ReasonDialog } from '../../quotes/_components/common';
import { newKey } from '../../quotes/_components/types';
import { CO_STATUS, type ChangeOrderRow, type ChangeOrderView, type ContractView } from './types';

interface CoList { rows: ChangeOrderRow[]; contract: { id: string; number: string; total: string; status: string }; approvedTotal: string; adjustedTotal: string }
interface DraftLine { key: string; code: string; description: string; qty: string; unitPrice: string }

const num = (v: string) => {
  const t = v.trim();
  return t && Number.isFinite(Number(t)) ? t : '0';
};

/** Same rule as the API: signed subtotal, VAT on the absolute subtotal (company registered + contract VAT on). */
export function coTotals(lines: { qty: string; unitPrice: string }[], vatApplies: boolean) {
  const subtotal = lines.reduce((s, l) => s + lineAmountHalalas(num(l.unitPrice), num(l.qty)), 0);
  const sign = subtotal < 0 ? -1 : 1;
  const vat = vatApplies ? sign * percentOf(Math.abs(subtotal), VAT_RATE) : 0;
  return { subtotal, vat, total: subtotal + vat };
}

export function Delta({ value, className }: { value: number | string; className?: string }) {
  const v = h(value);
  return (
    <span className={clsx('inline-flex items-center gap-0.5 font-bold', v < 0 ? 'text-danger' : v > 0 ? 'text-ok' : 'text-muted', className)}>
      <span className="num">{v < 0 ? '−' : v > 0 ? '+' : ''}</span><Money value={Math.abs(v)} fixed />
    </span>
  );
}

export function CoStatusBadge({ status }: { status: string }) {
  const { locale } = useI18n();
  const s = CO_STATUS[status];
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold', s?.cls ?? 'bg-gray-100 text-gray-700')}>{(s && (locale === 'en' ? s.labelEn : s.label)) ?? status}</span>;
}

type Action = 'submit' | 'approve' | 'reject' | 'sign' | 'bill' | 'cancel';

export function ChangeOrdersCard({ contract }: { contract: ContractView }) {
  const qc = useQueryClient();
  const { me, can } = useMe();
  const { bi, locale } = useI18n();
  const vatApplies = (me?.company?.vatRegistered ?? true) && contract.vatOn;
  const q = useQuery({ queryKey: ['change-orders', contract.id], queryFn: () => api.get<CoList>(`/change-orders?contractId=${contract.id}`) });
  const [edit, setEdit] = useState<ChangeOrderRow | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [act, setAct] = useState<{ co: ChangeOrderRow; action: Action } | null>(null);
  const [busy, setBusy] = useState(false);

  const canWrite = can('contract.write');
  const canBill = can('billing.write');
  const contractOpen = ['signed', 'active'].includes(contract.status);
  const isOwner = !!me?.user.roles.includes('owner');
  const canDecide = (co: ChangeOrderRow) => (can('contract.sign') || can('quote.approve')) && (co.createdBy !== me?.user.id || isOwner);

  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['change-orders', contract.id] });
    void qc.invalidateQueries({ queryKey: ['billing', contract.id] });
    if (id) void qc.invalidateQueries({ queryKey: ['change-order', id] });
  };

  const run = async (co: ChangeOrderRow, action: Action, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await api.post<any>(`/change-orders/${co.id}/${action}`, body);
      if (action === 'bill') {
        if (r.paymentRequest) toast.success(bi(`أُنشئ طلب الدفع ${r.paymentRequest.number} لأمر التغيير ${co.number}`, `Payment request ${r.paymentRequest.number} created for change order ${co.number}`));
        else if (r.invoice) toast.success(bi(`أُصدر الإشعار الدائن ${r.invoice.number} (381) لأمر التغيير ${co.number}`, `Credit note ${r.invoice.number} (381) issued for change order ${co.number}`));
      } else toast.success(`${co.number}: ${(CO_STATUS[r.status] && (locale === 'en' ? CO_STATUS[r.status]!.labelEn : CO_STATUS[r.status]!.label)) ?? r.status}`);
      setAct(null);
      refresh(co.id);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const d = q.data;
  return (
    <Card
      title={<span className="flex items-center gap-2">{bi('أوامر التغيير', 'Change orders')} {d && d.rows.length > 0 && <span className="rounded-full bg-tint px-2 text-[11px] text-gold-dark">{d.rows.length}</span>}</span>}
      padded={false}
      actions={canWrite && contractOpen && <Button size="sm" variant="outline" icon={<FilePlus2 className="size-3.5" />} onClick={() => setEdit('new')}>{bi('أمر تغيير جديد', 'New change order')}</Button>}
    >
      {q.isLoading ? <Spinner /> : q.error || !d ? <div className="p-4"><ErrorBox error={q.error} /></div> : (
        <>
          <div className="grid gap-3 border-b border-line px-4 py-3 sm:grid-cols-3">
            <div><div className="text-xs font-bold text-muted">{bi('قيمة العقد الأصلية', 'Original contract value')}</div><Money value={d.contract.total} fixed className="text-base font-extrabold text-primary" /></div>
            <div><div className="text-xs font-bold text-muted">{bi('أوامر التغيير المعتمدة', 'Approved change orders')}</div><Delta value={d.approvedTotal} className="text-base" /></div>
            <div><div className="text-xs font-bold text-muted">{bi('قيمة العقد شاملة أوامر التغيير', 'Contract value incl. change orders')}</div><Money value={d.adjustedTotal} fixed className="text-base font-extrabold text-gold-dark" /></div>
          </div>
          {d.rows.length === 0 ? <Empty title={bi('لا توجد أوامر تغيير', 'No change orders')} hint={contractOpen ? bi('أي إضافة أو حذف بعد توقيع العقد يتم بأمر تغيير يُعتمد ثم يُفوتر.', 'Any addition or removal after signing goes through a change order that is approved and then billed.') : undefined} /> : (
            <Table>
              <thead><tr><Th className="w-8" /><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('الوصف', 'Description')}</Th><Th>{bi('قبل الضريبة', 'Before VAT')}</Th><Th>{bi('الضريبة', 'VAT')}</Th><Th>{bi('الإجمالي', 'Total')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('إجراءات', 'Actions')}</Th></tr></thead>
              <tbody>
                {d.rows.map((co) => {
                  const isOpen = open === co.id;
                  const actions: { a: Action | 'edit'; label: string; icon: ReactNode; variant?: 'primary' | 'outline' | 'gold' | 'ghost' | 'danger' }[] = [];
                  if (canWrite && ['draft', 'rejected'].includes(co.status)) actions.push({ a: 'edit', label: bi('تعديل', 'Edit'), icon: <Pencil className="size-3.5" />, variant: 'ghost' });
                  if (canWrite && co.status === 'draft') actions.push({ a: 'submit', label: bi('إرسال للاعتماد', 'Submit for approval'), icon: <Send className="size-3.5" />, variant: 'primary' });
                  if (co.status === 'pending_approval' && canDecide(co)) {
                    actions.push({ a: 'approve', label: bi('اعتماد', 'Approve'), icon: <CheckCircle2 className="size-3.5" />, variant: 'primary' });
                    actions.push({ a: 'reject', label: bi('رفض', 'Reject'), icon: <XCircle className="size-3.5" />, variant: 'ghost' });
                  }
                  if (canWrite && co.status === 'approved') actions.push({ a: 'sign', label: bi('موافقة العميل', 'Customer approval'), icon: <Signature className="size-3.5" />, variant: 'outline' });
                  if (canBill && ['approved', 'signed'].includes(co.status)) actions.push({ a: 'bill', label: h(co.amountDelta) < 0 ? bi('إصدار إشعار دائن', 'Issue credit note') : bi('فوترة', 'Bill'), icon: <HandCoins className="size-3.5" />, variant: 'gold' });
                  if (canWrite && ['draft', 'pending_approval', 'approved', 'signed', 'rejected'].includes(co.status)) actions.push({ a: 'cancel', label: bi('إلغاء', 'Cancel'), icon: <Ban className="size-3.5" />, variant: 'ghost' });
                  return (
                    <Fragment key={co.id}>
                      <tr className={clsx('align-top', isOpen && 'bg-tint/40')}>
                        <Td><button type="button" onClick={() => setOpen(isOpen ? null : co.id)} className="rounded p-1 text-muted hover:bg-black/5" aria-expanded={isOpen} aria-label={bi('التفاصيل', 'Details')}><ChevronDown className={clsx('size-4 transition', isOpen && 'rotate-180')} /></button></Td>
                        <Td className="num whitespace-nowrap font-bold" ><span dir="ltr">{co.number}</span></Td>
                        <Td className="max-w-[18rem]"><div className="truncate text-sm">{co.description}</div><div className="num text-[11px] text-muted">{date(co.createdAt)}</div></Td>
                        <Td><Delta value={co.subtotalDelta} /></Td>
                        <Td>{h(co.vatDelta) ? <Delta value={co.vatDelta} /> : <span className="text-muted">—</span>}</Td>
                        <Td><Delta value={co.amountDelta} /></Td>
                        <Td><CoStatusBadge status={co.status} /></Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-1">
                            {actions.map((x) => (
                              <Button key={x.a} size="sm" variant={x.variant ?? 'outline'} className={x.a === 'cancel' || x.a === 'reject' ? 'text-danger' : undefined} icon={x.icon}
                                onClick={() => (x.a === 'edit' ? setEdit(co) : setAct({ co, action: x.a }))}>{x.label}</Button>
                            ))}
                          </div>
                        </Td>
                      </tr>
                      {isOpen && <tr><Td colSpan={8} className="bg-gray-50/60"><CoDetails id={co.id} /></Td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          )}
        </>
      )}

      {edit && <CoDialog contract={contract} co={edit === 'new' ? null : edit} vatApplies={vatApplies} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); setOpen(id); refresh(id); }} />}
      {act && act.action === 'reject' && (
        <ReasonDialog open title={bi(`رفض أمر التغيير ${act.co.number}`, `Reject change order ${act.co.number}`)} label={bi('سبب الرفض', 'Rejection reason')} required danger confirmLabel={bi('رفض', 'Reject')} loading={busy} onConfirm={(r) => void run(act.co, 'reject', { reason: r })} onClose={() => setAct(null)} />
      )}
      {act && act.action === 'cancel' && (
        <ReasonDialog open title={bi(`إلغاء أمر التغيير ${act.co.number}`, `Cancel change order ${act.co.number}`)} label={bi('سبب الإلغاء', 'Cancellation reason')} required danger confirmLabel={bi('إلغاء أمر التغيير', 'Cancel change order')} loading={busy} onConfirm={(r) => void run(act.co, 'cancel', { reason: r })} onClose={() => setAct(null)} />
      )}
      {act && act.action === 'bill' && <BillDialog co={act.co} busy={busy} onConfirm={(dueDate) => void run(act.co, 'bill', { dueDate: dueDate || null })} onClose={() => setAct(null)} />}
      {act && ['submit', 'approve', 'sign'].includes(act.action) && (
        <ConfirmDialog open loading={busy} onClose={() => setAct(null)} onConfirm={() => void run(act.co, act.action)}
          title={act.action === 'submit' ? bi(`إرسال ${act.co.number} للاعتماد`, `Submit ${act.co.number} for approval`) : act.action === 'approve' ? bi(`اعتماد ${act.co.number}`, `Approve ${act.co.number}`) : bi(`تسجيل موافقة العميل على ${act.co.number}`, `Record customer approval of ${act.co.number}`)}
          confirmLabel={act.action === 'submit' ? bi('إرسال', 'Submit') : act.action === 'approve' ? bi('اعتماد', 'Approve') : bi('تسجيل الموافقة', 'Record approval')}
          message={act.action === 'submit'
            ? (locale === 'en'
              ? <>The change order of <Delta value={act.co.amountDelta} /> will be sent for approval by a manager who can sign contracts or approve quotes, and cannot be edited afterwards unless it is rejected.</>
              : <>سيُرسل أمر التغيير بقيمة <Delta value={act.co.amountDelta} /> لاعتماد مدير لديه صلاحية توقيع العقود أو اعتماد العروض، ولا يمكن تعديله بعد ذلك إلا إذا رُفض.</>)
            : act.action === 'approve'
              ? <>{bi('باعتماد أمر التغيير تصبح قيمة العقد شاملة أوامر التغيير مُحدّثة، ويمكن فوترته بعد ذلك.', 'Approving the change order updates the contract value incl. change orders, and it can then be billed.')}</>
              : <>{bi('يُسجَّل أن العميل وافق على أمر التغيير (خطوة اختيارية قبل الفوترة).', 'Records that the customer approved the change order (optional step before billing).')}</>}
        />
      )}
    </Card>
  );
}

function BillDialog({ co, busy, onConfirm, onClose }: { co: ChangeOrderRow; busy: boolean; onConfirm: (dueDate: string) => void; onClose: () => void }) {
  const { bi } = useI18n();
  const [dueDate, setDueDate] = useState('');
  const negative = h(co.amountDelta) < 0;
  return (
    <Dialog open onClose={onClose} title={negative ? bi(`إشعار دائن لأمر التغيير ${co.number}`, `Credit note for change order ${co.number}`) : bi(`فوترة أمر التغيير ${co.number}`, `Bill change order ${co.number}`)}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button variant={negative ? 'danger' : 'gold'} loading={busy} icon={<HandCoins className="size-4" />} onClick={() => onConfirm(dueDate)}>{negative ? bi('إصدار الإشعار الدائن (381)', 'Issue credit note (381)') : bi('إنشاء طلب الدفع', 'Create payment request')}</Button></>}>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg bg-tint/60 px-3 py-2">{bi('المبلغ:', 'Amount:')} <Delta value={co.amountDelta} /> <span className="text-xs text-muted">{bi('(شامل الضريبة)', '(incl. VAT)')}</span></div>
        {negative ? (
          <p className="leading-relaxed text-muted">{bi('يُصدر إشعار دائن (381) بالقيمة المطلقة على الفاتورة الضريبية النهائية (388) للعقد إن صدرت، وإلا على آخر فاتورة دفعة مقدمة (386). لا يُعدّل العقد الأصلي.', 'A credit note (381) for the absolute amount is issued against the contract’s final tax invoice (388) if issued, otherwise against the latest advance (prepayment) invoice (386). The original contract is not changed.')}</p>
        ) : (
          <>
            <p className="leading-relaxed text-muted">{bi('يُنشأ طلب دفع مستقل لأمر التغيير. عند استلام المبلغ تُصدر فاتورة ضريبية (388) منفصلة لبنود أمر التغيير — لا تُخصم من الفاتورة النهائية للعقد ولا تؤثر على جدول دفعاته.', 'A separate payment request is created for the change order. Once paid, a separate tax invoice (388) is issued for its items — it is not deducted from the contract’s final invoice and does not affect its payment schedule.')}</p>
            <Field label={bi('تاريخ الاستحقاق', 'Due date')} hint={bi('اتركه فارغًا: اليوم + مدة السداد للعميل، مُرحّلًا إلى أول يوم عمل.', 'Leave empty: today + the customer’s payment terms, rolled to the next business day.')}><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function CoDetails({ id }: { id: string }) {
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['change-order', id], queryFn: () => api.get<ChangeOrderView>(`/change-orders/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const co = q.data;
  return (
    <div className="space-y-3 py-1">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        {co.reason && <span>{bi('السبب:', 'Reason:')} <b className="text-ink">{co.reason}</b></span>}
        {co.createdByName && <span>{bi('أنشأه:', 'Created by:')} <b className="text-ink">{co.createdByName}</b> · <span className="num">{dateTime(co.createdAt)}</span></span>}
        {co.approvedByName && <span>{bi('اعتمده:', 'Approved by:')} <b className="text-ink">{co.approvedByName}</b> · <span className="num">{dateTime(co.approvedAt)}</span></span>}
        {co.signedAt && <span>{bi('وافق العميل:', 'Customer approved:')} <span className="num">{dateTime(co.signedAt)}</span></span>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-muted"><tr><th className="px-3 py-1.5 text-start">{bi('الرمز', 'Code')}</th><th className="px-3 py-1.5 text-start">{bi('الوصف', 'Description')}</th><th className="px-3 py-1.5 text-start">{bi('الكمية', 'Qty')}</th><th className="px-3 py-1.5 text-start">{bi('سعر الوحدة', 'Unit price')}</th><th className="px-3 py-1.5 text-end">{bi('المبلغ', 'Amount')}</th></tr></thead>
          <tbody>
            {co.lines.map((l, i) => (
              <tr key={i} className="border-t border-line/60">
                <td className="num px-3 py-1.5 text-xs font-bold text-primary" dir="ltr">{l.code}</td>
                <td className="px-3 py-1.5">{l.description}{Number(l.qty) < 0 && <Badge tone="red">{bi('حذف', 'Removal')}</Badge>}</td>
                <td className={clsx('num px-3 py-1.5', Number(l.qty) < 0 && 'text-danger')} dir="ltr">{Number(l.qty) > 0 ? `+${Number(l.qty)}` : Number(l.qty)}</td>
                <td className="px-3 py-1.5"><Money value={l.unitPrice} fixed /></td>
                <td className="px-3 py-1.5 text-end"><Delta value={lineAmountHalalas(l.unitPrice, l.qty)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(co.paymentRequests.length > 0 || co.invoices.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {co.paymentRequests.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1">{bi('طلب دفع', 'Payment request')} <b className="num" dir="ltr">{p.number}</b> <Money value={p.amount} fixed /> <StatusBadge status={p.status} />
              <button type="button" className="text-gold-dark hover:underline" onClick={() => openFile(`/finance/payment-requests/${p.id}/pdf`)}>PDF</button>
            </span>
          ))}
          {co.invoices.map((i) => (
            <span key={i.id} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1">{i.typeCode === '381' ? bi('إشعار دائن', 'Credit note') : bi('فاتورة ضريبية', 'Tax invoice')} <b className="num" dir="ltr">{i.number}</b> <span className="num text-muted">{i.typeCode}</span> <Money value={i.total} fixed />
              <button type="button" className="inline-flex items-center gap-0.5 text-gold-dark hover:underline" onClick={() => openFile(`/finance/invoices/${i.id}/pdf`)}><FileText className="size-3" />PDF</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CoDialog({ contract, co, vatApplies, onClose, onSaved }: { contract: ContractView; co: ChangeOrderRow | null; vatApplies: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const { t: tr, bi } = useI18n();
  const [description, setDescription] = useState(co?.description ?? '');
  const [reason, setReason] = useState(co?.reason ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() => (co?.lines.length ? co.lines.map((l) => ({ key: newKey(), code: l.code, description: l.description, qty: String(Number(l.qty)), unitPrice: String(Number(l.unitPrice)) })) : [{ key: newKey(), code: '', description: '', qty: '1', unitPrice: '' }]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const t = useMemo(() => coTotals(lines, vatApplies), [lines, vatApplies]);
  const setLine = (i: number, p: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const bump = (i: number, dir: 1 | -1) => setLines((ls) => ls.map((l, j) => {
    if (j !== i) return l;
    let n = Math.round((Number(l.qty) || 0) + dir);
    if (n === 0) n = dir;
    return { ...l, qty: String(n) };
  }));
  const fromContract = (idx: string) => {
    const src = contract.lines[Number(idx)];
    if (!src) return;
    setLines((ls) => [...ls.filter((l) => l.code || l.description || l.unitPrice), { key: newKey(), code: src.code, description: src.description, qty: '-1', unitPrice: String(Number(src.unitPrice)) }]);
  };
  const problems: string[] = [];
  if (!description.trim()) problems.push(bi('الوصف مطلوب', 'Description is required'));
  if (!lines.length) problems.push(bi('أضف بندًا واحدًا على الأقل', 'Add at least one line item'));
  if (lines.some((l) => !l.code.trim() || !l.description.trim())) problems.push(bi('كل بند يحتاج رمزًا ووصفًا', 'Every line item needs a code and a description'));
  if (lines.some((l) => !(Number(l.qty)) || !/^-?\d+(\.\d{1,3})?$/.test(l.qty.trim()))) problems.push(bi('الكمية رقم غير صفري (سالب للحذف، حتى 3 خانات عشرية)', 'Quantity must be non-zero (negative to remove, up to 3 decimals)'));
  if (lines.some((l) => !(Number(l.unitPrice) >= 0) || l.unitPrice.trim() === '')) problems.push(bi('سعر الوحدة مطلوب ولا يكون سالبًا', 'Unit price is required and cannot be negative'));

  const save = async () => {
    if (problems.length) { toast.error(problems[0]!); return; }
    setBusy(true); setError(null);
    const body = { description: description.trim(), reason: reason.trim() || null, lines: lines.map((l) => ({ code: l.code.trim(), description: l.description.trim(), qty: l.qty.trim(), unitPrice: l.unitPrice.trim() })) };
    try {
      const r = co ? await api.put<ChangeOrderRow>(`/change-orders/${co.id}`, { ...body, version: co.version }) : await api.post<ChangeOrderRow>('/change-orders', { ...body, contractId: contract.id });
      toast.success(co ? bi(`حُفظ أمر التغيير ${r.number}`, `Change order ${r.number} saved`) : bi(`أُنشئ أمر التغيير ${r.number}`, `Change order ${r.number} created`));
      onSaved(r.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} wide title={co ? bi(`تعديل أمر التغيير ${co.number}`, `Edit change order ${co.number}`) : bi(`أمر تغيير جديد — العقد ${contract.number}`, `New change order — contract ${contract.number}`)}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={busy} disabled={problems.length > 0} onClick={() => void save()}>{co ? tr('common.save') : bi('إنشاء المسودة', 'Create draft')}</Button></>}>
      <div className="space-y-3">
        {co?.status === 'rejected' && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{bi('أمر التغيير مرفوض — تعديله يعيده مسودة لإرساله للاعتماد مجددًا.', 'The change order was rejected — editing it returns it to draft so it can be submitted again.')}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={bi('الوصف *', 'Description *')}><Input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder={bi('مثال: إضافة كاميرتين وإزالة سويتش', 'e.g. add two cameras and remove a switch')} /></Field>
          <Field label={bi('السبب', 'Reason')}><Input value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder={bi('طلب العميل، تعديل في الموقع…', 'Customer request, site change…')} /></Field>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-muted"><tr><th className="px-2 py-1.5 text-start">{bi('الرمز', 'Code')}</th><th className="px-2 py-1.5 text-start">{bi('الوصف', 'Description')}</th><th className="px-2 py-1.5 text-start">{bi('الكمية (+ إضافة / − حذف)', 'Qty (+ add / − remove)')}</th><th className="px-2 py-1.5 text-start">{bi('سعر الوحدة', 'Unit price')}</th><th className="px-2 py-1.5 text-end">{bi('المبلغ', 'Amount')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const amt = lineAmountHalalas(num(l.unitPrice), num(l.qty));
                return (
                  <tr key={l.key} className="border-t border-line/60 align-top">
                    <td className="w-28 px-2 py-1.5"><Input dir="ltr" value={l.code} onChange={(e) => setLine(i, { code: e.target.value })} className="px-2 text-xs" aria-label={bi('الرمز', 'Code')} /></td>
                    <td className="min-w-[12rem] px-2 py-1.5"><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label={bi('الوصف', 'Description')} /></td>
                    <td className="w-44 px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => bump(i, -1)} className="rounded border border-line p-1.5 hover:bg-rose-50" aria-label={bi('إنقاص', 'Decrease')}><Minus className="size-3.5" /></button>
                        <NumInput value={l.qty} onChange={(v) => setLine(i, { qty: v })} min={-999999} step="1" className={clsx('px-1 text-center', Number(l.qty) < 0 && 'text-danger')} ariaLabel={bi('الكمية', 'Quantity')} />
                        <button type="button" onClick={() => bump(i, 1)} className="rounded border border-line p-1.5 hover:bg-emerald-50" aria-label={bi('زيادة', 'Increase')}><Plus className="size-3.5" /></button>
                      </div>
                    </td>
                    <td className="w-32 px-2 py-1.5"><NumInput value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} className="px-2" ariaLabel={bi('سعر الوحدة', 'Unit price')} /></td>
                    <td className="px-2 py-1.5 text-end"><Delta value={amt} /></td>
                    <td className="px-1 py-1.5"><button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded p-1 text-danger hover:bg-rose-50" aria-label={bi('حذف السطر', 'Delete line')}><Trash2 className="size-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, { key: newKey(), code: '', description: '', qty: '1', unitPrice: '' }])}>{bi('بند إضافة', 'Addition line')}</Button>
          {contract.lines.length > 0 && (
            <Select value="" onChange={(e) => fromContract(e.target.value)} className="max-w-xs text-xs" aria-label={bi('حذف بند من العقد', 'Remove a contract item')}>
              <option value="">{bi('حذف بند من العقد…', 'Remove a contract item…')}</option>
              {contract.lines.map((l, i) => <option key={i} value={i}>{l.code} — {l.description.slice(0, 50)}</option>)}
            </Select>
          )}
        </div>
        <div className="ms-auto max-w-sm divide-y divide-line/60 rounded-lg border border-line px-3 text-sm">
          <div className="flex justify-between py-1.5"><span>{bi('المجموع قبل الضريبة', 'Subtotal before VAT')}</span><Delta value={t.subtotal} /></div>
          <div className="flex justify-between py-1.5"><span>{bi('ضريبة القيمة المضافة', 'VAT')} {vatApplies ? `${VAT_RATE}%` : ''}</span>{vatApplies ? <Delta value={t.vat} /> : <span className="text-xs text-muted">{bi('لا تنطبق', 'N/A')}</span>}</div>
          <div className="flex justify-between py-2 font-extrabold"><span>{bi('صافي التغيير', 'Net change')}</span><Delta value={t.total} /></div>
        </div>
        <p className="text-xs text-muted">{bi('الأسعار بشروط العقد (قبل الضريبة). القيمة الموجبة تُفوتر بطلب دفع وفاتورة ضريبية مستقلة، والسالبة بإشعار دائن.', 'Prices at contract terms (before VAT). A positive amount is billed with a separate payment request and tax invoice; a negative one with a credit note.')}</p>
        {problems.length > 0 && <ul className="list-disc ps-5 text-xs text-amber-800">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <ErrorBox error={error} />
      </div>
    </Dialog>
  );
}
