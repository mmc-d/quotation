'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDown, ArrowUp, BookOpen, CheckCircle2, ChevronDown, Download, FileText, Lock, PenLine, Play, Plus, RotateCcw, Save, Stamp, Trash2, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { tafqitHalalas } from '@mmc/domain';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, dateTime } from '@/lib/format';
import { BillingPanel } from '@/components/billing-panel';
import { Badge, Button, Card, clsx, Field, Input, Money, PageHeader, Select, StatusBadge, Table, Td, Textarea, Th } from '@/components/ui';
import { ConfirmDialog, errMsg, isConflict, NumInput, ReasonDialog } from '../../quotes/_components/common';
import { Menu } from '../../quotes/_components/menu';
import { newKey } from '../../quotes/_components/types';
import { ContractProjectLink } from '../../projects/_components/contract-project-link';
import { ChangeOrdersCard } from './change-orders';
import { ClauseLibrary } from './clause-library';
import { EsignDialog } from './esign-dialog';
import {
  blankLine, blankMilestone, calcContract, contractBody, contractDraft, contractProblems, percentSum, TEMPLATE_SETS, templateSetLabel, TRIGGERS, type ClauseTemplate, type ContractDraft, type ContractView, type DraftClause, type DraftLine, type DraftMilestone, type TemplateSet,
} from './types';

type Transition = 'sent_for_signature' | 'signed' | 'active' | 'completed' | 'terminated' | 'cancelled' | 'draft';
const TRANSITIONS: Record<string, Transition[]> = {
  draft: ['sent_for_signature', 'signed', 'cancelled'],
  sent_for_signature: ['signed', 'draft', 'cancelled'],
  signed: ['active', 'terminated'],
  active: ['completed', 'terminated'],
};
const T_META: Record<Transition, { label: string; confirm: string; labelEn: string; confirmEn: string; danger?: boolean; reason?: boolean; icon: ReactNode }> = {
  sent_for_signature: { label: 'تعليم كمرسل للتوقيع', confirm: 'سيُعلَّم العقد «بانتظار التوقيع» دون إرسال طلب توقيع إلكتروني.', labelEn: 'Mark as sent for signature', confirmEn: 'The contract will be marked “Awaiting signature” without sending an e-signature request.', icon: <PenLine className="size-4" /> },
  signed: { label: 'تعليم كموقّع', confirm: 'سيُعلَّم العقد موقّعًا من الطرفين ويُقفل للتعديل.', labelEn: 'Mark as signed', confirmEn: 'The contract will be marked as signed by both parties and locked for editing.', icon: <CheckCircle2 className="size-4" /> },
  active: { label: 'تفعيل العقد', confirm: 'سيبدأ تنفيذ العقد اعتبارًا من اليوم.', labelEn: 'Activate contract', confirmEn: 'Contract execution will start as of today.', icon: <Play className="size-4" /> },
  completed: { label: 'إكمال العقد', confirm: 'سيُعلَّم العقد مكتملًا بتاريخ اليوم.', labelEn: 'Complete contract', confirmEn: 'The contract will be marked as completed as of today.', icon: <CheckCircle2 className="size-4" /> },
  terminated: { label: 'إنهاء العقد', confirm: 'سيُنهى العقد قبل اكتماله.', labelEn: 'Terminate contract', confirmEn: 'The contract will be terminated before completion.', danger: true, reason: true, icon: <XCircle className="size-4" /> },
  cancelled: { label: 'إلغاء العقد', confirm: 'سيُلغى العقد نهائيًا.', labelEn: 'Cancel contract', confirmEn: 'The contract will be cancelled permanently.', danger: true, reason: true, icon: <XCircle className="size-4" /> },
  draft: { label: 'إعادة إلى مسودة', confirm: 'سيعود العقد مسودة قابلة للتعديل (طلب التوقيع الحالي لن يكون صالحًا).', labelEn: 'Return to draft', confirmEn: 'The contract will return to an editable draft (the current signature request will no longer be valid).', icon: <RotateCcw className="size-4" /> },
};

const ESIGN_STATUS: Record<string, string> = { created: 'أُنشئ', sent: 'أُرسل', viewed: 'تمت المشاهدة', signed: 'موقّع', completed: 'مكتمل', declined: 'مرفوض', expired: 'منتهي', failed: 'فشل' };
const ESIGN_STATUS_EN: Record<string, string> = { created: 'Created', sent: 'Sent', viewed: 'Viewed', signed: 'Signed', completed: 'Completed', declined: 'Declined', expired: 'Expired', failed: 'Failed' };

function ReadValue({ children }: { children: ReactNode }) {
  return <div className="min-h-[2.4rem] rounded-lg border border-line bg-gray-50 px-3 py-2 text-sm">{children || <span className="text-muted">—</span>}</div>;
}

export function ContractEditor({ contract }: { contract: ContractView }) {
  const qc = useQueryClient();
  const { me, can } = useMe();
  const { t: tr, bi, locale } = useI18n();
  const tLabel = (x: Transition) => (locale === 'en' ? T_META[x].labelEn : T_META[x].label);
  const tConfirm = (x: Transition) => (locale === 'en' ? T_META[x].confirmEn : T_META[x].confirm);
  const vatRegistered = me?.company?.vatRegistered ?? true;
  const canWrite = can('contract.write');
  const editable = contract.status === 'draft' && canWrite;

  const [draft, setDraft] = useState<ContractDraft>(() => contractDraft(contract));
  const [baseline, setBaseline] = useState(() => JSON.stringify(contractDraft(contract)));
  const loaded = useRef(`${contract.id}:${contract.version}:${contract.status}`);
  useEffect(() => {
    const k = `${contract.id}:${contract.version}:${contract.status}`;
    if (loaded.current === k) return;
    loaded.current = k;
    const d = contractDraft(contract);
    setDraft(d);
    setBaseline(JSON.stringify(d));
  }, [contract]);
  const dirty = editable && JSON.stringify(draft) !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'esign' | 'clauses' | Transition>(null);
  const [switchTo, setSwitchTo] = useState<TemplateSet | null>(null);
  const [openClauses, setOpenClauses] = useState<Set<string>>(new Set());

  const { calc, schedule } = useMemo(() => calcContract(draft, contract.vatOn, vatRegistered), [draft, contract.vatOn, vatRegistered]);
  const t = calc.totals;
  const problems = useMemo(() => (editable ? contractProblems(draft, bi) : []), [draft, editable, bi]);
  const pctSum = percentSum(draft.milestones);

  const set = (patch: Partial<ContractDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setClient = (k: keyof ContractDraft['clientBlock'], v: string) => setDraft((d) => ({ ...d, clientBlock: { ...d.clientBlock, [k]: v } }));
  const setLine = (i: number, p: Partial<DraftLine>) => setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) }));
  const setClause = (i: number, p: Partial<DraftClause>) => setDraft((d) => ({ ...d, clauses: d.clauses.map((l, j) => (j === i ? { ...l, ...p } : l)) }));
  const setMs = (i: number, p: Partial<DraftMilestone>) => setDraft((d) => ({ ...d, milestones: d.milestones.map((l, j) => (j === i ? { ...l, ...p } : l)) }));
  function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return arr;
    const c = [...arr];
    [c[i], c[j]] = [c[j]!, c[i]!];
    return c;
  }
  const addClause = (tpl: ClauseTemplate) => {
    const key = newKey();
    setDraft((d) => ({ ...d, clauses: [...d.clauses, { key, templateId: tpl.id, titleAr: tpl.titleAr, bodyAr: tpl.bodyAr }] }));
    toast.success(bi(`أُضيف البند: ${tpl.titleAr}`, `Clause added: ${tpl.titleAr}`));
  };
  const toggleClause = (k: string) => setOpenClauses((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const applyView = (c: ContractView) => {
    qc.setQueryData(['contract', c.id], c);
    qc.invalidateQueries({ queryKey: ['contracts'] });
  };

  const save = async (): Promise<ContractView | null> => {
    if (problems.length) { toast.error(problems[0]!); return null; }
    setBusy('save');
    try {
      const c = await api.put<ContractView>(`/contracts/${contract.id}`, contractBody(draft, contract.version));
      applyView(c);
      toast.success(bi('تم حفظ العقد', 'Contract saved'));
      return c;
    } catch (e) {
      if (isConflict(e)) toast.error(bi('عدّل مستخدم آخر هذا العقد — أعد التحميل لرؤية آخر نسخة', 'Another user edited this contract — reload to see the latest version'), { action: { label: bi('إعادة التحميل', 'Reload'), onClick: () => { loaded.current = ''; void qc.invalidateQueries({ queryKey: ['contract', contract.id] }); } }, duration: 10_000 });
      else toast.error(errMsg(e));
      return null;
    } finally {
      setBusy(null);
    }
  };
  const ensureSaved = async (): Promise<ContractView | null> => (dirty ? save() : contract);

  /** Re-apply a template set: replaces the clauses (and the title / schedule while they are still defaults). */
  const applyTemplate = async (set: TemplateSet) => {
    setBusy('template');
    try {
      const c = await api.post<ContractView>(`/contracts/${contract.id}/template`, { templateSet: set });
      loaded.current = '';
      applyView(c);
      setSwitchTo(null);
      toast.success(bi(`طُبّق قالب «${templateSetLabel(set)}» — ${c.clauses.length} بندًا`, `Applied template “${templateSetLabel(set, 'en')}” — ${c.clauses.length} clauses`));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const transition = async (to: Transition, reason?: string) => {
    if (to !== 'draft' && to !== 'cancelled' && dirty && !(await save())) return;
    setBusy('status');
    try {
      const c = await api.post<ContractView>(`/contracts/${contract.id}/status`, { status: to, reason: reason || null });
      applyView(c);
      setDialog(null);
      toast.success(bi(`تم: ${T_META[to].label}`, `Done: ${T_META[to].labelEn}`));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const allowed = (TRANSITIONS[contract.status] ?? []).filter((x) => canWrite && (x !== 'signed' || can('contract.sign')));
  const canStamp = can('contract.stamp') && contract.status !== 'draft' && contract.status !== 'cancelled';
  const canEsign = canWrite && ['draft', 'sent_for_signature'].includes(contract.status);
  const primaryT: Transition | undefined = allowed.find((x) => x === 'signed' || x === 'active' || x === 'completed');
  const otherT = allowed.filter((x) => x !== primaryT);

  const cb = draft.clientBlock;
  const clientField = (k: keyof ContractDraft['clientBlock'], label: string, ltr = false, wide = false) => (
    <Field label={label} className={wide ? 'md:col-span-2' : undefined}>
      {editable ? <Input dir={ltr ? 'ltr' : undefined} value={cb[k]} onChange={(e) => setClient(k, e.target.value)} /> : <ReadValue>{cb[k]}</ReadValue>}
    </Field>
  );
  const intField = (k: 'deliveryDaysMin' | 'deliveryDaysMax' | 'warrantyMonths' | 'partsWarrantyMonths' | 'sparePartsYears', label: string) => (
    <Field label={label}>
      {editable ? <NumInput value={draft[k]} onChange={(v) => set({ [k]: v.replace(/[^\d]/g, '') } as Partial<ContractDraft>)} step="1" /> : <ReadValue><span className="num">{draft[k]}</span></ReadValue>}
    </Field>
  );

  return (
    <>
      <PageHeader
        back="/contracts"
        title={<span className="flex flex-wrap items-center gap-2">{bi('عقد', 'Contract')} <span className="num" dir="ltr">{contract.number}</span><StatusBadge status={contract.status} />{contract.stampApplied && <Badge tone="gold">{bi('مختوم', 'Stamped')}</Badge>}{dirty && <Badge tone="gold">{bi('تعديلات غير محفوظة', 'Unsaved changes')}</Badge>}</span>}
        subtitle={<>
          {contract.quote && <>{bi('من العرض', 'From quote')} <Link href={`/quotes/${contract.quote.id}`} className="num font-bold text-gold-dark hover:underline" dir="ltr">{contract.quote.number}{contract.quote.revision ? `-R${contract.quote.revision}` : ''}</Link> · </>}
          {bi('بتاريخ', 'Dated')} <span className="num">{date(contract.contractDate)}</span>
          {contract.signedAt && <> · {bi('وُقّع', 'Signed')} <span className="num">{dateTime(contract.signedAt)}</span></>}
          {contract.startDate && <> · {bi('بدأ', 'Started')} <span className="num">{date(contract.startDate)}</span></>}
          {contract.endDate && <> · {bi('انتهى', 'Ended')} <span className="num">{date(contract.endDate)}</span></>}
        </>}
        actions={<>
          {editable && <Button icon={<Save className="size-4" />} loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>{tr('common.save')}</Button>}
          {canEsign && <Button variant="gold" icon={<PenLine className="size-4" />} onClick={() => { if (dirty && problems.length) { toast.error(problems[0]!); return; } setDialog('esign'); }}>{bi('توقيع إلكتروني', 'E-signature')}</Button>}
          {primaryT && <Button variant={canEsign ? 'outline' : 'gold'} icon={T_META[primaryT].icon} onClick={() => setDialog(primaryT)}>{tLabel(primaryT)}</Button>}
          <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => void ensureSaved().then((c) => c && openFile(`/contracts/${c.id}/pdf`))}>PDF</Button>
          {canStamp && <Button variant="outline" icon={<Stamp className="size-4" />} onClick={() => { openFile(`/contracts/${contract.id}/pdf?stamp=1`); setTimeout(() => void qc.invalidateQueries({ queryKey: ['contract', contract.id] }), 4000); }}>{bi('PDF مختوم', 'Stamped PDF')}</Button>}
          <ContractProjectLink contract={contract} />
          {otherT.length > 0 && <Menu label={bi('الحالة', 'Status')} items={otherT.map((x) => ({ label: tLabel(x), icon: T_META[x].icon, danger: T_META[x].danger, onClick: () => setDialog(x) }))} />}
        </>}
      />

      {!editable && contract.status !== 'draft' && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <Lock className="size-4 shrink-0" />{contract.status === 'sent_for_signature' ? bi('العقد بانتظار التوقيع — للتعديل أعده إلى مسودة أولًا.', 'The contract is awaiting signature — return it to draft first to edit it.') : bi('العقد للعرض فقط. أي تغيير بعد التوقيع يتم عبر أمر تغيير.', 'The contract is read-only. Any change after signing goes through a change order.')}
        </div>
      )}
      {editable && problems.length > 0 && dirty && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /><ul className="list-disc ps-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card title={bi('بيانات العقد', 'Contract details')}>
            <div className="mb-3 rounded-xl border border-gold/40 bg-tint/40 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label={bi('قالب العقد', 'Contract template')} className="min-w-[14rem] flex-1">
                  {editable ? (
                    <Select value={contract.templateSet} disabled={busy === 'template'} onChange={(e) => { const v = e.target.value as TemplateSet; if (v !== contract.templateSet) setSwitchTo(v); }}>
                      {TEMPLATE_SETS.map((ts) => <option key={ts.value} value={ts.value}>{locale === 'en' ? ts.labelEn : ts.label}</option>)}
                    </Select>
                  ) : <ReadValue>{templateSetLabel(contract.templateSet, locale)}</ReadValue>}
                </Field>
                <p className="flex-[2] pb-2 text-xs leading-relaxed text-muted">{(() => { const ts = TEMPLATE_SETS.find((x) => x.value === contract.templateSet); return ts && (locale === 'en' ? ts.hintEn : ts.hint); })()}{editable && bi(' — تغيير القالب يستبدل البنود القانونية ببنود القالب الجديد.', ' — changing the template replaces the contract clauses with the new template’s clauses.')}</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={bi('عنوان العقد *', 'Contract title *')}>{editable ? <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} /> : <ReadValue>{draft.title}</ReadValue>}</Field>
              <Field label={bi('العنوان الفرعي', 'Subtitle')}>{editable ? <Input value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /> : <ReadValue>{draft.subtitle}</ReadValue>}</Field>
              <Field label={bi('تاريخ العقد *', 'Contract date *')}>{editable ? <Input type="date" value={draft.contractDate} onChange={(e) => set({ contractDate: e.target.value })} /> : <ReadValue><span className="num">{date(draft.contractDate)}</span></ReadValue>}</Field>
              <div className="grid grid-cols-2 gap-3">
                {intField('deliveryDaysMin', bi('مدة التوريد من (يوم)', 'Delivery from (days)'))}
                {intField('deliveryDaysMax', bi('إلى (يوم)', 'To (days)'))}
              </div>
              <div className="grid grid-cols-3 gap-3 md:col-span-2">
                {intField('warrantyMonths', bi('الضمان (شهر)', 'Warranty (months)'))}
                {intField('partsWarrantyMonths', bi('ضمان القطع (شهر)', 'Parts warranty (months)'))}
                {intField('sparePartsYears', bi('توفر قطع الغيار (سنة)', 'Spare parts availability (years)'))}
              </div>
            </div>
          </Card>

          <Card title={bi('الطرف الأول (العميل)', 'First party (customer)')}>
            <div className="grid gap-3 md:grid-cols-2">
              {clientField('name', bi('اسم العميل / المنشأة', 'Customer / company name'))}
              {clientField('representative', bi('ممثل العميل', 'Customer representative'))}
              {clientField('idNumber', bi('رقم الهوية', 'ID number'), true)}
              {clientField('crNumber', bi('السجل التجاري / الرقم الموحد', 'CR / unified number'), true)}
              {clientField('vatNumber', bi('الرقم الضريبي', 'VAT number'), true)}
              {clientField('mobile', bi('الجوال', 'Mobile'), true)}
              {clientField('address', bi('العنوان', 'Address'), false, true)}
            </div>
          </Card>

          <Card title={bi('البنود', 'Line items')} padded={false} actions={editable && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => set({ lines: [...draft.lines, blankLine()] })}>{bi('إضافة بند', 'Add item')}</Button>}>
            <Table>
              <thead><tr><Th className="w-8">#</Th><Th className="min-w-[7rem]">{bi('الرمز', 'Code')}</Th><Th className="min-w-[14rem]">{bi('الوصف', 'Description')}</Th><Th className="w-24">{bi('الكمية', 'Qty')}</Th><Th className="w-32">{bi('سعر الوحدة', 'Unit price')}</Th><Th className="text-end">{bi('الإجمالي', 'Total')}</Th>{editable && <Th className="w-10" />}</tr></thead>
              <tbody>
                {draft.lines.map((l, i) => (
                  <tr key={l.key} className="align-top">
                    <Td className="num text-center text-xs text-muted">{i + 1}</Td>
                    <Td>{editable ? <Input dir="ltr" value={l.code} onChange={(e) => setLine(i, { code: e.target.value })} className="px-2 text-xs" /> : <span className="num text-xs font-bold text-primary" dir="ltr">{l.code}</span>}</Td>
                    <Td>{editable ? <Textarea rows={2} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className="text-[13px]" /> : <span className="whitespace-pre-line text-sm">{l.description}</span>}</Td>
                    <Td>{editable ? <NumInput value={l.qty} onChange={(v) => setLine(i, { qty: v })} className="px-2 text-center" /> : <span className="num">{l.qty}</span>}</Td>
                    <Td>{editable ? <NumInput value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} className="px-2" /> : <Money value={l.unitPrice} fixed />}</Td>
                    <Td className="text-end">{calc.lines[i]?.isFree ? <span className="text-sm font-extrabold text-danger">FREE</span> : <Money value={calc.lines[i]?.amount ?? 0} fixed className="font-bold" />}</Td>
                    {editable && <Td><button type="button" onClick={() => set({ lines: draft.lines.filter((_, j) => j !== i) })} className="rounded p-1 text-danger hover:bg-rose-50" aria-label={bi('حذف البند', 'Delete item')} title={bi('حذف', 'Delete')}><Trash2 className="size-4" /></button></Td>}
                  </tr>
                ))}
                {draft.lines.length === 0 && <tr><Td colSpan={7} className="py-6 text-center text-sm text-muted">{bi('لا توجد بنود', 'No items')}</Td></tr>}
              </tbody>
            </Table>
          </Card>

          <Card title={<span className="flex items-center gap-2">{bi('البنود القانونية', 'Contract clauses')} <span className="rounded-full bg-tint px-2 text-[11px] text-gold-dark">{draft.clauses.length}</span></span>}
            actions={<>
              <Button size="sm" variant="ghost" onClick={() => setOpenClauses(openClauses.size ? new Set() : new Set(draft.clauses.map((c) => c.key)))}>{openClauses.size ? bi('طي الكل', 'Collapse all') : bi('توسيع الكل', 'Expand all')}</Button>
              {editable && <Button size="sm" variant="outline" icon={<BookOpen className="size-3.5" />} onClick={() => setDialog('clauses')}>{bi('من المكتبة', 'From library')}</Button>}
              {editable && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => { const key = newKey(); set({ clauses: [...draft.clauses, { key, templateId: null, titleAr: '', bodyAr: '' }] }); setOpenClauses((s) => new Set(s).add(key)); }}>{bi('بند جديد', 'New clause')}</Button>}
            </>}
          >
            {draft.clauses.length === 0 ? <p className="py-4 text-center text-sm text-muted">{bi('لا توجد بنود قانونية', 'No contract clauses')}</p> : (
              <ol className="space-y-2">
                {draft.clauses.map((c, i) => {
                  const isOpen = openClauses.has(c.key);
                  return (
                    <li key={c.key} className="rounded-xl border border-line">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-tint text-[11px] font-extrabold text-gold-dark">{i + 1}</span>
                        <button type="button" onClick={() => toggleClause(c.key)} className="flex min-w-0 flex-1 items-center gap-2 text-start" aria-expanded={isOpen}>
                          <span className={clsx('truncate text-sm font-bold', !c.titleAr && 'text-muted')}>{c.titleAr || bi('بند بدون عنوان', 'Untitled clause')}</span>
                          {!c.templateId && <Badge tone="gold">{bi('مخصص', 'Custom')}</Badge>}
                          <ChevronDown className={clsx('ms-auto size-4 shrink-0 text-muted transition', isOpen && 'rotate-180')} />
                        </button>
                        {editable && (
                          <div className="flex shrink-0 items-center">
                            <button type="button" className="rounded p-1 text-muted hover:bg-black/5 disabled:opacity-30" disabled={i === 0} onClick={() => set({ clauses: move(draft.clauses, i, -1) })} aria-label={bi('أعلى', 'Move up')}><ArrowUp className="size-3.5" /></button>
                            <button type="button" className="rounded p-1 text-muted hover:bg-black/5 disabled:opacity-30" disabled={i === draft.clauses.length - 1} onClick={() => set({ clauses: move(draft.clauses, i, 1) })} aria-label={bi('أسفل', 'Move down')}><ArrowDown className="size-3.5" /></button>
                            <button type="button" className="rounded p-1 text-danger hover:bg-rose-50" onClick={() => set({ clauses: draft.clauses.filter((_, j) => j !== i) })} aria-label={bi('حذف البند', 'Delete clause')}><Trash2 className="size-3.5" /></button>
                          </div>
                        )}
                      </div>
                      {isOpen && (
                        <div className="space-y-2 border-t border-line px-3 py-3">
                          {editable ? (
                            <>
                              <Field label={bi('عنوان البند', 'Clause title')}><Input value={c.titleAr} onChange={(e) => setClause(i, { titleAr: e.target.value })} /></Field>
                              <Field label={bi('نص البند', 'Clause text')} hint={c.bodyAr.includes('(45) إلى (60)') ? bi('عبارة «(45) إلى (60)» تُستبدل تلقائيًا بمدة التوريد عند الطباعة', 'The phrase “(45) إلى (60)” is replaced with the delivery period when printing') : undefined}>
                                <Textarea rows={Math.min(14, Math.max(4, Math.ceil(c.bodyAr.length / 90)))} value={c.bodyAr} onChange={(e) => setClause(i, { bodyAr: e.target.value })} />
                              </Field>
                            </>
                          ) : <p className="whitespace-pre-line text-sm leading-relaxed">{c.bodyAr}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <Card title={bi('جدول الدفعات', 'Payment schedule')} padded={false}
            actions={editable && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => set({ milestones: [...draft.milestones, blankMilestone(pctSum < 100 ? String(Math.round((100 - pctSum) * 10000) / 10000) : '')] })}>{bi('إضافة دفعة', 'Add payment')}</Button>}
          >
            <Table>
              <thead><tr><Th className="w-8">#</Th><Th className="min-w-[12rem]">{bi('الدفعة', 'Payment')}</Th><Th className="w-24">{bi('النسبة %', 'Percent %')}</Th><Th className="min-w-[10rem]">{bi('الاستحقاق', 'Due on')}</Th><Th className="min-w-[9rem]">{bi('تاريخ الاستحقاق', 'Due date')}</Th><Th className="text-end">{bi('المبلغ', 'Amount')}</Th>{!editable && <Th>{bi('الحالة', 'Status')}</Th>}{editable && <Th className="w-20" />}</tr></thead>
              <tbody>
                {draft.milestones.map((m, i) => {
                  const server = contract.milestones[i];
                  const amount = !dirty && server ? server.amount : schedule ? schedule[i] ?? null : null;
                  return (
                    <tr key={m.key} className="align-top">
                      <Td className="num text-center text-xs text-muted">{i + 1}</Td>
                      <Td>{editable ? <Input value={m.nameAr} onChange={(e) => setMs(i, { nameAr: e.target.value })} placeholder={bi('اسم الدفعة', 'Payment name')} /> : <span className="font-bold">{m.nameAr}</span>}</Td>
                      <Td>{editable ? <NumInput value={m.percent} onChange={(v) => setMs(i, { percent: v })} className="px-2 text-center" /> : <span className="num">{m.percent}%</span>}</Td>
                      <Td>{editable ? <Select value={m.trigger} onChange={(e) => setMs(i, { trigger: e.target.value as DraftMilestone['trigger'] })}>{TRIGGERS.map((x) => <option key={x.value} value={x.value}>{locale === 'en' ? x.labelEn : x.label}</option>)}</Select> : (() => { const tr = TRIGGERS.find((x) => x.value === m.trigger); return tr ? (locale === 'en' ? tr.labelEn : tr.label) : m.trigger; })()}</Td>
                      <Td>{editable ? <Input type="date" value={m.dueDate} onChange={(e) => setMs(i, { dueDate: e.target.value })} /> : <span className="num">{m.dueDate ? date(m.dueDate) : '—'}</span>}</Td>
                      <Td className="text-end">{amount === null ? <span className="text-muted">—</span> : <Money value={amount} fixed className="font-bold" />}</Td>
                      {!editable && <Td>{server && <><StatusBadge status={server.status} />{Number(server.paidAmount) > 0 && <div className="mt-0.5 text-[11px] text-muted">{bi('مدفوع', 'Paid')} <Money value={server.paidAmount} /></div>}</>}</Td>}
                      {editable && (
                        <Td>
                          <div className="flex items-center">
                            <button type="button" className="rounded p-1 text-muted hover:bg-black/5 disabled:opacity-30" disabled={i === 0} onClick={() => set({ milestones: move(draft.milestones, i, -1) })} aria-label={bi('أعلى', 'Move up')}><ArrowUp className="size-3.5" /></button>
                            <button type="button" className="rounded p-1 text-danger hover:bg-rose-50 disabled:opacity-30" disabled={draft.milestones.length <= 1} onClick={() => set({ milestones: draft.milestones.filter((_, j) => j !== i) })} aria-label={bi('حذف الدفعة', 'Delete payment')}><Trash2 className="size-3.5" /></button>
                          </div>
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-tint/40">
                  <Td colSpan={2} className="text-xs font-extrabold text-gold-dark">{bi('المجموع', 'Sum')}</Td>
                  <Td><span className={clsx('num font-extrabold', Math.abs(pctSum - 100) > 1e-9 ? 'text-danger' : 'text-ok')}>{pctSum}%</span></Td>
                  <Td colSpan={2} className="text-xs">{Math.abs(pctSum - 100) > 1e-9 ? <span className="font-bold text-danger">{bi('يجب أن يساوي المجموع 100%', 'The sum must equal 100%')} ({pctSum < 100 ? bi(`متبقٍ ${Math.round((100 - pctSum) * 10000) / 10000}%`, `${Math.round((100 - pctSum) * 10000) / 10000}% left`) : bi(`زيادة ${Math.round((pctSum - 100) * 10000) / 10000}%`, `${Math.round((pctSum - 100) * 10000) / 10000}% over`)})</span> : <span className="text-ok">{bi('✓ مكتمل', '✓ Complete')}</span>}</Td>
                  <Td className="text-end"><Money value={t.total} fixed className="font-extrabold" /></Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          </Card>

          {contract.status !== 'draft' && <ChangeOrdersCard contract={contract} />}

          {contract.status !== 'draft' && can('billing.read') && (
            <div id="billing" className="scroll-mt-4"><Card title={bi('الفوترة والتحصيل', 'Billing & collection')}>
              <BillingPanel contractId={contract.id} />
            </Card></div>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          <Card title={bi('قيمة العقد', 'Contract value')}>
            <div className="divide-y divide-line/60 text-sm">
              <div className="flex justify-between py-1.5"><span>{bi('المجموع', 'Subtotal')}</span><Money value={t.subtotal} fixed className="font-bold" /></div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span>{bi('الخصم', 'Discount')}</span>
                {editable ? <NumInput value={draft.discountAmount} onChange={(v) => set({ discountAmount: v })} placeholder="0" className="max-w-[9rem] px-2 py-1" ariaLabel={bi('مبلغ الخصم', 'Discount amount')} /> : <span className="font-bold text-danger">{t.discount ? <>−<Money value={t.discount} fixed /></> : '—'}</span>}
              </div>
              {t.discount > 0 && <div className="flex justify-between py-1.5"><span>{bi('بعد الخصم', 'After discount')}</span><Money value={t.taxable} fixed className="font-bold" /></div>}
              <div className="flex justify-between py-1.5"><span>{t.vatApplied ? bi(`ضريبة القيمة المضافة ${t.vatRate}%`, `VAT ${t.vatRate}%`) : bi('ضريبة القيمة المضافة', 'VAT')}</span>{t.vatApplied ? <Money value={t.vat} fixed className="font-bold" /> : <span className="text-muted">{vatRegistered ? bi('غير مضافة', 'Not added') : bi('غير مسجلة', 'Not registered')}</span>}</div>
              <div className="flex justify-between py-2 text-base font-extrabold text-primary"><span>{bi('الإجمالي', 'Total')}</span><Money value={t.total} fixed /></div>
            </div>
            {t.total > 0 && <p className="mt-2 rounded-lg bg-tint/60 px-3 py-2 text-xs leading-relaxed text-gold-dark" dir="rtl">فقط {tafqitHalalas(t.total)} لا غير</p>}
            {!vatRegistered && <p className="mt-2 text-xs font-bold text-amber-800">{tr('shell.vatNotRegistered')}</p>}
          </Card>

          {contract.esignRequests.length > 0 && (
            <Card title={bi('طلبات التوقيع الإلكتروني', 'E-signature requests')}>
              <ul className="space-y-3">
                {contract.esignRequests.map((r) => (
                  <li key={r.id} className="border-s-2 border-line ps-3 text-sm">
                    <div className="flex items-center justify-between gap-2"><b>{r.signerName}</b><Badge tone={r.status === 'signed' || r.status === 'completed' ? 'green' : r.status === 'declined' || r.status === 'failed' ? 'red' : 'gold'}>{(locale === 'en' ? ESIGN_STATUS_EN : ESIGN_STATUS)[r.status] ?? r.status}</Badge></div>
                    <div className="num mt-0.5 text-[11px] text-muted">{[r.signerNationalId, r.signerMobile].filter(Boolean).join(' · ')}</div>
                    <div className="num text-[11px] text-muted">{dateTime(r.createdAt)}{r.completedAt && ` · ${bi('اكتمل', 'Completed')} ${dateTime(r.completedAt)}`} · {r.provider}</div>
                    {r.signingUrl && !r.completedAt && <a href={r.signingUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-gold-dark hover:underline">{bi('رابط التوقيع ↗', 'Signing link ↗')}</a>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {contract.documents.length > 0 && (
            <Card title={bi('المستندات الصادرة', 'Issued documents')}>
              <ul className="space-y-1">
                {contract.documents.map((d) => (
                  <li key={d.id}>
                    <a href={`/api/files/${d.fileId}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-tint" title={`SHA-256: ${d.sha256}`}>
                      <span className="flex items-center gap-2"><Download className="size-4 text-gold" /><span className="num font-bold">{d.number}.pdf</span></span>
                      <span className="num text-[11px] text-muted">{dateTime(d.issuedAt)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <ConfirmDialog open={!!switchTo} title={bi(`تطبيق قالب «${templateSetLabel(switchTo)}»`, `Apply template “${templateSetLabel(switchTo, 'en')}”`)} confirmLabel={bi('تطبيق القالب', 'Apply template')} loading={busy === 'template'}
        message={<>{locale === 'en' ? <>All {draft.clauses.length} current contract clauses will be replaced with the active clauses of the “{templateSetLabel(switchTo, 'en')}” template from the clause library, and the title and payment schedule change if they are still on the defaults.</> : <>ستُستبدل جميع البنود القانونية الحالية ({draft.clauses.length}) ببنود قالب «{templateSetLabel(switchTo)}» المفعّلة من مكتبة البنود، ويتغير العنوان وجدول الدفعات إذا كانا على الإعدادات الافتراضية.</>}{dirty && <b className="mt-2 block text-danger">{bi('التعديلات غير المحفوظة ستُفقد.', 'Unsaved changes will be lost.')}</b>}</>}
        onConfirm={() => switchTo && void applyTemplate(switchTo)} onClose={() => setSwitchTo(null)} />
      <ClauseLibrary templateSet={contract.templateSet} open={dialog === 'clauses'} onClose={() => setDialog(null)} usedIds={new Set(draft.clauses.map((c) => c.templateId).filter((x): x is string => !!x))} onAdd={addClause} />
      {dialog === 'esign' && <EsignDialog open onClose={() => setDialog(null)} contract={contract} beforeSend={ensureSaved} onDone={applyView} />}
      {(Object.keys(T_META) as Transition[]).map((x) => T_META[x].reason ? (
        <ReasonDialog key={x} open={dialog === x} title={tLabel(x)} hint={tConfirm(x)} label={bi('السبب (اختياري)', 'Reason (optional)')} danger confirmLabel={tLabel(x)} loading={busy === 'status'} onConfirm={(r) => void transition(x, r)} onClose={() => setDialog(null)} />
      ) : (
        <ConfirmDialog key={x} open={dialog === x} title={tLabel(x)} message={tConfirm(x)} confirmLabel={tLabel(x)} loading={busy === 'status'} onConfirm={() => void transition(x)} onClose={() => setDialog(null)} />
      ))}
    </>
  );
}
