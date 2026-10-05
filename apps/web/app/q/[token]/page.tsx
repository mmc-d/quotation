'use client';
import { use, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Download, FileX2, History, MessageSquareText, PartyPopper, ShieldCheck, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react';
import { tafqitHalalas } from '@mmc/domain';
import { date } from '@/lib/format';
import { Badge, Button, Field, Input, Money, Textarea, clsx } from '@/components/ui';
import { InlineError, PublicCard, PublicLoading, PublicShell, PublicState, publicFetch } from '@/app/_public/public-shell';

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
  const q = useQuery({ queryKey: ['public-quote', token], queryFn: () => publicFetch<QuoteView>(`/quotes/${token}`), retry: false });
  const [justDecided, setJustDecided] = useState<'accepted' | 'rejected' | null>(null);

  if (q.isLoading) return <PublicLoading />;
  if (q.error || !q.data) {
    return (
      <PublicShell narrow>
        <PublicState icon={<FileX2 className="size-8" />} tone="danger" title="تعذر فتح العرض">{(q.error as Error)?.message ?? 'الرابط غير صالح أو انتهت صلاحيته.'}</PublicState>
      </PublicShell>
    );
  }
  const d = q.data;
  const vatPct = Number(d.totals.vatRate);

  return (
    <PublicShell companyName={d.company.legalNameAr} subtitle={<>عرض سعر<br /><span className="num">{d.number}</span></>}>
      <div className="space-y-4">
        <DecisionBanner d={d} justDecided={justDecided} />

        <PublicCard>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-gold-dark">عرض سعر</div>
              <h1 className="num text-2xl font-extrabold text-primary">{d.number}</h1>
              {d.revision > 0 && <Badge tone="gold">مراجعة رقم {d.revision}</Badge>}
            </div>
            <a href={`/api/public/quotes/${token}/pdf`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-bold text-ink transition hover:bg-tint">
              <Download className="size-4" />تحميل PDF
            </a>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Info label="العميل" value={d.clientName ?? '—'} />
            <Info label="المشروع" value={d.projectName ?? '—'} />
            <Info label="تاريخ العرض" value={<span className="num">{date(d.date)}</span>} />
            <Info label="صالح حتى" value={<span className={clsx('num', d.expired && 'text-danger')}>{date(d.validUntil)}</span>} />
          </dl>
        </PublicCard>

        <PublicCard className="!p-0">
          <h2 className="border-b border-line px-4 py-3 text-sm font-extrabold text-primary sm:px-6">البنود</h2>
          <ul className="divide-y divide-line">
            {d.lines.map((l, i) => (
              <li key={i} className={clsx('flex gap-3 px-4 py-3 sm:px-6', l.isOptional && 'bg-tint/30')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="num rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-muted">{l.code}</span>
                    {l.isOptional && <Badge tone="gold">اختياري — غير مشمول في الإجمالي</Badge>}
                    {l.isFree && <Badge tone="green">مجاني</Badge>}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink">{l.description}</p>
                  <div className="mt-1 text-xs text-muted">
                    الكمية <span className="num font-bold text-ink">{Number(l.qty).toLocaleString('en')}</span>
                    <span className="mx-1.5">×</span>
                    سعر الوحدة <Money value={l.unitPrice} fixed />
                  </div>
                </div>
                <div className="shrink-0 text-end">
                  {l.struck && l.listAmount > l.amount && <div className="text-xs text-muted line-through"><Money value={l.listAmount} fixed /></div>}
                  {l.isFree ? <div className="font-extrabold text-ok">مجانًا</div> : <div className="font-extrabold"><Money value={l.amount} fixed /></div>}
                </div>
              </li>
            ))}
          </ul>
          <div className="space-y-1.5 border-t border-line bg-tint/40 px-4 py-4 text-sm sm:px-6">
            <Row label="المجموع" value={<Money value={d.totals.subtotal} fixed />} />
            {d.totals.discount > 0 && <Row label="الخصم" value={<span className="text-ok">− <Money value={d.totals.discount} fixed /></span>} />}
            {d.totals.vatApplied && <Row label={`ضريبة القيمة المضافة ${vatPct}%`} value={<Money value={d.totals.vat} fixed />} />}
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
              <span className="font-extrabold text-primary">الإجمالي{d.totals.vatApplied ? ' شامل الضريبة' : ''}</span>
              <span className="text-2xl font-extrabold text-primary"><Money value={d.totals.total} fixed /></span>
            </div>
            <p className="text-xs leading-relaxed text-gold-dark">فقط {tafqitHalalas(d.totals.total)} لا غير</p>
            {d.totals.optionalTotal > 0 && <p className="text-xs text-muted">البنود الاختيارية (غير مشمولة): <Money value={d.totals.optionalTotal} fixed /></p>}
            {!d.company.vatRegistered && <p className="text-xs text-muted">المنشأة غير مسجلة في ضريبة القيمة المضافة.</p>}
          </div>
        </PublicCard>

        {(d.notes || d.terms) && (
          <PublicCard>
            {d.notes && (<><h2 className="mb-1.5 text-sm font-extrabold text-primary">ملاحظات</h2><p className="whitespace-pre-line text-sm leading-relaxed text-ink">{d.notes}</p></>)}
            {d.terms && (<><h2 className={clsx('mb-1.5 text-sm font-extrabold text-primary', d.notes && 'mt-4')}>الشروط والأحكام</h2><p className="whitespace-pre-line text-sm leading-relaxed text-ink">{d.terms}</p></>)}
          </PublicCard>
        )}

        {d.canAccept && !justDecided && <DecisionFlow token={token} d={d} onDecided={setJustDecided} />}

        {d.company.phone && <p className="text-center text-xs text-muted">للاستفسار: <a href={`tel:${d.company.phone}`} className="num font-bold text-primary">{d.company.phone}</a></p>}
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
  if (justDecided === 'accepted') {
    return <PublicState icon={<PartyPopper className="size-8" />} title="🎉 شكرًا لك — تم قبول العرض">تم توثيق موافقتك برمز التحقق. سيتواصل معك فريقنا قريبًا لإعداد العقد وجدولة التنفيذ.</PublicState>;
  }
  if (justDecided === 'rejected') {
    return <PublicState icon={<XCircle className="size-8" />} tone="muted" title="تم تسجيل رفضك للعرض">شكرًا لوقتك. يسعدنا تعديل العرض بما يناسبك — تواصل مع مندوب المبيعات.</PublicState>;
  }
  if (d.status === 'accepted') return <PublicState icon={<CheckCircle2 className="size-8" />} title="تم قبول هذا العرض مسبقًا">العرض مقبول ولا يتطلب أي إجراء إضافي منك.</PublicState>;
  if (d.status === 'rejected') return <PublicState icon={<XCircle className="size-8" />} tone="muted" title="تم رفض هذا العرض">إن رغبت في عرض جديد تواصل مع مندوب المبيعات.</PublicState>;
  if (d.superseded) return <PublicState icon={<History className="size-8" />} tone="gold" title="يوجد إصدار أحدث من هذا العرض">هذه نسخة سابقة — يرجى استخدام الرابط الأحدث الذي أُرسل إليك.</PublicState>;
  if (d.expired) return <PublicState icon={<CalendarClock className="size-8" />} tone="gold" title="انتهت صلاحية هذا العرض">انتهت مدة صلاحية العرض في <span className="num">{date(d.validUntil)}</span>. تواصل معنا لتحديث الأسعار.</PublicState>;
  return null;
}

function DecisionFlow({ token, d, onDecided }: { token: string; d: QuoteView; onDecided: (s: 'accepted' | 'rejected') => void }) {
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
        <h2 className="text-base font-extrabold text-primary">هل توافق على هذا العرض؟</h2>
        <p className="mt-1 text-sm text-muted">يتم التوثيق برمز تحقق يُرسل عبر واتساب إلى الجوال المسجل{d.mobileHint ? <> (<span className="num">{d.mobileHint}</span>)</> : null}.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button className="py-3 text-base" icon={<ThumbsUp className="size-5" />} onClick={() => setDecision('accept')}>قبول العرض</Button>
          <Button variant="outline" className="py-3 text-base" icon={<ThumbsDown className="size-5" />} onClick={() => setDecision('reject')}>رفض العرض</Button>
        </div>
      </PublicCard>
    );
  }

  const accept = decision === 'accept';
  const valid = /^\d{6}$/.test(otp) && name.trim().length >= 2;
  return (
    <PublicCard className={clsx('border-2', accept ? 'border-primary/30' : 'border-rose-200')}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-extrabold text-primary">{accept ? 'قبول العرض' : 'رفض العرض'}</h2>
        <button className="text-xs font-bold text-gold-dark hover:underline" onClick={() => { setDecision(null); setErr(null); }}>تغيير</button>
      </div>

      <ol className="space-y-4">
        <li className="flex gap-3">
          <Step n={1} done={!!sentTo} />
          <div className="flex-1">
            <div className="text-sm font-bold">إرسال رمز التحقق</div>
            {sentTo ? (
              <p className="mt-1 text-sm text-muted">أُرسل رمز من 6 أرقام عبر واتساب إلى <b className="num text-ink">{sentTo}</b>. <button className="font-bold text-gold-dark hover:underline disabled:opacity-50" disabled={sendOtp.isPending} onClick={() => sendOtp.mutate()}>إعادة الإرسال</button></p>
            ) : (
              <Button className="mt-2" variant={accept ? 'primary' : 'outline'} loading={sendOtp.isPending} icon={<MessageSquareText className="size-4" />} onClick={() => sendOtp.mutate()}>إرسال رمز التحقق</Button>
            )}
            {!sentTo && <div className="mt-2"><InlineError message={err} /></div>}
          </div>
        </li>
        <li className={clsx('flex gap-3', !sentTo && 'opacity-50')}>
          <Step n={2} done={false} />
          <form className="flex-1 space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) decide.mutate(); }}>
            <div className="text-sm font-bold">{accept ? 'أدخل الرمز واسمك للتوقيع' : 'أدخل الرمز واسمك لتأكيد الرفض'}</div>
            <Field label="رمز التحقق">
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={!sentTo} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} className="num text-center text-xl tracking-[.5em]" placeholder="••••••" />
            </Field>
            <Field label="الاسم الكامل" hint={accept ? 'يُعد إدخال اسمك مع رمز التحقق توقيعًا إلكترونيًا بالموافقة على العرض.' : undefined}>
              <Input disabled={!sentTo} value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
            </Field>
            {!accept && (
              <Field label="سبب الرفض (اختياري)">
                <Textarea disabled={!sentTo} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="السعر، المواصفات، التوقيت…" />
              </Field>
            )}
            <InlineError message={sentTo ? err : null} />
            <Button className="w-full py-3 text-base" variant={accept ? 'primary' : 'danger'} disabled={!sentTo || !valid} loading={decide.isPending} icon={accept ? <ShieldCheck className="size-5" /> : <ThumbsDown className="size-5" />}>
              {accept ? 'أوافق على العرض' : 'تأكيد رفض العرض'}
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
