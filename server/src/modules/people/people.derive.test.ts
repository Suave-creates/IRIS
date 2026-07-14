import { describe, expect, it } from 'vitest';
import type { EngagementEventLite, PersonActionLite, PersonMeetingLite, PersonProjectLite, PersonShape } from './people.derive.js';
import {
  buildPersonContext,
  cadenceBaseScore,
  deriveEngagement,
  driveKindChip,
  freqLabel,
  statusLabelFor,
} from './people.derive.js';

// Fixed "now" so assertions never depend on the machine's clock: Fri Jul 3, 2026.
const NOW = new Date(2026, 6, 3, 15, 0, 0);

const person: PersonShape = { name: 'Raj Pandey', func: 'Operations', location: 'BWD', days: [1, 2, 3, 4, 5] };

const boost: EngagementEventLite = { delta: 3, occurredOn: '2026-07-03', title: 'WH Automation sync' };

const meeting: PersonMeetingLite = {
  id: 'mtg_1',
  title: 'WH Automation sync',
  startedAt: '2026-07-03 10:00:00',
  summary: 'ASRS throughput up 8% WoW. Sensor retrofits agreed for this month.',
  topics: ['ASRS optimization', 'AI-based RCA'],
  source: 'recorder',
};

const action: PersonActionLite = {
  meetingId: 'mtg_1',
  meetingTitle: 'WH Automation sync',
  title: 'Confirm maintenance window with WH leads',
  dueDate: '2026-07-06',
  done: false,
};

describe('freqLabel', () => {
  it('maps day counts to the cadence table', () => {
    expect(freqLabel([])).toBe('No days set');
    expect(freqLabel([1])).toBe('Once a week');
    expect(freqLabel([1, 3])).toBe('Twice a week');
    expect(freqLabel([1, 2, 3, 4, 5])).toBe('Daily');
    expect(freqLabel([1, 2, 3, 4, 5, 6])).toBe('6 days a week');
  });
});

describe('driveKindChip', () => {
  it('maps Google Workspace and common MIME types to short chips', () => {
    expect(driveKindChip('application/vnd.google-apps.document')).toBe('DOC');
    expect(driveKindChip('application/vnd.google-apps.spreadsheet')).toBe('SHT');
    expect(driveKindChip('application/vnd.google-apps.presentation')).toBe('SLD');
    expect(driveKindChip('application/vnd.google-apps.folder')).toBe('FLD');
    expect(driveKindChip('application/pdf')).toBe('PDF');
    expect(driveKindChip('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('SHT');
    expect(driveKindChip('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('DOC');
    expect(driveKindChip('image/png')).toBe('IMG');
    expect(driveKindChip('application/zip')).toBe('FILE');
  });
});

describe('cadenceBaseScore + statusLabelFor', () => {
  it('is deterministic from the day count alone — identical plans score identically', () => {
    expect(cadenceBaseScore([1, 2, 3, 4, 5])).toBe(cadenceBaseScore([2, 3, 4, 5, 6]));
    expect(cadenceBaseScore([])).toBe(10);
    expect(cadenceBaseScore([4])).toBe(32);
    expect(cadenceBaseScore([2, 4])).toBe(56);
  });
  it('maps scores to the design status labels', () => {
    expect(statusLabelFor(94)).toBe('Highly Active');
    expect(statusLabelFor(72)).toBe('Active');
    expect(statusLabelFor(56)).toBe('Moderate');
    expect(statusLabelFor(32)).toBe('Low Activity');
    expect(statusLabelFor(10)).toBe('Dormant');
  });
});

describe('deriveEngagement', () => {
  it('with no events: cadence baseline, steady trend, no last interaction', () => {
    const eng = deriveEngagement([1, 2, 3, 4, 5], [], NOW);
    expect(eng).toEqual({
      score: 88,
      statusLabel: 'Highly Active',
      trend: 'steady',
      lastInteraction: null,
      meetingsThisMonth: 0,
      boostDelta: 0,
      boostTitle: null,
    });
  });
  it('with real events: adds deltas, caps at 99, rising trend, real "Today" label', () => {
    const eng = deriveEngagement([1, 2, 3, 4, 5], [boost], NOW);
    expect(eng.score).toBe(91);
    expect(eng.trend).toBe('rising');
    expect(eng.lastInteraction).toBe('Today');
    expect(eng.meetingsThisMonth).toBe(1);
    expect(eng.boostDelta).toBe(3);
    expect(eng.boostTitle).toBe('WH Automation sync');
    const capped = deriveEngagement([1, 2, 3, 4, 5, 6], [{ ...boost, delta: 50 }], NOW);
    expect(capped.score).toBe(99);
  });
  it('counts only current-month events in meetingsThisMonth and dates older labels truly', () => {
    const june: EngagementEventLite = { delta: 1, occurredOn: '2026-06-19', title: 'June sync' };
    const eng = deriveEngagement([1], [june, boost], NOW);
    expect(eng.meetingsThisMonth).toBe(1); // only the Jul 3 event
    const older = deriveEngagement([1], [june], NOW);
    expect(older.lastInteraction).toBe('2w ago');
  });
  it('treats a stored delta of 0 as the default 2 and takes the latest title', () => {
    const eng = deriveEngagement(
      [1],
      [
        { delta: 0, occurredOn: '2026-06-30', title: 'Older sync' },
        { delta: 1, occurredOn: '2026-07-03', title: 'Newer sync' },
      ],
      NOW,
    );
    expect(eng.boostDelta).toBe(3);
    expect(eng.boostTitle).toBe('Newer sync');
  });
});

describe('buildPersonContext (no meetings)', () => {
  const ctx = buildPersonContext(person, [], [], [], [], [], [], NOW);
  it('writes an honest no-meetings summary and no boost banner', () => {
    expect(ctx.summary).toBe(
      'Part of Operations at BWD. Cadence is daily. No processed meetings yet — IRIS builds living context here as meetings are recorded.',
    );
    expect(ctx.boostNote).toBeNull();
  });
  it('renders the REAL current month: 31 July days, Jul 1 offset, today flagged, zero dots', () => {
    expect(ctx.monthLabel).toBe('July 2026');
    expect(ctx.monthShort).toBe('July');
    expect(ctx.calendarLeadingBlanks).toBe(3); // Jul 1 2026 is a Wednesday
    expect(ctx.calendar).toHaveLength(31);
    expect(ctx.calendar.filter((d) => d.dots.length > 0)).toHaveLength(0);
    expect(ctx.calendar[2]!.isToday).toBe(true); // Jul 3
  });
  it('leaves every aggregate list empty (real empty states, no fabricated content)', () => {
    expect(ctx.timeline).toEqual([]);
    expect(ctx.topics).toEqual([]);
    expect(ctx.openActions).toEqual([]);
    expect(ctx.doneActions).toEqual([]);
    expect(ctx.projects).toEqual([]);
    expect(ctx.files).toEqual([]);
    expect(ctx.insights).toEqual([]);
  });
});

describe('buildPersonContext (with real meetings)', () => {
  const second: PersonMeetingLite = {
    ...meeting,
    id: 'mtg_2',
    title: 'Ops sync',
    startedAt: '2026-06-20 09:00:00', // previous month — timeline yes, calendar no
    topics: ['ASRS optimization'],
    source: 'seed',
  };
  const doneAction: PersonActionLite = {
    meetingId: 'mtg_2',
    meetingTitle: 'Ops sync',
    title: 'Close RCA',
    dueDate: null,
    done: true,
  };
  const ctx = buildPersonContext(person, [boost], [meeting, second], [action, doneAction], [], [], [], NOW);

  it('summarizes from real topics and open actions, banner dated with the real event date', () => {
    expect(ctx.summary).toContain('focused on ASRS optimization');
    expect(ctx.summary).toContain('1 action item open');
    expect(ctx.boostNote).toBe(
      'Engagement +3 from "WH Automation sync" — recorded Jul 3 in Meetings. Summary, actions and topics refreshed.',
    );
  });
  it('puts dots + detail only on current-month meeting days, dated for real', () => {
    const day3 = ctx.calendar[2]!;
    expect(day3.dots).toEqual(['Meeting']);
    expect(day3.detail?.typeLabel).toBe('Recorded');
    expect(day3.detail?.title).toBe('Fri, Jul 3 · with Raj Pandey');
    expect(day3.detail?.items).toEqual([{ kind: 'ACTION', text: 'Confirm maintenance window with WH leads' }]);
    // The June meeting is not on this month's calendar…
    expect(ctx.calendar.filter((d) => d.dots.length > 0)).toHaveLength(1);
  });
  it('…but appears in the timeline with its real date label', () => {
    expect(ctx.timeline).toHaveLength(2);
    expect(ctx.timeline[0]!.title).toBe('Meeting · WH Automation sync');
    expect(ctx.timeline[0]!.dateLabel).toBe('Fri · Jul 3');
    expect(ctx.timeline[1]!.dateLabel).toBe('Sat · Jun 20');
    expect(ctx.topics[0]).toMatchObject({ name: 'ASRS optimization', mentions: 2, pct: 100 });
  });
  it('splits owned actions into open (with real due label) and done', () => {
    expect(ctx.openActions).toEqual([
      {
        title: 'Confirm maintenance window with WH leads',
        meta: 'From WH Automation sync',
        dueLabel: 'Jul 6',
        done: false,
      },
    ]);
    expect(ctx.doneActions).toHaveLength(1);
  });
  it('derives insights only from real data (theme, follow-through, next step)', () => {
    const kinds = ctx.insights.map((i) => i.kind);
    expect(kinds).toEqual(['theme', 'followthrough', 'nextstep']);
    expect(ctx.insights[0]!.text).toBe('"ASRS optimization" has come up in 2 of the last 2 meetings.');
    expect(ctx.insights[2]!.text).toContain('due Jul 6');
  });
});

describe('buildPersonContext (stakeholder on real projects)', () => {
  const critical: PersonProjectLite = {
    id: 'proj_1',
    name: 'Revenue Tracker Q3',
    status: 'At risk',
    priority: 'critical',
    progress: 30,
    deadline: '2026-07-10',
    summary: 'Revenue model for quarterly forecasting.',
  };
  const med: PersonProjectLite = {
    id: 'proj_2',
    name: 'Revenue Planning FY26',
    status: 'Review',
    progress: 70,
    priority: 'med',
    deadline: null,
    summary: 'Revenue and headcount roadmap.',
  };
  const ctx = buildPersonContext(person, [], [], [], [], [critical, med], [], NOW);

  it('maps real projects into Actions-tab rows with a formatted deadline (no summary leaks into the DTO)', () => {
    expect(ctx.projects).toEqual([
      { id: 'proj_1', name: 'Revenue Tracker Q3', status: 'At risk', priority: 'critical', progress: 30, deadlineLabel: 'Jul 10' },
      { id: 'proj_2', name: 'Revenue Planning FY26', status: 'Review', priority: 'med', progress: 70, deadlineLabel: null },
    ]);
  });

  it('adds a project-involvement insight leading with the most urgent project', () => {
    const insight = ctx.insights.find((i) => i.kind === 'project');
    expect(insight).toBeDefined();
    expect(insight!.text).toBe(
      'Stakeholder on 2 projects, 1 at high priority or above — most urgent is "Revenue Tracker Q3" (At risk, 30% complete, due Jul 10).',
    );
  });

  it('surfaces the projects in the timeline (typed Project, dated by deadline)', () => {
    expect(ctx.timeline).toHaveLength(2);
    expect(ctx.timeline[0]).toMatchObject({
      type: 'Project',
      fromMeeting: false,
      title: 'Project · Revenue Tracker Q3',
      dateLabel: 'Due · Jul 10',
    });
    expect(ctx.timeline[0]!.snippet).toContain('At risk · 30%');
    expect(ctx.timeline[1]).toMatchObject({ title: 'Project · Revenue Planning FY26', dateLabel: 'Ongoing' });
  });

  it('blends recurring project keywords into the Topics tab (once per project)', () => {
    // "Revenue" appears in both projects' names/summaries → the top topic with 2 mentions.
    expect(ctx.topics[0]).toMatchObject({ name: 'Revenue', mentions: 2, pct: 100 });
    // Generic words are filtered out.
    expect(ctx.topics.some((t) => t.name.toLowerCase() === 'and')).toBe(false);
  });

  it('adds no project insight when the person owns no projects', () => {
    const empty = buildPersonContext(person, [], [], [], [], [], [], NOW);
    expect(empty.insights.some((i) => i.kind === 'project')).toBe(false);
    expect(empty.timeline).toEqual([]);
    expect(empty.topics).toEqual([]);
    expect(empty.kpis).toEqual([]);
  });
});

describe('buildPersonContext (stakeholder on KPIs)', () => {
  const kpi = {
    id: 'kpi_1',
    name: 'NDD Uptime',
    status: 'At risk',
    priority: 'critical' as const,
    attainment: 74,
    actual: '98.2%',
    target: '99.5%',
    unit: '%',
    trend: 'down' as const,
  };
  it('maps the person’s KPIs into the KPI tab rows', () => {
    const ctx = buildPersonContext(person, [], [], [], [], [], [kpi], NOW);
    expect(ctx.kpis).toEqual([
      { id: 'kpi_1', name: 'NDD Uptime', status: 'At risk', priority: 'critical', attainment: 74, actual: '98.2%', target: '99.5%', unit: '%', trend: 'down' },
    ]);
  });
});
