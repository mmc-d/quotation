'use client';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Card, Empty, ErrorBox, PageHeader, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { ALARM_STATUS, IotChip, OnlineDot, SEVERITY, type AlarmRow } from '../../_components/common';

interface SiteHealth {
  siteId: string; siteName: string; city: string | null; partyId: string | null;
  devicesBound: number; online: number; offline: number; onlinePercent: number | null; activeAlarms: number;
  devices: { id: string; code: string; serial: string | null; mac: string | null; iotDeviceId: string | null; online: boolean | null; lastSeenAt: string | null; locationPath: string | null }[];
  alarms: (AlarmRow & { assetSerial: string | null })[];
}

export default function SiteHealthPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = use(params);
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['iot-site-health', siteId], queryFn: () => api.get<SiteHealth>(`/iot/sites/${siteId}/health`), refetchInterval: 60_000 });
  const h = q.data;
  if (q.isLoading) return <Spinner />;
  if (!h) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;
  return (
    <>
      <PageHeader back="/iot" title={<>{bi('صحة الأجهزة', 'Device health')} — {h.siteName}</>} subtitle={h.city ?? undefined}
        actions={h.partyId ? <Link href={`/customers/${h.partyId}`} className="text-sm font-bold text-primary hover:underline">{bi('ملف العميل', 'Customer')}</Link> : undefined} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label={bi('نسبة الاتصال', 'Online')} value={<span className="num">{h.onlinePercent === null ? '—' : `${h.onlinePercent}%`}</span>} tone={h.onlinePercent === null ? undefined : h.onlinePercent >= 95 ? 'green' : h.onlinePercent >= 80 ? 'gold' : 'red'} />
        <Stat label={bi('أجهزة مربوطة', 'Bound devices')} value={<span className="num">{h.devicesBound}</span>} />
        <Stat label={bi('غير متصلة', 'Offline')} value={<span className="num">{h.offline}</span>} tone={h.offline ? 'red' : undefined} />
        <Stat label={bi('تنبيهات نشطة', 'Active alarms')} value={<span className="num">{h.activeAlarms}</span>} tone={h.activeAlarms ? 'red' : 'green'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false} title={bi('الأجهزة', 'Devices')}>
          {h.devices.length === 0 ? <Empty icon={<Radio className="size-8" />} title={bi('لا أجهزة مربوطة بـ ThingsBoard', 'No devices bound to ThingsBoard')} hint={bi('اربط الجهاز من صفحة الجهاز المركّب.', 'Bind a device from its installed-device page.')} /> : (
            <Table>
              <thead><tr><Th>{bi('الحالة', 'State')}</Th><Th>{bi('الجهاز', 'Device')}</Th><Th>{bi('المكان', 'Location')}</Th><Th>{bi('آخر ظهور', 'Last seen')}</Th></tr></thead>
              <tbody>
                {h.devices.map((d) => (
                  <tr key={d.id} className="hover:bg-tint/50">
                    <Td><OnlineDot online={d.online} withLabel /></Td>
                    <Td>
                      <Link href={`/field/assets/${d.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{d.code}{d.serial ? ` · ${d.serial}` : ''}</Link>
                      <div dir="ltr" className="num text-[11px] text-muted">{d.iotDeviceId}</div>
                    </Td>
                    <Td><span dir="ltr" className="num text-xs">{d.locationPath ?? '—'}</span></Td>
                    <Td className="num whitespace-nowrap text-xs">{dateTime(d.lastSeenAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card padded={false} title={bi('التنبيهات النشطة', 'Active alarms')}>
          {h.alarms.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد تنبيهات نشطة', 'No active alarms')}</p> : (
            <Table>
              <thead><tr><Th>{bi('الخطورة', 'Severity')}</Th><Th>{bi('التنبيه', 'Alarm')}</Th><Th>{bi('الجهاز', 'Device')}</Th><Th>{bi('البلاغ', 'Ticket')}</Th><Th>{bi('آخر ظهور', 'Last seen')}</Th></tr></thead>
              <tbody>
                {h.alarms.map((a) => (
                  <tr key={a.id} className="hover:bg-tint/50">
                    <Td><IotChip map={SEVERITY} value={a.severity} /><div className="mt-0.5"><IotChip map={ALARM_STATUS} value={a.status} /></div></Td>
                    <Td><span dir="ltr">{a.alarmType}</span>{a.occurrences > 1 && <span className="ms-1 text-xs text-muted">×<span className="num">{a.occurrences}</span></span>}</Td>
                    <Td><span dir="ltr" className="num text-xs">{a.assetCode}{a.assetSerial ? ` · ${a.assetSerial}` : ''}</span></Td>
                    <Td>{a.ticketId ? <Link href={`/field/tickets/${a.ticketId}`} dir="ltr" className="num font-bold text-primary hover:underline">{a.ticketNumber}</Link> : '—'}</Td>
                    <Td className="num whitespace-nowrap text-xs">{dateTime(a.lastSeenAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
