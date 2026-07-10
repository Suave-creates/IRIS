import { describe, expect, it } from 'vitest';
import { formatRecord, normalizeProject, pickHeader } from './projects.ai.js';

describe('pickHeader', () => {
  it('picks the most label-dense row among the first few', () => {
    const values = [
      ['Q3 Tracker', '', ''], // title row (sparse)
      ['Project', 'Owner', 'Status', 'ETA'], // real header (dense)
      ['Alpha', 'Sam', 'On track', 'Jul 4'],
    ];
    const { headerIdx, header } = pickHeader(values);
    expect(headerIdx).toBe(1);
    expect(header).toEqual(['Project', 'Owner', 'Status', 'ETA']);
  });
  it('handles an empty grid', () => {
    expect(pickHeader([])).toEqual({ headerIdx: 0, header: [] });
  });
});

describe('formatRecord', () => {
  const header = ['Project', 'Owner', 'Status'];
  it('renders labeled pairs and skips empty cells', () => {
    expect(formatRecord(3, header, ['Alpha', '', 'On track'])).toBe('[3] Project: Alpha | Status: On track');
  });
  it('falls back to a Column label when the header is missing a slot', () => {
    expect(formatRecord(1, ['Project'], ['Alpha', 'Extra'])).toBe('[1] Project: Alpha | Column 2: Extra');
  });
  it('returns null for an all-empty row', () => {
    expect(formatRecord(2, header, ['', '', ''])).toBeNull();
  });
});

describe('normalizeProject', () => {
  const base = { name: 'Revenue Tracker', summary: 'Tracks revenue.', priority: 'high', status: 'On track' };

  it('captures a stakeholder name and a well-formed email', () => {
    const p = normalizeProject({ ...base, owner: 'Sam Patel', ownerEmail: 'Sam.Patel@Example.com' }, 'Sheet', '');
    expect(p.owner).toBe('Sam Patel');
    // Emails are lowercased for stable matching against People records.
    expect(p.ownerEmail).toBe('sam.patel@example.com');
  });

  it('drops a hallucinated/malformed email but keeps the name', () => {
    const p = normalizeProject({ ...base, owner: 'Sam Patel', ownerEmail: 'not-an-email' }, 'Sheet', '');
    expect(p.owner).toBe('Sam Patel');
    expect(p.ownerEmail).toBeNull();
  });

  it('defaults owner and ownerEmail to null when absent', () => {
    const p = normalizeProject({ ...base }, 'Sheet', '');
    expect(p.owner).toBeNull();
    expect(p.ownerEmail).toBeNull();
  });

  it('treats an empty-string owner/ownerEmail as absent', () => {
    const p = normalizeProject({ ...base, owner: '', ownerEmail: '' }, 'Sheet', '');
    expect(p.owner).toBeNull();
    expect(p.ownerEmail).toBeNull();
  });
});
