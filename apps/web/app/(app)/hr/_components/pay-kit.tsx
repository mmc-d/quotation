'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Paperclip } from 'lucide-react';
import { daysBetween } from '@mmc/domain';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { uploadFile, UPLOAD_ACCEPT } from '@/lib/upload';
import { Badge, Button, Checkbox, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { errMsg, NumInput } from '../../quotes/_components/common';

export type LeaveType = 'annual' | 'emergency' | 'sick' | 'unpaid';
export interface Leave {
  id: string; number: string; employeeId: string; type: LeaveType; startDate: string; endDate: string; days: number; reason: string | null; attachmentFileId: string | null;
  source: 'employee' | 'hr'; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  createdAt: string; employeeNumber: string; employeeName: string; department: string | null;
}
export interface Balance { asOf: string; accrued: number; taken: number; pending: number; available: number; sickDaysLast12Months: number }
export interface Adjustment {
  id: string; month: string; kind: 'bonus' | 'deduction'; amount: string; reason: string; payMethod: 'payroll' | 'voucher';
  voucherId: string | null; voucherNumber: string | null; voucherStatus: string | null; locked?: boolean;
}

export const LEAVE: Record<LeaveType, { ar: string; en: string; hintAr: string; hintEn: string; tone: 'green' | 'gold' | 'blue' | 'gray' }> = {
  annual: { ar: 'سنوية (مدفوعة)', en: 'Annual (paid)', hintAr: 'تُخصم من رصيد الإجازة السنوية', hintEn: 'Taken from the annual balance', tone: 'green' },
  emergency: { ar: 'طارئة', en: 'Emergency', hintAr: 'مدفوعة، وتُخصم من رصيد الإجازة السنوية', hintEn: 'Paid, taken from the annual balance', tone: 'gold' },
  sick: { ar: 'مرضية', en: 'Sick', hintAr: 'أول 30 يومًا بأجر كامل، ثم 60 يومًا بـ 75%، ثم 30 يومًا بدون أجر خلال السنة (المادة 117). أرفق التقرير الطبي.', hintEn: 'First 30 days full pay, next 60 at 75 %, next 30 unpaid within a year (Art. 117). Attach the medical report.', tone: 'blue' },
  unpaid: { ar: 'بدون أجر', en: 'Unpaid', hintAr: 'يُخصم أجر الأيام من الراتب', hintEn: 'The days are deducted from pay', tone: 'gray' },
};
export const LEAVE_STATUS: Record<Leave['status'], [string, string, 'gold' | 'green' | 'red' | 'gray']> = {
  pending: ['بانتظار الموافقة', 'Pending', 'gold'], approved: ['معتمدة', 'Approved', 'green'], rejected: ['مرفوضة', 'Rejected', 'red'], cancelled: ['ملغاة', 'Cancelled', 'gray'],
};

export function LeaveBadge({ type }: { type: LeaveType }) {
  const { locale } = useI18n();
  return <Badge tone={LEAVE[type].tone}>{locale === 'en' ? LEAVE[type].en : LEAVE[type].ar}</Badge>;
}
export function LeaveStatus({ status }: { status: Leave['status'] }) {
  const { locale } = useI18n();
  const s = LEAVE_STATUS[status];
  return <Badge tone={s[2]}>{locale === 'en' ? s[1] : s[0]}</Badge>;
}

/** Balance tiles: accrued, taken, pending, available; sick days used in the last 12 months. */
export function BalanceTiles({ b }: { b: Balance }) {
  const { bi } = useI18n();
  const tile = (label: string, v: number, cls = '') => (
    <div className="rounded-xl border border-line bg-white px-3 py-2"><div className="text-[11px] text-muted">{label}</div><div className={`num text-xl font-extrabold ${cls}`}>{v}</div></div>
  );
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {tile(bi('المستحق حتى اليوم', 'Accrued to date'), b.accrued)}
      {tile(bi('المأخوذ', 'Taken'), b.taken)}
      {tile(bi('قيد الموافقة', 'Pending'), b.pending, b.pending ? 'text-gold-dark' : '')}
      {tile(bi('الرصيد المتاح', 'Available'), b.available, b.available < 0 ? 'text-danger' : 'text-primary')}
      {tile(bi('أيام مرضية (12 شهرًا)', 'Sick days (12 mo.)'), b.sickDaysLast12Months)}
    </div>
  );
}

/** New leave: an employee's request (`/hr/me/leaves`) or HR's direct entry (`/hr/leaves/employee/:id`). */
export function LeaveDialog({ open, onClose, onSaved, employeeId, available }: { open: boolean; onClose: () => void; onSaved: (l: Leave) => void; employeeId?: string; available?: number }) {
  const { bi, locale } = useI18n();
  const direct = !!employeeId;
  const [d, setD] = useState({ type: 'annual' as LeaveType, startDate: today(), endDate: today(), reason: '', allowNegative: false });
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const days = daysBetween(d.startDate, d.endDate);
  const fromBalance = d.type === 'annual' || d.type === 'emergency';
  const short = fromBalance && available !== undefined && days > available;
  const problem = !d.startDate || !d.endDate ? bi('حدد التاريخين', 'Pick both dates') : d.endDate < d.startDate ? bi('تاريخ النهاية قبل البداية', 'The end is before the start')
    : short && !(direct && d.allowNegative) ? bi(`الرصيد المتاح ${available} يومًا فقط`, `Only ${available} days available`) : null;
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try { const u = await uploadFile(f); setFile({ id: u.id, name: u.filename }); } catch (e) { toast.error(errMsg(e)); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { type: d.type, startDate: d.startDate, endDate: d.endDate, reason: d.reason.trim() || null, attachmentFileId: file?.id ?? null, ...(direct ? { allowNegative: d.allowNegative } : {}) };
      const l = direct ? await api.post<Leave>(`/hr/leaves/employee/${employeeId}`, body) : await api.post<Leave>('/hr/me/leaves', body);
      toast.success(direct ? bi(`سُجّلت الإجازة ${l.number}`, `Leave ${l.number} recorded`) : bi(`أُرسل الطلب ${l.number} للموافقة`, `Request ${l.number} sent for approval`));
      onSaved(l);
      setD({ type: 'annual', startDate: today(), endDate: today(), reason: '', allowNegative: false });
      setFile(null);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={direct ? bi('تسجيل إجازة للموظف', 'Record leave') : bi('طلب إجازة', 'Request leave')}
      footer={<>
        {problem && <span className="me-auto text-xs text-danger">{problem}</span>}
        <Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button>
        <Button loading={busy} disabled={!!problem} onClick={() => void save()}>{direct ? bi('تسجيل (معتمدة)', 'Record (approved)') : bi('إرسال الطلب', 'Send request')}</Button>
      </>}>
      <div className="grid gap-3">
        <Field label={bi('نوع الإجازة', 'Leave type')} hint={locale === 'en' ? LEAVE[d.type].hintEn : LEAVE[d.type].hintAr}>
          <Select value={d.type} onChange={(e) => setD((x) => ({ ...x, type: e.target.value as LeaveType }))}>
            {(Object.keys(LEAVE) as LeaveType[]).map((k) => <option key={k} value={k}>{locale === 'en' ? LEAVE[k].en : LEAVE[k].ar}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={bi('من', 'From')}><Input type="date" value={d.startDate} onChange={(e) => setD((x) => ({ ...x, startDate: e.target.value, endDate: x.endDate < e.target.value ? e.target.value : x.endDate }))} /></Field>
          <Field label={bi('إلى', 'To')}><Input type="date" min={d.startDate} value={d.endDate} onChange={(e) => setD((x) => ({ ...x, endDate: e.target.value }))} /></Field>
        </div>
        <div className="rounded-lg bg-tint/60 px-3 py-2 text-sm">
          <b className="num">{days}</b> {bi('يومًا', 'days')}
          {fromBalance && available !== undefined && <span className="text-muted"> · {bi('الرصيد المتاح', 'available')} <span className="num">{available}</span></span>}
        </div>
        {direct && short && <Checkbox label={bi('تسجيلها رغم تجاوز الرصيد (رصيد سالب)', 'Record it anyway (negative balance)')} checked={d.allowNegative} onChange={(v) => setD((x) => ({ ...x, allowNegative: v }))} />}
        <Field label={bi('السبب / ملاحظة', 'Reason / note')}><Textarea rows={2} value={d.reason} onChange={(e) => setD((x) => ({ ...x, reason: e.target.value }))} /></Field>
        <Field label={d.type === 'sick' ? bi('التقرير الطبي', 'Medical report') : bi('مرفق (اختياري)', 'Attachment (optional)')}>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted hover:bg-tint/40">
            <Paperclip className="size-4" />{file ? file.name : bi('اختر ملفًا (صورة أو PDF)', 'Choose a file (image or PDF)')}
            <input type="file" accept={UPLOAD_ACCEPT} className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
        </Field>
      </div>
    </Dialog>
  );
}

/** Approve / reject a pending request (manager or HR approver). */
export function DecideDialog({ leave, onClose, onDone }: { leave: Leave | null; onClose: () => void; onDone: (l: Leave) => void }) {
  const { bi, locale } = useI18n();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const decide = async (approve: boolean) => {
    if (!leave) return;
    if (!approve && !note.trim()) { toast.error(bi('اكتب سبب الرفض', 'Give the reason for rejecting')); return; }
    setBusy(approve ? 'approve' : 'reject');
    try {
      const l = await api.post<Leave>(`/hr/leaves/${leave.id}/decide`, { approve, note: note.trim() || null });
      toast.success(approve ? bi('اعتُمدت الإجازة', 'Leave approved') : bi('رُفض الطلب', 'Request rejected'));
      setNote('');
      onDone(l);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };
  return (
    <Dialog open={!!leave} onClose={onClose} title={bi(`طلب الإجازة ${leave?.number ?? ''}`, `Leave request ${leave?.number ?? ''}`)}
      footer={<>
        <Button variant="outline" onClick={onClose}>{bi('إغلاق', 'Close')}</Button>
        <Button variant="danger" loading={busy === 'reject'} onClick={() => void decide(false)}>{bi('رفض', 'Reject')}</Button>
        <Button loading={busy === 'approve'} onClick={() => void decide(true)}>{bi('موافقة', 'Approve')}</Button>
      </>}>
      {leave && (
        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><b>{leave.employeeName}</b><span className="num text-muted" dir="ltr">{leave.employeeNumber}</span><LeaveBadge type={leave.type} /></div>
          <div><span className="num">{date(leave.startDate)}</span> → <span className="num">{date(leave.endDate)}</span> · <b className="num">{leave.days}</b> {bi('يومًا', 'days')}</div>
          {leave.reason && <p className="text-muted">{leave.reason}</p>}
          {leave.attachmentFileId && <a className="text-primary hover:underline" href={`/api/files/${leave.attachmentFileId}`} target="_blank" rel="noopener">📎 {bi('المرفق', 'Attachment')}</a>}
          <p className="text-xs text-muted">{locale === 'en' ? LEAVE[leave.type].hintEn : LEAVE[leave.type].hintAr}</p>
          <Field label={bi('ملاحظة (إلزامية عند الرفض)', 'Note (required to reject)')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      )}
    </Dialog>
  );
}

const thisMonth = () => today().slice(0, 7);

/** Bonus / deduction for a payroll month, or a bonus paid now by payment voucher. */
export function AdjustmentDialog({ open, onClose, onSaved, employeeId, canVoucher }: { open: boolean; onClose: () => void; onSaved: (a: Adjustment) => void; employeeId: string; canVoucher: boolean }) {
  const { bi } = useI18n();
  const [d, setD] = useState({ kind: 'bonus' as 'bonus' | 'deduction', month: thisMonth(), amount: '', reason: '', payBy: 'payroll' as 'payroll' | 'voucher', method: 'transfer', category: 'other' as 'advance' | 'penalty' | 'other' });
  const [busy, setBusy] = useState(false);
  const voucher = d.kind === 'bonus' && d.payBy === 'voucher';
  const problem = !/^\d+(\.\d{1,2})?$/.test(d.amount.trim()) || Number(d.amount) <= 0 ? bi('أدخل المبلغ', 'Enter the amount') : !d.reason.trim() ? bi('أدخل السبب', 'Enter the reason') : null;
  const save = async () => {
    setBusy(true);
    try {
      const a = await api.post<Adjustment>(`/hr/employees/${employeeId}/adjustments`, { kind: d.kind, month: d.month, amount: d.amount.trim(), reason: d.reason.trim(), payBy: voucher ? 'voucher' : 'payroll', method: d.method, ...(d.kind === 'deduction' ? { category: d.category } : {}) });
      toast.success(a.voucherNumber ? bi(`أُنشئ سند الصرف ${a.voucherNumber} — بانتظار الاعتماد في المالية`, `Payment voucher ${a.voucherNumber} created — awaiting approval in Finance`) : d.kind === 'bonus' ? bi('أُضيفت المكافأة', 'Bonus added') : bi('أُضيف الخصم', 'Deduction added'));
      onSaved(a);
      setD((x) => ({ ...x, amount: '', reason: '' }));
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={bi('مكافأة أو خصم', 'Bonus or deduction')}
      footer={<>
        {problem && <span className="me-auto text-xs text-danger">{problem}</span>}
        <Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button>
        <Button loading={busy} disabled={!!problem} onClick={() => void save()}>{voucher ? bi('إنشاء سند الصرف', 'Create payment voucher') : bi('حفظ', 'Save')}</Button>
      </>}>
      <div className="grid gap-3">
        <div className="flex gap-2">
          <Button variant={d.kind === 'bonus' ? 'primary' : 'outline'} onClick={() => setD((x) => ({ ...x, kind: 'bonus' }))}>{bi('مكافأة / بونص', 'Bonus')}</Button>
          <Button variant={d.kind === 'deduction' ? 'danger' : 'outline'} onClick={() => setD((x) => ({ ...x, kind: 'deduction', payBy: 'payroll' }))}>{bi('خصم', 'Deduction')}</Button>
        </div>
        {d.kind === 'bonus' && (
          <Field label={bi('طريقة الصرف', 'How it is paid')}>
            <Select value={d.payBy} onChange={(e) => setD((x) => ({ ...x, payBy: e.target.value as 'payroll' | 'voucher' }))}>
              <option value="payroll">{bi('مع راتب الشهر (مسير الرواتب)', "With the month's salary (payroll)")}</option>
              <option value="voucher" disabled={!canVoucher}>{bi('الآن بسند صرف', 'Now, by payment voucher')}{canVoucher ? '' : bi(' — يحتاج صلاحية سندات الصرف', ' — needs voucher permission')}</option>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          {!voucher && <Field label={bi('شهر الراتب', 'Payroll month')}><Input type="month" value={d.month} onChange={(e) => setD((x) => ({ ...x, month: e.target.value }))} /></Field>}
          {voucher && (
            <Field label={bi('طريقة الدفع', 'Payment method')}>
              <Select value={d.method} onChange={(e) => setD((x) => ({ ...x, method: e.target.value }))}>
                <option value="transfer">{bi('تحويل بنكي (آيبان الموظف)', "Bank transfer (employee's IBAN)")}</option>
                <option value="cash">{bi('نقدًا', 'Cash')}</option>
                <option value="cheque">{bi('شيك', 'Cheque')}</option>
              </Select>
            </Field>
          )}
          <Field label={bi('المبلغ (ر.س)', 'Amount (SAR)')}><NumInput value={d.amount} onChange={(v) => setD((x) => ({ ...x, amount: v }))} min={0} step="0.01" ariaLabel={bi('المبلغ', 'Amount')} /></Field>
        </div>
        {d.kind === 'deduction' && (
          <Field label={bi('نوع الخصم (للقيد المحاسبي)', 'Deduction type (for the ledger)')}>
            <Select value={d.category} onChange={(e) => setD((x) => ({ ...x, category: e.target.value as 'advance' | 'penalty' | 'other' }))}>
              <option value="advance">{bi('سلفة (تُسترد من الموظف)', 'Advance (recovered from the employee)')}</option>
              <option value="penalty">{bi('جزاء / مخالفة', 'Penalty')}</option>
              <option value="other">{bi('أخرى', 'Other')}</option>
            </Select>
          </Field>
        )}
        <Field label={bi('السبب', 'Reason')}><Input value={d.reason} onChange={(e) => setD((x) => ({ ...x, reason: e.target.value }))} placeholder={d.kind === 'bonus' ? bi('مثال: تحقيق المستهدف', 'e.g. target achieved') : bi('مثال: سلفة، غياب، تلفيات', 'e.g. advance, absence, damage')} /></Field>
        <p className="text-xs text-muted">
          {voucher
            ? bi('يُنشأ سند صرف باسم الموظف في «سندات القبض والصرف» كمسودة، ثم يعتمده ويختمه مسؤول آخر. لا تُضاف المكافأة إلى مسير الرواتب حتى لا تُصرف مرتين.', 'A payment voucher in the employee\'s name is created as a draft in Finance → vouchers; a second person approves and stamps it. The bonus is left out of payroll so it is not paid twice.')
            : d.kind === 'deduction' ? bi('لا يجوز أن تتجاوز الخصومات نصف الأجر (المادة 92) — يُنبَّه في المسير.', 'Deductions may not exceed half the wage (Art. 92) — flagged in payroll.')
              : bi('تُضاف إلى راتب الشهر المحدد.', 'Added to the chosen month\'s pay.')}
        </p>
      </div>
    </Dialog>
  );
}
