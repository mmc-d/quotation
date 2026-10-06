'use client';
import { useState } from 'react';
import { Eye, FileDown, Stamp } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Button, Card, Field, Input } from '@/components/ui';
import type { useProjectAction } from './kit';
import type { ProjectView } from './types';

export function HandoverCard({ p, action }: { p: ProjectView; action: ReturnType<typeof useProjectAction> }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const [form, setForm] = useState({ acceptedOn: p.acceptedOn ?? today(), acceptedByName: p.acceptedByName ?? p.customer?.nameAr ?? '' });
  const canAccept = can('project.write') && p.stage === 'handover';
  const minDate = p.deliveredOn ?? undefined;

  const accept = () => action.run('accept', () => api.post<ProjectView>(`/projects/${p.id}/accept`, { acceptedOn: form.acceptedOn, acceptedByName: form.acceptedByName.trim() }), bi('سُجّل محضر الاستلام', 'Acceptance recorded'));

  return (
    <Card title={bi('التسليم والاستلام', 'Handover & acceptance')}
      actions={!p.assetsHidden && <>
        <Button size="sm" variant="outline" icon={<Eye className="size-3.5" />} onClick={() => openFile(`/projects/${p.id}/handover`)}>{bi('معاينة ملف التسليم', 'Preview handover package')}</Button>
        <Button size="sm" variant="outline" icon={<FileDown className="size-3.5" />} onClick={() => openFile(`/projects/${p.id}/handover.pdf`)}>PDF</Button>
      </>}>
      {p.acceptedOn && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <Stamp className="mt-0.5 size-4 shrink-0" />
          <span>{bi('استلم العميل المشروع بتاريخ', 'The client accepted the project on')} <b className="num">{date(p.acceptedOn)}</b> — {p.acceptedByName}. {bi(`يبدأ الضمان من هذا التاريخ (عمالة ${p.warrantyLabourMonths} شهرًا، قطع ${p.warrantyPartsMonths} شهرًا).`, `The warranty starts on this date (labour ${p.warrantyLabourMonths} months, parts ${p.warrantyPartsMonths} months).`)}</span>
        </div>
      )}
      {canAccept ? (
        <div className="grid items-end gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
          <Field label={bi('تاريخ الاستلام *', 'Acceptance date *')}><Input type="date" min={minDate} max={today()} value={form.acceptedOn} onChange={(e) => setForm({ ...form, acceptedOn: e.target.value })} /></Field>
          <Field label={bi('استلمه (اسم ممثل العميل) *', 'Accepted by (client representative) *')}><Input value={form.acceptedByName} onChange={(e) => setForm({ ...form, acceptedByName: e.target.value })} /></Field>
          <Button loading={action.busy === 'accept'} disabled={!form.acceptedOn || !form.acceptedByName.trim()} onClick={() => void accept()}>{p.acceptedOn ? bi('تحديث المحضر', 'Update acceptance') : bi('تسجيل الاستلام', 'Record acceptance')}</Button>
        </div>
      ) : !p.acceptedOn && <p className="text-sm text-muted">{bi('يُسجَّل محضر الاستلام في مرحلة التسليم.', 'Acceptance is recorded in the handover stage.')}</p>}
      {p.assetsHidden && <p className="mt-2 text-xs text-muted">{bi('ملف التسليم يحتاج صلاحية عرض الأجهزة.', 'The handover package needs permission to view devices.')}</p>}
    </Card>
  );
}
