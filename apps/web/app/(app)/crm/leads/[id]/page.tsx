'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Building2, MessageCircle, Pencil, Target } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, dateTime } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Dialog, ErrorBox, Field, Input, LinkButton, PageHeader, Select, Spinner, StatusBadge } from '@/components/ui';
import { Timeline, type Activity } from '@/components/timeline';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { useI18n } from '@/lib/i18n';
import { labelL, INTEREST_LABELS, INTEREST_LABELS_EN, PROJECT_LABELS, PROJECT_LABELS_EN, SOURCE_LABELS, SOURCE_LABELS_EN, waLink, type Lead } from '../../_components/labels';
import { LeadFields, leadPayload, leadToForm, ScoreBar, type LeadFormValues } from '../../_components/lead-form';
import { useUserName } from '../../_components/use-users';

interface Conv { id: string; channel: string; externalAddress: string; status: string; lastMessageAt: string | null; unreadCount: number }
interface LeadView extends Lead { activities: Activity[]; conversations: Conv[] }

function EditLeadDialog({ lead, open, onClose }: { lead: LeadView; open: boolean; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [v, setV] = useState<LeadFormValues>(() => leadToForm(lead));
  const [status, setStatus] = useState(lead.status === 'converted' ? 'qualified' : lead.status);
  const [reason, setReason] = useState(lead.unqualifiedReason ?? '');
  const save = useMutation({
    mutationFn: () => api.put(`/crm/leads/${lead.id}`, { ...leadPayload(v), status, unqualifiedReason: status === 'unqualified' ? reason.trim() || null : null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lead', lead.id] }); qc.invalidateQueries({ queryKey: ['leads'] }); toast.success(bi('تم الحفظ', 'Saved')); onClose(); },
  });
  return (
    <Dialog open={open} onClose={onClose} title={bi('تعديل العميل المحتمل', 'Edit lead')} wide footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!v.name.trim() || (status === 'unqualified' && !reason.trim())} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <LeadFields value={v} onChange={setV} />
      <div className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
        <Field label={bi('الحالة', 'Status')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="new">{bi('جديد', 'New')}</option>
            <option value="contacted">{bi('تم التواصل', 'Contacted')}</option>
            <option value="qualified">{bi('مؤهل', 'Qualified')}</option>
            <option value="unqualified">{bi('غير مؤهل', 'Unqualified')}</option>
          </Select>
        </Field>
        {status === 'unqualified' && <Field label={bi('سبب عدم التأهيل *', 'Unqualified reason *')}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={bi('مثال: خارج النطاق، لا ميزانية…', 'e.g. out of scope, no budget…')} /></Field>}
      </div>
      <div className="mt-3"><ErrorBox error={save.error} /></div>
    </Dialog>
  );
}

function ConvertDialog({ lead, open, onClose }: { lead: LeadView; open: boolean; onClose: () => void }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [party, setParty] = useState<PickedParty | null>(null);
  const [createOpp, setCreateOpp] = useState(true);
  const [title, setTitle] = useState(() => {
    const interest = labelL(locale, INTEREST_LABELS, INTEREST_LABELS_EN, lead.interest);
    return `${lead.companyName || lead.name} — ${interest === '—' ? bi('مشروع', 'Project') : interest}`;
  });
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<{ partyId: string; opportunityId: string | null } | null>(null);
  const conv = useMutation({
    mutationFn: () => api.post<{ partyId: string; contactId: string; opportunityId: string | null }>(`/crm/leads/${lead.id}/convert`, {
      partyId: mode === 'existing' ? party?.id ?? null : null,
      createOpportunity: createOpp,
      opportunityTitle: createOpp ? title.trim() || null : null,
      amount: createOpp && amount.trim() ? amount.trim() : '0',
    }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['lead', lead.id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      toast.success(bi('تم تحويل العميل المحتمل', 'Lead converted'));
    },
  });
  const amountOk = !amount.trim() || /^\d+(\.\d{1,2})?$/.test(amount.trim());
  if (result) {
    return (
      <Dialog open={open} onClose={onClose} title={bi('تم التحويل', 'Converted')} footer={<Button variant="outline" onClick={onClose}>{bi('إغلاق', 'Close')}</Button>}>
        <p className="mb-3 text-sm">{bi(`تم إنشاء/ربط العميل وجهة الاتصال${result.opportunityId ? ' وفتح فرصة بيع في خط المبيعات' : ''}.`, `The customer and contact were created/linked${result.opportunityId ? ' and an opportunity was opened in the pipeline' : ''}.`)}</p>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/customers/${result.partyId}`} variant="primary" icon={<Building2 className="size-4" />}>{bi('فتح العميل', 'Open customer')}</LinkButton>
          {result.opportunityId && <LinkButton href={`/crm/opportunities/${result.opportunityId}`} icon={<Target className="size-4" />}>{bi('فتح الفرصة', 'Open opportunity')}</LinkButton>}
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={bi('تحويل إلى عميل', 'Convert to customer')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={conv.isPending} disabled={(mode === 'existing' && !party) || !amountOk} onClick={() => conv.mutate()}>{bi('تحويل', 'Convert')}</Button></>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2"><input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} /> {bi('إنشاء عميل جديد', 'Create a new customer')} ({lead.companyName || lead.name})</label>
          <label className="inline-flex items-center gap-2"><input type="radio" name="mode" checked={mode === 'existing'} onChange={() => setMode('existing')} /> {bi('ربط بعميل موجود', 'Link to an existing customer')}</label>
        </div>
        {mode === 'existing' && <Field label={bi('العميل', 'Customer')}><PartyPicker value={party} onChange={setParty} /></Field>}
        <Checkbox label={bi('فتح فرصة بيع في خط المبيعات', 'Open an opportunity in the pipeline')} checked={createOpp} onChange={setCreateOpp} />
        {createOpp && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={bi('عنوان الفرصة', 'Opportunity title')} className="md:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label={bi('القيمة التقديرية (ر.س)', 'Estimated value (SAR)')} error={amountOk ? null : bi('قيمة غير صحيحة', 'Invalid amount')}><Input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></Field>
          </div>
        )}
        <ErrorBox error={conv.error} />
      </div>
    </Dialog>
  );
}

function Info({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold text-gold-dark">{k}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export default function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const userName = useUserName();
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const q = useQuery({ queryKey: ['lead', id], queryFn: () => api.get<LeadView>(`/crm/leads/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const l = q.data;
  const converted = l.status === 'converted';
  const canWrite = can('lead.write');
  const wa = waLink(l.mobile);
  return (
    <>
      <PageHeader
        back="/crm/leads"
        title={<span className="flex flex-wrap items-center gap-2">{l.name} <StatusBadge status={l.status} /></span>}
        subtitle={<span className="num">{l.number ?? ''}{l.companyName ? ` · ${l.companyName}` : ''}</span>}
        actions={
          <>
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-bold text-emerald-700 hover:bg-tint"><MessageCircle className="size-4" />{bi('واتساب', 'WhatsApp')}</a>}
            {canWrite && !converted && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>{bi('تعديل', 'Edit')}</Button>}
            {canWrite && can('opportunity.write') && !converted && <Button variant="gold" icon={<ArrowLeftRight className="size-4" />} onClick={() => setConverting(true)}>{bi('تحويل إلى عميل', 'Convert to customer')}</Button>}
          </>
        }
      />
      {converted && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary-50 px-3 py-2 text-sm">
          <span>{bi(`تم التحويل ${l.convertedAt ? `في ${date(l.convertedAt)}` : ''}.`, `Converted${l.convertedAt ? ` on ${date(l.convertedAt)}` : ''}.`)}</span>
          {l.convertedPartyId && <Link href={`/customers/${l.convertedPartyId}`} className="font-bold text-primary underline">{bi('العميل', 'Customer')}</Link>}
          {l.convertedOpportunityId && <Link href={`/crm/opportunities/${l.convertedOpportunityId}`} className="font-bold text-primary underline">{bi('الفرصة', 'Opportunity')}</Link>}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card title={bi('البيانات', 'Details')}>
            <dl className="grid grid-cols-2 gap-3">
              <Info k={bi('الجوال', 'Mobile')}>{l.mobile ? <span className="num" dir="ltr">{l.mobile}</span> : '—'}</Info>
              <Info k={bi('البريد', 'E-mail')}>{l.email ? <a href={`mailto:${l.email}`} className="break-all text-primary hover:underline" dir="ltr">{l.email}</a> : '—'}</Info>
              <Info k={bi('المصدر', 'Source')}>{labelL(locale, SOURCE_LABELS, SOURCE_LABELS_EN, l.source)}</Info>
              <Info k={bi('المدينة', 'City')}>{l.city ?? '—'}</Info>
              <Info k={bi('الاهتمام', 'Interest')}>{labelL(locale, INTEREST_LABELS, INTEREST_LABELS_EN, l.interest)}</Info>
              <Info k={bi('نوع المشروع', 'Project type')}>{labelL(locale, PROJECT_LABELS, PROJECT_LABELS_EN, l.projectType)}</Info>
              <Info k={bi('الوحدات التقديرية', 'Estimated units')}><span className="num">{l.estimatedUnits ?? '—'}</span></Info>
              <Info k={bi('التقييم', 'Score')}><ScoreBar score={l.score} /></Info>
              <Info k={bi('المسؤول', 'Owner')}>{userName(l.ownerId) ?? (l.ownerId ? '—' : <Badge tone="gold">{bi('غير مُسند', 'Unassigned')}</Badge>)}</Info>
              <Info k={bi('تاريخ الإنشاء', 'Created')}><span className="num">{dateTime(l.createdAt)}</span></Info>
              {l.status === 'unqualified' && <Info k={bi('سبب عدم التأهيل', 'Unqualified reason')}>{l.unqualifiedReason ?? '—'}</Info>}
            </dl>
            {l.message && <div className="mt-3 whitespace-pre-line rounded-lg bg-tint/50 p-3 text-sm">{l.message}</div>}
          </Card>
          <Card title={bi('محادثات واتساب', 'WhatsApp conversations')}>
            {l.conversations.length === 0 ? <p className="text-sm text-muted">{bi('لا توجد محادثات مرتبطة', 'No linked conversations')}</p> : (
              <ul className="space-y-2">
                {l.conversations.map((c) => (
                  <li key={c.id}>
                    <Link href={`/crm/inbox/${c.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-tint/50">
                      <span className="flex items-center gap-2"><MessageCircle className="size-4 text-emerald-600" /><span className="num" dir="ltr">{c.externalAddress}</span></span>
                      <span className="flex items-center gap-2 text-xs text-muted">
                        {c.unreadCount > 0 && <Badge tone="green">{c.unreadCount}</Badge>}
                        <StatusBadge status={c.status} />
                        <span className="num">{c.lastMessageAt ? dateTime(c.lastMessageAt) : ''}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title={bi('السجل والمهام', 'Activity & tasks')} className="lg:col-span-2">
          <Timeline entityType="lead" entityId={l.id} items={l.activities} invalidate={['lead', id]} canWrite={can('activity.write')} />
        </Card>
      </div>
      {editing && <EditLeadDialog lead={l} open={editing} onClose={() => setEditing(false)} />}
      {converting && <ConvertDialog lead={l} open={converting} onClose={() => setConverting(false)} />}
    </>
  );
}
