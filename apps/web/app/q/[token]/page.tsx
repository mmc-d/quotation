'use client';
import { use, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Download, FileX2, History, MessageSquareText, PartyPopper, ShieldCheck, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react';
import { tafqitHalalas } from '@mmc/domain';
import { date } from '@/lib/format';
import { Badge, Button, Field, Input, Money, Textarea, clsx } from '@/components/ui';
import { InlineError, PublicCard, PublicLoading, PublicShell, PublicState, publicFetch } from '@/app/_public/public-shell';
import { useI18n } from '@/lib/i18n';

interface QuoteView {
  company: { legalNameAr: string; legalNameEn: string | null; vatRegistered: boolean; phone: string | null };
  number: string; revision: number; date: string; validUntil: string | null; status: string;
  clientName: string | null; projectName: string | null;
  lines: { code: string; description: string; qty: string | number; unitPrice: string; amount: number; listAmount: number; isFree: boolean; struck: boolean; isOptional: boolean; imageUrl: string | null }[];
  totals: { subtotal: number; discount: number; taxable: number; vat: number; total: number; vatApplied: boolean; vatRate: number | string; optionalTotal: number };
  notes: string | null; terms: string | null;
  canAccept: boolean; expired: boolean; superseded: boolean; mobileHint: string | null;
}

type Decision = 'accept' | 'reject';

export default function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['public-quote', token], queryFn: () => publicFetch<QuoteView>(`/quotes/${token}`), retry: false });
  const [justDecided, setJustDecided] = useState<'accepted' | 'rejected' | null>(null);

  if (q.isLoading) return <PublicLoading />;
  if (q.error || !q.data) {
    return (
      <PublicShell narrow>
        <PublicState icon={<FileX2 className="size-8" />} tone="danger" title={bi('تعذر فتح العرض', 'Could not open the quote')}>{(q.error as Error)?.message ?? bi('الرابط غير صالح أو انتهت صلاحيته.', 'This link is invalid or has expired.')}</PublicState>
      </PublicShell>
    );
  }
  const d = q.data;
  const vatPct = Number(d.totals.vatRate);

  return (
    <PublicShell companyName={d.company.legalNameAr} subtitle={<>{bi('عرض سعر', 'Quote')}<br /><span className="num">{d.number}</span></>}>
      <div className="space-y-4">
        <DecisionBanner d={d} justDecided={justDecided} />

        <PublicCard>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-gold-dark">{bi('عرض سعر', 'Quote')}</div>
              <h1 className="num text-2xl font-extrabold text-primary">{d.number}</h1>
              {d.revision > 0 && <Badge tone="gold">{bi('مراجعة رقم', 'Revision')} {d.revision}</Badge>}
            </div>
            <a href={`/api/public/quotes/${token}/pdf`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-bold text-ink transition hover:bg-tint">
              <Download className="size-4" />{bi('تحميل PDF', 'Download PDF')}
            </a>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Info label={bi('العميل', 'Customer')} value={d.clientName ?? '—'} />
            <Info label={bi('المشروع', 'Project')} value={d.projectName ?? '—'} />
            <Info label={bi('تاريخ العرض', 'Quote date')} value={<span className="num">{date(d.date)}</span>} />
            <Info label={bi('صالح حتى', 'Valid until')} value={<span className={clsx('num', d.expired && 'text-danger')}>{date(d.validUntil)}</span>} />
          </dl>
        </PublicCard>

        <PublicCard className="!p-0">
          <h2 className="border-b border-line px-4 py-3 text-sm font-extrabold text-primary sm:px-6">{bi('البنود', 'Items')}</h2>
          <ul className="divide-y divide-line">
            {d.lines.map((l, i) => (
              <li key={i} className={clsx('flex gap-3 px-4 py-3 sm:px-6', l.isOptional && 'bg-tint/30')}>
                {/^(https?:\/\/|\/api\/public\/)/.test(l.imageUrl ?? '') && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.imageUrl!} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg border border-line bg-white object-contain" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="num rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-muted">{l.code}</span>
                    {l.isOptional && <Badge tone="gold">{bi('اختياري — غير مشمول في الإجمالي', 'Optional — not included in the total')}</Badge>}
                    {l.isFree && <Badge tone="green">{bi('مجاني', 'Free')}</Badge>}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink">{l.description}</p>
                  <div className="mt-1 text-xs text-muted">
                    {bi('الكمية', 'Qty')} <span className="num font-bold text-ink">{Number(l.qty).toLocaleString('en')}</span>
                    <span className="mx-1.5">×</span>
                    {bi('سعر الوحدة', 'Unit price')} <Money value={l.unitPrice} fixed />
                  </div>
                </div>
                <div className="shrink-0 text-end">
                  {l.struck && l.listAmount > l.amount && <div className="text-xs text-muted line-through"><Money value={l.listAmount} fixed /></div>}
                  {l.isFree ? <div className="font-extrabold text-ok">{bi('مجانًا', 'Free')}</div> : <div className="font-extrabold"><Money value={l.amount} fixed /></div>}
                </div>
              </li>
            ))}
          </ul>
          <div className="space-y-1.5 border-t border-line bg-tint/40 px-4 py-4 text-sm sm:px-6">
            <Row label={bi('المجموع', 'Subtotal')} value={<Money value={d.totals.subtotal} fixed />} />
            {d.totals.discount > 0 && <Row label={bi('الخصم', 'Discount')} value={<span className="text-ok">− <Money value={d.totals.discount} fixed /></span>} />}
            {d.totals.vatApplied && <Row label={bi(`ضريبة القيمة المضافة ${vatPct}%`, `VAT ${vatPct}%`)} value={<Money value={d.totals.vat} fixed />} />}
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
              <span className="font-extrabold text-primary">{bi(`الإجمالي${d.totals.vatApplied ? ' شامل الضريبة' : ''}`, `Total${d.totals.vatApplied ? ' incl. VAT' : ''}`)}</span>
              <span className="text-2xl font-extrabold text-primary"><Money value={d.totals.total} fixed /></span>
            </div>
            <p lang="ar" dir="rtl" className="text-xs leading-relaxed text-gold-dark">فقط {tafqitHalalas(d.totals.total)} لا غير</p>
            {d.totals.optionalTotal > 0 && <p className="text-xs text-muted">{bi('البنود الاختيارية (غير مشمولة):', 'Optional items (not included):')} <Money value={d.totals.optionalTotal} fixed /></p>}
            {!d.company.vatRegistered && <p className="text-xs text-muted">{bi('المنشأة غير مسجلة في ضريبة القيمة المضافة.', 'The seller is not registered for VAT.')}</p>}
          </div>
        </PublicCard>

        {(d.notes || d.terms) && (
          <PublicCard>
            {d.notes && (<><h2 className="mb-1.5 text-sm font-extrabold text-primary">{bi('ملاحظات', 'Notes')}</h2><p className="whitespace-pre-line text-sm leading-relaxed text-ink">{d.notes}</p></>)}
            {d.terms && (<><h2 className={clsx('mb-1.5 text-sm font-extrabold text-primary', d.notes && 'mt-4')}>{bi('الشروط والأحكام', 'Terms and conditions')}</h2><p className="whitespace-pre-line text-sm leading-relaxed text-ink">{d.terms}</p></>)}
          </PublicCard>
        )}

        {d.canAccept && !justDecided && <DecisionFlow token={token} d={d} onDecided={setJustDecided} />}

        {d.company.phone && <p className="text-center text-xs text-muted">{bi('للاستفسار:', 'Enquiries:')} <a href={`tel:${d.company.phone}`} className="num font-bold text-primary">{d.company.phone}</a></p>}
      </div>
    </PublicShell>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt className="text-[11px] font-bold text-muted">{label}</dt><dd className="mt-0.5 font-bold text-ink">{value}</dd></div>;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-baseline justify-between"><span className="text-muted">{label}</span><span className="font-bold">{value}</span></div>;
}

function DecisionBanner({ d, justDecided }: { d: QuoteView; justDecided: 'accepted' | 'rejected' | null }) {
  const { bi } = useI18n();
  if (justDecided === 'accepted') {
    return <PublicState icon={<PartyPopper className="size-8" />} title={bi('🎉 شكرًا لك — تم قبول العرض', '🎉 Thank you — quote accepted')}>{bi('تم توثيق موافقتك برمز التحقق. سيتواصل معك فريقنا قريبًا لإعداد العقد وجدولة التنفيذ.', 'Your acceptance has been verified with the code. Our team will contact you soon to prepare the contract and schedule the work.')}</PublicState>;
  }
  if (justDecided === 'rejected') {
    return <PublicState icon={<XCircle className="size-8" />} tone="muted" title={bi('تم تسجيل رفضك للعرض', 'Your rejection has been recorded')}>{bi('شكرًا لوقتك. يسعدنا تعديل العرض بما يناسبك — تواصل مع مندوب المبيعات.', 'Thank you for your time. We would be happy to adjust the quote for you — please contact your sales representative.')}</PublicState>;
  }
  if (d.status === 'accepted') return <PublicState icon={<CheckCircle2 className="size-8" />} title={bi('تم قبول هذا العرض مسبقًا', 'This quote has already been accepted')}>{bi('العرض مقبول ولا يتطلب أي إجراء إضافي منك.', 'The quote is accepted and needs no further action from you.')}</PublicState>;
  if (d.status === 'rejected') return <PublicState icon={<XCircle className="size-8" />} tone="muted" title={bi('تم رفض هذا العرض', 'This quote was rejected')}>{bi('إن رغبت في عرض جديد تواصل مع مندوب المبيعات.', 'If you would like a new quote, please contact your sales representative.')}</PublicState>;
  if (d.superseded) return <PublicState icon={<History className="size-8" />} tone="gold" title={bi('يوجد إصدار أحدث من هذا العرض', 'A newer version of this quote exists')}>{bi('هذه نسخة سابقة — يرجى استخدام الرابط الأحدث الذي أُرسل إليك.', 'This is an earlier version — please use the latest link sent to you.')}</PublicState>;
  if (d.expired) return <PublicState icon={<CalendarClock className="size-8" />} tone="gold" title={bi('انتهت صلاحية هذا العرض', 'This quote has expired')}>{bi('انتهت مدة صلاحية العرض في', 'This quote expired on')} <span className="num">{date(d.validUntil)}</span>. {bi('تواصل معنا لتحديث الأسعار.', 'Contact us to update the prices.')}</PublicState>;
  return null;
}

function DecisionFlow({ token, d, onDecided }: { token: string; d: QuoteView; onDecided: (s: 'accepted' | 'rejected') => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const sendOtp = useMutation({
    mutationFn: () => publicFetch<{ sentTo: string; expiresInMinutes: number }>(`/quotes/${token}/otp`, {}),
    onSuccess: (r) => { setSentTo(r.sentTo); setOtp(''); setErr(null); },
    onError: (e: Error) => setErr(e.message),
  });
  const decide = useMutation({
    mutationFn: () => publicFetch<{ status: 'accepted' | 'rejected' }>(`/quotes/${token}/decision`, { otp, signerName: name.trim(), decision, reason: decision === 'reject' ? reason.trim() || null : null }),
    onSuccess: (r) => { onDecided(r.status); qc.invalidateQueries({ queryKey: ['public-quote', token] }); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    onError: (e: Error) => setErr(e.message),
  });

  if (!decision) {
    return (
      <PublicCard>
        <h2 className="text-base font-extrabold text-primary">{bi('هل توافق على هذا العرض؟', 'Do you accept this quote?')}</h2>
        <p className="mt-1 text-sm text-muted">{bi('يتم التوثيق برمز تحقق يُرسل عبر واتساب إلى الجوال المسجل', 'Verified with a code sent by WhatsApp to the registered mobile')}{d.mobileHint ? <> (<span className="num">{d.mobileHint}</span>)</> : null}.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button className="py-3 text-base" icon={<ThumbsUp className="size-5" />} onClick={() => setDecision('accept')}>{bi('قبول العرض', 'Accept quote')}</Button>
          <Button variant="outline" className="py-3 text-base" icon={<ThumbsDown className="size-5" />} onClick={() => setDecision('reject')}>{bi('رفض العرض', 'Reject quote')}</Button>
        </div>
      </PublicCard>
    );
  }

  const accept = decision === 'accept';
  const valid = /^\d{6}$/.test(otp) && name.trim().length >= 2;
  return (
    <PublicCard className={clsx('border-2', accept ? 'border-primary/30' : 'border-rose-200')}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-extrabold text-primary">{accept ? bi('قبول العرض', 'Accept quote') : bi('رفض العرض', 'Reject quote')}</h2>
        <button className="text-xs font-bold text-gold-dark hover:underline" onClick={() => { setDecision(null); setErr(null); }}>{bi('تغيير', 'Change')}</button>
      </div>

      <ol className="space-y-4">
        <li className="flex gap-3">
          <Step n={1} done={!!sentTo} />
          <div className="flex-1">
            <div className="text-sm font-bold">{bi('إرسال رمز التحقق', 'Send verification code')}</div>
            {sentTo ? (
              <p className="mt-1 text-sm text-muted">{bi('أُرسل رمز من 6 أرقام عبر واتساب إلى', 'A 6-digit code was sent by WhatsApp to')} <b className="num text-ink">{sentTo}</b>. <button className="font-bold text-gold-dark hover:underline disabled:opacity-50" disabled={sendOtp.isPending} onClick={() => sendOtp.mutate()}>{bi('إعادة الإرسال', 'Resend')}</button></p>
            ) : (
              <Button className="mt-2" variant={accept ? 'primary' : 'outline'} loading={sendOtp.isPending} icon={<MessageSquareText className="size-4" />} onClick={() => sendOtp.mutate()}>{bi('إرسال رمز التحقق', 'Send verification code')}</Button>
            )}
            {!sentTo && <div className="mt-2"><InlineError message={err} /></div>}
          </div>
        </li>
        <li className={clsx('flex gap-3', !sentTo && 'opacity-50')}>
          <Step n={2} done={false} />
          <form className="flex-1 space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) decide.mutate(); }}>
            <div className="text-sm font-bold">{accept ? bi('أدخل الرمز واسمك للتوقيع', 'Enter the code and your name to sign') : bi('أدخل الرمز واسمك لتأكيد الرفض', 'Enter the code and your name to confirm the rejection')}</div>
            <Field label={bi('رمز التحقق', 'Verification code')}>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={!sentTo} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} className="num text-center text-xl tracking-[.5em]" placeholder="••••••" />
            </Field>
            <Field label={bi('الاسم الكامل', 'Full name')} hint={accept ? bi('يُعد إدخال اسمك مع رمز التحقق توقيعًا إلكترونيًا بالموافقة على العرض.', 'Entering your name with the verification code counts as your electronic signature accepting the quote.') : undefined}>
              <Input disabled={!sentTo} value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
            </Field>
            {!accept && (
              <Field label={bi('سبب الرفض (اختياري)', 'Reason for rejection (optional)')}>
                <Textarea disabled={!sentTo} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={bi('السعر، المواصفات، التوقيت…', 'Price, specifications, timing…')} />
              </Field>
            )}
            <InlineError message={sentTo ? err : null} />
            <Button className="w-full py-3 text-base" variant={accept ? 'primary' : 'danger'} disabled={!sentTo || !valid} loading={decide.isPending} icon={accept ? <ShieldCheck className="size-5" /> : <ThumbsDown className="size-5" />}>
              {accept ? bi('أوافق على العرض', 'I accept the quote') : bi('تأكيد رفض العرض', 'Confirm rejection')}
            </Button>
          </form>
        </li>
      </ol>
    </PublicCard>
  );
}

function Step({ n, done }: { n: number; done: boolean }) {
  return <span className={clsx('grid size-7 shrink-0 place-items-center rounded-full text-sm font-extrabold', done ? 'bg-primary text-white' : 'bg-tint text-gold-dark')}>{done ? <CheckCircle2 className="size-4" /> : <span className="num">{n}</span>}</span>;
}
