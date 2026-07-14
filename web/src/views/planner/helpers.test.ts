import { describe, expect, it } from 'vitest';
import {
  addDays,
  blockCovers,
  blockEndDate,
  daysBetween,
  monthWeeks,
  rangeLabel,
  step,
  viewRange,
  weekDates,
  weekStart,
  weekdayLabel,
} from './helpers';

describe('weekStart / weekDates', () => {
  it('resolves the Monday of the week (Sun belongs to the prior Mon week)', () => {
    // 2026-07-08 is a Wednesday → week starts Mon 2026-07-06.
    expect(weekStart('2026-07-08')).toBe('2026-07-06');
    // 2026-07-12 is a Sunday → still the Mon 2026-07-06 week.
    expect(weekStart('2026-07-12')).toBe('2026-07-06');
    // 2026-07-06 is itself a Monday.
    expect(weekStart('2026-07-06')).toBe('2026-07-06');
  });

  it('lists Mon→Sun for the week', () => {
    expect(weekDates('2026-07-08')).toEqual([
      '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12',
    ]);
    expect(weekdayLabel('2026-07-06')).toBe('Mon');
    expect(weekdayLabel('2026-07-12')).toBe('Sun');
  });
});

describe('addDays', () => {
  it('adds and subtracts across month boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01'); // 2026 not a leap year
  });
});

describe('step', () => {
  it('moves by the view unit', () => {
    expect(step('day', '2026-07-08', 1)).toBe('2026-07-09');
    expect(step('week', '2026-07-08', 1)).toBe('2026-07-15');
    expect(step('week', '2026-07-08', -1)).toBe('2026-07-01');
    expect(step('month', '2026-07-08', 1)).toBe('2026-08-08');
  });
});

describe('viewRange', () => {
  it('day = a single date', () => {
    expect(viewRange('day', '2026-07-08')).toEqual({ from: '2026-07-08', to: '2026-07-08' });
  });
  it('week = Mon..Sun', () => {
    expect(viewRange('week', '2026-07-08')).toEqual({ from: '2026-07-06', to: '2026-07-12' });
  });
  it('month = padded to whole weeks (Jul 2026 → Jun 29 .. Aug 2)', () => {
    expect(viewRange('month', '2026-07-15')).toEqual({ from: '2026-06-29', to: '2026-08-02' });
  });
});

describe('monthWeeks', () => {
  it('tiles the padded month into 7-day weeks', () => {
    const weeks = monthWeeks('2026-07-15');
    expect(weeks[0]![0]).toBe('2026-06-29');
    expect(weeks.at(-1)!.at(-1)).toBe('2026-08-02');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe('span coverage', () => {
  it('daysBetween counts whole days', () => {
    expect(daysBetween('2026-07-06', '2026-07-08')).toBe(2);
    expect(daysBetween('2026-07-08', '2026-07-06')).toBe(-2);
    expect(daysBetween('2026-07-06', '2026-07-06')).toBe(0);
  });
  it('blockEndDate = start + (span-1)', () => {
    expect(blockEndDate('2026-07-06', 1)).toBe('2026-07-06');
    expect(blockEndDate('2026-07-06', 3)).toBe('2026-07-08');
    expect(blockEndDate('2026-07-06', 0)).toBe('2026-07-06'); // span clamped to ≥1
  });
  it('blockCovers spans the inclusive range', () => {
    // A 3-day block Mon(6)→Wed(8).
    expect(blockCovers('2026-07-06', 3, '2026-07-06')).toBe(true);
    expect(blockCovers('2026-07-06', 3, '2026-07-08')).toBe(true);
    expect(blockCovers('2026-07-06', 3, '2026-07-09')).toBe(false);
    expect(blockCovers('2026-07-06', 3, '2026-07-05')).toBe(false);
    // Single-day block only covers its own day.
    expect(blockCovers('2026-07-06', 1, '2026-07-07')).toBe(false);
  });
});

describe('rangeLabel', () => {
  it('formats each view', () => {
    expect(rangeLabel('day', '2026-07-08')).toBe('Wed, Jul 8 2026');
    expect(rangeLabel('week', '2026-07-08')).toBe('Jul 6 – 12, 2026');
    expect(rangeLabel('month', '2026-07-08')).toBe('July 2026');
  });
  it('spans months in the week label when needed', () => {
    // Week of Mon Jun 29 .. Sun Jul 5, 2026.
    expect(rangeLabel('week', '2026-07-01')).toBe('Jun 29 – Jul 5, 2026');
  });
});
