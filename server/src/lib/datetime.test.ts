import { describe, expect, it } from 'vitest';
import { isoToMysqlUtc, mysqlUtcToIso } from './datetime.js';

describe('isoToMysqlUtc', () => {
  it('renders an ISO instant as a UTC MySQL datetime', () => {
    expect(isoToMysqlUtc('2026-06-24T09:30:00.000Z')).toBe('2026-06-24 09:30:00');
  });
  it('normalizes an offset instant to UTC', () => {
    // 14:30 at +05:30 == 09:00 UTC
    expect(isoToMysqlUtc('2026-06-24T14:30:00+05:30')).toBe('2026-06-24 09:00:00');
  });
});

describe('mysqlUtcToIso', () => {
  it('appends Z so the browser parses it unambiguously (the 7am-collapse fix)', () => {
    expect(mysqlUtcToIso('2026-06-24 09:30:00')).toBe('2026-06-24T09:30:00.000Z');
  });
  it('passes through already-ISO and unparseable values', () => {
    expect(mysqlUtcToIso('2026-06-24T09:30:00.000Z')).toBe('2026-06-24T09:30:00.000Z');
    expect(mysqlUtcToIso('not a date')).toBe('not a date');
    expect(mysqlUtcToIso('')).toBe('');
  });
});

describe('round-trip', () => {
  it('isoToMysqlUtc and mysqlUtcToIso are inverses (instant preserved)', () => {
    const iso = '2026-12-31T18:45:00.000Z';
    expect(mysqlUtcToIso(isoToMysqlUtc(iso))).toBe(iso);
  });
});
