'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, MessageSquareReply, Phone } from 'lucide-react';
import { DeviceArticles } from '../../../kb/_components/common';
import { TicketConversation, type TicketMessage } from './conversation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Dialog, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { ReasonDialog } from '../../../quotes/_components/common';
import { CHANNEL, CoverageBadge, DeviceRef, Info, Ltr, PriorityBadge, TicketStatusBadge, WO_TYPE, WoStatusBadge, WoTypeBadge, useLabel } from '../../_components/common';
import type { TicketDetail, WorkOrderView } from '../../_components/types';
import { SLA_STATE } from '../../../service/_components/common';

const NEXT: Record<string, { to: string; ar: string; en: string; variant?: 'primary' | 'outline' | 'danger' }[]> = {
  open: [{ to: 'in_progress', ar: 'بدء المعالجة', en: 'Start progress', variant: 'outline' }, { to: 'resolved', ar: 'تم الحل', en: 'Mark resolved' }, { to: 'closed', ar: 'إغلاق', en: 'Close', variant: 'outline' }],
  in_progress: [{ to: 'resolved', ar: 'تم الحل', en: 'Mark resolved' }, { to: 'open', ar: 'إرجاع لمفتوح', en: 'Back to open', variant: 'outline' }, { to: 'closed', ar: 'إغلاق', en: 'Close', variant: 'outline' }],
  resolved: [{ to: 'closed', ar: 'إغلاق', en: 'Close' }, { to: 'open', ar: 'إعادة فتح', en: 'Reopen', variant: 'outline' }],
  closed: [{ to: 'open', ar: 'إعادة فتح', en: 'Reopen', variant: 'outline' }],
};

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bi, locale } = useI18n();
  const label = useLabel();
  const { can } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['field-ticket', id], queryFn: () => api.get<TicketDetail & { messages?: TicketMessage[] }>(`/field/tickets/${id}`) });
  const [pending, setPending] = useState<string | null>(null);
  const [creatingWo, setCreatingWo] = useState(false);
  const canWrite = can('ticket.write');

  const setStatus = useMutation({
    mutationFn: ({ status, note }: { status: string; note?: string }) => api.post<TicketDetail>(`/field/tickets/${id}/status`, { status, note: note || null }),
    onSuccess: (t) => { qc.setQueryData(['field-ticket', id], t); qc.invalidateQueries({ queryKey: ['field-tickets'] }); setPending(null); toast.success(bi('تم تحديث الحالة', 'Status updated')); },
    onError: (e) => toast.error((e as Error).message),
  });

  const t = q.data;
  if (q.isLoading) return <Spinner />;
  if (!t) return <ErrorBox error={q.error ?? new Error(bi('غير موجود', 'Not found'))} />;
  const nextFor = NEXT[t.status] ?? [];
  const pendingDef = nextFor.find((n) => n.to === pending);

  return (
    <>
      <PageHeader
        back="/field/tickets"
        title={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="num">{t.number}</span><TicketStatusBadge status={t.status} /><PriorityBadge priority={t.priority} /></span>}
        subtitle={t.subject}
        actions={<>
          {canWrite && t.status !== 'closed' && <Button variant="outline" icon={<MessageSquareReply className="size-4" />} onClick={() => document.getElementById('ticket-conversation')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{bi('رد على العميل', 'Reply to the customer')}</Button>}
          {canWrite && nextFor.map((n) => <Button key={n.to} variant={n.variant ?? 'primary'} onClick={() => setPending(n.to)}>{locale === 'en' ? n.en : n.ar}</Button>)}
          {canWrite && can('workorder.write') && !['resolved', 'closed'].includes(t.status) && <Button variant="gold" icon={<ClipboardList className="size-4" />} onClick={() => setCreatingWo(true)}>{bi('إنشاء أمر عمل', 'Create work order')}</Button>}
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={bi('البلاغ', 'Service call')}>
            {t.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.description}</p> : <p className="text-sm text-muted">{bi('بدون وصف', 'No description')}</p>}
          </Card>
          <div id="ticket-conversation" className="scroll-mt-4">
            <TicketConversation ticketId={t.id} status={t.status} messages={t.messages ?? []} canWrite={canWrite} onUpdated={(n) => qc.setQueryData(['field-ticket', id], n)} />
          </div>
          <Card padded={false} title={bi('أوامر العمل المرتبطة', 'Linked work orders')}>
            {t.workOrders.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد أوامر عمل بعد', 'No work orders yet')}</p> : (
              <Table>
                <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('العنوان', 'Title')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('الفني', 'Technician')}</Th><Th>{bi('الموعد', 'Scheduled')}</Th></tr></thead>
                <tbody>
                  {t.workOrders.map((w) => (
                    <tr key={w.id} className="hover:bg-tint/50">
                      <Td><Link href={`/field/work-orders/${w.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{w.number}</Link></Td>
                      <Td>{w.title}</Td><Td><WoTypeBadge type={w.type} /></Td><Td><WoStatusBadge status={w.status} /></Td>
                      <Td className="text-xs">{w.technicianName ?? '—'}</Td>
                      <Td className="num whitespace-nowrap text-xs">{dateTime(w.scheduledStart)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={bi('التغطية', 'Coverage')}>
            <CoverageBadge block coverage={t.coverage} reason={t.coverageReason} />
            {t.agreementId && t.agreementNumber && (
              <div className="mt-2 text-sm">
                {bi('عقد الصيانة', 'Service agreement')}: {can('agreement.read') ? <Link href={`/service/agreements/${t.agreementId}`} className="font-bold text-primary hover:underline"><Ltr>{t.agreementNumber}</Ltr></Link> : <Ltr className="font-bold">{t.agreementNumber}</Ltr>}
              </div>
            )}
          </Card>
          {t.sla && (t.sla.response || t.sla.resolution) && (
            <Card title={bi('مستوى الخدمة (SLA)', 'Service level (SLA)')}>
              {([['response', bi('الاستجابة', 'Response'), bi('أول استجابة', 'First response')], ['resolution', bi('الحل', 'Resolution'), bi('تاريخ الحل', 'Resolved')]] as const).map(([k, name, doneLabel]) => {
                const part = t.sla![k];
                if (!part) return null;
                return (
                  <div key={k} className="mb-2 rounded-lg border border-line/70 p-2 last:mb-0">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-sm font-extrabold text-primary">{name}</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${SLA_STATE[part.state]?.[2] ?? ''}`}>{label(SLA_STATE, part.state)}</span>
                    </div>
                    <Info label={bi('الاستحقاق', 'Due')}><span className="num">{dateTime(part.due)}</span></Info>
                    <Info label={doneLabel}>{part.doneAt ? <span className="num">{dateTime(part.doneAt)}</span> : <span className="text-muted">—</span>}</Info>
                  </div>
                );
              })}
            </Card>
          )}
          {t.asset && can('kb.read') && (
            <Card>
              <DeviceArticles assetId={t.asset.id} title={bi('مقالات مقترحة للجهاز', 'Suggested articles')} />
            </Card>
          )}
          <Card title={bi('التفاصيل', 'Details')}>
            <Info label={bi('القناة', 'Channel')}>{label(CHANNEL, t.channel)}</Info>
            <Info label={bi('المتصل', 'Caller')}>{t.contactName ?? '—'}</Info>
            <Info label={bi('الجوال', 'Phone')}>{t.contactPhone ? <a href={`tel:${t.contactPhone}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="size-3" /><Ltr>{t.contactPhone}</Ltr></a> : '—'}</Info>
            <Info label={bi('العميل', 'Customer')}>{t.partyId ? <Link href={`/customers/${t.partyId}`} className="font-bold text-primary hover:underline">{t.partyName}</Link> : '—'}</Info>
            <Info label={bi('الموقع', 'Site')}>{t.siteName ?? '—'}</Info>
            <Info label={bi('المكان', 'Location')}><Ltr>{t.locationPath}</Ltr></Info>
            <Info label={bi('الجهاز', 'Device')}>{t.asset ? <Link href={`/field/assets/${t.asset.id}`} className="text-primary hover:underline"><DeviceRef code={t.asset.code} serial={t.asset.serial} /></Link> : '—'}</Info>
            <Info label={bi('تاريخ البلاغ', 'Logged')}><span className="num">{dateTime(t.createdAt)}</span></Info>
            {t.resolvedAt && <Info label={bi('تاريخ الحل', 'Resolved')}><span className="num">{dateTime(t.resolvedAt)}</span></Info>}
          </Card>
        </div>
      </div>

      <ReasonDialog
        open={!!pending}
        title={pendingDef ? (locale === 'en' ? pendingDef.en : pendingDef.ar) : ''}
        label={bi('ملاحظة', 'Note')}
        loading={setStatus.isPending}
        onConfirm={(note) => pending && setStatus.mutate({ status: pending, note })}
        onClose={() => setPending(null)}
      />
      {creatingWo && <CreateWoDialog ticket={t} onClose={() => setCreatingWo(false)} />}
    </>
  );
}

function CreateWoDialog({ ticket, onClose }: { ticket: TicketDetail; onClose: () => void }) {
  const { bi } = useI18n();
  const label = useLabel();
  const router = useRouter();
  const qc = useQueryClient();
  const [type, setType] = useState(ticket.coverage === 'warranty' ? 'warranty' : 'corrective');
  const [title, setTitle] = useState(ticket.subject);
  const [description, setDescription] = useState(ticket.description ?? '');
  const create = useMutation({
    mutationFn: () => api.post<WorkOrderView>(`/field/tickets/${ticket.id}/work-order`, { type, title: title.trim() || null, description: description.trim() || null }),
    onSuccess: (wo) => {
      toast.success(bi(`تم إنشاء أمر العمل ${wo.number}`, `Work order ${wo.number} created`));
      qc.invalidateQueries({ queryKey: ['field-ticket', ticket.id] });
      qc.invalidateQueries({ queryKey: ['field-tickets'] });
      router.push(`/field/work-orders/${wo.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} title={bi('إنشاء أمر عمل من البلاغ', 'Create work order from the call')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={create.isPending} onClick={() => create.mutate()}>{bi('إنشاء', 'Create')}</Button></>}>
      <p className="mb-3 text-sm text-muted">{bi('ينتقل الموقع والمكان والجهاز والتغطية من البلاغ.', 'Site, location, device and coverage are carried over from the call.')}</p>
      <div className="grid gap-3">
        <Field label={bi('النوع', 'Type')}><Select value={type} onChange={(e) => setType(e.target.value)}>{Object.keys(WO_TYPE).map((k) => <option key={k} value={k}>{label(WO_TYPE, k)}</option>)}</Select></Field>
        <Field label={bi('العنوان', 'Title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={bi('الوصف', 'Description')}><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
