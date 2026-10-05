'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Copy, FileText, Send } from 'lucide-react';
import { api, openFile } from '@/lib/api';
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

export const INVOICE_TYPES: Record<string, { label: string; tone: 'blue' | 'green' | 'red' | 'gold' }> = {
  '386': { label: 'فاتورة دفعة مقدمة', tone: 'blue' },
  '388': { label: 'فاتورة ضريبية نهائية', tone: 'green' },
  '381': { label: 'إشعار دائن', tone: 'red' },
  '383': { label: 'إشعار مدين', tone: 'gold' },
};

export function InvoiceTypeBadge({ code }: { code: string }) {
  const t = INVOICE_TYPES[code];
  return <span className="inline-flex items-center gap-1"><Badge tone={t?.tone ?? 'gray'}>{t?.label ?? code}</Badge><span className="num text-[10px] text-muted">{code}</span></span>;
}

export const PAYMENT_METHODS: Record<string, string> = {
  bank_transfer: 'تحويل بنكي', mada: 'مدى', credit_card: 'بطاقة ائتمانية', apple_pay: 'Apple Pay', stc_pay: 'STC Pay', cash: 'نقدًا', cheque: 'شيك', payment_link: 'رابط دفع',
};

export function payLink(token: string | null | undefined): string | null {
  if (!token || typeof window === 'undefined') return null;
  return `${location.origin}/p/${token}`;
}

export async function copyText(text: string, okMsg = 'تم النسخ') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMsg);
  } catch {
    toast.error('تعذر النسخ — انسخ يدويًا', { description: text });
  }
}

export function isOverdue(pr: { dueDate: string; status: string }, todayStr: string) {
  return ['draft', 'sent', 'partially_paid'].includes(pr.status) && pr.dueDate < todayStr;
}

/** Send / resend a payment request by WhatsApp or e-mail. */
export function SendRequestButton({ pr, onDone, size = 'sm' }: { pr: PaymentRequestRow; onDone?: () => void; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [to, setTo] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/finance/payment-requests/${pr.id}/send`, { channel, to: to.trim() || null }),
    onSuccess: () => { toast.success(`أُرسل طلب الدفع ${pr.number}`); setOpen(false); onDone?.(); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (pr.status === 'paid' || pr.status === 'cancelled') return null;
  return (
    <>
      <Button size={size} variant="outline" icon={<Send className="size-3.5" />} onClick={() => setOpen(true)}>{pr.status === 'draft' ? 'إرسال' : 'إعادة إرسال'}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`إرسال طلب الدفع ${pr.number}`} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button><Button loading={m.isPending} onClick={() => m.mutate()} icon={<Send className="size-4" />}>إرسال</Button></>}>
        <div className="space-y-3">
          <Field label="القناة">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'email')}>
              <option value="whatsapp">واتساب</option>
              <option value="email">البريد الإلكتروني</option>
            </Select>
          </Field>
          <Field label="المستلم (اختياري)" hint="اتركه فارغًا للإرسال إلى جهة الاتصال الرئيسية للعميل.">
            <Input dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'email' ? 'name@example.com' : '05XXXXXXXX'} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/** PDF + copy-link actions for a payment request. */
export function RequestLinkActions({ pr }: { pr: PaymentRequestRow }) {
  const link = payLink(pr.publicToken);
  return (
    <>
      <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => openFile(`/finance/payment-requests/${pr.id}/pdf`)} title="PDF">PDF</Button>
      {link && <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => copyText(link, 'نُسخ رابط الدفع')} title="نسخ رابط الدفع">الرابط</Button>}
    </>
  );
}

/** Amber banner when the back office is the development fake (nothing reaches ZATCA). */
export function BackofficeBanner() {
  const health = useQuery({ queryKey: ['backoffice-health'], queryFn: () => api.get<{ kind: 'erpnext' | 'fake'; ok: boolean; detail?: string }>('/finance/backoffice/health'), staleTime: 60_000, retry: false });
  if (!health.data) return null;
  if (health.data.kind === 'fake') {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>بيئة تطوير — الفواتير لا تُرسل إلى زاتكا. اربط ERPNext مع تطبيق الامتثال قبل التشغيل الفعلي.</span>
      </div>
    );
  }
  if (!health.data.ok) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>تعذر الاتصال بالنظام المحاسبي (ERPNext){health.data.detail ? ` — ${health.data.detail}` : ''}</span>
      </div>
    );
  }
  return null;
}
