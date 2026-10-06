'use client';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldAlert, Undo2, XCircle } from 'lucide-react';
import { PROJECT_STAGES } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Button, Card, clsx } from '@/components/ui';
import { ConfirmDialog, ReasonDialog } from '../../quotes/_components/common';
import { stageLabel, type useProjectAction } from './kit';
import type { ProjectView } from './types';

export function GateCard({ p, action }: { p: ProjectView; action: ReturnType<typeof useProjectAction> }) {
  const { bi, locale, dir } = useI18n();
  const { can } = useMe();
  const [dlg, setDlg] = useState<null | 'advance' | 'override' | 'back'>(null);
  const { gate } = p;
  const closed = p.stage === 'closed';
  const active = p.status === 'active';
  const prev = PROJECT_STAGES[PROJECT_STAGES.indexOf(p.stage) - 1];
  const Arrow = dir === 'rtl' ? ArrowLeft : ArrowRight;
  const next = stageLabel(gate.to, locale);

  const advance = async (override?: string) => {
    const r = await action.run('advance', () => api.post<ProjectView>(`/projects/${p.id}/advance`, override !== undefined ? { override: true, reason: override } : {}),
      bi(`انتقل المشروع إلى «${next}»`, `Project moved to “${next}”`));
    if (r) setDlg(null);
  };
  const back = async (reason: string) => {
    if (!prev) return;
    const r = await action.run('back', () => api.post<ProjectView>(`/projects/${p.id}/stage`, { to: prev, reason }), bi('أُعيد المشروع مرحلة واحدة', 'Project moved back one stage'));
    if (r) setDlg(null);
  };

  return (
    <Card title={closed ? bi('المشروع مغلق', 'Project closed') : <>{bi('المرحلة التالية:', 'Next stage:')} {next}</>}
      actions={can('project.override') && prev && <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => setDlg('back')}>{bi('رجوع مرحلة', 'Move back')}</Button>}>
      {closed ? <p className="text-sm text-muted">{bi('اكتملت جميع مراحل المشروع.', 'All project stages are complete.')}</p> : (
        <>
          {gate.checks.length === 0 ? (
            <p className="mb-3 text-sm text-muted">{bi('لا توجد شروط لهذه المرحلة — انقل المشروع يدويًا عند الانتهاء.', 'This stage has no gate — move the project manually when done.')}</p>
          ) : (
            <ul className="mb-3 space-y-1.5">
              {gate.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                  <span className={clsx(c.ok ? 'text-ink' : 'font-bold text-danger')}>{bi(c.ar, c.en)}</span>
                </li>
              ))}
            </ul>
          )}
          {!active && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{bi('المشروع غير نشط — لا يمكن نقله لمرحلة أخرى.', 'The project is not active — it cannot change stage.')}</p>}
          {can('project.write') && active && (
            <div className="flex flex-wrap gap-2">
              <Button variant="gold" disabled={!gate.ok} loading={action.busy === 'advance'} onClick={() => setDlg('advance')} icon={<Arrow className="size-4" />}>
                {bi(`نقل إلى «${next}»`, `Advance to “${next}”`)}
              </Button>
              {!gate.ok && can('project.override') && (
                <Button variant="outline" icon={<ShieldAlert className="size-4" />} onClick={() => setDlg('override')}>{bi('تجاوز الشروط…', 'Override…')}</Button>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog open={dlg === 'advance'} title={bi('نقل المرحلة', 'Advance stage')} loading={action.busy === 'advance'} onClose={() => setDlg(null)} onConfirm={() => void advance()}
        message={<>
          {bi(`سينتقل المشروع من «${stageLabel(p.stage, locale)}» إلى «${next}».`, `The project will move from “${stageLabel(p.stage, locale)}” to “${next}”.`)}
          {p.stage === 'kickoff' && <p className="mt-2 text-xs text-muted">{bi('تبدأ مدة التوريد التعاقدية بالانتقال من مرحلة الانطلاق.', 'The contractual delivery clock starts when leaving kick-off.')}</p>}
          {gate.to === 'handover' && <p className="mt-2 text-xs text-muted">{bi('تتوقف مدة التوريد عند بلوغ مرحلة التسليم.', 'The delivery clock stops when the handover stage is reached.')}</p>}
          {gate.to === 'warranty' && <p className="mt-2 text-xs text-muted">{bi('يبدأ الضمان من تاريخ محضر الاستلام وتُحدَّث تواريخ ضمان الأجهزة.', 'The warranty starts on the acceptance date and device warranty dates are updated.')}</p>}
        </>} />
      <ReasonDialog open={dlg === 'override'} required danger title={bi('تجاوز شروط المرحلة', 'Override the stage gate')} loading={action.busy === 'advance'} onClose={() => setDlg(null)} onConfirm={(r) => void advance(r)}
        confirmLabel={bi(`تجاوز ونقل إلى «${next}»`, `Override and advance to “${next}”`)}
        hint={<>
          {bi('الشروط غير المستوفاة التالية ستُسجَّل كتجاوز في سجل المشروع:', 'The following unmet checks will be logged as overridden:')}
          <ul className="mt-1 list-disc ps-5 text-danger">{gate.checks.filter((c) => !c.ok).map((c) => <li key={c.key}>{bi(c.ar, c.en)}</li>)}</ul>
        </>} />
      <ReasonDialog open={dlg === 'back'} required title={bi('إرجاع المشروع مرحلة واحدة', 'Move the project back one stage')} loading={action.busy === 'back'} onClose={() => setDlg(null)} onConfirm={(r) => void back(r)}
        hint={prev && bi(`سيعود المشروع إلى «${stageLabel(prev, locale)}».`, `The project will return to “${stageLabel(prev, locale)}”.`)} />
    </Card>
  );
}
