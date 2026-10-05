'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fingerprint, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button, ErrorBox, Field, Input } from '@/components/ui';
import { LanguageToggle, useI18n } from '@/lib/i18n';

type Mode = 'signin' | 'signup' | '2fa' | 'sent';

function LoginInner() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useSearchParams();
  const next = params.get('next') || '/';
  const [mode, setMode] = useState<Mode>(params.get('step') === '2fa' ? '2fa' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((h) => setGoogle(!!h?.integrations?.googleSignIn)).catch(() => {});
    authClient.getSession().then((s) => { if (s.data) router.replace(next); });
  }, [next, router]);

  const run = async (key: string, fn: () => Promise<{ error?: { message?: string; status?: number } | null } | void>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (r && r.error) setError(r.error.status === 403 && /verif/i.test(r.error.message ?? '') ? t('login.errVerify') : r.error.message ?? t('login.errGeneric'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const signIn = () => run('password', async () => {
    const r = await authClient.signIn.email({ email, password });
    if (!r.error && !(r.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) router.replace(next);
    if ((r.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) setMode('2fa');
    return r;
  });

  const signUp = () => run('signup', async () => {
    const r = await authClient.signUp.email({ email, password, name: name || email.split('@')[0]!, callbackURL: next });
    if (!r.error) setMode('sent');
    return r;
  });

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(194,160,74,.35),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div>
            <div className="text-3xl font-extrabold">{t('shell.brand')}</div>
            <div className="mt-1 font-bold text-gold-light">{t('login.brandTag')}</div>
          </div>
          <div className="max-w-md space-y-3 text-lg leading-relaxed text-white/85">
            <p>{t('login.pitch')}</p>
            <p className="text-sm text-white/60">{t('login.pitchSub')}</p>
          </div>
          <div className="text-xs text-white/50">{t('login.hosted')}</div>
        </div>
      </div>
      <div className="relative flex items-center justify-center p-6">
        <LanguageToggle className="absolute end-4 top-4 rounded-lg border border-line px-2.5 py-1 text-xs font-bold text-ink hover:bg-black/5" />
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-extrabold text-primary">{mode === 'signup' ? t('login.titleSignup') : mode === '2fa' ? t('login.title2fa') : mode === 'sent' ? t('login.titleSent') : t('login.titleSignin')}</h1>
          <p className="mb-6 mt-1 text-sm text-muted">{mode === 'signup' ? t('login.subSignup') : mode === '2fa' ? t('login.sub2fa') : mode === 'sent' ? '' : t('login.subSignin')}</p>

          {mode === 'sent' ? (
            <div className="space-y-4">
              <div className="flex gap-3 rounded-xl border border-line bg-tint p-4 text-sm"><Mail className="size-5 shrink-0 text-gold-dark" /><span>{t('login.sentText').split('{email}')[0]}<b className="num" dir="ltr">{email}</b>{t('login.sentText').split('{email}')[1]}</span></div>
              <Button variant="outline" className="w-full" onClick={() => setMode('signin')}>{t('login.backToSignin')}</Button>
            </div>
          ) : mode === '2fa' ? (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void run('2fa', async () => { const r = await authClient.twoFactor.verifyTotp({ code, trustDevice: true }); if (!r.error) router.replace(next); return r; }); }}>
              <Field label={t('login.code')}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="num text-center text-lg tracking-[.4em]" autoFocus /></Field>
              <ErrorBox error={error ? new Error(error) : null} />
              <Button className="w-full" loading={busy === '2fa'} icon={<ShieldCheck className="size-4" />}>{t('login.verify')}</Button>
            </form>
          ) : (
            <div className="space-y-4">
              {google && (
                <Button variant="outline" className="w-full" loading={busy === 'google'} onClick={() => run('google', () => authClient.signIn.social({ provider: 'google', callbackURL: next }))}>
                  <svg className="size-4" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
                  {t('login.google')}
                </Button>
              )}
              {mode === 'signin' && (
                <Button variant="outline" className="w-full" loading={busy === 'passkey'} icon={<Fingerprint className="size-4" />} onClick={() => run('passkey', async () => { const r = await authClient.signIn.passkey(); if (!r?.error) router.replace(next); return r ?? undefined; })}>
                  {t('login.passkey')}
                </Button>
              )}
              <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />{t('login.orEmail')}<span className="h-px flex-1 bg-line" /></div>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void (mode === 'signup' ? signUp() : signIn()); }}>
                {mode === 'signup' && <Field label={t('common.name')}><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
                <Field label={t('common.email')}><Input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username webauthn" /></Field>
                <Field label={t('login.password')} hint={mode === 'signup' ? t('login.passwordHint') : undefined}><Input type="password" dir="ltr" required minLength={mode === 'signup' ? 12 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></Field>
                <ErrorBox error={error ? new Error(error) : null} />
                <Button className="w-full" loading={busy === 'password' || busy === 'signup'} icon={<KeyRound className="size-4" />}>{mode === 'signup' ? t('login.activate') : t('login.signIn')}</Button>
              </form>
              <p className="text-center text-sm text-muted">
                {mode === 'signin' ? <>{t('login.firstTime')} <button className="font-bold text-gold-dark hover:underline" onClick={() => { setMode('signup'); setError(null); }}>{t('login.activateLink')}</button></> : <button className="font-bold text-gold-dark hover:underline" onClick={() => { setMode('signin'); setError(null); }}>{t('login.haveAccount')}</button>}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
