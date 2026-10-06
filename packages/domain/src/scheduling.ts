/**
 * KSA scheduling rules (module 05 §4 / module 06 FSM-27, FSM-49): business days, the summer
 * midday outdoor-work ban, Ramadan working hours, prayer times (Umm al-Qura method) and the
 * check-in geofence. All warnings are soft — they are shown to the dispatcher, never block a booking.
 * Times are Asia/Riyadh (UTC+3, no daylight saving).
 */
import { isBusinessDay, type CompanyCalendar } from './calendar.js';

export interface ScheduleWarning {
  key: string;
  ar: string;
  en: string;
}

export interface ScheduleInput {
  /** ISO instants (any offset); evaluated in Asia/Riyadh */
  start: string | Date;
  end: string | Date;
  outdoor: boolean;
  calendar: CompanyCalendar;
  /** Ramadan of the booking's year as YYYY-MM-DD (inclusive); null = unknown */
  ramadan?: { from: string; to: string } | null;
  lat?: number | null;
  lng?: number | null;
}

/** Jeddah (default city for prayer times). */
export const DEFAULT_PRAYER_LOCATION = { lat: 21.5433, lng: 39.1728 };
/** A check-in further than this from the site pin is flagged (FSM-49). */
export const GEOFENCE_RADIUS_M = 300;
/** Ramadan: Muslim workers limited to 6 hours a day (Labour Law art. 98). */
export const RAMADAN_MAX_HOURS = 6;
/** A booking starting this soon after a prayer begins gets a soft warning. */
export const PRAYER_BUFFER_MIN = 20;

const RIYADH_OFFSET_MIN = 180;
const HOUR = 3_600_000;
const MIN = 60_000;

// ───────────────────────── geometry ─────────────────────────

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_008.8;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ───────────────────────── prayer times ─────────────────────────

export type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const PRAYER_NAMES: Record<PrayerKey, { ar: string; en: string }> = {
  fajr: { ar: 'الفجر', en: 'Fajr' },
  dhuhr: { ar: 'الظهر', en: 'Dhuhr' },
  asr: { ar: 'العصر', en: 'Asr' },
  maghrib: { ar: 'المغرب', en: 'Maghrib' },
  isha: { ar: 'العشاء', en: 'Isha' },
};
const PRAYER_ORDER: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const fix = (a: number, b: number) => a - b * Math.floor(a / b);

/** Sun declination (deg) and equation of time (hours) for a Julian day (US Naval Observatory low-precision formulas). */
function sunPosition(jd: number) {
  const D = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * D, 360);
  const q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * Math.sin(rad(g)) + 0.02 * Math.sin(rad(2 * g)), 360);
  const e = 23.439 - 0.00000036 * D;
  const RA = fix(deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15, 24);
  let eqt = q / 15 - RA;
  if (eqt > 12) eqt -= 24;
  if (eqt < -12) eqt += 24;
  const decl = deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L))));
  return { decl, eqt };
}

function julianDay(date: string): number {
  const [y0, m0, d] = date.split('-').map(Number) as [number, number, number];
  let y = y0;
  let m = m0;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

/**
 * Prayer start times for a Riyadh-calendar date, as minutes after local midnight (UTC+3).
 * Umm al-Qura: Fajr at sun 18.5° below the horizon; Isha = Maghrib + 90 min (120 in Ramadan);
 * Asr when an object's shadow = its length + noon shadow (Shafi'i factor 1); sunset at 0.833°.
 */
export function prayerTimes(date: string, opts: { lat?: number; lng?: number; ramadan?: boolean } = {}): Record<PrayerKey, number> {
  const lat = opts.lat ?? DEFAULT_PRAYER_LOCATION.lat;
  const lng = opts.lng ?? DEFAULT_PRAYER_LOCATION.lng;
  const jd0 = julianDay(date) - lng / 360;
  /** sun position at a local solar time (hours) */
  const sunAt = (h: number) => sunPosition(jd0 + h / 24);
  const noon = (h: number) => fix(12 - sunAt(h).eqt, 24);
  const angleTime = (angle: number, h: number, before: boolean) => {
    const { decl } = sunAt(h);
    const cos = (-Math.sin(rad(angle)) - Math.sin(rad(decl)) * Math.sin(rad(lat))) / (Math.cos(rad(decl)) * Math.cos(rad(lat)));
    const t = deg(Math.acos(Math.max(-1, Math.min(1, cos)))) / 15;
    return noon(h) + (before ? -t : t);
  };
  const asrAngle = (h: number) => {
    const { decl } = sunAt(h);
    return -deg(Math.atan(1 / (1 + Math.tan(rad(Math.abs(lat - decl))))));
  };
  // first pass from rough guesses, second pass evaluated at the first-pass times
  let fajr = angleTime(18.5, 5, true);
  let dhuhr = noon(12);
  let asr = angleTime(asrAngle(15), 15, false);
  let maghrib = angleTime(0.833, 18, false);
  fajr = angleTime(18.5, fajr, true);
  dhuhr = noon(dhuhr);
  asr = angleTime(asrAngle(asr), asr, false);
  maghrib = angleTime(0.833, maghrib, false);
  const local = (solar: number) => (solar + RIYADH_OFFSET_MIN / 60 - lng / 15) * 60;
  const m = local(maghrib);
  return { fajr: local(fajr), dhuhr: local(dhuhr), asr: local(asr), maghrib: m, isha: m + (opts.ramadan ? 120 : 90) };
}

/** "HH:MM" for minutes after midnight (rounded to the nearest minute). */
export function formatMinutes(min: number): string {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ───────────────────────── warnings ─────────────────────────

const toMs = (v: string | Date) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
/** Riyadh calendar date of an instant. */
const riyadhDay = (ms: number) => new Date(ms + RIYADH_OFFSET_MIN * MIN).toISOString().slice(0, 10);
/** Instant of Riyadh local midnight for a date. */
const riyadhMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`) - RIYADH_OFFSET_MIN * MIN;
const nextDay = (date: string) => riyadhDay(riyadhMidnight(date) + 36 * HOUR);
const clock = (ms: number) => new Date(ms + RIYADH_OFFSET_MIN * MIN).toISOString().slice(11, 16);

export function inRange(date: string, range: { from: string; to: string } | null | undefined): boolean {
  return !!range && date >= range.from && date <= range.to;
}

/** 15 June – 15 September (inclusive). */
export function inHeatBanSeason(date: string): boolean {
  const md = date.slice(5);
  return md >= '06-15' && md <= '09-15';
}

/**
 * Soft warnings for a booking (FSM-27): non-business day, summer midday outdoor ban (12:00–15:00,
 * 15 Jun – 15 Sep, outdoor work only), Ramadan > 6 h/day, starting right after a prayer begins,
 * and prayers that fall inside the booking.
 */
export function scheduleWarnings(input: ScheduleInput): ScheduleWarning[] {
  const start = toMs(input.start);
  const end = toMs(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const lat = input.lat ?? DEFAULT_PRAYER_LOCATION.lat;
  const lng = input.lng ?? DEFAULT_PRAYER_LOCATION.lng;
  const out: ScheduleWarning[] = [];
  const nonBusiness: string[] = [];
  const heat: string[] = [];
  const ramadanLong: { date: string; hours: number }[] = [];
  const inside: { date: string; key: PrayerKey; at: number }[] = [];
  let atPrayerStart: { key: PrayerKey; at: number } | null = null;

  const last = riyadhDay(end - 1);
  for (let d = riyadhDay(start), i = 0; d <= last && i < 62; d = nextDay(d), i++) {
    const dayStart = riyadhMidnight(d);
    const from = Math.max(start, dayStart);
    const to = Math.min(end, dayStart + 24 * HOUR);
    if (to <= from) continue;
    if (!isBusinessDay(d, input.calendar)) nonBusiness.push(d);
    if (input.outdoor && inHeatBanSeason(d) && from < dayStart + 15 * HOUR && to > dayStart + 12 * HOUR) heat.push(d);
    const ramadan = inRange(d, input.ramadan);
    if (ramadan && (to - from) / HOUR > RAMADAN_MAX_HOURS + 1e-9) ramadanLong.push({ date: d, hours: Math.round(((to - from) / HOUR) * 10) / 10 });
    const times = prayerTimes(d, { lat, lng, ramadan });
    for (const key of PRAYER_ORDER) {
      const at = dayStart + Math.round(times[key]) * MIN;
      if (!atPrayerStart && start >= at && start < at + PRAYER_BUFFER_MIN * MIN) atPrayerStart = { key, at };
      if (at > start && at < end) inside.push({ date: d, key, at });
    }
  }

  if (nonBusiness.length) {
    out.push({ key: 'non_business_day', ar: `الموعد في يوم عطلة (نهاية أسبوع أو إجازة رسمية): ${nonBusiness.join('، ')}`, en: `Booked on a non-business day (weekend or holiday): ${nonBusiness.join(', ')}` });
  }
  if (heat.length) {
    out.push({ key: 'heat_ban', ar: `حظر العمل تحت أشعة الشمس 12:00–15:00 (15 يونيو – 15 سبتمبر) لأعمال خارجية: ${heat.join('، ')}`, en: `Midday outdoor-work ban 12:00–15:00 (15 Jun – 15 Sep): ${heat.join(', ')}` });
  }
  if (ramadanLong.length) {
    const ar = ramadanLong.map((r) => `${r.date} (${r.hours} س)`);
    const en = ramadanLong.map((r) => `${r.date} (${r.hours} h)`);
    out.push({ key: 'ramadan_hours', ar: `رمضان: العمل أكثر من ${RAMADAN_MAX_HOURS} ساعات في اليوم: ${ar.join('، ')}`, en: `Ramadan: more than ${RAMADAN_MAX_HOURS} working hours in a day: ${en.join(', ')}` });
  }
  if (atPrayerStart) {
    const n = PRAYER_NAMES[atPrayerStart.key];
    out.push({ key: 'prayer_start', ar: `يبدأ الموعد خلال ${PRAYER_BUFFER_MIN} دقيقة من أذان ${n.ar} (${clock(atPrayerStart.at)}) — يُفضّل تأخيره قليلًا`, en: `Starts within ${PRAYER_BUFFER_MIN} min of ${n.en} (${clock(atPrayerStart.at)}) — consider a later start` });
  }
  if (inside.length) {
    const multiDay = new Set(inside.map((p) => p.date)).size > 1;
    const ar = inside.map((p) => `${PRAYER_NAMES[p.key].ar} ${multiDay ? `${p.date} ` : ''}${clock(p.at)}`);
    const en = inside.map((p) => `${PRAYER_NAMES[p.key].en} ${multiDay ? `${p.date} ` : ''}${clock(p.at)}`);
    out.push({ key: 'prayers_inside', ar: `أوقات صلاة خلال الموعد: ${ar.join('، ')}`, en: `Prayer times during the booking: ${en.join(', ')}` });
  }
  return out;
}
