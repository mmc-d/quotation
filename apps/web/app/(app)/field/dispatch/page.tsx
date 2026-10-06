'use client';
import Link from 'next/link';
import { useMemo, useState, type DragEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, Inbox, MapPin, User } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Button, Card, clsx, Empty, ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { CoverageBadge, WO_STATUS, WoTypeBadge, addDays, riyadhDay, riyadhHour, riyadhTime, toRiyadhLocal, warningsTitle, weekday } from '../_components/common';
import { ScheduleDialog } from '../_components/schedule-dialog';
import type { BoardWo, DispatchBoard, WoSummary } from '../_components/types';

const H0 = 7;
const H1 = 21;
const SPAN = H1 - H0;
const ROW = 3.25; // rem per track in day view

type View = 'day' | 'week';
type Dialog = { wo: WoSummary; preset: { technicianId?: string | null; start?: string | null } | null } | null;

export default function DispatchPage() {
  const { bi, locale, dir } = useI18n();
  const { can } = useMe();
  const canDispatch = can('workorder.dispatch');
  const today = toRiyadhLocal(new Date()).slice(0, 10);
  const [view, setView] = useState<View>('day');
  const [anchor, setAnchor] = useState(today);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const from = view === 'day' ? anchor : addDays(anchor, -weekday(anchor));
  const to = view === 'day' ? anchor : addDays(from, 6);
  const days = useMemo(() => Array.from({ length: view === 'day' ? 1 : 7 }, (_, i) => addDays(from, i)), [from, view]);
  const board = useQuery({ queryKey: ['field-board', from, to], queryFn: () => api.get<DispatchBoard>(`/field/dispatch-board${qs({ from, to })}`), placeholderData: (p) => p });

  const lanes = board.data?.technicians ?? [];
  const queue = board.data?.unscheduled ?? [];
  const allWos = useMemo(() => {
    const m = new Map<string, WoSummary>();
    for (const w of queue) m.set(w.id, w);
    for (const l of lanes) for (const w of l.workOrders) m.set(w.id, w);
    return m;
  }, [lanes, queue]);

  const dayLabel = (d: string, long = false) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn-ca-gregory', { weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : 'numeric', timeZone: 'UTC' });
  const step = (n: number) => setAnchor((a) => addDays(a, n * (view === 'day' ? 1 : 7)));
  const title = view === 'day' ? dayLabel(anchor, true) : `${dayLabel(from)} — ${dayLabel(to)}`;

  // ── drag & drop (optional; click-to-schedule works everywhere) ──
  const onDragStart = (id: string) => (e: DragEvent) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; setDragId(id); };
  const onDragEnd = () => { setDragId(null); setOver(null); };
  const dropZone = (zone: string, preset: (e: DragEvent<HTMLElement>) => { technicianId: string; start: string }) => canDispatch ? {
    onDragOver: (e: DragEvent<HTMLElement>) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== zone) setOver(zone); },
    onDragLeave: () => setOver((o) => (o === zone ? null : o)),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain') || dragId;
      const wo = id ? allWos.get(id) : undefined;
      onDragEnd();
      if (wo) setDialog({ wo, preset: preset(e) });
    },
  } : {};

  /** Start time from the x position inside a day-view lane (mirrored in RTL), rounded to 30 min. */
  const hourAt = (e: DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let f = (e.clientX - r.left) / r.width;
    if (dir === 'rtl') f = 1 - f;
    const hrs = Math.min(H1 - 1, Math.max(H0, H0 + Math.round(f * SPAN * 2) / 2));
    return `${String(Math.floor(hrs)).padStart(2, '0')}:${hrs % 1 ? '30' : '00'}`;
  };

  return (
    <>
      <PageHeader
        title={bi('لوحة التوزيع', 'Dispatch board')}
        subtitle={bi('اسحب أمر عمل من قائمة الانتظار إلى فني، أو اضغط عليه للجدولة.', 'Drag a work order from the queue onto a technician, or click it to schedule.')}
        actions={<Link href="/field/work-orders/new" className="inline-flex items-center rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-bold hover:bg-tint">{bi('أمر عمل جديد', 'New work order')}</Link>}
      />
      <Card padded={false} className="mb-4">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-line text-sm font-bold">
            {(['day', 'week'] as View[]).map((v) => <button key={v} type="button" onClick={() => setView(v)} className={clsx('px-3 py-1.5', view === v ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-tint')}>{v === 'day' ? bi('يوم', 'Day') : bi('أسبوع', 'Week')}</button>)}
          </div>
          <div className="inline-flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => step(-1)} aria-label={bi('السابق', 'Previous')}>{dir === 'rtl' ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}</Button>
            <Button size="sm" variant="outline" onClick={() => setAnchor(today)}>{bi('اليوم', 'Today')}</Button>
            <Button size="sm" variant="outline" onClick={() => step(1)} aria-label={bi('التالي', 'Next')}>{dir === 'rtl' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}</Button>
          </div>
          <input type="date" dir="ltr" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-sm" aria-label={bi('التاريخ', 'Date')} />
          <span className="text-sm font-extrabold text-primary">{title}</span>
          {board.isFetching && <span className="text-xs text-muted">{bi('جارٍ التحديث…', 'Refreshing…')}</span>}
        </div>
      </Card>
      <ErrorBox error={board.error} />
      {board.isLoading ? <Spinner /> : (
        <div className="flex flex-col gap-4 xl:flex-row">
          {/* lanes */}
          <Card padded={false} className="min-w-0 flex-1">
            {lanes.length === 0 ? (
              <Empty icon={<User className="size-8" />} title={bi('لا يوجد فنيون', 'No technicians')} hint={bi('امنح المستخدمين دور «فني» ليظهروا هنا.', 'Give users the “technician” role to list them here.')} />
            ) : (
              <div className="overflow-x-auto">
                <div style={{ minWidth: view === 'day' ? '58rem' : '64rem' }}>
                  {/* header */}
                  <div className="flex border-b border-line bg-tint/60 text-xs font-extrabold text-gold-dark">
                    <div className="sticky start-0 z-10 w-40 shrink-0 border-e border-line bg-tint px-3 py-2">{bi('الفني', 'Technician')}</div>
                    {view === 'day' ? (
                      <div className="relative h-8 flex-1">
                        {Array.from({ length: SPAN }, (_, i) => (
                          <span key={i} className={clsx('absolute top-2', i > 0 && '-translate-x-1/2 rtl:translate-x-1/2', i === 0 && 'ps-1')} style={{ insetInlineStart: `${(i / SPAN) * 100}%` }}><span className="num">{String(H0 + i).padStart(2, '0')}:00</span></span>
                        ))}
                      </div>
                    ) : days.map((d) => (
                      <div key={d} className={clsx('flex-1 border-e border-line px-2 py-2 text-center last:border-e-0', d === today && 'bg-gold/15 text-primary')}>{dayLabel(d)}</div>
                    ))}
                  </div>
                  {lanes.map((lane) => (
                    <div key={lane.id} className="flex border-b border-line last:border-b-0">
                      <div className="sticky start-0 z-10 w-40 shrink-0 border-e border-line bg-white px-3 py-2">
                        <div className="truncate text-sm font-bold">{lane.name ?? '—'}</div>
                        <div className="text-[11px] text-muted">{lane.isTechnician ? bi('فني', 'Technician') : bi('موظف', 'Staff')} · <span className="num">{lane.workOrders.length}</span></div>
                      </div>
                      {view === 'day'
                        ? <DayLane day={anchor} lane={lane.workOrders} zone={`${lane.id}`} over={over} drop={dropZone(lane.id, (e) => ({ technicianId: lane.id, start: `${anchor}T${hourAt(e)}` }))} onDragStart={canDispatch ? onDragStart : undefined} onDragEnd={onDragEnd} />
                        : days.map((d) => {
                          const zone = `${lane.id}|${d}`;
                          const items = lane.workOrders.filter((w) => w.scheduledStart && riyadhDay(w.scheduledStart) <= d && riyadhDay(w.scheduledEnd ?? w.scheduledStart) >= d);
                          return (
                            <div key={d} {...dropZone(zone, () => ({ technicianId: lane.id, start: `${d}T09:00` }))} className={clsx('min-h-[4.5rem] flex-1 space-y-1 border-e border-line p-1 last:border-e-0', d === today && 'bg-gold/5', over === zone && 'bg-primary-50 ring-2 ring-inset ring-gold')}>
                              {items.map((w) => <BoardCard key={`${w.id}-${lane.id}`} wo={w} compact onDragStart={canDispatch ? onDragStart(w.id) : undefined} onDragEnd={onDragEnd} />)}
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* unscheduled queue */}
          <Card padded={false} className="w-full shrink-0 xl:w-80" title={<span className="flex items-center gap-1.5"><Inbox className="size-4" />{bi('بانتظار الجدولة', 'Unscheduled')} <span className="num rounded-full bg-tint px-1.5 text-[11px] text-gold-dark">{queue.length}</span></span>}>
            {queue.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد أوامر عمل جديدة', 'No new work orders')}</p> : (
              <ul className="max-h-[70vh] space-y-2 overflow-y-auto p-3">
                {queue.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      draggable={canDispatch}
                      onDragStart={canDispatch ? onDragStart(w.id) : undefined}
                      onDragEnd={onDragEnd}
                      onClick={() => canDispatch && setDialog({ wo: w, preset: null })}
                      className={clsx('block w-full rounded-lg border border-line bg-white p-2.5 text-start shadow-sm transition hover:border-gold', canDispatch ? 'cursor-grab active:cursor-grabbing' : 'cursor-default', dragId === w.id && 'opacity-50')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span dir="ltr" className="num text-xs font-bold text-primary">{w.number}</span>
                        <WoTypeBadge type={w.type} />
                      </div>
                      <div className="mt-1 text-sm font-bold">{w.title}</div>
                      <div className="mt-1 text-xs text-muted">{w.partyName ?? '—'}{w.siteName && ` · ${w.siteName}`}</div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <CoverageBadge coverage={w.coverage} />
                        <Link href={`/field/work-orders/${w.id}`} onClick={(e) => e.stopPropagation()} className="text-[11px] font-bold text-gold-dark hover:underline">{bi('فتح', 'Open')}</Link>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {board.data && lanes.length > 0 && <Legend />}
      <ScheduleDialog wo={dialog?.wo ?? null} preset={dialog?.preset ?? null} onClose={() => setDialog(null)} />
    </>
  );
}

/** Day view lane: cards positioned by hour (07:00–21:00), overlapping bookings stacked on tracks. */
function DayLane({ day, lane, zone, over, drop, onDragStart, onDragEnd }: { day: string; lane: BoardWo[]; zone: string; over: string | null; drop: object; onDragStart?: (id: string) => (e: DragEvent) => void; onDragEnd: () => void }) {
  const placed = useMemo(() => {
    const items = lane.filter((w) => w.scheduledStart).map((w) => {
      const s = riyadhDay(w.scheduledStart) < day ? H0 : riyadhHour(w.scheduledStart!);
      const endIso = w.scheduledEnd ?? new Date(Date.parse(w.scheduledStart!) + 3600_000).toISOString();
      const e = riyadhDay(endIso) > day ? H1 : riyadhHour(endIso);
      const start = Math.min(H1 - 0.5, Math.max(H0, s));
      const end = Math.max(start + 0.5, Math.min(H1, e));
      return { w, start, end, track: 0 };
    }).sort((a, b) => a.start - b.start);
    const tracks: number[] = [];
    for (const it of items) {
      let t = tracks.findIndex((end) => end <= it.start);
      if (t < 0) { t = tracks.length; tracks.push(0); }
      tracks[t] = it.end;
      it.track = t;
    }
    return { items, n: Math.max(1, tracks.length) };
  }, [lane, day]);
  return (
    <div {...drop} className={clsx('relative flex-1', over === zone && 'bg-primary-50 ring-2 ring-inset ring-gold')} style={{ height: `${placed.n * ROW + 0.5}rem` }}>
      {Array.from({ length: SPAN }, (_, i) => <span key={i} className="pointer-events-none absolute inset-y-0 border-s border-line/50" style={{ insetInlineStart: `${(i / SPAN) * 100}%` }} />)}
      {placed.items.map(({ w, start, end, track }) => (
        <div key={w.id} className="absolute p-0.5" style={{ insetInlineStart: `${((start - H0) / SPAN) * 100}%`, width: `${((end - start) / SPAN) * 100}%`, top: `${track * ROW + 0.25}rem`, height: `${ROW}rem` }}>
          <BoardCard wo={w} onDragStart={onDragStart?.(w.id)} onDragEnd={onDragEnd} />
        </div>
      ))}
    </div>
  );
}

function BoardCard({ wo, compact, onDragStart, onDragEnd }: { wo: BoardWo; compact?: boolean; onDragStart?: (e: DragEvent) => void; onDragEnd?: () => void }) {
  const { bi, locale } = useI18n();
  const tone = WO_STATUS[wo.status]?.[2] ?? 'bg-gray-100 text-gray-700';
  const statusLabel = WO_STATUS[wo.status] ? (locale === 'en' ? WO_STATUS[wo.status]![1] : WO_STATUS[wo.status]![0]) : wo.status;
  return (
    <Link
      href={`/field/work-orders/${wo.id}`}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={`${wo.number} — ${wo.title}\n${wo.partyName ?? ''} ${wo.siteName ?? ''}\n${riyadhTime(wo.scheduledStart)}–${riyadhTime(wo.scheduledEnd)} · ${statusLabel}${wo.role === 'crew' ? ` · ${bi('مساعد', 'crew')}` : ''}${wo.scheduleWarnings?.length ? `\n${warningsTitle(wo.scheduleWarnings, locale)}` : ''}`}
      className={clsx('block h-full overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight shadow-sm transition hover:ring-2 hover:ring-gold', tone, wo.role === 'crew' ? 'border-dashed border-current/40' : 'border-transparent')}
    >
      <div className="flex items-center gap-1">
        <span dir="ltr" className="num font-bold">{riyadhTime(wo.scheduledStart)}</span>
        <span dir="ltr" className="num truncate opacity-80">{wo.number}</span>
        {!!wo.scheduleWarnings?.length && (
          <span className="ms-auto shrink-0 text-amber-700" title={warningsTitle(wo.scheduleWarnings, locale)} aria-label={bi('تنبيهات الجدولة', 'Scheduling warnings')}>
            <AlertTriangle className="size-3" />
          </span>
        )}
      </div>
      <div className="truncate font-bold">{wo.title}</div>
      {!compact && (wo.siteName || wo.siteCity) && <div className="flex items-center gap-0.5 truncate opacity-80"><MapPin className="size-2.5 shrink-0" />{wo.siteName ?? wo.siteCity}</div>}
      {compact && <div className="truncate opacity-80">{statusLabel}</div>}
    </Link>
  );
}

function Legend() {
  const { locale } = useI18n();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
      <CalendarRange className="size-3.5 text-muted" />
      {Object.entries(WO_STATUS).filter(([k]) => !['new', 'cancelled'].includes(k)).map(([k, v]) => <span key={k} className={clsx('rounded-full px-2 py-0.5 font-bold', v[2])}>{locale === 'en' ? v[1] : v[0]}</span>)}
    </div>
  );
}
