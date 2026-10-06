'use client';
import { useState } from 'react';
import { CalendarPlus, PauseCircle, PlayCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Button, Card, clsx, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { NumInput } from '../../quotes/_components/common';
import { ClockBar, ClockChip, type useProjectAction } from './kit';
import { CLOCK_LEVEL, PAUSE_KINDS, type ProjectView } from './types';

export function ClockCard({ p, action }: { p: ProjectView; action: ReturnType<typeof useProjectAction> }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const c = p.clock;
  const canWrite = can('project.write') && p.status !== 'closed' && p.status !== 'cancelled';
  const [dlg, setDlg] = useState<null | 'pause' | 'extend'>(null);
  const [pause, setPause] = useState({ fromDate: today(), kind: 'client_delay', reason: '' });
  const [ext, setExt] = useState({ days: '', reason: '' });
  const openPause = p.pauses.find((x) => !x.toDate);
  const kindLabel = (k: string) => { const m = PAUSE_KINDS.find((x) => x.value === k); return m ? (locale === 'en' ? m.en : m.ar) : k; };

  const addPause = async () => {
    const r = await action.run('pause', () => api.post<ProjectView>(`/projects/${p.id}/pauses`, { fromDate: pause.fromDate, kind: pause.kind, reason: pause.reason.trim() }), bi('أُوقفت مدة التوريد مؤقتًا', 'Delivery clock paused'));
    if (r) { setDlg(null); setPause({ fromDate: today(), kind: 'client_delay', reason: '' }); }
  };
  const endPause = (pid: string) => action.run(`end:${pid}`, () => api.post<ProjectView>(`/projects/pauses/${pid}/end`, {}), bi('استُؤنفت مدة التوريد', 'Delivery clock resumed'));
  const extend = async () => {
    const r = await action.run('extend', () => api.post<ProjectView>(`/projects/${p.id}/extend`, { days: Number(ext.days), reason: ext.reason.trim() }), bi('تم تمديد مدة التوريد', 'Delivery window extended'));
    if (r) { setDlg(null); setExt({ days: '', reason: '' }); }
  };
  const extDays = Number(ext.days);

  return (
    <Card title={bi('مدة التوريد التعاقدية', 'Contractual delivery clock')} actions={<>{c.paused && <Badge tone="gold">{bi('متوقفة مؤقتًا', 'Paused')}</Badge>}<ClockChip level={c.level} /></>}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={clsx('num text-3xl font-extrabold', CLOCK_LEVEL[c.level].text)} dir="ltr">{c.started ? c.elapsed : '—'}<span className="text-base font-bold text-muted"> / {c.maxDays}</span></div>
          <div className="text-xs text-muted">{bi('يوم عمل منقضٍ من الحد الأقصى', 'working days elapsed of the maximum')}</div>
        </div>
        {c.started && <div className="num text-sm font-bold text-muted" dir="ltr">{Math.round(c.ratio * 100)}%</div>}
      </div>
      <ClockBar level={c.level} ratio={c.ratio} className="mt-3 h-3" />
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted">{bi('تاريخ البدء', 'Start date')}</dt><dd className="num font-bold">{c.started ? date(c.startDate) : bi('لم تبدأ بعد', 'Not started yet')}</dd>
        <dt className="text-muted">{bi('نافذة التسليم', 'Target window')}</dt><dd className="num font-bold">{c.targetMin ? `${date(c.targetMin)} – ${date(c.targetMax)}` : <span dir="ltr">{c.minDays}–{c.maxDays} {bi('يوم', 'days')}</span>}</dd>
        {p.clockExtensionDays > 0 && <><dt className="text-muted">{bi('تمديدات', 'Extensions')}</dt><dd className="num font-bold">+{p.clockExtensionDays} {bi('يوم', 'days')}</dd></>}
        {c.pausedDays > 0 && <><dt className="text-muted">{bi('أيام التوقف', 'Paused days')}</dt><dd className="num font-bold">{c.pausedDays}</dd></>}
        {p.deliveredOn && <><dt className="text-muted">{bi('اكتمل التوريد', 'Delivered on')}</dt><dd className="num font-bold">{date(p.deliveredOn)}</dd></>}
      </dl>
      {!c.started && <p className="mt-3 rounded-lg bg-tint/60 px-3 py-2 text-xs text-gold-dark">{bi('تبدأ المدة من تاريخ استلام الدفعة المقدمة أو آخر اعتماد مطلوب من العميل — أيهما أبعد.', 'The clock starts on the later of the advance payment and the last required client approval.')}</p>}

      {p.pauses.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-extrabold text-gold-dark">{bi('سجل التوقفات', 'Pause log')}</div>
          <ul className="space-y-1.5">
            {p.pauses.map((x) => (
              <li key={x.id} className="rounded-lg border border-line px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="num font-bold">{date(x.fromDate)} → {x.toDate ? date(x.toDate) : bi('مستمر', 'ongoing')}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={x.toDate ? 'gray' : 'gold'}>{kindLabel(x.kind)}</Badge>
                    {!x.toDate && canWrite && <Button size="sm" variant="outline" icon={<PlayCircle className="size-3.5" />} loading={action.busy === `end:${x.id}`} onClick={() => void endPause(x.id)}>{bi('إنهاء التوقف', 'End pause')}</Button>}
                  </span>
                </div>
                <div className="mt-1 text-muted">{x.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canWrite && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" icon={<PauseCircle className="size-3.5" />} disabled={!!openPause || !!p.deliveredOn} onClick={() => setDlg('pause')}>{bi('إيقاف المدة', 'Pause clock')}</Button>
          <Button size="sm" variant="outline" icon={<CalendarPlus className="size-3.5" />} onClick={() => setDlg('extend')}>{bi('تمديد', 'Extend')}</Button>
        </div>
      )}

      <Dialog open={dlg === 'pause'} onClose={() => setDlg(null)} title={bi('إيقاف مدة التوريد', 'Pause the delivery clock')}
        footer={<><Button variant="outline" onClick={() => setDlg(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={action.busy === 'pause'} disabled={!pause.fromDate || !pause.reason.trim()} onClick={() => void addPause()}>{bi('إيقاف', 'Pause')}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bi('من تاريخ *', 'From date *')}><Input type="date" value={pause.fromDate} onChange={(e) => setPause({ ...pause, fromDate: e.target.value })} /></Field>
          <Field label={bi('السبب *', 'Kind *')}>
            <Select value={pause.kind} onChange={(e) => setPause({ ...pause, kind: e.target.value })}>
              {PAUSE_KINDS.map((k) => <option key={k.value} value={k.value}>{locale === 'en' ? k.en : k.ar}</option>)}
            </Select>
          </Field>
          <Field label={bi('التفاصيل والإثبات *', 'Details / evidence *')} className="sm:col-span-2"><Textarea rows={3} value={pause.reason} onChange={(e) => setPause({ ...pause, reason: e.target.value })} /></Field>
        </div>
        <p className="mt-2 text-xs text-muted">{bi('أيام التوقف لا تُحتسب من المدة التعاقدية وتُسجَّل كدليل.', 'Paused days do not count towards the contractual window and are logged as evidence.')}</p>
      </Dialog>

      <Dialog open={dlg === 'extend'} onClose={() => setDlg(null)} title={bi('تمديد مدة التوريد', 'Extend the delivery window')}
        footer={<><Button variant="outline" onClick={() => setDlg(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={action.busy === 'extend'} disabled={!(extDays >= 1 && extDays <= 365 && Number.isInteger(extDays)) || !ext.reason.trim()} onClick={() => void extend()}>{bi('تمديد', 'Extend')}</Button></>}>
        <div className="grid gap-3">
          <Field label={bi('عدد أيام العمل *', 'Working days *')}><NumInput value={ext.days} onChange={(v) => setExt({ ...ext, days: v.replace(/[^\d]/g, '') })} min={1} step="1" /></Field>
          <Field label={bi('السبب (أمر تغيير معتمد / تأخير موثق) *', 'Reason (approved change order / documented delay) *')}><Textarea rows={3} value={ext.reason} onChange={(e) => setExt({ ...ext, reason: e.target.value })} /></Field>
        </div>
      </Dialog>
    </Card>
  );
}
