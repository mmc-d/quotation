/**
 * Document numbers. Legacy formats continue unchanged so old and new documents sort together:
 *   quote     MMC-{YY}{WW}{DD}{n}   n restarts daily (prefix changes), no delimiter before n
 *   contract  MMCT-{n}              never resets
 *   invoice   MMC-INV-{nnnnn}       never resets, keeps the latest invoice's digit width
 * Sequences are always allocated by the server under a lock (numbering_series row, SELECT … FOR
 * UPDATE) — these helpers only format and parse.
 */

export type SeriesReset = 'daily' | 'yearly' | 'never';

/** Calendar parts of a date in Asia/Riyadh (UTC+3, no DST). */
export function riyadhParts(at: Date = new Date()): { y: number; m: number; d: number } {
  const t = new Date(at.getTime() + 3 * 3600_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** YYYY-MM-DD business date in Asia/Riyadh. */
export function riyadhDate(at: Date = new Date()): string {
  const { y, m, d } = riyadhParts(at);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** HH:MM:SS in Asia/Riyadh. */
export function riyadhTime(at: Date = new Date()): string {
  const t = new Date(at.getTime() + 3 * 3600_000);
  return t.toISOString().slice(11, 19);
}

/** ISO-8601 week number for a calendar date (same algorithm as the legacy getQuotePrefix). */
export function isoWeek(y: number, m: number, d: number): number {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Quote prefix `MMC-YYWWDD` for a calendar date. NB: like the legacy tool, YY is the calendar
 * year (not the ISO week-year), so 2026-12-31 gives `MMC-265331`.
 */
export function quotePrefixFor(y: number, m: number, d: number): string {
  const yy = String(y).slice(-2);
  const ww = String(isoWeek(y, m, d)).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `MMC-${yy}${ww}${dd}`;
}

export function quotePrefix(at: Date = new Date()): string {
  const { y, m, d } = riyadhParts(at);
  return quotePrefixFor(y, m, d);
}

export interface SeriesSpec {
  /** Tokens: {YY} {WW} {DD} {MM} {YYYY} {SEQ} {SEQ:5} (zero-padded) */
  pattern: string;
  reset: SeriesReset;
}

export const DEFAULT_SERIES: Record<string, SeriesSpec> = {
  quote: { pattern: 'MMC-{YY}{WW}{DD}{SEQ}', reset: 'daily' },
  contract: { pattern: 'MMCT-{SEQ}', reset: 'never' },
  invoice: { pattern: 'MMC-INV-{SEQ:5}', reset: 'never' },
  payment_request: { pattern: 'MMC-PR-{SEQ:5}', reset: 'never' },
  change_order: { pattern: 'MMC-CO-{SEQ:4}', reset: 'never' },
  lead: { pattern: 'L-{SEQ:5}', reset: 'never' },
  project: { pattern: 'PRJ-{SEQ:4}', reset: 'never' },
  work_order: { pattern: 'WO-{SEQ:5}', reset: 'never' },
  ticket: { pattern: 'TCK-{SEQ:5}', reset: 'never' },
  material_request: { pattern: 'MR-{SEQ:5}', reset: 'never' },
  purchase_order: { pattern: 'PO-{SEQ:5}', reset: 'never' },
  goods_receipt: { pattern: 'GRN-{SEQ:5}', reset: 'never' },
  shipment: { pattern: 'SHP-{SEQ:4}', reset: 'never' },
  stock_transfer: { pattern: 'TRF-{SEQ:5}', reset: 'never' },
  stock_count: { pattern: 'CNT-{SEQ:4}', reset: 'never' },
  supplier_bill: { pattern: 'BILL-{SEQ:5}', reset: 'never' },
  stock_opening: { pattern: 'OPN-{SEQ:4}', reset: 'never' },
  service_agreement: { pattern: 'AMC-{SEQ:4}', reset: 'never' },
  rfq: { pattern: 'RFQ-{SEQ:4}', reset: 'never' },
  payment_voucher: { pattern: 'PV-{SEQ:5}', reset: 'never' },
  receipt_voucher: { pattern: 'RV-{SEQ:5}', reset: 'never' },
  employee: { pattern: 'EMP-{SEQ:4}', reset: 'never' },
  job_offer: { pattern: 'OFR-{SEQ:4}', reset: 'never' },
  leave_request: { pattern: 'LV-{SEQ:5}', reset: 'never' },
  journal_entry: { pattern: 'JV-{SEQ:6}', reset: 'never' },
};

/** The bucket key a sequence counts within (e.g. the day for daily series). */
export function seriesPeriodKey(reset: SeriesReset, at: Date = new Date()): string {
  const { y, m, d } = riyadhParts(at);
  if (reset === 'daily') return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (reset === 'yearly') return String(y);
  return '';
}

export function formatSeries(pattern: string, seq: number, at: Date = new Date()): string {
  const { y, m, d } = riyadhParts(at);
  return pattern
    .replace(/\{YYYY\}/g, String(y))
    .replace(/\{YY\}/g, String(y).slice(-2))
    .replace(/\{MM\}/g, String(m).padStart(2, '0'))
    .replace(/\{WW\}/g, String(isoWeek(y, m, d)).padStart(2, '0'))
    .replace(/\{DD\}/g, String(d).padStart(2, '0'))
    .replace(/\{SEQ(?::(\d+))?\}/g, (_, w) => (w ? String(seq).padStart(Number(w), '0') : String(seq)));
}

/** Trailing sequence of a number (legacy invoices: "highest trailing digits"). */
export function trailingSequence(number: string): number {
  const m = /(\d+)$/.exec(number);
  return m ? parseInt(m[1] as string, 10) : 0;
}

/** Sequence of a quote number given its known prefix (no delimiter between prefix and n). */
export function quoteSequence(number: string, prefix: string): number {
  if (!number.startsWith(prefix)) return 0;
  return parseInt(number.slice(prefix.length), 10) || 0;
}

/** Revision label R0, R1, … */
export function revisionLabel(rev: number): string {
  return `R${rev}`;
}
