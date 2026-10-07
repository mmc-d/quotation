'use client';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, History, ShieldCheck, Wrench } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { PublicCard } from '@/app/_public/public-shell';
import { portalFetch, portalRetry, type PortalDeviceDetail } from '../../_components/portal-api';
import { WorkOrderRow } from '../../_components/work-order-row';
import { CoverageBadge, EmptyState, ErrorBlock, Info, Loading, Num, PageTitle, PortalStatus, WarrantyBadge, sectionTitle } from '../../_components/portal-ui';

export default function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['portal', 'device', id], queryFn: () => portalFetch<PortalDeviceDetail>(`/devices/${id}`), retry: portalRetry });
  const back = { href: '/portal/devices', label: bi('الأجهزة', 'Devices') };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <><PageTitle title={bi('الجهاز', 'Device')} back={back} /><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></>;
  const d = q.data;

  return (
    <div className="space-y-4">
      <PageTitle
        back={back}
        title={<Num>{d.code}</Num>}
        subtitle={d.description}
        actions={<LinkButton href={`/portal/requests/new?assetId=${d.id}`} variant="primary" icon={<AlertCircle className="size-4" aria-hidden />}>{bi('الإبلاغ عن مشكلة', 'Report a problem')}</LinkButton>}
      />

      <PublicCard>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-xs font-bold text-muted">{bi('التغطية اليوم', 'Coverage today')} (<Num>{date(d.coverageToday.date)}</Num>)</div>
            <CoverageBadge coverage={d.coverageToday.coverage} reasonAr={d.coverageToday.reasonAr} reasonEn={d.coverageToday.reasonEn} />
            {d.coverageToday.agreementNumber && <div className="mt-1 text-xs text-muted">{bi('عقد الصيانة', 'Maintenance contract')}: <Num className="font-bold text-ink">{d.coverageToday.agreementNumber}</Num></div>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <Info label={bi('الموديل', 'Model')} value={<Num>{d.code}</Num>} />
          <Info label={bi('الرقم التسلسلي', 'Serial number')} value={<Num>{d.serial ?? '—'}</Num>} />
          {d.mac && <Info label="MAC" value={<Num>{d.mac}</Num>} />}
          <Info label={bi('الموقع', 'Site')} value={d.siteName ?? '—'} />
          <Info label={bi('المكان', 'Location')} value={d.locationPath ?? '—'} />
          <Info label={bi('تاريخ التركيب', 'Installed on')} value={<Num>{date(d.installedOn)}</Num>} />
        </dl>
      </PublicCard>

      <PublicCard>
        <h2 className={sectionTitle}><ShieldCheck className="size-4" aria-hidden />{bi('الضمان', 'Warranty')}</h2>
        <div className="space-y-2">
          <WarrantyBadge label={bi('ضمان العمالة (التركيب)', 'Labour (installation) warranty')} end={d.warranty.labourEnd} />
          <WarrantyBadge label={bi('ضمان قطع الغيار', 'Parts warranty')} end={d.warranty.partsEnd} />
          <WarrantyBadge label={bi('ضمان المصنّع', 'Manufacturer warranty')} end={d.warranty.manufacturerEnd} />
        </div>
      </PublicCard>

      <PublicCard>
        <h2 className={sectionTitle}><History className="size-4" aria-hidden />{bi('سجل الخدمة', 'Service history')}</h2>
        {d.serviceHistory.length === 0 ? <p className="text-sm text-muted">{bi('لا توجد زيارات خدمة بعد.', 'No service visits yet.')}</p> : (
          <ul className="divide-y divide-line">{d.serviceHistory.map((w) => <WorkOrderRow key={w.id} w={w} />)}</ul>
        )}
      </PublicCard>

      <PublicCard>
        <h2 className={sectionTitle}><Wrench className="size-4" aria-hidden />{bi('طلبات الصيانة لهذا الجهاز', 'Service requests for this device')}</h2>
        {d.tickets.length === 0 ? (
          <EmptyState title={bi('لا توجد طلبات', 'No requests')} action={<LinkButton href={`/portal/requests/new?assetId=${d.id}`} size="sm">{bi('الإبلاغ عن مشكلة', 'Report a problem')}</LinkButton>} />
        ) : (
          <ul className="divide-y divide-line">
            {d.tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/portal/requests/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-tint/30">
                  <span className="min-w-0"><Num className="text-xs font-bold text-muted">{t.number}</Num><span className="block truncate font-bold text-ink">{t.subject}</span><Num className="text-xs text-muted">{date(t.createdAt)}</Num></span>
                  <PortalStatus status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PublicCard>
    </div>
  );
}
