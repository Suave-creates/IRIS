import { describe, expect, it } from 'vitest';
import { alpha, freqLabel, initials } from './helpers';

describe('freqLabel', () => {
  it('derives the cadence label from the day count', () => {
    expect(freqLabel(0)).toBe('No days set');
    expect(freqLabel(1)).toBe('Once a week');
    expect(freqLabel(2)).toBe('Twice a week');
    expect(freqLabel(3)).toBe('Thrice a week');
    expect(freqLabel(4)).toBe('4 days a week');
    expect(freqLabel(5)).toBe('Daily');
    expect(freqLabel(6)).toBe('6 days a week');
  });

  it('falls back to Daily for out-of-range counts', () => {
    expect(freqLabel(7)).toBe('Daily');
  });
});

describe('alpha', () => {
  it('converts a hex colour to an exact rgba tint', () => {
    expect(alpha('#17a877', 0.12)).toBe('rgba(23, 168, 119, 0.12)');
  });

  it('expands shorthand hex before converting', () => {
    expect(alpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('tints CSS variables via color-mix so tokens stay theme-aware', () => {
    expect(alpha('var(--info)', 0.25)).toBe('color-mix(in srgb, var(--info) 25%, transparent)');
    expect(alpha('var(--success)', 0.086)).toBe('color-mix(in srgb, var(--success) 8.6%, transparent)');
  });
});

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Raj Pandey')).toBe('RP');
  });

  it('handles single-word names', () => {
    expect(initials('Alok')).toBe('A');
  });

  it('ignores words beyond the first two in long names', () => {
    expect(initials('Rajkumari Attri Sharma')).toBe('RA');
  });

  it('survives extra whitespace and empty input', () => {
    expect(initials('  Ashish   Broadway ')).toBe('AB');
    expect(initials('')).toBe('');
  });
});
