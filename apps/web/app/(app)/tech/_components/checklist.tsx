'use client';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clsx } from '@/components/ui';
import { errMsg, type ChecklistItem, type WOView } from './shared';

/** Large-checkbox checklist; each toggle (or value blur) is saved at once. */
export function ChecklistStep({ wo, editable, onView }: { wo: WOView; editable: boolean; onView: (v: WOView) => void }) {
  const { bi, locale } = useI18n();
  const [items, setItems] = useState<ChecklistItem[]>(wo.checklist);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => setItems(wo.checklist), [wo.checklist]);

  const save = async (it: ChecklistItem) => {
    setSaving(it.key);
    try {
      onView(await api.put<WOView>(`/field/work-orders/${wo.id}/checklist`, { items: [{ key: it.key, done: !!it.done, value: it.value ?? null }] }));
    } catch (e) {
      toast.error(errMsg(e));
      setItems(wo.checklist);
    } finally {
      setSaving(null);
    }
  };
  const patch = (key: string, p: Partial<ChecklistItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  if (!items.length) return <p className="text-sm text-muted">{bi('لا توجد بنود فحص لهذا الأمر.', 'No checklist items for this job.')}</p>;
  return (
    <ul className="space-y-2">
      {items.map((it) => {
        const label = locale === 'en' ? it.labelEn || it.labelAr : it.labelAr;
        return (
          <li key={it.key} id={`check-${it.key}`} className={clsx('rounded-xl border p-2', it.done ? 'border-emerald-200 bg-emerald-50/60' : 'border-line')}>
            <button
              type="button"
              disabled={!editable || saving === it.key}
              onClick={() => { const next = { ...it, done: !it.done }; patch(it.key, { done: next.done }); void save(next); }}
              className="flex min-h-12 w-full items-center gap-3 text-start disabled:opacity-70"
              aria-pressed={!!it.done}
            >
              <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-lg border-2 transition', it.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-line bg-white')}>
                {it.done && <Check className="size-6" strokeWidth={3} />}
              </span>
              <span className="flex-1 text-base font-bold text-ink">
                {label}
                {it.required && <span className="ms-1 text-danger" title={bi('إلزامي', 'Required')}>*</span>}
              </span>
            </button>
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-gold disabled:bg-gray-50"
              placeholder={bi('قراءة / ملاحظة (اختياري)', 'Reading / note (optional)')}
              value={it.value ?? ''}
              disabled={!editable}
              onChange={(e) => patch(it.key, { value: e.target.value })}
              onBlur={(e) => { const orig = wo.checklist.find((c) => c.key === it.key); if ((orig?.value ?? '') !== e.target.value) void save({ ...it, value: e.target.value || null }); }}
            />
          </li>
        );
      })}
    </ul>
  );
}
