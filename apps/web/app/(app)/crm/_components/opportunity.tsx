'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DEFAULT_LOST_REASONS } from '@mmc/domain';
import { api } from '@/lib/api';
import { Button, Dialog, ErrorBox, Field, Input, Select, Textarea } from '@/components/ui';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { UserSelect } from '@/components/user-select';
import { useI18n } from '@/lib/i18n';
import { PROJECT_LABELS, PROJECT_LABELS_EN, PROJECT_TYPES, type LostReason, type Opportunity, type Stage } from './labels';

export interface PipelineData {
  pipeline: { id: string; name: string };
  stages: Stage[];
  lostReasons: LostReason[];
  opportunities: Opportunity[];
}

export const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());

/** Lost reasons configured for the tenant (falls back to the domain defaults). */
export function useLostReasons(enabled = true): LostReason[] {
  const q = useQuery({ queryKey: ['pipeline', '', ''], queryFn: () => api.get<PipelineData>('/crm/pipeline'), enabled, staleTime: 60_000 });
  const rows = q.data?.lostReasons ?? [];
  return rows.length ? rows : DEFAULT_LOST_REASONS.map((r) => ({ id: r.key, key: r.key, nameAr: r.name_ar, nameEn: r.name_en }));
}

/** Move an opportunity to a stage (lost stages need a reason). */
export function useMoveStage(onDone?: () => void) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; stageId: string; lostReasonKey?: string | null; lostNote?: string | null }) => api.post<Opportunity>(`/crm/opportunities/${v.id}/stage`, { stageId: v.stageId, lostReasonKey: v.lostReasonKey ?? null, lostNote: v.lostNote ?? null }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      qc.invalidateQueries({ queryKey: ['opportunity', v.id] });
      toast.success(bi('تم نقل الفرصة', 'Opportunity moved'));
      onDone?.();
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      toast.error((e as Error).message);
    },
  });
}

export function LostDialog({ open, reasons, onClose, onConfirm, loading }: { open: boolean; reasons: LostReason[]; onClose: () => void; onConfirm: (reasonKey: string, note: string | null) => void; loading?: boolean }) {
  const { bi, locale } = useI18n();
  const [key, setKey] = useState('');
  const [note, setNote] = useState('');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={bi('تسجيل خسارة الفرصة', 'Mark opportunity as lost')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button variant="danger" loading={loading} disabled={!key} onClick={() => onConfirm(key, note.trim() || null)}>{bi('تأكيد الخسارة', 'Confirm loss')}</Button></>}
    >
      <div className="space-y-3">
        <Field label={bi('سبب الخسارة *', 'Loss reason *')}>
          <Select value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">{bi('— اختر السبب —', '— Choose a reason —')}</option>
            {reasons.map((r) => <option key={r.key} value={r.key}>{locale === 'en' ? r.nameEn || r.nameAr : r.nameAr}</option>)}
          </Select>
        </Field>
        <Field label={bi('ملاحظة (اختياري)', 'Note (optional)')}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={bi('مثال: اختار المنافس بسعر أقل بـ 10%', 'e.g. chose a competitor 10% cheaper')} /></Field>
      </div>
    </Dialog>
  );
}

export function NewOpportunityDialog({ open, onClose, onCreated, initialParty }: { open: boolean; onClose: () => void; onCreated?: (o: Opportunity) => void; initialParty?: PickedParty | null }) {
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [party, setParty] = useState<PickedParty | null>(initialParty ?? null);
  const [amount, setAmount] = useState('');
  const [expectedClose, setExpectedClose] = useState('');
  const [projectType, setProjectType] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const reset = () => { setTitle(''); setParty(initialParty ?? null); setAmount(''); setExpectedClose(''); setProjectType(''); setOwnerId(null); };
  const save = useMutation({
    mutationFn: () => api.put<Opportunity>('/crm/opportunities/new', { title: title.trim(), partyId: party?.id ?? null, amount: amount.trim() || '0', expectedClose: expectedClose || null, projectType: projectType || null, ownerId, competitors: [] }),
    onSuccess: (o) => { qc.invalidateQueries({ queryKey: ['pipeline'] }); toast.success(bi('أُضيفت الفرصة', 'Opportunity added')); reset(); onClose(); onCreated?.(o); },
  });
  const amountOk = !amount.trim() || isMoney(amount);
  return (
    <Dialog
      open={open}
      onClose={() => { save.reset(); onClose(); }}
      title={bi('فرصة جديدة', 'New opportunity')}
      footer={<><Button variant="outline" onClick={() => { save.reset(); onClose(); }}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!title.trim() || !amountOk} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={bi('عنوان الفرصة *', 'Opportunity title *')} className="md:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={bi('مثال: انتركوم عمارة حي النرجس', 'e.g. Intercom for an Al-Narjis building')} /></Field>
        <Field label={bi('العميل', 'Customer')} className="md:col-span-2"><PartyPicker value={party} onChange={setParty} /></Field>
        <Field label={bi('القيمة التقديرية (ر.س)', 'Estimated value (SAR)')} error={amountOk ? null : bi('قيمة غير صحيحة', 'Invalid amount')}><Input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></Field>
        <Field label={bi('تاريخ الإغلاق المتوقع', 'Expected close date')}><Input type="date" value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} /></Field>
        <Field label={bi('نوع المشروع', 'Project type')}>
          <Select value={projectType} onChange={(e) => setProjectType(e.target.value)}>
            <option value="">—</option>
            {PROJECT_TYPES.map((p) => <option key={p} value={p}>{(locale === 'en' ? PROJECT_LABELS_EN : PROJECT_LABELS)[p] ?? p}</option>)}
          </Select>
        </Field>
        <Field label={bi('المسؤول', 'Owner')}><UserSelect value={ownerId} onChange={setOwnerId} emptyLabel={bi('— أنا —', '— Me —')} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={save.error} /></div>
    </Dialog>
  );
}
