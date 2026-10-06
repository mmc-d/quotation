'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Dialog, Field, Input } from '@/components/ui';
import { ProjectPicker, WarehouseSelect, errMsg, type PickedProject } from './common';
import { LinesEditor, newLine, toApiLines, type LineDraft } from './lines-editor';

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['inv-stock', 'inv-moves', 'inv-transfers', 'inv-stock-one', 'inv-warehouses', 'inv-reorder', 'project-consumption']) qc.invalidateQueries({ queryKey: [k] });
  };
}

/** New stock transfer (draft): from → to, lines. */
export function NewTransferDialog({ open, onClose, defaultFrom }: { open: boolean; onClose: () => void; defaultFrom?: string | null }) {
  const { bi } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const [from, setFrom] = useState<string | null>(defaultFrom ?? null);
  const [to, setTo] = useState<string | null>(null);
  const [project, setProject] = useState<PickedProject | null>(null);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const reset = () => { setFrom(defaultFrom ?? null); setTo(null); setProject(null); setNotes(''); setLines([newLine()]); };
  const save = useMutation({
    mutationFn: () => {
      if (!from || !to) throw new Error(bi('اختر المستودع المصدر والوجهة', 'Pick the source and destination warehouses'));
      const r = toApiLines(lines, bi);
      if ('error' in r) throw new Error(r.error);
      return api.post<{ id: string; number: string }>('/inventory/transfers', { fromWarehouseId: from, toWarehouseId: to, projectId: project?.id ?? null, notes: notes.trim() || null, lines: r.lines });
    },
    onSuccess: (t) => {
      toast.success(bi(`أُنشئ التحويل ${t.number}`, `Transfer ${t.number} created`));
      invalidate();
      reset();
      onClose();
      router.push(`/inventory/transfers/${t.id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const close = () => { reset(); onClose(); };
  return (
    <Dialog open={open} onClose={close} wide title={bi('تحويل مخزني جديد', 'New stock transfer')}
      footer={<><Button variant="outline" onClick={close}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{bi('إنشاء مسودة', 'Create draft')}</Button></>}>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <Field label={bi('من مستودع', 'From warehouse')}><WarehouseSelect value={from} onChange={setFrom} exclude={to} excludeTransit /></Field>
        <Field label={bi('إلى مستودع', 'To warehouse')}><WarehouseSelect value={to} onChange={setTo} exclude={from} excludeTransit /></Field>
        <Field label={bi('المشروع (اختياري)', 'Project (optional)')} hint={bi('تنتقل حجوزات المشروع مع البضاعة', "The project's reservations follow the goods")}><ProjectPicker value={project} onChange={setProject} /></Field>
        <Field label={bi('ملاحظات', 'Notes')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <LinesEditor lines={lines} onChange={setLines} />
    </Dialog>
  );
}

/** Issue to a project (POST /inventory/issue) or return from a project (POST /inventory/returns). */
export function ProjectStockDialog({ mode, open, onClose, defaultProject }: { mode: 'issue' | 'return'; open: boolean; onClose: () => void; defaultProject?: PickedProject | null }) {
  const { bi } = useI18n();
  const invalidate = useInvalidate();
  const [wh, setWh] = useState<string | null>(null);
  const [project, setProject] = useState<PickedProject | null>(defaultProject ?? null);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const reset = () => { setWh(null); setProject(defaultProject ?? null); setNote(''); setLines([newLine()]); };
  const save = useMutation({
    mutationFn: () => {
      if (!project) throw new Error(bi('اختر المشروع', 'Pick the project'));
      if (!wh) throw new Error(bi('اختر المستودع', 'Pick the warehouse'));
      const r = toApiLines(lines, bi);
      if ('error' in r) throw new Error(r.error);
      return mode === 'issue'
        ? api.post('/inventory/issue', { fromWarehouseId: wh, projectId: project.id, note: note.trim() || null, lines: r.lines })
        : api.post('/inventory/returns', { toWarehouseId: wh, projectId: project.id, note: note.trim() || null, lines: r.lines });
    },
    onSuccess: () => {
      toast.success(mode === 'issue' ? bi('تم الصرف للمشروع', 'Issued to the project') : bi('تم استلام المرتجع', 'Return received'));
      invalidate();
      reset();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const close = () => { reset(); onClose(); };
  return (
    <Dialog open={open} onClose={close} wide title={mode === 'issue' ? bi('صرف مواد لمشروع', 'Issue to project') : bi('مرتجع من مشروع', 'Return from project')}
      footer={<><Button variant="outline" onClick={close}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{mode === 'issue' ? bi('صرف', 'Issue') : bi('استلام المرتجع', 'Receive return')}</Button></>}>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <Field label={bi('المشروع', 'Project')}><ProjectPicker value={project} onChange={setProject} /></Field>
        <Field label={mode === 'issue' ? bi('من مستودع', 'From warehouse') : bi('إلى مستودع', 'Into warehouse')}><WarehouseSelect value={wh} onChange={setWh} excludeTransit /></Field>
        <Field className="sm:col-span-2" label={bi('ملاحظة', 'Note')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <p className="mb-2 text-xs text-muted">{mode === 'issue' ? bi('تخرج البضاعة بمتوسط التكلفة وتُحمّل على المشروع، وتُستهلك حجوزاته في هذا المستودع.', 'Goods leave at average cost, charged to the project; its reservations in this warehouse are consumed.') : bi('تعود البضاعة إلى المستودع بمتوسط التكلفة.', 'Goods come back into the warehouse at average cost.')}</p>
      <LinesEditor lines={lines} onChange={setLines} />
    </Dialog>
  );
}
