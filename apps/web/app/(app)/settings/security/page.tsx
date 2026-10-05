'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { AlertTriangle, Copy, Fingerprint, KeyRound, LogOut, Monitor, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Spinner } from '@/components/ui';

const PRIVILEGED = ['owner', 'general_manager', 'accountant'];

/** Better Auth client calls resolve to { data, error } — turn `error` into a thrown Error. */
async function unwrap<T>(p: Promise<{ data: T | null; error: { message?: string; status?: number; statusText?: string } | null } | { data: T; error: null }>): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(translate(r.error.message ?? r.error.statusText ?? 'خطأ غير معروف'));
  return r.data as T;
}

function translate(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid password') || m.includes('incorrect password')) return 'كلمة المرور غير صحيحة';
  if (m.includes('invalid') && m.includes('code')) return 'الرمز غير صحيح أو منتهي';
  if (m.includes('password too short')) return 'كلمة المرور قصيرة جدًا';
  if (m.includes('credential account not found')) return 'لا توجد كلمة مرور لحسابك (تدخل عبر Google أو مفتاح مرور). عيّن كلمة مرور أولًا من «نسيت كلمة المرور» في صفحة الدخول.';
  return msg;
}

export default function SecurityPage() {
  const { me, refetch } = useMe();
  if (!me) return <Spinner />;
  const privileged = me.user.roles.some((r) => PRIVILEGED.includes(r));
  return (
    <>
      <PageHeader title="أمان حسابي" subtitle={<span dir="ltr">{me.user.email}</span>} />
      {!me.user.mfaEnabled && privileged && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <b>فعّل التحقق بخطوتين الآن.</b> حسابك يملك صلاحيات حساسة (اعتماد، فوترة، إعدادات)، ولا يحميه حاليًا إلا عامل واحد.
            فعّل تطبيق المصادقة أدناه أو أضف مفتاح مرور.
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <TwoFactor enabled={me.user.mfaEnabled} onChange={refetch} />
        <Passkeys />
        <ChangePassword />
        <Sessions />
      </div>
    </>
  );
}

/* ───────────── TOTP 2FA ───────────── */

function TwoFactor({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const [mode, setMode] = useState<'enable' | 'disable' | null>(null);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Smartphone className="size-4" />التحقق بخطوتين (تطبيق المصادقة)</span>} actions={enabled ? <Badge tone="green">مفعّل</Badge> : <Badge tone="red">غير مفعّل</Badge>}>
      <p className="text-sm text-muted">رمز من 6 أرقام يتغير كل 30 ثانية من تطبيق مثل Google Authenticator أو Microsoft Authenticator، يُطلب بعد كلمة المرور.</p>
      <div className="mt-3">
        {enabled
          ? <Button variant="outline" onClick={() => setMode('disable')}>إيقاف التحقق بخطوتين</Button>
          : <Button icon={<ShieldCheck className="size-4" />} onClick={() => setMode('enable')}>تفعيل التحقق بخطوتين</Button>}
      </div>
      {mode === 'enable' && <EnableDialog onClose={() => setMode(null)} onDone={() => { setMode(null); onChange(); }} />}
      {mode === 'disable' && <DisableDialog onClose={() => setMode(null)} onDone={() => { setMode(null); onChange(); }} />}
    </Card>
  );
}

function EnableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'password' | 'scan'>('password');
  const [password, setPassword] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [backup, setBackup] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const r = await unwrap(authClient.twoFactor.enable({ password }));
      if (!r || !('totpURI' in r)) throw new Error('الخادم لم يُرجع مفتاح تطبيق المصادقة (TOTP)');
      const uri = r.totpURI;
      setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: '#0D4A2E', light: '#ffffff' } }));
      try { setSecret(new URL(uri).searchParams.get('secret')); } catch { setSecret(null); }
      setBackup(r.backupCodes ?? []);
      setPassword('');
      setStep('scan');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(null);
    try {
      await unwrap(authClient.twoFactor.verifyTotp({ code: code.trim() }));
      toast.success('تم تفعيل التحقق بخطوتين');
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const copyCodes = async () => {
    try { await navigator.clipboard.writeText(backup.join('\n')); toast.success('تم نسخ الرموز'); } catch { toast.error('تعذّر النسخ'); }
  };

  return (
    <Dialog open onClose={onClose} title="تفعيل التحقق بخطوتين" footer={step === 'password'
      ? <><Button variant="outline" onClick={onClose}>إلغاء</Button><Button loading={busy} disabled={!password} onClick={start}>متابعة</Button></>
      : <><Button variant="outline" onClick={onClose}>لاحقًا</Button><Button loading={busy} disabled={!/^\d{6}$/.test(code.trim())} onClick={verify}>تأكيد التفعيل</Button></>}>
      {step === 'password' ? (
        <form onSubmit={(e) => { e.preventDefault(); if (password) start(); }} className="space-y-3">
          <p className="text-sm text-muted">أدخل كلمة مرورك الحالية للمتابعة.</p>
          <Field label="كلمة المرور"><Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </form>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-bold">1. امسح الرمز بتطبيق المصادقة</p>
            <div className="mt-2 flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {qr && <img src={qr} alt="رمز QR لتطبيق المصادقة" className="size-52 rounded-lg border border-line" />}
              {secret && <p className="text-center text-xs text-muted">أو أدخل المفتاح يدويًا:<br /><code dir="ltr" className="select-all break-all rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-ink">{secret}</code></p>}
            </div>
          </div>
          {backup.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">2. احفظ رموز الاسترداد في مكان آمن</p>
                <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={copyCodes}>نسخ</Button>
              </div>
              <p className="text-xs text-muted">كل رمز يُستخدم مرة واحدة إذا فقدت هاتفك. لن تظهر مرة أخرى.</p>
              <div dir="ltr" className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-line bg-gray-50 p-2 font-mono text-xs sm:grid-cols-3">
                {backup.map((c) => <span key={c} className="select-all text-center">{c}</span>)}
              </div>
            </div>
          )}
          <Field label={`${backup.length ? '3' : '2'}. أدخل الرمز المكوّن من 6 أرقام من التطبيق`}>
            <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center font-mono text-lg tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && /^\d{6}$/.test(code)) verify(); }} />
          </Field>
        </div>
      )}
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}

function DisableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await unwrap(authClient.twoFactor.disable({ password }));
      toast.success('تم إيقاف التحقق بخطوتين');
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="إيقاف التحقق بخطوتين" footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button variant="danger" loading={busy} disabled={!password} onClick={submit}>إيقاف</Button></>}>
      <p className="mb-3 text-sm text-muted">سيصبح حسابك محميًا بكلمة المرور فقط. أدخل كلمة المرور للتأكيد.</p>
      <Field label="كلمة المرور"><Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Dialog>
  );
}

/* ───────────── Passkeys ───────────── */

interface PasskeyRow { id: string; name?: string | null; createdAt: Date | string; deviceType?: string }

function Passkeys() {
  const q = useQuery({ queryKey: ['my-passkeys'], queryFn: () => unwrap(authClient.passkey.listUserPasskeys()).then((r) => (r ?? []) as PasskeyRow[]) });
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PasskeyRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const add = async () => {
    setAdding(true); setError(null);
    try {
      const r = await authClient.passkey.addPasskey({ name: name.trim() || defaultDeviceName() });
      if (r?.error) throw new Error(translate(r.error.message ?? 'تعذّر إضافة مفتاح المرور'));
      toast.success('تمت إضافة مفتاح المرور');
      setName('');
      q.refetch();
    } catch (e) { setError(e); } finally { setAdding(false); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true); setError(null);
    try {
      await unwrap(authClient.passkey.deletePasskey({ id: removing.id }));
      toast.success('تم حذف مفتاح المرور');
      setRemoving(null);
      q.refetch();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Fingerprint className="size-4" />مفاتيح المرور (Passkeys)</span>}>
      <p className="text-sm text-muted">ادخل ببصمة الإصبع أو الوجه أو قفل الجهاز بدل كلمة المرور — أسرع وأكثر أمانًا ومقاوم للتصيّد.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الجهاز (مثلًا: جوالي)" className="max-w-xs flex-1" />
        <Button loading={adding} icon={<KeyRound className="size-4" />} onClick={add}>إضافة مفتاح مرور</Button>
      </div>
      <div className="mt-3"><ErrorBox error={error ?? q.error} /></div>
      {q.isLoading ? <Spinner /> : (q.data ?? []).length === 0 ? <p className="mt-3 text-sm text-muted">لا توجد مفاتيح مرور بعد.</p> : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {q.data!.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div>
                <div className="text-sm font-bold">{p.name || 'مفتاح مرور'}</div>
                <div className="text-xs text-muted">أضيف في {dateTime(typeof p.createdAt === 'string' ? p.createdAt : new Date(p.createdAt))}{p.deviceType === 'multiDevice' ? ' · متزامن عبر الأجهزة' : ''}</div>
              </div>
              <Button size="sm" variant="ghost" aria-label="حذف" onClick={() => setRemoving(p)}><Trash2 className="size-4 text-danger" /></Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!removing} onClose={() => setRemoving(null)} title="حذف مفتاح المرور" footer={<><Button variant="outline" onClick={() => setRemoving(null)}>إلغاء</Button><Button variant="danger" loading={busy} onClick={remove}>حذف</Button></>}>
        <p className="text-sm">حذف «{removing?.name || 'مفتاح مرور'}»؟ لن تتمكن من الدخول به بعد ذلك.</p>
      </Dialog>
    </Card>
  );
}

function defaultDeviceName(): string {
  if (typeof navigator === 'undefined') return 'جهازي';
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'جهازي';
}

/* ───────────── Change password ───────────── */

function ChangePassword() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = confirm.length > 0 && confirm !== next;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooShort || mismatch || !cur || !next) return;
    setBusy(true); setError(null);
    try {
      await unwrap(authClient.changePassword({ currentPassword: cur, newPassword: next, revokeOtherSessions: true }));
      toast.success('تم تغيير كلمة المرور وتسجيل الخروج من الأجهزة الأخرى');
      setCur(''); setNext(''); setConfirm('');
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Card title={<span className="inline-flex items-center gap-2"><KeyRound className="size-4" />تغيير كلمة المرور</span>}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="كلمة المرور الحالية"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="كلمة المرور الجديدة" error={tooShort ? '12 حرفًا على الأقل' : null} hint="12 حرفًا على الأقل؛ يُفضَّل عبارة طويلة يسهل تذكرها"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="تأكيد كلمة المرور الجديدة" error={mismatch ? 'غير مطابقة' : null}><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">سيتم تسجيل خروجك من جميع الأجهزة الأخرى.</span>
          <Button loading={busy} disabled={!cur || !next || tooShort || mismatch || confirm !== next}>تغيير</Button>
        </div>
      </form>
    </Card>
  );
}

/* ───────────── Sessions ───────────── */

interface SessionRow { id: string; token: string; createdAt: Date | string; updatedAt?: Date | string; expiresAt: Date | string; ipAddress?: string | null; userAgent?: string | null }

function describeUA(ua: string | null | undefined): string {
  if (!ua) return 'جهاز غير معروف';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' — ') || 'متصفح';
}

function Sessions() {
  const current = authClient.useSession();
  const q = useQuery({ queryKey: ['my-sessions'], queryFn: () => unwrap(authClient.listSessions()).then((r) => (r ?? []) as SessionRow[]) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const currentToken = current.data?.session?.token;
  const rows = [...(q.data ?? [])].sort((a, b) => (a.token === currentToken ? -1 : b.token === currentToken ? 1 : new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()));
  const others = rows.filter((s) => s.token !== currentToken).length;
  const revokeOthers = async () => {
    setBusy(true); setError(null);
    try {
      await unwrap(authClient.revokeOtherSessions());
      toast.success('تم تسجيل الخروج من الأجهزة الأخرى');
      q.refetch();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const iso = (d: Date | string | undefined) => (d ? (typeof d === 'string' ? d : d.toISOString()) : null);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Monitor className="size-4" />الجلسات النشطة</span>} actions={<Button size="sm" variant="outline" loading={busy} disabled={others === 0} icon={<LogOut className="size-3.5" />} onClick={revokeOthers}>تسجيل الخروج من الأجهزة الأخرى</Button>}>
      <ErrorBox error={error ?? q.error} />
      {q.isLoading ? <Spinner /> : rows.length === 0 ? <Empty title="لا توجد جلسات" /> : (
        <ul className="divide-y divide-line">
          {rows.map((s) => (
            <li key={s.id} className="flex items-start gap-3 py-2">
              <Monitor className="mt-0.5 size-4 shrink-0 text-gold" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-bold">{describeUA(s.userAgent)}{s.token === currentToken && <Badge tone="green">هذا الجهاز</Badge>}</div>
                <div className="text-xs text-muted">
                  {s.ipAddress && <span dir="ltr" className="num">{s.ipAddress}</span>}{s.ipAddress && ' · '}
                  آخر نشاط {dateTime(iso(s.updatedAt ?? s.createdAt))} · تنتهي {dateTime(iso(s.expiresAt))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
