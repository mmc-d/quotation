'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Image as ImageIcon, MessageSquareText, Truck } from 'lucide-react';
import { PublicCard } from '@/app/_public/public-shell';
import { clsx } from '@/components/ui';
import { date, dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { portalFetch, portalRetry, type PortalTicketDetail } from '../../_components/portal-api';
import { CoverageBadge, ErrorBlock, Info, Loading, Num, PageTitle, PortalStatus, SlaChip, sectionTitle } from '../../_components/portal-ui';
import { WorkOrderRow } from '../../_components/work-order-row';
import { PortalConversation } from '../../_components/portal-conversation';

export default function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = use(params);
  const created = use(searchParams).created === '1';
  const { bi, locale } = useI18n();
  const q = useQuery({ queryKey: ['portal', 'ticket', id], queryFn: () => portalFetch<PortalTicketDetail>(`/tickets/${id}`), retry: portalRetry });
  const back = { href: '/portal/requests', label: bi('طلبات الصيانة', 'Service requests') };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <><PageTitle title={bi('طلب الصيانة', 'Service request')} back={back} /><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></>;
  const t = q.data;

  return (
    <div className="space-y-4">
      <PageTitle back={back} title={t.subject} subtitle={<><Num>{t.number}</Num> · <Num>{dateTime(t.createdAt)}</Num></>} actions={<PortalStatus status={t.status} />} />

      {created && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{bi('تم استلام طلبك برقم', 'We received your request, number')} <Num className="font-bold">{t.number}</Num>. {bi('سيتواصل معك فريق الخدمة قريبًا.', 'Our service team will contact you soon.')}</span>
        </div>
      )}

      <PublicCard>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Info label={bi('الموقع', 'Site')} value={t.siteName ?? '—'} />
          <Info label={bi('الجهاز', 'Device')} value={t.asset ? <><Num>{t.asset.code}</Num>{t.asset.serial && <span className="block text-xs font-normal text-muted">SN <Num>{t.asset.serial}</Num></span>}</> : '—'} />
          <Info label={bi('التغطية', 'Coverage')} value={<CoverageBadge coverage={t.coverage} reasonAr={t.coverageReason} />} />
        </dl>
        {t.description && <p className="mt-4 whitespace-pre-line border-t border-line pt-4 text-sm leading-relaxed text-ink">{t.description}</p>}
        {(t.sla.response || t.sla.resolution) && (
          <div className="mt-4 space-y-1.5 border-t border-line pt-4">
            <SlaChip label={bi('موعد الاستجابة', 'Response due')} part={t.sla.response} />
            <SlaChip label={bi('موعد الحل', 'Resolution due')} part={t.sla.resolution} />
          </div>
        )}
      </PublicCard>

      {t.photos.length > 0 && (
        <PublicCard>
          <h2 className={sectionTitle}><ImageIcon className="size-4" aria-hidden />{bi('الصور المرفقة', 'Attached photos')}</h2>
          <div className="flex flex-wrap gap-2">
            {t.photos.map((p, i) => (
              <a key={p.id} href={p.url} target="_blank" rel="noopener" className="block size-24 overflow-hidden rounded-xl border border-line" aria-label={bi(`فتح الصورة ${i + 1}`, `Open photo ${i + 1}`)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.filename} className="size-full object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        </PublicCard>
      )}

      {t.messages && <PortalConversation ticketId={t.id} messages={t.messages} canMessage={t.canMessage ?? t.status !== 'closed'} status={t.status} />}

      <PublicCard>
        <h2 className={sectionTitle}><Truck className="size-4" aria-hidden />{bi('زيارات الفني', 'Technician visits')}</h2>
        {t.workOrders.length === 0
          ? <p className="text-sm text-muted">{bi('لم تُجدول زيارة بعد — سنبلغك فور تحديد الموعد.', 'No visit scheduled yet — we will let you know once it is booked.')}</p>
          : <ul className="divide-y divide-line">{t.workOrders.map((w) => <WorkOrderRow key={w.id} w={w} />)}</ul>}
      </PublicCard>

      <PublicCard>
        <h2 className={sectionTitle}><Clock className="size-4" aria-hidden />{bi('سجل الطلب', 'Request timeline')}</h2>
        <ol className="relative space-y-4 border-s-2 border-line ps-5">
          {t.timeline.filter((e) => !(t.messages && e.kind === 'reply')).map((e, i) => (
            <li key={i} className="relative">
              <span className={clsx('absolute -start-[27px] top-0.5 grid size-4 place-items-center rounded-full ring-4 ring-white', e.kind === 'reply' ? 'bg-gold' : e.kind === 'opened' ? 'bg-primary' : 'bg-primary/60')} aria-hidden />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold text-ink">{e.kind === 'reply' && <MessageSquareText className="me-1 inline size-3.5 text-gold-dark" aria-hidden />}{locale === 'en' ? e.en : e.ar}</span>
                {e.kind === 'status' && e.status && <PortalStatus status={e.status} />}
              </div>
              <Num className="text-xs text-muted">{dateTime(e.at)}</Num>
              {e.note && <p className="mt-1 whitespace-pre-line rounded-lg bg-tint/50 px-3 py-2 text-sm text-ink">{e.note}</p>}
            </li>
          ))}
          {t.resolvedAt && !t.timeline.some((e) => e.status === 'resolved') && (
            <li className="relative"><span className="absolute -start-[27px] top-0.5 size-4 rounded-full bg-emerald-600 ring-4 ring-white" aria-hidden /><span className="text-sm font-bold text-ink">{bi('تم الحل', 'Resolved')}</span> <Num className="text-xs text-muted">{date(t.resolvedAt)}</Num></li>
          )}
        </ol>
      </PublicCard>
    </div>
  );
}
