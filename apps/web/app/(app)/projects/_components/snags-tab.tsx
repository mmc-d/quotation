'use client';
import { useState } from 'react';
import { CheckCheck, Plus, RotateCcw, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Button, clsx, Dialog, Empty, Field, Input, Table, Td, Textarea, Th } from '@/components/ui';
import { UserSelect } from '@/components/user-select';
import { AttachmentList, AttachmentPicker, type AttachmentMeta } from '@/components/attachments';
import { ReasonDialog } from '../../quotes/_components/common';
import { MapChip, type useProjectAction } from './kit';
import { SNAG_STATUS, type ProjectView, type Snag } from './types';

export function SnagsTab({ p, action }: { p: ProjectView; action: ReturnType<typeof useProjectAction> }) {
  const { bi } = useI18n();
  const { me, can } = useMe();
  const canWrite = can('project.write');
  const [adding, setAdding] = useState<null | { description: string; assigneeId: string | null; dueDate: string; photos: AttachmentMeta[] }>(null);
  const [reopen, setReopen] = useState<Snag | null>(null);
  const todayStr = today();
  const canFix = (s: Snag) => canWrite || (can('asset.write') && !!me && s.assigneeId === me.user.id);

  const add = async () => {
    if (!adding) return;
    const r = await action.run('add-snag', () => api.post(`/projects/${p.id}/snags`, { description: adding.description.trim(), assigneeId: adding.assigneeId, dueDate: adding.dueDate || null, photoFileIds: adding.photos.map((f) => f.id) }), bi('أُضيفت الملاحظة', 'Snag added'));
    if (r) setAdding(null);
  };
  const step = (s: Snag, what: 'fix' | 'verify' | 'reopen', body?: unknown, msg?: string) => action.run(`${what}:${s.id}`, () => api.post(`/projects/snags/${s.id}/${what}`, body ?? {}), msg);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{bi('يجب التحقق من إغلاق جميع الملاحظات قبل إتمام التسليم.', 'Every snag must be verified closed before handover is complete.')}</p>
        {canWrite && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setAdding({ description: '', assigneeId: null, dueDate: '', photos: [] })}>{bi('إضافة ملاحظة', 'Add snag')}</Button>}
      </div>
      {p.snags.length === 0 ? <Empty title={bi('لا توجد ملاحظات', 'No snags')} /> : (
        <Table>
          <thead><tr><Th>{bi('الملاحظة', 'Snag')}</Th><Th>{bi('الموقع', 'Location')}</Th><Th>{bi('المسؤول', 'Assignee')}</Th><Th>{bi('الاستحقاق', 'Due')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th /></tr></thead>
          <tbody>
            {p.snags.map((s) => (
              <tr key={s.id} className="align-top">
                <Td>
                  <div className="whitespace-pre-line text-sm">{s.description}</div><div className="num text-[11px] text-muted">{date(s.createdAt)}</div>
                  <AttachmentList ids={s.photoFileIds ?? []} files={p.files} size="sm" className="mt-1" />
                </Td>
                <Td className="text-xs">{s.locationPath ?? '—'}</Td>
                <Td className="text-xs">{s.assigneeName ?? '—'}</Td>
                <Td className={clsx('num whitespace-nowrap text-xs', s.status === 'open' && s.dueDate && s.dueDate < todayStr && 'font-bold text-danger')}>{date(s.dueDate)}</Td>
                <Td>
                  <MapChip map={SNAG_STATUS} value={s.status} />
                  {s.status === 'verified' && s.verifiedByName && <div className="mt-0.5 text-[11px] text-muted">{s.verifiedByName}</div>}
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1">
                    {s.status === 'open' && canFix(s) && <Button size="sm" variant="outline" icon={<Wrench className="size-3.5" />} loading={action.busy === `fix:${s.id}`} onClick={() => void step(s, 'fix', undefined, bi('عُلّمت كمُصلحة', 'Marked fixed'))}>{bi('تم الإصلاح', 'Fixed')}</Button>}
                    {s.status === 'fixed' && canWrite && <Button size="sm" icon={<CheckCheck className="size-3.5" />} loading={action.busy === `verify:${s.id}`} onClick={() => void step(s, 'verify', undefined, bi('تم التحقق', 'Verified'))}>{bi('تحقق', 'Verify')}</Button>}
                    {s.status !== 'open' && canWrite && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setReopen(s)}>{bi('إعادة فتح', 'Reopen')}</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={!!adding} onClose={() => setAdding(null)} title={bi('ملاحظة جديدة', 'New snag')}
        footer={<><Button variant="outline" onClick={() => setAdding(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={action.busy === 'add-snag'} disabled={!adding?.description.trim()} onClick={() => void add()}>{bi('إضافة', 'Add')}</Button></>}>
        {adding && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={bi('الوصف *', 'Description *')} className="sm:col-span-2"><Textarea rows={3} autoFocus value={adding.description} onChange={(e) => setAdding({ ...adding, description: e.target.value })} /></Field>
            <Field label={bi('المسؤول', 'Assignee')}><UserSelect value={adding.assigneeId} onChange={(v) => setAdding({ ...adding, assigneeId: v })} /></Field>
            <Field label={bi('تاريخ الاستحقاق', 'Due date')}><Input type="date" value={adding.dueDate} onChange={(e) => setAdding({ ...adding, dueDate: e.target.value })} /></Field>
            <Field label={bi('الصور', 'Photos')} className="sm:col-span-2">
              <AttachmentPicker value={adding.photos} onChange={(photos) => setAdding((a) => (a ? { ...a, photos } : a))} label={bi('إرفاق صور', 'Attach photos')} />
            </Field>
          </div>
        )}
      </Dialog>
      <ReasonDialog open={!!reopen} title={bi('إعادة فتح الملاحظة', 'Reopen snag')} confirmLabel={bi('إعادة فتح', 'Reopen')} loading={!!reopen && action.busy === `reopen:${reopen.id}`}
        onClose={() => setReopen(null)} onConfirm={(reason) => reopen && void step(reopen, 'reopen', { reason: reason || null }, bi('أُعيد فتح الملاحظة', 'Snag reopened')).then((r) => r && setReopen(null))} />
    </div>
  );
}
