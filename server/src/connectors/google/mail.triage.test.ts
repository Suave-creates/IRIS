import { describe, expect, it } from 'vitest';
import { mapTriageResults, normalizeTriage } from './mail.triage.js';

describe('normalizeTriage', () => {
  it('keeps a valid entry, clamps category/priority, caps tags', () => {
    expect(
      normalizeTriage({ summary: 'Approve the MSA', category: 'approvals', priority: 'high', tags: ['legal', 'msa', 'q3', 'extra'] }),
    ).toEqual({ summary: 'Approve the MSA', category: 'approvals', priority: 'high', tags: ['legal', 'msa', 'q3'] });
  });
  it('falls back to fyi/med for unknown enums', () => {
    const t = normalizeTriage({ summary: 'x', category: 'spam', priority: 'urgent' });
    expect([t?.category, t?.priority]).toEqual(['fyi', 'med']);
  });
  it('drops entries without a summary', () => {
    expect(normalizeTriage({ category: 'tasks', priority: 'low' })).toBeNull();
    expect(normalizeTriage(null)).toBeNull();
  });
});

describe('mapTriageResults', () => {
  const a = { index: 1, summary: 'A', category: 'tasks', priority: 'low' };
  const b = { index: 2, summary: 'B', category: 'finance', priority: 'high' };

  it('maps entries to input order by their index', () => {
    const out = mapTriageResults([b, a], 2); // returned out of order
    expect(out[0]?.summary).toBe('A');
    expect(out[1]?.summary).toBe('B');
  });
  it('fills gaps with null when an entry is dropped (no misattribution)', () => {
    const out = mapTriageResults([{ index: 2, summary: 'B', category: 'fyi', priority: 'low' }], 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeNull(); // index 1 missing — NOT shifted from index 2
    expect(out[1]?.summary).toBe('B');
    expect(out[2]).toBeNull();
  });
  it('ignores duplicate/out-of-range indices and unusable entries', () => {
    const out = mapTriageResults([a, { index: 1, summary: 'dup', category: 'fyi', priority: 'low' }, { index: 9, summary: 'x', category: 'fyi', priority: 'low' }], 2);
    expect(out[0]?.summary).toBe('A'); // first index-1 wins
    expect(out[1]).toBeNull();
  });
});
