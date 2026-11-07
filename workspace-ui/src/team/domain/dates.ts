/**
 * Dates are handled as calendar strings (YYYY-MM-DD) in the company timezone. Calendar arithmetic
 * is done on UTC midnights so daylight-saving changes never shift a day.
 */

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const ymdFormatters = new Map<string, Intl.DateTimeFormat>();

export function ymdInTz(date: Date, tz: string): string {
  let f = ymdFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    ymdFormatters.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const ymdOfUnix = (unix: number, tz: string) => ymdInTz(new Date(unix * 1000), tz);

export const todayYmd = (tz: string) => ymdInTz(new Date(), tz);

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((toUtc(toYmd).getTime() - toUtc(fromYmd).getTime()) / 864e5);
}

/** Monday of the week containing ymd. */
export function weekStart(ymd: string): string {
  const dow = toUtc(ymd).getUTCDay(); // 0 = Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

export function weekdayShort(ymd: string): string {
  return toUtc(ymd).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Format a calendar date with the company's moment-style format (statics.date_formats[].format_moment),
 * e.g. "MMM D, YYYY" or "DD/MM/YYYY". Supports the tokens Invoice Ninja ships.
 */
export function formatYmd(ymd: string, momentFormat = 'MMM D, YYYY'): string {
  const d = toUtc(ymd);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const dow = d.getUTCDay();
  const pad = (n: number) => String(n).padStart(2, '0');
  const tokens: Record<string, string> = {
    YYYY: String(y),
    YY: String(y).slice(-2),
    MMMM: MONTHS[m] ?? '',
    MMM: (MONTHS[m] ?? '').slice(0, 3),
    MM: pad(m + 1),
    M: String(m + 1),
    DD: pad(day),
    D: String(day),
    dddd: DAYS[dow] ?? '',
    ddd: (DAYS[dow] ?? '').slice(0, 3),
  };
  return momentFormat.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g, (t) => tokens[t] ?? t);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** 24h HH:MM in the company timezone, as in the mock's today list. */
export function timeOfDay(unix: number, tz: string): string {
  let f = timeFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    timeFormatters.set(tz, f);
  }
  return f.format(new Date(unix * 1000));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** H:MM:SS */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 3600)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}

/** Hours for display: whole numbers from 100 up, otherwise up to one decimal. */
export function fmtH(hours: number): string {
  return hours >= 100
    ? Math.round(hours).toLocaleString('en-US')
    : hours.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export const hoursOf = (seconds: number) => seconds / 3600;

/** "today", "yesterday", "5 days ago", "3 mo ago", "1.2 yr ago"; calendar days in tz. */
export function ago(unix: number, tz: string, nowDate = new Date()): string {
  if (!unix) return 'no time logged';
  const days = daysBetween(ymdOfUnix(unix, tz), ymdInTz(nowDate, tz));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  return months < 12 ? `${months} mo ago` : `${(days / 365).toFixed(1)} yr ago`;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Offset (ms) of tz from UTC at the given instant: wall clock read as UTC, minus the instant. */
function offsetAt(ms: number, tz: string): number {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Unix time of a wall-clock moment (YYYY-MM-DD + HH:MM) in a timezone. Two passes handle a
 * daylight-saving change between the guess and the answer; a time inside a spring-forward gap
 * lands just after the gap.
 */
export function unixFromLocal(ymd: string, hhmm: string, tz: string): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0);
  let guess = wall - offsetAt(wall, tz);
  guess = wall - offsetAt(guess, tz);
  return Math.floor(guess / 1000);
}
