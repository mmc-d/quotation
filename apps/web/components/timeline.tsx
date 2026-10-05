'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, MessageSquare, Phone, StickyNote, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useI18n, type TKey } from '@/lib/i18n';
import { Button, clsx, Input, Select, Textarea } from './ui';

export interface Activity { id: string; type: string; subject: string; body: string | null; dueAt: string | null; doneAt: string | null; outcome: string | null; createdAt: string }

/** Activity type → [label key, icon]. */
const TYPES: Record<string, [TKey, React.ReactNode]> = {
  note: ['timeline.note', <StickyNote key="n" className="size-3.5" />],
  call: ['timeline.call', <Phone key="c" className="size-3.5" />],
  meeting: ['timeline.meeting', <Users key="m" className="size-3.5" />],
  site_visit: ['timeline.site_visit', <Users key="s" className="size-3.5" />],
  task: ['timeline.task', <CalendarClock key="t" className="size-3.5" />],
  whatsapp: ['timeline.whatsapp', <MessageSquare key="w" className="size-3.5" />],
  email: ['timeline.email', <MessageSquare key="e" className="size-3.5" />],
};

/** Timeline of a record + quick composer (note / call / meeting / task with due date). */
export function Timeline({ entityType, entityId, items, invalidate, canWrite = true }: { entityType: 'party' | 'lead' | 'opportunity' | 'quote' | 'contract'; entityId: string; items: Activity[]; invalidate: unknown[]; canWrite?: boolean }) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [type, setType] = useState('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/crm/activities', { entityType, entityId, type, subject, body: body || null, dueAt: type === 'task' && due ? new Date(due).toISOString() : null, done: type !== 'task' }),
    onSuccess: () => { setSubject(''); setBody(''); setDue(''); qc.invalidateQueries({ queryKey: invalidate }); toast.success(t('timeline.added')); },
    onError: (e) => toast.error((e as Error).message),
  });
  const done = useMutation({ mutationFn: (id: string) => api.post(`/crm/activities/${id}/done`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: invalidate }) });
  return (
    <div className="space-y-4">
      {canWrite && (
        <form className="space-y-2 rounded-xl border border-line bg-tint/40 p-3" onSubmit={(e) => { e.preventDefault(); if (subject.trim()) add.mutate(); }}>
          <div className="flex flex-wrap gap-2">
            <Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-[9rem]">
              {Object.entries(TYPES).filter(([k]) => !['whatsapp', 'email'].includes(k)).map(([k, [l]]) => <option key={k} value={k}>{t(l)}</option>)}
            </Select>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={type === 'task' ? t('timeline.whatNeeded') : t('timeline.subject')} className="min-w-[12rem] flex-1" />
            {type === 'task' && <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="max-w-[13rem]" />}
            <Button size="sm" loading={add.isPending}>{t('common.add')}</Button>
          </div>
          {type !== 'task' && <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('timeline.details')} />}
        </form>
      )}
      <ol className="relative space-y-3 border-s-2 border-line ps-4">
        {items.length === 0 && <li className="text-sm text-muted">{t('timeline.empty')}</li>}
        {items.map((a) => {
          const known = TYPES[a.type];
          const label = known ? t(known[0]) : a.type;
          const icon = known?.[1] ?? <StickyNote className="size-3.5" />;
          const open = !a.doneAt && a.dueAt;
          const overdue = open && new Date(a.dueAt!) < new Date();
          return (
            <li key={a.id} className="relative">
              <span className={clsx('absolute -start-[1.4rem] top-1 grid size-5 place-items-center rounded-full border-2 border-white', open ? (overdue ? 'bg-danger text-white' : 'bg-gold text-white') : 'bg-primary-50 text-primary')}>{icon}</span>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold">{a.subject}</div>
                  {a.body && <div className="whitespace-pre-line text-sm text-muted">{a.body}</div>}
                  <div className="mt-0.5 text-[11px] text-muted">{label} · {dateTime(a.createdAt)}{a.dueAt && ` · ${t('timeline.due', { d: dateTime(a.dueAt) })}`}{a.outcome && ` · ${a.outcome}`}</div>
                </div>
                {open && canWrite && <Button size="sm" variant="outline" icon={<Check className="size-3.5" />} onClick={() => done.mutate(a.id)}>{t('common.done')}</Button>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
