import { describe, expect, it } from 'vitest';
import {
  buildOwnerEmailByName,
  formatRecord,
  normalizeProject,
  normalizeProjectName,
  pickHeader,
} from './projects.ai.js';

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
  it('prefers short label cells over a data row with more populated (long/multi-line) cells', () => {
    const values = [
      ['Project Name', 'Description', 'ETA', 'Stakeholders', 'Status'], // real header: 5 short labels
      [
        'Toilet Block-15',
        '- Project brief & scope approval\n- Hygiene\n- Factory compliance', // long, multi-line
        '20-Aug-26\n30-Sep-26', // multi-line
        'Sudhir Yadav',
        'Quotation Awaited',
        'extra long remark cell with lots of prose that spills over the label length limit', // 6th populated cell
      ],
    ];
    // The data row has more non-empty cells (6 > 5) but fewer label-like ones.
    expect(pickHeader(values).headerIdx).toBe(0);
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

  it('captures a well-formed stakeholder email, lowercased for stable matching', () => {
    const p = normalizeProject({ ...base, ownerEmail: 'Sam.Patel@Example.com' }, 'Sheet', '');
    expect(p.ownerEmail).toBe('sam.patel@example.com');
  });

  it('drops a hallucinated/malformed email', () => {
    const p = normalizeProject({ ...base, ownerEmail: 'not-an-email' }, 'Sheet', '');
    expect(p.ownerEmail).toBeNull();
  });

  it('defaults ownerEmail to null when absent', () => {
    const p = normalizeProject({ ...base }, 'Sheet', '');
    expect(p.ownerEmail).toBeNull();
  });

  it('treats an empty-string ownerEmail as absent', () => {
    const p = normalizeProject({ ...base, ownerEmail: '' }, 'Sheet', '');
    expect(p.ownerEmail).toBeNull();
  });
});

describe('buildOwnerEmailByName', () => {
  // Mirrors the real sheet: A "Project Name", E "Stakeholders" (a person chip).
  const header = ['Project Name', 'Description', 'Features', 'ETA', 'Stakeholders', 'Status'];
  const rows = [
    ['Toilet Block-15', 'desc', '', '', 'Sudhir Yadav', 'Quotation Awaited'],
    ['ETP Expansion Plant', 'desc', '', '', 'Raj Kumar Attri', 'NFA Pending'],
  ];
  const chips = [
    [null, null, null, null, 'sudhir.yadav@lenskart.in', null],
    [null, null, null, null, 'rajkumar.attri@lenskart.com', null],
  ];

  it('keys the stakeholder-column chip email by normalized project name', () => {
    const map = buildOwnerEmailByName(header, rows, chips);
    expect(map.get(normalizeProjectName('Toilet Block-15'))).toBe('sudhir.yadav@lenskart.in');
    expect(map.get(normalizeProjectName('ETP Expansion Plant'))).toBe('rajkumar.attri@lenskart.com');
  });

  it('matches case- and whitespace-insensitively', () => {
    const map = buildOwnerEmailByName(header, rows, chips);
    expect(map.get(normalizeProjectName('  toilet   block-15 '))).toBe('sudhir.yadav@lenskart.in');
  });

  it('falls back to the first chip in the row when no stakeholder column is detected', () => {
    const plainHeader = ['Item', 'Detail', 'Contact'];
    const plainRows = [['Alpha', 'x', 'Sam']];
    const plainChips = [[null, null, 'sam@example.com']];
    const map = buildOwnerEmailByName(plainHeader, plainRows, plainChips);
    expect(map.get(normalizeProjectName('Alpha'))).toBe('sam@example.com');
  });

  it('drops a name that maps to conflicting emails (ambiguous)', () => {
    const dupRows = [
      ['Shared Name', '', '', '', 'Person A', ''],
      ['Shared Name', '', '', '', 'Person B', ''],
    ];
    const dupChips = [
      [null, null, null, null, 'a@example.com', null],
      [null, null, null, null, 'b@example.com', null],
    ];
    const map = buildOwnerEmailByName(header, dupRows, dupChips);
    expect(map.has(normalizeProjectName('Shared Name'))).toBe(false);
  });

  it('skips rows with no chip email', () => {
    const map = buildOwnerEmailByName(header, [['Beta', '', '', '', 'Someone', '']], [[null, null, null, null, null, null]]);
    expect(map.size).toBe(0);
  });
});
