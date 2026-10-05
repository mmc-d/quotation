'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, clsx, Dialog, ErrorBox, Input, Spinner } from '@/components/ui';
import { TEMPLATE_SETS, type ClauseTemplate, type TemplateSet } from './types';

/** Clause library (GET /settings/clauses): pick verbatim clauses to append to the contract. */
export function ClauseLibrary({ open, onClose, usedIds, onAdd, templateSet }: { open: boolean; onClose: () => void; usedIds: Set<string>; onAdd: (t: ClauseTemplate) => void; templateSet?: TemplateSet }) {
  const [q, setQ] = useState('');
  const [set, setSet] = useState<TemplateSet | 'all'>(templateSet ?? 'all');
  const res = useQuery({ queryKey: ['clause-templates'], queryFn: () => api.get<ClauseTemplate[]>('/settings/clauses'), enabled: open, staleTime: 300_000 });
  const rows = useMemo(() => {
    const term = q.trim();
    return (res.data ?? []).filter((t) => t.active && (set === 'all' || t.templateSet === set) && (!term || t.titleAr.includes(term) || t.bodyAr.includes(term) || t.category.includes(term)));
  }, [res.data, q, set]);
  return (
    <Dialog open={open} onClose={onClose} wide title="مكتبة البنود القانونية" footer={<Button onClick={onClose}>تم</Button>}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في البنود…" className="min-w-[12rem] flex-1" />
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="قالب العقد">
          {[{ value: 'all' as const, label: 'كل القوالب' }, ...TEMPLATE_SETS].map((t) => (
            <button key={t.value} type="button" role="tab" aria-selected={set === t.value} onClick={() => setSet(t.value)} className={clsx('rounded-full border px-3 py-1 text-xs font-bold', set === t.value ? 'border-primary bg-primary text-white' : 'border-line bg-white hover:bg-tint')}>{t.label}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={res.error} />
      {res.isLoading ? <Spinner /> : rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">لا توجد بنود</p> : (
        <ul className="space-y-2">
          {rows.map((t) => {
            const used = usedIds.has(t.id);
            return (
              <li key={t.id} className={clsx('rounded-xl border p-3', used ? 'border-primary/30 bg-primary-50/50' : 'border-line')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><b className="text-sm text-primary">{t.titleAr}</b><Badge>{t.category}</Badge>{t.clauseVersion > 1 && <span className="num text-[11px] text-muted">v{t.clauseVersion}</span>}</div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-muted">{t.bodyAr}</p>
                  </div>
                  <Button size="sm" variant={used ? 'outline' : 'primary'} icon={used ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} onClick={() => onAdd(t)}>{used ? 'مضاف — إضافة مجددًا' : 'إضافة'}</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
