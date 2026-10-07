'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeftRight, CheckCircle2, ClipboardCheck, FileText, ListChecks, Truck, XCircle } from 'lucide-react';
import { InlineError, PublicCard } from '@/app/_public/public-shell';
import { Button, Dialog, Field, Input, Textarea } from '@/components/ui';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalApproval, type PortalProjectDetail } from '../../_components/portal-api';
import { usePortalMe } from '../../_components/portal-shell';
import { ClockSummary, StageStepper } from '../../_components/project-kit';
import { ErrorBlock, Loading, Num, PageTitle, PortalStatus, sectionTitle } from '../../_components/portal-ui';
import { WorkOrderRow } from '../../_components/work-order-row';

type Decision = { approval: PortalApproval; to: 'approve' | 'reject' } | null;

function fmtSize(n: number) {
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['portal', 'project', id], queryFn: () => portalFetch<PortalProjectDetail>(`/projects/${id}`), retry: portalRetry });
  const [decision, setDecision] = useState<Decision>(null);
  const back = { href: '/portal/projects', label: bi('المشاريع', 'Projects') };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <><PageTitle title={bi('المشروع', 'Project')} back={back} /><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></>;
  const p = q.data;
  const waiting = p.approvals.filter((a) => a.canDecide);
  const others = p.approvals.filter((a) => !a.canDecide);
  const lbl = (l: { ar: string; en: string } | null, fallback: string) => (l ? bi(l.ar, l.en) : fallback);

  return (
    <div className="space-y-4">
      <PageTitle back={back} title={p.name ?? p.number} subtitle={<><Num>{p.number}</Num>{p.site && <> · {p.site.name}{p.site.city ? ` — ${p.site.city}` : ''}</>}</>} actions={<PortalStatus status={p.status} />} />

      <PublicCard>
        <h2 className={sectionTitle}><ListChecks className="size-4" aria-hidden />{bi('مراحل المشروع', 'Project stages')}</h2>
        <StageStepper stage={p.stage} />
        {p.nextStep && (
          <div className="mt-4 rounded-xl border border-line bg-tint/40 p-3">
            <div className="flex items-center gap-1.5 text-sm font-extrabold text-primary"><ArrowLeftRight className="size-4" aria-hidden />{bi('الخطوة التالية', 'Next step')}: {lbl(p.nextStep.toLabel, p.nextStep.to)}</div>
            {p.nextStep.pending.length > 0 ? (
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-ink marker:text-gold">
                {p.nextStep.pending.map((x) => <li key={x.key}>{bi(x.ar, x.en)}</li>)}
              </ul>
            ) : <p className="mt-1 text-sm text-muted">{bi('كل المتطلبات مكتملة — سينتقل فريقنا للمرحلة التالية.', 'All requirements are met — our team will move to the next stage.')}</p>}
          </div>
        )}
      </PublicCard>

      <PublicCard>
        <h2 className={sectionTitle}>{bi('مدة التنفيذ', 'Delivery period')}</h2>
        <ClockSummary clock={p.clock} />
      </PublicCard>

      <PublicCard className={waiting.length ? 'border-2 border-gold' : undefined}>
        <h2 className={sectionTitle}><ClipboardCheck className="size-4" aria-hidden />{bi('اعتمادات بانتظار قرارك', 'Approvals awaiting your decision')}</h2>
        {waiting.length === 0
          ? <p className="text-sm text-muted">{bi('لا توجد اعتمادات مطلوبة منك حاليًا.', 'Nothing needs your approval right now.')}</p>
          : <ul className="space-y-3">{waiting.map((a) => <ApprovalCard key={a.id} a={a} onDecide={(to) => setDecision({ approval: a, to })} />)}</ul>}
      </PublicCard>

      {others.length > 0 && (
        <PublicCard>
          <h2 className={sectionTitle}>{bi('الاعتمادات السابقة', 'Previous approvals')}</h2>
          <ul className="space-y-3">{others.map((a) => <ApprovalCard key={a.id} a={a} />)}</ul>
        </PublicCard>
      )}

      {p.workOrders.length > 0 && (
        <PublicCard>
          <h2 className={sectionTitle}><Truck className="size-4" aria-hidden />{bi('زيارات الفريق', 'Team visits')}</h2>
          <ul className="divide-y divide-line">{p.workOrders.map((w) => <WorkOrderRow key={w.id} w={w} />)}</ul>
        </PublicCard>
      )}

      <DecisionDialog projectId={p.id} decision={decision} onClose={() => setDecision(null)} />
    </div>
  );
}

function ApprovalCard({ a, onDecide }: { a: PortalApproval; onDecide?: (to: 'approve' | 'reject') => void }) {
  const { bi } = useI18n();
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-extrabold text-ink">{a.label ? bi(a.label.ar, a.label.en) : a.kind}{a.revision > 0 && <span className="ms-1.5 text-xs font-bold text-gold-dark">{bi('مراجعة', 'Rev.')} <Num>{a.revision}</Num></span>}</div>
          {a.title && <p className="text-sm text-ink">{a.title}</p>}
        </div>
        <PortalStatus status={a.status} />
      </div>
      {a.notes && <p className="mt-2 whitespace-pre-line rounded-lg bg-tint/40 px-3 py-2 text-sm text-ink">{a.notes}</p>}
      {a.files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {a.files.map((f) => (
            <li key={f.id}>
              <a href={f.url} target="_blank" rel="noopener" className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm font-bold text-primary hover:bg-tint">
                <FileText className="size-4 shrink-0" aria-hidden /><span className="truncate">{f.filename}</span><Num className="shrink-0 text-xs font-normal text-muted">{fmtSize(f.size)}</Num>
              </a>
            </li>
          ))}
        </ul>
      )}
      {a.status === 'approved' && <p className="mt-2 text-xs text-muted">{bi('اعتمده', 'Approved by')} <b className="text-ink">{a.approvedByName ?? '—'}</b> {bi('بتاريخ', 'on')} <Num>{date(a.approvedOn)}</Num></p>}
      {a.status === 'rejected' && a.rejectionReason && <p className="mt-2 text-xs text-danger">{bi('سبب الرفض', 'Reason for rejection')}: {a.rejectionReason}</p>}
      {onDecide && a.canDecide && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => onDecide('approve')} icon={<CheckCircle2 className="size-4" aria-hidden />}>{bi('اعتماد', 'Approve')}</Button>
          <Button variant="outline" onClick={() => onDecide('reject')} icon={<XCircle className="size-4 text-danger" aria-hidden />}>{bi('رفض / طلب تعديل', 'Reject / ask for changes')}</Button>
        </div>
      )}
    </li>
  );
}

function DecisionDialog({ projectId, decision, onClose }: { projectId: string; decision: Decision; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const me = usePortalMe();
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const a = decision?.approval;
  const approve = decision?.to === 'approve';

  // reset the form whenever a different approval / decision is opened
  const key = decision ? `${decision.approval.id}:${decision.to}` : null;
  if (key !== lastId) {
    setLastId(key);
    setName(me.data?.account.name ?? '');
    setReason('');
    setError(null);
  }

  const m = useMutation({
    mutationFn: () => portalFetch(`/projects/${projectId}/approvals/${a!.id}/${approve ? 'approve' : 'reject'}`, { body: approve ? { approvedByName: name.trim() } : { reason: reason.trim() } }),
    onSuccess: () => {
      toast.success(approve ? bi('تم الاعتماد — شكرًا لك', 'Approved — thank you') : bi('تم إرسال الرفض لفريق المشروع', 'Your rejection was sent to the project team'));
      qc.invalidateQueries({ queryKey: ['portal', 'project', projectId] });
      qc.invalidateQueries({ queryKey: ['portal', 'projects'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const valid = approve ? name.trim().length >= 2 : reason.trim().length >= 2;
  const label = a?.label ? bi(a.label.ar, a.label.en) : a?.kind ?? '';

  return (
    <Dialog
      open={!!decision}
      onClose={() => { if (!m.isPending) onClose(); }}
      title={approve ? bi('تأكيد الاعتماد', 'Confirm approval') : bi('رفض الاعتماد', 'Reject the approval')}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={m.isPending}>{bi('إلغاء', 'Cancel')}</Button>
        <Button variant={approve ? 'primary' : 'danger'} loading={m.isPending} disabled={!valid} onClick={() => { setError(null); m.mutate(); }}>
          {approve ? bi('أؤكد الاعتماد', 'I confirm the approval') : bi('إرسال الرفض', 'Send the rejection')}
        </Button>
      </>}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (valid && !m.isPending) m.mutate(); }} className="space-y-3">
        <p className="text-sm text-ink">
          {approve
            ? bi(`باعتمادك «${label}» تؤكد أنك راجعت الملفات المرفقة وأنها مطابقة لطلبك. سيُسجَّل الاعتماد باسمك وتاريخ اليوم.`, `By approving “${label}” you confirm you have reviewed the attached files and they match your request. The approval is recorded with your name and today's date.`)
            : bi(`اكتب سبب رفض «${label}» أو التعديلات المطلوبة، وسيرسل فريق المشروع نسخة معدلة.`, `Write why you reject “${label}” or the changes you need; the project team will send a revised version.`)}
        </p>
        {approve ? (
          <Field label={bi('الاسم الكامل للمعتمِد', 'Full name of the approver')} error={name && name.trim().length < 2 ? bi('الاسم مطلوب', 'Name is required') : null}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" maxLength={200} autoFocus />
          </Field>
        ) : (
          <Field label={bi('سبب الرفض / التعديلات المطلوبة', 'Reason / changes needed')}>
            <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={1000} autoFocus />
          </Field>
        )}
        <InlineError message={error} />
      </form>
    </Dialog>
  );
}
