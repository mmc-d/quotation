'use client';
import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';
import { clsx } from '@/components/ui';
import { errMsg, tap, tapTone, type Part, type WOView } from './shared';
import { useOutbox } from './outbox';

const fieldCls = 'min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:bg-gray-50';
type Row = { code: string; qty: string; serial: string; description?: string | null };
const toRows = (parts: Part[]): Row[] => parts.map((p) => ({ code: p.code, qty: p.qty, serial: p.serial ?? '', description: p.description ?? null }));

/** Parts used (recorded as data until van stock arrives in module 07) + findings. */
export function PartsStep({ wo, editable }: { wo: WOView; editable: boolean; onView?: (v: WOView) => void }) {
  const { bi } = useI18n();
  const outbox = useOutbox();
  // the saved values, with a queued (offline) save on top
  const queuedParts = outbox.pending.find((m) => m.kind === 'parts')?.body as { parts: Part[] } | undefined;
  const queuedFindings = outbox.pending.find((m) => m.kind === 'findings')?.body as { findings: string | null } | undefined;
  const baseParts = queuedParts ? queuedParts.parts : wo.parts;
  const baseFindings = (queuedFindings ? queuedFindings.findings : wo.findings) ?? '';
  const [rows, setRows] = useState<Row[]>(toRows(baseParts));
  const [findings, setFindings] = useState(baseFindings);
  const [busy, setBusy] = useState<'parts' | 'findings' | null>(null);
  const partsSig = JSON.stringify(baseParts);
  useEffect(() => setRows(toRows(JSON.parse(partsSig) as Part[])), [partsSig]);
  useEffect(() => setFindings(baseFindings), [baseFindings]);

  const dirtyParts = JSON.stringify(rows) !== JSON.stringify(toRows(baseParts));
  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const saveParts = async () => {
    const clean = rows.filter((r) => r.code.trim());
    const bad = clean.find((r) => !/^\d+(\.\d{1,3})?$/.test(r.qty.trim()) || Number(r.qty) <= 0);
    if (bad) return toast.error(bi(`الكمية غير صحيحة للقطعة ${bad.code}`, `Invalid quantity for part ${bad.code}`));
    setBusy('parts');
    try {
      const v = await outbox.send({ kind: 'parts', key: 'parts', path: `/field/work-orders/${wo.id}/parts`, body: { parts: clean.map((r) => ({ code: r.code.trim(), qty: r.qty.trim(), serial: r.serial.trim() || null, description: r.description || null })) } });
      if (v) toast.success(bi('حُفظت القطع', 'Parts saved'));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const saveFindings = async () => {
    setBusy('findings');
    try {
      const v = await outbox.send({ kind: 'findings', key: 'findings', path: `/field/work-orders/${wo.id}/findings`, body: { findings: findings.trim() || null } });
      if (v) toast.success(bi('حُفظت الملاحظات', 'Findings saved'));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-extrabold text-gold-dark">{bi('القطع المستخدمة', 'Parts used')}</h3>
        {rows.length === 0 && <p className="text-sm text-muted">{bi('لا توجد قطع.', 'No parts.')}</p>}
        {rows.map((r, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-line p-2">
            <div className="flex gap-2">
              <input className={clsx(fieldCls, 'num flex-1')} dir="ltr" placeholder={bi('رمز القطعة', 'Part code')} value={r.code} disabled={!editable} onChange={(e) => patch(i, { code: e.target.value })} />
              <input className={clsx(fieldCls, 'num w-20 text-center')} dir="ltr" inputMode="decimal" aria-label={bi('الكمية', 'Qty')} value={r.qty} disabled={!editable} onChange={(e) => patch(i, { qty: e.target.value })} />
              {editable && <button type="button" className={clsx(tap, tapTone.outline, 'min-w-12 px-2 text-danger')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={bi('حذف', 'Remove')}><Trash2 className="size-5" /></button>}
            </div>
            <input className={clsx(fieldCls, 'num')} dir="ltr" placeholder={bi('الرقم التسلسلي (اختياري)', 'Serial (optional)')} value={r.serial} disabled={!editable} onChange={(e) => patch(i, { serial: e.target.value })} />
          </div>
        ))}
        {editable && (
          <div className="flex gap-2">
            <button type="button" className={clsx(tap, tapTone.outline, 'flex-1')} onClick={() => setRows((x) => [...x, { code: '', qty: '1', serial: '' }])}><Plus className="size-5" />{bi('إضافة قطعة', 'Add part')}</button>
            {dirtyParts && <button type="button" className={clsx(tap, tapTone.primary, 'flex-1')} onClick={() => void saveParts()} disabled={busy === 'parts'}><Save className="size-5" />{bi('حفظ القطع', 'Save parts')}</button>}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-extrabold text-gold-dark">{bi('الملاحظات والنتائج', 'Findings')}</h3>
        <textarea className={clsx(fieldCls, 'min-h-28 py-2 leading-relaxed')} value={findings} disabled={!editable} onChange={(e) => setFindings(e.target.value)} placeholder={bi('ما الذي وجدته وما الذي تم عمله…', 'What you found and what was done…')} />
        {editable && findings !== baseFindings && (
          <button type="button" className={clsx(tap, tapTone.primary, 'w-full')} onClick={() => void saveFindings()} disabled={busy === 'findings'}><Save className="size-5" />{bi('حفظ الملاحظات', 'Save findings')}</button>
        )}
      </div>
    </div>
  );
}
