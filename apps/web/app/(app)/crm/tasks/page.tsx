'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Check, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime, today } from '@/lib/format';
import { Badge, Button, Card, clsx, Dialog, Empty, ErrorBox, Field, PageHeader, Spinner, Textarea } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { ENTITY_LABELS, ENTITY_LABELS_EN, entityHref } from '../_components/labels';

interface Task { id: string; entityType: string; entityId: string; type: string; subject: string; body: string | null; dueAt: string | null; doneAt: string | null; outcome: string | null; ownerId: string | null; createdAt: string }

const TYPE_LABELS: Record<string, string> = { note: 'ملاحظة', call: 'مكالمة', meeting: 'اجتماع', site_visit: 'زيارة موقع', task: 'مهمة', whatsapp: 'واتساب', email: 'بريد' };
const TYPE_LABELS_EN: Record<string, string> = { note: 'Note', call: 'Call', meeting: 'Meeting', site_visit: 'Site visit', task: 'Task', whatsapp: 'WhatsApp', email: 'E-mail' };
const riyadhDay = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 10);

export default function TasksPage() {
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const en = locale === 'en';
  const qc = useQueryClient();
  const [doneTask, setDoneTask] = useState<Task | null>(null);
  const [outcome, setOutcome] = useState('');
  const [delTask, setDelTask] = useState<Task | null>(null);
  const list = useQuery({ queryKey: ['tasks', 'mine'], queryFn: () => api.get<Task[]>('/crm/activities?mine=true&open=true'), refetchInterval: 60_000 });
  const canWrite = can('activity.write');

  const done = useMutation({
    mutationFn: (v: { id: string; outcome: string | null }) => api.post(`/crm/activities/${v.id}/done`, { outcome: v.outcome }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success(bi('تم إنجاز المهمة', 'Task completed')); setDoneTask(null); setOutcome(''); },
    onError: (e) => toast.error((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/crm/activities/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success(bi('حُذفت المهمة', 'Task deleted')); setDelTask(null); },
    onError: (e) => toast.error((e as Error).message),
  });

  const now = Date.now();
  const t = today();
  const rows = list.data ?? [];
  const overdue = rows.filter((r) => r.dueAt && new Date(r.dueAt).getTime() < now);
  const todayRows = rows.filter((r) => r.dueAt && new Date(r.dueAt).getTime() >= now && riyadhDay(r.dueAt) === t);
  const upcoming = rows.filter((r) => r.dueAt && new Date(r.dueAt).getTime() >= now && riyadhDay(r.dueAt) !== t);

  const group = (title: string, items: Task[], tone: 'red' | 'gold' | 'gray') => (
    <Card title={<span className="flex items-center gap-2">{title}<Badge tone={tone}>{items.length}</Badge></span>} padded={false}>
      {items.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد مهام', 'No tasks')}</p> : (
        <ul className="divide-y divide-line">
          {items.map((a) => {
            const href = entityHref(a.entityType, a.entityId);
            return (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{a.subject}</div>
                  {a.body && <div className="whitespace-pre-line text-sm text-muted">{a.body}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span className={clsx('num font-bold', tone === 'red' && 'text-danger')}>{dateTime(a.dueAt)}</span>
                    <span>· {(en ? TYPE_LABELS_EN : TYPE_LABELS)[a.type] ?? a.type}</span>
                    {href && <Link href={href} className="inline-flex items-center gap-1 font-bold text-primary hover:underline"><ExternalLink className="size-3" />{(en ? ENTITY_LABELS_EN : ENTITY_LABELS)[a.entityType] ?? a.entityType}</Link>}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" icon={<Check className="size-3.5" />} onClick={() => { setOutcome(''); setDoneTask(a); }}>{bi('تم', 'Done')}</Button>
                    <Button size="sm" variant="ghost" className="text-danger" aria-label={bi('حذف', 'Delete')} icon={<Trash2 className="size-3.5" />} onClick={() => setDelTask(a)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader title={bi('مهامي', 'My tasks')} subtitle={list.data ? bi(`${rows.length} مهمة مفتوحة`, `${rows.length} open tasks`) : 'My tasks'} />
      <ErrorBox error={list.error} />
      {list.isLoading ? <Spinner /> : rows.length === 0 ? (
        <Card><Empty icon={<CalendarCheck className="size-8" />} title={bi('لا توجد مهام مفتوحة', 'No open tasks')} hint={bi('أضف مهام بتاريخ استحقاق من سجل العميل أو الفرصة أو العميل المحتمل.', 'Add tasks with a due date from a customer, opportunity or lead record.')} /></Card>
      ) : (
        <div className="space-y-4">
          {group(bi('متأخرة', 'Overdue'), overdue, 'red')}
          {group(bi('اليوم', 'Today'), todayRows, 'gold')}
          {group(bi('القادمة', 'Upcoming'), upcoming, 'gray')}
        </div>
      )}
      <Dialog
        open={!!doneTask}
        onClose={() => setDoneTask(null)}
        title={bi('إنجاز المهمة', 'Complete task')}
        footer={<><Button variant="outline" onClick={() => setDoneTask(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={done.isPending} onClick={() => doneTask && done.mutate({ id: doneTask.id, outcome: outcome.trim() || null })}>{bi('تم الإنجاز', 'Mark done')}</Button></>}
      >
        <p className="mb-3 text-sm font-bold">{doneTask?.subject}</p>
        <Field label={bi('النتيجة (اختياري)', 'Outcome (optional)')}><Textarea rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={bi('مثال: تم الاتصال، طلب العميل زيارة الموقع الأحد', 'e.g. Called; the customer asked for a site visit on Sunday')} /></Field>
      </Dialog>
      <Dialog
        open={!!delTask}
        onClose={() => setDelTask(null)}
        title={bi('حذف المهمة', 'Delete task')}
        footer={<><Button variant="outline" onClick={() => setDelTask(null)}>{bi('إلغاء', 'Cancel')}</Button><Button variant="danger" loading={del.isPending} onClick={() => delTask && del.mutate(delTask.id)}>{bi('حذف', 'Delete')}</Button></>}
      >
        <p className="text-sm">{bi(`هل تريد حذف المهمة «${delTask?.subject}»؟`, `Delete the task “${delTask?.subject}”?`)}</p>
      </Dialog>
    </>
  );
}
