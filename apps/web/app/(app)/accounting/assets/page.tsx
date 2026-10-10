'use client';
import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, Package, Play, Plus } from 'lucide-react';
import { api, openFile, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Spinner, Table, Tabs, Td, Th } from '@/components/ui';
import { errMsg } from '../../quotes/_components/common';
import { RequirePerm } from '../../settings/_components/common';
import { AccountPicker, Amt } from '../_components/ledger-kit';

interface Asset {
  id: string; code: string; nameAr: string; accountId: string; acquiredOn: string; startMonth: string; cost: string; salvage: string; lifeMonths: number;
  accumulated: string; netBook: string; monthly: string; status: 'active' | 'disposed'; disposedOn: string | null; costCenter: string | null;
}
interface AssetDetail extends Asset { schedule: { month: string; amount: string; accumulated: string; netBook: string }[] }
type Tab = 'register' | 'depreciation' | 'eosb';

const lastMonth = () => { const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

export default function AssetsPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="ledger.read" title={bi('الأصول الثابتة والمخصصات', 'Fixed assets & accruals')}><Suspense fallback={<Spinner />}><Screen /></Suspense></RequirePerm>;
}

function Screen() {
  const { bi } = useI18n();
  const { can } = useMe();
  const [tab, setTab] = useState<Tab>('register');
  return (
    <>
      <PageHeader title={bi('الأصول الثابتة والمخصصات', 'Fixed assets & accruals')} subtitle={bi('سجل الأصول والإهلاك الشهري ومخصص مكافأة نهاية الخدمة.', 'Asset register, monthly depreciation and the end-of-service provision.')} />
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'register', label: bi('سجل الأصول', 'Register') },
        { value: 'depreciation', label: bi('الإهلاك الشهري', 'Depreciation') },
        ...(can('ledger.post') ? [{ value: 'eosb' as const, label: bi('مخصص نهاية الخدمة', 'End-of-service') }] : []),
      ]} />
      {tab === 'register' ? <Register /> : tab === 'depreciation' ? <Depreciation /> : <Eosb />}
    </>
  );
}

function Register() {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['fixed-assets'], queryFn: () => api.get<{ items: Asset[]; totals: { cost: string; accumulated: string; netBook: string } }>('/accounting/fixed-assets') });
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [disposing, setDisposing] = useState<Asset | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['fixed-assets'] }); void qc.invalidateQueries({ queryKey: ['fixed-asset'] }); void qc.invalidateQueries({ queryKey: ['gl-reconciliation'] }); };
  return (
    <>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" icon={<FileSpreadsheet className="size-4" />} onClick={() => openFile('/accounting/fixed-assets?format=xlsx')}>Excel</Button>
        {can('ledger.write') && <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{bi('أصل جديد', 'New asset')}</Button>}
      </div>
      <ErrorBox error={list.error} />
      <Card padded={false}>
        {list.isLoading ? <Spinner /> : !list.data?.items.length ? <Empty icon={<Package className="size-8" />} title={bi('لا توجد أصول مسجلة', 'No assets registered')} hint={bi('قيّد الشراء بفاتورة مورد أو قيد يومية ثم سجّل الأصل هنا ليُهلَك شهريًا.', 'Book the purchase through a bill or journal entry, then register the asset here to depreciate it monthly.')} /> : (
          <Table>
            <thead><tr><Th>{bi('الرمز', 'Code')}</Th><Th>{bi('الأصل', 'Asset')}</Th><Th>{bi('الشراء', 'Acquired')}</Th><Th className="text-end">{bi('التكلفة', 'Cost')}</Th><Th className="text-end">{bi('الإهلاك الشهري', 'Monthly')}</Th><Th className="text-end">{bi('مجمع الإهلاك', 'Accumulated')}</Th><Th className="text-end">{bi('القيمة الدفترية', 'Net book')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th /></tr></thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id} className="hover:bg-tint/50">
                  <Td className="num text-xs"><span dir="ltr">{a.code}</span></Td>
                  <Td><button className="font-bold text-primary hover:underline" onClick={() => setSel(a.id)}>{a.nameAr}</button></Td>
                  <Td className="num text-xs">{date(a.acquiredOn)}</Td>
                  <Td className="text-end"><Amt v={a.cost} /></Td><Td className="text-end"><Amt v={a.monthly} /></Td><Td className="text-end"><Amt v={a.accumulated} /></Td><Td className="text-end"><Amt v={a.netBook} strong /></Td>
                  <Td>{a.status === 'active' ? <Badge tone="green">{bi('نشط', 'Active')}</Badge> : <Badge tone="gray">{bi('مستبعد', 'Disposed')} {a.disposedOn ? date(a.disposedOn) : ''}</Badge>}</Td>
                  <Td className="text-end">{a.status === 'active' && can('ledger.post') && <Button size="sm" variant="outline" onClick={() => setDisposing(a)}>{bi('استبعاد', 'Dispose')}</Button>}</Td>
                </tr>
              ))}
              <tr className="bg-primary text-white"><Td colSpan={3} className="font-extrabold">{bi('الإجمالي', 'Total')}</Td><Td className="text-end"><Amt v={list.data.totals.cost} strong className="text-white" /></Td><Td /><Td className="text-end"><Amt v={list.data.totals.accumulated} strong className="text-white" /></Td><Td className="text-end"><Amt v={list.data.totals.netBook} strong className="text-white" /></Td><Td colSpan={2} /></tr>
            </tbody>
          </Table>
        )}
      </Card>
      {adding && <AddAsset onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
      {sel && <Schedule id={sel} onClose={() => setSel(null)} />}
      {disposing && <Dispose asset={disposing} onClose={() => setDisposing(null)} onDone={() => { setDisposing(null); refresh(); }} />}
    </>
  );
}

function AddAsset({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { bi } = useI18n();
  const [f, setF] = useState({ nameAr: '', accountId: '', acquiredOn: today(), cost: '', salvage: '0', lifeMonths: '60', openingAccumulated: '0', costCenter: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => api.post('/accounting/fixed-assets', { ...f, lifeMonths: Number(f.lifeMonths), costCenter: f.costCenter || null }),
    onSuccess: () => { toast.success(bi('سُجّل الأصل', 'Asset registered')); onDone(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onClose={onClose} title={bi('أصل ثابت جديد', 'New fixed asset')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!f.nameAr.trim() || !f.accountId || !f.cost || Number(f.lifeMonths) < 1} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('اسم الأصل *', 'Name *')} className="sm:col-span-2"><Input value={f.nameAr} onChange={set('nameAr')} /></Field>
        <Field label={bi('حساب التكلفة *', 'Cost account *')} className="sm:col-span-2" hint={bi('مثل 1201 الأجهزة والمعدات — حساب أصل غير متداول.', 'e.g. 1201 Equipment — a non-current asset account.')}><AccountPicker value={f.accountId} onChange={(id) => setF({ ...f, accountId: id })} /></Field>
        <Field label={bi('تاريخ الشراء / التشغيل *', 'Acquired / in service *')}><Input type="date" value={f.acquiredOn} onChange={set('acquiredOn')} /></Field>
        <Field label={bi('العمر الإنتاجي (شهر) *', 'Useful life (months) *')}><Input type="number" min={1} value={f.lifeMonths} onChange={set('lifeMonths')} /></Field>
        <Field label={bi('التكلفة (ر.س) *', 'Cost (SAR) *')}><Input value={f.cost} onChange={set('cost')} inputMode="decimal" dir="ltr" /></Field>
        <Field label={bi('قيمة الخردة', 'Salvage value')}><Input value={f.salvage} onChange={set('salvage')} inputMode="decimal" dir="ltr" /></Field>
        <Field label={bi('مجمع إهلاك سابق (ضمن الأرصدة الافتتاحية)', 'Accumulated before go-live')} hint={bi('للأصول المشتراة قبل بدء النظام.', 'For assets bought before the system.')}><Input value={f.openingAccumulated} onChange={set('openingAccumulated')} inputMode="decimal" dir="ltr" /></Field>
        <Field label={bi('القسم / مركز التكلفة', 'Department')}><Input value={f.costCenter} onChange={set('costCenter')} /></Field>
      </div>
      <p className="mt-3 text-xs text-muted">{bi('الإهلاك بالقسط الثابت شهريًا من شهر التشغيل. التسجيل هنا لا يُنشئ قيد الشراء — قيّده بفاتورة مورد أو قيد يومية.', 'Straight-line, monthly from the in-service month. Registering does not book the purchase — use a bill or journal entry.')}</p>
    </Dialog>
  );
}

function Schedule({ id, onClose }: { id: string; onClose: () => void }) {
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['fixed-asset', id], queryFn: () => api.get<AssetDetail>(`/accounting/fixed-assets/${id}`) });
  return (
    <Dialog open onClose={onClose} wide title={q.data ? `${q.data.code} — ${q.data.nameAr}` : bi('الأصل', 'Asset')} footer={<Button variant="outline" onClick={onClose}>{bi('إغلاق', 'Close')}</Button>}>
      {q.isLoading ? <Spinner /> : !q.data ? <ErrorBox error={q.error} /> : (
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <thead><tr><Th>{bi('الشهر', 'Month')}</Th><Th className="text-end">{bi('الإهلاك', 'Charge')}</Th><Th className="text-end">{bi('المجمع', 'Accumulated')}</Th><Th className="text-end">{bi('القيمة الدفترية', 'Net book')}</Th></tr></thead>
            <tbody>{q.data.schedule.map((r) => <tr key={r.month}><Td className="num text-xs"><span dir="ltr">{r.month}</span></Td><Td className="text-end"><Amt v={r.amount} /></Td><Td className="text-end"><Amt v={r.accumulated} /></Td><Td className="text-end"><Amt v={r.netBook} /></Td></tr>)}</tbody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}

function Dispose({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const { bi } = useI18n();
  const [d, setD] = useState({ date: today(), proceeds: '0', proceedsAccountId: '' });
  const go = useMutation({
    mutationFn: () => api.post<{ entry: { number: string }; gainLoss: string }>(`/accounting/fixed-assets/${asset.id}/dispose`, { date: d.date, proceeds: d.proceeds || '0', proceedsAccountId: d.proceedsAccountId || null }),
    onSuccess: (r) => { toast.success(bi(`رُحِّل ${r.entry.number} — ${Number(r.gainLoss) >= 0 ? 'ربح' : 'خسارة'} ${r.gainLoss}`, `Posted ${r.entry.number} — result ${r.gainLoss}`)); onDone(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onClose={onClose} title={`${bi('استبعاد', 'Dispose')} ${asset.nameAr}`}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={go.isPending} disabled={Number(d.proceeds) > 0 && !d.proceedsAccountId} onClick={() => go.mutate()}>{bi('استبعاد وترحيل', 'Dispose & post')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('تاريخ الاستبعاد', 'Date')}><Input type="date" max={today()} value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
        <Field label={bi('مقابل البيع (ر.س)', 'Proceeds (SAR)')}><Input value={d.proceeds} onChange={(e) => setD({ ...d, proceeds: e.target.value })} inputMode="decimal" dir="ltr" /></Field>
        {Number(d.proceeds) > 0 && <Field label={bi('الحساب المستلم فيه *', 'Received into *')} className="sm:col-span-2"><AccountPicker value={d.proceedsAccountId} onChange={(id) => setD({ ...d, proceedsAccountId: id })} /></Field>}
      </div>
      <p className="mt-3 text-xs text-muted">{bi('يُحسب الإهلاك حتى شهر الاستبعاد ضمن القيد نفسه، والفرق عن القيمة الدفترية يُرحَّل ربحًا أو خسارة.', 'Depreciation through the disposal month is booked in the same entry; the difference to net book value is gain or loss.')}</p>
    </Dialog>
  );
}

function MonthRun({ kind }: { kind: 'depreciation' | 'eosb' }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [month, setMonth] = useState(lastMonth());
  const path = kind === 'depreciation' ? 'depreciation' : 'eosb';
  const pv = useQuery({ queryKey: [path, 'preview', month], queryFn: () => api.get<any>(`/accounting/${path}/preview${qs({ month })}`), enabled: /^\d{4}-\d{2}$/.test(month) });
  const run = useMutation({
    mutationFn: () => api.post<{ entry: { number: string } | null; total: string }>(`/accounting/${path}/run`, { month }),
    onSuccess: (r) => {
      toast.success(r.entry ? bi(`رُحِّل القيد ${r.entry.number} بمبلغ ${r.total}`, `Posted ${r.entry.number} for ${r.total}`) : bi('لا يوجد ما يُرحَّل لهذا الشهر', 'Nothing to post for this month'));
      void qc.invalidateQueries({ queryKey: [path] }); void qc.invalidateQueries({ queryKey: ['fixed-assets'] }); void qc.invalidateQueries({ queryKey: ['ledger-dashboard'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const { can } = useMe();
  const d = pv.data;
  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={bi('الشهر (شهر منتهٍ)', 'Month (ended)')}><Input type="month" max={lastMonth()} value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto" /></Field>
          {can('ledger.post') && <Button icon={<Play className="size-4" />} loading={run.isPending} disabled={!d || Number(kind === 'depreciation' ? d.total : d.toPost) === 0} onClick={() => run.mutate()}>{bi('ترحيل القيد', 'Post the entry')}</Button>}
        </div>
        <p className="mt-2 text-xs text-muted">{kind === 'depreciation'
          ? bi('يشمل الإهلاك المستحق حتى نهاية الشهر وما فات من أشهر لم تُرحَّل. لا يمكن ترحيل شهر لم ينتهِ أو مقفل.', 'Covers everything due through the month end, including skipped months. A month that has not ended, or is locked, cannot be posted.')
          : bi('الالتزام حسب المادة 84 (نصف شهر عن كل سنة من الخمس الأولى وشهر بعدها) على الأجر الأساسي + السكن + البدلات الثابتة، مقابل ما هو مسجل بالدفتر.', 'Art. 84 liability on basic + housing + fixed allowances, against what is already booked.')}</p>
      </Card>
      <ErrorBox error={pv.error} />
      {pv.isLoading ? <Spinner /> : !d ? null : kind === 'depreciation' ? (
        <Card padded={false} title={`${bi('إهلاك', 'Depreciation')} ${month} — ${d.total}`}>
          <Table>
            <thead><tr><Th>{bi('الأصل', 'Asset')}</Th><Th className="text-end">{bi('المبلغ', 'Amount')}</Th><Th className="text-end">{bi('المجمع بعد الترحيل', 'Accumulated after')}</Th></tr></thead>
            <tbody>
              {d.lines.map((l: any) => <tr key={l.assetId}><Td><span className="num text-xs text-gold-dark" dir="ltr">{l.code}</span> {l.nameAr}</Td><Td className="text-end"><Amt v={l.amount} /></Td><Td className="text-end"><Amt v={l.accumulatedAfter} /></Td></tr>)}
              {!d.lines.length && <tr><Td colSpan={3} className="py-6 text-center text-muted">{bi('لا يوجد إهلاك مستحق لهذا الشهر.', 'No depreciation due for this month.')}</Td></tr>}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Card padded={false} title={`${bi('مخصص نهاية الخدمة', 'EOSB provision')} ${month} — ${bi('يُرحَّل', 'to post')} ${d.toPost}`}>
          <Table>
            <thead><tr><Th>{bi('الموظف', 'Employee')}</Th><Th>{bi('التعيين', 'Hired')}</Th><Th className="text-end">{bi('السنوات', 'Years')}</Th><Th className="text-end">{bi('الأجر الشهري', 'Wage')}</Th><Th className="text-end">{bi('الالتزام', 'Liability')}</Th><Th className="text-end">{bi('المسجل', 'Booked')}</Th><Th className="text-end">{bi('الفرق', 'Delta')}</Th></tr></thead>
            <tbody>
              {d.rows.map((r: any) => (
                <tr key={r.employeeId}><Td><span className="num text-xs text-gold-dark" dir="ltr">{r.number}</span> {r.nameAr}{r.terminationDate && <Badge tone="gray">{bi('منتهي', 'left')}</Badge>}</Td><Td className="num text-xs">{date(r.hireDate)}</Td><Td className="num text-end text-xs">{r.years}</Td><Td className="text-end"><Amt v={r.wage} /></Td><Td className="text-end"><Amt v={r.target} /></Td><Td className="text-end"><Amt v={r.booked} /></Td><Td className="text-end"><Amt v={r.delta} strong /></Td></tr>
              ))}
              {Number(d.remainder) !== 0 && <tr className="bg-tint/40"><Td colSpan={6} className="text-xs">{bi('رصيد مرحّل بلا تحديد موظف (يُسوّى ضمن القيد)', 'Brought-forward balance without an employee (settled in the entry)')}</Td><Td className="text-end"><Amt v={d.remainder} strong /></Td></tr>}
              {!d.rows.length && <tr><Td colSpan={7} className="py-6 text-center text-muted">{bi('لا يوجد موظفون.', 'No employees.')}</Td></tr>}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

const Depreciation = () => <MonthRun kind="depreciation" />;
const Eosb = () => <MonthRun kind="eosb" />;
