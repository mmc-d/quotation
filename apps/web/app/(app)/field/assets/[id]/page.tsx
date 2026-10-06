'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, LifeBuoy, Pencil, Plus, Trash2, Wrench, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, clsx, Dialog, ErrorBox, Field, Input, LinkButton, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { isConflict } from '../../../quotes/_components/common';
import { ASSET_STATUS, Chip, CoverageBadge, Info, Ltr, TicketStatusBadge, WoStatusBadge, WoTypeBadge, useReason } from '../../_components/common';
import { LocationPicker } from '../../_components/locations';
import type { AssetDetail } from '../../_components/types';
import { IotBindingCard } from '../../../iot/_components/common';

const DEFAULT_CHECKS: { key: string; ar: string; en: string }[] = [
  { key: 'call', ar: 'اختبار الاتصال', en: 'Call test' },
  { key: 'video', ar: 'اختبار الصورة', en: 'Video test' },
  { key: 'unlock', ar: 'اختبار فتح الباب', en: 'Unlock test' },
];

export default function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  const { can } = useMe();
  const reason = useReason();
  const canWrite = can('asset.write');
  const q = useQuery({ queryKey: ['field-asset', id], queryFn: () => api.get<AssetDetail>(`/field/assets/${id}`) });
  const [editing, setEditing] = useState(false);
  const a = q.data;
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

  if (q.isLoading) return <Spinner />;
  if (!a) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;

  const warrantyRow = (label: string, end: string | null) => (
    <Info label={label}>{end ? <span className={clsx('num', end < today ? 'text-danger' : 'text-ok')}>{date(end)} {end < today ? `(${bi('منتهٍ', 'expired')})` : ''}</span> : <span className="text-muted">—</span>}</Info>
  );

  return (
    <>
      <PageHeader
        back="/field/assets"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{a.code}</span><Chip map={ASSET_STATUS} value={a.status} /></span>}
        subtitle={a.description ?? undefined}
        actions={<>
          {canWrite && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{bi('تعديل', 'Edit')}</Button>}
          {can('ticket.write') && <LinkButton variant="primary" href={`/field/tickets?new=1&assetId=${a.id}`} icon={<LifeBuoy className="size-4" />}>{bi('بلاغ عطل جديد', 'New service call')}</LinkButton>}
        </>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={bi('التغطية اليوم', 'Coverage today')} actions={<span className="num text-xs text-muted">{a.coverageToday.date}</span>}>
            <CoverageBadge block coverage={a.coverageToday.coverage} reason={reason(a.coverageToday.reasonAr, a.coverageToday.reasonEn)} />
          </Card>

          <Card title={bi('البيانات', 'Details')}>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <div>
                <Info label={bi('الكود', 'Code')}><Ltr>{a.code}</Ltr></Info>
                <Info label={bi('الرقم التسلسلي', 'Serial')}><Ltr>{a.serial}</Ltr></Info>
                <Info label="MAC"><Ltr>{a.mac}</Ltr></Info>
                <Info label="IP"><Ltr>{a.ip}</Ltr></Info>
                <Info label={bi('إصدار البرنامج', 'Firmware')}><Ltr>{a.firmware}</Ltr></Info>
                <Info label={bi('تاريخ التركيب', 'Installed on')}><span className="num">{date(a.installedOn)}</span></Info>
              </div>
              <div>
                <Info label={bi('العميل', 'Customer')}>{a.party ? <Link href={`/customers/${a.party.id}`} className="font-bold text-primary hover:underline">{a.party.nameAr}</Link> : '—'}</Info>
                <Info label={bi('الموقع', 'Site')}>{a.site ? <>{a.site.name}{a.site.city ? ` — ${a.site.city}` : ''}</> : '—'}</Info>
                <Info label={bi('المكان', 'Location')}><Ltr>{a.locationPath}</Ltr></Info>
                <Info label={bi('المشروع', 'Project')}>{a.project ? <Link href={`/projects/${a.project.id}`} className="font-bold text-primary hover:underline"><span dir="ltr" className="num">{a.project.number}</span> — {a.project.name}</Link> : '—'}</Info>
                <Info label={bi('الجهاز الأب', 'Parent device')}>{a.parent ? <Link href={`/field/assets/${a.parent.id}`} className="text-primary hover:underline"><Ltr>{`${a.parent.code}${a.parent.serial ? ` · ${a.parent.serial}` : ''}`}</Ltr></Link> : '—'}</Info>
                {a.workOrderId && <Info label={bi('سُجّل بأمر العمل', 'Registered by work order')}><Link href={`/field/work-orders/${a.workOrderId}`} className="text-primary hover:underline">{bi('فتح', 'Open')}</Link></Info>}
              </div>
            </div>
          </Card>

          <TestCard asset={a} canWrite={canWrite} />

          <Card padded={false} title={bi('أوامر العمل', 'Work orders')} actions={can('workorder.write') && <LinkButton size="sm" href={`/field/work-orders/new?assetId=${a.id}`} icon={<Plus className="size-3.5" />}>{bi('أمر عمل', 'Work order')}</LinkButton>}>
            {a.workOrders.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد أوامر عمل', 'No work orders')}</p> : (
              <Table>
                <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('العنوان', 'Title')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('الموعد', 'Scheduled')}</Th></tr></thead>
                <tbody>
                  {a.workOrders.map((w) => (
                    <tr key={w.id} className="hover:bg-tint/50">
                      <Td><Link href={`/field/work-orders/${w.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{w.number}</Link></Td>
                      <Td>{w.title}</Td><Td><WoTypeBadge type={w.type} /></Td><Td><WoStatusBadge status={w.status} /></Td>
                      <Td className="num whitespace-nowrap text-xs">{dateTime(w.scheduledStart)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card padded={false} title={bi('بلاغات الأعطال', 'Service calls')}>
            {a.tickets.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد بلاغات', 'No service calls')}</p> : (
              <Table>
                <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('الموضوع', 'Subject')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('التغطية', 'Coverage')}</Th><Th>{bi('التاريخ', 'Date')}</Th></tr></thead>
                <tbody>
                  {a.tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-tint/50">
                      <Td><Link href={`/field/tickets/${t.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{t.number}</Link></Td>
                      <Td>{t.subject}</Td><Td><TicketStatusBadge status={t.status} /></Td><Td><CoverageBadge coverage={t.coverage} /></Td>
                      <Td className="num whitespace-nowrap text-xs">{date(t.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={bi('الضمان', 'Warranty')}>
            {warrantyRow(bi('ضمان التركيب (العمالة)', 'Labour / installation'), a.warranty.labourEnd)}
            {warrantyRow(bi('ضمان القطع', 'Parts'), a.warranty.partsEnd)}
            {warrantyRow(bi('ضمان المصنّع', 'Manufacturer'), a.warranty.manufacturerEnd)}
          </Card>

          <IotBindingCard asset={a as typeof a & { iotDeviceId?: string | null; iotOnline?: boolean | null; iotLastSeenAt?: string | null }} />

          <Card title={bi('السجل', 'Timeline')}>
            {a.timeline.length === 0 ? <p className="text-sm text-muted">{bi('لا أحداث', 'No events')}</p> : (
              <ol className="relative space-y-3 border-s border-line ps-4">
                {a.timeline.map((e, i) => (
                  <li key={`${e.kind}-${e.id}-${i}`} className="relative">
                    <span className={clsx('absolute -start-[1.4rem] top-1 size-2.5 rounded-full', e.kind === 'test' ? (e.passed ? 'bg-ok' : 'bg-danger') : e.kind === 'ticket' ? 'bg-amber-500' : e.kind === 'installed' ? 'bg-primary' : 'bg-gold')} />
                    <div className="num text-[11px] text-muted">{date(e.at)}</div>
                    {e.kind === 'installed' && <div className="text-sm font-bold">{bi('تم التركيب', 'Installed')}</div>}
                    {e.kind === 'test' && <div className="text-sm font-bold">{bi('اختبار التشغيل', 'Commissioning test')} — {e.passed ? <span className="text-ok">{bi('ناجح', 'passed')}</span> : <span className="text-danger">{bi('فشل', 'failed')}</span>}</div>}
                    {e.kind === 'work_order' && (
                      <Link href={`/field/work-orders/${e.id}`} className="block text-sm hover:underline">
                        <span dir="ltr" className="num font-bold text-primary">{e.number}</span> {e.title} {e.registeredHere && <Badge tone="gold">{bi('سُجّل فيه', 'registered')}</Badge>}
                        <div className="mt-0.5 flex gap-1">{e.type && <WoTypeBadge type={e.type} />}{e.status && <WoStatusBadge status={e.status} />}</div>
                      </Link>
                    )}
                    {e.kind === 'ticket' && (
                      <Link href={`/field/tickets/${e.id}`} className="block text-sm hover:underline">
                        <span dir="ltr" className="num font-bold text-primary">{e.number}</span> {e.title}
                        <div className="mt-0.5 flex gap-1">{e.status && <TicketStatusBadge status={e.status} />}<CoverageBadge coverage={e.coverage} /></div>
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card padded={false} title={bi('الأجهزة الفرعية', 'Child devices')}>
            {a.children.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا يوجد', 'None')}</p> : (
              <ul className="divide-y divide-line">
                {a.children.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <Link href={`/field/assets/${c.id}`} className="text-primary hover:underline"><Ltr>{`${c.code}${c.serial ? ` · ${c.serial}` : ''}`}</Ltr></Link>
                    <Chip map={ASSET_STATUS} value={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {editing && <EditAssetDialog asset={a} onClose={() => setEditing(false)} />}
    </>
  );
}

function TestCard({ asset, canWrite }: { asset: AssetDetail; canWrite: boolean }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const labelOf = (key: string) => { const d = DEFAULT_CHECKS.find((c) => c.key === key); return d ? (locale === 'en' ? d.en : d.ar) : key; };
  const initial = () => {
    const base = DEFAULT_CHECKS.map((c) => ({ key: c.key, ok: false, note: '' }));
    for (const r of asset.testResults ?? []) {
      const i = base.findIndex((b) => b.key === r.key);
      if (i >= 0) base[i] = { key: r.key, ok: r.ok, note: r.note ?? '' };
      else base.push({ key: r.key, ok: r.ok, note: r.note ?? '' });
    }
    return base;
  };
  const [rows, setRows] = useState(initial);
  const [custom, setCustom] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { setRows(initial()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [asset.version]);
  const save = useMutation({
    mutationFn: () => api.post(`/field/assets/${asset.id}/test`, { results: rows.map((r) => ({ key: r.key, ok: r.ok, note: r.note.trim() || null })) }),
    onSuccess: () => { toast.success(bi('تم حفظ نتيجة الاختبار', 'Test result saved')); setOpen(false); qc.invalidateQueries({ queryKey: ['field-asset', asset.id] }); qc.invalidateQueries({ queryKey: ['field-assets'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const addCustom = () => {
    const key = custom.trim();
    if (!key || rows.some((r) => r.key === key)) return;
    setRows((r) => [...r, { key, ok: false, note: '' }]);
    setCustom('');
  };
  return (
    <Card title={<span className="flex items-center gap-2"><ClipboardCheck className="size-4" />{bi('اختبار التشغيل', 'Commissioning test')}</span>}
      actions={<>
        {asset.testPassed !== null && (asset.testPassed ? <Badge tone="green">{bi('ناجح', 'Passed')}</Badge> : <Badge tone="red">{bi('فشل', 'Failed')}</Badge>)}
        {asset.testedOn && <span className="num text-xs text-muted">{date(asset.testedOn)}</span>}
        {canWrite && !open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{asset.testedOn ? bi('إعادة الاختبار', 'Re-test') : bi('تسجيل اختبار', 'Record test')}</Button>}
      </>}>
      {!open ? (
        asset.testResults.length === 0 ? <p className="text-sm text-muted">{bi('لم يُختبر الجهاز بعد', 'The device has not been tested yet')}</p> : (
          <ul className="space-y-1.5">
            {asset.testResults.map((r) => (
              <li key={r.key} className="flex items-start gap-2 text-sm">
                {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                <span className="font-bold">{labelOf(r.key)}</span>{r.note && <span className="text-muted">— {r.note}</span>}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
              <span className="min-w-[8rem] text-sm font-bold">{labelOf(r.key)}</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-line text-xs font-bold">
                <button type="button" onClick={() => setRows((s) => s.map((x, j) => (j === i ? { ...x, ok: true } : x)))} className={clsx('px-2.5 py-1', r.ok ? 'bg-ok text-white' : 'bg-white text-muted')}>{bi('ناجح', 'OK')}</button>
                <button type="button" onClick={() => setRows((s) => s.map((x, j) => (j === i ? { ...x, ok: false } : x)))} className={clsx('px-2.5 py-1', !r.ok ? 'bg-danger text-white' : 'bg-white text-muted')}>{bi('فشل', 'Fail')}</button>
              </div>
              <Input className="min-w-[10rem] flex-1" value={r.note} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} placeholder={bi('ملاحظة', 'Note')} />
              {!DEFAULT_CHECKS.some((d) => d.key === r.key) && <button type="button" onClick={() => setRows((s) => s.filter((_, j) => j !== i))} className="rounded p-1 text-danger hover:bg-rose-50" aria-label={bi('حذف', 'Delete')}><Trash2 className="size-4" /></button>}
            </div>
          ))}
          <div className="flex gap-2">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} placeholder={bi('اختبار إضافي (مثل: فك الأقفال عند الحريق)', 'Extra check (e.g. fire release)')} />
            <Button variant="outline" icon={<Plus className="size-4" />} onClick={addCustom} disabled={!custom.trim()}>{bi('إضافة', 'Add')}</Button>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => { setRows(initial()); setOpen(false); }}>{bi('إلغاء', 'Cancel')}</Button>
            <Button loading={save.isPending} icon={<Wrench className="size-4" />} onClick={() => save.mutate()}>{bi('حفظ النتيجة', 'Save result')}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function EditAssetDialog({ asset, onClose }: { asset: AssetDetail; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: asset.code, description: asset.description ?? '', serial: asset.serial ?? '', mac: asset.mac ?? '', ip: asset.ip ?? '', firmware: asset.firmware ?? '',
    installedOn: asset.installedOn ?? '', labourWarrantyEnd: asset.labourWarrantyEnd ?? '', partsWarrantyEnd: asset.partsWarrantyEnd ?? '', manufacturerWarrantyEnd: asset.manufacturerWarrantyEnd ?? '', status: asset.status,
  });
  const [locationId, setLocationId] = useState<string | null>(asset.locationId);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api.put(`/field/assets/${asset.id}`, {
      code: f.code.trim(), productId: asset.productId, description: f.description.trim() || null, serial: f.serial.trim() || null, mac: f.mac.trim() || null, ip: f.ip.trim() || null, firmware: f.firmware.trim() || null,
      attributes: asset.attributes ?? {}, locationId, siteId: asset.siteId, projectId: asset.projectId, parentAssetId: asset.parentAssetId, installedOn: f.installedOn || null,
      labourWarrantyEnd: f.labourWarrantyEnd || null, partsWarrantyEnd: f.partsWarrantyEnd || null, manufacturerWarrantyEnd: f.manufacturerWarrantyEnd || null, status: f.status, version: asset.version,
    }),
    onSuccess: () => { toast.success(bi('تم الحفظ', 'Saved')); qc.invalidateQueries({ queryKey: ['field-asset', asset.id] }); qc.invalidateQueries({ queryKey: ['field-assets'] }); onClose(); },
    onError: (e) => toast.error(isConflict(e) ? bi('عدّل شخص آخر الجهاز — أعد التحميل', 'Someone else changed the device — reload') : (e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} wide title={bi('تعديل الجهاز', 'Edit device')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!f.code.trim()} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('الكود', 'Code')}><Input dir="ltr" className="text-start" value={f.code} onChange={set('code')} /></Field>
        <Field label={bi('الوصف', 'Description')}><Input value={f.description} onChange={set('description')} /></Field>
        <Field label={bi('الرقم التسلسلي', 'Serial number')}><Input dir="ltr" className="text-start" value={f.serial} onChange={set('serial')} /></Field>
        <Field label="MAC"><Input dir="ltr" className="text-start" value={f.mac} onChange={set('mac')} /></Field>
        <Field label="IP"><Input dir="ltr" className="text-start" value={f.ip} onChange={set('ip')} /></Field>
        <Field label={bi('إصدار البرنامج', 'Firmware')}><Input dir="ltr" className="text-start" value={f.firmware} onChange={set('firmware')} /></Field>
        <Field label={bi('المكان', 'Location')}><LocationPicker siteId={asset.siteId} value={locationId} onChange={setLocationId} /></Field>
        <Field label={bi('الحالة', 'Status')}>
          <Select value={f.status} onChange={set('status')}>
            <option value="active">{bi('فعّال', 'Active')}</option><option value="replaced">{bi('مُستبدل', 'Replaced')}</option><option value="removed">{bi('مُزال', 'Removed')}</option>
          </Select>
        </Field>
        <Field label={bi('تاريخ التركيب', 'Installed on')}><Input type="date" dir="ltr" value={f.installedOn} onChange={set('installedOn')} /></Field>
        <Field label={bi('نهاية ضمان التركيب', 'Labour warranty end')}><Input type="date" dir="ltr" value={f.labourWarrantyEnd} onChange={set('labourWarrantyEnd')} /></Field>
        <Field label={bi('نهاية ضمان القطع', 'Parts warranty end')}><Input type="date" dir="ltr" value={f.partsWarrantyEnd} onChange={set('partsWarrantyEnd')} /></Field>
        <Field label={bi('نهاية ضمان المصنّع', 'Manufacturer warranty end')}><Input type="date" dir="ltr" value={f.manufacturerWarrantyEnd} onChange={set('manufacturerWarrantyEnd')} /></Field>
      </div>
      <p className="mt-3 text-xs text-muted">{bi('تواريخ الضمان لا تُحفظ إلا لمن لديه صلاحية تعديل على مستوى الفرع أو الشركة.', 'Warranty dates are only saved for users with branch- or company-wide device rights.')}</p>
    </Dialog>
  );
}

