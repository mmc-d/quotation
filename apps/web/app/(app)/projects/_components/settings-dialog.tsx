'use client';
import { useState } from 'react';
import { APPROVAL_KINDS, APPROVAL_LABELS } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { UserSelect } from '@/components/user-select';
import { NumInput } from '../../quotes/_components/common';
import type { useProjectAction } from './kit';
import { PROJECT_STATUS, TEMPLATES, type ProjectView } from './types';

const init = (p: ProjectView) => ({
  name: p.name, managerId: p.managerId, templateKey: p.templateKey, requiredApprovals: [...(p.requiredApprovals ?? [])] as string[],
  clockMinDays: String(p.clockMinDays), clockMaxDays: String(p.clockMaxDays), warrantyLabourMonths: String(p.warrantyLabourMonths), warrantyPartsMonths: String(p.warrantyPartsMonths),
  materialsReady: p.materialsReady, plannedStart: p.plannedStart ?? '', notes: p.notes ?? '', status: p.status,
});

export function SettingsDialog({ p, open, onClose, action }: { p: ProjectView; open: boolean; onClose: () => void; action: ReturnType<typeof useProjectAction> }) {
  return open ? <SettingsForm p={p} onClose={onClose} action={action} /> : null;
}

function SettingsForm({ p, onClose, action }: { p: ProjectView; onClose: () => void; action: ReturnType<typeof useProjectAction> }) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const [f, setF] = useState(() => init(p));
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const approvalsLocked = p.stage !== 'kickoff' && !can('project.override');
  const n = (v: string) => Number(v);
  const minD = n(f.clockMinDays), maxD = n(f.clockMaxDays);
  const problem = !f.name.trim() ? bi('اسم المشروع مطلوب', 'The project name is required')
    : !(minD >= 1 && maxD >= 1) ? bi('أدخل مدة التوريد', 'Enter the delivery window')
    : minD > maxD ? bi('الحد الأدنى للمدة أكبر من الحد الأقصى', 'The minimum window exceeds the maximum') : null;
  const statuses = p.status === 'closed' ? [] : ['active', 'on_hold', ...(can('project.override') || p.status === 'cancelled' ? ['cancelled'] : [])];

  const save = async () => {
    const body: Record<string, unknown> = {
      name: f.name.trim(), managerId: f.managerId, templateKey: f.templateKey,
      clockMinDays: minD, clockMaxDays: maxD, warrantyLabourMonths: n(f.warrantyLabourMonths || '0'), warrantyPartsMonths: n(f.warrantyPartsMonths || '0'),
      materialsReady: f.materialsReady, plannedStart: f.plannedStart || null, notes: f.notes.trim() || null, version: p.version,
    };
    if (!approvalsLocked && JSON.stringify([...f.requiredApprovals].sort()) !== JSON.stringify([...(p.requiredApprovals ?? [])].sort())) body.requiredApprovals = f.requiredApprovals;
    if (statuses.length && f.status !== p.status) body.status = f.status;
    const r = await action.run('settings', () => api.put<ProjectView>(`/projects/${p.id}`, body), bi('تم حفظ إعدادات المشروع', 'Project settings saved'));
    if (r) onClose();
  };

  return (
    <Dialog open onClose={onClose} wide title={bi('إعدادات المشروع', 'Project settings')}
      footer={<><span className="me-auto self-center text-xs text-danger">{problem}</span><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={action.busy === 'settings'} disabled={!!problem} onClick={() => void save()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('اسم المشروع *', 'Project name *')} className="sm:col-span-2"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label={bi('مدير المشروع', 'Project manager')}><UserSelect value={f.managerId} onChange={(v) => set({ managerId: v })} /></Field>
        <Field label={bi('قالب المشروع', 'Project template')} hint={f.templateKey !== p.templateKey ? bi('تغيير القالب يستبدل المهام غير المبدوءة وغير المسندة بمهام القالب الجديد.', 'Changing the template replaces untouched, unassigned tasks with the new template’s tasks.') : undefined}>
          <Select value={f.templateKey} onChange={(e) => set({ templateKey: e.target.value })}>
            {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{locale === 'en' ? t.en : t.ar}</option>)}
          </Select>
        </Field>
        <Field label={bi('مدة التوريد — من (يوم عمل)', 'Delivery window — min (working days)')}><NumInput value={f.clockMinDays} onChange={(v) => set({ clockMinDays: v.replace(/[^\d]/g, '') })} step="1" min={1} /></Field>
        <Field label={bi('إلى (يوم عمل)', 'Max (working days)')}><NumInput value={f.clockMaxDays} onChange={(v) => set({ clockMaxDays: v.replace(/[^\d]/g, '') })} step="1" min={1} /></Field>
        <Field label={bi('ضمان العمالة (شهر)', 'Labour warranty (months)')}><NumInput value={f.warrantyLabourMonths} onChange={(v) => set({ warrantyLabourMonths: v.replace(/[^\d]/g, '') })} step="1" /></Field>
        <Field label={bi('ضمان القطع (شهر)', 'Parts warranty (months)')}><NumInput value={f.warrantyPartsMonths} onChange={(v) => set({ warrantyPartsMonths: v.replace(/[^\d]/g, '') })} step="1" /></Field>
        <Field label={bi('تاريخ البدء المخطط', 'Planned start')}><Input type="date" value={f.plannedStart} onChange={(e) => set({ plannedStart: e.target.value })} /></Field>
        {statuses.length > 0 && (
          <Field label={bi('حالة المشروع', 'Project status')}>
            <Select value={f.status} onChange={(e) => set({ status: e.target.value })}>
              {statuses.map((s) => <option key={s} value={s}>{locale === 'en' ? PROJECT_STATUS[s]!.en : PROJECT_STATUS[s]!.ar}</option>)}
            </Select>
          </Field>
        )}
        <div className="sm:col-span-2"><Checkbox label={bi('المواد جاهزة (شرط الانتقال إلى التوريد للموقع)', 'Materials ready (gate to delivery to site)')} checked={f.materialsReady} onChange={(v) => set({ materialsReady: v })} /></div>
        <fieldset className="rounded-xl border border-line p-3 sm:col-span-2">
          <legend className="px-1 text-xs font-bold text-gold-dark">{bi('اعتمادات العميل المطلوبة لبدء المدة', 'Client approvals required to start the clock')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {APPROVAL_KINDS.map((k) => (
              <Checkbox key={k} disabled={approvalsLocked} label={locale === 'en' ? APPROVAL_LABELS[k].en : APPROVAL_LABELS[k].ar} checked={f.requiredApprovals.includes(k)}
                onChange={(v) => set({ requiredApprovals: v ? [...f.requiredApprovals, k] : f.requiredApprovals.filter((x) => x !== k) })} />
            ))}
          </div>
          {approvalsLocked && <p className="mt-2 text-xs text-muted">{bi('تغيير الاعتمادات المطلوبة بعد الانطلاق يحتاج صلاحية التجاوز.', 'Changing required approvals after kick-off needs the override permission.')}</p>}
        </fieldset>
        <Field label={bi('ملاحظات', 'Notes')} className="sm:col-span-2"><Textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
