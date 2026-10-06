'use client';
import { ArrowDown, ArrowUp, Layers, RotateCcw, Trash2, Wrench } from 'lucide-react';
import type { QuoteLineResult } from '@mmc/domain';
import { Badge, clsx, Input, Money, Textarea } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { NumInput } from './common';
import { groupLines, INS_CODE, type DraftSection, type EditLine } from './types';

export interface SectionActions {
  rename: (key: string, title: string) => void;
  move: (key: string, dir: -1 | 1) => void;
  remove: (key: string) => void;
}

interface Props {
  lines: EditLine[];
  results: QuoteLineResult[];
  readOnly: boolean;
  onChange: (index: number, patch: Partial<EditLine>) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onResetIns: () => void;
  /** quote sections (CPQ-13); lines are grouped under them with a subtotal row each */
  sections?: DraftSection[];
  /** subtotal per section key (halalas, optional lines excluded) — from calculateQuote().totals.sections */
  sectionTotals?: Map<string, number>;
  sectionActions?: SectionActions;
}

const GRID = 'md:grid md:grid-cols-[2rem_8rem_minmax(0,1fr)_7.5rem_5.5rem_8.5rem_6.5rem] md:items-start md:gap-2';

/** Quote lines: code, editable description, price (0 = FREE), qty, total (list total struck through when discounted). */
export function LinesEditor({ lines, results, readOnly, onChange, onRemove, onMove, onResetIns, sections = [], sectionTotals, sectionActions }: Props) {
  const { bi } = useI18n();
  const main = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.isOptional);
  const optional = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.isOptional);
  const hasSections = sections.length > 0;
  const groups = hasSections ? groupLines(lines, sections) : [];
  // first/last line of the group a line sits in (move up/down stays inside its group)
  const edge = (i: number, dir: -1 | 1) => {
    const l = lines[i]!;
    if (!hasSections) {
      const movable = lines.map((x, j) => ({ x, j })).filter(({ x }) => x.code !== INS_CODE);
      return dir < 0 ? movable[0]?.j === i : movable[movable.length - 1]?.j === i;
    }
    const g = groups.find((x) => x.items.some((it) => it.i === i));
    if (!g || l.code === INS_CODE) return true;
    return dir < 0 ? g.items[0]?.i === i : g.items[g.items.length - 1]?.i === i;
  };
  const row = ({ l, i }: { l: EditLine; i: number }, n: number) => {
    const r = results[i];
    const isIns = l.code === INS_CODE;
    const free = r ? r.isFree : Number(l.unitPrice) === 0;
    return (
      <div key={l.key} className={clsx('border-b border-line/70 px-3 py-3 last:border-b-0', GRID, isIns && 'bg-tint/40', l.isOptional && 'bg-gray-50/80')}>
        {/* # + code (mobile: header row with actions) */}
        <div className="num hidden pt-2 text-center text-xs font-bold text-muted md:block">{n}</div>
        <div className="mb-2 flex items-center justify-between gap-2 md:mb-0 md:block md:pt-2">
          <div className="flex items-center gap-1.5">
            <span className="num text-xs font-bold text-muted md:hidden">{n}.</span>
            {isIns ? <span className="inline-flex items-center gap-1 text-xs font-extrabold text-gold-dark"><Wrench className="size-3.5" />INS</span> : <span className="num break-all text-xs font-extrabold text-primary" dir="ltr">{l.code}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {isIns && <Badge tone={l.manualPrice ? 'gold' : 'green'}>{l.manualPrice ? bi('سعر يدوي', 'Manual price') : bi('تلقائي', 'Automatic')}</Badge>}
            {l.isOptional && <Badge>{bi('اختياري', 'Optional')}</Badge>}
          </div>
          {hasSections && !isIns && !readOnly && (
            <select
              value={l.sectionKey && sections.some((s) => s.key === l.sectionKey) ? l.sectionKey : ''}
              onChange={(e) => onChange(i, { sectionKey: e.target.value || null })}
              aria-label={bi('القسم', 'Section')}
              title={bi('القسم', 'Section')}
              className="mt-1 w-full max-w-[9rem] rounded-md border border-line bg-white px-1 py-0.5 text-[11px] text-ink"
            >
              <option value="">{bi('بدون قسم', 'No section')}</option>
              {sections.map((s, k) => <option key={s.key} value={s.key}>{s.title.trim() || bi(`قسم ${k + 1}`, `Section ${k + 1}`)}</option>)}
            </select>
          )}
        </div>
        {/* description */}
        <div className="mb-2 md:mb-0">
          {readOnly ? <p className="whitespace-pre-line pt-1.5 text-sm leading-relaxed">{l.description}</p> : (
            <Textarea rows={2} value={l.description} onChange={(e) => onChange(i, { description: e.target.value })} className="min-h-[2.6rem] resize-y text-[13px]" aria-label={bi('الوصف', 'Description')} />
          )}
        </div>
        {/* price / qty / total */}
        <div className="grid grid-cols-3 gap-2 md:contents">
          <div>
            <span className="mb-0.5 block text-[11px] font-bold text-gold-dark md:hidden">{bi('سعر الوحدة', 'Unit price')}</span>
            {readOnly ? (
              <div className="pt-1.5 text-sm">{free ? <span className="font-extrabold text-danger">FREE</span> : <Money value={l.unitPrice} fixed />}</div>
            ) : (
              <>
                <NumInput value={l.unitPrice} onChange={(v) => onChange(i, isIns ? { unitPrice: v, listPrice: v, manualPrice: true } : { unitPrice: v })} ariaLabel={bi('سعر الوحدة', 'Unit price')} className={clsx('px-2', free && 'text-danger')} />
                {free && <span className="mt-0.5 block text-[11px] font-extrabold text-danger">FREE</span>}
                {!isIns && Number(l.listPrice) > 0 && Number(l.unitPrice) !== Number(l.listPrice) && <span className="mt-0.5 block text-[11px] text-muted">{bi('القائمة:', 'List:')} <span className="num">{Number(l.listPrice).toLocaleString('en-US')}</span></span>}
              </>
            )}
          </div>
          <div>
            <span className="mb-0.5 block text-[11px] font-bold text-gold-dark md:hidden">{bi('الكمية', 'Qty')}</span>
            {readOnly ? <div className="num pt-1.5 text-sm">{l.qty}</div> : <NumInput value={l.qty} onChange={(v) => onChange(i, { qty: v })} min={0} ariaLabel={bi('الكمية', 'Qty')} className="px-2 text-center" />}
          </div>
          <div className="text-end md:pt-1.5">
            <span className="mb-0.5 block text-[11px] font-bold text-gold-dark md:hidden">{bi('الإجمالي', 'Total')}</span>
            {r?.struck && r.listAmount > r.amount && <div className="text-[11px] text-muted line-through"><Money value={r.listAmount} fixed /></div>}
            {r ? (r.isFree ? <span className="text-sm font-extrabold text-danger">FREE</span> : <Money value={r.amount} fixed className={clsx('text-sm font-bold', l.isOptional && 'text-muted')} />) : '—'}
          </div>
        </div>
        {/* actions */}
        {!readOnly && (
          <div className="mt-2 flex items-center justify-end gap-0.5 md:mt-0 md:pt-1">
            {!isIns && (
              <>
                <IconBtn label={l.isOptional ? bi('إلغاء الاختياري', 'Make required') : bi('جعله اختياريًا', 'Make optional')} onClick={() => onChange(i, { isOptional: !l.isOptional })} active={l.isOptional}><span className="text-[10px] font-extrabold">{bi('اختياري', 'Optional')}</span></IconBtn>
                <IconBtn label={bi('أعلى', 'Move up')} onClick={() => onMove(i, -1)} disabled={edge(i, -1)}><ArrowUp className="size-3.5" /></IconBtn>
                <IconBtn label={bi('أسفل', 'Move down')} onClick={() => onMove(i, 1)} disabled={edge(i, 1)}><ArrowDown className="size-3.5" /></IconBtn>
              </>
            )}
            {isIns && l.manualPrice && <IconBtn label={bi('إرجاع للحساب التلقائي', 'Back to automatic calculation')} onClick={onResetIns}><RotateCcw className="size-3.5" /></IconBtn>}
            <IconBtn label={bi('حذف', 'Delete')} onClick={() => onRemove(i)} danger><Trash2 className="size-3.5" /></IconBtn>
          </div>
        )}
      </div>
    );
  };
  return (
    <div>
      <div className={clsx('hidden border-b border-line bg-tint/60 px-3 py-2 text-xs font-extrabold text-gold-dark', GRID)}>
        <span className="text-center">#</span><span>{bi('الموديل', 'Model')}</span><span>{bi('الوصف', 'Description')}</span><span>{bi('سعر الوحدة', 'Unit price')}</span><span className="text-center">{bi('الكمية', 'Qty')}</span><span className="text-end">{bi('الإجمالي', 'Total')}</span><span />
      </div>
      {hasSections ? (() => {
        let n = 0;
        return groups.map((g) => {
          if (g.ins) return g.items.length ? <div key="__ins">{g.items.map((x) => row(x, ++n))}</div> : null;
          if (!g.section) {
            if (!g.items.length) return null;
            return (
              <div key="__none">
                <div className="border-b border-line bg-gray-50 px-3 py-1.5 text-xs font-extrabold text-muted">{bi('بدون قسم', 'No section')}</div>
                {g.items.map((x) => row(x, ++n))}
              </div>
            );
          }
          const s = g.section;
          const k = sections.findIndex((x) => x.key === s.key);
          return (
            <div key={s.key} className="border-b-2 border-primary/20">
              <div className="flex items-center gap-2 border-b border-line bg-primary-50/70 px-3 py-2">
                <Layers className="size-4 shrink-0 text-primary" />
                {readOnly || !sectionActions ? <span className="flex-1 text-sm font-extrabold text-primary">{s.title || bi(`قسم ${k + 1}`, `Section ${k + 1}`)}</span> : (
                  <Input value={s.title} onChange={(e) => sectionActions.rename(s.key, e.target.value)} placeholder={bi(`قسم ${k + 1} — مثل: المبنى أ، فيلا 3، البوابة`, `Section ${k + 1} — e.g. Building A, Villa 3, Gate`)} aria-label={bi('اسم القسم', 'Section name')} className="h-8 flex-1 bg-white py-1 text-sm font-bold" />
                )}
                <span className="num shrink-0 text-[11px] text-muted">{bi(`${g.items.length} بند`, `${g.items.length} lines`)}</span>
                {!readOnly && sectionActions && (
                  <span className="flex shrink-0 items-center">
                    <IconBtn label={bi('نقل القسم لأعلى', 'Move section up')} onClick={() => sectionActions.move(s.key, -1)} disabled={k === 0}><ArrowUp className="size-3.5" /></IconBtn>
                    <IconBtn label={bi('نقل القسم لأسفل', 'Move section down')} onClick={() => sectionActions.move(s.key, 1)} disabled={k === sections.length - 1}><ArrowDown className="size-3.5" /></IconBtn>
                    <IconBtn label={bi('حذف القسم (تبقى بنوده بدون قسم)', 'Delete section (its lines stay without a section)')} onClick={() => sectionActions.remove(s.key)} danger><Trash2 className="size-3.5" /></IconBtn>
                  </span>
                )}
              </div>
              {g.items.length ? g.items.map((x) => row(x, ++n)) : (
                <div className="px-3 py-3 text-center text-xs text-muted">{readOnly ? bi('لا توجد بنود في هذا القسم.', 'No lines in this section.') : bi('لا توجد بنود في هذا القسم — اختر القسم من القائمة أسفل كود البند.', 'No lines in this section — pick the section from the list under the line code.')}</div>
              )}
              <div className="flex items-center justify-between gap-2 bg-tint/50 px-3 py-1.5 text-sm">
                <span className="font-bold text-gold-dark">{bi('المجموع الفرعي', 'Subtotal')} — {s.title || bi(`قسم ${k + 1}`, `Section ${k + 1}`)}</span>
                <Money value={sectionTotals?.get(s.key) ?? 0} fixed className="font-extrabold text-primary" />
              </div>
            </div>
          );
        });
      })() : (
        <>
          {main.map((x, n) => row(x, n + 1))}
          {optional.length > 0 && (
            <>
              <div className="border-y border-dashed border-line bg-gray-50 px-3 py-1.5 text-xs font-extrabold text-muted">{bi('بنود اختيارية — لا تدخل في الإجمالي', 'Optional items — not included in the total')}</div>
              {optional.map((x, n) => row(x, main.length + n + 1))}
            </>
          )}
        </>
      )}
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled, danger, active }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; active?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className={clsx('grid h-7 min-w-7 place-items-center rounded-md px-1 transition disabled:opacity-30', danger ? 'text-danger hover:bg-rose-50' : active ? 'bg-gold/15 text-gold-dark' : 'text-muted hover:bg-black/5 hover:text-ink')}>
      {children}
    </button>
  );
}
