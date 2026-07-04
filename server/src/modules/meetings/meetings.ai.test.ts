import { describe, expect, it } from 'vitest';
import type { RecordingTranscriptLine } from '@iris/shared';
import { buildFallbackMeeting, normalizeMeeting } from './meetings.ai.js';

const TRANSCRIPT: RecordingTranscriptLine[] = [
  { tsSecs: 0, speaker: 'You', text: 'Quick agenda — ASRS throughput, the RCA backlog, and the database indexing work.' },
  { tsSecs: 3, speaker: 'Raj Pandey', text: 'ASRS picks are up 8% week over week, but putaway is still the bottleneck on line 3.' },
  { tsSecs: 6, speaker: 'Krishan', text: 'The AI-based RCA flagged the same conveyor fault twice — I want to retrofit sensors this month.' },
];
const PARTICIPANTS = ['You', 'Raj Pandey', 'Krishan'];

describe('buildFallbackMeeting', () => {
  it('is deterministic for the same transcript and participants', () => {
    const a = buildFallbackMeeting('online', TRANSCRIPT, PARTICIPANTS);
    const b = buildFallbackMeeting('online', TRANSCRIPT, PARTICIPANTS);
    expect(a).toEqual(b);
  });

  it('titles by mode with an online/in-room prefix, or uses the calendar title hint verbatim', () => {
    expect(buildFallbackMeeting('online', TRANSCRIPT, PARTICIPANTS).title).toMatch(/^Online meeting — .+$/);
    expect(buildFallbackMeeting('inroom', TRANSCRIPT, PARTICIPANTS).title).toMatch(/^In-room — .+$/);
    expect(buildFallbackMeeting('inroom', TRANSCRIPT, PARTICIPANTS, 'Ops WBR').title).toBe('Ops WBR');
  });

  it('stays neutral and boosts every named participant by 2, never capture labels', () => {
    const m = buildFallbackMeeting('inroom', TRANSCRIPT, PARTICIPANTS);
    expect(m.sentiment).toBe('Neutral');
    expect(m.ctxUpdates.map((u) => u.who)).toEqual(['Raj Pandey', 'Krishan']);
    expect(m.participants).toEqual(['Raj Pandey', 'Krishan']);
    expect(m.ctxUpdates.every((u) => u.deltaN === 2)).toBe(true);
    const micOnly = buildFallbackMeeting('inroom', TRANSCRIPT, ['Mic']);
    expect(micOnly.participants).toEqual([]);
    expect(micOnly.ctxUpdates).toEqual([]);
  });

  it('handles an empty transcript without crashing', () => {
    const m = buildFallbackMeeting('online', [], []);
    expect(m.title.length).toBeGreaterThan(0);
    expect(m.summary.length).toBeGreaterThan(0);
    expect(m.ctxUpdates).toEqual([]);
  });

  it('never treats the executive, unknown-speaker placeholders or channel labels as participants', () => {
    const whisperTranscript: RecordingTranscriptLine[] = [
      { tsSecs: 0, speaker: 'Arya Khadgi', text: 'Quick agenda for today.' },
      { tsSecs: 4, speaker: 'Unknown Speaker', text: 'Sounds good, let us start.' },
    ];
    const m = buildFallbackMeeting(
      'online',
      whisperTranscript,
      ['Arya Khadgi', 'Unknown Speaker', 'Unknown Speaker A', 'Speaker 1', 'Raj Pandey'],
      null,
      'Arya Khadgi',
    );
    expect(m.participants).toEqual(['Raj Pandey']);
    expect(m.ctxUpdates.map((u) => u.who)).toEqual(['Raj Pandey']);
  });

  it('starts with empty artifacts and carryovers (nothing invented)', () => {
    const m = buildFallbackMeeting('online', TRANSCRIPT, PARTICIPANTS);
    expect(m.artifacts).toEqual([]);
    expect(m.carryovers).toEqual([]);
  });
});

describe('normalizeMeeting', () => {
  const fallback = buildFallbackMeeting('online', TRANSCRIPT, PARTICIPANTS);

  it('whitelists sentiment against the known set', () => {
    expect(normalizeMeeting({ sentiment: 'Euphoric' }, fallback).sentiment).toBe('Neutral');
    expect(normalizeMeeting({ sentiment: 42 }, fallback).sentiment).toBe('Neutral');
    expect(normalizeMeeting({ sentiment: 'Mixed' }, fallback).sentiment).toBe('Mixed');
  });

  it('clamps ctx-update deltas into 1..3 and defaults non-numbers to 2', () => {
    const out = normalizeMeeting(
      {
        ctxUpdates: [
          { who: 'Raj Pandey', change: 'big change', deltaN: 99 },
          { who: 'Krishan', change: 'small change', deltaN: -4 },
          { who: 'Vimal Kumar', change: 'odd change', deltaN: 'lots' },
        ],
      },
      fallback,
    );
    expect(out.ctxUpdates.map((u) => u.deltaN)).toEqual([3, 1, 2]);
  });

  it('drops malformed rows and slices oversized arrays', () => {
    const out = normalizeMeeting(
      {
        topics: ['A', 7, null, 'B', 'C', 'D', 'E', 'F'],
        risks: [{ nope: true }, 'Real risk'],
        actions: [{ title: 'Do it', owner: 42, dueDate: 'not-a-date' }, { owner: 'Raj' }, null],
        decisions: Array.from({ length: 20 }, (_, i) => `Decision ${i}`),
      },
      fallback,
    );
    expect(out.topics).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(out.risks).toEqual(['Real risk']);
    expect(out.actions).toEqual([{ title: 'Do it', owner: 'Unassigned', dueDate: null }]);
    expect(out.decisions).toHaveLength(8);
  });

  it('keeps a valid ISO due date', () => {
    const out = normalizeMeeting({ actions: [{ title: 'T', owner: 'Raj', dueDate: '2026-06-28' }] }, fallback);
    expect(out.actions[0]?.dueDate).toBe('2026-06-28');
    expect(out.actions[0]?.owner).toBe('Raj');
  });

  it('drops ctx updates missing a who or change', () => {
    const out = normalizeMeeting(
      { ctxUpdates: [{ who: '', change: 'x', deltaN: 2 }, { who: 'Raj', deltaN: 2 }, { who: 'Krishan', change: 'kept', deltaN: 2 }] },
      fallback,
    );
    expect(out.ctxUpdates.map((u) => u.who)).toEqual(['Krishan']);
  });

  it('falls back to the deterministic content when fields are missing', () => {
    const out = normalizeMeeting({}, fallback);
    expect(out.title).toBe(fallback.title);
    expect(out.summary).toBe(fallback.summary);
    expect(out.topics).toEqual(fallback.topics);
    expect(out.ctxUpdates).toEqual(fallback.ctxUpdates);
    expect(out.linkNote).toBe(fallback.linkNote);
  });

  it('filters capture-channel labels out of extracted participants', () => {
    const out = normalizeMeeting({ participants: ['Mic', 'Raj Pandey', 'you', 'Krishan'] }, fallback);
    expect(out.participants).toEqual(['Raj Pandey', 'Krishan']);
  });

  it('sanitizes speaker attribution (valid line indexes + non-empty names only)', () => {
    const out = normalizeMeeting(
      {
        speakerAttribution: [
          { line: 0, speaker: 'Raj Pandey' },
          { line: -1, speaker: 'Bad' },
          { line: 1.5, speaker: 'Bad' },
          { line: 2, speaker: '' },
          { line: '3', speaker: 'Bad' },
          { line: 4, speaker: 'Krishan' },
        ],
      },
      fallback,
    );
    expect(out.attribution).toEqual([
      { line: 0, speaker: 'Raj Pandey' },
      { line: 4, speaker: 'Krishan' },
    ]);
    expect(normalizeMeeting({}, fallback).attribution).toEqual([]);
  });

  it('allows unknown-speaker placeholders in attribution but never raw channel labels', () => {
    const out = normalizeMeeting(
      {
        speakerAttribution: [
          { line: 0, speaker: 'Unknown Speaker A' },
          { line: 1, speaker: 'Unknown Speaker B' },
          { line: 2, speaker: 'MIC' },
          { line: 3, speaker: 'Call' },
          { line: 4, speaker: 'Speaker 1' },
          { line: 5, speaker: 'SPK2' },
          { line: 6, speaker: 'Raj Pandey' },
        ],
      },
      fallback,
    );
    expect(out.attribution).toEqual([
      { line: 0, speaker: 'Unknown Speaker A' },
      { line: 1, speaker: 'Unknown Speaker B' },
      { line: 6, speaker: 'Raj Pandey' },
    ]);
  });

  it('keeps unknown-speaker placeholders and channel labels out of participants', () => {
    const out = normalizeMeeting(
      { participants: ['MIC', 'CALL', 'Speaker 1', 'Unknown Speaker A', 'Unknown Speaker', 'Raj Pandey'] },
      fallback,
    );
    expect(out.participants).toEqual(['Raj Pandey']);
  });

  it('does not flag real names that merely start like channel words', () => {
    const out = normalizeMeeting({ participants: ['Mica Rivera', 'Callum Reid', 'Roomana Khan'] }, fallback);
    expect(out.participants).toEqual(['Mica Rivera', 'Callum Reid', 'Roomana Khan']);
  });

  it('sanitizes artifacts: label required, kind slugged, ref must be an http(s) url', () => {
    const out = normalizeMeeting(
      {
        artifacts: [
          { kind: 'github', label: 'wms-core repo', ref: 'https://github.com/acme/wms-core' },
          { kind: 'Google Doc!', label: 'Q3 capacity sheet', ref: '' },
          { kind: 'url', label: 'Rollout plan', ref: 'not a url' },
          { kind: 'url', label: 'FTP dump', ref: 'ftp://files.acme.dev/dump' },
          { kind: 'jira', label: '', ref: 'https://acme.atlassian.net/WH-42' },
          { kind: 7, label: 'Mystery item', ref: 42 },
          'nonsense',
          null,
        ],
      },
      fallback,
    );
    expect(out.artifacts).toEqual([
      { kind: 'github', label: 'wms-core repo', ref: 'https://github.com/acme/wms-core' },
      { kind: 'google-doc', label: 'Q3 capacity sheet', ref: null },
      { kind: 'url', label: 'Rollout plan', ref: null },
      { kind: 'url', label: 'FTP dump', ref: null },
      { kind: 'other', label: 'Mystery item', ref: null },
    ]);
  });

  it('caps artifacts at 12 and bounds label/ref lengths', () => {
    const out = normalizeMeeting(
      {
        artifacts: [
          { kind: 'url', label: 'L'.repeat(400), ref: `https://acme.dev/${'a'.repeat(600)}` },
          ...Array.from({ length: 15 }, (_, i) => ({ kind: 'url', label: `Link ${i}`, ref: '' })),
        ],
      },
      fallback,
    );
    expect(out.artifacts).toHaveLength(12);
    expect(out.artifacts[0]?.label).toHaveLength(160);
    expect(out.artifacts[0]?.ref).toBeNull(); // over-long URLs are dropped, not truncated
  });

  it('sanitizes carryovers: strings only, capped at 8', () => {
    const out = normalizeMeeting(
      { carryovers: ['Sensor retrofit still open', 42, null, '  ', ...Array.from({ length: 10 }, (_, i) => `Item ${i}`)] },
      fallback,
    );
    expect(out.carryovers).toHaveLength(8);
    expect(out.carryovers[0]).toBe('Sensor retrofit still open');
  });

  it('returns empty artifacts and carryovers when the tool omits them (never invents)', () => {
    const out = normalizeMeeting({}, fallback);
    expect(out.artifacts).toEqual([]);
    expect(out.carryovers).toEqual([]);
  });
});
