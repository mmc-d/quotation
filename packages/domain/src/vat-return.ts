import type { Halalas } from './money.js';
import type { PostLine } from './gl-posting.js';

/**
 * VAT return (Phase 6C, spec §7) built from ledger lines that carry a VAT code. Boxes follow the
 * ZATCA return form; amounts are integer halalas and *net* (credit notes and cleared advances carry
 * negative bases, so a box is already after adjustments).
 */

export const VAT_CODES = ['S', 'Z', 'E', 'O', 'X', 'IM', 'RC'] as const;
export type VatCode = (typeof VAT_CODES)[number];

export const VAT_CODE_LABELS: Record<VatCode, { ar: string; en: string }> = {
  S: { ar: 'خاضع بالنسبة الأساسية 15٪', en: 'Standard-rated 15%' },
  Z: { ar: 'خاضع لنسبة الصفر', en: 'Zero-rated' },
  E: { ar: 'معفى', en: 'Exempt' },
  O: { ar: 'خارج النطاق', en: 'Out of scope' },
  X: { ar: 'صادرات', en: 'Exports' },
  IM: { ar: 'استيراد عبر الجمارك', en: 'Import via customs' },
  RC: { ar: 'الاحتساب العكسي', en: 'Reverse charge' },
};

/** What kind of account the coded line sits on. */
export type VatSide = 'vat_output' | 'vat_input' | 'sales' | 'purchases';

export interface VatFact {
  code: VatCode;
  side: VatSide;
  /** net taxable base (signed) */
  base: Halalas;
  /** net VAT (signed): output = credit − debit, input = debit − credit */
  vat: Halalas;
}

export interface VatBox { base: Halalas; vat: Halalas }

export interface VatReturnBoxes {
  /** 1 standard-rated sales */
  box1: VatBox;
  /** 3 exports */
  box3: VatBox;
  /** 5 zero-rated domestic sales */
  box5: VatBox;
  /** 6 exempt sales */
  box6: VatBox;
  /** 7 total sales */
  box7: VatBox;
  /** 8 standard-rated domestic purchases */
  box8: VatBox;
  /** 9 imports subject to VAT paid at customs */
  box9: VatBox;
  /** 10 imports subject to reverse charge */
  box10: VatBox;
  /** 11 zero-rated purchases */
  box11: VatBox;
  /** 12 exempt purchases */
  box12: VatBox;
  /** 13 total purchases */
  box13: VatBox;
  /** 14 total VAT due (sales VAT + reverse-charge VAT) */
  box14: Halalas;
  /** 15 total VAT deductible (all purchase VAT incl. reverse charge) */
  box15: Halalas;
  /** 16 net VAT: > 0 payable to ZATCA, < 0 reclaimable */
  box16: Halalas;
}

const zero = (): VatBox => ({ base: 0, vat: 0 });
const add = (b: VatBox, f: VatFact) => { b.base += f.base; b.vat += f.vat; };

export function buildVatReturn(facts: readonly VatFact[]): VatReturnBoxes {
  const b1 = zero(), b3 = zero(), b5 = zero(), b6 = zero(), b8 = zero(), b9 = zero(), b10 = zero(), b11 = zero(), b12 = zero();
  let rcOutput = 0;
  for (const f of facts) {
    if (f.code === 'O') continue;
    if (f.side === 'vat_output') {
      if (f.code === 'S') add(b1, f);
      else if (f.code === 'RC') rcOutput += f.vat; // the offset of the reverse-charge input
      else add(b1, f); // VAT never sits on a zero/exempt line; keep it visible rather than drop it
    } else if (f.side === 'sales') {
      if (f.code === 'Z') add(b5, f);
      else if (f.code === 'X') add(b3, f);
      else if (f.code === 'E') add(b6, f);
    } else if (f.side === 'vat_input') {
      if (f.code === 'IM') add(b9, f);
      else if (f.code === 'RC') add(b10, f);
      else add(b8, f);
    } else if (f.side === 'purchases') {
      if (f.code === 'Z') add(b11, f);
      else if (f.code === 'E') add(b12, f);
    }
  }
  const sum = (...x: VatBox[]): VatBox => x.reduce((t, v) => ({ base: t.base + v.base, vat: t.vat + v.vat }), zero());
  const box7 = sum(b1, b3, b5, b6);
  const box13 = sum(b8, b9, b10, b11, b12);
  const box14 = box7.vat + rcOutput;
  const box15 = box13.vat;
  return { box1: b1, box3: b3, box5: b5, box6: b6, box7, box8: b8, box9: b9, box10: b10, box11: b11, box12: b12, box13, box14, box15, box16: box14 - box15 };
}

/**
 * Filing entry: clears the period's output and input VAT against the settlement account owed to
 * (or claimable from) ZATCA. `output`/`input` are boxes 14 and 15.
 */
export function vatSettlementLines(output: Halalas, input: Halalas): PostLine[] {
  const lines: PostLine[] = [];
  const dr = (key: string, amount: Halalas): PostLine => ({ key, debit: amount, credit: 0 });
  const cr = (key: string, amount: Halalas): PostLine => ({ key, debit: 0, credit: amount });
  // a negative total (net credit-note period) flips the side of the same account
  if (output > 0) lines.push(dr('vat_output', output)); else if (output < 0) lines.push(cr('vat_output', -output));
  if (input > 0) lines.push(cr('vat_input', input)); else if (input < 0) lines.push(dr('vat_input', -input));
  const net = output - input;
  if (net > 0) lines.push(cr('vat_settlement', net)); else if (net < 0) lines.push(dr('vat_settlement', -net));
  return lines;
}

// ─────────────────────────────── registration threshold ───────────────────────────────

/** SAR, in halalas (VAT Law: mandatory above 375,000; voluntary from 187,500 in 12 months). */
export const VAT_MANDATORY_THRESHOLD: Halalas = 37_500_000;
export const VAT_VOLUNTARY_THRESHOLD: Halalas = 18_750_000;

export type VatThresholdLevel = 'below' | 'voluntary' | 'mandatory';

export interface VatThreshold {
  rolling12: Halalas;
  level: VatThresholdLevel;
  /** share of the mandatory threshold, 0–∞ in percent with one decimal */
  pctOfMandatory: number;
  remainingToMandatory: Halalas;
}

export function vatThreshold(rolling12: Halalas): VatThreshold {
  const level: VatThresholdLevel = rolling12 > VAT_MANDATORY_THRESHOLD ? 'mandatory' : rolling12 >= VAT_VOLUNTARY_THRESHOLD ? 'voluntary' : 'below';
  return {
    rolling12, level,
    pctOfMandatory: Math.round((rolling12 / VAT_MANDATORY_THRESHOLD) * 1000) / 10,
    remainingToMandatory: Math.max(0, VAT_MANDATORY_THRESHOLD - rolling12),
  };
}

// ─────────────────────────────── return periods ───────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The monthly or quarterly return period (calendar months) containing `date`. */
export function vatPeriodOf(date: string, frequency: 'monthly' | 'quarterly'): { from: string; to: string; label: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const startM = frequency === 'monthly' ? m : Math.floor((m - 1) / 3) * 3 + 1;
  const endM = frequency === 'monthly' ? m : startM + 2;
  return {
    from: `${y}-${pad(startM)}-01`, to: `${y}-${pad(endM)}-${pad(lastDay(y, endM))}`,
    label: frequency === 'monthly' ? `${y}-${pad(m)}` : `${y}-Q${Math.floor((m - 1) / 3) + 1}`,
  };
}
