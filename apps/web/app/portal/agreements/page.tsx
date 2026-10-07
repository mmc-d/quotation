'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CalendarDays, FileSignature, RefreshCw, ShieldCheck } from 'lucide-react';
import { PublicCard } from '@/app/_public/public-shell';
import { Money, clsx } from '@/components/ui';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalAgreement, type Rows } from '../_components/portal-api';
import { Chip, EmptyState, ErrorBlock, Info, Loading, Num, PageTitle, PortalStatus } from '../_components/portal-ui';

const FREQ: Record<string, [string, string]> = { annual: ['سنوي', 'Annual'], semiannual: ['نصف سنوي', 'Semi-annual'], quarterly: ['ربع سنوي', 'Quarterly'], monthly: ['شهري', 'Monthly'] };

export default function AgreementsPage() {
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['portal', 'agreements'], queryFn: () => portalFetch<Rows<PortalAgreement>>('/agreements'), retry: portalRetry });

  return (
    <div>
      <PageTitle title={bi('عقود الصيانة', 'Maintenance agreements')} subtitle={bi('التغطية ومستوى الخدمة والزيارات القادمة وحالة التجديد.', 'Coverage, service levels, upcoming visits and renewal status.')} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBlock error={q.error} onRetry={() => q.refetch()} /> : !q.data?.rows.length ? (
        <EmptyState icon={<FileSignature className="size-8" />} title={bi('لا توجد عقود صيانة', 'No maintenance agreements')} hint={bi('تواصل معنا لمعرفة باقات الصيانة الدورية المناسبة لك.', 'Contact us to learn about the preventive maintenance plans that suit you.')} />
      ) : (
        <ul className="space-y-4">{q.data.rows.map((a) => <li key={a.id}><AgreementCard a={a} /></li>)}</ul>
      )}
    </div>
  );
}

function AgreementCard({ a }: { a: PortalAgreement }) {
  const { bi } = useI18n();
  const active = a.status === 'active';
  const soon = active && a.daysLeft <= 30;
  const freq = FREQ[a.billingFrequency];
  return (
    <PublicCard className={clsx(soon && 'border-2 border-amber-300')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Num className="text-xs font-bold text-muted">{a.number}</Num>
          <h2 className="text-lg font-extrabold text-primary">{bi('باقة', 'Plan')}: {bi(a.tier.ar, a.tier.en)}</h2>
          <p className="text-xs text-muted"><Num>{date(a.startDate)}</Num> – <Num>{date(a.endDate)}</Num></p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <PortalStatus status={a.status} />
          {active && (
            <Chip className={soon ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}>
              <CalendarClock className="size-3" aria-hidden />{bi('متبقٍ', '')} <Num>{a.daysLeft}</Num> {bi('يومًا', 'days left')}
            </Chip>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
        <Info label={bi('ساعات التغطية', 'Coverage hours')} value={a.coverage.hours === '24x7' ? bi('على مدار الساعة 7/24', '24/7') : bi('ساعات العمل الرسمية', 'Business hours')} />
        <Info label={bi('زمن الاستجابة', 'Response time')} value={<>{bi('خلال', 'Within')} <Num>{a.coverage.responseHours}</Num> {bi('ساعة', 'h')}</>} />
        <Info label={bi('زمن الحل', 'Resolution time')} value={<>{bi('خلال', 'Within')} <Num>{a.coverage.resolutionHours}</Num> {bi('ساعة', 'h')}</>} />
        <Info label={bi('الزيارات الوقائية', 'Preventive visits')} value={<><Num>{a.coverage.visitsPerYear}</Num> {bi('سنويًا', 'per year')}</>} />
        <Info label={bi('قطع الغيار', 'Spare parts')} value={a.coverage.partsIncluded ? bi('مشمولة', 'Included') : bi('غير مشمولة', 'Not included')} />
        <Info label={bi('الأجهزة المشمولة', 'Covered devices')} value={a.coverage.deviceCount ? <Num>{a.coverage.deviceCount}</Num> : bi('كل أجهزة المواقع', 'All devices at the sites')} />
        <Info label={bi('المواقع', 'Sites')} value={a.coverage.sites.length ? a.coverage.sites.map((s) => s.name).join('، ') : '—'} />
        <Info label={bi('قيمة العقد', 'Agreement value')} value={<><Money value={a.price} fixed />{freq && <span className="block text-xs font-normal text-muted">{bi('الفوترة', 'Billing')}: {bi(freq[0], freq[1])}</span>}</>} />
      </dl>

      <div className="mt-4 border-t border-line pt-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-primary"><CalendarDays className="size-4" aria-hidden />{bi('الزيارات القادمة', 'Upcoming visits')}</h3>
        {a.nextVisits.length === 0 ? <p className="text-sm text-muted">{bi('لا توجد زيارات مجدولة.', 'No visits scheduled.')}</p> : (
          <ul className="divide-y divide-line text-sm">
            {a.nextVisits.map((v, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Num className="font-bold text-ink">{date(v.scheduledStart ?? v.dueDate)}</Num>
                  {!v.scheduledStart && <span className="ms-1 text-xs text-muted">({bi('الموعد التقريبي', 'approximate')})</span>}
                  {v.siteName && <span className="text-xs text-muted"> · {v.siteName}</span>}
                  {v.workOrderNumber && <span className="text-xs text-muted"> · <Num>{v.workOrderNumber}</Num></span>}
                </span>
                <PortalStatus status={v.workOrderStatus ?? v.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl bg-tint/50 px-3 py-2 text-sm">
        <RefreshCw className="mt-0.5 size-4 shrink-0 text-gold-dark" aria-hidden />
        {a.renewal ? (
          <span>
            {a.renewal.status === 'active' ? bi('تم تجديد العقد', 'The agreement has been renewed') : bi('التجديد قيد الإعداد', 'Renewal is being prepared')}:{' '}
            <Num className="font-bold">{a.renewal.number}</Num> (<Num>{date(a.renewal.startDate)}</Num> – <Num>{date(a.renewal.endDate)}</Num>)
          </span>
        ) : a.status === 'renewed' ? <span>{bi('تم تجديد هذا العقد.', 'This agreement has been renewed.')}</span>
          : a.status === 'expired' ? <span>{bi('انتهى العقد — تواصل معنا لتجديده واستمرار التغطية.', 'The agreement has ended — contact us to renew and keep your coverage.')}</span>
          : soon ? <span className="font-bold text-amber-900">{bi('العقد يقترب من نهايته — تواصل معنا لتجديده.', 'The agreement ends soon — contact us to renew it.')}</span>
          : <span className="text-muted">{bi('سنتواصل معك قبل انتهاء العقد بخصوص التجديد.', 'We will contact you about renewal before the agreement ends.')}</span>}
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted"><ShieldCheck className="size-3" aria-hidden />{bi('الأجهزة التي ما زالت في الضمان تُخدم بالضمان أولًا.', 'Devices still under warranty are serviced under warranty first.')}</p>
    </PublicCard>
  );
}
