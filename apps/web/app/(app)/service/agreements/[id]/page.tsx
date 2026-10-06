'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, ExternalLink, Pencil, RefreshCw, Settings2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Checkbox, clsx, Dialog, ErrorBox, Field, Input, LinkButton, Money, PageHeader, Spinner, Stat, Table, Td, Textarea, Th } from '@/components/ui';
import { ConfirmDialog, ReasonDialog, errMsg } from '../../../quotes/_components/common';
import { Chip, DeviceRef, Info, Ltr, PriorityBadge, TicketStatusBadge, WoStatusBadge, useLabel } from '../../../field/_components/common';
import { AgreementStatusBadge, BILLING_LABEL, COVERAGE_WINDOW, PR_STATUS, Period, SlaBadges, Stars, TierBadge, VISIT_STATUS, daysUntil } from '../../_components/common';
import type { AgreementView } from '../../_components/types';

export default function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const key = ['agreement', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<AgreementView>(`/service/agreements/${id}`) });
  const [confirm, setConfirm] = useState<'activate' | 'renew' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [settings, setSettings] = useState(false);

  const refresh = (a: AgreementView) => {
    qc.setQueryData(['agreement', a.id], a);
    qc.invalidateQueries({ queryKey: ['agreements'] });
    qc.invalidateQueries({ queryKey: ['agreements-report'] });
  };
  const activate = useMutation({
    mutationFn: () => api.post<AgreementView & { activation: { visits: number; paymentRequests: string[] } }>(`/service/agreements/${id}/activate`),
    onSuccess: (a) => { refresh(a); setConfirm(null); toast.success(bi(`تم التفعيل: ${a.activation.visits} زيارة و${a.activation.paymentRequests.length} طلب دفع`, `Activated: ${a.activation.visits} visits and ${a.activation.paymentRequests.length} payment requests`)); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post<AgreementView & { cancellation: { visitsSkipped: number; requestsCancelled: string[] } }>(`/service/agreements/${id}/cancel`, { reason }),
    onSuccess: (a) => { refresh(a); setCancelling(false); toast.success(bi(`أُلغي العقد (${a.cancellation.visitsSkipped} زيارة متجاوزة، ${a.cancellation.requestsCancelled.length} طلب دفع ملغى)`, `Agreement cancelled (${a.cancellation.visitsSkipped} visits skipped, ${a.cancellation.requestsCancelled.length} payment requests cancelled)`)); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const renew = useMutation({
    mutationFn: () => api.post<AgreementView>(`/service/agreements/${id}/renew`),
    onSuccess: (a) => { refresh(a); qc.invalidateQueries({ queryKey: key }); setConfirm(null); toast.success(bi(`أُنشئت مسودة التجديد ${a.number}`, `Renewal draft ${a.number} created`)); router.push(`/service/agreements/${a.id}`); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const a = q.data;
  if (q.isLoading) return <Spinner />;
  if (!a) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;

  const canWrite = can('agreement.write');
  const left = a.status === 'active' ? daysUntil(a.endDate) : null;
  const s = a.tickets.stats;
  const pct = (met: number, breached: number) => (met + breached ? `${Math.round((met / (met + breached)) * 100)}%` : '—');
  const copy = (url: string) => { void navigator.clipboard?.writeText(url).then(() => toast.success(bi('تم نسخ الرابط', 'Link copied'))); };

  return (
    <>
      <PageHeader
        back="/service/agreements"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{a.number}</span><AgreementStatusBadge status={a.status} /><TierBadge tier={a.tier} /></span>}
        subtitle={a.party ? <Link href={`/customers/${a.party.id}`} className="font-bold text-primary hover:underline">{a.party.nameAr}</Link> : a.partyName}
        actions={canWrite && <>
          {a.status === 'draft' && <LinkButton href={`/service/agreements/new?edit=${a.id}`} icon={<Pencil className="size-4" />}>{bi('تعديل', 'Edit')}</LinkButton>}
          {a.status === 'draft' && <Button icon={<CheckCircle2 className="size-4" />} onClick={() => setConfirm('activate')}>{bi('تفعيل العقد', 'Activate')}</Button>}
          {a.status === 'active' && <Button variant="outline" icon={<Settings2 className="size-4" />} onClick={() => setSettings(true)}>{bi('إعدادات التجديد', 'Renewal settings')}</Button>}
          {['active', 'expired'].includes(a.status) && !a.renewal && <Button variant="gold" icon={<RefreshCw className="size-4" />} onClick={() => setConfirm('renew')}>{bi('تجديد', 'Renew')}</Button>}
          {['draft', 'active'].includes(a.status) && <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setCancelling(true)}>{bi('إلغاء العقد', 'Cancel')}</Button>}
        </>}
      />

      {a.renewal && a.renewal.id !== a.id && a.status !== 'renewed' && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {bi('يوجد تجديد لهذا العقد:', 'This agreement has a renewal:')} <Link href={`/service/agreements/${a.renewal.id}`} className="font-bold hover:underline"><Ltr>{a.renewal.number}</Ltr></Link> <AgreementStatusBadge status={a.renewal.status} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={bi('قيمة العقد', 'Agreement price')} value={<Money value={a.price} />} hint={<>{label(BILLING_LABEL, a.billingFrequency)} · {a.billing.vatApplies ? bi('+ ضريبة 15%', '+ 15% VAT') : bi('بدون ضريبة', 'No VAT')}</>} />
        <Stat label={bi('المدة', 'Term')} value={<Period from={a.startDate} to={a.endDate} className="text-base" />} hint={left !== null ? (left < 0 ? bi('انتهت المدة', 'Term ended') : bi(`باقي ${left} يومًا`, `${left} days left`)) : undefined} tone={left !== null && left <= 30 ? 'gold' : undefined} />
        <Stat label={bi('الزيارة القادمة', 'Next visit')} value={<span className="num text-base">{a.nextVisit ?? '—'}</span>} hint={bi(`${a.visitsPerYear} زيارات في السنة`, `${a.visitsPerYear} visits a year`)} />
        <Stat label={bi('المستحق غير المدفوع', 'Open balance')} value={<Money value={a.openBalance} />} tone={Number(a.openBalance) > 0 ? 'red' : 'green'} hint={a.status !== 'draft' ? <>{bi('مدفوع', 'Paid')} <Money value={a.billing.paid} /> / <Money value={a.billing.total} /></> : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card padded={false} title={<>{bi('الزيارات الوقائية', 'Preventive visits')} <span className="num ms-1 text-xs text-muted">{a.visits.length}</span></>}>
            {a.visits.length === 0 ? (
              <p className="p-4 text-sm text-muted">{a.status === 'draft' ? bi('تُنشأ الزيارات عند تفعيل العقد.', 'Visits are created when the agreement is activated.') : bi('لا توجد زيارات', 'No visits')}</p>
            ) : (
              <Table>
                <thead><tr><Th>{bi('الاستحقاق', 'Due')}</Th><Th>{bi('الموقع', 'Site')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('أمر العمل', 'Work order')}</Th><Th>{bi('الفني', 'Technician')}</Th><Th>{bi('التقييم', 'CSAT')}</Th></tr></thead>
                <tbody>
                  {a.visits.map((v) => (
                    <tr key={v.id} className="hover:bg-tint/40">
                      <Td className="num whitespace-nowrap text-xs">{v.dueDate}</Td>
                      <Td className="text-xs">{v.siteName ?? '—'}</Td>
                      <Td><Chip map={VISIT_STATUS} value={v.status} /></Td>
                      <Td>{v.workOrder ? <span className="inline-flex flex-wrap items-center gap-1.5"><Link href={`/field/work-orders/${v.workOrder.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{v.workOrder.number}</Link><WoStatusBadge status={v.workOrder.status} /></span> : <span className="text-muted">—</span>}</Td>
                      <Td className="text-xs">{v.workOrder?.technicianName ?? '—'}</Td>
                      <Td><Stars score={v.workOrder?.csatScore} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card padded={false} title={bi('الفوترة', 'Billing')}>
            {a.status === 'draft' ? (
              a.billing.schedule.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد دفعات (قيمة العقد صفر).', 'No billing periods (the price is zero).')}</p> : (
                <>
                  <p className="px-4 pt-3 text-xs text-muted">{bi('معاينة — تُنشأ طلبات الدفع عند التفعيل.', 'Preview — payment requests are created on activation.')}</p>
                  <ScheduleTable schedule={a.billing.schedule} />
                </>
              )
            ) : a.billing.requests.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد طلبات دفع', 'No payment requests')}</p> : (
              <Table>
                <thead><tr><Th>{bi('الطلب', 'Request')}</Th><Th>{bi('الفترة', 'Period')}</Th><Th>{bi('الاستحقاق', 'Due')}</Th><Th className="text-end">{bi('المبلغ', 'Amount')}</Th><Th className="text-end">{bi('المدفوع', 'Paid')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('الفواتير', 'Invoices')}</Th><Th /></tr></thead>
                <tbody>
                  {a.billing.requests.map((r) => (
                    <tr key={r.id} className="hover:bg-tint/40">
                      <Td><Ltr className="font-bold">{r.number}</Ltr></Td>
                      <Td className="text-xs"><Period from={r.periodFrom} to={r.periodTo} /></Td>
                      <Td className="num whitespace-nowrap text-xs">{r.dueDate ?? '—'}</Td>
                      <Td className="text-end"><Money value={r.amount} fixed /></Td>
                      <Td className="text-end"><Money value={r.paidAmount} fixed /></Td>
                      <Td><Chip map={PR_STATUS} value={r.status} /></Td>
                      <Td className="text-xs">{r.invoices.length === 0 ? <span className="text-muted">—</span> : r.invoices.map((i) => <div key={i.id} className="whitespace-nowrap"><Ltr className="font-bold">{i.number}</Ltr> <span className="text-muted">({i.typeCode})</span> <Money value={i.total} /></div>)}</Td>
                      <Td>
                        {r.payUrl && !['paid', 'cancelled'].includes(r.status) && (
                          <span className="inline-flex gap-1">
                            <a href={r.payUrl} target="_blank" rel="noreferrer" className="rounded p-1 text-primary hover:bg-tint" title={bi('فتح رابط الدفع', 'Open pay link')} aria-label={bi('فتح رابط الدفع', 'Open pay link')}><ExternalLink className="size-4" /></a>
                            <button type="button" onClick={() => copy(r.payUrl!)} className="rounded p-1 text-primary hover:bg-tint" title={bi('نسخ رابط الدفع', 'Copy pay link')} aria-label={bi('نسخ رابط الدفع', 'Copy pay link')}><Copy className="size-4" /></button>
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {a.status !== 'draft' && a.billing.requests.some((r) => r.status === 'draft') && (
              <p className="border-t border-line px-4 py-2 text-xs text-muted">{bi('تُرسل طلبات الدفع للعميل تلقائيًا عند حلول كل فترة، ويمكن إرسالها من صفحة طلبات الدفع.', 'Payment requests are sent to the customer as each period starts; they can also be sent from the payment requests page.')} <Link href="/finance/requests" className="font-bold text-gold-dark hover:underline">{bi('طلبات الدفع', 'Payment requests')}</Link></p>
            )}
          </Card>

          {can('ticket.read') && (
            <Card padded={false} title={<>{bi('البلاغات تحت العقد', 'Service calls under this agreement')} <span className="num ms-1 text-xs text-muted">{s.count}</span></>}>
              <div className="grid grid-cols-2 gap-2 border-b border-line p-3 text-xs sm:grid-cols-4">
                <div><div className="text-muted">{bi('مفتوحة', 'Open')}</div><div className="num text-lg font-extrabold text-primary">{s.open}</div></div>
                <div><div className="text-muted">{bi('الالتزام بالاستجابة', 'Response met')}</div><div className="num text-lg font-extrabold text-primary">{pct(s.responseMet, s.responseBreached)}</div><div className="text-muted">{bi(`${s.responseBreached} متجاوز`, `${s.responseBreached} breached`)}</div></div>
                <div><div className="text-muted">{bi('الالتزام بالحل', 'Resolution met')}</div><div className="num text-lg font-extrabold text-primary">{pct(s.resolutionMet, s.resolutionBreached)}</div><div className="text-muted">{bi(`${s.resolutionBreached} متجاوز`, `${s.resolutionBreached} breached`)}</div></div>
                <div><div className="text-muted">{bi('مستوى الخدمة', 'SLA')}</div><div className="text-sm font-bold">{bi(`${a.responseHours} س / ${a.resolutionHours} س`, `${a.responseHours} h / ${a.resolutionHours} h`)}</div><div className="text-muted">{label(COVERAGE_WINDOW, a.coverage)}</div></div>
              </div>
              {a.tickets.rows.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد بلاغات', 'No service calls')}</p> : (
                <Table>
                  <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('الموضوع', 'Subject')}</Th><Th>{bi('الأولوية', 'Priority')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('مستوى الخدمة', 'SLA')}</Th><Th>{bi('التاريخ', 'Date')}</Th></tr></thead>
                  <tbody>
                    {a.tickets.rows.map((t) => (
                      <tr key={t.id} className="cursor-pointer hover:bg-tint/40" onClick={() => router.push(`/field/tickets/${t.id}`)}>
                        <Td><Link href={`/field/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{t.number}</Link></Td>
                        <Td className="text-sm">{t.subject}</Td>
                        <Td><PriorityBadge priority={t.priority} /></Td>
                        <Td><TicketStatusBadge status={t.status} /></Td>
                        <Td><SlaBadges sla={t.sla} compact /></Td>
                        <Td className="num whitespace-nowrap text-xs">{dateTime(t.createdAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title={bi('مستوى الخدمة والشروط', 'Service level & terms')}>
            <Info label={bi('الباقة', 'Tier')}><TierBadge tier={a.tier} /></Info>
            <Info label={bi('زمن الاستجابة', 'Response time')}>{bi(`${a.responseHours} ساعة`, `${a.responseHours} h`)}</Info>
            <Info label={bi('زمن الحل', 'Resolution time')}>{bi(`${a.resolutionHours} ساعة`, `${a.resolutionHours} h`)}</Info>
            <Info label={bi('نافذة التغطية', 'Coverage window')}>{label(COVERAGE_WINDOW, a.coverage)}</Info>
            <Info label={bi('زيارات/سنة', 'Visits / year')}><span className="num">{a.visitsPerYear}</span></Info>
            <Info label={bi('قطع الغيار', 'Parts')}>{a.partsIncluded ? <Badge tone="green">{bi('مشمولة', 'Included')}</Badge> : <span className="text-muted">{bi('عمالة فقط', 'Labour only')}</span>}</Info>
            <Info label={bi('القيمة السنوية', 'Annual value')}><Money value={a.annualValue} /></Info>
            <Info label={bi('تجديد تلقائي', 'Auto-renew')}>{a.autoRenew ? bi('نعم', 'Yes') : bi('لا', 'No')}</Info>
            <Info label={bi('زيادة التجديد', 'Renewal uplift')}><span className="num">{a.upliftPercent}%</span></Info>
            {a.cancelledAt && <Info label={bi('تاريخ الإلغاء', 'Cancelled on')}><span className="num">{a.cancelledAt}</span></Info>}
            {a.notes && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-tint/60 px-2 py-1.5 text-xs">{a.notes}</p>}
          </Card>

          <Card title={bi('التغطية', 'Coverage')}>
            <div className="mb-2 text-xs font-bold text-muted">{bi('المواقع', 'Sites')}</div>
            {a.sites.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <ul className="mb-3 space-y-1 text-sm">{a.sites.map((x) => <li key={x.id} className="font-bold">{x.name}{x.city && <span className="font-normal text-muted"> — {x.city}</span>}</li>)}</ul>
            )}
            <div className="mb-2 flex items-center justify-between text-xs font-bold text-muted">
              <span>{bi('الأجهزة', 'Devices')} <span className="num">({a.assets.length})</span></span>
              <span className="font-normal">{a.assetIds.length ? bi('قائمة محددة', 'Specific list') : bi('كل الأجهزة الفعالة', 'All active devices')}</span>
            </div>
            {a.assets.length === 0 ? <p className="text-sm text-muted">{bi('لا توجد أجهزة مسجلة بعد', 'No devices registered yet')}</p> : (
              <ul className="max-h-72 divide-y divide-line/60 overflow-y-auto text-xs">
                {a.assets.map((x) => (
                  <li key={x.id} className="py-1.5">
                    <Link href={`/field/assets/${x.id}`} className="text-primary hover:underline"><DeviceRef code={x.code} serial={x.serial} className="font-bold" /></Link>
                    {x.status !== 'active' && <Badge tone="gray">{x.status}</Badge>}
                    {(x.description || x.locationPath) && <div className="text-muted">{x.description}{x.locationPath && <> · <Ltr>{x.locationPath}</Ltr></>}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {a.renewalChain.length > 1 && (
            <Card title={bi('سلسلة التجديد', 'Renewal chain')}>
              <ol className="space-y-1.5 text-sm">
                {a.renewalChain.map((c) => (
                  <li key={c.id} className={clsx('flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1', c.id === a.id && 'bg-tint')}>
                    <span className="flex items-center gap-1.5">
                      {c.id === a.id ? <Ltr className="font-bold">{c.number}</Ltr> : <Link href={`/service/agreements/${c.id}`} className="font-bold text-primary hover:underline"><Ltr>{c.number}</Ltr></Link>}
                      <AgreementStatusBadge status={c.status} />
                    </span>
                    <span className="text-xs text-muted"><Period from={c.startDate} to={c.endDate} /> · <Money value={c.price} /></span>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card title={bi('السجل', 'Record')}>
            <Info label={bi('أُنشئ', 'Created')}><span className="num">{dateTime(a.createdAt)}</span></Info>
            {a.renewalNotifiedAt && <Info label={bi('تذكير التجديد', 'Renewal reminder')}><span className="num">{dateTime(a.renewalNotifiedAt)}</span></Info>}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'activate'}
        title={bi('تفعيل عقد الصيانة', 'Activate service agreement')}
        confirmLabel={bi('تفعيل', 'Activate')}
        loading={activate.isPending}
        onConfirm={() => activate.mutate()}
        onClose={() => setConfirm(null)}
        message={
          <div className="space-y-3">
            <p>{bi(`سيصبح العقد ساريًا من ${a.startDate} إلى ${a.endDate}، وتُنشأ الزيارات الوقائية (${a.visitsPerYear} في السنة لكل موقع × ${a.sites.length} موقع) وطلبات الدفع التالية. لا يمكن تعديل بنود العقد بعد التفعيل.`, `The agreement becomes active from ${a.startDate} to ${a.endDate}; preventive visits (${a.visitsPerYear} a year per site × ${a.sites.length} sites) and the payment requests below are created. Terms cannot be edited after activation.`)}</p>
            {a.billing.schedule.length > 0 ? <div className="rounded-lg border border-line"><ScheduleTable schedule={a.billing.schedule} /></div> : <p className="text-muted">{bi('لا توجد دفعات (قيمة العقد صفر).', 'No billing periods (the price is zero).')}</p>}
          </div>
        }
      />
      <ConfirmDialog
        open={confirm === 'renew'}
        title={bi('تجديد العقد', 'Renew agreement')}
        confirmLabel={bi('إنشاء مسودة التجديد', 'Create renewal draft')}
        loading={renew.isPending}
        onConfirm={() => renew.mutate()}
        onClose={() => setConfirm(null)}
        message={bi(`تُنشأ مسودة عقد جديد للمدة التالية بنفس البنود${a.upliftPercent ? ` وبزيادة ${a.upliftPercent}% في السعر` : ''}. فعّلها لتحل محل هذا العقد.`, `A new draft for the next term is created with the same terms${a.upliftPercent ? ` and a ${a.upliftPercent}% price uplift` : ''}. Activate it to take over from this one.`)}
      />
      <ReasonDialog
        open={cancelling}
        required
        danger
        title={bi('إلغاء العقد', 'Cancel agreement')}
        hint={a.status === 'active' ? bi('تُتجاوز الزيارات المخططة، وتُلغى طلبات الدفع غير المدفوعة للفترات التي لم تبدأ بعد.', 'Planned visits are skipped and unpaid payment requests for periods not started yet are cancelled.') : undefined}
        loading={cancel.isPending}
        onConfirm={(r) => cancel.mutate(r)}
        onClose={() => setCancelling(false)}
      />
      {settings && <RenewalSettingsDialog a={a} onClose={() => setSettings(false)} onSaved={(x) => { refresh(x); setSettings(false); toast.success(bi('تم الحفظ', 'Saved')); }} />}
    </>
  );
}

function ScheduleTable({ schedule }: { schedule: AgreementView['billing']['schedule'] }) {
  const { bi } = useI18n();
  return (
    <Table>
      <thead><tr><Th>{bi('الفترة', 'Period')}</Th><Th className="text-end">{bi('الصافي', 'Net')}</Th><Th className="text-end">{bi('الضريبة', 'VAT')}</Th><Th className="text-end">{bi('الإجمالي', 'Total')}</Th></tr></thead>
      <tbody>
        {schedule.map((p) => (
          <tr key={p.from}>
            <Td className="text-xs"><Period from={p.from} to={p.to} /></Td>
            <Td className="text-end"><Money value={p.net} fixed /></Td>
            <Td className="text-end"><Money value={p.vat} fixed /></Td>
            <Td className="text-end font-bold"><Money value={p.gross} fixed /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function RenewalSettingsDialog({ a, onClose, onSaved }: { a: AgreementView; onClose: () => void; onSaved: (a: AgreementView) => void }) {
  const { bi } = useI18n();
  const [autoRenew, setAutoRenew] = useState(a.autoRenew);
  const [uplift, setUplift] = useState(String(a.upliftPercent));
  const [notes, setNotes] = useState(a.notes ?? '');
  const n = Number(uplift);
  const save = useMutation({
    mutationFn: () => api.put<AgreementView>(`/service/agreements/${a.id}`, { autoRenew, upliftPercent: n, notes: notes.trim() || null, version: a.version }),
    onSuccess: onSaved,
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onClose={onClose} title={bi('إعدادات التجديد', 'Renewal settings')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!(Number.isInteger(n) && n >= 0 && n <= 100)} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3">
        <Checkbox label={bi('تجديد تلقائي (تُنشأ مسودة التجديد قبل انتهاء المدة)', 'Auto-renew (a renewal draft is created before the term ends)')} checked={autoRenew} onChange={setAutoRenew} />
        <Field label={bi('زيادة السعر عند التجديد %', 'Renewal uplift %')}><Input type="number" min={0} max={100} dir="ltr" className="text-start" value={uplift} onChange={(e) => setUplift(e.target.value)} /></Field>
        <Field label={bi('ملاحظات', 'Notes')}><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <ErrorBox error={save.error} />
    </Dialog>
  );
}
