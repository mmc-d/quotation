'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Car, CheckCircle2, FileText, Hourglass, KeyRound, Loader2, MapPin, MessageCircle, Navigation, Phone, Send, ShieldCheck, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { bi as biNow, useI18n } from '@/lib/i18n';
import { clsx, ErrorBox, Spinner } from '@/components/ui';
import { EDITABLE, Section, StatusChip, TYPE_LABEL, errMsg, mapsHref, tap, tapTone, telHref, timeOf, waHref, type Missing, type WOView } from '../_components/shared';
import { ChecklistStep } from '../_components/checklist';
import { PhotosStep } from '../_components/photos';
import { DevicesStep } from '../_components/devices';
import { PartsStep } from '../_components/parts';
import { SignatureStep } from '../_components/signature';
import { OutboxBar, OutboxProvider, isOffline, useOutbox } from '../_components/outbox';
import { TechHowTo } from '../../kb/_components/common';

/** Section id for a `missing` key from the completion stage gate. */
function sectionOf(key: string): string {
  if (key === 'check_in') return 'sec-status';
  if (key.startsWith('check:')) return `check-${key.slice(6)}`;
  if (key === 'photos') return 'sec-photos';
  if (key === 'assets') return 'sec-devices';
  if (key === 'signature') return 'sec-signature';
  return 'sec-status';
}

function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

/** The technician's job screen: a top-to-bottom step flow, with an offline outbox for evidence edits. */
export default function TechJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const onView = (v: WOView) => {
    qc.setQueryData(['tech-wo', id], v);
    void qc.invalidateQueries({ queryKey: ['my-day'] });
  };
  return <OutboxProvider woId={id} onView={onView}><TechJob id={id} /></OutboxProvider>;
}

/** Status changes and completion need the server — say so plainly instead of a network error. */
const offlineMsg = () => biNow('هذه الخطوة تحتاج اتصالًا بالإنترنت — حاول عند عودة الاتصال. (بنود الفحص والقطع والملاحظات والصور تُحفظ على الجهاز)', 'This step needs an internet connection — try again when you are back online. (Checklist, parts, findings and photos are kept on the device.)');

function TechJob({ id }: { id: string }) {
  const { bi, locale, dir } = useI18n();
  const qc = useQueryClient();
  const outbox = useOutbox();
  const key = ['tech-wo', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<WOView>(`/field/work-orders/${id}`) });
  const [busy, setBusy] = useState<string | null>(null);
  const [missing, setMissing] = useState<Missing[] | null>(null);
  const [partsNote, setPartsNote] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const onView = (v: WOView) => {
    qc.setQueryData(key, v);
    void qc.invalidateQueries({ queryKey: ['my-day'] });
    if (missing) setMissing(null);
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  const run = async (name: string, fn: () => Promise<WOView>, ok?: string) => {
    if (isOffline()) return void toast.error(offlineMsg());
    setBusy(name);
    try {
      onView(await fn());
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(e instanceof TypeError ? offlineMsg() : errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <div className="mx-auto max-w-md"><Spinner /></div>;
  if (q.error || !q.data) return <div className="mx-auto max-w-md space-y-3"><ErrorBox error={q.error} /><Link href="/tech" className={clsx(tap, tapTone.outline, 'w-full')}>{bi('العودة ليومي', 'Back to my day')}</Link></div>;
  const wo = q.data;
  const editable = EDITABLE.includes(wo.status);
  const can = (s: string) => wo.allowedTransitions.includes(s as never);
  const type = TYPE_LABEL[wo.type];
  const phone = wo.ticket?.contactPhone ?? wo.contactPhone ?? wo.party?.phone ?? null;
  const tel = telHref(phone);
  const wa = waHref(phone);
  const nav = mapsHref(wo);
  const address = wo.site ? [wo.site.buildingNumber, wo.site.street, wo.site.district, wo.site.city].filter(Boolean).join('، ') : '';
  const showDevices = wo.type === 'installation' || wo.type === 'commissioning' || wo.assets.length > 0;
  const done = wo.status === 'completed' || wo.status === 'closed';
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const missKeys = new Set((missing ?? []).map((m) => sectionOf(m.key)));
  const hasMiss = (sec: string) => missKeys.has(sec) || (sec === 'sec-checklist' && [...missKeys].some((k) => k.startsWith('check-')));

  const startTravel = () => run('travel', () => api.post<WOView>(`/field/work-orders/${id}/start-travel`), bi('بدأت الرحلة — قُد بأمان', 'Travel started — drive safely'));
  const checkIn = async () => {
    if (isOffline()) return void toast.error(offlineMsg());
    setBusy('checkin');
    const pos = await getPosition();
    try {
      onView(await api.post<WOView>(`/field/work-orders/${id}/check-in`, pos ?? {}));
      if (pos) toast.success(bi('تم تسجيل الوصول مع الموقع', 'Checked in with location'));
      else toast.warning(bi('تم تسجيل الوصول بدون إحداثيات (الموقع غير متاح أو مرفوض)', 'Checked in without coordinates (location unavailable or denied)'));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const awaitingParts = async () => {
    if (!partsNote?.trim()) return toast.error(bi('اكتب القطع المطلوبة', 'Describe the parts needed'));
    await run('parts', () => api.post<WOView>(`/field/work-orders/${id}/awaiting-parts`, { note: partsNote.trim() }), bi('سُجّل الأمر بانتظار قطع غيار', 'Job set to awaiting parts'));
    setPartsNote(null);
  };
  const complete = async () => {
    if (isOffline()) return void toast.error(offlineMsg());
    setMissing(null);
    // the completion gate reads the server copy — send what is still queued first
    if (outbox.pending.length || outbox.photoPending) {
      setBusy('complete');
      const ok = await outbox.flush();
      setBusy(null);
      if (!ok) return void toast.error(bi('أرسل التعديلات المعلّقة أولًا (زر «إعادة المحاولة» أعلى الصفحة)', 'Send the pending changes first (the “Retry” button at the top)'));
    }
    setBusy('complete');
    try {
      const res = await fetch(`/api/field/work-orders/${id}/complete`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        onView(body as WOView);
        setReportError((body as WOView).reportError ?? null);
        toast.success(bi('اكتمل أمر العمل', 'Job completed'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (res.status === 400 && Array.isArray(body?.missing)) {
        const m = body.missing as Missing[];
        setMissing(m);
        toast.error(bi('لا يمكن الإنجاز — بنود ناقصة', 'Cannot complete — items missing'));
        const first = m[0] ? document.getElementById(sectionOf(m[0].key)) : null;
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        toast.error(body?.message ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const regenerate = async () => {
    setBusy('report');
    try {
      await api.post(`/field/work-orders/${id}/report`);
      setReportError(null);
      refresh();
      toast.success(bi('أُنشئ تقرير الخدمة', 'Service report generated'));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const sendReport = async () => {
    setBusy('send');
    try {
      const r = await api.post<{ to: string; status: string }>(`/field/work-orders/${id}/send-report`, { to: sendTo.trim() || null });
      setSent(r.to);
      toast.success(bi(`أُرسل التقرير عبر واتساب إلى ${r.to}`, `Report sent via WhatsApp to ${r.to}`));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-3 pb-28">
      <Link href="/tech" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-gold-dark"><Back className="size-4" />{bi('يومي', 'My day')}</Link>
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-gold-dark">{type ? bi(type[0], type[1]) : wo.type} · <span className="num" dir="ltr">{wo.number}</span></span>
          <StatusChip status={wo.status} bi={bi} />
        </div>
        <h1 className="text-xl font-extrabold text-primary">{wo.title}</h1>
        <OutboxBar />
        {wo.scheduledStart && <p className="text-sm text-muted">{bi('الموعد', 'Scheduled')}: <span className="num" dir="ltr">{wo.scheduledStart.slice(0, 10)} {timeOf(wo.scheduledStart)}</span></p>}
      </header>

      {/* ── completion result ── */}
      {done && (
        <section className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="flex items-center gap-2 text-base font-extrabold text-emerald-800"><CheckCircle2 className="size-6" />{bi('تم إنجاز أمر العمل', 'Job completed')}</p>
          {wo.reportUrl ? (
            <a href={wo.reportUrl} target="_blank" rel="noopener noreferrer" className={clsx(tap, tapTone.outline, 'w-full')}><FileText className="size-5" />{bi('عرض تقرير الخدمة (PDF)', 'View service report (PDF)')}</a>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-amber-800">{bi('لم يُنشأ تقرير الخدمة بعد', 'The service report has not been generated yet')}{reportError ? ` — ${reportError}` : ''}</p>
              <button type="button" className={clsx(tap, tapTone.outline, 'w-full')} onClick={() => void regenerate()} disabled={busy === 'report'}>{busy === 'report' ? <Loader2 className="size-5 animate-spin" /> : <FileText className="size-5" />}{bi('إنشاء التقرير', 'Generate report')}</button>
            </div>
          )}
          {wo.reportUrl && (
            <>
              <input className="num min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-gold" dir="ltr" type="tel" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder={phone ?? '05XXXXXXXX'} aria-label={bi('جوال العميل (اختياري)', 'Customer mobile (optional)')} />
              <button type="button" className={clsx(tap, tapTone.green, 'w-full')} onClick={() => void sendReport()} disabled={busy === 'send'}>
                {busy === 'send' ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}{bi('إرسال التقرير للعميل عبر واتساب', 'Send report to customer by WhatsApp')}
              </button>
              {sent && <p className="text-sm text-emerald-800">{bi('أُرسل إلى', 'Sent to')} <span className="num" dir="ltr">{sent}</span></p>}
            </>
          )}
          <Link href="/tech" className={clsx(tap, tapTone.primary, 'w-full')}>{bi('العودة ليومي', 'Back to my day')}</Link>
        </section>
      )}

      {/* 1 ── job info ── */}
      <Section id="sec-info" step={1} title={bi('معلومات المهمة', 'Job info')}>
        <div className="space-y-2 text-sm">
          <p className="text-base font-bold text-ink">{wo.party?.nameAr ?? wo.partyName ?? wo.ticket?.contactName ?? '—'}</p>
          {(wo.siteName || address) && <p className="flex items-start gap-1.5 text-muted"><MapPin className="mt-0.5 size-4 shrink-0" /><span>{[wo.siteName, address].filter(Boolean).join(' — ')}</span></p>}
          {wo.locationPath && <p className="font-bold">{bi('الوحدة', 'Unit')}: <span className="num" dir="ltr">{wo.locationPath}</span></p>}
          {wo.site?.accessNotes && <p className="flex items-start gap-1.5 rounded-xl bg-tint p-2.5 text-ink"><KeyRound className="mt-0.5 size-4 shrink-0 text-gold-dark" /><span><b>{bi('ملاحظات الدخول', 'Access notes')}:</b> {wo.site.accessNotes}</span></p>}
          {wo.ticket && <p className="flex items-start gap-1.5"><Ticket className="mt-0.5 size-4 shrink-0 text-gold" /><span><span className="num" dir="ltr">{wo.ticket.number}</span> — {wo.ticket.subject}</span></p>}
          {wo.description && <p className="whitespace-pre-line text-ink/80">{wo.description}</p>}
          {(wo.ticket?.contactName || wo.contactName) && <p className="text-muted">{bi('جهة الاتصال', 'Contact')}: {wo.ticket?.contactName ?? wo.contactName} {phone && <span className="num" dir="ltr">{phone}</span>}</p>}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {nav ? <a href={nav} target="_blank" rel="noopener noreferrer" className={clsx(tap, tapTone.gold, 'px-2 text-sm')}><Navigation className="size-5" />{bi('الملاحة', 'Navigate')}</a> : <span className={clsx(tap, tapTone.outline, 'px-2 text-sm opacity-40')}><Navigation className="size-5" />{bi('الملاحة', 'Navigate')}</span>}
          {tel ? <a href={tel} className={clsx(tap, tapTone.outline, 'px-2 text-sm')}><Phone className="size-5" />{bi('اتصال', 'Call')}</a> : <span className={clsx(tap, tapTone.outline, 'px-2 text-sm opacity-40')}><Phone className="size-5" />{bi('اتصال', 'Call')}</span>}
          {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className={clsx(tap, tapTone.outline, 'px-2 text-sm text-emerald-700')}><MessageCircle className="size-5" />{bi('واتساب', 'WhatsApp')}</a> : <span className={clsx(tap, tapTone.outline, 'px-2 text-sm opacity-40')}><MessageCircle className="size-5" />{bi('واتساب', 'WhatsApp')}</span>}
        </div>
      </Section>

      {/* how-to articles for the job's device (knowledge base, internal + public) */}
      {(wo.assetId ?? wo.assets[0]?.id) && <TechHowTo assetId={(wo.assetId ?? wo.assets[0]?.id)!} />}

      {/* 2 ── status actions ── */}
      {!done && (
        <Section id="sec-status" step={2} title={bi('الحالة', 'Status')} highlight={hasMiss('sec-status')}>
          <div className="space-y-2">
            {wo.status === 'scheduled' || wo.status === 'new' ? (
              <p className="text-sm text-muted">{bi('لم يُسند الأمر للتنفيذ بعد — ينتظر الإرسال من المنسّق.', 'Not dispatched yet — waiting for the dispatcher.')}</p>
            ) : null}
            {can('en_route') && (
              <button type="button" className={clsx(tap, tapTone.primary, 'w-full')} onClick={() => void startTravel()} disabled={!!busy}>
                {busy === 'travel' ? <Loader2 className="size-5 animate-spin" /> : <Car className="size-5" />}{bi('بدء التوجّه للموقع', 'Start travel')}
              </button>
            )}
            {can('on_site') && (wo.status === 'dispatched' || wo.status === 'en_route') && (
              <>
                <button type="button" className={clsx(tap, tapTone.green, 'w-full')} onClick={() => void checkIn()} disabled={!!busy}>
                  {busy === 'checkin' ? <Loader2 className="size-5 animate-spin" /> : <MapPin className="size-5" />}{bi('وصلت — تسجيل الوصول', 'Arrived — check in')}
                </button>
                <p className="flex items-start gap-1.5 text-xs text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" />{bi('يُسجَّل موقعك الجغرافي مرة واحدة عند تسجيل الوصول فقط لإثبات الزيارة، ولا يتم تتبعك (نظام حماية البيانات الشخصية).', 'Your location is recorded once, at check-in only, as proof of visit — you are not tracked (PDPL).')}</p>
              </>
            )}
            {wo.checkInAt && <p className="text-sm text-emerald-800">{bi('تم تسجيل الوصول', 'Checked in')}: <span className="num" dir="ltr">{timeOf(wo.checkInAt)}</span></p>}
            {wo.status === 'awaiting_parts' && <p className="rounded-xl bg-orange-50 p-2.5 text-sm text-orange-900">{bi('الأمر بانتظار قطع غيار — سيُعاد جدولته من المنسّق.', 'Waiting for parts — the dispatcher will reschedule it.')}</p>}
            {can('awaiting_parts') && (partsNote === null ? (
              <button type="button" className={clsx(tap, tapTone.outline, 'w-full')} onClick={() => setPartsNote('')} disabled={!!busy}><Hourglass className="size-5" />{bi('بانتظار قطع غيار', 'Waiting for parts')}</button>
            ) : (
              <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/60 p-2">
                <textarea className="min-h-20 w-full rounded-xl border border-line bg-white p-3 text-base outline-none focus:border-gold" value={partsNote} onChange={(e) => setPartsNote(e.target.value)} placeholder={bi('ما القطع المطلوبة؟', 'Which parts are needed?')} autoFocus />
                <div className="flex gap-2">
                  <button type="button" className={clsx(tap, tapTone.gold, 'flex-1')} onClick={() => void awaitingParts()} disabled={busy === 'parts'}><Hourglass className="size-5" />{bi('تأكيد', 'Confirm')}</button>
                  <button type="button" className={clsx(tap, tapTone.outline)} onClick={() => setPartsNote(null)}>{bi('إلغاء', 'Cancel')}</button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 3 ── checklist ── */}
      <Section id="sec-checklist" step={3} title={bi('بنود الفحص', 'Checklist')} highlight={hasMiss('sec-checklist')}>
        <ChecklistStep wo={wo} editable={editable} onView={onView} />
      </Section>

      {/* 4 ── photos ── */}
      <Section id="sec-photos" step={4} title={bi('الصور', 'Photos')} highlight={hasMiss('sec-photos')}>
        <PhotosStep wo={wo} editable={editable} onView={onView} />
      </Section>

      {/* 5 ── devices ── */}
      {showDevices && (
        <Section id="sec-devices" step={5} title={bi('الأجهزة المركبة', 'Installed devices')} highlight={hasMiss('sec-devices')}>
          <DevicesStep wo={wo} editable={editable} onAdded={refresh} />
        </Section>
      )}

      {/* 6 ── parts + findings ── */}
      <Section id="sec-parts" step={showDevices ? 6 : 5} title={bi('القطع والملاحظات', 'Parts & findings')}>
        <PartsStep wo={wo} editable={editable} onView={onView} />
      </Section>

      {/* 7 ── signature ── */}
      <Section id="sec-signature" step={showDevices ? 7 : 6} title={bi('توقيع العميل', 'Customer signature')} highlight={hasMiss('sec-signature')}>
        <SignatureStep key={wo.signatureFileId ?? 'none'} wo={wo} editable={editable} onView={onView} />
      </Section>

      {/* 8 ── complete ── */}
      {!done && editable && (
        <Section id="sec-complete" step={showDevices ? 8 : 7} title={bi('إنجاز المهمة', 'Complete job')}>
          {(missing ?? wo.missing).length > 0 && (
            <div className={clsx('mb-3 rounded-xl p-3 text-sm', missing ? 'bg-rose-50 text-rose-900' : 'bg-tint text-ink')}>
              <p className="mb-1 font-bold">{bi('المتبقي قبل الإنجاز', 'Still needed before completion')}:</p>
              <ul className="space-y-1">
                {(missing ?? wo.missing).map((m) => (
                  <li key={m.key}>
                    <button type="button" className="min-h-9 text-start underline decoration-dotted underline-offset-4" onClick={() => document.getElementById(sectionOf(m.key))?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                      • {locale === 'en' ? m.en : m.ar}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className={clsx(tap, tapTone.green, 'w-full text-lg')} onClick={() => void complete()} disabled={!!busy || !can('completed')}>
            {busy === 'complete' ? <Loader2 className="size-5 animate-spin" /> : <CheckCircle2 className="size-6" />}{bi('إنجاز المهمة', 'Complete job')}
          </button>
          {!can('completed') && <p className="mt-2 text-xs text-muted">{bi('يمكن الإنجاز بعد تسجيل الوصول للموقع.', 'You can complete the job after checking in on site.')}</p>}
        </Section>
      )}
    </div>
  );
}
