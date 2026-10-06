'use client';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import { Money, Td } from '@/components/ui';
import { Chip, MOVE_KIND, Qty, refHref, type StockMove } from './common';

/** One stock-ledger row (date, kind, from → to, qty, unit cost, reference). */
export function MoveRow({ m, canCost, refLabel, showProduct }: { m: StockMove; canCost: boolean; refLabel: (t: string | null) => string; showProduct?: boolean }) {
  const href = refHref(m.refType, m.refId);
  const { bi } = useI18n();
  return (
    <tr>
      <Td className="num whitespace-nowrap text-xs">{dateTime(m.postedAt)}</Td>
      {showProduct && <Td className="whitespace-nowrap"><Link href={`/inventory/${m.productId}`} dir="ltr" className="num font-bold text-primary hover:underline">{m.productCode}</Link></Td>}
      <Td><Chip map={MOVE_KIND} value={m.kind} /></Td>
      <Td className="whitespace-nowrap text-xs"><span dir="ltr" className="num">{m.fromCode ?? (m.fromWarehouseId ? '•' : '—')} → {m.toCode ?? (m.toWarehouseId ? '•' : '—')}</span></Td>
      <Td className="text-end font-bold"><Qty value={m.qty} /></Td>
      {canCost && <Td className="text-end text-xs"><Money value={m.unitCostSar} fixed /></Td>}
      <Td className="text-xs">
        {href ? <Link href={href} className="text-primary hover:underline">{refLabel(m.refType)}</Link> : <span className="text-muted">{refLabel(m.refType)}</span>}
        {m.note && <div className="max-w-[16rem] truncate text-muted" title={m.note}>{m.note}</div>}
        {m.serials.length > 0 && <div className="max-w-[16rem] truncate text-muted" dir="ltr" title={m.serials.join('\n')}>{bi('تسلسلي', 'S/N')}: {m.serials.slice(0, 3).join(', ')}{m.serials.length > 3 ? ` +${m.serials.length - 3}` : ''}</div>}
      </Td>
    </tr>
  );
}
