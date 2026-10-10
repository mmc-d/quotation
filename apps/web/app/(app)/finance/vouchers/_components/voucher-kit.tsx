'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { tafqitHalalas, toHalalas } from '@mmc/domain';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { today } from '@/lib/format';
import { useMe } from '@/lib/me';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import { errMsg, NumInput } from '../../../quotes/_components/common';
import { ProjectPicker, type PickedProject } from '../../../purchasing/_components/pickers';
import { AccountPicker } from '../../../accounting/_components/ledger-kit';

export type VoucherKind = 'payment' | 'receipt';
export interface Voucher {
  id: string; kind: VoucherKind; number: string; voucherDate: string; partyId: string | null; counterpartyName: string;
  counterpartyIdNumber: string | null; counterpartyMobile: string | null; amount: string; purpose: string; method: string;
  methodRef: string | null; bankName: string | null; methodDate: string | null; projectId: string | null; costCenter: string | null; accountId: string | null;
  docRef: string | null; notes: string | null; status: 'draft' | 'approved' | 'cancelled'; approvedBy: string | null; approvedByName: string | null;
  approvedAt: string | null; cancelReason: string | null; cancelledAt: string | null; createdBy: string | null; createdByName: string | null; version: number;
  party: { id: string; nameAr: string } | null; project: { id: string; number: string; name: string } | null;
  account: { id: string; code: string; nameAr: string } | null;
}

export const KIND_LABEL: Record<VoucherKind, [string, string]> = { payment: ['سند صرف', 'Payment voucher'], receipt: ['سند قبض', 'Receipt voucher'] };
export const METHODS: { value: string; ar: string; en: string }[] = [
  { value: 'cash', ar: 'نقدًا', en: 'Cash' },
  { value: 'transfer', ar: 'تحويل بنكي', en: 'Bank transfer' },
  { value: 'cheque', ar: 'شيك', en: 'Cheque' },
  { value: 'card', ar: 'بطاقة / مدى', en: 'Card / mada' },
  { value: 'other', ar: 'أخرى', en: 'Other' },
];

interface Draft {
  voucherDate: string; party: PickedParty | null; counterpartyName: string; counterpartyIdNumber: string; counterpartyMobile: string;
  amount: string; purpose: string; method: string; methodRef: string; bankName: string; methodDate: string;
  project: PickedProject | null; costCenter: string; accountId: string; docRef: string; notes: string;
}

const fromVoucher = (v: Voucher | null): Draft => ({
  voucherDate: v?.voucherDate ?? today(), party: v?.party ? { id: v.party.id, nameAr: v.party.nameAr, nameEn: null, phone: null, email: null, vatNumber: null } : null,
  counterpartyName: v?.counterpartyName ?? '', counterpartyIdNumber: v?.counterpartyIdNumber ?? '', counterpartyMobile: v?.counterpartyMobile ?? '',
  amount: v ? String(Number(v.amount)) : '', purpose: v?.purpose ?? '', method: v?.method ?? 'cash', methodRef: v?.methodRef ?? '', bankName: v?.bankName ?? '',
  methodDate: v?.methodDate ?? '', project: v?.project ? { id: v.project.id, number: v.project.number, name: v.project.name } : null,
  costCenter: v?.costCenter ?? '', accountId: v?.accountId ?? '', docRef: v?.docRef ?? '', notes: v?.notes ?? '',
});

/** Create / edit form for a draft voucher. */
export function VoucherForm({ kind, voucher, onSaved, onCancel }: { kind: VoucherKind; voucher: Voucher | null; onSaved: (v: Voucher) => void; onCancel?: () => void }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const [d, setD] = useState<Draft>(() => fromVoucher(voucher));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const pay = kind === 'payment';
  const amountOk = /^\d+(\.\d{1,2})?$/.test(d.amount.trim()) && Number(d.amount) > 0;
  const problem = !d.counterpartyName.trim() ? bi(pay ? 'أدخل اسم المستلم' : 'أدخل اسم الدافع', pay ? 'Enter the payee' : 'Enter the payer')
    : !amountOk ? bi('أدخل مبلغًا صحيحًا', 'Enter a valid amount')
    : !d.purpose.trim() ? bi('أدخل البيان (وذلك مقابل)', 'Enter what it is for')
    : d.voucherDate > today() ? bi('لا يمكن أن يكون التاريخ في المستقبل', 'The date cannot be in the future') : null;
  const nonCash = d.method !== 'cash';

  const save = async () => {
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    const body = {
      kind, voucherDate: d.voucherDate, partyId: d.party?.id ?? null, counterpartyName: d.counterpartyName.trim(), counterpartyIdNumber: d.counterpartyIdNumber.trim() || null,
      counterpartyMobile: d.counterpartyMobile.trim() || null, amount: d.amount.trim(), purpose: d.purpose.trim(), method: d.method,
      methodRef: nonCash ? d.methodRef.trim() || null : null, bankName: nonCash ? d.bankName.trim() || null : null, methodDate: nonCash && d.methodDate ? d.methodDate : null,
      projectId: d.project?.id ?? null, costCenter: d.costCenter.trim() || null, accountId: d.accountId || null, docRef: d.docRef.trim() || null, notes: d.notes.trim() || null,
    };
    try {
      const v = voucher ? await api.put<Voucher>(`/vouchers/${voucher.id}`, { ...body, version: voucher.version }) : await api.post<Voucher>('/vouchers', body);
      toast.success(voucher ? bi('تم حفظ السند', 'Voucher saved') : bi(`أُنشئ السند ${v.number}`, `Voucher ${v.number} created`));
      onSaved(v);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Card title={pay ? bi('المستلم والمبلغ', 'Payee and amount') : bi('الدافع والمبلغ', 'Payer and amount')}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={bi('التاريخ *', 'Date *')}><Input type="date" max={today()} value={d.voucherDate} onChange={(e) => set({ voucherDate: e.target.value })} /></Field>
          <Field label={bi('المبلغ (ر.س) *', 'Amount (SAR) *')} hint={amountOk ? `${tafqitHalalas(toHalalas(d.amount.trim()))} ${bi('فقط لا غير', 'only')}` : undefined}>
            <NumInput value={d.amount} onChange={(v) => set({ amount: v })} min={0} step="0.01" ariaLabel={bi('المبلغ', 'Amount')} />
          </Field>
          <Field label={bi('ربط بعميل / مورد (اختياري)', 'Link a customer / supplier (optional)')} className="md:col-span-2">
            <PartyPicker value={d.party} onChange={(p) => set({ party: p, counterpartyName: p ? (locale === 'en' ? p.nameEn || p.nameAr : p.nameAr) : d.counterpartyName, counterpartyMobile: p?.phone ?? d.counterpartyMobile })} />
          </Field>
          <Field label={pay ? bi('اصرفوا للسيد / السادة *', 'Pay to *') : bi('استلمنا من السيد / السادة *', 'Received from *')}><Input value={d.counterpartyName} onChange={(e) => set({ counterpartyName: e.target.value })} /></Field>
          <Field label={bi('رقم الهوية / السجل', 'ID / CR number')}><Input dir="ltr" value={d.counterpartyIdNumber} onChange={(e) => set({ counterpartyIdNumber: e.target.value })} /></Field>
          <Field label={bi('الجوال', 'Mobile')}><Input dir="ltr" inputMode="tel" value={d.counterpartyMobile} onChange={(e) => set({ counterpartyMobile: e.target.value })} placeholder="05XXXXXXXX" /></Field>
          <Field label={bi('وذلك مقابل *', 'Being for *')} className="md:col-span-2"><Textarea rows={2} value={d.purpose} onChange={(e) => set({ purpose: e.target.value })} /></Field>
        </div>
      </Card>

      <Card title={pay ? bi('طريقة الصرف', 'Payment method') : bi('طريقة القبض', 'Receipt method')}>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label={bi('الطريقة', 'Method')}>
            <Select value={d.method} onChange={(e) => set({ method: e.target.value })}>{METHODS.map((m) => <option key={m.value} value={m.value}>{locale === 'en' ? m.en : m.ar}</option>)}</Select>
          </Field>
          {nonCash && <>
            <Field label={d.method === 'cheque' ? bi('رقم الشيك', 'Cheque number') : bi('رقم العملية / الحوالة', 'Reference number')}><Input dir="ltr" value={d.methodRef} onChange={(e) => set({ methodRef: e.target.value })} /></Field>
            <Field label={bi('البنك', 'Bank')}><Input value={d.bankName} onChange={(e) => set({ bankName: e.target.value })} /></Field>
            <Field label={bi('بتاريخ', 'Dated')}><Input type="date" value={d.methodDate} onChange={(e) => set({ methodDate: e.target.value })} /></Field>
          </>}
        </div>
      </Card>

      <Card title={bi('التصنيف والمرجع', 'Allocation and reference')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={bi('المشروع', 'Project')}><ProjectPicker value={d.project} onChange={(p) => set({ project: p })} /></Field>
          <Field label={bi('مركز التكلفة', 'Cost center')}><Input value={d.costCenter} onChange={(e) => set({ costCenter: e.target.value })} placeholder={bi('مثال: مصاريف إدارية', 'e.g. admin expenses')} /></Field>
          {can('ledger.read') && (
            <Field label={bi('الحساب المقابل (للقيد المحاسبي)', 'Counter account (for the ledger)')} hint={bi('اتركه فارغًا ليُحدَّد تلقائيًا من العميل/المورد، وإلا يذهب إلى «حساب التسوية» بانتظار التوجيه', 'Leave empty to use the customer/supplier; otherwise it goes to the suspense account')} className="md:col-span-3">
              <AccountPicker value={d.accountId} onChange={(id) => set({ accountId: id })} />
            </Field>
          )}
          <Field label={bi('المرجع (أمر شراء / فاتورة)', 'Reference (PO / invoice)')}><Input dir="ltr" value={d.docRef} onChange={(e) => set({ docRef: e.target.value })} /></Field>
          <Field label={bi('ملاحظات', 'Notes')} className="md:col-span-3"><Textarea rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 bg-gradient-to-t from-white/95 to-white/0 px-1 py-3">
        {problem && <span className="me-auto text-xs text-danger">{problem}</span>}
        {onCancel && <Button variant="outline" onClick={onCancel}>{bi('إلغاء', 'Cancel')}</Button>}
        <Button loading={busy} disabled={!!problem} onClick={() => void save()}>{voucher ? bi('حفظ التعديلات', 'Save changes') : bi('حفظ كمسودة', 'Save as draft')}</Button>
      </div>
    </div>
  );
}

/** The stamp the approver puts on the voucher — the visual second confirmation. */
export function ApprovalSeal({ name, at }: { name: string | null; at: string | null }) {
  return (
    <div className="grid size-32 shrink-0 -rotate-[9deg] place-items-center rounded-full border-[3px] border-double border-sky-700 text-center text-sky-700 opacity-90">
      <div className="leading-tight">
        <div className="text-lg font-extrabold tracking-wide">معتمد</div>
        <div className="mx-auto max-w-[6.5rem] truncate text-[10px] font-bold">{name}</div>
        <div className="num text-[10px]" dir="ltr">{at?.slice(0, 10)}</div>
      </div>
    </div>
  );
}
