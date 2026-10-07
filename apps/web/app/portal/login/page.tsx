'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, KeyRound, MessageCircle, Smartphone } from 'lucide-react';
import { normalizeSaudiMobile, westernDigits } from '@mmc/domain';
import { Button, Input, clsx } from '@/components/ui';
import { InlineError, PublicCard, PublicShell } from '@/app/_public/public-shell';
import { useI18n } from '@/lib/i18n';
import { portalFetch } from '../_components/portal-api';

type Step = 'phone' | 'code' | 'select';
const RESEND_SECONDS = 60;

interface VerifyOk { account: { id: string; name: string | null; phone: string }; party: { id: string; nameAr: string }; expiresAt: string }
interface VerifySelect { needsSelection: true; accounts: { accountId: string; partyName: string }[] }

/** Only same-portal paths are accepted as ?next= (no open redirect). */
function safeNext(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\/portal(\/|$|\?)/.test(s) && !s.startsWith('/portal/login') ? s : '/portal';
}

export default function PortalLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = use(searchParams);
  const next = safeNext(sp.next);
  const { bi } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>('phone');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [accounts, setAccounts] = useState<VerifySelect['accounts']>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);
  const submitted = useRef<string | null>(null);

  // already signed in → straight to the portal
  useEffect(() => {
    portalFetch('/me', { redirectOn401: false }).then(() => router.replace(next)).catch(() => { /* not signed in */ });
  }, [next, router]);

  useEffect(() => {
    if (step !== 'code' && step !== 'select') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const p = normalizeSaudiMobile(phoneRaw);
    if (!p) { setError(bi('أدخل رقم جوال سعودي صحيح يبدأ بـ 05 (مثل 0512345678).', 'Enter a valid Saudi mobile starting with 05 (e.g. 0512345678).')); return; }
    setBusy(true);
    try {
      await portalFetch('/login/request', { body: { phone: p }, redirectOn401: false });
      setPhone(p);
      setCode('');
      submitted.current = null;
      setStep('code');
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setNow(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(c: string, accountId?: string | null) {
    if (!phone) return;
    setError(null);
    setBusy(true);
    try {
      const r = await portalFetch<VerifyOk | VerifySelect>('/login/verify', { body: { phone, code: c, accountId: accountId ?? null }, redirectOn401: false });
      if ('needsSelection' in r) {
        setAccounts(r.accounts);
        setChosen(r.accounts[0]?.accountId ?? null);
        setStep('select');
        return;
      }
      qc.removeQueries({ queryKey: ['portal'] });
      // full navigation: the new session cookie is in place for every request of the portal shell
      window.location.replace(next);
    } catch (err) {
      setError((err as Error).message);
      submitted.current = null;
    } finally {
      setBusy(false);
    }
  }

  function onCodeChange(v: string) {
    const digits = westernDigits(v).replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    // auto-submit once all 6 digits are in (paste / SMS autofill), once per value
    if (digits.length === 6 && submitted.current !== digits && !busy) {
      submitted.current = digits;
      void verify(digits);
    }
  }

  return (
    <PublicShell narrow privateLink={false} subtitle={bi('بوابة العملاء', 'Customer portal')}>
      <PublicCard>
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary-50 text-primary">
            {step === 'phone' ? <Smartphone className="size-6" aria-hidden /> : step === 'code' ? <KeyRound className="size-6" aria-hidden /> : <Building2 className="size-6" aria-hidden />}
          </span>
          <div>
            <h1 className="text-xl font-extrabold text-ink">
              {step === 'phone' ? bi('الدخول إلى بوابة العملاء', 'Sign in to the customer portal') : step === 'code' ? bi('أدخل رمز التحقق', 'Enter the verification code') : bi('اختر الجهة', 'Choose the account')}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {step === 'phone'
                ? bi('تابع أجهزتك وطلبات الصيانة والفواتير. الدخول برمز يصلك على واتساب.', 'Follow your devices, service requests and invoices. Sign in with a code sent by WhatsApp.')
                : step === 'select' ? bi('رقمك مسجل لأكثر من جهة — اختر الجهة التي تريد فتحها.', 'Your number is registered for more than one customer — choose which one to open.') : null}
            </p>
          </div>
        </div>

        {step === 'phone' && (
          <form onSubmit={requestCode} className="space-y-4" noValidate>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('رقم الجوال', 'Mobile number')}</span>
              <Input
                type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required autoFocus
                placeholder="05XXXXXXXX" value={phoneRaw} onChange={(e) => setPhoneRaw(e.target.value)}
                className="text-center text-lg tracking-wider" aria-describedby="phone-hint"
              />
              <span id="phone-hint" className="mt-1 block text-xs text-muted">{bi('رقم الجوال المسجل لدينا (يقبل الأرقام العربية).', 'The mobile number registered with us (Arabic digits are fine).')}</span>
            </label>
            <InlineError message={error} />
            <Button type="submit" className="w-full py-3 text-base" loading={busy} icon={<MessageCircle className="size-4" aria-hidden />}>{bi('أرسل الرمز عبر واتساب', 'Send the code by WhatsApp')}</Button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={(e) => { e.preventDefault(); if (code.length === 6) { submitted.current = code; void verify(code); } }} className="space-y-4" noValidate>
            <div role="status" className="rounded-lg border border-primary/15 bg-primary-50 px-3 py-2 text-sm text-primary">
              {bi('إذا كان هذا الرقم مسجلًا لدينا فسيصلك رمز من 6 أرقام عبر واتساب على', 'If this number is registered with us, you will receive a 6-digit code by WhatsApp on')}{' '}
              <span className="num font-bold" dir="ltr">{phone}</span>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('رمز التحقق', 'Verification code')}</span>
              <Input
                ref={codeRef} type="text" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={12} required
                pattern="[0-9]{6}" placeholder="• • • • • •" value={code} onChange={(e) => onCodeChange(e.target.value)}
                className="text-center text-2xl font-extrabold tracking-[0.5em]" aria-describedby="code-hint"
              />
              <span id="code-hint" className="mt-1 block text-xs text-muted">{bi('الرمز صالح لمدة 10 دقائق.', 'The code is valid for 10 minutes.')}</span>
            </label>
            <InlineError message={error} />
            <Button type="submit" className="w-full py-3 text-base" loading={busy} disabled={code.length !== 6}>{bi('دخول', 'Sign in')}</Button>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <button type="button" className="rounded font-bold text-gold-dark hover:underline" onClick={() => { setStep('phone'); setError(null); }}>{bi('تغيير الرقم', 'Change number')}</button>
              <button type="button" disabled={secondsLeft > 0 || busy} onClick={() => requestCode()} className={clsx('rounded font-bold', secondsLeft > 0 ? 'text-muted' : 'text-primary hover:underline')}>
                {secondsLeft > 0 ? <>{bi('إعادة الإرسال بعد', 'Resend in')} <span className="num" dir="ltr">{secondsLeft}</span> {bi('ث', 's')}</> : bi('إعادة إرسال الرمز', 'Resend the code')}
              </button>
            </div>
          </form>
        )}

        {step === 'select' && (
          <form onSubmit={(e) => { e.preventDefault(); if (chosen) void verify(code, chosen); }} className="space-y-4">
            <fieldset>
              <legend className="sr-only">{bi('الجهة', 'Account')}</legend>
              <div className="space-y-2">
                {accounts.map((a) => (
                  <label key={a.accountId} className={clsx('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition focus-within:ring-2 focus-within:ring-gold/40', chosen === a.accountId ? 'border-gold bg-tint/60' : 'border-line bg-white hover:bg-tint/30')}>
                    <input type="radio" name="account" value={a.accountId} checked={chosen === a.accountId} onChange={() => setChosen(a.accountId)} className="size-4 accent-[var(--color-primary)]" />
                    <Building2 className="size-4 text-gold-dark" aria-hidden />
                    <span className="font-bold text-ink">{a.partyName}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <InlineError message={error} />
            <Button type="submit" className="w-full py-3 text-base" loading={busy} disabled={!chosen}>{bi('متابعة', 'Continue')}</Button>
            <button type="button" className="w-full rounded text-sm font-bold text-gold-dark hover:underline" onClick={() => { setStep('phone'); setError(null); setCode(''); }}>{bi('البدء من جديد', 'Start over')}</button>
          </form>
        )}
      </PublicCard>
      <p className="mt-4 text-center text-xs text-muted">{bi('لا تملك حسابًا في البوابة؟ تواصل مع فريق المدى المبارك لتفعيله.', 'No portal account yet? Contact the Al-Mada Al-Mubarak team to activate one.')}</p>
    </PublicShell>
  );
}
