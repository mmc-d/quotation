'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileDown, FileSpreadsheet, Scale } from 'lucide-react';
import { api, openFile, qs } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Th, clsx } from '@/components/ui';
import { RequirePerm } from '../../settings/_components/common';
import { AccountPicker, AnyPartyPicker, Amt, accountName, useAccounts, type PickedAnyParty } from '../_components/ledger-kit';

type Tab = 'trial' | 'ledger' | 'journal' | 'income' | 'balance' | 'cash' | 'equity' | 'aging' | 'zakat';
const PATH: Record<Tab, string> = { trial: 'trial-balance', ledger: 'ledger', journal: 'journal', income: 'income-statement', balance: 'balance-sheet', cash: 'cash-flow', equity: 'equity-changes', aging: 'aging', zakat: 'zakat' };
const AS_OF: Tab[] = ['balance', 'aging', 'zakat'];

export default function ReportsPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="ledger.read" title={bi('التقارير المالية', 'Financial reports')}><Suspense fallback={<Spinner />}><Reports /></Suspense></RequirePerm>;
}

function Reports() {
  const { bi } = useI18n();
  const sp = useSearchParams();
  const settings = useQuery({ queryKey: ['ledger-settings'], queryFn: () => api.get<{ fiscalYear: { start: string; end: string; label: string } }>('/accounting/settings') });
  const initial = (sp.get('tab') as Tab | null) ?? 'trial';
  const [tab, setTab] = useState<Tab>(PATH[initial] ? initial : 'trial');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today());
  const [asOf, setAsOf] = useState(today());
  const [account, setAccount] = useState(sp.get('account') ?? '');
  const [party, setParty] = useState<PickedAnyParty | null>(null);
  const [by, setBy] = useState('none');
  const [level, setLevel] = useState('');
  const [withZero, setWithZero] = useState(false);
  const [side, setSide] = useState<'ar' | 'ap'>('ar');
  const [rate, setRate] = useState<'gregorian' | 'hijri'>('gregorian');
  const [adjustments, setAdjustments] = useState('0');
  const fromEff = from || settings.data?.fiscalYear.start || '';

  const params: Record<string, unknown> = tab === 'aging' ? { asOf, side } : tab === 'zakat' ? { asOf, rate, adjustments } : tab === 'balance' ? { asOf }
    : { from: fromEff || undefined, to,
      ...(tab === 'ledger' ? { account, party: party?.id } : {}), ...(tab === 'trial' ? { level: level || undefined, withZero: withZero || undefined } : {}), ...(tab === 'income' ? { by } : {}) };
  const ready = settings.isSuccess && (tab !== 'ledger' || !!account);
  const rep = useQuery({ queryKey: ['ledger-report', tab, params], queryFn: () => api.get<any>(`/accounting/reports/${PATH[tab]}${qs(params)}`), enabled: ready });
  const exportAs = (format: 'pdf' | 'xlsx') => openFile(`/accounting/reports/${PATH[tab]}${qs({ ...params, format })}`);
  const open = (t: Tab, acc?: string) => { setTab(t); if (acc) setAccount(acc); };

  return (
    <>
      <PageHeader title={bi('التقارير المالية', 'Financial reports')} subtitle={bi('تُحسب من القيود المرحّلة فقط. اضغط على أي حساب للانتقال إلى كشف حسابه ثم إلى القيد.', 'Computed from posted entries only. Click an account for its statement, then an entry.')}
        actions={<>
          <Button variant="outline" icon={<FileDown className="size-4" />} disabled={!ready} onClick={() => exportAs('pdf')}>PDF</Button>
          <Button variant="outline" icon={<FileSpreadsheet className="size-4" />} disabled={!ready} onClick={() => exportAs('xlsx')}>Excel</Button>
        </>} />
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'trial', label: bi('ميزان المراجعة', 'Trial balance') },
        { value: 'ledger', label: bi('كشف حساب (الأستاذ)', 'Account statement') },
        { value: 'journal', label: bi('دفتر اليومية', 'Journal book') },
        { value: 'income', label: bi('قائمة الدخل', 'Income statement') },
        { value: 'balance', label: bi('المركز المالي', 'Balance sheet') },
        { value: 'cash', label: bi('التدفقات النقدية', 'Cash flow') },
        { value: 'equity', label: bi('حقوق الملكية', 'Equity changes') },
        { value: 'aging', label: bi('أعمار الذمم', 'Aging') },
        { value: 'zakat', label: bi('الوعاء الزكوي', 'Zakat base') },
      ]} />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {AS_OF.includes(tab) ? (
            <Field label={bi('كما في تاريخ', 'As of')}><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-auto" /></Field>
          ) : <>
            <Field label={bi('من', 'From')}><Input type="date" value={fromEff} onChange={(e) => setFrom(e.target.value)} className="w-auto" /></Field>
            <Field label={bi('إلى', 'To')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" /></Field>
          </>}
          {tab === 'ledger' && <>
            <Field label={bi('الحساب *', 'Account *')} className="min-w-[18rem]"><AccountPicker postable={false} value={account} onChange={(id) => setAccount(id)} /></Field>
            <Field label={bi('عميل / مورد (اختياري)', 'Party (optional)')} className="min-w-[14rem]"><AnyPartyPicker value={party} onChange={setParty} /></Field>
          </>}
          {tab === 'trial' && <>
            <Field label={bi('المستوى', 'Level')}><Select value={level} onChange={(e) => setLevel(e.target.value)}><option value="">{bi('كل المستويات', 'All levels')}</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></Select></Field>
            <Checkbox label={bi('إظهار الحسابات الصفرية', 'Show zero accounts')} checked={withZero} onChange={setWithZero} />
          </>}
          {tab === 'aging' && <Field label={bi('النوع', 'Side')}><Select value={side} onChange={(e) => setSide(e.target.value as 'ar' | 'ap')}><option value="ar">{bi('العملاء (مدينون)', 'Receivables')}</option><option value="ap">{bi('الموردون (دائنون)', 'Payables')}</option></Select></Field>}
          {tab === 'zakat' && <>
            <Field label={bi('نسبة الزكاة', 'Rate')}><Select value={rate} onChange={(e) => setRate(e.target.value as 'gregorian' | 'hijri')}><option value="gregorian">{bi('سنة ميلادية 2.5775٪', 'Gregorian year 2.5775%')}</option><option value="hijri">{bi('سنة هجرية 2.5٪', 'Hijri year 2.5%')}</option></Select></Field>
            <Field label={bi('تسويات الربح للزكاة (±)', 'Profit adjustments (±)')}><Input value={adjustments} onChange={(e) => setAdjustments(e.target.value)} dir="ltr" className="w-32" inputMode="decimal" /></Field>
          </>}
          {tab === 'income' && <Field label={bi('عرض الأعمدة حسب', 'Columns by')}><Select value={by} onChange={(e) => setBy(e.target.value)}><option value="none">{bi('الإجمالي', 'Total only')}</option><option value="month">{bi('الشهر', 'Month')}</option><option value="project">{bi('المشروع', 'Project')}</option><option value="department">{bi('القسم / مركز التكلفة', 'Department')}</option></Select></Field>}
        </div>
      </Card>
      <ErrorBox error={rep.error} />
      {!ready ? (tab === 'ledger' ? <Card><Empty icon={<Scale className="size-8" />} title={bi('اختر حسابًا لعرض كشف حسابه', 'Choose an account to see its statement')} /></Card> : <Spinner />)
        : rep.isLoading ? <Spinner /> : !rep.data ? null : (
          tab === 'trial' ? <Trial d={rep.data} onAccount={(id) => open('ledger', id)} />
          : tab === 'ledger' ? <LedgerView d={rep.data} />
          : tab === 'journal' ? <JournalBook d={rep.data} />
          : tab === 'income' ? <Income d={rep.data} onAccount={(id) => open('ledger', id)} />
          : tab === 'cash' ? <CashFlow d={rep.data} />
          : tab === 'equity' ? <EquityView d={rep.data} />
          : tab === 'aging' ? <AgingView d={rep.data} />
          : tab === 'zakat' ? <ZakatView d={rep.data} />
          : <Balance d={rep.data} onAccount={(id) => open('ledger', id)} />
        )}
    </>
  );
}

function Trial({ d, onAccount }: { d: any; onAccount: (id: string) => void }) {
  const { bi, locale } = useI18n();
  if (!d.rows.length) return <Card><Empty title={bi('لا توجد حركة في هذه الفترة', 'No movement in this period')} /></Card>;
  return (
    <Card padded={false}>
      {!d.balanced && <div className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-danger">{bi('تنبيه: ميزان المراجعة غير متوازن.', 'Warning: the trial balance does not balance.')}</div>}
      <Table>
        <thead>
          <tr>
            <Th>{bi('الرمز', 'Code')}</Th><Th>{bi('اسم الحساب', 'Account')}</Th>
            {[bi('افتتاحي', 'Opening'), bi('حركة الفترة', 'Movement'), bi('ختامي', 'Closing')].map((t) => <th key={t} colSpan={2} className="border-b border-line bg-tint/60 px-3 py-2 text-center text-xs font-extrabold text-gold-dark">{t}</th>)}
          </tr>
          <tr><Th /><Th /><Th className="text-end">{bi('مدين', 'Dr')}</Th><Th className="text-end">{bi('دائن', 'Cr')}</Th><Th className="text-end">{bi('مدين', 'Dr')}</Th><Th className="text-end">{bi('دائن', 'Cr')}</Th><Th className="text-end">{bi('مدين', 'Dr')}</Th><Th className="text-end">{bi('دائن', 'Cr')}</Th></tr>
        </thead>
        <tbody>
          {d.rows.map((r: any) => (
            <tr key={r.accountId} className={clsx('hover:bg-tint/50', r.isGroup && 'bg-tint/30 font-extrabold')}>
              <Td className="num text-gold-dark" ><span dir="ltr">{r.code}</span></Td>
              <Td><button onClick={() => onAccount(r.accountId)} className="text-start hover:underline" style={{ paddingInlineStart: `${(r.depth - 1) * 14}px` }}>{locale === 'en' ? r.nameEn || r.nameAr : r.nameAr}</button></Td>
              <Td className="text-end"><Amt v={r.openingDebit} /></Td><Td className="text-end"><Amt v={r.openingCredit} /></Td>
              <Td className="text-end"><Amt v={r.debit} /></Td><Td className="text-end"><Amt v={r.credit} /></Td>
              <Td className="text-end"><Amt v={r.closingDebit} /></Td><Td className="text-end"><Amt v={r.closingCredit} /></Td>
            </tr>
          ))}
          <tr className="bg-primary text-white">
            <Td /><Td className="font-extrabold">{bi('الإجمالي', 'Total')}</Td>
            {['openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit'].map((k) => <Td key={k} className="text-end font-extrabold"><Amt v={d.totals[k]} strong className="text-white" /></Td>)}
          </tr>
        </tbody>
      </Table>
    </Card>
  );
}

function LedgerView({ d }: { d: any }) {
  const { bi } = useI18n();
  return (
    <Card padded={false} title={<span><span className="num" dir="ltr">{d.account.code}</span> — {d.account.nameAr}</span>}>
      <Table>
        <thead><tr><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('القيد', 'Entry')}</Th>{d.rows.some((r: any) => r.account) && <Th>{bi('الحساب', 'Account')}</Th>}<Th>{bi('البيان', 'Description')}</Th><Th>{bi('العميل / المورد', 'Party')}</Th><Th>{bi('المشروع', 'Project')}</Th><Th className="text-end">{bi('مدين', 'Debit')}</Th><Th className="text-end">{bi('دائن', 'Credit')}</Th><Th className="text-end">{bi('الرصيد', 'Balance')}</Th></tr></thead>
        <tbody>
          <tr className="bg-tint/40 font-bold"><Td colSpan={d.rows.some((r: any) => r.account) ? 8 : 7}>{bi('رصيد افتتاحي', 'Opening balance')}</Td><Td className="text-end"><Amt v={d.opening} strong /></Td></tr>
          {d.rows.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-tint/50">
              <Td className="num text-xs">{date(r.date)}</Td>
              <Td><Link href={`/accounting/journal/${r.entryId}`} className="num font-bold text-primary hover:underline" dir="ltr">{r.number}</Link></Td>
              {d.rows.some((x: any) => x.account) && <Td className="text-xs">{r.account}</Td>}
              <Td className="max-w-[20rem] truncate text-xs">{r.memo}</Td>
              <Td className="text-xs">{r.party}</Td>
              <Td className="num text-xs"><span dir="ltr">{r.project}</span></Td>
              <Td className="text-end"><Amt v={r.debit} /></Td><Td className="text-end"><Amt v={r.credit} /></Td><Td className="text-end"><Amt v={r.balance} /></Td>
            </tr>
          ))}
          <tr className="bg-primary text-white"><Td colSpan={d.rows.some((r: any) => r.account) ? 6 : 5} className="font-extrabold">{bi('الإجمالي والرصيد الختامي', 'Totals and closing balance')}</Td><Td className="text-end"><Amt v={d.totalDebit} strong className="text-white" /></Td><Td className="text-end"><Amt v={d.totalCredit} strong className="text-white" /></Td><Td className="text-end"><Amt v={d.closing} strong className="text-white" /></Td></tr>
        </tbody>
      </Table>
    </Card>
  );
}

function JournalBook({ d }: { d: any }) {
  const { bi } = useI18n();
  if (!d.entries.length) return <Card><Empty title={bi('لا توجد قيود مرحّلة في هذه الفترة', 'No posted entries in this period')} /></Card>;
  return (
    <Card padded={false}>
      <Table>
        <thead><tr><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('القيد', 'Entry')}</Th><Th>{bi('الحساب / البيان', 'Account / description')}</Th><Th className="text-end">{bi('مدين', 'Debit')}</Th><Th className="text-end">{bi('دائن', 'Credit')}</Th></tr></thead>
        <tbody>
          {d.entries.map((e: any) => (
            <FragmentRows key={e.id} e={e} />
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function FragmentRows({ e }: { e: any }) {
  return (
    <>
      <tr className="bg-tint/40 font-bold">
        <Td className="num text-xs">{date(e.date)}</Td>
        <Td><Link href={`/accounting/journal/${e.id}`} className="num text-primary hover:underline" dir="ltr">{e.number}</Link></Td>
        <Td className="text-xs">{e.memo}{e.sourceRef && <span className="num ms-2 text-gold-dark" dir="ltr">{e.sourceRef}</span>}</Td><Td /><Td />
      </tr>
      {e.lines.map((l: any) => (
        <tr key={l.lineNo}>
          <Td /><Td className="num text-xs text-muted" ><span dir="ltr">{l.code}</span></Td>
          <Td className="text-xs">{l.name}{l.party && <span className="text-muted"> — {l.party}</span>}{l.memo && <span className="text-muted"> ({l.memo})</span>}</Td>
          <Td className="text-end"><Amt v={l.debit} /></Td><Td className="text-end"><Amt v={l.credit} /></Td>
        </tr>
      ))}
    </>
  );
}

function Income({ d, onAccount }: { d: any; onAccount: (id: string) => void }) {
  const { bi, locale } = useI18n();
  const cols: string[] = d.columns;
  const head = (
    <tr><Th>{bi('الرمز', 'Code')}</Th><Th>{bi('البند', 'Item')}</Th>{cols.map((c) => <Th key={c} className="text-end">{c}</Th>)}<Th className="text-end">{bi('الإجمالي', 'Total')}</Th></tr>
  );
  const sum = (label: string, o: { values: Record<string, string>; total: string }, tone: 'sub' | 'big' | 'net') => (
    <tr className={clsx(tone === 'net' ? 'bg-primary text-white' : tone === 'big' ? 'bg-tint font-extrabold' : 'border-t border-ink/30 font-extrabold')}>
      <Td /><Td className="font-extrabold">{label}</Td>{cols.map((c) => <Td key={c} className="text-end"><Amt v={o.values[c]} strong className={tone === 'net' ? 'text-white' : undefined} /></Td>)}<Td className="text-end"><Amt v={o.total} strong className={tone === 'net' ? 'text-white' : undefined} /></Td>
    </tr>
  );
  const section = (key: string) => {
    const s = d.sections.find((x: any) => x.key === key);
    return (
      <>
        <tr><Td colSpan={cols.length + 3} className="border-b-2 border-gold bg-white pt-4 font-extrabold text-primary">{locale === 'en' ? s.en : s.ar}</Td></tr>
        {s.rows.map((r: any) => (
          <tr key={r.accountId} className="hover:bg-tint/50"><Td className="num text-gold-dark"><span dir="ltr">{r.code}</span></Td><Td><button onClick={() => onAccount(r.accountId)} className="ps-3 hover:underline">{locale === 'en' ? r.nameEn || r.nameAr : r.nameAr}</button></Td>{cols.map((c) => <Td key={c} className="text-end"><Amt v={r.values[c]} /></Td>)}<Td className="text-end"><Amt v={r.total} /></Td></tr>
        ))}
        {sum(`${bi('إجمالي', 'Total')} ${locale === 'en' ? s.en : s.ar}`, s, 'sub')}
      </>
    );
  };
  return (
    <Card padded={false}>
      <Table>
        <thead>{head}</thead>
        <tbody>
          {section('revenue')}{section('cost_of_sales')}{sum(bi('مجمل الربح', 'Gross profit'), d.grossProfit, 'big')}
          {section('operating_expenses')}{sum(bi('الربح التشغيلي', 'Operating profit'), d.operatingProfit, 'big')}
          {section('other_income')}{sum(bi('صافي الربح (الخسارة)', 'Net profit (loss)'), d.netProfit, 'net')}
        </tbody>
      </Table>
    </Card>
  );
}

function Balance({ d, onAccount }: { d: any; onAccount: (id: string) => void }) {
  const { bi, locale } = useI18n();
  const block = (title: string, s: any, extra?: { label: string; v: string }[]) => (
    <Card padded={false} title={title}>
      <Table>
        <tbody>
          {s.rows.map((r: any) => (
            <tr key={r.accountId} className={clsx(r.isGroup && 'bg-tint/30 font-extrabold')}>
              <Td className="num w-16 text-gold-dark"><span dir="ltr">{r.code}</span></Td>
              <Td><button onClick={() => onAccount(r.accountId)} className="text-start hover:underline" style={{ paddingInlineStart: `${(r.depth - 1) * 14}px` }}>{locale === 'en' ? r.nameEn || r.nameAr : r.nameAr}</button></Td>
              <Td className="text-end"><Amt v={r.amount} /></Td>
            </tr>
          ))}
          {extra?.map((x) => <tr key={x.label}><Td /><Td className="ps-6 text-xs">{x.label}</Td><Td className="text-end"><Amt v={x.v} /></Td></tr>)}
        </tbody>
      </Table>
    </Card>
  );
  const equityTotal = (Number(d.equity.total) + Number(d.priorYearsProfit) + Number(d.currentYearProfit)).toFixed(2);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid content-start gap-4">
        {block(bi('الأصول', 'Assets'), d.assets)}
        <div className="flex items-center justify-between rounded-[var(--radius-card)] bg-primary px-4 py-3 font-extrabold text-white"><span>{bi('إجمالي الأصول', 'Total assets')}</span><Amt v={d.assets.total} strong className="text-white" /></div>
      </div>
      <div className="grid content-start gap-4">
        {block(bi('الخصوم', 'Liabilities'), d.liabilities)}
        <div className="flex items-center justify-between rounded-lg bg-tint px-4 py-2 font-extrabold"><span>{bi('إجمالي الخصوم', 'Total liabilities')}</span><Amt v={d.liabilities.total} strong /></div>
        {block(bi('حقوق الملكية', 'Equity'), d.equity, [
          ...(Number(d.priorYearsProfit) !== 0 ? [{ label: bi('أرباح (خسائر) سنوات سابقة غير مقفلة', 'Earlier years’ profit (not yet closed)'), v: d.priorYearsProfit }] : []),
          { label: `${bi('صافي ربح (خسارة) العام الحالي', 'Current-year net profit')} (${d.fiscalYear.label})`, v: d.currentYearProfit },
        ])}
        <div className="flex items-center justify-between rounded-lg bg-tint px-4 py-2 font-extrabold"><span>{bi('إجمالي حقوق الملكية', 'Total equity')}</span><Amt v={equityTotal} strong /></div>
        <div className={clsx('flex items-center justify-between rounded-[var(--radius-card)] px-4 py-3 font-extrabold text-white', d.balanced ? 'bg-primary' : 'bg-danger')}><span>{bi('إجمالي الخصوم وحقوق الملكية', 'Total liabilities and equity')}{!d.balanced && ` — ${bi('غير متوازنة!', 'out of balance!')}`}</span><Amt v={d.liabilitiesAndEquity} strong className="text-white" /></div>
      </div>
      <Badge tone="gray">{bi('السنة المالية', 'Fiscal year')} {d.fiscalYear.label} · {date(d.fiscalYear.start)} → {date(d.fiscalYear.end)}</Badge>
    </div>
  );
}

function CashFlow({ d }: { d: any }) {
  const { bi } = useI18n();
  const Block = ({ title, rows, total, totalLabel, head }: { title: string; rows: { code: string; nameAr: string; amount: string }[]; total: string; totalLabel: string; head?: React.ReactNode }) => (
    <>
      <tr className="bg-tint/60"><Td colSpan={2} className="font-extrabold text-gold-dark">{title}</Td></tr>
      {head}
      {rows.map((r) => <tr key={r.code} className="hover:bg-tint/50"><Td className="ps-6 text-sm"><span className="num text-xs text-gold-dark" dir="ltr">{r.code}</span> {r.nameAr}</Td><Td className="text-end"><Amt v={r.amount} /></Td></tr>)}
      <tr className="font-extrabold"><Td>{totalLabel}</Td><Td className="text-end"><Amt v={total} strong /></Td></tr>
    </>
  );
  return (
    <Card padded={false}>
      {!d.tiesToLedger && <div className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-danger">{bi('تنبيه: الفرق عن حركة النقد', 'Warning: difference to the change in cash')} {d.difference}</div>}
      <Table>
        <thead><tr><Th>{bi('البند', 'Item')}</Th><Th className="text-end">{bi('المبلغ (ر.س)', 'Amount (SAR)')}</Th></tr></thead>
        <tbody>
          <Block title={bi('الأنشطة التشغيلية', 'Operating activities')} total={d.operating.total} totalLabel={bi('صافي النقد من الأنشطة التشغيلية', 'Net cash from operating activities')}
            rows={[...d.operating.adjustments, ...d.operating.workingCapital]}
            head={<tr><Td className="ps-3 font-bold">{bi('صافي ربح (خسارة) الفترة', 'Net profit (loss)')}</Td><Td className="text-end"><Amt v={d.operating.profit} strong /></Td></tr>} />
          <Block title={bi('الأنشطة الاستثمارية', 'Investing activities')} rows={d.investing.rows} total={d.investing.total} totalLabel={bi('صافي النقد من الأنشطة الاستثمارية', 'Net cash from investing activities')} />
          <Block title={bi('الأنشطة التمويلية', 'Financing activities')} rows={d.financing.rows} total={d.financing.total} totalLabel={bi('صافي النقد من الأنشطة التمويلية', 'Net cash from financing activities')} />
          <tr className="bg-tint/60 font-extrabold"><Td>{bi('صافي التغير في النقد وما يعادله', 'Net change in cash')}</Td><Td className="text-end"><Amt v={d.netChange} strong /></Td></tr>
          <tr><Td>{bi('النقد وما يعادله في بداية الفترة', 'Cash at the start')}</Td><Td className="text-end"><Amt v={d.openingCash} /></Td></tr>
          <tr className="bg-primary text-white"><Td className="font-extrabold">{bi('النقد وما يعادله في نهاية الفترة', 'Cash at the end')}</Td><Td className="text-end"><Amt v={d.closingCash} strong className="text-white" /></Td></tr>
        </tbody>
      </Table>
    </Card>
  );
}

function EquityView({ d }: { d: any }) {
  const { bi } = useI18n();
  return (
    <Card padded={false}>
      <Table>
        <thead><tr><Th>{bi('البند', 'Item')}</Th>{d.columns.map((c: any) => <Th key={c.key} className="text-end">{c.nameAr}</Th>)}<Th className="text-end">{bi('الإجمالي', 'Total')}</Th></tr></thead>
        <tbody>
          {d.rows.map((r: any) => (
            <tr key={r.key} className={r.key === 'closing' ? 'bg-primary text-white' : r.key === 'opening' ? 'bg-tint/50 font-bold' : ''}>
              <Td className={r.key === 'closing' ? 'font-extrabold' : ''}>{r.ar}</Td>
              {d.columns.map((c: any) => <Td key={c.key} className="text-end"><Amt v={r.values[c.key]} className={r.key === 'closing' ? 'text-white' : ''} /></Td>)}
              <Td className="text-end"><Amt v={r.total} strong className={r.key === 'closing' ? 'text-white' : ''} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function AgingView({ d }: { d: any }) {
  const { bi } = useI18n();
  if (!d.items.length) return <Card><Empty title={bi('لا توجد أرصدة مفتوحة', 'No open balances')} /></Card>;
  return (
    <Card padded={false}>
      <Table>
        <thead><tr><Th>{d.side === 'ar' ? bi('العميل', 'Customer') : bi('المورد', 'Supplier')}</Th>{d.buckets.map((b: any) => <Th key={b.key} className="text-end">{b.label} {bi('يوم', 'days')}</Th>)}<Th className="text-end">{bi('دفعات غير مخصصة', 'Unapplied')}</Th><Th className="text-end">{bi('الإجمالي', 'Total')}</Th></tr></thead>
        <tbody>
          {d.items.map((r: any) => (
            <tr key={r.partyId ?? 'none'} className="hover:bg-tint/50"><Td className="font-bold">{r.name}</Td>{r.buckets.map((v: string, i: number) => <Td key={i} className="text-end"><Amt v={v} /></Td>)}<Td className="text-end"><Amt v={r.unapplied} /></Td><Td className="text-end"><Amt v={r.total} strong /></Td></tr>
          ))}
          <tr className="bg-primary text-white"><Td className="font-extrabold">{bi('الإجمالي', 'Total')}</Td>{d.totals.buckets.map((v: string, i: number) => <Td key={i} className="text-end"><Amt v={v} strong className="text-white" /></Td>)}<Td className="text-end"><Amt v={d.totals.unapplied} strong className="text-white" /></Td><Td className="text-end"><Amt v={d.totals.total} strong className="text-white" /></Td></tr>
        </tbody>
      </Table>
      <p className="px-4 py-2 text-xs text-muted">{bi('الأعمار حسب تاريخ المستند، وتُسدَّد الأقدم أولًا من حركة الدفتر؛ تطابق رصيد الحساب في الدفتر.', 'Aged by document date, settlements applied oldest first from the ledger; the total ties to the account balance.')}</p>
    </Card>
  );
}

function ZakatView({ d }: { d: any }) {
  const { bi } = useI18n();
  const Group = ({ title, rows, total }: { title: string; rows: { label: string; amount: string }[]; total: string }) => (
    <>
      <tr className="bg-tint/60"><Td colSpan={2} className="font-extrabold text-gold-dark">{title}</Td></tr>
      {rows.map((r) => <tr key={r.label}><Td className="ps-6">{r.label}</Td><Td className="text-end"><Amt v={r.amount} /></Td></tr>)}
      <tr className="font-extrabold"><Td>{bi('الإجمالي', 'Subtotal')}</Td><Td className="text-end"><Amt v={total} strong /></Td></tr>
    </>
  );
  return (
    <Card padded={false} title={`${bi('السنة المالية', 'Fiscal year')} ${d.fiscalYear.label}`}>
      <Table>
        <thead><tr><Th>{bi('البند', 'Item')}</Th><Th className="text-end">{bi('المبلغ (ر.س)', 'Amount (SAR)')}</Th></tr></thead>
        <tbody>
          <Group title={bi('الإضافات', 'Additions')} rows={d.additions} total={d.totalAdditions} />
          <Group title={bi('الحسميات', 'Deductions')} rows={d.deductions} total={d.totalDeductions} />
          <tr className="bg-tint/60 font-extrabold"><Td>{bi('الوعاء الزكوي', 'Zakat base')}</Td><Td className="text-end"><Amt v={d.base} strong /></Td></tr>
          <tr><Td>{bi('صافي الربح المعدّل', 'Adjusted net profit')}</Td><Td className="text-end"><Amt v={d.adjustedProfit} /></Td></tr>
          <tr><Td>{bi('الوعاء الخاضع (الأكبر منهما)', 'Chargeable (the greater)')}</Td><Td className="text-end"><Amt v={d.chargeable} strong /></Td></tr>
          <tr className="bg-primary text-white"><Td className="font-extrabold">{bi('الزكاة المقدّرة', 'Estimated Zakat')} ({(d.rate * 100).toFixed(4).replace(/0+$/, '')}٪)</Td><Td className="text-end"><Amt v={d.zakat} strong className="text-white" /></Td></tr>
        </tbody>
      </Table>
      <p className="px-4 py-2 text-xs text-muted">{d.note}</p>
    </Card>
  );
}
