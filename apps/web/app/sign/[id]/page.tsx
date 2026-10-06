'use client';
import { use, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSignature, FileX2, Fingerprint, FlaskConical, XCircle } from 'lucide-react';
import { Button, Field, Input, Money, clsx } from '@/components/ui';
import { InlineError, PublicCard, PublicLoading, PublicShell, PublicState, publicFetch } from '@/app/_public/public-shell';
import { useI18n } from '@/lib/i18n';

interface EsignView {
  status: string;
  signerName: string | null;
  contract: { number: string; title: string | null; total: string } | null;
  documentSha256: string | null;
  nationalIdHint: string | null;
}

function SandboxBanner() {
  const { bi } = useI18n();
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <span>{bi('بيئة تجريبية — في التشغيل الفعلي يتم التوقيع عبر تطبيق نفاذ من خلال مزود توقيع مرخّص', 'Sandbox — in production, signing is done through the Nafath app via a licensed signing provider')}</span>
    </div>
  );
}

export default function SignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['public-esign', id], queryFn: () => publicFetch<EsignView>(`/esign/${id}`), retry: false });
  const [last4, setLast4] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const complete = useMutation({
    mutationFn: (approve: boolean) => publicFetch<{ status: string }>(`/esign/${id}/complete`, { nationalIdLast4: last4, approve }),
    onSuccess: (r) => { setResult(r.status); setErr(null); qc.invalidateQueries({ queryKey: ['public-esign', id] }); },
    onError: (e: Error) => setErr(e.message),
  });

  if (q.isLoading) return <PublicLoading />;
  if (q.error || !q.data) {
    return (
      <PublicShell narrow subtitle={bi('التوقيع الإلكتروني', 'E-signature')}>
        <PublicState icon={<FileX2 className="size-8" />} tone="danger" title={bi('تعذر فتح طلب التوقيع', 'Could not open the signing request')}>{(q.error as Error)?.message ?? bi('الرابط غير صالح أو انتهت صلاحيته.', 'This link is invalid or has expired.')}</PublicState>
      </PublicShell>
    );
  }
  const d = q.data;
  const status = result ?? d.status;
  const done = status === 'signed' || status === 'declined';
  const sha = d.documentSha256;

  return (
    <PublicShell narrow subtitle={<>{bi('التوقيع الإلكتروني', 'E-signature')}<br />{bi('نفاذ', 'Nafath')}</>}>
      <div className="space-y-4">
        <SandboxBanner />

        {status === 'signed' && (
          <PublicState icon={<CheckCircle2 className="size-8" />} title={bi('تم توقيع العقد بنجاح', 'Contract signed successfully')}>
            {result ? bi('شكرًا لك', 'Thank you') : bi('هذا العقد موقّع مسبقًا', 'This contract is already signed')}{d.signerName ? bi(`، ${d.signerName}`, `, ${d.signerName}`) : ''}. {bi('سيصلك نسخة من العقد الموقّع، وسيتواصل معك فريقنا لبدء التنفيذ.', 'You will receive a copy of the signed contract, and our team will contact you to start the work.')}
          </PublicState>
        )}
        {status === 'declined' && (
          <PublicState icon={<XCircle className="size-8" />} tone="muted" title={bi('تم رفض التوقيع', 'Signing declined')}>{bi('سُجّل رفضك لتوقيع العقد وأُبلغ فريق المبيعات. يمكنك التواصل معنا لمناقشة أي تعديل.', 'Your decision not to sign has been recorded and the sales team has been notified. You can contact us to discuss any changes.')}</PublicState>
        )}

        <PublicCard>
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary"><FileSignature className="size-6" /></span>
            <div className="min-w-0">
              <div className="text-xs font-bold text-gold-dark">{bi('طلب توقيع عقد', 'Contract signing request')}</div>
              <h1 className="num text-xl font-extrabold text-primary">{d.contract?.number ?? '—'}</h1>
              {d.contract?.title && <p className="text-sm text-ink">{d.contract.title}</p>}
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <Info label={bi('الموقّع', 'Signer')} value={d.signerName ?? '—'} />
            <Info label={bi('قيمة العقد', 'Contract value')} value={d.contract ? <Money value={d.contract.total} fixed /> : '—'} />
            {d.nationalIdHint && <Info label={bi('رقم الهوية', 'ID number')} value={<span className="num">{d.nationalIdHint}</span>} />}
            <div className="col-span-2">
              <dt className="text-[11px] font-bold text-muted">{bi('بصمة المستند (SHA-256)', 'Document fingerprint (SHA-256)')}</dt>
              <dd className="mt-0.5 font-mono text-xs text-ink" dir="ltr" title={sha ?? undefined}>{sha ? `${sha.slice(0, 16)}…${sha.slice(-16)}` : '—'}</dd>
              <dd className="mt-0.5 text-[11px] text-muted">{bi('تضمن البصمة أن العقد الذي توقّعه هو نفسه المستند المرسل إليك دون أي تعديل.', 'The fingerprint guarantees that the contract you sign is exactly the document sent to you, unchanged.')}</dd>
            </div>
          </dl>
        </PublicCard>

        {!done && (
          <PublicCard>
            <h2 className="mb-1 flex items-center gap-1.5 text-base font-extrabold text-primary"><Fingerprint className="size-5" />{bi('التحقق من الهوية', 'Identity verification')}</h2>
            <p className="mb-3 text-sm text-muted">{bi('أدخل آخر 4 أرقام من رقم الهوية الوطنية', 'Enter the last 4 digits of your national ID')}{d.nationalIdHint ? <> (<span className="num">{d.nationalIdHint}</span>)</> : ''} {bi('للمتابعة.', 'to continue.')}</p>
            <form onSubmit={(e) => { e.preventDefault(); if (/^\d{4}$/.test(last4)) complete.mutate(true); }} className="space-y-3">
              <Field label={bi('آخر 4 أرقام من الهوية', 'Last 4 digits of ID')}>
                <Input inputMode="numeric" maxLength={4} autoComplete="off" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} className="num max-w-[10rem] text-center text-xl tracking-[.5em]" placeholder="••••" />
              </Field>
              <p className="text-xs leading-relaxed text-muted">{bi('بالضغط على «أوافق على التوقيع» فإنك توقّع العقد المذكور أعلاه إلكترونيًا، ويكون لهذا التوقيع الأثر النظامي للتوقيع الخطي وفق نظام التعاملات الإلكترونية.', 'By pressing “I agree to sign” you electronically sign the contract above; this signature has the same legal effect as a handwritten signature under the Electronic Transactions Law.')}</p>
              <InlineError message={err} />
              <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
                <Button className="py-3 text-base" disabled={last4.length !== 4} loading={complete.isPending && complete.variables === true} icon={<FileSignature className="size-5" />}>{bi('أوافق على التوقيع', 'I agree to sign')}</Button>
                <Button type="button" variant="outline" className={clsx('py-3 text-base text-danger')} disabled={last4.length !== 4 || complete.isPending} loading={complete.isPending && complete.variables === false} onClick={() => complete.mutate(false)}>{bi('رفض', 'Decline')}</Button>
              </div>
            </form>
          </PublicCard>
        )}
      </div>
    </PublicShell>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt className="text-[11px] font-bold text-muted">{label}</dt><dd className="mt-0.5 font-bold text-ink">{value}</dd></div>;
}
