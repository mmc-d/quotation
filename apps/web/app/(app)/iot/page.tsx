'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Radio, Siren } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, clsx, Empty, ErrorBox, PageHeader, SearchBox, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { ALARM_STATUS, IotChip, SEVERITY, SimulateAlarmDialog, type AlarmRow } from './_components/common';

const chipCls = (on: boolean) => clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', on ? 'border-gold bg-tint text-primary' : 'border-line text-muted hover:bg-tint/60');

function AlarmsList() {
  const sp = useSearchParams();
  const { bi } = useI18n();
  const { can } = useMe();
  const [q, setQ] = useState('');
  const term = useDeferredValue(q.trim());
  const [statuses, setStatuses] = useState<string[]>(() => (sp.get('status') ?? 'active,acknowledged').split(',').filter(Boolean));
  const [severities, setSeverities] = useState<string[]>([]);
  const [simulate, setSimulate] = useState(false);
  const assetId = sp.get('assetId') ?? undefined;
  const siteId = sp.get('siteId') ?? undefined;
  const status = statuses.join(',');
  const severity = severities.join(',');
  const list = useQuery({
    queryKey: ['iot-alarms', term, status, severity, assetId, siteId],
    queryFn: () => api.get<{ rows: AlarmRow[]; total: number; counts: { active: number; unbound: number }; canManage: boolean }>(`/iot/alarms${qs({ q: term, status, severity, assetId, siteId, limit: 200 })}`),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
  const toggle = (set: typeof setStatuses) => (v: string) => set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const rows = list.data?.rows ?? [];

  return (
    <>
      <PageHeader
        title={bi('تنبيهات الأجهزة (IoT)', 'Device alerts (IoT)')}
        subtitle={bi('تنبيهات ThingsBoard المرتبطة بالأجهزة المركّبة — الحرج والمرتفع يفتحان بلاغًا وأمر عمل تلقائيًا', 'ThingsBoard alarms mapped to installed devices — critical and major ones open a ticket and a work order automatically')}
        actions={can('iot.manage') && <Button icon={<Siren className="size-4" />} onClick={() => setSimulate(true)}>{bi('محاكاة تنبيه', 'Simulate alarm')}</Button>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={bi('تنبيهات نشطة', 'Active alarms')} value={<span className="num">{list.data?.counts.active ?? '—'}</span>} tone={(list.data?.counts.active ?? 0) > 0 ? 'red' : 'green'} />
        <Stat label={bi('من أجهزة غير مربوطة', 'From unbound devices')} value={<span className="num">{list.data?.counts.unbound ?? '—'}</span>} tone="gold" />
        <Stat label={bi('المعروض', 'Shown')} value={<span className="num">{list.data?.total ?? '—'}</span>} />
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('بحث بالجهاز أو نوع التنبيه', 'Search device or alarm type')} />
          <div className="flex flex-wrap gap-1">
            {['active', 'acknowledged', 'cleared'].map((s) => <button key={s} type="button" className={chipCls(statuses.includes(s))} onClick={() => toggle(setStatuses)(s)}>{bi(ALARM_STATUS[s]![0], ALARM_STATUS[s]![1])}</button>)}
            <button type="button" className={chipCls(statuses.includes('unbound'))} onClick={() => toggle(setStatuses)('unbound')}>{bi('غير مربوط', 'Unbound')}</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {['CRITICAL', 'MAJOR', 'MINOR', 'WARNING'].map((s) => <button key={s} type="button" className={chipCls(severities.includes(s))} onClick={() => toggle(setSeverities)(s)}>{bi(SEVERITY[s]![0], SEVERITY[s]![1])}</button>)}
          </div>
        </div>
        {list.isLoading ? <Spinner /> : list.error ? <div className="p-4"><ErrorBox error={list.error} /></div> : rows.length === 0 ? (
          <Empty icon={<Radio className="size-8" />} title={bi('لا توجد تنبيهات', 'No alarms')} hint={bi('تصل التنبيهات من سلسلة قواعد ThingsBoard عبر الويب هوك الموقّع.', 'Alarms arrive from the ThingsBoard rule chain through the signed webhook.')} />
        ) : (
          <Table>
            <thead><tr>
              <Th>{bi('الخطورة', 'Severity')}</Th><Th>{bi('التنبيه', 'Alarm')}</Th><Th>{bi('الجهاز', 'Device')}</Th><Th>{bi('الموقع', 'Site')}</Th>
              <Th>{bi('الحالة', 'Status')}</Th><Th>{bi('البلاغ', 'Ticket')}</Th><Th>{bi('التكرار', 'Repeats')}</Th><Th>{bi('آخر ظهور', 'Last seen')}</Th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-tint/50">
                  <Td><IotChip map={SEVERITY} value={a.severity} /></Td>
                  <Td><span dir="ltr" className="font-bold">{a.alarmType}</span></Td>
                  <Td>
                    {a.assetId ? <Link href={`/field/assets/${a.assetId}`} dir="ltr" className="num text-primary hover:underline">{a.assetCode}{a.assetSerial ? ` · ${a.assetSerial}` : ''}</Link> : <span dir="ltr" className="num text-muted">{a.deviceId}</span>}
                    {!a.assetId && <div className="text-[11px] font-bold text-gold-dark">{bi('غير مربوط', 'Unbound')}</div>}
                  </Td>
                  <Td>{a.siteId ? <Link href={`/iot/sites/${a.siteId}`} className="text-primary hover:underline">{a.siteName}</Link> : '—'}</Td>
                  <Td>
                    <IotChip map={ALARM_STATUS} value={a.status} />
                    {a.syncedAt && <div className="text-[11px] text-muted">{bi('أُغلق في ThingsBoard', 'Cleared in ThingsBoard')}</div>}
                  </Td>
                  <Td>{a.ticketId ? <Link href={`/field/tickets/${a.ticketId}`} dir="ltr" className="num font-bold text-primary hover:underline">{a.ticketNumber}</Link> : <span className="text-muted">—</span>}</Td>
                  <Td className="num">{a.occurrences}</Td>
                  <Td className="num whitespace-nowrap text-xs">{dateTime(a.lastSeenAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {simulate && <SimulateAlarmDialog open onClose={() => setSimulate(false)} />}
    </>
  );
}

export default function IotPage() {
  return <Suspense fallback={<Spinner />}><AlarmsList /></Suspense>;
}
