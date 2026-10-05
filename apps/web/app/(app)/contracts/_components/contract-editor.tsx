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
import { date, dateTime } from '@/lib/format';
import { BillingPanel } from '@/components/billing-panel';
import { Badge, Button, Card, clsx, Field, Input, Money, PageHeader, Select, StatusBadge, Table, Td, Textarea, Th } from '@/components/ui';
import { ConfirmDialog, errMsg, isConflict, NumInput, ReasonDialog } from '../../quotes/_components/common';
import { Menu } from '../../quotes/_components/menu';
import { newKey } from '../../quotes/_components/types';
import { ClauseLibrary } from './clause-library';
import { EsignDialog } from './esign-dialog';
import {
  blankLine, blankMilestone, calcContract, contractBody, contractDraft, contractProblems, percentSum, TRIGGERS, type ClauseTemplate, type ContractDraft, type ContractView, type DraftClause, type DraftLine, type DraftMilestone,
} from './types';

type Transition = 'sent_for_signature' | 'signed' | 'active' | 'completed' | 'terminated' | 'cancelled' | 'draft';
const TRANSITIONS: Record<string, Transition[]> = {
  draft: ['sent_for_signature', 'signed', 'cancelled'],
  sent_for_signature: ['signed', 'draft', 'cancelled'],
  signed: ['active', 'terminated'],
  active: ['completed', 'terminated'],
};
const T_META: Record<Transition, { label: string; confirm: string; danger?: boolean; reason?: boolean; icon: ReactNode }> = {
  sent_for_signature: { label: 'تعليم كمرسل للتوقيع', confirm: 'سيُعلَّم العقد «بانتظار التوقيع» دون إرسال طلب توقيع إلكتروني.', icon: <PenLine className="size-4" /> },
  signed: { label: 'تعليم كموقّع', confirm: 'سيُعلَّم العقد موقّعًا من الطرفين ويُقفل للتعديل.', icon: <CheckCircle2 className="size-4" /> },
  active: { label: 'تفعيل العقد', confirm: 'سيبدأ تنفيذ العقد اعتبارًا من اليوم.', icon: <Play className="size-4" /> },
  completed: { label: 'إكمال العقد', confirm: 'سيُعلَّم العقد مكتملًا بتاريخ اليوم.', icon: <CheckCircle2 className="size-4" /> },
  terminated: { label: 'إنهاء العقد', confirm: 'سيُنهى العقد قبل اكتماله.', danger: true, reason: true, icon: <XCircle className="size-4" /> },
  cancelled: { label: 'إلغاء العقد', confirm: 'سيُلغى العقد نهائيًا.', danger: true, reason: true, icon: <XCircle className="size-4" /> },
  draft: { label: 'إعادة إلى مسودة', confirm: 'سيعود العقد مسودة قابلة للتعديل (طلب التوقيع الحالي لن يكون صالحًا).', icon: <RotateCcw className="size-4" /> },
};

const ESIGN_STATUS: Record<string, string> = { created: 'أُنشئ', sent: 'أُرسل', viewed: 'تمت المشاهدة', signed: 'موقّع', completed: 'مكتمل', declined: 'مرفوض', expired: 'منتهي', failed: 'فشل' };

function ReadValue({ children }: { children: ReactNode }) {
  return <div className="min-h-[2.4rem] rounded-lg border border-line bg-gray-50 px-3 py-2 text-sm">{children || <span className="text-muted">—</span>}</div>;
}

export function ContractEditor({ contract }: { contract: ContractView }) {
  const qc = useQueryClient();
  const { me, can } = useMe();
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
  const [openClauses, setOpenClauses] = useState<Set<string>>(new Set());

  const { calc, schedule } = useMemo(() => calcContract(draft, contract.vatOn, vatRegistered), [draft, contract.vatOn, vatRegistered]);
  const t = calc.totals;
  const problems = useMemo(() => (editable ? contractProblems(draft) : []), [draft, editable]);
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
    toast.success(`أُضيف البند: ${tpl.titleAr}`);
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
      toast.success('تم حفظ العقد');
      return c;
    } catch (e) {
      if (isConflict(e)) toast.error('عدّل مستخدم آخر هذا العقد — أعد التحميل لرؤية آخر نسخة', { action: { label: 'إعادة التحميل', onClick: () => { loaded.current = ''; void qc.invalidateQueries({ queryKey: ['contract', contract.id] }); } }, duration: 10_000 });
      else toast.error(errMsg(e));
      return null;
    } finally {
      setBusy(null);
    }
  };
  const ensureSaved = async (): Promise<ContractView | null> => (dirty ? save() : contract);

  const transition = async (to: Transition, reason?: string) => {
    if (to !== 'draft' && to !== 'cancelled' && dirty && !(await save())) return;
    setBusy('status');
    try {
      const c = await api.post<ContractView>(`/contracts/${contract.id}/status`, { status: to, reason: reason || null });
      applyView(c);
      setDialog(null);
      toast.success(`تم: ${T_META[to].label}`);
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
        title={<span className="flex flex-wrap items-center gap-2">عقد <span className="num" dir="ltr">{contract.number}</span><StatusBadge status={contract.status} />{contract.stampApplied && <Badge tone="gold">مختوم</Badge>}{dirty && <Badge tone="gold">تعديلات غير محفوظة</Badge>}</span>}
        subtitle={<>
          {contract.quote && <>من العرض <Link href={`/quotes/${contract.quote.id}`} className="num font-bold text-gold-dark hover:underline" dir="ltr">{contract.quote.number}{contract.quote.revision ? `-R${contract.quote.revision}` : ''}</Link> · </>}
          بتاريخ <span className="num">{date(contract.contractDate)}</span>
          {contract.signedAt && <> · وُقّع <span className="num">{dateTime(contract.signedAt)}</span></>}
          {contract.startDate && <> · بدأ <span className="num">{date(contract.startDate)}</span></>}
          {contract.endDate && <> · انتهى <span className="num">{date(contract.endDate)}</span></>}
        </>}
        actions={<>
          {editable && <Button icon={<Save className="size-4" />} loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>حفظ</Button>}
          {canEsign && <Button variant="gold" icon={<PenLine className="size-4" />} onClick={() => { if (dirty && problems.length) { toast.error(problems[0]!); return; } setDialog('esign'); }}>توقيع إلكتروني</Button>}
          {primaryT && <Button variant={canEsign ? 'outline' : 'gold'} icon={T_META[primaryT].icon} onClick={() => setDialog(primaryT)}>{T_META[primaryT].label}</Button>}
          <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => void ensureSaved().then((c) => c && openFile(`/contracts/${c.id}/pdf`))}>PDF</Button>
          {canStamp && <Button variant="outline" icon={<Stamp className="size-4" />} onClick={() => { openFile(`/contracts/${contract.id}/pdf?stamp=1`); setTimeout(() => void qc.invalidateQueries({ queryKey: ['contract', contract.id] }), 4000); }}>PDF مختوم</Button>}
          {otherT.length > 0 && <Menu label="الحالة" items={otherT.map((x) => ({ label: T_META[x].label, icon: T_META[x].icon, danger: T_META[x].danger, onClick: () => setDialog(x) }))} />}
        </>}
      />

      {!editable && contract.status !== 'draft' && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <Lock className="size-4 shrink-0" />{contract.status === 'sent_for_signature' ? 'العقد بانتظار التوقيع — للتعديل أعده إلى مسودة أولًا.' : 'العقد للعرض فقط. أي تغيير بعد التوقيع يتم عبر أمر تغيير.'}
        </div>
      )}
      {editable && problems.length > 0 && dirty && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /><ul className="list-disc ps-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card title="بيانات العقد">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="عنوان العقد *">{editable ? <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} /> : <ReadValue>{draft.title}</ReadValue>}</Field>
              <Field label="العنوان الفرعي">{editable ? <Input value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /> : <ReadValue>{draft.subtitle}</ReadValue>}</Field>
              <Field label="تاريخ العقد *">{editable ? <Input type="date" value={draft.contractDate} onChange={(e) => set({ contractDate: e.target.value })} /> : <ReadValue><span className="num">{date(draft.contractDate)}</span></ReadValue>}</Field>
              <div className="grid grid-cols-2 gap-3">
                {intField('deliveryDaysMin', 'مدة التوريد من (يوم)')}
                {intField('deliveryDaysMax', 'إلى (يوم)')}
              </div>
              <div className="grid grid-cols-3 gap-3 md:col-span-2">
                {intField('warrantyMonths', 'الضمان (شهر)')}
                {intField('partsWarrantyMonths', 'ضمان القطع (شهر)')}
                {intField('sparePartsYears', 'توفر قطع الغيار (سنة)')}
              </div>
            </div>
          </Card>

          <Card title="الطرف الأول (العميل)">
            <div className="grid gap-3 md:grid-cols-2">
              {clientField('name', 'اسم العميل / المنشأة')}
              {clientField('representative', 'ممثل العميل')}
              {clientField('idNumber', 'رقم الهوية', true)}
              {clientField('crNumber', 'السجل التجاري / الرقم الموحد', true)}
              {clientField('vatNumber', 'الرقم الضريبي', true)}
              {clientField('mobile', 'الجوال', true)}
              {clientField('address', 'العنوان', false, true)}
            </div>
          </Card>

          <Card title="البنود" padded={false} actions={editable && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => set({ lines: [...draft.lines, blankLine()] })}>إضافة بند</Button>}>
            <Table>
              <thead><tr><Th className="w-8">#</Th><Th className="min-w-[7rem]">الرمز</Th><Th className="min-w-[14rem]">الوصف</Th><Th className="w-24">الكمية</Th><Th className="w-32">سعر الوحدة</Th><Th className="text-end">الإجمالي</Th>{editable && <Th className="w-10" />}</tr></thead>
              <tbody>
                {draft.lines.map((l, i) => (
                  <tr key={l.key} className="align-top">
                    <Td className="num text-center text-xs text-muted">{i + 1}</Td>
                    <Td>{editable ? <Input dir="ltr" value={l.code} onChange={(e) => setLine(i, { code: e.target.value })} className="px-2 text-xs" /> : <span className="num text-xs font-bold text-primary" dir="ltr">{l.code}</span>}</Td>
                    <Td>{editable ? <Textarea rows={2} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className="text-[13px]" /> : <span className="whitespace-pre-line text-sm">{l.description}</span>}</Td>
                    <Td>{editable ? <NumInput value={l.qty} onChange={(v) => setLine(i, { qty: v })} className="px-2 text-center" /> : <span className="num">{l.qty}</span>}</Td>
                    <Td>{editable ? <NumInput value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} className="px-2" /> : <Money value={l.unitPrice} fixed />}</Td>
                    <Td className="text-end">{calc.lines[i]?.isFree ? <span className="text-sm font-extrabold text-danger">FREE</span> : <Money value={calc.lines[i]?.amount ?? 0} fixed className="font-bold" />}</Td>
                    {editable && <Td><button type="button" onClick={() => set({ lines: draft.lines.filter((_, j) => j !== i) })} className="rounded p-1 text-danger hover:bg-rose-50" aria-label="حذف البند" title="حذف"><Trash2 className="size-4" /></button></Td>}
                  </tr>
                ))}
                {draft.lines.length === 0 && <tr><Td colSpan={7} className="py-6 text-center text-sm text-muted">لا توجد بنود</Td></tr>}
              </tbody>
            </Table>
          </Card>

          <Card title={<span className="flex items-center gap-2">البنود القانونية <span className="rounded-full bg-tint px-2 text-[11px] text-gold-dark">{draft.clauses.length}</span></span>}
            actions={<>
              <Button size="sm" variant="ghost" onClick={() => setOpenClauses(openClauses.size ? new Set() : new Set(draft.clauses.map((c) => c.key)))}>{openClauses.size ? 'طي الكل' : 'توسيع الكل'}</Button>
              {editable && <Button size="sm" variant="outline" icon={<BookOpen className="size-3.5" />} onClick={() => setDialog('clauses')}>من المكتبة</Button>}
              {editable && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => { const key = newKey(); set({ clauses: [...draft.clauses, { key, templateId: null, titleAr: '', bodyAr: '' }] }); setOpenClauses((s) => new Set(s).add(key)); }}>بند جديد</Button>}
            </>}
          >
            {draft.clauses.length === 0 ? <p className="py-4 text-center text-sm text-muted">لا توجد بنود قانونية</p> : (
              <ol className="space-y-2">
                {draft.clauses.map((c, i) => {
                  const isOpen = openClauses.has(c.key);
                  return (
                    <li key={c.key} className="rounded-xl border border-line">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-tint text-[11px] font-extrabold text-gold-dark">{i + 1}</span>
                        <button type="button" onClick={() => toggleClause(c.key)} className="flex min-w-0 flex-1 items-center gap-2 text-start" aria-expanded={isOpen}>
                          <span className={clsx('truncate text-sm font-bold', !c.titleAr && 'text-muted')}>{c.titleAr || 'بند بدون عنوان'}</span>
                          {!c.templateId && <Badge tone="gold">مخصص</Badge>}
                          <ChevronDown className={clsx('ms-auto size-4 shrink-0 text-muted transition', isOpen && 'rotate-180')} />
                        </button>
                        {editable && (
                          <div className="flex shrink-0 items-center">
                            <button type="button" className="rounded p-1 text-muted hover:bg-black/5 disabled:opacity-30" disabled={i === 0} onClick={() => set({ clauses: move(draft.clauses, i, -1) })} aria-label="أعلى"><ArrowUp className="size-3.5" /></button>
                            <button type="button" className="rounded p-1 text-muted hover:bg-black/5 disabled:opacity-30" disabled={i === draft.clauses.length - 1} onClick={() => set({ clauses: move(draft.clauses, i, 1) })} aria-label="أسفل"><ArrowDown className="size-3.5" /></button>
                            <button type="button" className="rounded p-1 text-danger hover:bg-rose-50" onClick={() => set({ clauses: draft.clauses.filter((_, j) => j !== i) })} aria-label="حذف البند"><Trash2 className="size-3.5" /></button>
                          </div>
                        )}
                      </div>
                      {isOpen && (
                        <div className="space-y-2 border-t border-line px-3 py-3">
                          {editable ? (
                            <>
                              <Field label="عنوان البند"><Input value={c.titleAr} onChange={(e) => setClause(i, { titleAr: e.target.value })} /></Field>
                              <Field label="نص البند" hint={c.bodyAr.includes('(45) إلى (60)') ? 'عبارة «(45) إلى (60)» تُستبدل تلقائيًا بمدة التوريد عند الطباعة' : undefined}>
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

          <Card title="جدول الدفعات" padded={false}
            actions={editable && <Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => set({ milestones: [...draft.milestones, blankMilestone(pctSum < 100 ? String(Math.round((100 - pctSum) * 10000) / 10000) : '')] })}>إضافة دفعة</Button>}
          >
            <Table>
              <thead><tr><Th className="w-8">#</Th><Th className="min-w-[12rem]">الدفعة</Th><Th className="w-24">النسبة %</Th><Th className="min-w-[10rem]">الاستحقاق</Th><Th className="min-w-[9rem]">تاريخ الاستحقاق</Th><Th className="text-end">المبلغ</Th>{!editable && <Th>الحالة</Th>}{editable && <Th className="w-20" />}</tr></thead>
              <tbody>
                {draft.milestones.map((m, i) => {
                  const server = contract.milestones[i];
                  const amount = !dirty && server ? server.amount : schedule ? schedule[i] ?? null : null;
                  return (
                    <tr key={m.key} className="align-top">
                      <Td className="num text-center text-xs text-muted">{i + 1}</Td>
                      <Td>{editable ? <Input value={m.nameAr} onChange={(e) => setMs(i, { nameAr: e.target.value })} placeholder="اسم الدفعة" /> : <span className="font-bold">{m.nameAr}</span>}</Td>
                      <Td>{editable ? <NumInput value={m.percent} onChange={(v) => setMs(i, { percent: v })} className="px-2 text-center" /> : <span className="num">{m.percent}%</span>}</Td>
                      <Td>{editable ? <Select value={m.trigger} onChange={(e) => setMs(i, { trigger: e.target.value as DraftMilestone['trigger'] })}>{TRIGGERS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select> : TRIGGERS.find((x) => x.value === m.trigger)?.label ?? m.trigger}</Td>
                      <Td>{editable ? <Input type="date" value={m.dueDate} onChange={(e) => setMs(i, { dueDate: e.target.value })} /> : <span className="num">{m.dueDate ? date(m.dueDate) : '—'}</span>}</Td>
                      <Td className="text-end">{amount === null ? <span className="text-muted">—</span> : <Money value={amount} fixed className="font-bold" />}</Td>
                      {!editable && <Td>{server && <><StatusBadge status={server.status} />{Number(server.paidAmount) > 0 && <div className="mt-0.5 text-[11px] text-muted">مدفوع <Money value={server.paidAmount} /></div>}</>}</Td>}
                      {editable && (
                        <Td>
                          <div className="flex items-center">
                            <button type="button" className="rounded p-1 text-muted hover:bg-black/5 disabled:opacity-30" disabled={i === 0} onClick={() => set({ milestones: move(draft.milestones, i, -1) })} aria-label="أعلى"><ArrowUp className="size-3.5" /></button>
                            <button type="button" className="rounded p-1 text-danger hover:bg-rose-50 disabled:opacity-30" disabled={draft.milestones.length <= 1} onClick={() => set({ milestones: draft.milestones.filter((_, j) => j !== i) })} aria-label="حذف الدفعة"><Trash2 className="size-3.5" /></button>
                          </div>
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-tint/40">
                  <Td colSpan={2} className="text-xs font-extrabold text-gold-dark">المجموع</Td>
                  <Td><span className={clsx('num font-extrabold', Math.abs(pctSum - 100) > 1e-9 ? 'text-danger' : 'text-ok')}>{pctSum}%</span></Td>
                  <Td colSpan={2} className="text-xs">{Math.abs(pctSum - 100) > 1e-9 ? <span className="font-bold text-danger">يجب أن يساوي المجموع 100% ({pctSum < 100 ? `متبقٍ ${Math.round((100 - pctSum) * 10000) / 10000}%` : `زيادة ${Math.round((pctSum - 100) * 10000) / 10000}%`})</span> : <span className="text-ok">✓ مكتمل</span>}</Td>
                  <Td className="text-end"><Money value={t.total} fixed className="font-extrabold" /></Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          </Card>

          {contract.status !== 'draft' && can('billing.read') && (
            <Card title="الفوترة والتحصيل">
              <BillingPanel contractId={contract.id} />
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          <Card title="قيمة العقد">
            <div className="divide-y divide-line/60 text-sm">
              <div className="flex justify-between py-1.5"><span>المجموع</span><Money value={t.subtotal} fixed className="font-bold" /></div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span>الخصم</span>
                {editable ? <NumInput value={draft.discountAmount} onChange={(v) => set({ discountAmount: v })} placeholder="0" className="max-w-[9rem] px-2 py-1" ariaLabel="مبلغ الخصم" /> : <span className="font-bold text-danger">{t.discount ? <>−<Money value={t.discount} fixed /></> : '—'}</span>}
              </div>
              {t.discount > 0 && <div className="flex justify-between py-1.5"><span>بعد الخصم</span><Money value={t.taxable} fixed className="font-bold" /></div>}
              <div className="flex justify-between py-1.5"><span>{t.vatApplied ? `ضريبة القيمة المضافة ${t.vatRate}%` : 'ضريبة القيمة المضافة'}</span>{t.vatApplied ? <Money value={t.vat} fixed className="font-bold" /> : <span className="text-muted">{vatRegistered ? 'غير مضافة' : 'غير مسجلة'}</span>}</div>
              <div className="flex justify-between py-2 text-base font-extrabold text-primary"><span>الإجمالي</span><Money value={t.total} fixed /></div>
            </div>
            {t.total > 0 && <p className="mt-2 rounded-lg bg-tint/60 px-3 py-2 text-xs leading-relaxed text-gold-dark">فقط {tafqitHalalas(t.total)} لا غير</p>}
            {!vatRegistered && <p className="mt-2 text-xs font-bold text-amber-800">المنشأة غير مسجلة في ضريبة القيمة المضافة</p>}
          </Card>

          {contract.esignRequests.length > 0 && (
            <Card title="طلبات التوقيع الإلكتروني">
              <ul className="space-y-3">
                {contract.esignRequests.map((r) => (
                  <li key={r.id} className="border-s-2 border-line ps-3 text-sm">
                    <div className="flex items-center justify-between gap-2"><b>{r.signerName}</b><Badge tone={r.status === 'signed' || r.status === 'completed' ? 'green' : r.status === 'declined' || r.status === 'failed' ? 'red' : 'gold'}>{ESIGN_STATUS[r.status] ?? r.status}</Badge></div>
                    <div className="num mt-0.5 text-[11px] text-muted">{[r.signerNationalId, r.signerMobile].filter(Boolean).join(' · ')}</div>
                    <div className="num text-[11px] text-muted">{dateTime(r.createdAt)}{r.completedAt && ` · اكتمل ${dateTime(r.completedAt)}`} · {r.provider}</div>
                    {r.signingUrl && !r.completedAt && <a href={r.signingUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-gold-dark hover:underline">رابط التوقيع ↗</a>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {contract.documents.length > 0 && (
            <Card title="المستندات الصادرة">
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

      <ClauseLibrary open={dialog === 'clauses'} onClose={() => setDialog(null)} usedIds={new Set(draft.clauses.map((c) => c.templateId).filter((x): x is string => !!x))} onAdd={addClause} />
      {dialog === 'esign' && <EsignDialog open onClose={() => setDialog(null)} contract={contract} beforeSend={ensureSaved} onDone={applyView} />}
      {(Object.keys(T_META) as Transition[]).map((x) => T_META[x].reason ? (
        <ReasonDialog key={x} open={dialog === x} title={T_META[x].label} hint={T_META[x].confirm} label="السبب (اختياري)" danger confirmLabel={T_META[x].label} loading={busy === 'status'} onConfirm={(r) => void transition(x, r)} onClose={() => setDialog(null)} />
      ) : (
        <ConfirmDialog key={x} open={dialog === x} title={T_META[x].label} message={T_META[x].confirm} confirmLabel={T_META[x].label} loading={busy === 'status'} onConfirm={() => void transition(x)} onClose={() => setDialog(null)} />
      ))}
    </>
  );
}
