'use client';
import { Field, Input, clsx } from '@/components/ui';
import { today } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export type PresetKey = 'month' | 'last_month' | 'quarter' | 'ytd' | '12m' | 'custom';
export interface PeriodState { preset: PresetKey; from: string; to: string }

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** Calendar presets on the Riyadh date (the API counts days the same way). */
export function presetRange(key: Exclude<PresetKey, 'custom'>, now = today()): { from: string; to: string } {
  const [y, m] = now.split('-').map(Number) as [number, number];
  const mi = m - 1;
  switch (key) {
    case 'month': return { from: iso(y, mi, 1), to: now };
    case 'last_month': return { from: iso(y, mi - 1, 1), to: iso(y, mi, 0) };
    case 'quarter': return { from: iso(y, mi - (mi % 3), 1), to: now };
    case 'ytd': return { from: iso(y, 0, 1), to: now };
    case '12m': return { from: iso(y, mi - 11, 1), to: now };
  }
}

export function initialPeriod(): PeriodState {
  return { preset: 'month', ...presetRange('month') };
}

/** One filter row: presets as a segmented control, the custom range behind its own option. */
export function PeriodPicker({ value, onChange }: { value: PeriodState; onChange: (p: PeriodState) => void }) {
  const { bi } = useI18n();
  const presets: { key: PresetKey; label: string }[] = [
    { key: 'month', label: bi('هذا الشهر', 'This month') },
    { key: 'last_month', label: bi('الشهر الماضي', 'Last month') },
    { key: 'quarter', label: bi('هذا الربع', 'This quarter') },
    { key: 'ytd', label: bi('منذ بداية السنة', 'Year to date') },
    { key: '12m', label: bi('آخر 12 شهرًا', 'Last 12 months') },
    { key: 'custom', label: bi('مخصص', 'Custom') },
  ];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div role="radiogroup" aria-label={bi('الفترة', 'Period')} className="flex flex-wrap rounded-lg border border-line bg-white p-0.5">
        {presets.map((p) => (
          <button
            key={p.key}
            role="radio"
            aria-checked={value.preset === p.key}
            onClick={() => onChange(p.key === 'custom' ? { ...value, preset: 'custom' } : { preset: p.key, ...presetRange(p.key) })}
            className={clsx('rounded-md px-2.5 py-1.5 text-xs font-bold transition', value.preset === p.key ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink')}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <>
          <Field label={bi('من', 'From')} className="w-36"><Input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} /></Field>
          <Field label={bi('إلى', 'To')} className="w-36"><Input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} /></Field>
        </>
      )}
    </div>
  );
}
