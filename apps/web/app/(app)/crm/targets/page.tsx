'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pencil, Plus, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, today } from '@/lib/format';
import { Button, Card, clsx, Dialog, Empty, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { UserSelect } from '@/components/user-select';
import { isMoney } from '../_components/opportunity';
import { useI18n } from '@/lib/i18n';
import { SOURCE_LABELS, SOURCE_LABELS_EN } from '../_components/labels';

interface TargetRow { id: string; userId: string | null; teamId: string | null; periodStart: string; periodEnd: string; amount: string; userName: string | null; achieved: string; percent: number | null }
interface Campaign { id: string; name: string; channel: string | null; startDate: string | null; endDate: string | null; budget: string | null; leads: number; converted: number }
type RawCampaign = Record<string, unknown>;

function normCampaign(r: RawCampaign): Campaign {
  const s = (k1: string, k2: string) => ((r[k1] ?? r[k2]) as string | null | undefined) ?? null;
  return { id: String(r.id), name: String(r.name ?? ''), channel: s('channel', 'channel'), startDate: s('startDate', 'start_date')?.slice(0, 10) ?? null, endDate: s('endDate', 'end_date')?.slice(0, 10) ?? null, budget: s('budget', 'budget'), leads: Number(r.leads ?? 0), converted: Number(r.converted ?? 0) };
}

function monthRange(): [string, string] {
  const t = today();
  const [y, m] = t.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${t.slice(0, 7)}-01`, `${t.slice(0, 7)}-${String(last).padStart(2, '0')}`];
}

function Progress({ percent }: { percent: number | null }) {
  const p = percent ?? 0;
  return (
    <div className="flex min-w-[9rem] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div className={clsx('h-full rounded-full transition-all', p >= 100 ? 'bg-ok' : p >= 60 ? 'bg-gold' : 'bg-primary/60')} style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
      </div>
      <span className={clsx('num w-12 text-end text-xs font-bold', p >= 100 ? 'text-ok' : 'text-ink')}>{percent == null ? '—' : `${p}%`}</span>
    </div>
  );
}

function TargetDialog({ target, onClose }: { target: Partial<TargetRow>; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [def0, def1] = monthRange();
  const [userId, setUserId] = useState<string | null>(target.userId ?? null);
  const [start, setStart] = useState(target.periodStart ?? def0);
  const [end, setEnd] = useState(target.periodEnd ?? def1);
  const [amount, setAmount] = useState(target.amount ? String(Number(target.amount)) : '');
  const save = useMutation({
    mutationFn: () => api.put(`/crm/targets/${target.id ?? 'new'}`, { userId, teamId: target.teamId ?? null, periodStart: start, periodEnd: end, amount: amount.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['targets'] }); toast.success(bi('تم حفظ الهدف', 'Target saved')); onClose(); },
  });
  const valid = isMoney(amount) && !!start && !!end && start <= end;
  return (
    <Dialog open onClose={onClose} title={target.id ? bi('تعديل الهدف', 'Edit target') : bi('هدف مبيعات جديد', 'New sales target')} footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={bi('المندوب', 'Sales rep')} className="md:col-span-2" hint={bi('اتركه فارغًا لهدف الشركة كاملة', 'Leave empty for a company-wide target')}><UserSelect value={userId} onChange={setUserId} emptyLabel={bi('— الشركة كاملة —', '— Whole company —')} /></Field>
        <Field label={bi('من', 'From')}><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={bi('إلى', 'To')} error={start && end && start > end ? bi('يجب أن يكون بعد تاريخ البداية', 'Must be after the start date') : null}><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label={bi('المبلغ المستهدف (ر.س) *', 'Target amount (SAR) *')} className="md:col-span-2" error={amount && !isMoney(amount) ? bi('قيمة غير صحيحة', 'Invalid amount') : null}><Input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={save.error} /></div>
    </Dialog>
  );
}

function CampaignDialog({ campaign, onClose }: { campaign: Partial<Campaign>; onClose: () => void }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(campaign.name ?? '');
  const [channel, setChannel] = useState(campaign.channel ?? '');
  const [start, setStart] = useState(campaign.startDate ?? '');
  const [end, setEnd] = useState(campaign.endDate ?? '');
  const [budget, setBudget] = useState(campaign.budget ? String(Number(campaign.budget)) : '');
  const save = useMutation({
    mutationFn: () => api.put(`/crm/campaigns/${campaign.id ?? 'new'}`, { name: name.trim(), channel: channel || null, startDate: start || null, endDate: end || null, budget: budget.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success(bi('تم حفظ الحملة', 'Campaign saved')); onClose(); },
  });
  const valid = !!name.trim() && (!budget.trim() || isMoney(budget));
  return (
    <Dialog open onClose={onClose} title={campaign.id ? bi('تعديل الحملة', 'Edit campaign') : bi('حملة جديدة', 'New campaign')} footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={bi('اسم الحملة *', 'Campaign name *')} className="md:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={bi('القناة', 'Channel')}>
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">—</option>
            {['snapchat', 'instagram', 'tiktok', 'google', 'whatsapp', 'website', 'exhibition', 'email', 'other'].map((c) => <option key={c} value={c}>{(locale === 'en' ? SOURCE_LABELS_EN : SOURCE_LABELS)[c] ?? c}</option>)}
          </Select>
        </Field>
        <Field label={bi('الميزانية (ر.س)', 'Budget (SAR)')} error={budget && !isMoney(budget) ? bi('قيمة غير صحيحة', 'Invalid amount') : null}><Input dir="ltr" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>
        <Field label={bi('من', 'From')}><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={bi('إلى', 'To')}><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={save.error} /></div>
    </Dialog>
  );
}

export default function TargetsPage() {
  const { me, can } = useMe();
  const { bi, locale, dir } = useI18n();
  const arrow = dir === 'rtl' ? '←' : '→';
  const [target, setTarget] = useState<Partial<TargetRow> | null>(null);
  const [campaign, setCampaign] = useState<Partial<Campaign> | null>(null);
  const isManager = !!me && (!!me.grants['admin.settings'] || (!!me.grants['opportunity.write'] && me.grants['opportunity.write'] !== 'own'));
  const targets = useQuery({ queryKey: ['targets'], queryFn: () => api.get<TargetRow[]>('/crm/targets'), enabled: can('report.sales') });
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const r = await api.get<RawCampaign[] | { rows: RawCampaign[] }>('/crm/campaigns');
      return (Array.isArray(r) ? r : r?.rows ?? []).map(normCampaign);
    },
    enabled: can('lead.read'),
  });
  const rows = [...(targets.data ?? [])].sort((a, b) => b.periodStart.localeCompare(a.periodStart));

  return (
    <>
      <PageHeader title={bi('الأهداف والحملات', 'Targets & campaigns')} subtitle={bi('أهداف المبيعات مقابل المُحقق (العروض المقبولة)', 'Sales targets vs. achieved (accepted quotes)')} actions={isManager && <Button icon={<Plus className="size-4" />} onClick={() => setTarget({})}>{bi('هدف جديد', 'New target')}</Button>} />
      <div className="space-y-4">
        {can('report.sales') ? (
          <Card title={bi('أهداف المبيعات', 'Sales targets')} padded={false}>
            <ErrorBox error={targets.error} />
            {targets.isLoading ? <Spinner /> : rows.length === 0 ? (
              <Empty icon={<Trophy className="size-8" />} title={bi('لا توجد أهداف', 'No targets')} hint={isManager ? bi('حدد هدفًا شهريًا لكل مندوب لمتابعة الأداء.', 'Set a monthly target per sales rep to track performance.') : undefined} />
            ) : (
              <Table>
                <thead><tr><Th>{bi('المندوب', 'Sales rep')}</Th><Th>{bi('الفترة', 'Period')}</Th><Th>{bi('الهدف', 'Target')}</Th><Th>{bi('المُحقق', 'Achieved')}</Th><Th>{bi('نسبة الإنجاز', 'Progress')}</Th>{isManager && <Th />}</tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className="hover:bg-tint/50">
                      <Td className="font-bold">{t.userName ?? (t.userId ? '—' : bi('الشركة كاملة', 'Whole company'))}</Td>
                      <Td className="num whitespace-nowrap text-xs">{date(t.periodStart)} {arrow} {date(t.periodEnd)}</Td>
                      <Td><Money value={t.amount} /></Td>
                      <Td><Money value={t.achieved} className="font-bold" /></Td>
                      <Td><Progress percent={t.percent} /></Td>
                      {isManager && <Td><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} aria-label={bi('تعديل', 'Edit')} onClick={() => setTarget(t)} /></Td>}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ) : (
          <Card><p className="text-sm text-muted">{bi('لا تملك صلاحية عرض تقارير المبيعات.', 'You do not have permission to view sales reports.')}</p></Card>
        )}

        {can('lead.read') && (
          <Card title={<span className="flex items-center gap-2"><Megaphone className="size-4" />{bi('الحملات التسويقية', 'Marketing campaigns')}</span>} padded={false} actions={can('lead.write') && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setCampaign({})}>{bi('حملة جديدة', 'New campaign')}</Button>}>
            <ErrorBox error={campaigns.error} />
            {campaigns.isLoading ? <Spinner /> : !campaigns.data?.length ? (
              <Empty title={bi('لا توجد حملات', 'No campaigns')} hint={bi('اربط العملاء المحتملين بالحملات لقياس العائد.', 'Link leads to campaigns to measure their return.')} />
            ) : (
              <Table>
                <thead><tr><Th>{bi('الحملة', 'Campaign')}</Th><Th>{bi('القناة', 'Channel')}</Th><Th>{bi('الفترة', 'Period')}</Th><Th>{bi('الميزانية', 'Budget')}</Th><Th>{bi('العملاء المحتملون', 'Leads')}</Th><Th>{bi('المُحوَّلون', 'Converted')}</Th><Th>{bi('نسبة التحويل', 'Conversion rate')}</Th>{can('lead.write') && <Th />}</tr></thead>
                <tbody>
                  {campaigns.data.map((c) => (
                    <tr key={c.id} className="hover:bg-tint/50">
                      <Td className="font-bold">{c.name}</Td>
                      <Td>{c.channel ? (locale === 'en' ? SOURCE_LABELS_EN : SOURCE_LABELS)[c.channel] ?? c.channel : '—'}</Td>
                      <Td className="num whitespace-nowrap text-xs">{c.startDate ? date(c.startDate) : '—'}{c.endDate ? ` ${arrow} ${date(c.endDate)}` : ''}</Td>
                      <Td>{c.budget ? <Money value={c.budget} /> : '—'}</Td>
                      <Td className="num">{c.leads}</Td>
                      <Td className="num">{c.converted}</Td>
                      <Td className="num">{c.leads ? `${Math.round((c.converted / c.leads) * 1000) / 10}%` : '—'}</Td>
                      {can('lead.write') && <Td><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} aria-label={bi('تعديل', 'Edit')} onClick={() => setCampaign(c)} /></Td>}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>
      {target && <TargetDialog target={target} onClose={() => setTarget(null)} />}
      {campaign && <CampaignDialog campaign={campaign} onClose={() => setCampaign(null)} />}
    </>
  );
}
