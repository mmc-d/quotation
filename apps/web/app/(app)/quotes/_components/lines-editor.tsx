'use client';
import { ArrowDown, ArrowUp, RotateCcw, Trash2, Wrench } from 'lucide-react';
import type { QuoteLineResult } from '@mmc/domain';
import { Badge, clsx, Money, Textarea } from '@/components/ui';
import { NumInput } from './common';
import { INS_CODE, type EditLine } from './types';

interface Props {
  lines: EditLine[];
  results: QuoteLineResult[];
  readOnly: boolean;
  onChange: (index: number, patch: Partial<EditLine>) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onResetIns: () => void;
}

const GRID = 'md:grid md:grid-cols-[2rem_8rem_minmax(0,1fr)_7.5rem_5.5rem_8.5rem_6.5rem] md:items-start md:gap-2';

/** Quote lines: code, editable description, price (0 = FREE), qty, total (list total struck through when discounted). */
export function LinesEditor({ lines, results, readOnly, onChange, onRemove, onMove, onResetIns }: Props) {
  const main = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.isOptional);
  const optional = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.isOptional);
  const lastMovable = lines.filter((l) => l.code !== INS_CODE).length - 1;
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
            {isIns && <Badge tone={l.manualPrice ? 'gold' : 'green'}>{l.manualPrice ? 'سعر يدوي' : 'تلقائي'}</Badge>}
            {l.isOptional && <Badge>اختياري</Badge>}
          </div>
        </div>
        {/* description */}
        <div className="mb-2 md:mb-0">
          {readOnly ? <p className="whitespace-pre-line pt-1.5 text-sm leading-relaxed">{l.description}</p> : (
            <Textarea rows={2} value={l.description} onChange={(e) => onChange(i, { description: e.target.value })} className="min-h-[2.6rem] resize-y text-[13px]" aria-label="الوصف" />
          )}
        </div>
        {/* price / qty / total */}
        <div className="grid grid-cols-3 gap-2 md:contents">
          <div>
            <span className="mb-0.5 block text-[11px] font-bold text-gold-dark md:hidden">سعر الوحدة</span>
            {readOnly ? (
              <div className="pt-1.5 text-sm">{free ? <span className="font-extrabold text-danger">FREE</span> : <Money value={l.unitPrice} fixed />}</div>
            ) : (
              <>
                <NumInput value={l.unitPrice} onChange={(v) => onChange(i, isIns ? { unitPrice: v, listPrice: v, manualPrice: true } : { unitPrice: v })} ariaLabel="سعر الوحدة" className={clsx('px-2', free && 'text-danger')} />
                {free && <span className="mt-0.5 block text-[11px] font-extrabold text-danger">FREE</span>}
                {!isIns && Number(l.listPrice) > 0 && Number(l.unitPrice) !== Number(l.listPrice) && <span className="mt-0.5 block text-[11px] text-muted">القائمة: <span className="num">{Number(l.listPrice).toLocaleString('en-US')}</span></span>}
              </>
            )}
          </div>
          <div>
            <span className="mb-0.5 block text-[11px] font-bold text-gold-dark md:hidden">الكمية</span>
            {readOnly ? <div className="num pt-1.5 text-sm">{l.qty}</div> : <NumInput value={l.qty} onChange={(v) => onChange(i, { qty: v })} min={0} ariaLabel="الكمية" className="px-2 text-center" />}
          </div>
          <div className="text-end md:pt-1.5">
            <span className="mb-0.5 block text-[11px] font-bold text-gold-dark md:hidden">الإجمالي</span>
            {r?.struck && r.listAmount > r.amount && <div className="text-[11px] text-muted line-through"><Money value={r.listAmount} fixed /></div>}
            {r ? (r.isFree ? <span className="text-sm font-extrabold text-danger">FREE</span> : <Money value={r.amount} fixed className={clsx('text-sm font-bold', l.isOptional && 'text-muted')} />) : '—'}
          </div>
        </div>
        {/* actions */}
        {!readOnly && (
          <div className="mt-2 flex items-center justify-end gap-0.5 md:mt-0 md:pt-1">
            {!isIns && (
              <>
                <IconBtn label={l.isOptional ? 'إلغاء الاختياري' : 'جعله اختياريًا'} onClick={() => onChange(i, { isOptional: !l.isOptional })} active={l.isOptional}><span className="text-[10px] font-extrabold">اختياري</span></IconBtn>
                <IconBtn label="أعلى" onClick={() => onMove(i, -1)} disabled={i === 0}><ArrowUp className="size-3.5" /></IconBtn>
                <IconBtn label="أسفل" onClick={() => onMove(i, 1)} disabled={i >= lastMovable}><ArrowDown className="size-3.5" /></IconBtn>
              </>
            )}
            {isIns && l.manualPrice && <IconBtn label="إرجاع للحساب التلقائي" onClick={onResetIns}><RotateCcw className="size-3.5" /></IconBtn>}
            <IconBtn label="حذف" onClick={() => onRemove(i)} danger><Trash2 className="size-3.5" /></IconBtn>
          </div>
        )}
      </div>
    );
  };
  return (
    <div>
      <div className={clsx('hidden border-b border-line bg-tint/60 px-3 py-2 text-xs font-extrabold text-gold-dark', GRID)}>
        <span className="text-center">#</span><span>الموديل</span><span>الوصف</span><span>سعر الوحدة</span><span className="text-center">الكمية</span><span className="text-end">الإجمالي</span><span />
      </div>
      {main.map((x, n) => row(x, n + 1))}
      {optional.length > 0 && (
        <>
          <div className="border-y border-dashed border-line bg-gray-50 px-3 py-1.5 text-xs font-extrabold text-muted">بنود اختيارية — لا تدخل في الإجمالي</div>
          {optional.map((x, n) => row(x, main.length + n + 1))}
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
