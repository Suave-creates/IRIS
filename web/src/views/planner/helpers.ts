import type { PlannerColor } from '@iris/shared';

export type PlannerView = 'day' | 'week' | 'month';

const MS_DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD for a Date (no timezone shift). */
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a YYYY-MM-DD string into a local Date at midnight. */
export function fromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Adds `n` days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDays(ymd: string, n: number): string {
  return toYmd(new Date(fromYmd(ymd).getTime() + n * MS_DAY));
}

export function addMonths(ymd: string, n: number): string {
  const d = fromYmd(ymd);
  return toYmd(new Date(d.getFullYear(), d.getMonth() + n, d.getDate()));
}

/** The Monday (week start) of the week containing `ymd`. */
export function weekStart(ymd: string): string {
  const d = fromYmd(ymd);
  const dow = (d.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  return toYmd(new Date(d.getTime() - dow * MS_DAY));
}

/** The 7 YYYY-MM-DD dates (Mon→Sun) of the week containing `ymd`. */
export function weekDates(ymd: string): string[] {
  const start = weekStart(ymd);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Weekday short label (Mon…Sun) for a YYYY-MM-DD. */
export function weekdayLabel(ymd: string): string {
  const d = fromYmd(ymd);
  return WEEKDAYS[(d.getDay() + 6) % 7]!;
}

/** "Jul 6" for a YYYY-MM-DD. */
export function dayLabel(ymd: string): string {
  const d = fromYmd(ymd);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function dayOfMonth(ymd: string): number {
  return fromYmd(ymd).getDate();
}
export function monthLabel(ymd: string): string {
  const d = fromYmd(ymd);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]} ${d.getFullYear()}`;
}

/** Range label for the header, per view. */
export function rangeLabel(view: PlannerView, ymd: string): string {
  if (view === 'day') return `${weekdayLabel(ymd)}, ${dayLabel(ymd)} ${fromYmd(ymd).getFullYear()}`;
  if (view === 'month') return monthLabel(ymd);
  const dates = weekDates(ymd);
  const a = fromYmd(dates[0]!);
  const b = fromYmd(dates[6]!);
  const left = `${MONTHS[a.getMonth()]} ${a.getDate()}`;
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}` : `${MONTHS[b.getMonth()]} ${b.getDate()}`;
  return `${left} – ${right}, ${b.getFullYear()}`;
}

/** The inclusive [from, to] date window the current view needs from the API. */
export function viewRange(view: PlannerView, ymd: string): { from: string; to: string } {
  if (view === 'day') return { from: ymd, to: ymd };
  if (view === 'week') {
    const dates = weekDates(ymd);
    return { from: dates[0]!, to: dates[6]! };
  }
  // Month: pad to whole weeks so the grid's leading/trailing days are covered.
  const d = fromYmd(ymd);
  const first = toYmd(new Date(d.getFullYear(), d.getMonth(), 1));
  const last = toYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return { from: weekStart(first), to: addDays(weekStart(last), 6) };
}

/** The weeks (each 7 YYYY-MM-DD) that make up the month grid containing `ymd`. */
export function monthWeeks(ymd: string): string[][] {
  const { from, to } = viewRange('month', ymd);
  const weeks: string[][] = [];
  for (let cur = from; cur <= to; cur = addDays(cur, 7)) weeks.push(weekDates(cur));
  return weeks;
}

export function isSameMonth(ymd: string, ref: string): boolean {
  return fromYmd(ymd).getMonth() === fromYmd(ref).getMonth();
}

/** Step forward/back by one unit of the current view. */
export function step(view: PlannerView, ymd: string, dir: -1 | 1): string {
  if (view === 'day') return addDays(ymd, dir);
  if (view === 'week') return addDays(ymd, dir * 7);
  return addMonths(ymd, dir);
}

/** Whole-day difference b − a (both YYYY-MM-DD), e.g. daysBetween('2026-07-06','2026-07-08') = 2. */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / MS_DAY);
}

/** The last day a block covers, given its start date + span (≥1). */
export function blockEndDate(date: string, span: number): string {
  return addDays(date, Math.max(1, span) - 1);
}

/** True if `ymd` falls within the block's [date, date+span-1] range. */
export function blockCovers(date: string, span: number, ymd: string): boolean {
  return ymd >= date && ymd <= blockEndDate(date, span);
}

/** CSS accent per planner colour key. */
export const PLANNER_COLOR_CSS: Record<PlannerColor, string> = {
  neutral: 'var(--text-3)',
  accent: 'var(--accent)',
  success: 'var(--success)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  info: 'var(--info)',
};
