import { describe, expect, it } from 'vitest';
import type { LiveMeeting, Meeting } from '@iris/shared';
import {
  adhocLiveMeeting,
  alpha,
  artifactTone,
  browserRecognitionLocale,
  fmtMmss,
  livePromptMeeting,
  livePromptTiming,
  matchScore,
  matchesQuery,
  parseAdhocPeople,
  sttLanguage,
} from './helpers';

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
  it('passes auto through so the server lets Whisper detect the language', () => {
    expect(sttLanguage('auto')).toBe('auto');
    expect(sttLanguage(' AUTO ')).toBe('auto');
  });
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

describe('browserRecognitionLocale', () => {
  it('maps auto to en-IN so English is not mis-scripted into Devanagari', () => {
    expect(browserRecognitionLocale('auto')).toBe('en-IN');
    expect(browserRecognitionLocale(' Auto ')).toBe('en-IN');
  });
  it('passes explicit locales through unchanged (hi-IN stays for Hindi-dominant calls)', () => {
    expect(browserRecognitionLocale('en-US')).toBe('en-US');
    expect(browserRecognitionLocale('hi-IN')).toBe('hi-IN');
  });
});

describe('livePromptMeeting', () => {
  const live: LiveMeeting = {
    id: 'evt1',
    title: 'Q3 Board Review',
    startAt: '2026-07-06T09:00:00.000Z',
    endAt: '2026-07-06T10:00:00.000Z',
    location: 'Room 4',
    attendees: 9,
    attendeeNames: [],
    googleEventId: null,
  };

  it('surfaces the current live meeting when nothing blocks it', () => {
    expect(livePromptMeeting(live, new Set(), false)).toBe(live);
  });
  it('shows nothing when there is no live meeting', () => {
    expect(livePromptMeeting(null, new Set(), false)).toBeNull();
  });
  it('shows nothing once the meeting has been dismissed', () => {
    expect(livePromptMeeting(live, new Set(['evt1']), false)).toBeNull();
  });
  it('shows nothing while a recording is underway', () => {
    expect(livePromptMeeting(live, new Set(), true)).toBeNull();
  });
});

describe('livePromptTiming', () => {
  const now = Date.parse('2026-07-06T09:00:00.000Z');

  it('reads as starting now within a minute either side', () => {
    expect(livePromptTiming('2026-07-06T09:00:00.000Z', now)).toBe('Starting now');
    expect(livePromptTiming('2026-07-06T09:00:20.000Z', now)).toBe('Starting now');
    expect(livePromptTiming('2026-07-06T08:59:40.000Z', now)).toBe('Starting now');
  });
  it('counts up an upcoming start', () => {
    expect(livePromptTiming('2026-07-06T09:04:00.000Z', now)).toBe('Starts in 4 min');
  });
  it('counts up a meeting already in progress', () => {
    expect(livePromptTiming('2026-07-06T08:50:00.000Z', now)).toBe('Started 10 min ago');
  });
  it('falls back to starting now on an unparseable date', () => {
    expect(livePromptTiming('not-a-date', now)).toBe('Starting now');
  });
});

describe('adhocLiveMeeting', () => {
  const nowIso = '2026-07-06T09:00:00.000Z';

  it('returns null when the adhoc flag is absent or falsy', () => {
    expect(adhocLiveMeeting({}, nowIso)).toBeNull();
    expect(adhocLiveMeeting({ adhoc: '0' }, nowIso)).toBeNull();
    expect(adhocLiveMeeting({ adhoc: 'false' }, nowIso)).toBeNull();
  });

  it('synthesizes a live meeting from extension params', () => {
    const m = adhocLiveMeeting(
      { adhoc: '1', title: 'iRIS TESTING', start: nowIso, code: 'abc-defg-hij', platform: 'meet' },
      nowIso,
    );
    expect(m).not.toBeNull();
    expect(m!.title).toBe('iRIS TESTING');
    expect(m!.id).toBe('adhoc:abc-defg-hij');
    expect(m!.startAt).toBe(nowIso);
    expect(m!.location).toBe('Google Meet');
    // Default one-hour window so it reads as "in progress" for a while.
    expect(m!.endAt).toBe('2026-07-06T10:00:00.000Z');
    expect(m!.googleEventId).toBeNull();
  });

  it('defaults the title and start, and labels known platforms', () => {
    const m = adhocLiveMeeting({ adhoc: '1', platform: 'zoom' }, nowIso);
    expect(m!.title).toBe('Live meeting');
    expect(m!.startAt).toBe(nowIso);
    expect(m!.location).toBe('Zoom');
  });

  it('ignores an unparseable start and uses now instead', () => {
    const m = adhocLiveMeeting({ adhoc: '1', start: 'nope', platform: 'teams' }, nowIso);
    expect(m!.startAt).toBe(nowIso);
    expect(m!.endAt).toBe('2026-07-06T10:00:00.000Z');
    expect(m!.location).toBe('Microsoft Teams');
  });

  it('keys the id off the title when no code is supplied', () => {
    const m = adhocLiveMeeting({ adhoc: '1', title: 'Strategy sync' }, nowIso);
    expect(m!.id).toBe('adhoc:Strategy sync');
    expect(m!.location).toBeNull();
  });

  it('carries scraped participant names through as attendee candidates', () => {
    const m = adhocLiveMeeting(
      { adhoc: '1', title: 'Office', platform: 'meet', people: 'Arya Khadgi|Aman Pathak' },
      nowIso,
    );
    expect(m!.attendeeNames).toEqual(['Arya Khadgi', 'Aman Pathak']);
    expect(m!.attendees).toBe(2);
  });
});

describe('parseAdhocPeople', () => {
  it('returns [] for empty/absent input', () => {
    expect(parseAdhocPeople(null)).toEqual([]);
    expect(parseAdhocPeople(undefined)).toEqual([]);
    expect(parseAdhocPeople('')).toEqual([]);
  });
  it('splits on both pipe and comma and trims', () => {
    expect(parseAdhocPeople('Arya Khadgi | Aman Pathak')).toEqual(['Arya Khadgi', 'Aman Pathak']);
    expect(parseAdhocPeople('Raj Pandey, Krishan')).toEqual(['Raj Pandey', 'Krishan']);
  });
  it('de-duplicates case-insensitively and drops blanks', () => {
    expect(parseAdhocPeople('Aman|aman| |Aman Pathak')).toEqual(['Aman', 'Aman Pathak']);
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
