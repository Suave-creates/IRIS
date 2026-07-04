import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  dateLabel,
  dayOfMonth,
  isCurrentMonth,
  isTodayDate,
  mmss,
  monthFrame,
  nowDateTime,
  timeOfDayLabel,
  todayDate,
  weekdayShortOf,
  weekdayUpperOf,
} from './design-frame.js';

// Fixed reference "now" so assertions are deterministic: Friday Jul 3, 2026.
const NOW = new Date(2026, 6, 3, 14, 30, 5);

describe('monthFrame', () => {
  it('describes the real current month (days, today, S–S grid offset)', () => {
    const frame = monthFrame(NOW);
    expect(frame).toEqual({
      year: 2026,
      month: 7,
      monthShort: 'July',
      monthLabel: 'July 2026',
      daysInMonth: 31,
      today: 3,
      leadingBlanks: 3, // Jul 1 2026 is a Wednesday
    });
  });
  it('handles months starting on Sunday with zero blanks', () => {
    expect(monthFrame(new Date(2026, 10, 15)).leadingBlanks).toBe(0); // Nov 1 2026 is a Sunday
  });
});

describe('date strings', () => {
  it('formats today and now as MySQL strings', () => {
    expect(todayDate(NOW)).toBe('2026-07-03');
    expect(nowDateTime(NOW)).toBe('2026-07-03 14:30:05');
  });
  it('derives real weekdays and labels from stored dates', () => {
    expect(weekdayShortOf('2026-07-03 09:00:00')).toBe('Fri');
    expect(weekdayUpperOf('2026-07-04')).toBe('SAT');
    expect(dateLabel('2026-07-03')).toBe('Jul 3');
    expect(dateLabel('2026-12-25 10:00:00')).toBe('Dec 25');
    expect(dayOfMonth('2026-07-28 08:00:00')).toBe(28);
  });
  it('detects today and the current month', () => {
    expect(isTodayDate('2026-07-03 23:59:00', NOW)).toBe(true);
    expect(isTodayDate('2026-07-02', NOW)).toBe(false);
    expect(isCurrentMonth('2026-07-28', NOW)).toBe(true);
    expect(isCurrentMonth('2026-06-30', NOW)).toBe(false);
  });
});

describe('agoLabel', () => {
  it('labels real relative distances', () => {
    expect(agoLabel('2026-07-03', NOW)).toBe('Today');
    expect(agoLabel('2026-07-02', NOW)).toBe('Yesterday');
    expect(agoLabel('2026-06-30', NOW)).toBe('3d ago');
    expect(agoLabel('2026-06-19', NOW)).toBe('2w ago');
    expect(agoLabel('2026-03-10', NOW)).toBe('Mar 10');
  });
});

describe('time formatting', () => {
  it('formats durations as MM:SS', () => {
    expect(mmss(0)).toBe('00:00');
    expect(mmss(41)).toBe('00:41');
    expect(mmss(204)).toBe('03:24');
  });
  it('formats DATETIME times as 12-hour labels', () => {
    expect(timeOfDayLabel('2026-07-03 09:00:00')).toBe('9:00 AM');
    expect(timeOfDayLabel('2026-07-03 14:00:00')).toBe('2:00 PM');
    expect(timeOfDayLabel('2026-07-03 00:05:00')).toBe('12:05 AM');
  });
});
