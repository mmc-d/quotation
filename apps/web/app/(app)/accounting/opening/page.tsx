'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { toHalalas } from '@mmc/domain';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Card, ErrorBox, Field, Input, Money, PageHeader, Spinner, clsx } from '@/components/ui';
import { errMsg, NumInput } from '../../quotes/_components/common';
import { InfoNote, RequirePerm } from '../../settings/_components/common';
import { AccountPicker, AnyPartyPicker, EntryStatus, useAccounts, type PickedAnyParty } from '../_components/ledger-kit';

interface OpeningState { goLiveDate: string | null; entry: { id: string; number: string; entryDate: string; status: string; total: string } | null; stockValue: string }
interface Line { key: number; accountId: string; debit: string; credit: string; party: PickedAnyParty | null; memo: string }
let seq = 1;
const mk = (p: Partial<Line> = {}): Line => ({ key: seq++, accountId: '', debit: '', credit: '', party: null, memo: '', ...p });
const ok = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
const H = (v: string) => (ok(v) ? toHalalas(v.trim()) : 0);
const fmt = (h: number) => (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function OpeningPage() {
  return <RequirePerm perm="ledger.close" title="الأرصدة الافتتاحية"><Opening /></RequirePerm>;
}

function Opening() {
  const { bi } = useI18n();
  const state = useQuery({ queryKey: ['ledger-opening'], queryFn: () => api.get<OpeningState>('/accounting/opening') });
  if (state.isLoading) return <Spinner />;
  if (!state.data) return <ErrorBox error={state.error} />;
  return (
    <>
      <PageHeader title={bi('الأرصدة الافتتاحية', 'Opening balances')} subtitle={bi('تاريخ بدء العمل على النظام المحاسبي وأرصدة الحسابات في ذلك اليوم.', 'The day the books start in Core, and every account balance on that day.')} />
      {state.data.entry ? (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <EntryStatus status={state.data.entry.status} />
            <span>{bi('قيد الأرصدة الافتتاحية', 'Opening entry')} <Link className="num font-bold text-primary hover:underline" dir="ltr" href={`/accounting/journal/${state.data.entry.id}`}>{state.data.entry.number}</Link> — <span className="num">{state.data.entry.entryDate}</span></span>
            <Money value={state.data.entry.total} fixed />
          </div>
          <p className="mt-3 text-sm text-muted">{state.data.entry.status === 'draft' ? bi('القيد مسودة بانتظار الترحيل من شخص آخر. يمكنك تعديله من صفحته.', 'The entry is a draft waiting for someone else to post it. You can edit it on its page.') : bi('رُحّل القيد. لتعديل الأرصدة اعكس القيد الافتتاحي ثم أدخل أرصدة جديدة.', 'The entry is posted. To change the balances, reverse it and enter new ones.')}</p>
        </Card>
      ) : <Wizard state={state.data} />}
    </>
  );
}

function Wizard({ state }: { state: OpeningState }) {
  const { bi } = useI18n();
  const router = useRouter();
  const accounts = useAccounts();
  const byKey = (key: string) => accounts.data?.find((a) => a.postingKey === key)?.id ?? '';
  const [goLive, setGoLive] = useState(state.goLiveDate ?? `${new Date().getFullYear()}-01-01`);
  const [lines, setLines] = useState<Line[]>(() => [mk(), mk(), mk()]);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  useEffect(() => {
    if (!accounts.data || seeded) return;
    setSeeded(true);
    const stock = Number(state.stockValue) > 0 ? String(Number(state.stockValue)) : '';
    setLines([
      mk({ accountId: byKey('cash') }), mk({ accountId: byKey('bank') }), mk({ accountId: byKey('ar') }), mk({ accountId: byKey('inventory'), debit: stock }),
      mk({ accountId: byKey('ap') }), mk({ accountId: byKey('capital') }),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.data, seeded]);
  const filled = lines.filter((l) => l.accountId && (l.debit || l.credit));
  const debit = filled.reduce((s, l) => s + H(l.debit), 0);
  const credit = filled.reduce((s, l) => s + H(l.credit), 0);
  const diff = debit - credit;
  const needsParty = filled.some((l) => accounts.data?.find((a) => a.id === l.accountId)?.requiresParty && !l.party);
  const badAmount = filled.some((l) => (l.debit && !ok(l.debit)) || (l.credit && !ok(l.credit)));
  const problem = !goLive ? bi('اختر تاريخ البدء', 'Choose the go-live date') : filled.length === 0 ? bi('أدخل رصيدًا واحدًا على الأقل', 'Enter at least one balance') : badAmount ? bi('المبالغ بخانتين عشريتين كحد أقصى', 'Two decimals at most') : needsParty ? bi('حدّد العميل/المورد لحسابات الذمم', 'Name the customer/supplier on receivable/payable lines') : null;

  const save = async () => {
    setBusy(true);
    try {
      const e = await api.post<{ id: string }>('/accounting/opening', {
        goLiveDate: goLive, autoBalance: true,
        lines: filled.map((l) => ({ accountId: l.accountId, debit: l.debit.trim() || '0', credit: l.credit.trim() || '0', partyId: l.party?.id ?? null, memo: l.memo.trim() || null })),
      });
      toast.success(bi('أُنشئ قيد الأرصدة الافتتاحية كمسودة', 'Opening entry saved as a draft'));
      router.push(`/accounting/journal/${e.id}`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4">
      <InfoNote>{bi('أدخل كل حساب له رصيد في تاريخ البدء: الأصول مدين، والخصوم وحقوق الملكية دائن. للذمم (العملاء/الموردين) أضف سطرًا لكل عميل أو مورد. أي فرق يُرحَّل تلقائيًا إلى «أرصدة افتتاحية — حساب وسيط» ليراجعه المحاسب. يُحفظ القيد كمسودة ويرحّله شخص آخر.', 'Enter every account that has a balance on the go-live day: assets as debits, liabilities and equity as credits. For receivables/payables add one line per customer or supplier. Any difference goes to “Opening balance equity” for the accountant to review. Saved as a draft; someone else posts it.')}</InfoNote>
      <Card>
        <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
          <Field label={bi('تاريخ بدء النظام المحاسبي *', 'Go-live date *')} hint={bi('الأرصدة كما في بداية هذا اليوم.', 'Balances as at the start of this day.')}><Input type="date" value={goLive} onChange={(e) => setGoLive(e.target.value)} /></Field>
          {Number(state.stockValue) > 0 && <p className="self-end rounded-lg bg-tint/60 px-3 py-2 text-sm">{bi('قيمة المخزون الحالية في سجل المخزون (بالتكلفة):', 'Current stock value in the stock ledger (at cost):')} <Money value={state.stockValue} fixed className="font-extrabold" /> — {bi('وُضعت على حساب المخزون.', 'pre-filled on the inventory account.')}</p>}
        </div>
      </Card>
      <Card padded={false} title={bi('الأرصدة', 'Balances')} actions={<Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, mk()])}>{bi('سطر', 'Line')}</Button>}>
        <div className="overflow-x-auto"><div className="min-w-[46rem] divide-y divide-line">
          {lines.map((l) => {
            const acc = accounts.data?.find((a) => a.id === l.accountId);
            return (
              <div key={l.key} className="grid grid-cols-[minmax(14rem,2fr)_8.5rem_8.5rem_minmax(12rem,1.4fr)_2rem] items-start gap-2 px-3 py-2">
                <AccountPicker value={l.accountId} onChange={(id) => set(l.key, { accountId: id })} />
                <NumInput value={l.debit} onChange={(v) => set(l.key, { debit: v, credit: v ? '' : l.credit })} step="0.01" ariaLabel={bi('مدين', 'Debit')} placeholder={bi('مدين', 'Debit')} />
                <NumInput value={l.credit} onChange={(v) => set(l.key, { credit: v, debit: v ? '' : l.debit })} step="0.01" ariaLabel={bi('دائن', 'Credit')} placeholder={bi('دائن', 'Credit')} />
                {acc?.requiresParty ? <AnyPartyPicker value={l.party} onChange={(p) => set(l.key, { party: p })} /> : <Input value={l.memo} onChange={(e) => set(l.key, { memo: e.target.value })} placeholder={bi('بيان (اختياري)', 'Memo (optional)')} />}
                <button type="button" className="rounded p-1.5 text-muted hover:bg-black/5 hover:text-danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={bi('حذف', 'Remove')}><Trash2 className="size-4" /></button>
              </div>
            );
          })}
          <div className="grid grid-cols-[minmax(14rem,2fr)_8.5rem_8.5rem_minmax(12rem,1.4fr)_2rem] items-center gap-2 bg-tint/40 px-3 py-2.5 font-extrabold">
            <span className="text-end text-xs text-gold-dark">{bi('الإجمالي', 'Total')}</span><span className="num px-1" dir="ltr">{fmt(debit)}</span><span className="num px-1" dir="ltr">{fmt(credit)}</span>
            <span className={clsx('text-xs', diff === 0 ? 'text-ok' : 'text-gold-dark')}>{diff === 0 ? bi('متوازن ✓', 'Balanced ✓') : bi(`الفرق ${fmt(Math.abs(diff))} → أرصدة افتتاحية (وسيط)`, `Difference ${fmt(Math.abs(diff))} → Opening balance equity`)}</span><span />
          </div>
        </div></div>
      </Card>
      <div className="flex items-center justify-end gap-3">
        {problem && <span className="me-auto text-xs text-danger">{problem}</span>}
        <Button loading={busy} disabled={!!problem} onClick={() => void save()}>{bi('حفظ كمسودة', 'Save as draft')}</Button>
      </div>
    </div>
  );
}
