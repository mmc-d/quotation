'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Copy, FileText, Send } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { bi as biNow, useI18n, type Locale } from '@/lib/i18n';
import { Badge, Button, Dialog, Field, Input, Select } from '@/components/ui';

/** Shared types for the /finance API. Money fields are NUMERIC strings (SAR). */
export interface PaymentRequestRow {
  id: string; number: string; milestoneId: string | null; contractId: string | null; partyId: string | null;
  amount: string; paidAmount: string; dueDate: string; status: string; publicToken: string | null; paymentLinkUrl: string | null;
  sentAt: string | null; createdAt: string; partyName?: string | null; contractNumber?: string | null;
}
export interface InvoiceRow {
  id: string; erpName: string; number: string; typeCode: string; subtype: string; partyId: string | null; contractId: string | null;
  milestoneId: string | null; paymentRequestId: string | null; originalInvoiceId: string | null; issueDate: string; dueDate: string | null;
  taxable: string; vatAmount: string; total: string; prepaidAmount: string; balanceDue: string; zatcaStatus: string; status: string;
  partyName?: string | null; contractNumber?: string | null;
}
export interface PaymentRow { id: string; erpName: string; partyId: string | null; paymentRequestId: string | null; amount: string; paidOn: string; method: string; reference: string | null }

export const INVOICE_TYPES: Record<string, { label: string; labelEn: string; tone: 'blue' | 'green' | 'red' | 'gold' }> = {
  '386': { label: 'فاتورة دفعة مقدمة', labelEn: 'Advance (prepayment) invoice', tone: 'blue' },
  '388': { label: 'فاتورة ضريبية نهائية', labelEn: 'Final tax invoice', tone: 'green' },
  '381': { label: 'إشعار دائن', labelEn: 'Credit note', tone: 'red' },
  '383': { label: 'إشعار مدين', labelEn: 'Debit note', tone: 'gold' },
};
export const invoiceTypeLabel = (code: string, locale: Locale) => { const t = INVOICE_TYPES[code]; return t ? (locale === 'en' ? t.labelEn : t.label) : code; };

export function InvoiceTypeBadge({ code }: { code: string }) {
  const { locale } = useI18n();
  const t = INVOICE_TYPES[code];
  return <span className="inline-flex items-center gap-1"><Badge tone={t?.tone ?? 'gray'}>{invoiceTypeLabel(code, locale)}</Badge><span className="num text-[10px] text-muted">{code}</span></span>;
}

export const PAYMENT_METHODS: Record<string, string> = {
  bank_transfer: 'تحويل بنكي', mada: 'مدى', credit_card: 'بطاقة ائتمانية', apple_pay: 'Apple Pay', stc_pay: 'STC Pay', cash: 'نقدًا', cheque: 'شيك', payment_link: 'رابط دفع',
};
export const PAYMENT_METHODS_EN: Record<string, string> = {
  bank_transfer: 'Bank transfer', mada: 'mada', credit_card: 'Credit card', apple_pay: 'Apple Pay', stc_pay: 'STC Pay', cash: 'Cash', cheque: 'Cheque', payment_link: 'Payment link',
};
export const paymentMethodLabel = (k: string, locale: Locale) => (locale === 'en' ? PAYMENT_METHODS_EN : PAYMENT_METHODS)[k] ?? k;

export function payLink(token: string | null | undefined): string | null {
  if (!token || typeof window === 'undefined') return null;
  return `${location.origin}/p/${token}`;
}

export async function copyText(text: string, okMsg?: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMsg ?? biNow('تم النسخ', 'Copied'));
  } catch {
    toast.error(biNow('تعذر النسخ — انسخ يدويًا', 'Could not copy — copy it manually'), { description: text });
  }
}

export function isOverdue(pr: { dueDate: string; status: string }, todayStr: string) {
  return ['draft', 'sent', 'partially_paid'].includes(pr.status) && pr.dueDate < todayStr;
}

/** Send / resend a payment request by WhatsApp or e-mail. */
export function SendRequestButton({ pr, onDone, size = 'sm' }: { pr: PaymentRequestRow; onDone?: () => void; size?: 'sm' | 'md' }) {
  const { bi } = useI18n();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [to, setTo] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/finance/payment-requests/${pr.id}/send`, { channel, to: to.trim() || null }),
    onSuccess: () => { toast.success(bi(`أُرسل طلب الدفع ${pr.number}`, `Payment request ${pr.number} sent`)); setOpen(false); onDone?.(); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (pr.status === 'paid' || pr.status === 'cancelled') return null;
  return (
    <>
      <Button size={size} variant="outline" icon={<Send className="size-3.5" />} onClick={() => setOpen(true)}>{pr.status === 'draft' ? bi('إرسال', 'Send') : bi('إعادة إرسال', 'Resend')}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={bi(`إرسال طلب الدفع ${pr.number}`, `Send payment request ${pr.number}`)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={m.isPending} onClick={() => m.mutate()} icon={<Send className="size-4" />}>{bi('إرسال', 'Send')}</Button></>}>
        <div className="space-y-3">
          <Field label={bi('القناة', 'Channel')}>
            <Select value={channel} onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'email')}>
              <option value="whatsapp">{bi('واتساب', 'WhatsApp')}</option>
              <option value="email">{bi('البريد الإلكتروني', 'E-mail')}</option>
            </Select>
          </Field>
          <Field label={bi('المستلم (اختياري)', 'Recipient (optional)')} hint={bi('اتركه فارغًا للإرسال إلى جهة الاتصال الرئيسية للعميل.', 'Leave empty to send to the customer’s primary contact.')}>
            <Input dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'email' ? 'name@example.com' : '05XXXXXXXX'} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/** PDF + copy-link actions for a payment request. */
export function RequestLinkActions({ pr }: { pr: PaymentRequestRow }) {
  const { bi } = useI18n();
  const link = payLink(pr.publicToken);
  return (
    <>
      <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => openFile(`/finance/payment-requests/${pr.id}/pdf`)} title="PDF">PDF</Button>
      {link && <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => copyText(link, bi('نُسخ رابط الدفع', 'Payment link copied'))} title={bi('نسخ رابط الدفع', 'Copy payment link')}>{bi('الرابط', 'Link')}</Button>}
    </>
  );
}

/** Amber banner when the back office is the development fake (nothing reaches ZATCA). */
export function BackofficeBanner() {
  const { bi } = useI18n();
  const health = useQuery({ queryKey: ['backoffice-health'], queryFn: () => api.get<{ kind: 'erpnext' | 'fake'; ok: boolean; detail?: string }>('/finance/backoffice/health'), staleTime: 60_000, retry: false });
  if (!health.data) return null;
  if (health.data.kind === 'fake') {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{bi('بيئة تطوير — الفواتير لا تُرسل إلى زاتكا. اربط ERPNext مع تطبيق الامتثال قبل التشغيل الفعلي.', 'Development environment — invoices are not sent to ZATCA. Connect ERPNext with the compliance app before going live.')}</span>
      </div>
    );
  }
  if (!health.data.ok) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{bi('تعذر الاتصال بالنظام المحاسبي (ERPNext)', 'Could not connect to the accounting system (ERPNext)')}{health.data.detail ? ` — ${health.data.detail}` : ''}</span>
      </div>
    );
  }
  return null;
}
