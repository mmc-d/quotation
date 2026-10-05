'use client';
/** Change orders on a signed contract: list, create/edit (+/− quantities), approval workflow and billing. */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ChevronDown, FileText, FilePlus2, HandCoins, Minus, Pencil, Plus, Send, Signature, Trash2, XCircle } from 'lucide-react';
import { lineAmountHalalas, percentOf, VAT_RATE } from '@mmc/domain';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
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
  const s = CO_STATUS[status];
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold', s?.cls ?? 'bg-gray-100 text-gray-700')}>{s?.label ?? status}</span>;
}

type Action = 'submit' | 'approve' | 'reject' | 'sign' | 'bill' | 'cancel';

export function ChangeOrdersCard({ contract }: { contract: ContractView }) {
  const qc = useQueryClient();
  const { me, can } = useMe();
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
        if (r.paymentRequest) toast.success(`أُنشئ طلب الدفع ${r.paymentRequest.number} لأمر التغيير ${co.number}`);
        else if (r.invoice) toast.success(`أُصدر الإشعار الدائن ${r.invoice.number} (381) لأمر التغيير ${co.number}`);
      } else toast.success(`${co.number}: ${CO_STATUS[r.status]?.label ?? r.status}`);
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
      title={<span className="flex items-center gap-2">أوامر التغيير {d && d.rows.length > 0 && <span className="rounded-full bg-tint px-2 text-[11px] text-gold-dark">{d.rows.length}</span>}</span>}
      padded={false}
      actions={canWrite && contractOpen && <Button size="sm" variant="outline" icon={<FilePlus2 className="size-3.5" />} onClick={() => setEdit('new')}>أمر تغيير جديد</Button>}
    >
      {q.isLoading ? <Spinner /> : q.error || !d ? <div className="p-4"><ErrorBox error={q.error} /></div> : (
        <>
          <div className="grid gap-3 border-b border-line px-4 py-3 sm:grid-cols-3">
            <div><div className="text-xs font-bold text-muted">قيمة العقد الأصلية</div><Money value={d.contract.total} fixed className="text-base font-extrabold text-primary" /></div>
            <div><div className="text-xs font-bold text-muted">أوامر التغيير المعتمدة</div><Delta value={d.approvedTotal} className="text-base" /></div>
            <div><div className="text-xs font-bold text-muted">قيمة العقد شاملة أوامر التغيير</div><Money value={d.adjustedTotal} fixed className="text-base font-extrabold text-gold-dark" /></div>
          </div>
          {d.rows.length === 0 ? <Empty title="لا توجد أوامر تغيير" hint={contractOpen ? 'أي إضافة أو حذف بعد توقيع العقد يتم بأمر تغيير يُعتمد ثم يُفوتر.' : undefined} /> : (
            <Table>
              <thead><tr><Th className="w-8" /><Th>الرقم</Th><Th>الوصف</Th><Th>قبل الضريبة</Th><Th>الضريبة</Th><Th>الإجمالي</Th><Th>الحالة</Th><Th>إجراءات</Th></tr></thead>
              <tbody>
                {d.rows.map((co) => {
                  const isOpen = open === co.id;
                  const actions: { a: Action | 'edit'; label: string; icon: ReactNode; variant?: 'primary' | 'outline' | 'gold' | 'ghost' | 'danger' }[] = [];
                  if (canWrite && ['draft', 'rejected'].includes(co.status)) actions.push({ a: 'edit', label: 'تعديل', icon: <Pencil className="size-3.5" />, variant: 'ghost' });
                  if (canWrite && co.status === 'draft') actions.push({ a: 'submit', label: 'إرسال للاعتماد', icon: <Send className="size-3.5" />, variant: 'primary' });
                  if (co.status === 'pending_approval' && canDecide(co)) {
                    actions.push({ a: 'approve', label: 'اعتماد', icon: <CheckCircle2 className="size-3.5" />, variant: 'primary' });
                    actions.push({ a: 'reject', label: 'رفض', icon: <XCircle className="size-3.5" />, variant: 'ghost' });
                  }
                  if (canWrite && co.status === 'approved') actions.push({ a: 'sign', label: 'موافقة العميل', icon: <Signature className="size-3.5" />, variant: 'outline' });
                  if (canBill && ['approved', 'signed'].includes(co.status)) actions.push({ a: 'bill', label: h(co.amountDelta) < 0 ? 'إصدار إشعار دائن' : 'فوترة', icon: <HandCoins className="size-3.5" />, variant: 'gold' });
                  if (canWrite && ['draft', 'pending_approval', 'approved', 'signed', 'rejected'].includes(co.status)) actions.push({ a: 'cancel', label: 'إلغاء', icon: <Ban className="size-3.5" />, variant: 'ghost' });
                  return (
                    <Fragment key={co.id}>
                      <tr className={clsx('align-top', isOpen && 'bg-tint/40')}>
                        <Td><button type="button" onClick={() => setOpen(isOpen ? null : co.id)} className="rounded p-1 text-muted hover:bg-black/5" aria-expanded={isOpen} aria-label="التفاصيل"><ChevronDown className={clsx('size-4 transition', isOpen && 'rotate-180')} /></button></Td>
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
        <ReasonDialog open title={`رفض أمر التغيير ${act.co.number}`} label="سبب الرفض" required danger confirmLabel="رفض" loading={busy} onConfirm={(r) => void run(act.co, 'reject', { reason: r })} onClose={() => setAct(null)} />
      )}
      {act && act.action === 'cancel' && (
        <ReasonDialog open title={`إلغاء أمر التغيير ${act.co.number}`} label="سبب الإلغاء" required danger confirmLabel="إلغاء أمر التغيير" loading={busy} onConfirm={(r) => void run(act.co, 'cancel', { reason: r })} onClose={() => setAct(null)} />
      )}
      {act && act.action === 'bill' && <BillDialog co={act.co} busy={busy} onConfirm={(dueDate) => void run(act.co, 'bill', { dueDate: dueDate || null })} onClose={() => setAct(null)} />}
      {act && ['submit', 'approve', 'sign'].includes(act.action) && (
        <ConfirmDialog open loading={busy} onClose={() => setAct(null)} onConfirm={() => void run(act.co, act.action)}
          title={act.action === 'submit' ? `إرسال ${act.co.number} للاعتماد` : act.action === 'approve' ? `اعتماد ${act.co.number}` : `تسجيل موافقة العميل على ${act.co.number}`}
          confirmLabel={act.action === 'submit' ? 'إرسال' : act.action === 'approve' ? 'اعتماد' : 'تسجيل الموافقة'}
          message={act.action === 'submit'
            ? <>سيُرسل أمر التغيير بقيمة <Delta value={act.co.amountDelta} /> لاعتماد مدير لديه صلاحية توقيع العقود أو اعتماد العروض، ولا يمكن تعديله بعد ذلك إلا إذا رُفض.</>
            : act.action === 'approve'
              ? <>باعتماد أمر التغيير تصبح قيمة العقد شاملة أوامر التغيير مُحدّثة، ويمكن فوترته بعد ذلك.</>
              : <>يُسجَّل أن العميل وافق على أمر التغيير (خطوة اختيارية قبل الفوترة).</>}
        />
      )}
    </Card>
  );
}

function BillDialog({ co, busy, onConfirm, onClose }: { co: ChangeOrderRow; busy: boolean; onConfirm: (dueDate: string) => void; onClose: () => void }) {
  const [dueDate, setDueDate] = useState('');
  const negative = h(co.amountDelta) < 0;
  return (
    <Dialog open onClose={onClose} title={negative ? `إشعار دائن لأمر التغيير ${co.number}` : `فوترة أمر التغيير ${co.number}`}
      footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button variant={negative ? 'danger' : 'gold'} loading={busy} icon={<HandCoins className="size-4" />} onClick={() => onConfirm(dueDate)}>{negative ? 'إصدار الإشعار الدائن (381)' : 'إنشاء طلب الدفع'}</Button></>}>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg bg-tint/60 px-3 py-2">المبلغ: <Delta value={co.amountDelta} /> <span className="text-xs text-muted">(شامل الضريبة)</span></div>
        {negative ? (
          <p className="leading-relaxed text-muted">يُصدر إشعار دائن (381) بالقيمة المطلقة على الفاتورة الضريبية النهائية (388) للعقد إن صدرت، وإلا على آخر فاتورة دفعة مقدمة (386). لا يُعدّل العقد الأصلي.</p>
        ) : (
          <>
            <p className="leading-relaxed text-muted">يُنشأ طلب دفع مستقل لأمر التغيير. عند استلام المبلغ تُصدر فاتورة ضريبية (388) منفصلة لبنود أمر التغيير — لا تُخصم من الفاتورة النهائية للعقد ولا تؤثر على جدول دفعاته.</p>
            <Field label="تاريخ الاستحقاق" hint="اتركه فارغًا: اليوم + مدة السداد للعميل، مُرحّلًا إلى أول يوم عمل."><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function CoDetails({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['change-order', id], queryFn: () => api.get<ChangeOrderView>(`/change-orders/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const co = q.data;
  return (
    <div className="space-y-3 py-1">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        {co.reason && <span>السبب: <b className="text-ink">{co.reason}</b></span>}
        {co.createdByName && <span>أنشأه: <b className="text-ink">{co.createdByName}</b> · <span className="num">{dateTime(co.createdAt)}</span></span>}
        {co.approvedByName && <span>اعتمده: <b className="text-ink">{co.approvedByName}</b> · <span className="num">{dateTime(co.approvedAt)}</span></span>}
        {co.signedAt && <span>وافق العميل: <span className="num">{dateTime(co.signedAt)}</span></span>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-muted"><tr><th className="px-3 py-1.5 text-start">الرمز</th><th className="px-3 py-1.5 text-start">الوصف</th><th className="px-3 py-1.5 text-start">الكمية</th><th className="px-3 py-1.5 text-start">سعر الوحدة</th><th className="px-3 py-1.5 text-end">المبلغ</th></tr></thead>
          <tbody>
            {co.lines.map((l, i) => (
              <tr key={i} className="border-t border-line/60">
                <td className="num px-3 py-1.5 text-xs font-bold text-primary" dir="ltr">{l.code}</td>
                <td className="px-3 py-1.5">{l.description}{Number(l.qty) < 0 && <Badge tone="red">حذف</Badge>}</td>
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
            <span key={p.id} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1">طلب دفع <b className="num" dir="ltr">{p.number}</b> <Money value={p.amount} fixed /> <StatusBadge status={p.status} />
              <button type="button" className="text-gold-dark hover:underline" onClick={() => openFile(`/finance/payment-requests/${p.id}/pdf`)}>PDF</button>
            </span>
          ))}
          {co.invoices.map((i) => (
            <span key={i.id} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1">{i.typeCode === '381' ? 'إشعار دائن' : 'فاتورة ضريبية'} <b className="num" dir="ltr">{i.number}</b> <span className="num text-muted">{i.typeCode}</span> <Money value={i.total} fixed />
              <button type="button" className="inline-flex items-center gap-0.5 text-gold-dark hover:underline" onClick={() => openFile(`/finance/invoices/${i.id}/pdf`)}><FileText className="size-3" />PDF</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CoDialog({ contract, co, vatApplies, onClose, onSaved }: { contract: ContractView; co: ChangeOrderRow | null; vatApplies: boolean; onClose: () => void; onSaved: (id: string) => void }) {
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
  if (!description.trim()) problems.push('الوصف مطلوب');
  if (!lines.length) problems.push('أضف بندًا واحدًا على الأقل');
  if (lines.some((l) => !l.code.trim() || !l.description.trim())) problems.push('كل بند يحتاج رمزًا ووصفًا');
  if (lines.some((l) => !(Number(l.qty)) || !/^-?\d+(\.\d{1,3})?$/.test(l.qty.trim()))) problems.push('الكمية رقم غير صفري (سالب للحذف، حتى 3 خانات عشرية)');
  if (lines.some((l) => !(Number(l.unitPrice) >= 0) || l.unitPrice.trim() === '')) problems.push('سعر الوحدة مطلوب ولا يكون سالبًا');

  const save = async () => {
    if (problems.length) { toast.error(problems[0]!); return; }
    setBusy(true); setError(null);
    const body = { description: description.trim(), reason: reason.trim() || null, lines: lines.map((l) => ({ code: l.code.trim(), description: l.description.trim(), qty: l.qty.trim(), unitPrice: l.unitPrice.trim() })) };
    try {
      const r = co ? await api.put<ChangeOrderRow>(`/change-orders/${co.id}`, { ...body, version: co.version }) : await api.post<ChangeOrderRow>('/change-orders', { ...body, contractId: contract.id });
      toast.success(co ? `حُفظ أمر التغيير ${r.number}` : `أُنشئ أمر التغيير ${r.number}`);
      onSaved(r.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} wide title={co ? `تعديل أمر التغيير ${co.number}` : `أمر تغيير جديد — العقد ${contract.number}`}
      footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button loading={busy} disabled={problems.length > 0} onClick={() => void save()}>{co ? 'حفظ' : 'إنشاء المسودة'}</Button></>}>
      <div className="space-y-3">
        {co?.status === 'rejected' && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">أمر التغيير مرفوض — تعديله يعيده مسودة لإرساله للاعتماد مجددًا.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="الوصف *"><Input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="مثال: إضافة كاميرتين وإزالة سويتش" /></Field>
          <Field label="السبب"><Input value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder="طلب العميل، تعديل في الموقع…" /></Field>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-muted"><tr><th className="px-2 py-1.5 text-start">الرمز</th><th className="px-2 py-1.5 text-start">الوصف</th><th className="px-2 py-1.5 text-start">الكمية (+ إضافة / − حذف)</th><th className="px-2 py-1.5 text-start">سعر الوحدة</th><th className="px-2 py-1.5 text-end">المبلغ</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const amt = lineAmountHalalas(num(l.unitPrice), num(l.qty));
                return (
                  <tr key={l.key} className="border-t border-line/60 align-top">
                    <td className="w-28 px-2 py-1.5"><Input dir="ltr" value={l.code} onChange={(e) => setLine(i, { code: e.target.value })} className="px-2 text-xs" aria-label="الرمز" /></td>
                    <td className="min-w-[12rem] px-2 py-1.5"><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="الوصف" /></td>
                    <td className="w-44 px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => bump(i, -1)} className="rounded border border-line p-1.5 hover:bg-rose-50" aria-label="إنقاص"><Minus className="size-3.5" /></button>
                        <NumInput value={l.qty} onChange={(v) => setLine(i, { qty: v })} min={-999999} step="1" className={clsx('px-1 text-center', Number(l.qty) < 0 && 'text-danger')} ariaLabel="الكمية" />
                        <button type="button" onClick={() => bump(i, 1)} className="rounded border border-line p-1.5 hover:bg-emerald-50" aria-label="زيادة"><Plus className="size-3.5" /></button>
                      </div>
                    </td>
                    <td className="w-32 px-2 py-1.5"><NumInput value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} className="px-2" ariaLabel="سعر الوحدة" /></td>
                    <td className="px-2 py-1.5 text-end"><Delta value={amt} /></td>
                    <td className="px-1 py-1.5"><button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded p-1 text-danger hover:bg-rose-50" aria-label="حذف السطر"><Trash2 className="size-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, { key: newKey(), code: '', description: '', qty: '1', unitPrice: '' }])}>بند إضافة</Button>
          {contract.lines.length > 0 && (
            <Select value="" onChange={(e) => fromContract(e.target.value)} className="max-w-xs text-xs" aria-label="حذف بند من العقد">
              <option value="">حذف بند من العقد…</option>
              {contract.lines.map((l, i) => <option key={i} value={i}>{l.code} — {l.description.slice(0, 50)}</option>)}
            </Select>
          )}
        </div>
        <div className="ms-auto max-w-sm divide-y divide-line/60 rounded-lg border border-line px-3 text-sm">
          <div className="flex justify-between py-1.5"><span>المجموع قبل الضريبة</span><Delta value={t.subtotal} /></div>
          <div className="flex justify-between py-1.5"><span>ضريبة القيمة المضافة {vatApplies ? `${VAT_RATE}%` : ''}</span>{vatApplies ? <Delta value={t.vat} /> : <span className="text-xs text-muted">لا تنطبق</span>}</div>
          <div className="flex justify-between py-2 font-extrabold"><span>صافي التغيير</span><Delta value={t.total} /></div>
        </div>
        <p className="text-xs text-muted">الأسعار بشروط العقد (قبل الضريبة). القيمة الموجبة تُفوتر بطلب دفع وفاتورة ضريبية مستقلة، والسالبة بإشعار دائن.</p>
        {problems.length > 0 && <ul className="list-disc ps-5 text-xs text-amber-800">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <ErrorBox error={error} />
      </div>
    </Dialog>
  );
}
