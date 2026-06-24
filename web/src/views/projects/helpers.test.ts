import { describe, expect, it } from 'vitest';
import { PRIORITY_META, SOURCE_META, deadlineLabel, statusColor } from './helpers';

describe('deadlineLabel', () => {
  it('returns a placeholder for no deadline', () => {
    expect(deadlineLabel(null)).toBe('No deadline');
  });
  it('formats an ISO date (not the raw string)', () => {
    const label = deadlineLabel('2026-07-04');
    expect(label).not.toBe('2026-07-04');
    expect(label).not.toBe('No deadline');
  });
  it('passes through non-date human strings', () => {
    expect(deadlineLabel('Q3')).toBe('Q3');
    expect(deadlineLabel('End of sprint')).toBe('End of sprint');
  });
});

describe('statusColor', () => {
  it('keys colour off the status word', () => {
    expect(statusColor('At risk')).toBe('var(--danger)');
    expect(statusColor('Blocked')).toBe('var(--danger)');
    expect(statusColor('In review')).toBe('var(--warn)');
    expect(statusColor('Done')).toBe('var(--success)');
    expect(statusColor('In progress')).toBe('var(--success)');
    expect(statusColor('Planning')).toBe('var(--info)'); // default
  });
});

describe('metadata maps', () => {
  it('cover every priority and source kind', () => {
    expect(Object.keys(PRIORITY_META).sort()).toEqual(['critical', 'high', 'low', 'med']);
    for (const k of ['manual', 'calendar', 'journal', 'conversation', 'sheet', 'doc', 'folder'] as const) {
      expect(SOURCE_META[k]).toBeTruthy();
    }
  });
});
