import { env } from '../config/env.js';

/* Business dates are in the company time zone (APP_TIMEZONE); timestamps are stored in UTC. */
const parts = (d, tz = env.timezone) => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const o = Object.fromEntries(f.formatToParts(d).map(p => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute };
};

/** 'YYYY-MM-DD' for the given instant in the business time zone. */
export function localDate(d = new Date()) {
  const p = parts(d);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
export function localYearMonth(d = new Date()) {
  const p = parts(d);
  return { year: p.y, month: p.m, day: p.d };
}
/** Minutes after local midnight. */
export function localMinutes(d = new Date()) {
  const p = parts(d);
  return p.hh * 60 + p.mm;
}
export function isLate(d = new Date(), lateAfter = env.lateAfter) {
  const [h, m] = lateAfter.split(':').map(Number);
  return localMinutes(d) > h * 60 + (m || 0);
}
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 0 = Sunday … 6 = Saturday for a calendar date. */
export const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
export const isoDate = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export function addDays(iso, n) {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
/** Offset of the business time zone from UTC, in minutes, at instant d. */
export function tzOffsetMinutes(d = new Date()) {
  const p = parts(d);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - d.getTime()) / 60000);
}
/** UTC [start, end) covering local dates fromIso..toIso inclusive — for sargable DATETIME2 filters. */
export function utcRange(fromIso, toIso = fromIso) {
  const off = tzOffsetMinutes(new Date(fromIso + 'T12:00:00Z'));
  const start = new Date(Date.parse(fromIso + 'T00:00:00Z') - off * 60000);
  const end = new Date(Date.parse(addDays(toIso, 1) + 'T00:00:00Z') - off * 60000);
  return { start, end };
}
export function monthRange(year, month) {
  return { from: isoDate(year, month, 1), to: isoDate(year, month, daysInMonth(year, month)) };
}
/** Normalises a DATE coming back from mssql (a JS Date at UTC midnight) to 'YYYY-MM-DD'. */
export const toIso = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
