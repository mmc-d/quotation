'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PROJECT_STAGES, type ProjectStage } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Button, clsx, Dialog, Empty, Field, Input, Select } from '@/components/ui';
import { UserSelect } from '@/components/user-select';
import { ConfirmDialog } from '../../quotes/_components/common';
import { stageLabel, type useProjectAction } from './kit';
import type { ProjectView, Task } from './types';

export function TasksTab({ p, action }: { p: ProjectView; action: ReturnType<typeof useProjectAction> }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const canWrite = can('project.write');
  const [adding, setAdding] = useState<null | { title: string; stage: ProjectStage; dueDate: string; assigneeId: string | null }>(null);
  const [del, setDel] = useState<Task | null>(null);
  const todayStr = today();

  const toggle = (t: Task) => action.run(`task:${t.id}`, () => api.put(`/projects/tasks/${t.id}`, { status: t.status === 'done' ? 'todo' : 'done' }));
  const add = async () => {
    if (!adding) return;
    const r = await action.run('add-task', () => api.post(`/projects/${p.id}/tasks`, { title: adding.title.trim(), stage: adding.stage, dueDate: adding.dueDate || null, assigneeId: adding.assigneeId }), bi('أُضيفت المهمة', 'Task added'));
    if (r) setAdding(null);
  };
  const remove = async () => {
    if (!del) return;
    const r = await action.run(`del:${del.id}`, () => api.del(`/projects/tasks/${del.id}`), bi('حُذفت المهمة', 'Task deleted'));
    if (r) setDel(null);
  };

  const stages = PROJECT_STAGES.filter((s) => p.tasks.some((t) => t.stage === s));
  const done = p.tasks.filter((t) => t.status === 'done').length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{bi(`${done} من ${p.tasks.length} مكتملة`, `${done} of ${p.tasks.length} done`)}</span>
        {canWrite && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setAdding({ title: '', stage: p.stage, dueDate: '', assigneeId: null })}>{bi('إضافة مهمة', 'Add task')}</Button>}
      </div>
      {p.tasks.length === 0 ? <Empty title={bi('لا توجد مهام', 'No tasks')} /> : (
        <div className="space-y-4">
          {stages.map((s) => {
            const list = p.tasks.filter((t) => t.stage === s);
            return (
              <section key={s}>
                <h3 className="mb-1.5 flex items-center gap-2 text-xs font-extrabold text-gold-dark">
                  {stageLabel(s, locale)}
                  {s === p.stage && <Badge tone="green">{bi('المرحلة الحالية', 'Current stage')}</Badge>}
                  <span className="num font-normal text-muted">{list.filter((t) => t.status === 'done').length}/{list.length}</span>
                </h3>
                <ul className="divide-y divide-line/70 rounded-xl border border-line">
                  {list.map((t) => {
                    const overdue = t.status !== 'done' && t.dueDate && t.dueDate < todayStr;
                    return (
                      <li key={t.id} className="flex items-start gap-3 px-3 py-2">
                        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]" checked={t.status === 'done'} disabled={!canWrite || action.busy === `task:${t.id}`}
                          onChange={() => void toggle(t)} aria-label={bi('تم', 'Done')} />
                        <div className="min-w-0 flex-1">
                          <div className={clsx('text-sm', t.status === 'done' && 'text-muted line-through')}>{t.title}</div>
                          <div className="flex flex-wrap gap-x-3 text-[11px] text-muted">
                            {t.assigneeName && <span>{t.assigneeName}</span>}
                            {t.dueDate && <span className={clsx('num', overdue && 'font-bold text-danger')}>{bi('الاستحقاق', 'Due')} {date(t.dueDate)}</span>}
                            {t.locationPath && <span>{t.locationPath}</span>}
                          </div>
                        </div>
                        {canWrite && <button type="button" onClick={() => setDel(t)} className="rounded p-1 text-muted hover:bg-rose-50 hover:text-danger" aria-label={bi('حذف المهمة', 'Delete task')}><Trash2 className="size-4" /></button>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={!!adding} onClose={() => setAdding(null)} title={bi('مهمة جديدة', 'New task')}
        footer={<><Button variant="outline" onClick={() => setAdding(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={action.busy === 'add-task'} disabled={!adding?.title.trim()} onClick={() => void add()}>{bi('إضافة', 'Add')}</Button></>}>
        {adding && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={bi('المهمة *', 'Task *')} className="sm:col-span-2"><Input value={adding.title} autoFocus onChange={(e) => setAdding({ ...adding, title: e.target.value })} /></Field>
            <Field label={bi('المرحلة', 'Stage')}>
              <Select value={adding.stage} onChange={(e) => setAdding({ ...adding, stage: e.target.value as ProjectStage })}>
                {PROJECT_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s, locale)}</option>)}
              </Select>
            </Field>
            <Field label={bi('تاريخ الاستحقاق', 'Due date')}><Input type="date" value={adding.dueDate} onChange={(e) => setAdding({ ...adding, dueDate: e.target.value })} /></Field>
            <Field label={bi('المسؤول', 'Assignee')} className="sm:col-span-2"><UserSelect value={adding.assigneeId} onChange={(v) => setAdding({ ...adding, assigneeId: v })} /></Field>
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!del} danger title={bi('حذف المهمة', 'Delete task')} confirmLabel={bi('حذف', 'Delete')} loading={!!del && action.busy === `del:${del.id}`} onClose={() => setDel(null)} onConfirm={() => void remove()}
        message={del && bi(`حذف «${del.title}»؟`, `Delete “${del.title}”?`)} />
    </div>
  );
}
