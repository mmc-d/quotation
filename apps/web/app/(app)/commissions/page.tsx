'use client';
import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Download, HandCoins, Pencil, Plus, RefreshCw, Save, Trash2, Trophy, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { api, openFile, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, today } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Checkbox, clsx, Dialog, Empty, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Stat, Table, Tabs, Td, Th } from '@/components/ui';

interface RepRow { userId: string; userName: string; entries: number; earned: string; payable: string; paid: string; outstanding: string }
interface Summary { period: string | null; currentPeriod: string; reps: RepRow[]; totals: { earned: string; payable: string; paid: string; outstanding: string }; canManage: boolean }
interface Entry {
  id: string; userId: string; userName: string; planId: string | null; planName: string | null; planBasis: string | null; planRate: string | null; invoiceId: string; invoiceNumber: string | null; invoiceType: string | null; invoiceDate: string | null;
  contractId: string | null; contractNumber: string | null; earned: string; payable: string; paid: string; outstanding: string; status: string; period: string | null;
}
interface Tier { fromPercent: number; multiplier: number }
interface Plan { id: string; name: string; basis: 'revenue' | 'margin'; ratePercent: string; categoryIds: string[]; userIds: string[]; validFrom: string | null; validTo: string | null; active: boolean; sort: number; tiers: Tier[] }
interface Sums { earned: string; payable: string; paid: string; outstanding: string }
interface MyMonth {
  userId: string; period: string; currentPeriod: string; revenue: string; quota: string | null; attainment: number | null; planName: string | null; tiers: Tier[];
  currentTier: Tier | null; nextTier: Tier | null; multiplier: number; toNextTier: string | null; month: Sums; ytd: Sums;
  entries: (Entry & { invoiceDate: string })[];
}
interface BoardRow { rank: number; userId: string; userName: string; revenue: string; quota: string | null; attainment: number | null; earned: string }
interface TechRow { userId: string; name: string; jobs: number; devices: number; firstTimeFixes: number; callbacks: number; happyCustomers: number; totalHalalas: number }

const ENTRY_STATUS: Record<string, [string, string, 'gray' | 'gold' | 'green']> = { open: ['مستحق عند التحصيل', 'Earned, not collected', 'gray'], payable: ['قابل للصرف', 'Payable', 'gold'], paid: ['مصروف', 'Paid', 'green'] };

type Tab = 'mine' | 'reps' | 'quotas' | 'leaderboard' | 'plans' | 'technicians';

function CommissionsInner() {
  const { bi } = useI18n();
  const { can } = useMe();
  const canManage = can('commission.manage');
  const [tab, setTab] = useState<Tab>(canManage ? 'reps' : 'mine');
  return (
    <>
      <PageHeader title={bi('العمولات والحوافز', 'Commissions & incentives')}
        subtitle={bi('العمولة تُستحق عند الفاتورة الضريبية (388) وتُصرف بنسبة ما حُصّل منها؛ الإشعار الدائن (381) يستردها.', 'Commission is earned on the tax invoice (388) and payable pro-rata to what was collected; a credit note (381) claws it back.')} />
      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { value: 'mine', label: bi('أرباحي', 'My earnings') },
        { value: 'reps', label: bi('المندوبون', 'Sales reps') },
        { value: 'quotas', label: bi('المستهدفات', 'Quotas') },
        { value: 'leaderboard', label: bi('لوحة الصدارة', 'Leaderboard') },
        ...(canManage ? [{ value: 'plans' as Tab, label: bi('خطط العمولة', 'Plans') }] : []),
        { value: 'technicians', label: bi('حوافز الفنيين', 'Technician incentives') },
      ]} />
      {tab === 'mine' && <MyEarningsTab />}
      {tab === 'reps' && <RepsTab />}
      {tab === 'quotas' && <QuotasTab />}
      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'plans' && canManage && <PlansTab />}
      {tab === 'technicians' && <TechniciansTab />}
    </>
  );
}

function RepsTab() {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const canManage = can('commission.manage');
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [rep, setRep] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const summary = useQuery({ queryKey: ['commission-summary', period], queryFn: () => api.get<Summary>(`/commissions/summary${qs({ period })}`) });
  const entries = useQuery({
    queryKey: ['commission-entries', period, rep], enabled: !!rep,
    queryFn: () => api.get<{ rows: Entry[]; total: number }>(`/commissions/entries${qs({ userId: rep, period })}`),
  });
  const markPaid = useMutation({
    mutationFn: () => api.post<{ marked: number; amount: string }>('/commissions/mark-paid', { entryIds: picked, period }),
    onSuccess: (r) => { toast.success(bi(`صُرف ${r.amount} ريال (${r.marked} قيد)`, `${r.amount} SAR marked paid (${r.marked} entries)`)); setPicked([]); qc.invalidateQueries({ queryKey: ['commission-summary'] }); qc.invalidateQueries({ queryKey: ['commission-entries'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const recalc = useMutation({
    mutationFn: () => api.post<{ invoices: number; entries: number }>('/commissions/recalc', { period }),
    onSuccess: (r) => { toast.success(bi(`أُعيد احتساب ${r.invoices} فاتورة`, `${r.invoices} invoices recalculated`)); qc.invalidateQueries({ queryKey: ['commission-summary'] }); qc.invalidateQueries({ queryKey: ['commission-entries'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const s = summary.data;
  const rows = entries.data?.rows ?? [];
  const payableRows = rows.filter((r) => r.status === 'payable');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={bi('الفترة', 'Period')} className="w-44"><Input type="month" dir="ltr" value={period} onChange={(e) => { setPeriod(e.target.value); setPicked([]); }} /></Field>
        {canManage && <Button variant="outline" icon={<Download className="size-4" />} onClick={() => openFile(`/commissions/export${qs({ period })}`)}>{bi('تصدير للرواتب', 'Export for payroll')}</Button>}
        {canManage && <Button variant="outline" icon={<RefreshCw className="size-4" />} loading={recalc.isPending} onClick={() => recalc.mutate()}>{bi('إعادة احتساب الشهر', 'Recalculate month')}</Button>}
      </div>
      {s && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label={bi('مستحق (مكتسب)', 'Earned')} value={<Money value={s.totals.earned} />} />
          <Stat label={bi('قابل للصرف', 'Payable')} value={<Money value={s.totals.payable} />} tone="gold" />
          <Stat label={bi('مصروف', 'Paid')} value={<Money value={s.totals.paid} />} tone="green" />
          <Stat label={bi('متبقٍ للصرف', 'Outstanding')} value={<Money value={s.totals.outstanding} />} />
        </div>
      )}
      <Card padded={false} title={bi('المندوبون', 'Sales reps')}>
        {summary.isLoading ? <Spinner /> : summary.error ? <div className="p-4"><ErrorBox error={summary.error} /></div> : !s?.reps.length ? (
          <Empty icon={<BadgePercent className="size-8" />} title={bi('لا عمولات في هذه الفترة', 'No commissions in this period')} hint={bi('تظهر القيود عند إصدار الفواتير الضريبية على عقود المندوبين.', 'Entries appear when tax invoices are issued on the reps’ contracts.')} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('المندوب', 'Rep')}</Th><Th>{bi('القيود', 'Entries')}</Th><Th>{bi('مكتسب', 'Earned')}</Th><Th>{bi('قابل للصرف', 'Payable')}</Th><Th>{bi('مصروف', 'Paid')}</Th><Th>{bi('متبقٍ', 'Outstanding')}</Th></tr></thead>
            <tbody>
              {s.reps.map((r) => (
                <tr key={r.userId} onClick={() => { setRep(rep === r.userId ? null : r.userId); setPicked([]); }} className={clsx('cursor-pointer hover:bg-tint/50', rep === r.userId && 'bg-tint/60')}>
                  <Td className="font-bold text-primary">{r.userName}</Td><Td className="num">{r.entries}</Td>
                  <Td><Money value={r.earned} fixed /></Td><Td><Money value={r.payable} fixed /></Td><Td><Money value={r.paid} fixed /></Td><Td><Money value={r.outstanding} fixed /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {rep && (
        <Card padded={false} title={bi('تفاصيل القيود', 'Entries')}
          actions={canManage && payableRows.length > 0 && (
            <Button size="sm" icon={<HandCoins className="size-4" />} disabled={!picked.length} loading={markPaid.isPending} onClick={() => markPaid.mutate()}>{bi(`صرف المحدد (${picked.length})`, `Mark as paid (${picked.length})`)}</Button>
          )}>
          {entries.isLoading ? <Spinner /> : rows.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا قيود', 'No entries')}</p> : (
            <Table>
              <thead><tr>
                {canManage && <Th><input type="checkbox" aria-label={bi('تحديد الكل', 'Select all')} checked={payableRows.length > 0 && picked.length === payableRows.length} onChange={(e) => setPicked(e.target.checked ? payableRows.map((r) => r.id) : [])} /></Th>}
                <Th>{bi('الفاتورة', 'Invoice')}</Th><Th>{bi('العقد', 'Contract')}</Th><Th>{bi('الخطة', 'Plan')}</Th><Th>{bi('مكتسب', 'Earned')}</Th><Th>{bi('قابل للصرف', 'Payable')}</Th><Th>{bi('مصروف', 'Paid')}</Th><Th>{bi('الحالة', 'Status')}</Th>
              </tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-tint/50">
                    {canManage && <Td>{e.status === 'payable' && <input type="checkbox" aria-label={e.invoiceNumber ?? e.id} checked={picked.includes(e.id)} onChange={(ev) => setPicked((p) => (ev.target.checked ? [...p, e.id] : p.filter((x) => x !== e.id)))} />}</Td>}
                    <Td><span dir="ltr" className="num font-bold">{e.invoiceNumber ?? '—'}</span> {e.invoiceType && <Badge tone={e.invoiceType === '381' ? 'red' : 'blue'}>{e.invoiceType}</Badge>}<div className="num text-[11px] text-muted">{date(e.invoiceDate)}</div></Td>
                    <Td><span dir="ltr" className="num">{e.contractNumber ?? '—'}</span></Td>
                    <Td>{e.planName ?? '—'}{e.planRate && <div className="text-[11px] text-muted"><span className="num">{Number(e.planRate)}%</span> {e.planBasis === 'margin' ? bi('من الهامش', 'of margin') : bi('من الإيراد', 'of revenue')}</div>}</Td>
                    <Td><Money value={e.earned} fixed /></Td><Td><Money value={e.payable} fixed /></Td><Td><Money value={e.paid} fixed /></Td>
                    <Td><Badge tone={ENTRY_STATUS[e.status]?.[2] ?? 'gray'}>{ENTRY_STATUS[e.status] ? bi(ENTRY_STATUS[e.status]![0], ENTRY_STATUS[e.status]![1]) : e.status}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

function PlansTab() {
  const { bi } = useI18n();
  const plans = useQuery({ queryKey: ['commission-plans'], queryFn: () => api.get<Plan[]>('/commissions/plans') });
  const meta = useQuery({ queryKey: ['product-meta'], queryFn: () => api.get<{ categories: { id: string; nameAr: string; nameEn: string | null }[] }>('/products/meta'), staleTime: 300_000 });
  const users = useQuery({ queryKey: ['users-min'], queryFn: () => api.get<{ id: string; email: string; nameAr: string | null; status: string }[]>('/users').catch(() => []), staleTime: 300_000 });
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const catName = (id: string) => meta.data?.categories.find((c) => c.id === id)?.nameAr ?? id.slice(0, 8);
  const userName = (id: string) => { const u = users.data?.find((x) => x.id === id); return u?.nameAr || u?.email || id.slice(0, 8); };
  return (
    <Card padded={false} title={bi('خطط العمولة', 'Commission plans')} actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{bi('خطة جديدة', 'New plan')}</Button>}>
      {plans.isLoading ? <Spinner /> : !plans.data?.length ? <Empty icon={<BadgePercent className="size-8" />} title={bi('لا توجد خطط', 'No plans yet')} hint={bi('أنشئ خطة لكل خط منتجات (انتركم، أقفال، منزل ذكي...) أو خطة عامة.', 'Create a plan per product line (intercom, locks, smart home…) or a catch-all plan.')} /> : (
        <Table>
          <thead><tr><Th>{bi('الخطة', 'Plan')}</Th><Th>{bi('الأساس', 'Basis')}</Th><Th>{bi('النسبة', 'Rate')}</Th><Th>{bi('الفئات', 'Categories')}</Th><Th>{bi('المندوبون', 'Reps')}</Th><Th>{bi('السريان', 'Validity')}</Th><Th /></tr></thead>
          <tbody>
            {plans.data.map((p) => (
              <tr key={p.id} className={clsx('hover:bg-tint/50', !p.active && 'opacity-60')}>
                <Td className="font-bold">{p.name} {!p.active && <Badge>{bi('موقوفة', 'Inactive')}</Badge>}</Td>
                <Td>{p.basis === 'margin' ? bi('الهامش', 'Margin') : bi('الإيراد', 'Revenue')}</Td>
                <Td><span className="num">{Number(p.ratePercent)}%</span>{p.tiers?.length > 0 && <div className="text-[11px] text-muted">{[...p.tiers].sort((a, b) => a.fromPercent - b.fromPercent).map((t) => <span key={t.fromPercent} dir="ltr" className="num me-2 inline-block">≥{t.fromPercent}% ×{t.multiplier}</span>)}</div>}</Td>
                <Td className="text-xs">{p.categoryIds.length ? p.categoryIds.map(catName).join('، ') : <span className="text-muted">{bi('كل الفئات', 'All categories')}</span>}</Td>
                <Td className="text-xs">{p.userIds.length ? p.userIds.map(userName).join('، ') : <span className="text-muted">{bi('كل أصحاب العقود', 'Every contract owner')}</span>}</Td>
                <Td className="num whitespace-nowrap text-xs">{p.validFrom ?? '…'} → {p.validTo ?? '…'}</Td>
                <Td><Button size="sm" variant="outline" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(p)}>{bi('تعديل', 'Edit')}</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <PlanDialog plan={editing === 'new' ? null : editing} categories={meta.data?.categories ?? []} users={(users.data ?? []).filter((u) => u.status !== 'suspended')} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function PlanDialog({ plan, categories, users, onClose }: { plan: Plan | null; categories: { id: string; nameAr: string; nameEn: string | null }[]; users: { id: string; email: string; nameAr: string | null }[]; onClose: () => void }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: plan?.name ?? '', basis: plan?.basis ?? 'revenue', ratePercent: plan ? String(Number(plan.ratePercent)) : '', categoryIds: plan?.categoryIds ?? [], userIds: plan?.userIds ?? [],
    validFrom: plan?.validFrom ?? '', validTo: plan?.validTo ?? '', active: plan?.active ?? true, sort: plan?.sort ?? 0,
    tiers: (plan?.tiers ?? []).map((t) => ({ fromPercent: String(t.fromPercent), multiplier: String(t.multiplier) })),
  });
  const tiersValid = f.tiers.every((t) => t.fromPercent !== '' && t.multiplier !== '' && Number(t.fromPercent) >= 0 && Number(t.multiplier) >= 0) && new Set(f.tiers.map((t) => Number(t.fromPercent))).size === f.tiers.length;
  const setTier = (i: number, patch: Partial<{ fromPercent: string; multiplier: string }>) => setF((s) => ({ ...s, tiers: s.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const toggle = (k: 'categoryIds' | 'userIds', id: string) => setF((s) => ({ ...s, [k]: s[k].includes(id) ? s[k].filter((x) => x !== id) : [...s[k], id] }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, name: f.name.trim(), validFrom: f.validFrom || null, validTo: f.validTo || null, sort: Number(f.sort) || 0, tiers: f.tiers.map((t) => ({ fromPercent: Number(t.fromPercent), multiplier: Number(t.multiplier) })) };
      return plan ? api.put(`/commissions/plans/${plan.id}`, body) : api.post('/commissions/plans', body);
    },
    onSuccess: () => { toast.success(bi('تم حفظ الخطة', 'Plan saved')); qc.invalidateQueries({ queryKey: ['commission-plans'] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} wide title={plan ? bi('تعديل خطة العمولة', 'Edit commission plan') : bi('خطة عمولة جديدة', 'New commission plan')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!f.name.trim() || !f.ratePercent || !tiersValid} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('اسم الخطة', 'Plan name')}><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></Field>
        <Field label={bi('الأساس', 'Basis')} hint={f.basis === 'margin' ? bi('الإيراد ناقص تكلفة بند العرض (يحدّ من الخصومات)', 'Revenue minus the quote line cost (discourages discounting)') : bi('صافي الفاتورة بدون ضريبة', 'Invoice net, VAT excluded')}>
          <Select value={f.basis} onChange={(e) => setF((s) => ({ ...s, basis: e.target.value as 'revenue' | 'margin' }))}>
            <option value="revenue">{bi('الإيراد', 'Revenue')}</option><option value="margin">{bi('الهامش', 'Margin')}</option>
          </Select>
        </Field>
        <Field label={bi('النسبة %', 'Rate %')}><Input dir="ltr" className="num text-start" inputMode="decimal" value={f.ratePercent} onChange={(e) => setF((s) => ({ ...s, ratePercent: e.target.value }))} /></Field>
        <Field label={bi('الترتيب', 'Order')} hint={bi('أول خطة تطابق فئة البند تُطبَّق، ثم الخطة العامة.', 'The first plan matching the line category applies, then the catch-all.')}><Input type="number" dir="ltr" className="num text-start" value={f.sort} onChange={(e) => setF((s) => ({ ...s, sort: Number(e.target.value) }))} /></Field>
        <Field label={bi('يسري من', 'Valid from')}><Input type="date" dir="ltr" value={f.validFrom} onChange={(e) => setF((s) => ({ ...s, validFrom: e.target.value }))} /></Field>
        <Field label={bi('يسري حتى', 'Valid to')}><Input type="date" dir="ltr" value={f.validTo} onChange={(e) => setF((s) => ({ ...s, validTo: e.target.value }))} /></Field>
        <Field label={bi('فئات المنتجات (فارغ = كل الفئات)', 'Product categories (none = all)')}>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {categories.length === 0 ? <p className="text-xs text-muted">{bi('لا فئات', 'No categories')}</p> : categories.map((c) => <Checkbox key={c.id} label={locale === 'en' ? c.nameEn || c.nameAr : c.nameAr} checked={f.categoryIds.includes(c.id)} onChange={() => toggle('categoryIds', c.id)} />)}
          </div>
        </Field>
        <Field label={bi('المندوبون (فارغ = كل أصحاب العقود)', 'Reps (none = every contract owner)')}>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {users.map((u) => <Checkbox key={u.id} label={u.nameAr || u.email} checked={f.userIds.includes(u.id)} onChange={() => toggle('userIds', u.id)} />)}
          </div>
        </Field>
        <Checkbox label={bi('الخطة فعّالة', 'Plan active')} checked={f.active} onChange={(v) => setF((s) => ({ ...s, active: v }))} />
      </div>
      <div className="mt-4 rounded-lg border border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-extrabold text-primary">{bi('المسرّعات حسب تحقيق المستهدف', 'Accelerators on quota attainment')}</h4>
            <p className="text-[11px] text-muted">{bi('من نسبة تحقيق المستهدف الشهري للمندوب تُضرب العمولة في المعامل (أعلى شريحة محققة).', 'From the rep’s monthly quota attainment, commission is multiplied (highest tier reached).')}</p>
          </div>
          <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setF((s) => ({ ...s, tiers: [...s.tiers, { fromPercent: s.tiers.length ? String(Math.max(...s.tiers.map((t) => Number(t.fromPercent) || 0)) + 20) : '100', multiplier: '1.2' }] }))}>{bi('شريحة', 'Tier')}</Button>
        </div>
        {f.tiers.length === 0 ? <p className="text-xs text-muted">{bi('بدون شرائح: النسبة ثابتة.', 'No tiers: flat rate.')}</p> : (
          <div className="space-y-2">
            {f.tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">{bi('من', 'From')}</span>
                <Input dir="ltr" inputMode="decimal" className="num w-24 text-start" value={t.fromPercent} onChange={(e) => setTier(i, { fromPercent: e.target.value })} aria-label={bi('نسبة التحقيق %', 'Attainment %')} />
                <span className="text-muted">{bi('٪ من المستهدف ← المعامل ×', '% of quota → multiplier ×')}</span>
                <Input dir="ltr" inputMode="decimal" className="num w-20 text-start" value={t.multiplier} onChange={(e) => setTier(i, { multiplier: e.target.value })} aria-label={bi('المعامل', 'Multiplier')} />
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label={bi('حذف', 'Remove')} onClick={() => setF((s) => ({ ...s, tiers: s.tiers.filter((_, j) => j !== i) }))} />
              </div>
            ))}
            {!tiersValid && <p className="text-xs text-danger">{bi('أكمل الشرائح دون تكرار العتبة.', 'Complete the tiers; thresholds must be unique.')}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function TechniciansTab() {
  const { bi } = useI18n();
  const t = today();
  const [from, setFrom] = useState(`${t.slice(0, 7)}-01`);
  const [to, setTo] = useState(t);
  const q = useQuery({
    queryKey: ['commission-technicians', from, to], enabled: !!from && !!to && from <= to,
    queryFn: () => api.get<{ rows: TechRow[]; totalHalalas: number; rules: TechRules; rulesAreDefault?: boolean }>(`/commissions/technicians${qs({ from, to })}`),
  });
  const r = q.data?.rules;
  const { can } = useMe();
  const [editRules, setEditRules] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={bi('من', 'From')} className="w-44"><Input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={bi('إلى', 'To')} className="w-44"><Input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {r && (
        <p className="text-xs text-muted">
          {q.data?.rulesAreDefault ? bi('القواعد (الافتراضية)', 'Rules (defaults)') : bi('القواعد', 'Rules')}: {bi('لكل جهاز مركّب', 'per installed device')} <Money value={r.perDeviceHalalas} /> · {bi('إصلاح من أول زيارة', 'first-time fix')} <Money value={r.firstTimeFixHalalas} /> · {bi('زيارة متكررة خلال', 'callback within')} <span className="num">{r.callbackWindowDays}</span> {bi('يومًا', 'days')} −<Money value={r.callbackPenaltyHalalas} /> · {bi('عميل راضٍ وموقّع', 'signed & happy customer')} <Money value={r.happyCustomerHalalas} />
          {can('commission.manage') && <Button size="sm" variant="outline" className="ms-2" icon={<Pencil className="size-3.5" />} onClick={() => setEditRules(true)}>{bi('تعديل القواعد', 'Edit rules')}</Button>}
        </p>
      )}
      {editRules && r && <TechRulesDialog rules={r} onClose={() => setEditRules(false)} />}
      <Card padded={false} title={bi('حوافز الفنيين', 'Technician incentives')} actions={q.data && <Money value={q.data.totalHalalas} className="font-extrabold text-primary" />}>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !q.data?.rows.length ? (
          <Empty icon={<Wrench className="size-8" />} title={bi('لا أوامر عمل مكتملة في الفترة', 'No completed work orders in this period')} />
        ) : (
          <Table>
            <thead><tr><Th>{bi('الفني', 'Technician')}</Th><Th>{bi('الأعمال', 'Jobs')}</Th><Th>{bi('أجهزة مركّبة', 'Devices installed')}</Th><Th>{bi('إصلاح من أول زيارة', 'First-time fixes')}</Th><Th>{bi('زيارات متكررة', 'Callbacks')}</Th><Th>{bi('عملاء راضون', 'Happy customers')}</Th><Th>{bi('الحافز', 'Incentive')}</Th></tr></thead>
            <tbody>
              {q.data.rows.map((x) => (
                <tr key={x.userId} className="hover:bg-tint/50">
                  <Td className="font-bold">{x.name}</Td><Td className="num">{x.jobs}</Td><Td className="num">{x.devices}</Td><Td className="num">{x.firstTimeFixes}</Td>
                  <Td className={clsx('num', x.callbacks > 0 && 'text-danger')}>{x.callbacks}</Td><Td className="num">{x.happyCustomers}</Td>
                  <Td><Money value={x.totalHalalas} fixed className="font-bold" /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Number(v.toFixed(2))}%`);

/** Attainment gauge (CSS): fill to the attainment, tier thresholds as ticks. */
function AttainmentGauge({ attainment, tiers }: { attainment: number | null; tiers: Tier[] }) {
  const { bi } = useI18n();
  const top = Math.max(150, ...tiers.map((t) => t.fromPercent + 30), attainment ?? 0);
  const scale = Math.ceil(top / 10) * 10;
  const at = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`;
  const fill = attainment ?? 0;
  const tone = fill >= 100 ? 'bg-primary' : fill >= 70 ? 'bg-gold' : 'bg-amber-500';
  return (
    <div className="space-y-1" role="meter" aria-valuemin={0} aria-valuemax={scale} aria-valuenow={Math.max(0, fill)} aria-label={bi('نسبة تحقيق المستهدف', 'Quota attainment')}>
      <div className="relative h-5 overflow-hidden rounded-full bg-tint">
        <div className={clsx('h-full rounded-full transition-all', tone)} style={{ width: at(fill) }} />
        {tiers.map((t) => <div key={t.fromPercent} className="absolute inset-y-0 w-0.5 bg-gold-dark/70" style={{ insetInlineStart: at(t.fromPercent) }} />)}
        <div className="absolute inset-y-0 w-0.5 bg-ink/40" style={{ insetInlineStart: at(100) }} />
      </div>
      <div className="relative h-4 text-[10px] text-muted">
        <span className="absolute" style={{ insetInlineStart: 0 }}><span dir="ltr" className="num">0%</span></span>
        {[...new Set([100, ...tiers.map((t) => t.fromPercent)])].map((v) => (
          <span key={v} className="absolute -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: at(v) }}><span dir="ltr" className="num">{v}%</span></span>
        ))}
      </div>
    </div>
  );
}

function MyEarningsTab() {
  const { bi } = useI18n();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const q = useQuery({ queryKey: ['commission-me', period], queryFn: () => api.get<MyMonth>(`/commissions/me${qs({ period })}`) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <Field label={bi('الشهر', 'Month')} className="w-44"><Input type="month" dir="ltr" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : d && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title={bi('تحقيق المستهدف', 'Quota attainment')} className="lg:col-span-2">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-3xl font-extrabold text-primary"><span dir="ltr" className="num">{pct(d.attainment)}</span></div>
                  <div className="text-xs text-muted">
                    {bi('الإيراد', 'Revenue')} <Money value={d.revenue} fixed /> {bi('من مستهدف', 'of quota')} {d.quota ? <Money value={d.quota} fixed /> : <span>{bi('غير محدد', 'not set')}</span>}
                  </div>
                </div>
                <div className="text-end text-sm">
                  <div>{bi('المعامل الحالي', 'Current multiplier')} <b dir="ltr" className="num text-primary">×{d.multiplier}</b></div>
                  {d.nextTier && <div className="text-xs text-muted">{bi('الشريحة التالية عند', 'Next tier at')} <span dir="ltr" className="num">{d.nextTier.fromPercent}%</span> (×<span className="num">{d.nextTier.multiplier}</span>){d.toNextTier && <> · {bi('متبقٍ', 'to go')} <Money value={d.toNextTier} /></>}</div>}
                </div>
              </div>
              <AttainmentGauge attainment={d.attainment} tiers={d.tiers} />
              <p className="mt-2 text-[11px] text-muted">{bi('الإيراد = صافي الفواتير الضريبية (388) بدون ضريبة ناقص الإشعارات الدائنة (381) بتاريخ الشهر، حسب حصتك من تقسيم العمولة.', 'Revenue = tax invoices (388) net of VAT minus credit notes (381) dated in the month, at your commission-split share.')}</p>
            </Card>
            <Card title={bi('سلّم الشرائح', 'Tier ladder')}>
              {d.tiers.length === 0 ? <p className="text-xs text-muted">{bi('لا مسرّعات في خطتك: نسبة ثابتة.', 'No accelerators on your plan: flat rate.')}</p> : (
                <ul className="space-y-1.5 text-sm">
                  <li className={clsx('flex justify-between rounded-lg px-3 py-1.5', !d.currentTier ? 'bg-primary text-white' : 'bg-tint/50')}><span>{bi('أقل من', 'Below')} <span dir="ltr" className="num">{d.tiers[0]!.fromPercent}%</span></span><span dir="ltr" className="num">×1</span></li>
                  {d.tiers.map((t) => (
                    <li key={t.fromPercent} className={clsx('flex justify-between rounded-lg px-3 py-1.5', d.currentTier?.fromPercent === t.fromPercent ? 'bg-primary text-white' : 'bg-tint/50')}>
                      <span>{bi('من', 'From')} <span dir="ltr" className="num">{t.fromPercent}%</span></span><span dir="ltr" className="num">×{t.multiplier}</span>
                    </li>
                  ))}
                </ul>
              )}
              {d.planName && <p className="mt-2 text-[11px] text-muted">{d.planName}</p>}
            </Card>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={bi('مكتسب هذا الشهر', 'Earned this month')} value={<Money value={d.month.earned} />} hint={<>{bi('منذ بداية السنة', 'YTD')} <Money value={d.ytd.earned} /></>} />
            <Stat label={bi('قابل للصرف', 'Payable')} value={<Money value={d.month.payable} />} tone="gold" hint={<>{bi('منذ بداية السنة', 'YTD')} <Money value={d.ytd.payable} /></>} />
            <Stat label={bi('مصروف', 'Paid')} value={<Money value={d.month.paid} />} tone="green" hint={<>{bi('منذ بداية السنة', 'YTD')} <Money value={d.ytd.paid} /></>} />
          </div>
          <Card padded={false} title={bi('قيود الشهر', 'Entries this month')}>
            {d.entries.length === 0 ? <Empty icon={<BadgePercent className="size-8" />} title={bi('لا قيود في هذا الشهر', 'No entries this month')} /> : (
              <Table>
                <thead><tr><Th>{bi('الفاتورة', 'Invoice')}</Th><Th>{bi('العقد', 'Contract')}</Th><Th>{bi('الخطة', 'Plan')}</Th><Th>{bi('مكتسب', 'Earned')}</Th><Th>{bi('قابل للصرف', 'Payable')}</Th><Th>{bi('مصروف', 'Paid')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr></thead>
                <tbody>
                  {d.entries.map((e) => (
                    <tr key={e.id} className="hover:bg-tint/50">
                      <Td><span dir="ltr" className="num font-bold">{e.invoiceNumber ?? '—'}</span> {e.invoiceType && <Badge tone={e.invoiceType === '381' ? 'red' : 'blue'}>{e.invoiceType}</Badge>}<div className="num text-[11px] text-muted">{date(e.invoiceDate)}</div></Td>
                      <Td><span dir="ltr" className="num">{e.contractNumber ?? '—'}</span></Td>
                      <Td>{e.planName ?? '—'}</Td>
                      <Td><Money value={e.earned} fixed /></Td><Td><Money value={e.payable} fixed /></Td><Td><Money value={e.paid} fixed /></Td>
                      <Td><Badge tone={ENTRY_STATUS[e.status]?.[2] ?? 'gray'}>{ENTRY_STATUS[e.status] ? bi(ENTRY_STATUS[e.status]![0], ENTRY_STATUS[e.status]![1]) : e.status}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function QuotasTab() {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const [year, setYear] = useState(today().slice(0, 4));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ['commission-quotas', year], enabled: /^\d{4}$/.test(year),
    queryFn: () => api.get<{ rows: { userId: string; period: string; amount: string }[]; reps: { id: string; name: string }[]; canManage: boolean }>(`/commissions/quotas${qs({ year })}`),
  });
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const monthLabel = (p: string) => new Date(`${p}-01T00:00:00`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory', { month: 'short' });
  const stored = (userId: string, period: string) => q.data?.rows.find((r) => r.userId === userId && r.period === period)?.amount ?? '';
  const valueOf = (userId: string, period: string) => edits[`${userId}|${period}`] ?? (stored(userId, period) ? String(Number(stored(userId, period))) : '');
  const dirty = Object.keys(edits).length > 0;
  const bad = Object.values(edits).some((v) => v.trim() !== '' && !/^\d{1,15}(\.\d{1,2})?$/.test(v.trim()));
  const save = useMutation({
    mutationFn: async () => {
      const byPeriod = new Map<string, { userId: string; amount: string | null }[]>();
      for (const [k, v] of Object.entries(edits)) {
        const [userId, period] = k.split('|') as [string, string];
        const list = byPeriod.get(period) ?? [];
        list.push({ userId, amount: v.trim() === '' ? null : v.trim() });
        byPeriod.set(period, list);
      }
      for (const [period, rows] of byPeriod) await api.put('/commissions/quotas', { period, rows });
      return byPeriod.size;
    },
    onSuccess: () => {
      toast.success(bi('تم حفظ المستهدفات وإعادة احتساب الشرائح', 'Quotas saved; tiers recalculated'));
      setEdits({});
      for (const k of ['commission-quotas', 'commission-me', 'commission-leaderboard', 'commission-summary', 'commission-entries']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const canManage = !!q.data?.canManage;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={bi('السنة', 'Year')} className="w-32"><Input dir="ltr" inputMode="numeric" className="num text-start" value={year} onChange={(e) => { setYear(e.target.value.slice(0, 4)); setEdits({}); }} /></Field>
        {canManage && <Button icon={<Save className="size-4" />} disabled={!dirty || bad} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ المستهدفات', 'Save quotas')}</Button>}
        {canManage && dirty && <Button variant="outline" onClick={() => setEdits({})}>{bi('تراجع', 'Discard')}</Button>}
      </div>
      <Card padded={false} title={bi('المستهدف الشهري للمندوب (ريال، بدون ضريبة)', 'Monthly quota per rep (SAR, VAT excluded)')}>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !q.data?.reps.length ? <Empty icon={<BadgePercent className="size-8" />} title={bi('لا مندوبين', 'No reps')} /> : (
          <Table>
            <thead><tr><Th className="sticky start-0 z-10">{bi('المندوب', 'Rep')}</Th>{months.map((m) => <Th key={m} className="whitespace-nowrap">{monthLabel(m)}</Th>)}</tr></thead>
            <tbody>
              {q.data.reps.map((r) => (
                <tr key={r.id} className="hover:bg-tint/30">
                  <Td className="sticky start-0 z-10 whitespace-nowrap bg-white font-bold">{r.name}</Td>
                  {months.map((m) => {
                    const k = `${r.id}|${m}`;
                    return (
                      <Td key={m} className="px-1.5">
                        {canManage ? (
                          <Input dir="ltr" inputMode="decimal" className={clsx('num w-24 px-2 py-1 text-start', k in edits && 'border-gold bg-gold/5')} value={valueOf(r.id, m)} placeholder="—"
                            aria-label={`${r.name} ${m}`} onChange={(e) => setEdits((s) => ({ ...s, [k]: e.target.value }))} />
                        ) : stored(r.id, m) ? <Money value={stored(r.id, m)} /> : <span className="text-muted">—</span>}
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {bad && <p className="text-xs text-danger">{bi('مبلغ غير صالح (رقم بخانتين عشريتين كحد أقصى).', 'Invalid amount (a number with up to 2 decimals).')}</p>}
    </div>
  );
}

function LeaderboardTab() {
  const { bi } = useI18n();
  const [period, setPeriod] = useState(today().slice(0, 7));
  const q = useQuery({ queryKey: ['commission-leaderboard', period], queryFn: () => api.get<{ rows: BoardRow[] }>(`/commissions/leaderboard${qs({ period })}`) });
  return (
    <div className="space-y-4">
      <Field label={bi('الشهر', 'Month')} className="w-44"><Input type="month" dir="ltr" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
      <Card padded={false} title={bi('الترتيب حسب تحقيق المستهدف', 'Ranked by quota attainment')}>
        {q.isLoading ? <Spinner /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !q.data?.rows.length ? (
          <Empty icon={<Trophy className="size-8" />} title={bi('لا إيراد ولا مستهدفات في هذا الشهر', 'No revenue or quotas this month')} />
        ) : (
          <Table>
            <thead><tr><Th>#</Th><Th>{bi('المندوب', 'Rep')}</Th><Th>{bi('الإيراد', 'Revenue')}</Th><Th>{bi('المستهدف', 'Quota')}</Th><Th>{bi('التحقيق', 'Attainment')}</Th><Th>{bi('العمولة المكتسبة', 'Earned')}</Th></tr></thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.userId} className="hover:bg-tint/50">
                  <Td className={clsx('num font-extrabold', r.rank === 1 ? 'text-gold-dark' : 'text-muted')}>{r.rank}</Td>
                  <Td className="font-bold text-primary">{r.userName}</Td>
                  <Td><Money value={r.revenue} fixed /></Td>
                  <Td>{r.quota ? <Money value={r.quota} /> : <span className="text-muted">—</span>}</Td>
                  <Td className="min-w-[10rem]">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-tint"><div className={clsx('h-full rounded-full', (r.attainment ?? 0) >= 100 ? 'bg-primary' : 'bg-gold')} style={{ width: `${Math.min(100, Math.max(0, r.attainment ?? 0))}%` }} /></div>
                      <span dir="ltr" className="num w-16 text-xs font-bold">{pct(r.attainment)}</span>
                    </div>
                  </Td>
                  <Td><Money value={r.earned} fixed /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export default function CommissionsPage() {
  return <Suspense fallback={<Spinner />}><CommissionsInner /></Suspense>;
}

type TechRules = { perDeviceHalalas: number; firstTimeFixHalalas: number; callbackPenaltyHalalas: number; callbackWindowDays: number; happyCustomerHalalas: number };

/** Technician incentive rules (amounts entered in SAR, stored in halalas). */
function TechRulesDialog({ rules, onClose }: { rules: TechRules; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const sar = (h: number) => String(h / 100);
  const [f, setF] = useState({ perDevice: sar(rules.perDeviceHalalas), ftf: sar(rules.firstTimeFixHalalas), callback: sar(rules.callbackPenaltyHalalas), window: String(rules.callbackWindowDays), happy: sar(rules.happyCustomerHalalas) });
  const toH = (v: string) => Math.round(Number(v) * 100);
  const valid = [f.perDevice, f.ftf, f.callback, f.happy].every((v) => v !== '' && Number(v) >= 0) && Number(f.window) >= 1;
  const save = useMutation({
    mutationFn: () => api.put('/commissions/technician-rules', { perDeviceHalalas: toH(f.perDevice), firstTimeFixHalalas: toH(f.ftf), callbackPenaltyHalalas: toH(f.callback), callbackWindowDays: Math.round(Number(f.window)), happyCustomerHalalas: toH(f.happy) }),
    onSuccess: () => { toast.success(bi('تم حفظ القواعد', 'Rules saved')); void qc.invalidateQueries({ queryKey: ['commission-technicians'] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const num = (k: keyof typeof f, label: string) => <Field label={label}><Input type="number" dir="ltr" min={0} step="0.01" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <Dialog open onClose={onClose} title={bi('قواعد حوافز الفنيين', 'Technician incentive rules')} footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!valid} icon={<Save className="size-4" />} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {num('perDevice', bi('لكل جهاز مركّب (ر.س)', 'Per installed device (SAR)'))}
        {num('ftf', bi('إصلاح من أول زيارة (ر.س)', 'First-time fix bonus (SAR)'))}
        {num('callback', bi('خصم الزيارة المتكررة (ر.س)', 'Callback penalty (SAR)'))}
        <Field label={bi('مدة احتساب الزيارة المتكررة (أيام)', 'Callback window (days)')}><Input type="number" dir="ltr" min={1} value={f.window} onChange={(e) => setF({ ...f, window: e.target.value })} /></Field>
        {num('happy', bi('عميل راضٍ وموقّع (ر.س)', 'Signed & happy customer (SAR)'))}
      </div>
    </Dialog>
  );
}
