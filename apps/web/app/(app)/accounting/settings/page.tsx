'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Unlock } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { ConfirmDialog, errMsg, ReasonDialog } from '../../quotes/_components/common';
import { InfoNote, RequirePerm } from '../../settings/_components/common';
import { AccountPicker } from '../_components/ledger-kit';

interface Settings {
  id: string; fiscalYearStartMonth: number; goLiveDate: string | null; lockedThrough: string | null; wipPolicy: 'wip' | 'expense'; employerGosiSaudiPct: string; employerGosiOtherPct: string;
  vatReturnFrequency: 'monthly' | 'quarterly'; defaultCashAccountId: string | null; defaultBankAccountId: string | null; methodAccounts: Record<string, string>; postedEntries: number;
  fiscalYear: { label: string; start: string; end: string };
}

const MONTHS: [string, string][] = [['يناير', 'January'], ['فبراير', 'February'], ['مارس', 'March'], ['أبريل', 'April'], ['مايو', 'May'], ['يونيو', 'June'], ['يوليو', 'July'], ['أغسطس', 'August'], ['سبتمبر', 'September'], ['أكتوبر', 'October'], ['نوفمبر', 'November'], ['ديسمبر', 'December']];
const METHODS: [string, string, string][] = [
  ['cash', 'نقدًا', 'Cash'], ['cheque', 'شيك', 'Cheque'], ['bank_transfer', 'تحويل بنكي', 'Bank transfer'], ['mada', 'مدى', 'mada'], ['credit_card', 'بطاقة ائتمان', 'Credit card'],
  ['apple_pay', 'Apple Pay', 'Apple Pay'], ['stc_pay', 'STC Pay', 'STC Pay'], ['payment_link', 'رابط دفع', 'Payment link'], ['card', 'بطاقة (سند)', 'Card (voucher)'], ['other', 'أخرى', 'Other'],
];

export default function LedgerSettingsPage() {
  return <RequirePerm perm="ledger.read" title="إعدادات الحسابات"><SettingsForm /></RequirePerm>;
}

function SettingsForm() {
  const { bi, locale } = useI18n();
  const { me, can } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ledger-settings'], queryFn: () => api.get<Settings>('/accounting/settings') });
  const [f, setF] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockDate, setLockDate] = useState('');
  const [locking, setLocking] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const s = f ?? q.data;
  const set = (p: Partial<Settings>) => setF({ ...s, ...p });
  const write = can('ledger.write');
  const close = can('ledger.close');
  const calendarFixed = s.postedEntries > 0;
  const isOwner = !!me?.user.roles.includes('owner');
  const refresh = () => { setF(null); void qc.invalidateQueries({ queryKey: ['ledger-settings'] }); void qc.invalidateQueries({ queryKey: ['ledger-accounts'] }); };

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/accounting/settings', {
        ...(close && !calendarFixed ? { fiscalYearStartMonth: s.fiscalYearStartMonth } : {}), wipPolicy: s.wipPolicy, employerGosiSaudiPct: s.employerGosiSaudiPct, employerGosiOtherPct: s.employerGosiOtherPct,
        vatReturnFrequency: s.vatReturnFrequency, defaultCashAccountId: s.defaultCashAccountId, defaultBankAccountId: s.defaultBankAccountId, methodAccounts: Object.fromEntries(Object.entries(s.methodAccounts).filter(([, v]) => v)),
      });
      toast.success(bi('حُفظت الإعدادات', 'Settings saved'));
      refresh();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const lock = async () => {
    setBusy(true);
    try { await api.post('/accounting/periods/lock', { through: lockDate }); toast.success(bi('أُقفلت الفترة', 'Period locked')); setLocking(false); refresh(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const lastMonthEnd = (() => { const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();

  return (
    <>
      <PageHeader title={bi('إعدادات الحسابات', 'Ledger settings')} subtitle={bi('السنة المالية وقفل الفترات وحسابات طرق الدفع التي يقرؤها الترحيل التلقائي.', 'Fiscal year, period lock and the payment-method accounts auto-posting reads.')}
        actions={write && <Button loading={busy} disabled={!f} onClick={() => void save()}>{bi('حفظ الإعدادات', 'Save settings')}</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={bi('قفل الفترات', 'Period lock')}>
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2">{s.lockedThrough ? <><Lock className="size-4 text-danger" />{bi('الدفاتر مقفلة حتى', 'Books locked through')} <b className="num">{date(s.lockedThrough)}</b></> : <><Unlock className="size-4 text-ok" />{bi('لا توجد فترة مقفلة', 'No period is locked')}</>}</p>
            <p className="text-xs text-muted">{bi('لا يمكن ترحيل أو عكس أي قيد بتاريخ داخل الفترة المقفلة. يقفلها المالك أو المدير العام، ولا يعيد فتحها إلا المالك بسبب مسجّل.', 'No entry dated inside a locked period can be posted or reversed into. The owner or GM locks; only the owner re-opens, with a recorded reason.')}</p>
            {close && <div className="flex flex-wrap items-end gap-2">
              <Field label={bi('قفل حتى تاريخ', 'Lock through')}><Input type="date" max={today()} value={lockDate} onChange={(e) => setLockDate(e.target.value)} className="w-auto" /></Field>
              <Button variant="outline" size="sm" onClick={() => setLockDate(lastMonthEnd)}>{bi('نهاية الشهر الماضي', 'Last month-end')}</Button>
              <Button icon={<Lock className="size-4" />} disabled={!lockDate} onClick={() => setLocking(true)}>{bi('قفل', 'Lock')}</Button>
              {isOwner && s.lockedThrough && <Button variant="outline" icon={<Unlock className="size-4" />} onClick={() => setUnlocking(true)}>{bi('إعادة فتح', 'Re-open')}</Button>}
            </div>}
          </div>
        </Card>
        <Card title={bi('التقويم المالي', 'Fiscal calendar')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={bi('بداية السنة المالية', 'Fiscal year starts')} hint={calendarFixed ? bi('لا يتغير بعد ترحيل قيود', 'Fixed once entries are posted') : undefined}>
              <Select value={s.fiscalYearStartMonth} disabled={!close || calendarFixed} onChange={(e) => set({ fiscalYearStartMonth: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{locale === 'en' ? m[1] : m[0]}</option>)}</Select>
            </Field>
            <Field label={bi('تاريخ بدء النظام', 'Go-live date')} hint={bi('يُحدَّد من «الأرصدة الافتتاحية».', 'Set from “Opening balances”.')}><Input value={s.goLiveDate ?? '—'} disabled /></Field>
            <div className="text-sm sm:col-span-2"><Badge tone="gray">{bi('السنة الحالية', 'Current year')} {s.fiscalYear.label} · {date(s.fiscalYear.start)} → {date(s.fiscalYear.end)}</Badge></div>
          </div>
        </Card>
        <Card title={bi('طرق الدفع والحسابات الافتراضية', 'Payment methods and default accounts')} className="lg:col-span-2" padded={false}>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label={bi('حساب الصندوق الافتراضي', 'Default cash account')}><AccountPicker value={s.defaultCashAccountId ?? ''} disabled={!write} onChange={(id) => set({ defaultCashAccountId: id })} /></Field>
            <Field label={bi('حساب البنك الافتراضي', 'Default bank account')}><AccountPicker value={s.defaultBankAccountId ?? ''} disabled={!write} onChange={(id) => set({ defaultBankAccountId: id })} /></Field>
          </div>
          <Table>
            <thead><tr><Th>{bi('طريقة الدفع / القبض', 'Payment method')}</Th><Th>{bi('الحساب الذي يستلم المبلغ', 'Account that receives the money')}</Th></tr></thead>
            <tbody>
              {METHODS.map(([key, ar, en]) => (
                <tr key={key}><Td className="font-bold">{locale === 'en' ? en : ar}</Td><Td><AccountPicker value={s.methodAccounts[key] ?? ''} disabled={!write} onChange={(id) => set({ methodAccounts: { ...s.methodAccounts, [key]: id } })} /></Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title={bi('خيارات محاسبية', 'Accounting options')} className="lg:col-span-2">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label={bi('مواد المشاريع', 'Materials issued to projects')} hint={bi('«أعمال تحت التنفيذ» تُحمَّل على التكلفة عند الفاتورة الختامية.', '“Work in progress” moves to cost at the final invoice.')}>
              <Select value={s.wipPolicy} disabled={!write} onChange={(e) => set({ wipPolicy: e.target.value as 'wip' | 'expense' })}><option value="wip">{bi('أعمال تحت التنفيذ لكل مشروع', 'Work in progress per project')}</option><option value="expense">{bi('تُحمَّل على التكلفة فورًا', 'Expense at issue')}</option></Select>
            </Field>
            <Field label={bi('دورة إقرار الضريبة', 'VAT return cycle')}><Select value={s.vatReturnFrequency} disabled={!write} onChange={(e) => set({ vatReturnFrequency: e.target.value as 'monthly' | 'quarterly' })}><option value="quarterly">{bi('ربع سنوي', 'Quarterly')}</option><option value="monthly">{bi('شهري', 'Monthly')}</option></Select></Field>
            <Field label={bi('تأمينات صاحب العمل — سعودي %', 'Employer GOSI — Saudi %')} hint={bi('أكّدها مع المحاسب', 'Confirm with the accountant')}><Input dir="ltr" inputMode="decimal" disabled={!write} value={s.employerGosiSaudiPct} onChange={(e) => set({ employerGosiSaudiPct: e.target.value })} /></Field>
            <Field label={bi('تأمينات صاحب العمل — غير سعودي %', 'Employer GOSI — other %')}><Input dir="ltr" inputMode="decimal" disabled={!write} value={s.employerGosiOtherPct} onChange={(e) => set({ employerGosiOtherPct: e.target.value })} /></Field>
          </div>
          <div className="mt-3"><InfoNote tone="amber">{bi('هذه الخيارات يقرؤها الترحيل التلقائي في المرحلة التالية؛ راجعها مع المحاسب القانوني قبل تشغيله.', 'These options are read by automatic posting in the next phase; review them with the external accountant before it is switched on.')}</InfoNote></div>
        </Card>
      </div>
      <ConfirmDialog open={locking} title={bi('قفل الفترة', 'Lock the period')} confirmLabel={bi('قفل', 'Lock')} loading={busy} message={bi(`ستُقفل الدفاتر حتى ${lockDate}. لن يُرحَّل أي قيد بتاريخ سابق أو مساوٍ لها.`, `Books will be locked through ${lockDate}. Nothing dated on or before it can be posted.`)} onClose={() => setLocking(false)} onConfirm={() => void lock()} />
      <ReasonDialog open={unlocking} required danger title={bi('إعادة فتح الفترات', 'Re-open periods')} confirmLabel={bi('إعادة فتح', 'Re-open')} hint={bi('تُفتح كل الفترات المقفلة. يُسجَّل السبب في سجل التدقيق.', 'All locked periods are re-opened. The reason goes to the audit log.')} onClose={() => setUnlocking(false)}
        onConfirm={(reason) => { api.post('/accounting/periods/unlock', { through: null, reason }).then(() => { toast.success(bi('أُعيد فتح الفترات', 'Periods re-opened')); setUnlocking(false); refresh(); }).catch((e) => toast.error(errMsg(e))); }} />
    </>
  );
}
