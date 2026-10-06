'use client';
import { use, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Ban, Building2, CheckCircle2, Copy, CreditCard, Download, FileX2, Landmark, ReceiptText } from 'lucide-react';
import { date, h } from '@/lib/format';
import { Button, Money, StatusBadge, clsx } from '@/components/ui';
import { InlineError, PublicCard, PublicLoading, PublicShell, PublicState, publicFetch } from '@/app/_public/public-shell';
import { bi as biNow, useI18n } from '@/lib/i18n';

interface PayView {
  company: { legalNameAr: string; bankName: string | null; iban: string | null; vatRegistered: boolean };
  number: string; status: string; amount: string; paidAmount: string; due: string; dueDate: string;
  clientName: string; contractNumber: string | null; milestone: string;
  canPayOnline: boolean; sandbox: boolean;
  invoices: { id: string; number: string; typeCode: string; total: string }[];
}

const INVOICE_LABEL: Record<string, string> = { '386': 'فاتورة دفعة مقدمة', '388': 'فاتورة ضريبية نهائية', '381': 'إشعار دائن' };
const INVOICE_LABEL_EN: Record<string, string> = { '386': 'Advance payment invoice', '388': 'Final tax invoice', '381': 'Credit note' };
// Seller not registered for VAT: plain invoices, never called "tax" invoices.
const PLAIN_LABEL: Record<string, string> = { '386': 'فاتورة دفعة مقدمة', '388': 'فاتورة نهائية', '381': 'إشعار دائن' };
const PLAIN_LABEL_EN: Record<string, string> = { '386': 'Advance payment invoice', '388': 'Final invoice', '381': 'Credit note' };

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(biNow(`تم نسخ ${label}`, `${label} copied`));
  } catch {
    toast.error(biNow('تعذر النسخ', 'Could not copy'), { description: text });
  }
}

export default function PaymentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['public-pay', token], queryFn: () => publicFetch<PayView>(`/pay/${token}`), retry: false });
  const [qr, setQr] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(window.location.href, { margin: 1, width: 360, color: { dark: '#0D4A2E', light: '#FFFFFF' } }).then(setQr).catch(() => setQr(null));
  }, []);

  const pay = useMutation({
    mutationFn: () => publicFetch<{ ok: boolean; invoice?: string | null }>(`/pay/${token}/sandbox`, {}),
    onSuccess: () => { setPayErr(null); qc.invalidateQueries({ queryKey: ['public-pay', token] }); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    onError: (e: Error) => setPayErr(e.message),
  });

  if (q.isLoading) return <PublicLoading />;
  if (q.error || !q.data) {
    return (
      <PublicShell narrow>
        <PublicState icon={<FileX2 className="size-8" />} tone="danger" title={bi('تعذر فتح طلب الدفع', 'Could not open the payment request')}>{(q.error as Error)?.message ?? bi('الرابط غير صالح أو انتهت صلاحيته.', 'This link is invalid or has expired.')}</PublicState>
      </PublicShell>
    );
  }
  const d = q.data;
  const paid = d.status === 'paid';
  const cancelled = d.status === 'cancelled';
  const dueH = h(d.due);

  return (
    <PublicShell narrow companyName={d.company.legalNameAr} subtitle={<>{bi('طلب دفع', 'Payment request')}<br /><span className="num">{d.number}</span></>}>
      <div className="space-y-4">
        {paid && (
          <PublicState icon={<CheckCircle2 className="size-8" />} title={bi('شكرًا لك — تم استلام الدفعة', 'Thank you — payment received')}>
            {bi('استلمنا مبلغ', 'We received')} <b className="text-ink"><Money value={d.paidAmount} fixed /></b> {bi('لطلب الدفع', 'for payment request')} <span className="num">{d.number}</span>.
            {d.invoices.length > 0 && (locale === 'en'
              ? <> {d.company.vatRegistered ? 'The tax invoice' : 'The invoice'} has been issued and a copy will be sent to you.</>
              : <> وأُصدرت {d.company.vatRegistered ? "الفاتورة الضريبية" : "الفاتورة"} وستصلك نسختها.</>)}
          </PublicState>
        )}
        {cancelled && <PublicState icon={<Ban className="size-8" />} tone="muted" title={bi('تم إلغاء طلب الدفع', 'Payment request cancelled')}>{bi('هذا الطلب لم يعد ساريًا. إن كان لديك استفسار تواصل معنا.', 'This request is no longer valid. If you have any questions, please contact us.')}</PublicState>}

        <PublicCard>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-gold-dark">{paid ? bi('المبلغ المدفوع', 'Amount paid') : bi('المبلغ المستحق', 'Amount due')}</div>
              <div className="mt-1 text-3xl font-extrabold text-primary"><Money value={paid ? d.paidAmount : d.due} fixed /></div>
              {d.company.vatRegistered && <div className="mt-0.5 text-xs text-muted">{bi('شامل ضريبة القيمة المضافة', 'VAT included')}</div>}
            </div>
            <StatusBadge status={d.status} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <Info label={bi('العميل', 'Customer')} value={d.clientName || '—'} />
            <Info label={bi('رقم الطلب', 'Request number')} value={<span className="num">{d.number}</span>} />
            <Info label={bi('العقد', 'Contract')} value={<span className="num">{d.contractNumber ?? '—'}</span>} />
            <Info label={bi('الدفعة', 'Installment')} value={d.milestone || '—'} />
            <Info label={bi('تاريخ الاستحقاق', 'Due date')} value={<span className="num">{date(d.dueDate)}</span>} />
            <Info label={bi('قيمة الطلب', 'Request amount')} value={<Money value={d.amount} fixed />} />
            {h(d.paidAmount) > 0 && !paid && <Info label={bi('المدفوع حتى الآن', 'Paid so far')} value={<Money value={d.paidAmount} fixed className="text-ok" />} />}
          </dl>
          <a href={`/api/public/pay/${token}/pdf`} target="_blank" rel="noopener" className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm font-bold text-ink transition hover:bg-tint">
            <Download className="size-4" />{bi('تحميل طلب الدفع PDF', 'Download payment request (PDF)')}
          </a>
        </PublicCard>

        {d.invoices.length > 0 && (
          <PublicCard>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-primary"><ReceiptText className="size-4" />{bi('الفواتير الصادرة', 'Issued invoices')}</h2>
            <ul className="divide-y divide-line text-sm">
              {d.invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <span><span className="num font-bold">{i.number}</span> <span className="text-xs text-muted">· {(locale === 'en' ? (d.company.vatRegistered ? INVOICE_LABEL_EN[i.typeCode] : PLAIN_LABEL_EN[i.typeCode]) : (d.company.vatRegistered ? INVOICE_LABEL[i.typeCode] : PLAIN_LABEL[i.typeCode])) ?? i.typeCode}</span></span>
                  <Money value={i.total} fixed />
                </li>
              ))}
            </ul>
          </PublicCard>
        )}

        {!paid && !cancelled && dueH > 0 && (
          <>
            {d.canPayOnline && d.sandbox && (
              <PublicCard className="border-2 border-primary/20">
                <h2 className="mb-1 flex items-center gap-1.5 text-base font-extrabold text-primary"><CreditCard className="size-5" />{bi('الدفع الإلكتروني', 'Online payment')}</h2>
                <p className="mb-3 text-xs text-amber-800">{bi('بيئة تجريبية — لن يتم خصم أي مبلغ فعلي.', 'Sandbox — no real amount will be charged.')}</p>
                <Button className="w-full py-3 text-base" loading={pay.isPending} onClick={() => pay.mutate()}>{bi('ادفع الآن (بيئة تجريبية — مدى)', 'Pay now (sandbox — mada)')} · <Money value={d.due} fixed className="text-white [&_span]:text-white/80" /></Button>
                <div className="mt-2"><InlineError message={payErr} /></div>
              </PublicCard>
            )}

            <PublicCard>
              <h2 className="mb-3 flex items-center gap-1.5 text-base font-extrabold text-primary"><Landmark className="size-5" />{bi('التحويل البنكي', 'Bank transfer')}</h2>
              {d.company.iban ? (
                <div className="space-y-3 text-sm">
                  <BankRow label={bi('اسم المستفيد', 'Beneficiary name')} value={d.company.legalNameAr} icon={<Building2 className="size-4" />} />
                  {d.company.bankName && <BankRow label={bi('البنك', 'Bank')} value={d.company.bankName} icon={<Landmark className="size-4" />} />}
                  <div className="rounded-xl border border-line bg-tint/40 p-3">
                    <div className="text-[11px] font-bold text-muted">{bi('رقم الآيبان (IBAN)', 'IBAN')}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="num break-all text-base font-extrabold tracking-wide text-ink">{formatIban(d.company.iban)}</span>
                      <Button size="sm" variant="outline" icon={<Copy className="size-3.5" />} onClick={() => copy(d.company.iban!.replace(/\s/g, ''), bi('رقم الآيبان', 'IBAN'))}>{bi('نسخ', 'Copy')}</Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                    <span className="text-xs font-bold">{bi('اذكر رقم الطلب', 'Mention request number')} <span className="num">{d.number}</span> {bi('في وصف التحويل', 'in the transfer description')}</span>
                    <button className="text-xs font-bold underline" onClick={() => copy(d.number, bi('رقم الطلب', 'Request number'))}>{bi('نسخ', 'Copy')}</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">{bi('تواصل معنا للحصول على بيانات الحساب البنكي.', 'Contact us to get the bank account details.')}</p>
              )}
            </PublicCard>
          </>
        )}

        {!paid && !cancelled && <PublicCard className="flex flex-col items-center text-center">
          <div className={clsx('grid size-44 place-items-center overflow-hidden rounded-xl border border-line bg-white', !qr && 'animate-pulse bg-gray-50')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt={bi('رمز QR لصفحة الدفع', 'QR code for the payment page')} className="size-full" />}
          </div>
          <p className="mt-2 text-xs text-muted">{bi('امسح الرمز لفتح صفحة الدفع على جهاز آخر', 'Scan the code to open the payment page on another device')}</p>
        </PublicCard>}
      </div>
    </PublicShell>
  );
}

function formatIban(iban: string) {
  return iban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt className="text-[11px] font-bold text-muted">{label}</dt><dd className="mt-0.5 font-bold text-ink">{value}</dd></div>;
}

function BankRow({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gold-dark">{icon}</span>
      <span className="text-muted">{label}:</span>
      <span className="font-bold text-ink">{value}</span>
    </div>
  );
}
