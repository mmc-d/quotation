'use client';
import { use, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Ban, Building2, CheckCircle2, Copy, CreditCard, Download, FileX2, Landmark, ReceiptText } from 'lucide-react';
import { date, h } from '@/lib/format';
import { Button, Money, StatusBadge, clsx } from '@/components/ui';
import { InlineError, PublicCard, PublicLoading, PublicShell, PublicState, publicFetch } from '@/app/_public/public-shell';

interface PayView {
  company: { legalNameAr: string; bankName: string | null; iban: string | null; vatRegistered: boolean };
  number: string; status: string; amount: string; paidAmount: string; due: string; dueDate: string;
  clientName: string; contractNumber: string | null; milestone: string;
  canPayOnline: boolean; sandbox: boolean;
  invoices: { id: string; number: string; typeCode: string; total: string }[];
}

const INVOICE_LABEL: Record<string, string> = { '386': 'فاتورة دفعة مقدمة', '388': 'فاتورة ضريبية نهائية', '381': 'إشعار دائن' };
// Seller not registered for VAT: plain invoices, never called "tax" invoices.
const PLAIN_LABEL: Record<string, string> = { '386': 'فاتورة دفعة مقدمة', '388': 'فاتورة نهائية', '381': 'إشعار دائن' };

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`تم نسخ ${label}`);
  } catch {
    toast.error('تعذر النسخ', { description: text });
  }
}

export default function PaymentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
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
        <PublicState icon={<FileX2 className="size-8" />} tone="danger" title="تعذر فتح طلب الدفع">{(q.error as Error)?.message ?? 'الرابط غير صالح أو انتهت صلاحيته.'}</PublicState>
      </PublicShell>
    );
  }
  const d = q.data;
  const paid = d.status === 'paid';
  const cancelled = d.status === 'cancelled';
  const dueH = h(d.due);

  return (
    <PublicShell narrow companyName={d.company.legalNameAr} subtitle={<>طلب دفع<br /><span className="num">{d.number}</span></>}>
      <div className="space-y-4">
        {paid && (
          <PublicState icon={<CheckCircle2 className="size-8" />} title="شكرًا لك — تم استلام الدفعة">
            استلمنا مبلغ <b className="text-ink"><Money value={d.paidAmount} fixed /></b> لطلب الدفع <span className="num">{d.number}</span>.
            {d.invoices.length > 0 && <> وأُصدرت {d.company.vatRegistered ? "الفاتورة الضريبية" : "الفاتورة"} وستصلك نسختها.</>}
          </PublicState>
        )}
        {cancelled && <PublicState icon={<Ban className="size-8" />} tone="muted" title="تم إلغاء طلب الدفع">هذا الطلب لم يعد ساريًا. إن كان لديك استفسار تواصل معنا.</PublicState>}

        <PublicCard>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-gold-dark">{paid ? 'المبلغ المدفوع' : 'المبلغ المستحق'}</div>
              <div className="mt-1 text-3xl font-extrabold text-primary"><Money value={paid ? d.paidAmount : d.due} fixed /></div>
              {d.company.vatRegistered && <div className="mt-0.5 text-xs text-muted">شامل ضريبة القيمة المضافة</div>}
            </div>
            <StatusBadge status={d.status} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <Info label="العميل" value={d.clientName || '—'} />
            <Info label="رقم الطلب" value={<span className="num">{d.number}</span>} />
            <Info label="العقد" value={<span className="num">{d.contractNumber ?? '—'}</span>} />
            <Info label="الدفعة" value={d.milestone || '—'} />
            <Info label="تاريخ الاستحقاق" value={<span className="num">{date(d.dueDate)}</span>} />
            <Info label="قيمة الطلب" value={<Money value={d.amount} fixed />} />
            {h(d.paidAmount) > 0 && !paid && <Info label="المدفوع حتى الآن" value={<Money value={d.paidAmount} fixed className="text-ok" />} />}
          </dl>
          <a href={`/api/public/pay/${token}/pdf`} target="_blank" rel="noopener" className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm font-bold text-ink transition hover:bg-tint">
            <Download className="size-4" />تحميل طلب الدفع PDF
          </a>
        </PublicCard>

        {d.invoices.length > 0 && (
          <PublicCard>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-primary"><ReceiptText className="size-4" />الفواتير الصادرة</h2>
            <ul className="divide-y divide-line text-sm">
              {d.invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <span><span className="num font-bold">{i.number}</span> <span className="text-xs text-muted">· {(d.company.vatRegistered ? INVOICE_LABEL[i.typeCode] : PLAIN_LABEL[i.typeCode]) ?? i.typeCode}</span></span>
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
                <h2 className="mb-1 flex items-center gap-1.5 text-base font-extrabold text-primary"><CreditCard className="size-5" />الدفع الإلكتروني</h2>
                <p className="mb-3 text-xs text-amber-800">بيئة تجريبية — لن يتم خصم أي مبلغ فعلي.</p>
                <Button className="w-full py-3 text-base" loading={pay.isPending} onClick={() => pay.mutate()}>ادفع الآن (بيئة تجريبية — مدى) · <Money value={d.due} fixed className="text-white [&_span]:text-white/80" /></Button>
                <div className="mt-2"><InlineError message={payErr} /></div>
              </PublicCard>
            )}

            <PublicCard>
              <h2 className="mb-3 flex items-center gap-1.5 text-base font-extrabold text-primary"><Landmark className="size-5" />التحويل البنكي</h2>
              {d.company.iban ? (
                <div className="space-y-3 text-sm">
                  <BankRow label="اسم المستفيد" value={d.company.legalNameAr} icon={<Building2 className="size-4" />} />
                  {d.company.bankName && <BankRow label="البنك" value={d.company.bankName} icon={<Landmark className="size-4" />} />}
                  <div className="rounded-xl border border-line bg-tint/40 p-3">
                    <div className="text-[11px] font-bold text-muted">رقم الآيبان (IBAN)</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="num break-all text-base font-extrabold tracking-wide text-ink">{formatIban(d.company.iban)}</span>
                      <Button size="sm" variant="outline" icon={<Copy className="size-3.5" />} onClick={() => copy(d.company.iban!.replace(/\s/g, ''), 'رقم الآيبان')}>نسخ</Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                    <span className="text-xs font-bold">اذكر رقم الطلب <span className="num">{d.number}</span> في وصف التحويل</span>
                    <button className="text-xs font-bold underline" onClick={() => copy(d.number, 'رقم الطلب')}>نسخ</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">تواصل معنا للحصول على بيانات الحساب البنكي.</p>
              )}
            </PublicCard>
          </>
        )}

        {!paid && !cancelled && <PublicCard className="flex flex-col items-center text-center">
          <div className={clsx('grid size-44 place-items-center overflow-hidden rounded-xl border border-line bg-white', !qr && 'animate-pulse bg-gray-50')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt="رمز QR لصفحة الدفع" className="size-full" />}
          </div>
          <p className="mt-2 text-xs text-muted">امسح الرمز لفتح صفحة الدفع على جهاز آخر</p>
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
