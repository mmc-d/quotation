'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, MessageCircle, Navigation, Phone, RefreshCw, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { today } from '@/lib/format';
import { clsx, Empty, ErrorBox, Spinner } from '@/components/ui';
import { StatusChip, TYPE_LABEL, mapsHref, tap, tapTone, telHref, timeOf, waHref, type MyDay, type WOItem } from './_components/shared';

function shift(d: string, days: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

/** «يومي» — the technician's jobs for a day (phone-first). */
export default function MyDayPage() {
  const { bi, locale, dir } = useI18n();
  const base = today();
  const [date, setDate] = useState(base);
  const q = useQuery({ queryKey: ['my-day', date], queryFn: () => api.get<MyDay>(`/field/my-day?date=${date}`) });
  const days: { d: string; label: string }[] = [
    { d: shift(base, -1), label: bi('أمس', 'Yesterday') },
    { d: base, label: bi('اليوم', 'Today') },
    { d: shift(base, 1), label: bi('غدًا', 'Tomorrow') },
  ];
  const custom = !days.some((x) => x.d === date);
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto max-w-md space-y-4 pb-10">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold text-primary">{bi('يومي', 'My day')}</h1>
          <p className="text-sm text-muted">{weekday}</p>
        </div>
        <button className={clsx(tap, tapTone.outline, 'min-w-12 px-3')} onClick={() => void q.refetch()} disabled={q.isFetching} aria-label={bi('تحديث', 'Refresh')}>
          <RefreshCw className={clsx('size-5', q.isFetching && 'animate-spin')} />
          <span className="text-sm">{bi('تحديث', 'Refresh')}</span>
        </button>
      </div>

      <div className="flex items-stretch gap-1.5">
        <button className={clsx(tap, tapTone.outline, 'min-w-12 px-2')} onClick={() => setDate(shift(date, -1))} aria-label={bi('اليوم السابق', 'Previous day')}><Prev className="size-5" /></button>
        <div className="grid flex-1 grid-cols-3 gap-1.5">
          {days.map((x) => (
            <button key={x.d} onClick={() => setDate(x.d)} className={clsx(tap, 'px-2 text-sm', date === x.d ? tapTone.primary : tapTone.outline)}>{x.label}</button>
          ))}
        </div>
        <button className={clsx(tap, tapTone.outline, 'min-w-12 px-2')} onClick={() => setDate(shift(date, 1))} aria-label={bi('اليوم التالي', 'Next day')}><Next className="size-5" /></button>
      </div>
      {custom && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted">
          <CalendarDays className="size-4" /><span className="num" dir="ltr">{date}</span>
          <button className="font-bold text-gold-dark underline" onClick={() => setDate(base)}>{bi('العودة لليوم', 'Back to today')}</button>
        </div>
      )}

      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : q.data && (
        <>
          {q.data.overdue.length > 0 && (
            <section className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-danger"><AlertTriangle className="size-4" />{bi('متأخرة', 'Overdue')} <span className="num">({q.data.overdue.length})</span></h2>
              {q.data.overdue.map((w) => <JobCard key={w.id} w={w} overdue />)}
            </section>
          )}
          <section className="space-y-2">
            <h2 className="text-sm font-extrabold text-gold-dark">{bi('مهام اليوم', 'Jobs for the day')} <span className="num">({q.data.today.length})</span></h2>
            {q.data.today.length === 0
              ? <div className="rounded-2xl border border-line bg-white"><Empty icon={<Wrench className="size-8" />} title={bi('لا توجد مهام لهذا اليوم', 'No jobs for this day')} hint={bi('ستظهر هنا أوامر العمل المسندة إليك.', 'Work orders assigned to you will show up here.')} /></div>
              : q.data.today.map((w) => <JobCard key={w.id} w={w} />)}
          </section>
        </>
      )}
    </div>
  );
}

function JobCard({ w, overdue }: { w: WOItem; overdue?: boolean }) {
  const { bi } = useI18n();
  const tel = telHref(w.contactPhone);
  const wa = waHref(w.contactPhone);
  const nav = mapsHref(w);
  const type = TYPE_LABEL[w.type];
  return (
    <article className={clsx('overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(0,0,0,.05)]', overdue ? 'border-rose-200' : 'border-line')}>
      <Link href={`/tech/${w.id}`} className="block space-y-1.5 p-4 active:bg-tint/50">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-lg font-extrabold text-primary">
            <Clock className="size-4 text-gold" />
            <span className="num" dir="ltr">{timeOf(w.scheduledStart)}{w.scheduledEnd ? ` – ${timeOf(w.scheduledEnd)}` : ''}</span>
          </span>
          <StatusChip status={w.status} bi={bi} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs font-bold text-gold-dark">
          <span>{type ? bi(type[0], type[1]) : w.type}</span>
          <span className="num text-muted" dir="ltr">{w.number}</span>
          {w.ticketNumber && <span className="num text-muted" dir="ltr">· {w.ticketNumber}</span>}
          {overdue && w.scheduledStart && <span className="text-danger">· <span className="num" dir="ltr">{w.scheduledStart.slice(0, 10)}</span></span>}
        </div>
        <p className="text-base font-bold text-ink">{w.partyName ?? w.contactName ?? '—'}</p>
        <p className="text-sm text-ink/80">{w.title}</p>
        {(w.siteName || w.siteCity) && (
          <p className="flex items-start gap-1.5 text-sm text-muted"><MapPin className="mt-0.5 size-4 shrink-0" />{[w.siteName, w.siteCity].filter(Boolean).join(' — ')}</p>
        )}
        {w.locationPath && <p className="text-sm font-bold text-ink"><span className="num" dir="ltr">{w.locationPath}</span></p>}
        {w.contactName && <p className="text-sm text-muted">{bi('جهة الاتصال', 'Contact')}: {w.contactName} {w.contactPhone && <span className="num" dir="ltr">{w.contactPhone}</span>}</p>}
      </Link>
      {(tel || wa || nav) && (
        <div className="grid grid-cols-3 border-t border-line">
          {tel ? <a href={tel} className="flex min-h-12 items-center justify-center gap-1.5 text-sm font-bold text-primary active:bg-tint"><Phone className="size-5" />{bi('اتصال', 'Call')}</a> : <span />}
          {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-1.5 border-x border-line text-sm font-bold text-emerald-700 active:bg-tint"><MessageCircle className="size-5" />{bi('واتساب', 'WhatsApp')}</a> : <span className="border-x border-line" />}
          {nav ? <a href={nav} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-1.5 text-sm font-bold text-gold-dark active:bg-tint"><Navigation className="size-5" />{bi('الملاحة', 'Navigate')}</a> : <span />}
        </div>
      )}
    </article>
  );
}
