/**
 * Live date frame for People & Meetings. Everything derives from the REAL
 * current date (functions accept an optional `now` for tests): the drawer
 * calendar shows the actual current month, meetings are stamped with their
 * actual dates, and "Today"/"3d ago" labels are true.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** The current month's shape (drawer calendar + stat labels). */
export interface MonthFrame {
  year: number;
  /** 1-based month. */
  month: number;
  monthShort: string; // "July"
  monthLabel: string; // "July 2026"
  daysInMonth: number;
  /** Today's day-of-month. */
  today: number;
  /** Grid cells before day 1 in an S–S week row (0 = the 1st is a Sunday). */
  leadingBlanks: number;
}

export function monthFrame(now: Date = new Date()): MonthFrame {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return {
    year,
    month,
    monthShort: MONTH_NAMES[month - 1]!,
    monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
    daysInMonth: new Date(year, month, 0).getDate(),
    today: now.getDate(),
    leadingBlanks: new Date(year, month - 1, 1).getDay(),
  };
}

/** Local calendar date as a MySQL DATE string: "2026-07-03". */
export function todayDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Local wall-clock instant as a MySQL DATETIME string. */
export function nowDateTime(now: Date = new Date()): string {
  return `${todayDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** Parses the date part of a MySQL DATE/DATETIME string into UTC-noon (DST-safe for date math). */
function parseDate(value: string): Date | null {
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Short weekday of a MySQL DATE/DATETIME string: "Fri". */
export function weekdayShortOf(value: string): string {
  const date = parseDate(value);
  return date ? WEEKDAYS[date.getUTCDay()]! : '—';
}

/** Uppercase weekday for meeting date blocks: "FRI". */
export function weekdayUpperOf(value: string): string {
  return weekdayShortOf(value).toUpperCase();
}

/** "Jul 3" from a MySQL DATE/DATETIME string. */
export function dateLabel(value: string): string {
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!month || !day) return value;
  return `${MONTH_ABBREVS[month - 1] ?? '?'} ${day}`;
}

/** Day-of-month of a MySQL DATE/DATETIME string. */
export function dayOfMonth(value: string): number {
  const day = Number(value.slice(8, 10));
  return Number.isFinite(day) && day >= 1 ? day : 1;
}

/** True when the date string falls on the current local day. */
export function isTodayDate(value: string, now: Date = new Date()): boolean {
  return value.slice(0, 10) === todayDate(now);
}

/** True when the date string falls in the current local month. */
export function isCurrentMonth(value: string, now: Date = new Date()): boolean {
  return value.slice(0, 7) === todayDate(now).slice(0, 7);
}

/** Relative label vs the real today: "Today", "Yesterday", "3d ago", "2w ago", "Mar 2026". */
export function agoLabel(value: string, now: Date = new Date()): string {
  const date = parseDate(value);
  if (!date) return value;
  const today = parseDate(todayDate(now))!;
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 60) return `${Math.round(diffDays / 7)}w ago`;
  return dateLabel(value);
}

/** "MM:SS" for a recorder duration. */
export function mmss(totalSecs: number): string {
  const secs = Math.max(0, Math.floor(totalSecs));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${pad(m)}:${pad(s)}`;
}

/** "9:00 AM" from a MySQL DATETIME string ("2026-07-03 09:00:00"). */
export function timeOfDayLabel(value: string): string {
  const h = Number(value.slice(11, 13));
  const m = Number(value.slice(14, 16));
  if (!Number.isFinite(h)) return value;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${suffix}`;
}
