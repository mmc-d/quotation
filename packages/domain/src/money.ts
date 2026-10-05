import { Decimal } from 'decimal.js';

/**
 * Money is carried as integer halalas (1 SAR = 100 halalas) everywhere amounts are added up, so
 * totals, VAT and payment splits are exact. Unit prices may carry 4 decimals (NUMERIC(18,4)) and
 * quantities 2+; a line amount is rounded to halalas once, half-up, exactly like the legacy tool's
 * invoice path (`Math.round(unitPrice*qty*100)`).
 */
export type Halalas = number;

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = string | number | Decimal;

export function dec(v: DecimalInput | null | undefined): Decimal {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  return v instanceof Decimal ? v : new Decimal(v);
}

/** SAR amount (string/number/Decimal) → integer halalas, half-up. */
export function toHalalas(sar: DecimalInput | null | undefined): Halalas {
  return dec(sar).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Integer halalas → SAR number with 2 decimals (for JSON/display). */
export function fromHalalas(h: Halalas): number {
  return Math.round(h) / 100;
}

/** Integer halalas → fixed "1234.50" string (for NUMERIC(18,2) columns and ZATCA). */
export function halalasToFixed(h: Halalas): string {
  const neg = h < 0;
  const a = Math.abs(Math.round(h));
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** unitPrice × qty rounded once to halalas. */
export function lineAmountHalalas(unitPrice: DecimalInput, qty: DecimalInput): Halalas {
  return dec(unitPrice).times(dec(qty)).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** percentage of an amount in halalas, half-up. */
export function percentOf(h: Halalas, percent: DecimalInput): Halalas {
  return dec(h).times(dec(percent)).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Split `total` halalas across parts in proportion to `weights`; leftover halalas go to the largest
 * remainders, so the parts always add up exactly to the total. Port of the legacy
 * `allocateHalalas` (index.html) — same tie-breaking (stable sort by remainder, descending).
 */
export function allocateHalalas(total: Halalas, weights: number[]): Halalas[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!total || !sum) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map((v) => Math.floor(v));
  let rest = total - out.reduce((a, b) => a + b, 0);
  exact
    .map((v, i) => [v - (out[i] as number), i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (rest > 0) {
        out[i] = (out[i] as number) + 1;
        rest--;
      }
    });
  return out;
}

/**
 * Display format used on quotes: thousands separators, decimals only when present
 * (1 decimal if the second is zero) — the legacy `fmt` in recalc().
 */
export function formatSar(h: Halalas): string {
  const v = fromHalalas(h);
  const hasDecimals = h % 100 !== 0;
  const minFrac = hasDecimals ? (h % 10 !== 0 ? 2 : 1) : 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: minFrac, maximumFractionDigits: 2 });
}

/** Always two decimals with separators: contracts and invoices (`f2`). */
export function formatSar2(h: Halalas): string {
  return fromHalalas(h).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
