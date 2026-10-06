'use client';
import { useMemo, useState } from 'react';
import { GanttChart, Link2, List, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
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

type View = 'list' | 'timeline';
interface TaskForm { id: string | null; title: string; stage: ProjectStage; startDate: string; dueDate: string; dependsOnId: string; assigneeId: string | null; origDue: string | null }

/** The task and every task that (transitively) depends on it — not allowed as its predecessor (cycle). */
function selfAndDependents(tasks: Task[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks) if (t.dependsOnId && out.has(t.dependsOnId) && !out.has(t.id)) { out.add(t.id); grew = true; }
  }
  return out;
}

export function TasksTab({ p, action }: { p: ProjectView; action: ReturnType<typeof useProjectAction> }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const canWrite = can('project.write');
  const [view, setView] = useState<View>('list');
  const [form, setForm] = useState<TaskForm | null>(null);
  const [del, setDel] = useState<Task | null>(null);
  const todayStr = today();
  const byId = useMemo(() => new Map(p.tasks.map((t) => [t.id, t])), [p.tasks]);

  const toggle = (t: Task) => action.run(`task:${t.id}`, () => api.put(`/projects/tasks/${t.id}`, { status: t.status === 'done' ? 'todo' : 'done' }));
  const save = async () => {
    if (!form) return;
    const body = { title: form.title.trim(), stage: form.stage, startDate: form.startDate || null, dueDate: form.dueDate || null, dependsOnId: form.dependsOnId || null, assigneeId: form.assigneeId };
    if (form.id) {
      const id = form.id;
      const r = await action.run('save-task', () => api.put<{ shifted?: unknown[] }>(`/projects/tasks/${id}`, body), bi('حُفظت المهمة', 'Task saved'));
      if (r) {
        const n = r.shifted?.length ?? 0;
        if (n) toast.info(bi(`أُزيحت ${n} مهمة تابعة بنفس عدد أيام العمل`, `${n} dependent task(s) moved by the same number of working days`));
        setForm(null);
      }
    } else {
      const r = await action.run('save-task', () => api.post(`/projects/${p.id}/tasks`, body), bi('أُضيفت المهمة', 'Task added'));
      if (r) setForm(null);
    }
  };
  const remove = async () => {
    if (!del) return;
    const r = await action.run(`del:${del.id}`, () => api.del(`/projects/tasks/${del.id}`), bi('حُذفت المهمة', 'Task deleted'));
    if (r) setDel(null);
  };
  const edit = (t: Task) => setForm({ id: t.id, title: t.title, stage: t.stage, startDate: t.startDate ?? '', dueDate: t.dueDate ?? '', dependsOnId: t.dependsOnId ?? '', assigneeId: t.assigneeId, origDue: t.dueDate });

  const stages = PROJECT_STAGES.filter((s) => p.tasks.some((t) => t.stage === s));
  const done = p.tasks.filter((t) => t.status === 'done').length;
  const blocked = form?.id ? selfAndDependents(p.tasks, form.id) : new Set<string>();
  const dateError = form && form.startDate && form.dueDate && form.startDate > form.dueDate ? bi('البداية بعد تاريخ الاستحقاق', 'Start is after the due date') : null;
  const willShift = !!form?.id && !!form.origDue && !!form.dueDate && form.dueDate > form.origDue && p.tasks.some((t) => t.dependsOnId === form.id);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{bi(`${done} من ${p.tasks.length} مكتملة`, `${done} of ${p.tasks.length} done`)}</span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-line text-xs font-bold" role="group" aria-label={bi('طريقة العرض', 'View')}>
            <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} className={clsx('inline-flex items-center gap-1 px-2.5 py-1', view === 'list' ? 'bg-primary text-white' : 'bg-white text-ink hover:bg-tint')}><List className="size-3.5" />{bi('قائمة', 'List')}</button>
            <button type="button" onClick={() => setView('timeline')} aria-pressed={view === 'timeline'} className={clsx('inline-flex items-center gap-1 border-s border-line px-2.5 py-1', view === 'timeline' ? 'bg-primary text-white' : 'bg-white text-ink hover:bg-tint')}><GanttChart className="size-3.5" />{bi('مخطط زمني', 'Timeline')}</button>
          </div>
          {canWrite && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setForm({ id: null, title: '', stage: p.stage, startDate: '', dueDate: '', dependsOnId: '', assigneeId: null, origDue: null })}>{bi('إضافة مهمة', 'Add task')}</Button>}
        </div>
      </div>
      {p.tasks.length === 0 ? <Empty title={bi('لا توجد مهام', 'No tasks')} /> : view === 'timeline' ? (
        <Timeline p={p} stages={stages} onOpen={canWrite ? edit : undefined} />
      ) : (
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
                    const pred = t.dependsOnId ? byId.get(t.dependsOnId) : undefined;
                    return (
                      <li key={t.id} className="flex items-start gap-3 px-3 py-2">
                        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]" checked={t.status === 'done'} disabled={!canWrite || action.busy === `task:${t.id}`}
                          onChange={() => void toggle(t)} aria-label={bi('تم', 'Done')} />
                        <div className="min-w-0 flex-1">
                          <div className={clsx('text-sm', t.status === 'done' && 'text-muted line-through')}>{t.title}</div>
                          <div className="flex flex-wrap gap-x-3 text-[11px] text-muted">
                            {t.assigneeName && <span>{t.assigneeName}</span>}
                            {t.startDate && <span>{bi('البداية', 'Start')} <span dir="ltr" className="num">{date(t.startDate)}</span></span>}
                            {t.dueDate && <span className={clsx(overdue && 'font-bold text-danger')}>{bi('الاستحقاق', 'Due')} <span dir="ltr" className="num">{date(t.dueDate)}</span></span>}
                            {pred && <span className="inline-flex items-center gap-0.5"><Link2 className="size-3" />{bi('بعد', 'after')} «{pred.title}»</span>}
                            {t.locationPath && <span>{t.locationPath}</span>}
                          </div>
                        </div>
                        {canWrite && <button type="button" onClick={() => edit(t)} className="rounded p-1 text-muted hover:bg-tint hover:text-primary" aria-label={bi('تعديل المهمة', 'Edit task')}><Pencil className="size-4" /></button>}
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

      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? bi('تعديل المهمة', 'Edit task') : bi('مهمة جديدة', 'New task')}
        footer={<><Button variant="outline" onClick={() => setForm(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={action.busy === 'save-task'} disabled={!form?.title.trim() || !!dateError} onClick={() => void save()}>{form?.id ? bi('حفظ', 'Save') : bi('إضافة', 'Add')}</Button></>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={bi('المهمة *', 'Task *')} className="sm:col-span-2"><Input value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label={bi('المرحلة', 'Stage')}>
              <Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as ProjectStage })}>
                {PROJECT_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s, locale)}</option>)}
              </Select>
            </Field>
            <Field label={bi('تعتمد على (تبدأ بعد انتهاء)', 'Depends on (starts after)')}>
              <Select value={form.dependsOnId} onChange={(e) => setForm({ ...form, dependsOnId: e.target.value })}>
                <option value="">{bi('— لا شيء —', '— None —')}</option>
                {p.tasks.filter((t) => !blocked.has(t.id)).map((t) => <option key={t.id} value={t.id}>{stageLabel(t.stage, locale)} · {t.title}</option>)}
              </Select>
            </Field>
            <Field label={bi('تاريخ البداية', 'Start date')}><Input type="date" dir="ltr" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label={bi('تاريخ الاستحقاق', 'Due date')} error={dateError}
              hint={willShift ? bi('ستُزاح المهام التابعة بنفس عدد أيام العمل.', 'Dependent tasks will move by the same number of working days.') : undefined}>
              <Input type="date" dir="ltr" value={form.dueDate} min={form.startDate || undefined} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
            <Field label={bi('المسؤول', 'Assignee')} className="sm:col-span-2"><UserSelect value={form.assigneeId} onChange={(v) => setForm({ ...form, assigneeId: v })} /></Field>
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!del} danger title={bi('حذف المهمة', 'Delete task')} confirmLabel={bi('حذف', 'Delete')} loading={!!del && action.busy === `del:${del.id}`} onClose={() => setDel(null)} onConfirm={() => void remove()}
        message={del && bi(`حذف «${del.title}»؟`, `Delete “${del.title}”?`)} />
    </div>
  );
}

// ───────────── timeline ─────────────

const DAY = 86_400_000;
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
const fromDayNum = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/**
 * Horizontal bars per task from its start to its due date across the project's date range, grouped by
 * stage, with a "today" line. Positions use inset-inline-start / inline-size, so in Arabic the time
 * axis runs right → left. (Positioned elements never carry `num`, which would force LTR.)
 */
function Timeline({ p, stages, onOpen }: { p: ProjectView; stages: ProjectStage[]; onOpen?: (t: Task) => void }) {
  const { bi, locale } = useI18n();
  const todayStr = today();
  const dated = p.tasks.filter((t) => t.startDate || t.dueDate);
  if (!dated.length) return <Empty title={bi('لا توجد مهام مؤرخة', 'No dated tasks')} hint={bi('أضف تاريخ بداية أو استحقاق للمهام لتظهر في المخطط الزمني.', 'Give tasks a start or due date to see them on the timeline.')} />;
  const days = dated.flatMap((t) => [t.startDate, t.dueDate].filter((x): x is string => !!x).map(dayNum));
  if (p.plannedStart) days.push(dayNum(p.plannedStart));
  if (p.clock.targetMax) days.push(dayNum(p.clock.targetMax));
  const tNow = dayNum(todayStr);
  const min = Math.min(...days, tNow) - 1;
  const max = Math.max(...days, tNow) + 2;
  const span = max - min;
  const pct = (n: number) => `${((n - min) / span) * 100}%`;
  const step = Math.max(1, Math.ceil(span / 8 / 7) * 7); // weekly ticks, ~8 labels
  const ticks: number[] = [];
  for (let n = min + 1; n < max; n += step) ticks.push(n);
  const byId = new Map(p.tasks.map((t) => [t.id, t]));
  const todayLine = <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger/70" style={{ insetInlineStart: pct(tNow) }} />;

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <div className="min-w-[44rem]">
          <div className="flex border-b border-line bg-tint/40 text-[10px] text-muted">
            <div className="w-48 shrink-0 px-2 py-1.5 font-bold">{bi('المهمة', 'Task')}</div>
            <div className="relative h-7 flex-1 overflow-hidden">
              {ticks.map((n) => (
                <span key={n} className="absolute top-0 h-full border-s border-line/70 ps-1 pt-1.5 whitespace-nowrap" style={{ insetInlineStart: pct(n) }}>
                  <span dir="ltr" className="num">{fromDayNum(n).slice(5)}</span>
                </span>
              ))}
              {todayLine}
            </div>
          </div>
          {stages.map((s) => (
            <section key={s}>
              <div className="flex border-b border-line/70">
                <div className="w-48 shrink-0 px-2 py-1 text-[11px] font-extrabold text-gold-dark">{stageLabel(s, locale)}</div>
                <div className="relative flex-1">{todayLine}</div>
              </div>
              {p.tasks.filter((t) => t.stage === s).map((t) => {
                const a = t.startDate ?? t.dueDate;
                const b = t.dueDate ?? t.startDate;
                const from = a ? dayNum(a) : null;
                const to = b ? dayNum(b) + 1 : null; // the due day is included
                const overdue = t.status !== 'done' && !!t.dueDate && t.dueDate < todayStr;
                const pred = t.dependsOnId ? byId.get(t.dependsOnId) : undefined;
                const tip = [t.title, t.startDate ? `${bi('البداية', 'Start')} ${t.startDate}` : null, t.dueDate ? `${bi('الاستحقاق', 'Due')} ${t.dueDate}` : null, pred ? `${bi('بعد', 'after')} «${pred.title}»` : null, t.assigneeName].filter(Boolean).join('\n');
                return (
                  <div key={t.id} className="flex border-b border-line/50 last:border-0 hover:bg-tint/30">
                    <div className="w-48 shrink-0 truncate px-2 py-1.5 text-xs" title={tip}>
                      {pred && <Link2 className="me-1 inline size-3 text-muted" />}
                      <span className={clsx(t.status === 'done' && 'text-muted line-through')}>{t.title}</span>
                    </div>
                    <div className="relative h-8 flex-1">
                      {todayLine}
                      {from !== null && to !== null && (
                        <button type="button" disabled={!onOpen} onClick={() => onOpen?.(t)} title={tip} aria-label={tip}
                          className={clsx('absolute top-1.5 h-5 rounded-md shadow-sm transition disabled:cursor-default', onOpen && 'hover:ring-2 hover:ring-gold',
                            t.status === 'done' ? 'bg-emerald-500/80' : overdue ? 'bg-rose-500' : t.status === 'doing' ? 'bg-gold' : 'bg-primary/80')}
                          style={{ insetInlineStart: pct(from), inlineSize: `max(0.375rem, ${((to - from) / span) * 100}%)` }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-0.5 bg-danger/70" />{bi('اليوم', 'Today')}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-primary/80" />{bi('قيد الانتظار', 'To do')}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-gold" />{bi('جارٍ', 'In progress')}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-emerald-500/80" />{bi('مكتملة', 'Done')}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-rose-500" />{bi('متأخرة', 'Overdue')}</span>
        {dated.length < p.tasks.length && <span>{bi(`${p.tasks.length - dated.length} مهمة بلا تاريخ`, `${p.tasks.length - dated.length} task(s) without dates`)}</span>}
      </div>
    </div>
  );
}
