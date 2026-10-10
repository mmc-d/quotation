import type { Halalas } from './money.js';

/**
 * Fixed assets (Phase 6C, decision D8): straight-line, monthly, per-asset useful life. Depreciation
 * starts in the month the asset is put into service and uses cumulative rounding, so the monthly
 * amounts always add up to exactly cost − salvage.
 */

export interface AssetTerms {
  cost: Halalas;
  salvage: Halalas;
  lifeMonths: number;
  /** YYYY-MM — first month depreciated */
  startMonth: string;
}

const monthNo = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
export const monthOf = (date: string) => date.slice(0, 7);
export const addMonthsYm = (ym: string, n: number): string => {
  const t = monthNo(ym) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** Depreciable base (never negative). */
export const depreciableBase = (a: Pick<AssetTerms, 'cost' | 'salvage'>): Halalas => Math.max(0, a.cost - a.salvage);

/** Accumulated depreciation at the end of `month` (0 before the start month, capped at the base). */
export function accumulatedAt(a: AssetTerms, month: string): Halalas {
  const life = Math.max(1, Math.trunc(a.lifeMonths));
  const k = Math.min(life, Math.max(0, monthNo(month) - monthNo(a.startMonth) + 1));
  return Math.round((depreciableBase(a) * k) / life);
}

/** Depreciation charged for exactly one month. */
export const depreciationFor = (a: AssetTerms, month: string): Halalas => accumulatedAt(a, month) - accumulatedAt(a, addMonthsYm(month, -1));

/** The charge a run for `month` posts: what is due through the month less what is already booked. */
export const depreciationDue = (a: AssetTerms, month: string, alreadyBooked: Halalas): Halalas => Math.max(0, accumulatedAt(a, month) - alreadyBooked);

export interface ScheduleRow { month: string; amount: Halalas; accumulated: Halalas; netBook: Halalas }

export function depreciationSchedule(a: AssetTerms): ScheduleRow[] {
  const life = Math.max(1, Math.trunc(a.lifeMonths));
  const rows: ScheduleRow[] = [];
  let prev = 0;
  for (let i = 0; i < life; i++) {
    const month = addMonthsYm(a.startMonth, i);
    const acc = accumulatedAt(a, month);
    rows.push({ month, amount: acc - prev, accumulated: acc, netBook: a.cost - acc });
    prev = acc;
  }
  return rows;
}

/** Gain (> 0) or loss (< 0) on selling / scrapping an asset. */
export const disposalResult = (cost: Halalas, accumulated: Halalas, proceeds: Halalas): Halalas => proceeds - (cost - accumulated);
