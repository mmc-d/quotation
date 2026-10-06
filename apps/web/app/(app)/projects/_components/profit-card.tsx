'use client';
import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { h } from '@/lib/format';
import { Card, ErrorBox, Money, Spinner, clsx } from '@/components/ui';
import { FlagBadges, MarginBadge, SourceNote, type ProjectInsight } from '../../reports/_components/insights';

/** Project profitability (estimate at completion) — shown only with purchase.cost.read. */
export function ProfitCard({ projectId }: { projectId: string }) {
  const { can } = useMe();
  const { bi } = useI18n();
  const allowed = can('purchase.cost.read');
  const q = useQuery({ queryKey: ['insights-project', projectId], queryFn: () => api.get<ProjectInsight>(`/insights/projects/${projectId}`), enabled: allowed });
  if (!allowed) return null;
  const d = q.data;
  const value = h(d?.contractValue);
  const parts = d ? [
    { key: 'material', label: bi('المواد المصروفة', 'Materials issued'), v: d.materialCost, cls: 'bg-primary' },
    { key: 'committed', label: bi('مشتريات ملتزم بها', 'Committed purchases'), v: d.committedCost, cls: 'bg-gold' },
    { key: 'labour', label: bi(`العمالة (${d.labourHours} س × ${d.assumptions.labourRateSar})`, `Labour (${d.labourHours} h × ${d.assumptions.labourRateSar})`), v: d.labourCost, cls: 'bg-gold-dark' },
  ] : [];
  const scale = Math.max(value, h(d?.costAtCompletion), 1);

  return (
    <Card className="mb-5" title={<span className="inline-flex items-center gap-2"><TrendingUp className="size-4" />{bi('ربحية المشروع', 'Profitability')}</span>}
      actions={d && <><FlagBadges flags={d.flags} /><MarginBadge pct={d.marginPct} low={d.assumptions.lowMarginPercent} /></>}>
      <ErrorBox error={q.error} />
      {q.isLoading || !d ? (q.error ? null : <Spinner />) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted">{bi('قيمة العقد (بدون ضريبة)', 'Contract value (excl. VAT)')}</dt><dd className="text-end font-bold"><Money value={d.contractValue} /></dd>
              <dt className="text-muted">{bi('المفوتر', 'Invoiced')}</dt><dd className="text-end"><Money value={d.invoiced} /></dd>
              <dt className="text-muted">{bi('المحصَّل (شامل الضريبة)', 'Collected (incl. VAT)')}</dt><dd className="text-end"><Money value={d.collected} /></dd>
              {parts.map((p) => <Fragment key={p.key}><dt className="text-muted">{p.label}</dt><dd className="text-end"><Money value={p.v} /></dd></Fragment>)}
              <dt className="font-bold">{bi('التكلفة المتوقعة', 'Cost at completion')}</dt><dd className="text-end font-bold"><Money value={d.costAtCompletion} /></dd>
              <dt className="font-extrabold text-primary">{bi('الهامش المتوقع', 'Expected margin')}</dt><dd className={clsx('text-end font-extrabold', h(d.margin) < 0 ? 'text-danger' : 'text-primary')}><Money value={d.margin} /></dd>
              {d.quoteCost != null && <><dt className="text-muted">{bi('تكلفة العرض المقدّرة', 'Quoted cost')}</dt><dd className="text-end"><Money value={d.quoteCost} /></dd></>}
            </dl>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-muted">{bi('التكلفة مقابل قيمة العقد', 'Cost against contract value')}</div>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-tint" role="img" aria-label={bi('توزيع التكلفة', 'Cost breakdown')}>
              {parts.map((p) => <div key={p.key} className={p.cls} style={{ width: `${(Math.max(0, h(p.v)) / scale) * 100}%` }} title={p.label} />)}
            </div>
            <div className="relative mt-1 h-1">
              {value > 0 && <div className="absolute top-0 h-3 w-0.5 -translate-y-3 bg-danger" style={{ insetInlineStart: `${(value / scale) * 100}%` }} title={bi('قيمة العقد', 'Contract value')} />}
            </div>
            <ul className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
              {parts.map((p) => <li key={p.key} className="inline-flex items-center gap-1"><span className={clsx('inline-block size-2.5 rounded-sm', p.cls)} />{p.label}</li>)}
            </ul>
            {!!d.materials?.length && (
              <div className="mt-4">
                <div className="mb-1 text-xs font-extrabold text-gold-dark">{bi('المواد حسب الصنف', 'Materials by item')}</div>
                <ul className="divide-y divide-line/70 text-xs">
                  {d.materials.map((m) => (
                    <li key={m.productId} className="flex items-center justify-between gap-2 py-1">
                      <span className="truncate"><span className="font-bold" dir="ltr">{m.code}</span> <span className="text-muted">× <span dir="ltr">{m.netQty}</span></span></span>
                      <Money value={m.cost} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <SourceNote className="mt-4" />
          </div>
        </div>
      )}
    </Card>
  );
}
