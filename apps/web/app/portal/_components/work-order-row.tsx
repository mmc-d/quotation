'use client';
import { FileText, Star } from 'lucide-react';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { localHref, type PortalWorkOrder } from './portal-api';
import { Num, PortalStatus, Stars } from './portal-ui';

export const WO_TYPE: Record<string, [string, string]> = {
  survey: ['معاينة', 'Survey'], installation: ['تركيب', 'Installation'], commissioning: ['تشغيل وتجربة', 'Commissioning'], corrective: ['صيانة إصلاحية', 'Corrective maintenance'],
  preventive: ['صيانة وقائية', 'Preventive maintenance'], warranty: ['خدمة ضمان', 'Warranty service'], inspection: ['فحص', 'Inspection'],
};

/** One work order as the customer sees it: type, status, dates, technician, report and survey links. */
export function WorkOrderRow({ w }: { w: PortalWorkOrder }) {
  const { bi } = useI18n();
  const type = WO_TYPE[w.type];
  const report = localHref(w.reportUrl);
  const csat = localHref(w.csatUrl);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Num className="text-xs font-bold text-muted">{w.number}</Num>{type && <span className="text-xs font-bold text-gold-dark">{bi(type[0], type[1])}</span>}</div>
          {w.title && <p className="mt-0.5 text-sm font-bold text-ink">{w.title}</p>}
          <p className="mt-0.5 text-xs text-muted">
            {w.completedAt ? <>{bi('اكتمل في', 'Completed on')} <Num>{date(w.completedAt)}</Num></> : w.scheduledStart ? <>{bi('الموعد', 'Scheduled')} <Num>{date(w.scheduledStart)}</Num></> : bi('لم يُحدد الموعد بعد', 'Not scheduled yet')}
            {w.technicianName && <> · {bi('الفني', 'Technician')}: <b className="text-ink">{w.technicianName}</b></>}
          </p>
        </div>
        <PortalStatus status={w.status} />
      </div>
      {(report || csat || w.csatScore) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {report && <a href={report} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-bold text-ink hover:bg-tint"><FileText className="size-3.5" aria-hidden />{bi('تقرير الخدمة', 'Service report')}</a>}
          {csat && <a href={csat} className="inline-flex items-center gap-1 rounded-lg bg-gold px-2.5 py-1 text-xs font-bold text-white hover:bg-gold-dark"><Star className="size-3.5" aria-hidden />{bi('قيّم الزيارة', 'Rate this visit')}</a>}
          {w.csatScore ? <span className="inline-flex items-center gap-1 text-xs text-muted">{bi('تقييمك', 'Your rating')} <Stars score={w.csatScore} /></span> : null}
        </div>
      )}
    </li>
  );
}
