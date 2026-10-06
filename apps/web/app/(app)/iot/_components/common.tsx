'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Radio, Siren } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, clsx, Dialog, Field, Input, Select } from '@/components/ui';

type L = Record<string, [string, string, string?]>;

export const SEVERITY: L = {
  CRITICAL: ['حرج', 'Critical', 'bg-rose-100 text-rose-800'],
  MAJOR: ['مرتفع', 'Major', 'bg-amber-100 text-amber-800'],
  MINOR: ['منخفض', 'Minor', 'bg-sky-100 text-sky-800'],
  WARNING: ['تحذير', 'Warning', 'bg-gray-100 text-gray-700'],
  INDETERMINATE: ['غير محدد', 'Indeterminate', 'bg-gray-100 text-gray-700'],
};

export const ALARM_STATUS: L = {
  active: ['نشط', 'Active', 'bg-rose-100 text-rose-800'],
  acknowledged: ['مُستلَم', 'Acknowledged', 'bg-amber-100 text-amber-800'],
  cleared: ['زال', 'Cleared', 'bg-emerald-100 text-emerald-800'],
};

export interface AlarmRow {
  id: string; externalId: string; deviceId: string; alarmType: string; severity: string; status: string;
  assetId: string | null; ticketId: string | null; occurrences: number; firstSeenAt: string; lastSeenAt: string; clearedAt: string | null; syncedAt: string | null;
  assetCode: string | null; assetSerial: string | null; siteId: string | null; siteName: string | null; ticketNumber: string | null; ticketStatus: string | null;
}

export function IotChip({ map, value }: { map: L; value: string | null | undefined }) {
  const { locale } = useI18n();
  if (!value) return <span className="text-muted">—</span>;
  const e = map[value];
  return <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', e?.[2] ?? 'bg-gray-100 text-gray-700')}>{e ? (locale === 'en' ? e[1] : e[0]) : value}</span>;
}

/** Green / red / grey dot for online / offline / never reported. */
export function OnlineDot({ online, withLabel }: { online: boolean | null | undefined; withLabel?: boolean }) {
  const { bi } = useI18n();
  const label = online === true ? bi('متصل', 'Online') : online === false ? bi('غير متصل', 'Offline') : bi('لا بيانات', 'No data');
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className={clsx('inline-block size-2.5 rounded-full', online === true ? 'bg-ok' : online === false ? 'bg-danger' : 'bg-gray-300')} />
      {withLabel && <span className="text-xs font-bold">{label}</span>}
    </span>
  );
}

/** Demo / commissioning: send an alarm through the same path as the ThingsBoard webhook (iot.manage). */
export function SimulateAlarmDialog({ open, onClose, assetId, deviceName }: { open: boolean; onClose: () => void; assetId?: string | null; deviceName?: string | null }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({ deviceName: deviceName ?? '', type: 'Device offline', severity: 'CRITICAL' });
  const run = useMutation({
    mutationFn: () => api.post<{ action: string; ticketNumber?: string; ticketId?: string | null }>('/iot/test-alarm', { assetId: assetId ?? null, deviceName: assetId ? null : f.deviceName.trim(), type: f.type.trim(), severity: f.severity }),
    onSuccess: (r) => {
      const msg: Record<string, string> = {
        ticket: bi(`فُتح البلاغ ${r.ticketNumber ?? ''}`, `Ticket ${r.ticketNumber ?? ''} opened`),
        merged: bi('دُمج مع تنبيه نشط للجهاز نفسه', 'Merged into the active alarm of this device'),
        logged: bi('سُجّل التنبيه دون بلاغ (خطورة منخفضة)', 'Alarm logged without a ticket (low severity)'),
        unknown_device: bi('جهاز غير مربوط — سُجّل التنبيه وأُبلغ مسؤولو IoT', 'Unbound device — alarm stored and IoT managers notified'),
      };
      toast.success(msg[r.action] ?? r.action);
      qc.invalidateQueries({ queryKey: ['iot-alarms'] });
      qc.invalidateQueries({ queryKey: ['iot-site-health'] });
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Siren className="size-4" />{bi('محاكاة تنبيه جهاز', 'Simulate a device alarm')}</span>}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={run.isPending} disabled={!f.type.trim() || (!assetId && !f.deviceName.trim())} onClick={() => run.mutate()}>{bi('إرسال', 'Send')}</Button></>}>
      <div className="grid gap-3">
        {!assetId && <Field label={bi('معرّف الجهاز في ThingsBoard / الرقم التسلسلي / MAC', 'ThingsBoard device / serial / MAC')}><Input dir="ltr" className="text-start" value={f.deviceName} onChange={(e) => setF((s) => ({ ...s, deviceName: e.target.value }))} /></Field>}
        <Field label={bi('نوع التنبيه', 'Alarm type')}><Input dir="ltr" className="text-start" value={f.type} onChange={(e) => setF((s) => ({ ...s, type: e.target.value }))} /></Field>
        <Field label={bi('الخطورة', 'Severity')} hint={bi('الحرج والمرتفع يفتحان بلاغًا وأمر عمل؛ الأقل يُسجَّل فقط.', 'Critical and major open a ticket and a work order; lower ones are only logged.')}>
          <Select value={f.severity} onChange={(e) => setF((s) => ({ ...s, severity: e.target.value }))}>
            {['CRITICAL', 'MAJOR', 'MINOR', 'WARNING'].map((s) => <option key={s} value={s}>{bi(SEVERITY[s]![0], SEVERITY[s]![1])}</option>)}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/** Installed-device page: ThingsBoard binding + online state (IOT-01/06). */
export function IotBindingCard({ asset }: { asset: { id: string; siteId?: string | null; iotDeviceId?: string | null; iotOnline?: boolean | null; iotLastSeenAt?: string | null } }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const [value, setValue] = useState(asset.iotDeviceId ?? '');
  const [simulate, setSimulate] = useState(false);
  const dirty = value.trim() !== (asset.iotDeviceId ?? '');
  const save = useMutation({
    mutationFn: () => api.put(`/field/assets/${asset.id}/iot`, { iotDeviceId: value.trim() || null }),
    onSuccess: () => { toast.success(bi('تم ربط الجهاز', 'Device binding saved')); qc.invalidateQueries({ queryKey: ['field-asset', asset.id] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card title={<span className="flex items-center gap-2"><Radio className="size-4" />{bi('ربط IoT', 'IoT binding')}</span>}
      actions={asset.iotDeviceId ? <OnlineDot online={asset.iotOnline} withLabel /> : undefined}>
      <div className="space-y-2">
        {can('asset.write') ? (
          <div className="flex gap-2">
            <Input dir="ltr" className="text-start" value={value} onChange={(e) => setValue(e.target.value)} placeholder={bi('معرّف الجهاز في ThingsBoard', 'ThingsBoard device id')} />
            <Button variant="outline" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button>
          </div>
        ) : <div dir="ltr" className="num text-sm">{asset.iotDeviceId ?? '—'}</div>}
        <p className="text-xs text-muted">
          {bi('آخر ظهور', 'Last seen')}: <span className="num">{dateTime(asset.iotLastSeenAt ?? null)}</span>
          {' · '}{bi('بدون ربط تُطابَق التنبيهات بالرقم التسلسلي ثم MAC.', 'Unbound devices are matched by serial, then MAC.')}
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          {asset.siteId && <Link href={`/iot/sites/${asset.siteId}`} className="font-bold text-primary hover:underline">{bi('صحة أجهزة الموقع', 'Site device health')}</Link>}
          <Link href={`/iot?assetId=${asset.id}`} className="font-bold text-primary hover:underline">{bi('تنبيهات الجهاز', 'Device alarms')}</Link>
          {can('iot.manage') && <button type="button" onClick={() => setSimulate(true)} className="font-bold text-gold-dark hover:underline">{bi('محاكاة تنبيه', 'Simulate alarm')}</button>}
        </div>
      </div>
      {simulate && <SimulateAlarmDialog open onClose={() => setSimulate(false)} assetId={asset.id} />}
    </Card>
  );
}
