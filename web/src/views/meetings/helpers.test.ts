import { describe, expect, it } from 'vitest';
import type { Meeting } from '@iris/shared';
import { alpha, artifactTone, fmtMmss, matchScore, matchesQuery, sttLanguage } from './helpers';

const meeting: Meeting = {
  id: 'm2',
  title: 'ASRS Optimization sync',
  mode: 'online',
  isNew: false,
  dowLabel: 'WED',
  dayNum: 18,
  dateLabel: 'Jun 18',
  timeLabel: '11:30 AM',
  durationLabel: '38 min',
  sentiment: 'Positive',
  summary: 'ASRS pick rates hit a new high after the slotting change. Putaway remains the constraint.',
  topics: ['ASRS optimization', 'Putaway SLAs', 'WMS migration'],
  participants: ['You', 'Vimal Kumar', 'Sougata', 'Deepak'],
  risks: ['Putaway backlog could breach SLA during peak if phase 1 underdelivers'],
  followups: ['Rehearse WMS cutover Jul 5'],
  actions: [],
  decisions: [],
  transcript: [],
  ctxUpdates: [],
  linkNote: 'WH Automation, WMS migration',
  artifacts: [],
  carryovers: [],
  sttEngine: null,
};

describe('matchesQuery', () => {
  it('matches on the title', () => {
    expect(matchesQuery(meeting, 'optimization sync')).toBe(true);
  });
  it('matches on a topic', () => {
    expect(matchesQuery(meeting, 'WMS migration')).toBe(true);
  });
  it('matches on a participant', () => {
    expect(matchesQuery(meeting, 'Sougata')).toBe(true);
  });
  it('matches on the summary', () => {
    expect(matchesQuery(meeting, 'slotting change')).toBe(true);
  });
  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matchesQuery(meeting, '  asrs OPTIMIZATION ')).toBe(true);
  });
  it('rejects text found nowhere in the meeting', () => {
    expect(matchesQuery(meeting, 'defect pareto')).toBe(false);
  });
  it('treats an empty or whitespace-only query as a match', () => {
    expect(matchesQuery(meeting, '')).toBe(true);
    expect(matchesQuery(meeting, '   ')).toBe(true);
  });
  it('matches natural-language phrasing on token overlap, ignoring stopwords', () => {
    // The shipped suggestion chips must surface results, not empty states.
    expect(matchesQuery(meeting, 'ASRS decisions')).toBe(true);
    expect(matchesQuery(meeting, 'open commitments to Vimal')).toBe(true);
  });
  it('searches risks and followups too', () => {
    expect(matchesQuery(meeting, 'peak backlog')).toBe(true);
    expect(matchesQuery(meeting, 'cutover rehearsal')).toBe(true);
  });
});

describe('matchScore', () => {
  it('ranks exact-phrase hits above token hits', () => {
    expect(matchScore(meeting, 'ASRS optimization')).toBe(1000);
    expect(matchScore(meeting, 'ASRS decisions')).toBe(1);
  });
  it('counts one point per matching meaningful token', () => {
    expect(matchScore(meeting, 'putaway migration slotting')).toBe(3);
  });
  it('scores zero when no meaningful token matches', () => {
    expect(matchScore(meeting, 'the to a')).toBe(0);
    expect(matchScore(meeting, 'defect pareto')).toBe(0);
  });
});

describe('fmtMmss', () => {
  it('zero-pads minutes and seconds', () => {
    expect(fmtMmss(0)).toBe('00:00');
    expect(fmtMmss(7)).toBe('00:07');
    expect(fmtMmss(65)).toBe('01:05');
  });
  it('rolls seconds into minutes past one hour of the counter', () => {
    expect(fmtMmss(600)).toBe('10:00');
    expect(fmtMmss(3599)).toBe('59:59');
  });
});

describe('artifactTone', () => {
  it('tints known kinds like the person Files tab chips', () => {
    expect(artifactTone('url').color).toBe('var(--info)');
    expect(artifactTone('jira').color).toBe('var(--info)');
    expect(artifactTone('sheet').color).toBe('var(--success)');
    expect(artifactTone('pdf').color).toBe('var(--danger)');
    expect(artifactTone('github')).toEqual(artifactTone('git'));
  });
  it('is case- and whitespace-insensitive', () => {
    expect(artifactTone(' GitHub ')).toEqual(artifactTone('github'));
  });
  it('falls back to a neutral tint for unknown kinds', () => {
    expect(artifactTone('other')).toEqual({ color: 'var(--text-2)', bg: 'var(--surface-3)' });
    expect(artifactTone('')).toEqual(artifactTone('something-new'));
  });
});

describe('sttLanguage', () => {
  it('maps hindi locales to hi', () => {
    expect(sttLanguage('hi-IN')).toBe('hi');
  });
  it('maps english locales to en', () => {
    expect(sttLanguage('en-IN')).toBe('en');
    expect(sttLanguage('en-US')).toBe('en');
  });
  it('defaults unknown locales to en', () => {
    expect(sttLanguage('fr-FR')).toBe('en');
    expect(sttLanguage('')).toBe('en');
  });
});

describe('alpha', () => {
  it('converts a hex colour to an rgba tint', () => {
    expect(alpha('#1f9d57', 0.05)).toBe('rgba(31, 157, 87, 0.05)');
    expect(alpha('#d14343', 0.21)).toBe('rgba(209, 67, 67, 0.21)');
  });
  it('keeps full opacity intact', () => {
    expect(alpha('#6b5bd6', 1)).toBe('rgba(107, 91, 214, 1)');
  });
});
