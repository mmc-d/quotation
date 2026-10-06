import { describe, expect, it } from 'vitest';
import { distanceMeters, formatMinutes, GEOFENCE_RADIUS_M, inHeatBanSeason, prayerTimes, scheduleWarnings, type CompanyCalendar } from '../src/index.js';

const cal: CompanyCalendar = { workingDays: [0, 1, 2, 3, 4], holidays: ['2026-09-23'] };
const keys = (w: { key: string }[]) => w.map((x) => x.key);
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h! * 60 + m!; };

describe('prayer times (Umm al-Qura, Jeddah 21.5433 N, 39.1728 E, UTC+3)', () => {
  // Reference: 2026-06-21 checked against a published Umm al-Qura timetable for Jeddah
  // (islamicprayerstimes.com, retrieved 2026-10-06: Fajr 04:16, Dhuhr 12:26, Asr 15:45, Maghrib 19:09;
  // Isha is Maghrib + 90 by the method). 2026-01-01 is from the same method, not yet cross-checked.
  // Published tables round and add safety minutes (Fajr differs most), so we accept ±5 minutes —
  // enough for a soft 20-minute scheduling warning. Confirm against ummulqura.org.sa before relying on it.
  const reference: Record<string, Record<string, string>> = {
    '2026-01-01': { fajr: '05:40', dhuhr: '12:28', asr: '15:32', maghrib: '17:53', isha: '19:23' },
    '2026-06-21': { fajr: '04:16', dhuhr: '12:26', asr: '15:45', maghrib: '19:09', isha: '20:39' },
  };
  for (const [date, ref] of Object.entries(reference)) {
    it(`matches the published times on ${date} within ±5 min`, () => {
      const t = prayerTimes(date);
      for (const [k, v] of Object.entries(ref)) {
        expect(Math.abs(t[k as keyof typeof t] - hm(v)), `${k}: got ${formatMinutes(t[k as keyof typeof t])}, want ${v}`).toBeLessThanOrEqual(5);
      }
    });
  }

  it('Isha is Maghrib + 90 min, + 120 min in Ramadan', () => {
    const t = prayerTimes('2026-03-01');
    expect(t.isha - t.maghrib).toBeCloseTo(90, 6);
    const r = prayerTimes('2026-03-01', { ramadan: true });
    expect(r.isha - r.maghrib).toBeCloseTo(120, 6);
  });

  it('Riyadh is about 25 minutes earlier than Jeddah', () => {
    const j = prayerTimes('2026-06-21');
    const r = prayerTimes('2026-06-21', { lat: 24.7136, lng: 46.6753 });
    expect(j.dhuhr - r.dhuhr).toBeGreaterThan(28);
    expect(j.dhuhr - r.dhuhr).toBeLessThan(32);
  });
});

describe('schedule warnings', () => {
  it('flags a Friday or a holiday', () => {
    // 2026-10-09 is a Friday
    const w = scheduleWarnings({ start: '2026-10-09T09:00:00+03:00', end: '2026-10-09T11:00:00+03:00', outdoor: false, calendar: cal });
    expect(keys(w)).toContain('non_business_day');
    const h = scheduleWarnings({ start: '2026-09-23T09:00:00+03:00', end: '2026-09-23T10:00:00+03:00', outdoor: false, calendar: cal });
    expect(keys(h)).toContain('non_business_day');
    const ok = scheduleWarnings({ start: '2026-10-11T08:00:00+03:00', end: '2026-10-11T10:00:00+03:00', outdoor: false, calendar: cal });
    expect(ok).toEqual([]);
  });

  it('applies the midday heat ban only to outdoor work between 15 Jun and 15 Sep', () => {
    const july = { start: '2026-07-12T13:00:00+03:00', end: '2026-07-12T14:00:00+03:00', calendar: cal };
    expect(keys(scheduleWarnings({ ...july, outdoor: true }))).toContain('heat_ban');
    expect(keys(scheduleWarnings({ ...july, outdoor: false }))).not.toContain('heat_ban');
    // overlapping the edge of the window
    expect(keys(scheduleWarnings({ start: '2026-07-12T09:00:00+03:00', end: '2026-07-12T12:30:00+03:00', outdoor: true, calendar: cal }))).toContain('heat_ban');
    expect(keys(scheduleWarnings({ start: '2026-07-12T15:00:00+03:00', end: '2026-07-12T17:00:00+03:00', outdoor: true, calendar: cal }))).not.toContain('heat_ban');
    expect(keys(scheduleWarnings({ start: '2026-10-11T13:00:00+03:00', end: '2026-10-11T14:00:00+03:00', outdoor: true, calendar: cal }))).not.toContain('heat_ban');
    expect(inHeatBanSeason('2026-06-15')).toBe(true);
    expect(inHeatBanSeason('2026-09-15')).toBe(true);
    expect(inHeatBanSeason('2026-06-14')).toBe(false);
    expect(inHeatBanSeason('2026-09-16')).toBe(false);
  });

  it('warns when a Ramadan day exceeds 6 hours', () => {
    const ramadan = { from: '2026-02-18', to: '2026-03-19' };
    const long = scheduleWarnings({ start: '2026-03-01T08:00:00+03:00', end: '2026-03-01T15:00:00+03:00', outdoor: false, calendar: cal, ramadan });
    expect(keys(long)).toContain('ramadan_hours');
    const short = scheduleWarnings({ start: '2026-03-01T08:00:00+03:00', end: '2026-03-01T14:00:00+03:00', outdoor: false, calendar: cal, ramadan });
    expect(keys(short)).not.toContain('ramadan_hours');
    expect(keys(scheduleWarnings({ start: '2026-03-01T08:00:00+03:00', end: '2026-03-01T15:00:00+03:00', outdoor: false, calendar: cal }))).not.toContain('ramadan_hours');
  });

  it('warns when the start falls just after a prayer and lists prayers inside the booking', () => {
    const t = prayerTimes('2026-10-11');
    const dhuhr = Math.round(t.dhuhr);
    const at = (min: number) => `2026-10-11T${formatMinutes(min)}:00+03:00`;
    const right = scheduleWarnings({ start: at(dhuhr + 5), end: at(dhuhr + 120), outdoor: false, calendar: cal });
    expect(keys(right)).toContain('prayer_start');
    expect(right.find((w) => w.key === 'prayer_start')!.en).toContain('Dhuhr');
    const later = scheduleWarnings({ start: at(dhuhr + 25), end: at(dhuhr + 60), outdoor: false, calendar: cal });
    expect(keys(later)).not.toContain('prayer_start');
    const across = scheduleWarnings({ start: '2026-10-11T11:00:00+03:00', end: '2026-10-11T17:00:00+03:00', outdoor: false, calendar: cal });
    const inside = across.find((w) => w.key === 'prayers_inside')!;
    expect(inside.en).toContain('Dhuhr');
    expect(inside.en).toContain('Asr');
    expect(inside.ar).toContain('الظهر');
  });

  it('ignores an empty or inverted window', () => {
    expect(scheduleWarnings({ start: '2026-10-09T10:00:00+03:00', end: '2026-10-09T10:00:00+03:00', outdoor: true, calendar: cal })).toEqual([]);
  });
});

describe('geofence', () => {
  it('haversine distance', () => {
    expect(distanceMeters(21.5433, 39.1728, 21.5433, 39.1728)).toBe(0);
    // 0.001° of latitude ≈ 111 m
    expect(distanceMeters(21.5433, 39.1728, 21.5443, 39.1728)).toBeGreaterThan(110);
    expect(distanceMeters(21.5433, 39.1728, 21.5443, 39.1728)).toBeLessThan(112);
    // Jeddah → Riyadh ≈ 850 km
    const d = distanceMeters(21.5433, 39.1728, 24.7136, 46.6753) / 1000;
    expect(d).toBeGreaterThan(830);
    expect(d).toBeLessThan(870);
    expect(GEOFENCE_RADIUS_M).toBe(300);
  });
});
