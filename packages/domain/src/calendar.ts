/**
 * Company calendar (module 01 PLT-74): working weekdays (KSA default Sunday–Thursday) and holidays.
 * Dates are business dates in Asia/Riyadh as YYYY-MM-DD strings.
 */
export const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4];

/** Fixed-date Saudi public holidays; Eid al-Fitr / al-Adha follow the Umm al-Qura calendar and are entered per year. */
export function fixedSaudiHolidays(year: number): { date: string; name_ar: string; name_en: string }[] {
  return [
    { date: `${year}-02-22`, name_ar: 'يوم التأسيس', name_en: 'Founding Day' },
    { date: `${year}-09-23`, name_ar: 'اليوم الوطني', name_en: 'National Day' },
  ];
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface CompanyCalendar {
  workingDays: number[];
  holidays: Set<string> | string[];
}

function holidaySet(c: CompanyCalendar): Set<string> {
  return c.holidays instanceof Set ? c.holidays : new Set(c.holidays);
}

export function isBusinessDay(date: string, c: CompanyCalendar): boolean {
  return c.workingDays.includes(weekday(date)) && !holidaySet(c).has(date);
}

/** The date itself if it is a business day, otherwise the next one. */
export function nextBusinessDay(date: string, c: CompanyCalendar): string {
  let d = date;
  for (let i = 0; i < 60 && !isBusinessDay(d, c); i++) d = shift(d, 1);
  return d;
}

/** Add n business days (n ≥ 0) — e.g. delivery "45 to 60 working days". */
export function addBusinessDays(date: string, n: number, c: CompanyCalendar): string {
  let d = date;
  let left = n;
  while (left > 0) {
    d = shift(d, 1);
    if (isBusinessDay(d, c)) left--;
  }
  return d;
}

/** Business days strictly after `from` up to and including `to`. */
export function businessDaysBetween(from: string, to: string, c: CompanyCalendar): number {
  let n = 0;
  for (let d = shift(from, 1); d <= to; d = shift(d, 1)) if (isBusinessDay(d, c)) n++;
  return n;
}
