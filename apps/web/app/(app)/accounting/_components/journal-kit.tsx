'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Plus, Scale, Trash2 } from 'lucide-react';
import { journalProblems, toHalalas, type AccountInfo } from '@mmc/domain';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { today } from '@/lib/format';
import { Button, Card, Field, Input, Textarea, clsx } from '@/components/ui';
import { errMsg, NumInput } from '../../quotes/_components/common';
import { ProjectPicker, type PickedProject } from '../../purchasing/_components/pickers';
import { AccountPicker, AnyPartyPicker, useAccounts, type PickedAnyParty } from './ledger-kit';

export interface EntryLine {
  id: string; lineNo: number; accountId: string; code: string; nameAr: string; debit: string; credit: string;
  partyId: string | null; partyName: string | null; projectId: string | null; projectNumber: string | null; costCenter: string | null; memo: string | null;
}
export interface Entry {
  id: string; number: string; entryDate: string; period: string; memo: string | null; kind: string; status: 'draft' | 'posted'; total: string; version: number;
  sourceType: string | null; sourceRef: string | null; createdBy: string | null; createdByName: string | null; postedByName: string | null; postedAt: string | null;
  reverses: { id: string; number: string } | null; reversedBy: { id: string; number: string } | null; reversedById: string | null; lines: EntryLine[];
}

interface DraftLine { key: number; accountId: string; debit: string; credit: string; party: PickedAnyParty | null; project: PickedProject | null; costCenter: string; memo: string; more: boolean }
let keySeq = 1;
const newLine = (p: Partial<DraftLine> = {}): DraftLine => ({ key: keySeq++, accountId: '', debit: '', credit: '', party: null, project: null, costCenter: '', memo: '', more: false, ...p });
const H = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? toHalalas(v.trim()) : 0);
const fmt = (h: number) => (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fromEntry(e: Entry | null): { date: string; memo: string; lines: DraftLine[] } {
  if (!e) return { date: today(), memo: '', lines: [newLine(), newLine()] };
  return {
    date: e.entryDate, memo: e.memo ?? '',
    lines: e.lines.map((l) => newLine({
      accountId: l.accountId, debit: Number(l.debit) ? String(Number(l.debit)) : '', credit: Number(l.credit) ? String(Number(l.credit)) : '',
      party: l.partyId ? { id: l.partyId, nameAr: l.partyName ?? '', nameEn: null, phone: null, vatNumber: null } : null,
      project: l.projectId ? { id: l.projectId, number: l.projectNumber ?? '', name: '' } : null, costCenter: l.costCenter ?? '', memo: l.memo ?? '', more: !!(l.partyId || l.projectId || l.costCenter),
    })),
  };
}

/** Balanced-lines editor for a manual journal entry (draft). */
export function JournalEditor({ entry, onSaved, onCancel }: { entry: Entry | null; onSaved: (e: Entry) => void; onCancel?: () => void }) {
  const { bi } = useI18n();
  const accounts = useAccounts();
  const init = fromEntry(entry);
  const [date, setDate] = useState(init.date);
  const [memo, setMemo] = useState(init.memo);
  const [lines, setLines] = useState<DraftLine[]>(init.lines);
  const [busy, setBusy] = useState(false);
  const set = (key: number, p: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const filled = lines.filter((l) => l.accountId || l.debit || l.credit);
  const debit = filled.reduce((s, l) => s + H(l.debit), 0);
  const credit = filled.reduce((s, l) => s + H(l.credit), 0);
  const diff = debit - credit;

  const info = new Map<string, AccountInfo>((accounts.data ?? []).map((a) => [a.id, { id: a.id, code: a.code, isGroup: a.isGroup, isActive: a.isActive, requiresParty: a.requiresParty }]));
  const problems = journalProblems({
    entryDate: date, accounts: info,
    lines: filled.map((l) => ({ accountId: l.accountId, debit: H(l.debit), credit: H(l.credit), partyId: l.party?.id })),
  });
  const textual = filled.some((l) => (l.debit && !/^\d+(\.\d{1,2})?$/.test(l.debit.trim())) || (l.credit && !/^\d+(\.\d{1,2})?$/.test(l.credit.trim())));
  // all but "unbalanced / party / <2 lines" are blocking for the draft; those are fixed before posting
  const blocking = problems.filter((p) => !['unbalanced', 'too_few_lines', 'party_required', 'before_go_live'].includes(p.code));

  const balanceLine = () => {
    if (diff === 0) return;
    const empty = lines.find((l) => !l.debit && !l.credit);
    const fill = { debit: diff < 0 ? fmt(-diff).replace(/,/g, '') : '', credit: diff > 0 ? fmt(diff).replace(/,/g, '') : '' };
    if (empty) set(empty.key, fill); else setLines((ls) => [...ls, newLine(fill)]);
  };

  const save = async () => {
    setBusy(true);
    const body = {
      entryDate: date, memo: memo.trim() || null,
      lines: filled.map((l) => ({
        accountId: l.accountId, debit: l.debit.trim() || '0', credit: l.credit.trim() || '0', partyId: l.party?.id ?? null, projectId: l.project?.id ?? null,
        costCenter: l.costCenter.trim() || null, memo: l.memo.trim() || null,
      })),
    };
    try {
      const e = entry ? await api.put<Entry>(`/accounting/journal/${entry.id}`, { ...body, version: entry.version }) : await api.post<Entry>('/accounting/journal', body);
      toast.success(entry ? bi('تم حفظ المسودة', 'Draft saved') : bi(`أُنشئ القيد ${e.number}`, `Entry ${e.number} created`));
      onSaved(e);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const statusText = filled.length === 0 ? bi('أضف سطرين على الأقل', 'Add at least two lines')
    : problems.find((p) => p.code === 'unbalanced') ? bi(`الفرق ${fmt(Math.abs(diff))} — القيد غير متوازن`, `Difference ${fmt(Math.abs(diff))} — not balanced`)
    : problems.length ? problems[0]!.messageAr : null;

  return (
    <div className="grid gap-4">
      <Card title={bi('بيانات القيد', 'Entry details')}>
        <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
          <Field label={bi('تاريخ القيد *', 'Entry date *')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={bi('البيان', 'Description')}><Textarea rows={1} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={bi('مثال: تسوية مصروف الإيجار لشهر أكتوبر', 'e.g. October rent adjustment')} /></Field>
        </div>
      </Card>

      <Card title={bi('أسطر القيد', 'Lines')} padded={false}
        actions={<Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, newLine()])}>{bi('سطر', 'Line')}</Button>}>
        <div className="overflow-x-auto">
          <div className="min-w-[44rem] divide-y divide-line">
            <div className="grid grid-cols-[2.2rem_minmax(14rem,2fr)_9rem_9rem_minmax(8rem,1fr)_5rem] gap-2 bg-tint/60 px-3 py-2 text-xs font-extrabold text-gold-dark">
              <span>#</span><span>{bi('الحساب', 'Account')}</span><span>{bi('مدين', 'Debit')}</span><span>{bi('دائن', 'Credit')}</span><span>{bi('بيان السطر', 'Line memo')}</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={l.key} className="px-3 py-2">
                <div className="grid grid-cols-[2.2rem_minmax(14rem,2fr)_9rem_9rem_minmax(8rem,1fr)_5rem] items-start gap-2">
                  <span className="num pt-2 text-xs text-muted">{i + 1}</span>
                  <AccountPicker value={l.accountId} onChange={(id) => set(l.key, { accountId: id })} />
                  <NumInput value={l.debit} onChange={(v) => set(l.key, { debit: v, credit: v ? '' : l.credit })} step="0.01" ariaLabel={bi('مدين', 'Debit')} />
                  <NumInput value={l.credit} onChange={(v) => set(l.key, { credit: v, debit: v ? '' : l.debit })} step="0.01" ariaLabel={bi('دائن', 'Credit')} />
                  <Input value={l.memo} onChange={(e) => set(l.key, { memo: e.target.value })} />
                  <div className="flex items-center justify-end gap-0.5 pt-1">
                    <button type="button" className="rounded p-1 text-muted hover:bg-black/5" title={bi('العميل / المشروع / مركز التكلفة', 'Party / project / cost centre')} onClick={() => set(l.key, { more: !l.more })}>{l.more ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
                    <button type="button" className="rounded p-1 text-muted hover:bg-black/5 hover:text-danger" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={bi('حذف السطر', 'Remove line')}><Trash2 className="size-4" /></button>
                  </div>
                </div>
                {(l.more || l.party || l.project || l.costCenter) && (
                  <div className="mt-2 grid gap-2 ps-9 md:grid-cols-3">
                    <AnyPartyPicker value={l.party} onChange={(p) => set(l.key, { party: p })} />
                    <ProjectPicker value={l.project} onChange={(p) => set(l.key, { project: p })} />
                    <Input value={l.costCenter} onChange={(e) => set(l.key, { costCenter: e.target.value })} placeholder={bi('مركز التكلفة / القسم', 'Cost centre / department')} />
                  </div>
                )}
              </div>
            ))}
            <div className="grid grid-cols-[2.2rem_minmax(14rem,2fr)_9rem_9rem_minmax(8rem,1fr)_5rem] items-center gap-2 bg-tint/40 px-3 py-2.5 font-extrabold">
              <span /><span className="text-end text-xs text-gold-dark">{bi('الإجمالي', 'Total')}</span>
              <span className="num px-1" dir="ltr">{fmt(debit)}</span><span className="num px-1" dir="ltr">{fmt(credit)}</span>
              <span className={clsx('text-xs', diff === 0 && filled.length ? 'text-ok' : 'text-danger')}>{filled.length ? (diff === 0 ? bi('متوازن ✓', 'Balanced ✓') : `${bi('الفرق', 'Diff')} ${fmt(Math.abs(diff))}`) : ''}</span>
              <span />
            </div>
          </div>
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 bg-gradient-to-t from-white/95 to-white/0 px-1 py-3">
        {(statusText || textual) && <span className={clsx('me-auto text-xs', blocking.length || textual ? 'text-danger' : 'text-muted')}>{textual ? bi('المبالغ بخانتين عشريتين كحد أقصى', 'Amounts allow two decimals at most') : statusText}</span>}
        {diff !== 0 && <Button variant="outline" icon={<Scale className="size-4" />} onClick={balanceLine}>{bi('إضافة سطر الفرق', 'Add the balancing line')}</Button>}
        {onCancel && <Button variant="outline" onClick={onCancel}>{bi('إلغاء', 'Cancel')}</Button>}
        <Button loading={busy} disabled={blocking.length > 0 || textual || filled.length === 0} onClick={() => void save()}>{entry ? bi('حفظ المسودة', 'Save draft') : bi('حفظ كمسودة', 'Save as draft')}</Button>
      </div>
    </div>
  );
}
