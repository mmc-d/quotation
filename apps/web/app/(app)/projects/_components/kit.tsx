'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { PROJECT_STAGES, PROJECT_STAGE_LABELS, type ProjectStage } from '@mmc/domain';
import { ApiError } from '@/lib/api';
import { bi as biNow, useI18n } from '@/lib/i18n';
import { clsx } from '@/components/ui';
import { errMsg } from '../../quotes/_components/common';
import { CLOCK_LEVEL, type ClockLevel, type GateCheck, type ProjectView } from './types';

export function Chip({ chip, children }: { chip: string; children: React.ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap', chip)}>{children}</span>;
}

/** Status from one of the label maps in types.ts. */
export function MapChip({ map, value }: { map: Record<string, { ar: string; en: string; chip: string }>; value: string }) {
  const { locale } = useI18n();
  const m = map[value];
  return <Chip chip={m?.chip ?? 'bg-gray-100 text-gray-700'}>{m ? (locale === 'en' ? m.en : m.ar) : value}</Chip>;
}

export function stageLabel(s: string, locale: string): string {
  const l = PROJECT_STAGE_LABELS[s as ProjectStage];
  return l ? (locale === 'en' ? l.en : l.ar) : s;
}

export function ClockBar({ level, ratio, className }: { level: ClockLevel; ratio: number; className?: string }) {
  const pct = level === 'not_started' ? 0 : Math.max(2, Math.min(100, Math.round(ratio * 100)));
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-gray-100', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full transition-all', CLOCK_LEVEL[level].bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ClockChip({ level }: { level: ClockLevel }) {
  const { locale } = useI18n();
  const m = CLOCK_LEVEL[level];
  return <Chip chip={m.chip}>{locale === 'en' ? m.en : m.ar}</Chip>;
}

/** Horizontal 8-stage stepper; flex order follows the document direction, so RTL flows right → left. */
export function StageStepper({ stage }: { stage: ProjectStage }) {
  const { locale } = useI18n();
  const cur = PROJECT_STAGES.indexOf(stage);
  return (
    <ol className="flex min-w-max items-start gap-0">
      {PROJECT_STAGES.map((s, i) => {
        const done = i < cur;
        const active = i === cur;
        return (
          <li key={s} className="flex items-start">
            <div className="flex w-24 flex-col items-center gap-1 text-center sm:w-28">
              <span className={clsx('num grid size-8 place-items-center rounded-full border-2 text-xs font-extrabold',
                done ? 'border-primary bg-primary text-white' : active ? 'border-gold bg-gold text-white ring-4 ring-gold/20' : 'border-line bg-white text-muted')}>
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={clsx('text-[11px] leading-tight', active ? 'font-extrabold text-primary' : done ? 'font-bold text-ink' : 'text-muted')}>{stageLabel(s, locale)}</span>
            </div>
            {i < PROJECT_STAGES.length - 1 && <span className={clsx('mt-4 h-0.5 w-4 sm:w-6', i < cur ? 'bg-primary' : 'bg-line')} />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Runs a project action: a full project view in the response replaces the cache, anything else
 * refetches it. Errors are toasted (a failed gate lists its checks).
 */
export function useProjectAction(projectId: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | null> => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'gate' in r && 'clock' in r) qc.setQueryData(['project', projectId], r as unknown as ProjectView);
      else await qc.invalidateQueries({ queryKey: ['project', projectId] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      if (success) toast.success(success);
      return r;
    } catch (e) {
      const failed = e instanceof ApiError ? (e.details as { failed?: GateCheck[] } | undefined)?.failed : undefined;
      if (failed?.length) toast.error(biNow('شروط المرحلة غير مستوفاة', 'The stage gate is not met'), { description: failed.map((c) => `✗ ${biNow(c.ar, c.en)}`).join('\n') });
      else toast.error(errMsg(e));
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}
