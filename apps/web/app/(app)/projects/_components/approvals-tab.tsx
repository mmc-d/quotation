'use client';
import { useState } from 'react';
import { Check, Plus, RefreshCw, Send, X } from 'lucide-react';
import { APPROVAL_KINDS, APPROVAL_LABELS, type ApprovalKind } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Button, Dialog, Empty, Field, Input, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { ConfirmDialog, ReasonDialog } from '../../quotes/_components/common';
import { MapChip, type useProjectAction } from './kit';
import { APPROVAL_STATUS, type Approval, type ApprovalGroup, type ProjectView } from './types';

export function ApprovalsTab({ p, action }: { p: ProjectView; action: ReturnType<typeof useProjectAction> }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const canWrite = can('project.write');
  const kindLabel = (k: string, g?: ApprovalGroup) => { const l = g?.label ?? APPROVAL_LABELS[k as ApprovalKind]; return l ? (locale === 'en' ? l.en : l.ar) : k; };

  const [approveFor, setApproveFor] = useState<Approval | null>(null);
  const [approveForm, setApproveForm] = useState({ approvedOn: today(), approvedByName: '' });
  const [rejectFor, setRejectFor] = useState<Approval | null>(null);
  const [reviseFor, setReviseFor] = useState<Approval | null>(null);
  const [adding, setAdding] = useState<null | { kind: string; title: string; notes: string }>(null);

  const existing = new Set(p.approvals.map((g) => g.kind));
  const required = (p.requiredApprovals ?? []) as string[];
  const missing = APPROVAL_KINDS.filter((k) => !existing.has(k));
  const addable = APPROVAL_KINDS.filter((k) => k === 'other' || !existing.has(k));

  const step = (a: Approval, what: 'send' | 'approve' | 'reject' | 'revise', body?: unknown, msg?: string) =>
    action.run(`${what}:${a.id}`, () => api.post(`/projects/approvals/${a.id}/${what}`, body ?? {}), msg);

  const startAdd = (kind: string) => setAdding({ kind, title: kindLabel(kind), notes: '' });
  const add = async () => {
    if (!adding) return;
    const r = await action.run('add-approval', () => api.post(`/projects/${p.id}/approvals`, { kind: adding.kind, title: adding.title.trim(), notes: adding.notes.trim() || null }), bi('أُضيفت حزمة الاعتماد', 'Approval package added'));
    if (r) setAdding(null);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{bi('اعتمادات العميل المطلوبة تبدأ مدة التوريد. كل تعديل يُنشئ مراجعة جديدة.', 'The required client approvals start the delivery clock. Each change creates a new revision.')}</p>
        {canWrite && addable.length > 0 && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => startAdd(missing.find((k) => required.includes(k)) ?? addable[0]!)}>{bi('إضافة اعتماد', 'Add approval')}</Button>}
      </div>
      {p.approvals.length === 0 && missing.filter((k) => required.includes(k)).length === 0 ? (
        <Empty title={bi('لا توجد اعتمادات', 'No approvals')} />
      ) : (
        <Table>
          <thead><tr><Th>{bi('النوع', 'Kind')}</Th><Th>{bi('العنوان', 'Title')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('المراجعة', 'Rev.')}</Th><Th>{bi('الاعتماد', 'Approved')}</Th>{canWrite && <Th />}</tr></thead>
          <tbody>
            {p.approvals.map((g) => {
              const a = g.latest;
              return (
                <tr key={g.kind + a.id} className="align-top">
                  <Td><div className="font-bold">{kindLabel(g.kind, g)}</div>{g.required && <Badge tone="gold">{bi('مطلوب', 'Required')}</Badge>}</Td>
                  <Td>
                    <div>{a.title}</div>
                    {a.notes && <div className="text-xs text-muted">{a.notes}</div>}
                    {a.status === 'rejected' && a.rejectionReason && <div className="text-xs text-danger">{bi('سبب الرفض:', 'Rejected:')} {a.rejectionReason}</div>}
                    {g.history.length > 1 && <div className="text-[11px] text-muted">{bi(`${g.history.length} مراجعات`, `${g.history.length} revisions`)}</div>}
                  </Td>
                  <Td><MapChip map={APPROVAL_STATUS} value={a.status} /></Td>
                  <Td><span className="num" dir="ltr">R{a.revision}</span></Td>
                  <Td className="text-xs">{a.approvedOn ? <><div className="num font-bold">{date(a.approvedOn)}</div><div className="text-muted">{a.approvedByName}</div></> : '—'}</Td>
                  {canWrite && (
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1">
                        {a.status === 'draft' && <Button size="sm" variant="outline" icon={<Send className="size-3.5" />} loading={action.busy === `send:${a.id}`} onClick={() => void step(a, 'send', undefined, bi('عُلّم كمرسل للعميل', 'Marked as sent to the client'))}>{bi('إرسال', 'Send')}</Button>}
                        {['draft', 'sent'].includes(a.status) && <Button size="sm" icon={<Check className="size-3.5" />} onClick={() => { setApproveForm({ approvedOn: today(), approvedByName: p.customer?.nameAr ?? '' }); setApproveFor(a); }}>{bi('اعتماد', 'Approve')}</Button>}
                        {['draft', 'sent'].includes(a.status) && <Button size="sm" variant="outline" icon={<X className="size-3.5" />} onClick={() => setRejectFor(a)}>{bi('رفض', 'Reject')}</Button>}
                        {a.status !== 'superseded' && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => setReviseFor(a)}>{bi('مراجعة جديدة', 'Revise')}</Button>}
                      </div>
                    </Td>
                  )}
                </tr>
              );
            })}
            {missing.filter((k) => required.includes(k)).map((k) => (
              <tr key={`missing-${k}`}>
                <Td><div className="font-bold">{kindLabel(k)}</div><Badge tone="gold">{bi('مطلوب', 'Required')}</Badge></Td>
                <Td colSpan={4} className="text-xs text-danger">{bi('لم تُنشأ حزمة الاعتماد بعد', 'No approval package yet')}</Td>
                {canWrite && <Td><div className="flex justify-end"><Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => startAdd(k)}>{bi('إنشاء', 'Create')}</Button></div></Td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={!!approveFor} onClose={() => setApproveFor(null)} title={bi('تسجيل اعتماد العميل', 'Record client approval')}
        footer={<><Button variant="outline" onClick={() => setApproveFor(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={!!approveFor && action.busy === `approve:${approveFor.id}`} disabled={!approveForm.approvedOn || !approveForm.approvedByName.trim()}
          onClick={() => approveFor && void step(approveFor, 'approve', { approvedOn: approveForm.approvedOn, approvedByName: approveForm.approvedByName.trim() }, bi('تم تسجيل الاعتماد', 'Approval recorded')).then((r) => r && setApproveFor(null))}>{bi('اعتماد', 'Approve')}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bi('تاريخ الاعتماد *', 'Approval date *')}><Input type="date" max={today()} value={approveForm.approvedOn} onChange={(e) => setApproveForm({ ...approveForm, approvedOn: e.target.value })} /></Field>
          <Field label={bi('اعتمده (الاسم) *', 'Approved by (name) *')}><Input value={approveForm.approvedByName} onChange={(e) => setApproveForm({ ...approveForm, approvedByName: e.target.value })} /></Field>
        </div>
      </Dialog>
      <ReasonDialog open={!!rejectFor} required danger title={bi('رفض الاعتماد', 'Reject approval')} confirmLabel={bi('رفض', 'Reject')} loading={!!rejectFor && action.busy === `reject:${rejectFor.id}`}
        onClose={() => setRejectFor(null)} onConfirm={(reason) => rejectFor && void step(rejectFor, 'reject', { reason }, bi('سُجّل الرفض', 'Rejection recorded')).then((r) => r && setRejectFor(null))} />
      <ConfirmDialog open={!!reviseFor} title={bi('مراجعة جديدة', 'New revision')} loading={!!reviseFor && action.busy === `revise:${reviseFor.id}`} onClose={() => setReviseFor(null)}
        message={bi('ستُستبدل هذه النسخة بمراجعة جديدة (مسودة) ولن تُحتسب النسخة الحالية بعد الآن.', 'This revision will be superseded by a new draft revision and will no longer count.')}
        onConfirm={() => reviseFor && void step(reviseFor, 'revise', {}, bi('أُنشئت مراجعة جديدة', 'New revision created')).then((r) => r && setReviseFor(null))} />

      <Dialog open={!!adding} onClose={() => setAdding(null)} title={bi('إضافة حزمة اعتماد', 'Add approval package')}
        footer={<><Button variant="outline" onClick={() => setAdding(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={action.busy === 'add-approval'} disabled={!adding?.title.trim()} onClick={() => void add()}>{bi('إضافة', 'Add')}</Button></>}>
        {adding && (
          <div className="grid gap-3">
            <Field label={bi('النوع *', 'Kind *')}>
              <Select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value, title: adding.title === kindLabel(adding.kind) ? kindLabel(e.target.value) : adding.title })}>
                {addable.map((k) => <option key={k} value={k}>{kindLabel(k)}{required.includes(k) ? ` (${bi('مطلوب', 'required')})` : ''}</option>)}
              </Select>
            </Field>
            <Field label={bi('العنوان *', 'Title *')}><Input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} /></Field>
            <Field label={bi('ملاحظات', 'Notes')}><Textarea rows={3} value={adding.notes} onChange={(e) => setAdding({ ...adding, notes: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
