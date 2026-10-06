'use client';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { tafqitHalalas, type QuoteTotals } from '@mmc/domain';
import { clsx, Money } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

function Row({ label, children, strong, tone }: { label: ReactNode; children: ReactNode; strong?: boolean; tone?: 'muted' | 'red' | 'green' }) {
  return (
    <div className={clsx('flex items-center justify-between gap-3 py-1.5', strong && 'text-base font-extrabold text-primary', tone === 'muted' && 'text-muted', tone === 'red' && 'text-danger', tone === 'green' && 'text-ok')}>
      <span className={clsx(!strong && 'text-sm')}>{label}</span>
      <span className={clsx(!strong && 'text-sm font-bold')}>{children}</span>
    </div>
  );
}

/** Quote totals: subtotal → discount → VAT → total, amount in words, optional total, and cost/margin when allowed. */
export function TotalsPanel({ totals, showCost, vatRegistered, warnings }: { totals: QuoteTotals; showCost: boolean; vatRegistered: boolean; warnings: string[] }) {
  const t = totals;
  const { bi } = useI18n();
  return (
    <div>
      <div className="divide-y divide-line/60">
        <Row label={bi('المجموع', 'Subtotal')}>{<Money value={t.subtotal} fixed />}</Row>
        {t.discount > 0 && (
          <>
            <Row label={<>{bi('الخصم', 'Discount')} <span className="num text-xs text-muted">({t.discountPercent}%)</span></>} tone="red">−<Money value={t.discount} fixed /></Row>
            <Row label={bi('الإجمالي بعد الخصم', 'Total after discount')}><Money value={t.taxable} fixed /></Row>
          </>
        )}
        {t.vatApplied ? <Row label={bi(`ضريبة القيمة المضافة ${t.vatRate}%`, `VAT ${t.vatRate}%`)}><Money value={t.vat} fixed /></Row> : (
          <Row label={bi('ضريبة القيمة المضافة', 'VAT')} tone="muted">{vatRegistered ? bi('غير مضافة', 'Not added') : bi('غير مسجلة', 'Not registered')}</Row>
        )}
        <Row label={t.vatApplied ? bi('الإجمالي شامل الضريبة', 'Total incl. VAT') : bi('الإجمالي', 'Total')} strong><Money value={t.total} fixed /></Row>
      </div>
      {t.total > 0 && <p className="mt-2 rounded-lg bg-tint/60 px-3 py-2 text-xs leading-relaxed text-gold-dark" dir="rtl" lang="ar">فقط {tafqitHalalas(t.total)} لا غير</p>}
      {t.optionalTotal > 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-line px-3 py-1">
          <Row label={bi('بنود اختيارية (غير محتسبة)', 'Optional items (not included)')} tone="muted"><Money value={t.optionalTotal} fixed /></Row>
        </div>
      )}
      {showCost && (
        <div className="mt-3 rounded-lg border border-line bg-gray-50/70 px-3 py-1">
          <div className="pt-1 text-[11px] font-extrabold text-muted">{bi('داخلي — لا يظهر للعميل', 'Internal — not shown to the customer')}</div>
          <Row label={bi('التكلفة', 'Cost')}><Money value={t.cost} fixed /></Row>
          <Row label={bi('هامش الربح', 'Margin')} tone={t.margin < 0 ? 'red' : 'green'}><Money value={t.margin} fixed /></Row>
          <Row label={bi('نسبة الهامش', 'Margin %')} tone={t.marginPercent !== null && t.marginPercent < 20 ? 'red' : 'green'}><span className="num">{t.marginPercent === null ? '—' : `${t.marginPercent}%`}</span></Row>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="flex items-center gap-1.5 font-extrabold"><AlertTriangle className="size-4" />{bi('يحتاج العرض إلى موافقة', 'This quote needs approval')}</div>
          <ul className="list-disc ps-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
