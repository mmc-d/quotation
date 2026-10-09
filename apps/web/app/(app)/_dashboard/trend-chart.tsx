'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { h, money } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Card, Money, Table, Td, Th, clsx } from '@/components/ui';
import type { Home, SeriesKey, TrendPoint } from './types';

/**
 * Quoted vs contracted vs collected per bucket — grouped columns on one SAR axis.
 * Colours: brand gold, blue, emerald (validated as a set on white: CVD ΔE ≥ 15, normal ≥ 22; gold is
 * under 3:1 contrast, so the legend, tooltip and the table view always carry the values too).
 */
export const SERIES: Record<SeriesKey, { color: string; ar: string; en: string }> = {
  quoted: { color: '#C2A04A', ar: 'عروض صادرة', en: 'Quoted' },
  contracted: { color: '#2a78d6', ar: 'عقود موقعة', en: 'Contracted' },
  collected: { color: '#1A7F4E', ar: 'تحصيل', en: 'Collected' },
};

const PLOT_H = 220;
const AXIS_X = 28; // x-label band under the plot
const PAD_TOP = 12;

/** 0 and 4–5 clean steps above the max (1/2/2.5/5 × 10ⁿ). */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(v);
  return out;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function useBucketLabel(granularity: Home['trend']['granularity']) {
  const { locale } = useI18n();
  const loc = locale === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn-ca-gregory';
  return (p: TrendPoint, long = false) => {
    const d = new Date(`${p.from}T12:00:00Z`);
    if (granularity === 'month') return d.toLocaleDateString(loc, { month: long ? 'long' : 'short', year: long || d.getUTCMonth() === 0 ? 'numeric' : undefined, timeZone: 'UTC' });
    if (granularity === 'quarter') return `${locale === 'en' ? 'Q' : 'ر'}${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    const e = new Date(`${p.to}T12:00:00Z`);
    const f = (x: Date) => x.toLocaleDateString(loc, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return p.from === p.to ? f(d) : `${f(d)} – ${f(e)}`;
  };
}

export function TrendCard({ trend }: { trend: Home['trend'] }) {
  const { bi, locale } = useI18n();
  const [asTable, setAsTable] = useState(false);
  const label = useBucketLabel(trend.granularity);
  const totals = useMemo(() => Object.fromEntries(trend.series.map((k) => [k, trend.points.reduce((a, p) => a + h(p[k]), 0)])) as Record<SeriesKey, number>, [trend]);
  const empty = trend.series.every((k) => totals[k] === 0);
  const per = { week: bi('أسبوعيًا', 'weekly'), month: bi('شهريًا', 'monthly'), quarter: bi('ربع سنوي', 'quarterly') }[trend.granularity];
  return (
    <Card
      title={<>{bi('الاتجاه', 'Trend')} <span className="text-xs font-bold text-muted">· {per}</span></>}
      actions={!empty && (
        <button onClick={() => setAsTable((v) => !v)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-gold-dark hover:bg-tint" aria-pressed={asTable}>
          {asTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}{asTable ? bi('رسم', 'Chart') : bi('جدول', 'Table')}
        </button>
      )}
    >
      {empty ? (
        <p className="py-10 text-center text-sm text-muted">{bi('لا عروض ولا عقود ولا تحصيل في هذه الفترة.', 'No quotes, contracts or collections in this period.')}</p>
      ) : (
        <>
          {/* legend doubles as the period totals */}
          <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {trend.series.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm" style={{ background: SERIES[k].color }} aria-hidden />
                <span className="text-muted">{locale === 'en' ? SERIES[k].en : SERIES[k].ar}</span>
                <Money value={totals[k]} className="font-bold text-ink" />
              </li>
            ))}
          </ul>
          {asTable ? <TrendTable trend={trend} label={label} /> : <Columns trend={trend} label={label} />}
        </>
      )}
    </Card>
  );
}

function TrendTable({ trend, label }: { trend: Home['trend']; label: (p: TrendPoint, long?: boolean) => string }) {
  const { bi, locale } = useI18n();
  return (
    <Table>
      <thead><tr><Th>{bi('الفترة', 'Period')}</Th>{trend.series.map((k) => <Th key={k} className="text-end">{locale === 'en' ? SERIES[k].en : SERIES[k].ar}</Th>)}</tr></thead>
      <tbody>{trend.points.map((p) => <tr key={p.from}><Td className="whitespace-nowrap">{label(p, true)}</Td>{trend.series.map((k) => <Td key={k} className="text-end"><Money value={p[k] ?? '0'} /></Td>)}</tr>)}</tbody>
    </Table>
  );
}

function Columns({ trend, label }: { trend: Home['trend']; label: (p: TrendPoint, long?: boolean) => string }) {
  const { bi, locale } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const nf = useMemo(() => new Intl.NumberFormat(locale === 'en' ? 'en' : 'ar-SA-u-nu-latn', { notation: 'compact', maximumFractionDigits: 1 }), [locale]);

  const max = Math.max(0, ...trend.points.flatMap((p) => trend.series.map((k) => h(p[k]) / 100)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const axisW = Math.max(36, ...ticks.map((t) => nf.format(t).length * 6.5 + 10));
  const plotW = Math.max(0, width - axisW - 4);
  const n = trend.points.length;
  const band = n ? plotW / n : 0;
  const k = trend.series.length;
  const barW = Math.max(2, Math.min(24, (band * 0.72 - (k - 1) * 2) / k));
  const groupW = k * barW + (k - 1) * 2;
  const y = (v: number) => PAD_TOP + PLOT_H - (top ? (v / top) * PLOT_H : 0);
  // label every bucket when they fit (~56px each), otherwise every n-th counted back from the latest
  const every = Math.max(1, Math.ceil(56 / (band || 1)));

  /** Column with a 4px rounded data end, square at the baseline. */
  const col = (x: number, v: number) => {
    const y0 = y(0);
    const y1 = y(v);
    const hgt = y0 - y1;
    if (hgt <= 0) return '';
    const r = Math.min(4, hgt, barW / 2);
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + barW - r}Q${x + barW},${y1} ${x + barW},${y1 + r}V${y0}Z`;
  };

  const hp = hover !== null ? trend.points[hover] : null;
  const tipLeft = hover !== null ? axisW + band * hover + band / 2 : 0;

  return (
    <div ref={ref} dir="ltr" className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={PAD_TOP + PLOT_H + AXIS_X} role="img" aria-label={trend.series.map((s) => (locale === 'en' ? SERIES[s].en : SERIES[s].ar)).join(' · ')}>
          {/* recessive grid + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={axisW} x2={width} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={axisW - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted num" fontSize={11}>{nf.format(t)}</text>
            </g>
          ))}
          {trend.points.map((p, i) => {
            const gx = axisW + band * i + (band - groupW) / 2;
            return (
              <g key={p.from}>
                {hover === i && <rect x={axisW + band * i} y={PAD_TOP} width={band} height={PLOT_H} fill="var(--color-tint)" />}
                {trend.series.map((s, j) => <path key={s} d={col(gx + j * (barW + 2), h(p[s]) / 100)} fill={SERIES[s].color} />)}
                {(n - 1 - i) % every === 0 && (
                  <text x={axisW + band * i + band / 2} y={PAD_TOP + PLOT_H + 18} textAnchor="middle" className="fill-muted" fontSize={11}>{label(p)}</text>
                )}
                {/* hit target = the whole band; focusable for keyboard readers */}
                <rect
                  x={axisW + band * i} y={PAD_TOP} width={band} height={PLOT_H} fill="transparent" tabIndex={0}
                  aria-label={`${label(p, true)}: ${trend.series.map((s) => `${locale === 'en' ? SERIES[s].en : SERIES[s].ar} ${money(p[s] ?? '0')}`).join('، ')}`}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  className="outline-none focus-visible:stroke-gold focus-visible:[stroke-width:2]"
                />
              </g>
            );
          })}
          <line x1={axisW} x2={width} y1={y(0)} y2={y(0)} stroke="#c9c3b3" strokeWidth={1} shapeRendering="crispEdges" />
        </svg>
      )}
      {hp && (
        <div
          role="tooltip"
          dir={locale === 'en' ? 'ltr' : 'rtl'}
          className={clsx('pointer-events-none absolute top-0 z-10 min-w-48 whitespace-nowrap rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg', tipLeft > width / 2 ? '-translate-x-full' : '')}
          style={{ left: tipLeft > width / 2 ? tipLeft - 8 : tipLeft + 8 }}
        >
          <div className="mb-1 font-bold text-muted">{label(hp, true)}</div>
          {trend.series.map((s) => (
            <div key={s} className="flex items-center justify-between gap-3 py-0.5">
              <span className="flex items-center gap-1.5 text-muted"><span className="inline-block h-0.5 w-3 rounded" style={{ background: SERIES[s].color }} aria-hidden />{locale === 'en' ? SERIES[s].en : SERIES[s].ar}</span>
              <Money value={hp[s] ?? '0'} className="font-extrabold text-ink" />
            </div>
          ))}
        </div>
      )}
      <p className="sr-only">{bi('القيم بالريال، شاملة الضريبة.', 'Values in SAR, VAT included.')}</p>
    </div>
  );
}
