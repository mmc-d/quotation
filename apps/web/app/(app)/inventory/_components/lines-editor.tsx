'use client';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button, Input } from '@/components/ui';
import { ProductPicker, SerialInput, parseSerials, type PickedProduct } from './common';

export interface LineDraft { key: number; product: PickedProduct | null; qty: string; serials: string }

let seq = 1;
export const newLine = (product: PickedProduct | null = null, qty = '1'): LineDraft => ({ key: seq++, product, qty, serials: '' });

/** Validate and convert drafts to API lines; returns an error message (bilingual via bi) or the lines. */
export function toApiLines(lines: LineDraft[], bi: (ar: string, en: string) => string): { error: string } | { lines: { productId: string; qty: string; serials?: string[] }[] } {
  const used = lines.filter((l) => l.product);
  if (!used.length) return { error: bi('أضف صنفًا واحدًا على الأقل', 'Add at least one item') };
  const out = [];
  for (const l of used) {
    const qty = l.qty.trim();
    if (!/^\d+(\.\d{1,3})?$/.test(qty) || Number(qty) <= 0) return { error: bi(`كمية غير صالحة للصنف ${l.product!.code}`, `Invalid quantity for ${l.product!.code}`) };
    const serials = parseSerials(l.serials);
    if (l.product!.serialTracked) {
      if (serials.length !== Number(qty)) return { error: bi(`${l.product!.code}: أدخل ${qty} رقمًا تسلسليًا`, `${l.product!.code}: list ${qty} serial number(s)`) };
      if (new Set(serials).size !== serials.length) return { error: bi(`${l.product!.code}: أرقام تسلسلية مكررة`, `${l.product!.code}: duplicate serials`) };
    }
    out.push({ productId: l.product!.id, qty, ...(l.product!.serialTracked && serials.length ? { serials } : {}) });
  }
  return { lines: out };
}

/** Product + quantity (+ serials for serial-tracked items) lines. */
export function LinesEditor({ lines, onChange }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void }) {
  const { bi } = useI18n();
  const upd = (key: number, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={l.key} className="rounded-lg border border-line p-2">
          <div className="flex items-start gap-2">
            <span className="num mt-2 w-5 shrink-0 text-center text-xs text-muted">{i + 1}</span>
            <ProductPicker className="min-w-0 flex-1" value={l.product} onChange={(p) => upd(l.key, { product: p })} />
            <Input dir="ltr" inputMode="decimal" className="w-24 shrink-0 text-center" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} aria-label={bi('الكمية', 'Quantity')} />
            <button type="button" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} className="mt-1.5 shrink-0 rounded p-1 text-muted hover:bg-rose-50 hover:text-danger" aria-label={bi('حذف السطر', 'Remove line')}><Trash2 className="size-4" /></button>
          </div>
          {l.product?.serialTracked && (
            <div className="mt-2 ps-7">
              <SerialInput value={l.serials} onChange={(v) => upd(l.key, { serials: v })} expected={Number(l.qty) || 0} rows={3} />
            </div>
          )}
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => onChange([...lines, newLine()])}>{bi('إضافة صنف', 'Add item')}</Button>
    </div>
  );
}
