'use client';
import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Download, HandCoins, Pencil, Plus, Wrench } from 'lucide-react';
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
interface Plan { id: string; name: string; basis: 'revenue' | 'margin'; ratePercent: string; categoryIds: string[]; userIds: string[]; validFrom: string | null; validTo: string | null; active: boolean; sort: number }
interface TechRow { userId: string; name: string; jobs: number; devices: number; firstTimeFixes: number; callbacks: number; happyCustomers: number; totalHalalas: number }

const ENTRY_STATUS: Record<string, [string, string, 'gray' | 'gold' | 'green']> = { open: ['مستحق عند التحصيل', 'Earned, not collected', 'gray'], payable: ['قابل للصرف', 'Payable', 'gold'], paid: ['مصروف', 'Paid', 'green'] };

type Tab = 'reps' | 'plans' | 'technicians';

function CommissionsInner() {
  const { bi } = useI18n();
  const { can } = useMe();
  const canManage = can('commission.manage');
  const [tab, setTab] = useState<Tab>('reps');
  return (
    <>
      <PageHeader title={bi('العمولات والحوافز', 'Commissions & incentives')}
        subtitle={bi('العمولة تُستحق عند الفاتورة الضريبية (388) وتُصرف بنسبة ما حُصّل منها؛ الإشعار الدائن (381) يستردها.', 'Commission is earned on the tax invoice (388) and payable pro-rata to what was collected; a credit note (381) claws it back.')} />
      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { value: 'reps', label: bi('المندوبون', 'Sales reps') },
        ...(canManage ? [{ value: 'plans' as Tab, label: bi('خطط العمولة', 'Plans') }] : []),
        { value: 'technicians', label: bi('حوافز الفنيين', 'Technician incentives') },
      ]} />
      {tab === 'reps' && <RepsTab />}
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
  const s = summary.data;
  const rows = entries.data?.rows ?? [];
  const payableRows = rows.filter((r) => r.status === 'payable');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={bi('الفترة', 'Period')} className="w-44"><Input type="month" dir="ltr" value={period} onChange={(e) => { setPeriod(e.target.value); setPicked([]); }} /></Field>
        {canManage && <Button variant="outline" icon={<Download className="size-4" />} onClick={() => openFile(`/commissions/export${qs({ period })}`)}>{bi('تصدير للرواتب', 'Export for payroll')}</Button>}
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
                <Td><span className="num">{Number(p.ratePercent)}%</span></Td>
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
  });
  const toggle = (k: 'categoryIds' | 'userIds', id: string) => setF((s) => ({ ...s, [k]: s[k].includes(id) ? s[k].filter((x) => x !== id) : [...s[k], id] }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, name: f.name.trim(), validFrom: f.validFrom || null, validTo: f.validTo || null, sort: Number(f.sort) || 0 };
      return plan ? api.put(`/commissions/plans/${plan.id}`, body) : api.post('/commissions/plans', body);
    },
    onSuccess: () => { toast.success(bi('تم حفظ الخطة', 'Plan saved')); qc.invalidateQueries({ queryKey: ['commission-plans'] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onClose={onClose} wide title={plan ? bi('تعديل خطة العمولة', 'Edit commission plan') : bi('خطة عمولة جديدة', 'New commission plan')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!f.name.trim() || !f.ratePercent} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
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
    queryFn: () => api.get<{ rows: TechRow[]; totalHalalas: number; rules: { perDeviceHalalas: number; firstTimeFixHalalas: number; callbackPenaltyHalalas: number; callbackWindowDays: number; happyCustomerHalalas: number } }>(`/commissions/technicians${qs({ from, to })}`),
  });
  const r = q.data?.rules;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={bi('من', 'From')} className="w-44"><Input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={bi('إلى', 'To')} className="w-44"><Input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {r && (
        <p className="text-xs text-muted">
          {bi('القواعد', 'Rules')}: {bi('لكل جهاز مركّب', 'per installed device')} <Money value={r.perDeviceHalalas} /> · {bi('إصلاح من أول زيارة', 'first-time fix')} <Money value={r.firstTimeFixHalalas} /> · {bi('زيارة متكررة خلال', 'callback within')} <span className="num">{r.callbackWindowDays}</span> {bi('يومًا', 'days')} −<Money value={r.callbackPenaltyHalalas} /> · {bi('عميل راضٍ وموقّع', 'signed & happy customer')} <Money value={r.happyCustomerHalalas} />
        </p>
      )}
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

export default function CommissionsPage() {
  return <Suspense fallback={<Spinner />}><CommissionsInner /></Suspense>;
}
