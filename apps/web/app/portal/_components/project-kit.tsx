'use client';
import { Check, PauseCircle, Timer } from 'lucide-react';
import { PROJECT_STAGES, PROJECT_STAGE_LABELS, type ProjectStage } from '@mmc/domain';
import { clsx } from '@/components/ui';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { PortalClock } from './portal-api';
import { Num } from './portal-ui';

/** Stage stepper — the same stage list and labels the API uses (PROJECT_STAGE_LABELS). */
export function StageStepper({ stage, compact }: { stage: string; compact?: boolean }) {
  const { bi } = useI18n();
  const idx = PROJECT_STAGES.indexOf(stage as ProjectStage);
  const label = (s: ProjectStage) => bi(PROJECT_STAGE_LABELS[s].ar, PROJECT_STAGE_LABELS[s].en);
  if (compact) {
    return (
      <div aria-label={bi('مرحلة المشروع', 'Project stage')}>
        <div className="flex gap-1" aria-hidden>
          {PROJECT_STAGES.map((s, i) => <span key={s} className={clsx('h-1.5 flex-1 rounded-full', i < idx ? 'bg-primary' : i === idx ? 'bg-gold' : 'bg-gray-200')} />)}
        </div>
        <div className="mt-1 text-xs text-muted">{bi('المرحلة', 'Stage')} <Num>{Math.max(idx, 0) + 1}/{PROJECT_STAGES.length}</Num>: <b className="text-ink">{idx >= 0 ? label(stage as ProjectStage) : stage}</b></div>
      </div>
    );
  }
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" aria-label={bi('مراحل المشروع', 'Project stages')}>
      {PROJECT_STAGES.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={s} aria-current={current ? 'step' : undefined} className={clsx('flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs sm:flex-col sm:items-start', current ? 'border-gold bg-tint font-extrabold text-primary' : done ? 'border-primary/20 bg-primary-50 text-primary' : 'border-line bg-white text-muted')}>
            <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-extrabold', current ? 'bg-gold text-white' : done ? 'bg-primary text-white' : 'bg-gray-100 text-muted')}>
              {done ? <Check className="size-3.5" aria-hidden /> : <Num>{i + 1}</Num>}
            </span>
            <span className="leading-tight">{label(s)}</span>
            {done && <span className="sr-only">{bi('(مكتملة)', '(done)')}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Delivery clock as a customer sees it: day N of the agreed period, expected delivery window. */
export function ClockSummary({ clock }: { clock: PortalClock }) {
  const { bi } = useI18n();
  if (!clock.started) {
    return <p className="flex items-start gap-2 text-sm text-muted"><Timer className="mt-0.5 size-4 shrink-0 text-gold-dark" aria-hidden />{bi('تبدأ مدة التوريد والتركيب بعد استلام الدفعة المقدمة واعتماد المتطلبات.', 'The delivery period starts once the advance payment is received and the requirements are approved.')}</p>;
  }
  const ratio = clock.maxDays ? Math.min(1, clock.elapsedDays / clock.maxDays) : 0;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-bold text-ink">
          <Timer className="size-4 text-gold-dark" aria-hidden />
          {bi('اليوم', 'Day')} <Num>{clock.elapsedDays}</Num> {bi('من', 'of')} <Num>{clock.minDays === clock.maxDays ? clock.maxDays : `${clock.minDays}–${clock.maxDays}`}</Num> {bi('يومًا', 'days')}
        </span>
        {clock.paused && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"><PauseCircle className="size-3" aria-hidden />{bi('متوقفة مؤقتًا', 'Paused')}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={clock.maxDays} aria-valuenow={clock.elapsedDays} aria-label={bi('مدة التنفيذ', 'Delivery period')}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>{bi('بداية المدة', 'Started')}: <Num className="font-bold text-ink">{date(clock.startDate)}</Num></span>
        {clock.targetMax && <span>{bi('التسليم المتوقع', 'Expected delivery')}: <Num className="font-bold text-ink">{clock.targetMin && clock.targetMin !== clock.targetMax ? `${date(clock.targetMin)} – ${date(clock.targetMax)}` : date(clock.targetMax)}</Num></span>}
      </div>
    </div>
  );
}
