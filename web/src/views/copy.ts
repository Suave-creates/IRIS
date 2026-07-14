import type { ViewKey } from '@iris/shared';

export interface ViewCopy {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Which milestone delivers this view's interactive build. */
  delivers: string;
}

/** Real product copy from the approved design, used by the M0 page headers. */
export const VIEW_COPY: Record<ViewKey, ViewCopy> = {
  onboarding: {
    eyebrow: 'Provisioned by Lenskart Tech Sangathan',
    title: 'Welcome to IRIS, Kartik.',
    subtitle:
      'Your executive intelligence layer is ready. A few quick steps and IRIS will start working in the background — learning your context, never acting without your approval.',
    delivers: 'M1 · Google SSO onboarding',
  },
  chat: {
    title: 'Ask IRIS',
    subtitle: 'Draft, schedule, summarize, or decide — IRIS assembles the right context before every reply.',
    delivers: 'M3 · Context Engine + Claude',
  },
  dashboard: {
    eyebrow: 'Your morning briefing',
    title: 'Good morning, Kartik.',
    subtitle: 'Priorities, approaching deadlines, and the actions awaiting your approval — at a glance.',
    delivers: 'M2 · live dashboard',
  },
  projects: {
    title: 'Projects',
    subtitle:
      'Pulled from your calendar, journal, conversations, and linked files — auto-prioritized by deadline.',
    delivers: 'M2 · projects + detail',
  },
  kpi: {
    title: 'KPIs',
    subtitle: 'Your business metrics — actual against target, with trend and attainment, from linked dashboards or added by hand.',
    delivers: 'M2 · KPI cards + detail',
  },
  planner: {
    title: 'Planner',
    subtitle: 'Block out the macro shape of your day, week, or month — the big rocks, not every to-do.',
    delivers: 'M2 · weekly planner',
  },
  mail: {
    title: 'Mail Intelligence',
    subtitle:
      'Pull the recent inbox or any date range. IRIS reads the full corpus in batches and returns only what matters.',
    delivers: 'M3 · summarized inbox',
  },
  calendar: {
    title: 'Calendar',
    subtitle: 'Your week, synced from Google Calendar — create and edit events inline.',
    delivers: 'M2 · week grid + events',
  },
  journal: {
    title: 'Journal',
    subtitle: 'Plan your days — add tasks to any date, click a task to open its details.',
    delivers: 'M2 · month grid + tasks',
  },
  people: {
    title: 'People & Context',
    subtitle:
      'Engagement cadence and living context — click a person for their full context, tap a day cell to change their plan, or add and remove people anytime.',
    delivers: 'M4b · people & context',
  },
  meetings: {
    title: 'Meeting Intelligence',
    subtitle:
      'Record any meeting — online or in-room. IRIS transcribes, extracts actions & decisions, and updates everyone’s context automatically.',
    delivers: 'M4b · meeting intelligence',
  },
  whiteboard: {
    title: 'Smart Whiteboard',
    subtitle: "Arrange files on a canvas and ask Claude to work across all of them at once.",
    delivers: 'M3 · canvas + cross-file AI',
  },
  knowledge: {
    title: 'Lens',
    subtitle:
      'Type any keyword — a person, account, project, or topic — and IRIS gathers everything related from your connected tools.',
    delivers: 'M3 · multi-source gather',
  },
  connectors: {
    title: 'Connectors',
    subtitle:
      'IRIS reads and acts across your tools. Every connector is scoped, revocable, and continuously monitored for health.',
    delivers: 'M4 · connector framework',
  },
  memory: {
    title: 'Memory & Context Engine',
    subtitle:
      'Everything IRIS learns is structured, attributed to a source, and fully under your control — inspect, edit, or forget any memory.',
    delivers: 'M3 · memory engine',
  },
  admin: {
    title: 'Admin',
    subtitle: 'Provision users, monitor system health, and audit every action across the platform.',
    delivers: 'M2 · admin + M5 · monitoring',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Memory, approvals, appearance, and security — tuned to how you work.',
    delivers: 'M1 · settings',
  },
  architecture: {
    eyebrow: 'Appendix · for engineering',
    title: 'System Architecture',
    subtitle:
      'A reference overview of how IRIS is structured — multi-tenant, event-driven, and approval-gated.',
    delivers: 'reference',
  },
};
