'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Circle, ExternalLink, FileText, MapPin, MessageCircle, Pencil, Phone, RefreshCw, RotateCcw, Send, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Checkbox, Dialog, ErrorBox, Field, Input, PageHeader, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { ConfirmDialog, ReasonDialog, isConflict } from '../../../quotes/_components/common';
import { CoverageBadge, Info, Ltr, ScheduleWarnings, TIME_KIND, WoStatusBadge, WoTypeBadge, mapsUrl, riyadhDay, riyadhTime, useLabel } from '../../_components/common';
import { LocationPicker } from '../../_components/locations';
import { ScheduleDialog } from '../../_components/schedule-dialog';
import type { WorkOrderView } from '../../_components/types';
import { CsatCard } from '../../../service/_components/csat-card';

const EDITABLE = ['new', 'scheduled', 'dispatched', 'en_route', 'on_site', 'awaiting_parts'];

export default function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi, locale } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const qc = useQueryClient();
  const key = ['field-wo', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<WorkOrderView>(`/field/work-orders/${id}`) });
  const [scheduling, setScheduling] = useState(false);
  const [confirm, setConfirm] = useState<'dispatch' | 'close' | null>(null);
  const [reason, setReason] = useState<'cancel' | 'reopen' | null>(null);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);

  const done = (wo: WorkOrderView, msg: string) => {
    qc.setQueryData(key, wo);
    qc.invalidateQueries({ queryKey: ['field-wos'] });
    qc.invalidateQueries({ queryKey: ['field-board'] });
    toast.success(msg);
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post<WorkOrderView>(`/field/work-orders/${id}/${path}`, body ?? {}),
    onSuccess: (wo) => { done(wo, bi('تم', 'Done')); setConfirm(null); setReason(null); },
    onError: (e) => toast.error((e as Error).message),
  });
  const regen = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/field/work-orders/${id}/report`),
    onSuccess: () => { toast.success(bi('تم إنشاء التقرير', 'Report generated')); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const wo = q.data;
  if (q.isLoading) return <Spinner />;
  if (!wo) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;

  const allowed = new Set(wo.allowedTransitions);
  const disp = wo.canDispatch;
  const canWrite = can('workorder.write');
  const finished = ['completed', 'closed'].includes(wo.status);
  const nav = mapsUrl(wo.site, wo.navUrl);
  const totalHours = wo.timeEntries.reduce((a, t) => a + (t.hours ? Number(t.hours) : t.endedAt ? (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 3600_000 : 0), 0);
  const doneCount = wo.checklist.filter((c) => c.done).length;

  return (
    <>
      <PageHeader
        back="/field/work-orders"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{wo.number}</span><WoTypeBadge type={wo.type} /><WoStatusBadge status={wo.status} /></span>}
        subtitle={wo.title}
        actions={<>
          {canWrite && EDITABLE.includes(wo.status) && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{bi('تعديل', 'Edit')}</Button>}
          {disp && allowed.has('scheduled') && <Button variant={wo.status === 'new' ? 'primary' : 'outline'} icon={<CalendarClock className="size-4" />} onClick={() => setScheduling(true)}>{wo.status === 'new' ? bi('جدولة', 'Schedule') : bi('إعادة جدولة', 'Reschedule')}</Button>}
          {disp && allowed.has('dispatched') && <Button icon={<Send className="size-4" />} disabled={!wo.technicianId} onClick={() => setConfirm('dispatch')}>{bi('إرسال للفني', 'Dispatch')}</Button>}
          {disp && allowed.has('closed') && <Button icon={<CheckCircle2 className="size-4" />} onClick={() => setConfirm('close')}>{bi('مراجعة وإغلاق', 'Review & close')}</Button>}
          {disp && wo.status === 'completed' && allowed.has('on_site') && <Button variant="outline" icon={<RotateCcw className="size-4" />} onClick={() => setReason('reopen')}>{bi('إعادة فتح', 'Reopen')}</Button>}
          {disp && allowed.has('cancelled') && <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setReason('cancel')}>{bi('إلغاء', 'Cancel')}</Button>}
        </>}
      />

      {wo.missing.length > 0 && !['closed', 'cancelled'].includes(wo.status) && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mb-1 flex items-center gap-2 text-sm font-extrabold text-amber-900"><AlertTriangle className="size-4" />{bi('ينقص لإكمال أمر العمل', 'Missing before completion')}</div>
          <ul className="flex flex-wrap gap-1.5">{wo.missing.map((m) => <li key={m.key}><Badge tone="gold">{locale === 'en' ? m.en : m.ar}</Badge></li>)}</ul>
        </div>
      )}

      {!['completed', 'closed', 'cancelled'].includes(wo.status) && <ScheduleWarnings warnings={wo.scheduleWarnings} className="mb-4" />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {wo.description && <Card title={bi('الوصف', 'Description')}><p className="whitespace-pre-wrap text-sm leading-relaxed">{wo.description}</p></Card>}

          <Card title={<>{bi('قائمة الفحص', 'Checklist')} <span className="num ms-1 text-xs text-muted">{doneCount}/{wo.checklist.length}</span></>}>
            {wo.checklist.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <ul className="space-y-1.5">
                {wo.checklist.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 text-sm">
                    {c.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" />}
                    <span className={c.done ? '' : 'text-muted'}>{locale === 'en' ? c.labelEn : c.labelAr}{c.required && <span className="text-danger"> *</span>}</span>
                    {c.value && <span className="text-xs text-muted">— {c.value}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={<>{bi('الصور', 'Photos')} <span className="num ms-1 text-xs text-muted">{wo.photos.length}</span></>}>
            {wo.photos.length === 0 ? <p className="text-sm text-muted">{bi('لا توجد صور بعد', 'No photos yet')}</p> : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {wo.photos.map((p) => (
                  <a key={p.fileId} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line bg-tint/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.filename} loading="lazy" className="aspect-square w-full object-cover transition hover:scale-105" />
                  </a>
                ))}
              </div>
            )}
          </Card>

          <Card padded={false} title={bi('القطع المستخدمة', 'Parts used')}>
            {wo.parts.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد', 'None')}</p> : (
              <Table>
                <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الوصف', 'Description')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th>{bi('التسلسلي', 'Serial')}</Th></tr></thead>
                <tbody>{wo.parts.map((p, i) => <tr key={`${p.code}-${i}`}><Td><Ltr>{p.code}</Ltr></Td><Td className="text-xs">{p.description ?? '—'}</Td><Td className="num text-end">{p.qty}</Td><Td className="text-xs"><Ltr>{p.serial}</Ltr></Td></tr>)}</tbody>
              </Table>
            )}
          </Card>

          <Card title={bi('ملاحظات الفني', 'Findings')}>
            {wo.findings ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{wo.findings}</p> : <p className="text-sm text-muted">—</p>}
          </Card>

          <Card padded={false} title={<>{bi('الأجهزة المسجلة', 'Registered devices')} <span className="num ms-1 text-xs text-muted">{wo.assets.length}</span></>}>
            {wo.assets.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لم تُسجّل أجهزة بهذا الأمر', 'No devices registered by this work order')}</p> : (
              <Table>
                <thead><tr><Th>{bi('الكود', 'Code')}</Th><Th>{bi('التسلسلي', 'Serial')}</Th><Th>MAC</Th><Th>IP</Th><Th>{bi('المكان', 'Location')}</Th><Th>{bi('الاختبار', 'Test')}</Th></tr></thead>
                <tbody>
                  {wo.assets.map((a) => (
                    <tr key={a.id} className="hover:bg-tint/50">
                      <Td><Link href={`/field/assets/${a.id}`} className="text-primary hover:underline"><Ltr className="font-bold">{a.code}</Ltr></Link></Td>
                      <Td className="text-xs"><Ltr>{a.serial}</Ltr></Td><Td className="text-xs"><Ltr>{a.mac}</Ltr></Td><Td className="text-xs"><Ltr>{a.ip}</Ltr></Td><Td className="text-xs"><Ltr>{a.locationPath}</Ltr></Td>
                      <Td>{a.testPassed === null ? '—' : a.testPassed ? <Badge tone="green">{bi('ناجح', 'Passed')}</Badge> : <Badge tone="red">{bi('فشل', 'Failed')}</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card padded={false} title={<>{bi('سجل الوقت', 'Time entries')} <span className="num ms-1 text-xs text-muted">{totalHours.toFixed(2)} {bi('ساعة', 'h')}</span></>}>
            {wo.timeEntries.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا يوجد', 'None')}</p> : (
              <Table>
                <thead><tr><Th>{bi('الموظف', 'Person')}</Th><Th>{bi('النوع', 'Kind')}</Th><Th>{bi('من', 'From')}</Th><Th>{bi('إلى', 'To')}</Th><Th className="text-end">{bi('الساعات', 'Hours')}</Th></tr></thead>
                <tbody>
                  {wo.timeEntries.map((t) => (
                    <tr key={t.id}>
                      <Td className="text-xs">{t.userName ?? '—'}</Td><Td className="text-xs">{label(TIME_KIND, t.kind)}</Td>
                      <Td className="num whitespace-nowrap text-xs">{dateTime(t.startedAt)}</Td>
                      <Td className="num whitespace-nowrap text-xs">{t.endedAt ? dateTime(t.endedAt) : <Badge tone="blue">{bi('جارٍ', 'running')}</Badge>}</Td>
                      <Td className="num text-end text-xs">{t.hours ?? (t.endedAt ? ((Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 3600_000).toFixed(2) : '—')}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5"><ShieldCheck className="size-4" />{bi('التغطية', 'Coverage')}</span>}>
            <CoverageBadge block coverage={wo.coverage} reason={wo.coverageReason} />
          </Card>

          <Card title={bi('الموعد والفريق', 'Schedule & crew')}>
            <Info label={bi('الفني', 'Technician')}>{wo.technicianName ?? '—'}</Info>
            <Info label={bi('الفريق', 'Crew')}>{wo.crewNames.length ? wo.crewNames.join('، ') : '—'}</Info>
            <Info label={bi('البداية', 'Start')}><span className="num">{wo.scheduledStart ? `${riyadhDay(wo.scheduledStart)} ${riyadhTime(wo.scheduledStart)}` : '—'}</span></Info>
            <Info label={bi('النهاية', 'End')}><span className="num">{wo.scheduledEnd ? `${riyadhDay(wo.scheduledEnd)} ${riyadhTime(wo.scheduledEnd)}` : '—'}</span></Info>
            <Info label={bi('نوع العمل', 'Work setting')}>{wo.outdoor ? <Badge tone="gold">{bi('خارجي', 'Outdoor')}</Badge> : <span className="text-muted">{bi('داخلي', 'Indoor')}</span>}</Info>
            <Info label={bi('وصول الموقع', 'Checked in')}><span className="num">{dateTime(wo.checkInAt)}</span></Info>
            {wo.checkInAt && (
              <Info label={bi('بُعد الوصول عن الموقع', 'Check-in distance')}>
                <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                  {wo.checkInDistanceM == null
                    ? <span className="text-xs text-muted">{bi('غير معروف (لا إحداثيات)', 'Unknown (no coordinates)')}</span>
                    : <span dir="ltr" className="num">{wo.checkInDistanceM >= 1000 ? `${(wo.checkInDistanceM / 1000).toFixed(1)} km` : `${wo.checkInDistanceM} m`}</span>}
                  {wo.checkInOutsideGeofence && <Badge tone="red">{bi('خارج نطاق الموقع', 'Outside site area')}</Badge>}
                </span>
              </Info>
            )}
            <Info label={bi('الإكمال', 'Completed')}><span className="num">{dateTime(wo.completedAt)}</span></Info>
            <Info label={bi('توقيع العميل', 'Customer signature')}>{wo.signatureName ?? <span className="text-muted">—</span>}</Info>
            {wo.signatureFileId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${wo.signatureFileId}`} alt={bi('التوقيع', 'Signature')} className="mt-2 max-h-24 rounded border border-line bg-white" />
            )}
          </Card>

          <Card title={bi('العميل والموقع', 'Customer & site')}>
            <Info label={bi('العميل', 'Customer')}>{wo.party ? <Link href={`/customers/${wo.party.id}`} className="font-bold text-primary hover:underline">{wo.party.nameAr}</Link> : '—'}</Info>
            {wo.party?.phone && <Info label={bi('الهاتف', 'Phone')}><a href={`tel:${wo.party.phone}`} className="text-primary hover:underline"><Ltr>{wo.party.phone}</Ltr></a></Info>}
            {wo.ticket?.contactName && <Info label={bi('المتصل', 'Caller')}>{wo.ticket.contactName} {wo.ticket.contactPhone && <a href={`tel:${wo.ticket.contactPhone}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="size-3" /><Ltr>{wo.ticket.contactPhone}</Ltr></a>}</Info>}
            <Info label={bi('الموقع', 'Site')}>{wo.site ? <>{wo.site.name}{wo.site.city ? ` — ${wo.site.city}` : ''}</> : '—'}</Info>
            {wo.site && (wo.site.district || wo.site.street) && <Info label={bi('العنوان', 'Address')}><span className="text-xs">{[wo.site.buildingNumber, wo.site.street, wo.site.district].filter(Boolean).join('، ')}</span></Info>}
            <Info label={bi('المكان', 'Location')}><Ltr>{wo.locationPath}</Ltr></Info>
            <Info label={bi('الجهاز', 'Device')}>{wo.asset ? <Link href={`/field/assets/${wo.asset.id}`} className="text-primary hover:underline"><Ltr>{`${wo.asset.code}${wo.asset.serial ? ` · ${wo.asset.serial}` : ''}`}</Ltr></Link> : '—'}</Info>
            {wo.site?.accessNotes && <p className="mt-2 rounded-lg bg-tint/60 px-2 py-1.5 text-xs">{wo.site.accessNotes}</p>}
            {nav && <a href={nav} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-bold text-primary hover:bg-tint"><MapPin className="size-4" />{bi('فتح في خرائط Google', 'Open in Google Maps')}</a>}
          </Card>

          {(wo.project || wo.ticket) && (
            <Card title={bi('مرتبط بـ', 'Linked to')}>
              {wo.project && <Info label={bi('المشروع', 'Project')}><Link href={`/projects/${wo.project.id}`} className="text-primary hover:underline"><Ltr>{wo.project.number}</Ltr> {wo.project.name}</Link></Info>}
              {wo.ticket && <Info label={bi('البلاغ', 'Service call')}><Link href={`/field/tickets/${wo.ticket.id}`} className="text-primary hover:underline"><Ltr>{wo.ticket.number}</Ltr> {wo.ticket.subject}</Link></Info>}
            </Card>
          )}

          <Card title={<span className="flex items-center gap-1.5"><FileText className="size-4" />{bi('تقرير الخدمة', 'Service report')}</span>}>
            {!finished ? <p className="text-sm text-muted">{bi('يصدر التقرير عند إكمال أمر العمل.', 'The report is issued when the work order is completed.')}</p> : (
              <div className="flex flex-col gap-2">
                {wo.reportUrl ? (
                  <a href={wo.reportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-white hover:bg-primary-600"><ExternalLink className="size-4" />{bi('فتح التقرير', 'Open report')}</a>
                ) : <p className="text-sm text-amber-800">{bi('لم يُنشأ التقرير بعد.', 'The report has not been generated yet.')}</p>}
                {canWrite && <Button variant="outline" loading={regen.isPending} icon={<RefreshCw className="size-4" />} onClick={() => regen.mutate()}>{wo.reportUrl ? bi('إعادة إنشاء التقرير', 'Regenerate report') : bi('إنشاء التقرير', 'Generate report')}</Button>}
                {canWrite && <Button variant="gold" disabled={!wo.reportUrl} icon={<MessageCircle className="size-4" />} onClick={() => setSending(true)}>{bi('إرسال التقرير عبر واتساب', 'Send report by WhatsApp')}</Button>}
              </div>
            )}
          </Card>

          {finished && <CsatCard woId={wo.id} canSend={canWrite} />}
        </div>
      </div>

      <ScheduleDialog wo={scheduling ? wo : null} onClose={() => setScheduling(false)} onDone={() => qc.invalidateQueries({ queryKey: key })} />
      <ConfirmDialog
        open={!!confirm}
        title={confirm === 'dispatch' ? bi('إرسال أمر العمل للفني', 'Dispatch to technician') : bi('إغلاق أمر العمل', 'Close work order')}
        message={confirm === 'dispatch'
          ? bi(`سيُرسل تنبيه إلى ${wo.technicianName ?? 'الفني'}${wo.crewNames.length ? ' والفريق' : ''}.`, `${wo.technicianName ?? 'The technician'}${wo.crewNames.length ? ' and the crew' : ''} will be notified.`)
          : bi('تمت مراجعة العمل (وفوترته إن كان مدفوعًا)؟ لا يمكن تعديل أمر العمل بعد الإغلاق.', 'Has the work been reviewed (and billed if chargeable)? A closed work order cannot be changed.')}
        loading={act.isPending}
        onConfirm={() => confirm && act.mutate({ path: confirm })}
        onClose={() => setConfirm(null)}
      />
      <ReasonDialog
        open={!!reason}
        required
        danger={reason === 'cancel'}
        title={reason === 'cancel' ? bi('إلغاء أمر العمل', 'Cancel work order') : bi('إعادة فتح أمر العمل', 'Reopen work order')}
        hint={reason === 'reopen' ? bi('يعود أمر العمل إلى «في الموقع» ليكمل الفني ما ينقص.', 'The work order goes back to “on site” so the technician can finish what is missing.') : undefined}
        loading={act.isPending}
        onConfirm={(r) => reason && act.mutate({ path: reason, body: { reason: r } })}
        onClose={() => setReason(null)}
      />
      {sending && <SendReportDialog wo={wo} onClose={() => setSending(false)} />}
      {editing && <EditWoDialog wo={wo} onClose={() => setEditing(false)} onSaved={(w) => { done(w, bi('تم الحفظ', 'Saved')); setEditing(false); }} />}
    </>
  );
}

function SendReportDialog({ wo, onClose }: { wo: WorkOrderView; onClose: () => void }) {
  const { bi } = useI18n();
  const [to, setTo] = useState('');
  const send = useMutation({
    mutationFn: () => api.post<{ to: string; status: string; link: string }>(`/field/work-orders/${wo.id}/send-report`, { to: to.trim() || null }),
    onSuccess: (r) => { toast.success(bi(`أُرسل التقرير إلى ${r.to} (${r.status})`, `Report sent to ${r.to} (${r.status})`)); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const fallback = wo.ticket?.contactPhone ?? wo.party?.phone ?? null;
  return (
    <Dialog open onClose={onClose} title={bi('إرسال التقرير عبر واتساب', 'Send report by WhatsApp')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button variant="gold" loading={send.isPending} icon={<MessageCircle className="size-4" />} onClick={() => send.mutate()}>{bi('إرسال', 'Send')}</Button></>}>
      <Field label={bi('رقم الجوال', 'Mobile number')} hint={bi('اتركه فارغًا لاستخدام جوال المتصل أو جهة الاتصال الرئيسية للعميل', 'Leave empty to use the caller’s or the customer’s primary contact number')}>
        <Input dir="ltr" type="tel" className="text-start" value={to} onChange={(e) => setTo(e.target.value)} placeholder={fallback ?? '05xxxxxxxx'} />
      </Field>
    </Dialog>
  );
}

function EditWoDialog({ wo, onClose, onSaved }: { wo: WorkOrderView; onClose: () => void; onSaved: (w: WorkOrderView) => void }) {
  const { bi } = useI18n();
  const [title, setTitle] = useState(wo.title);
  const [description, setDescription] = useState(wo.description ?? '');
  const [locationId, setLocationId] = useState<string | null>(wo.locationId);
  const [outdoor, setOutdoor] = useState(!!wo.outdoor);
  const save = useMutation({
    mutationFn: () => api.put<WorkOrderView>(`/field/work-orders/${wo.id}`, { title: title.trim(), description: description.trim() || null, partyId: wo.partyId, siteId: wo.siteId, locationId, assetId: wo.assetId, outdoor, version: wo.version }),
    onSuccess: onSaved,
    onError: (e) => toast.error(isConflict(e) ? bi('عدّل شخص آخر أمر العمل — أعد التحميل', 'Someone else changed the work order — reload') : (e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} title={bi('تعديل أمر العمل', 'Edit work order')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3">
        <Field label={bi('العنوان', 'Title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={bi('المكان', 'Location')}><LocationPicker siteId={wo.siteId} value={locationId} onChange={setLocationId} /></Field>
        <Field label={bi('الوصف', 'Description')}><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Checkbox label={bi('عمل خارجي (يسري حظر الظهيرة صيفًا)', 'Outdoor work (summer midday ban applies)')} checked={outdoor} onChange={setOutdoor} />
      </div>
    </Dialog>
  );
}
