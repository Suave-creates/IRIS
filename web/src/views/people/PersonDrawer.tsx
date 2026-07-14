import { useEffect, useState } from 'react';
import type { Kpi, Person, PersonContext, PersonInsightRow, PersonKpiRow, PersonProjectRow, Project } from '@iris/shared';
import { ArrowUpRight, Check } from '@/components/icons';
import { useDeletePerson, usePersonContext } from '@/features/people/usePeople';
import { ProjectDetailModal } from '../projects/ProjectDetailModal';
import { KpiDetailModal } from '../kpi/KpiDetailModal';
import { TREND_META as KPI_TREND_META, attainmentColor } from '../kpi/helpers';
import {
  CATEGORY_COLORS,
  INTERACTION_COLORS,
  PROJECT_PRIORITY_COLORS,
  STATUS_COLORS,
  THU_PURPLE,
  TOPIC_BAR_COLORS,
  TREND,
  alpha,
  initials,
  type TrendMeta,
} from './helpers';
import styles from './PersonDrawer.module.css';

// Actions and KPI sit together; Topics is second-last (before Insights).
const TABS = [
  ['overview', 'Overview'],
  ['timeline', 'Timeline'],
  ['actions', 'Actions'],
  ['kpi', 'KPIs'],
  ['files', 'Files'],
  ['topics', 'Topics'],
  ['insights', 'Insights'],
] as const;
type TabKey = (typeof TABS)[number][0];

/** Minimal Project shell from a PersonProjectRow — the detail modal hydrates the rest from the projects cache. */
function stubProject(row: PersonProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    source: 'sheet',
    priority: row.priority,
    status: row.status,
    deadline: null,
    progress: row.progress,
    owner: '',
    auto: false,
    summary: '',
    sourceDetail: null,
    stages: [],
    currentStage: 0,
    fields: [],
    tasks: [],
    files: [],
    activity: [],
  };
}

/** Minimal KPI shell from a PersonKpiRow — the detail modal hydrates the rest from the KPI cache. */
function stubKpi(row: PersonKpiRow): Kpi {
  return {
    id: row.id,
    name: row.name,
    source: 'sheet',
    priority: row.priority,
    status: row.status,
    owner: '',
    auto: false,
    summary: '',
    sourceDetail: null,
    unit: row.unit,
    target: row.target,
    actual: row.actual,
    trend: row.trend,
    period: null,
    attainment: row.attainment,
    fields: [],
    initiatives: [],
    activity: [],
  };
}

/** Known file-kind chip tones (URL/JIRA/DOC info · GIT violet · SHEET/SHT success · PDF danger). */
const FILE_TONES: Record<string, { color: string; bg: string } | undefined> = {
  URL: { color: 'var(--info)', bg: 'var(--info-soft)' },
  JIRA: { color: 'var(--info)', bg: 'var(--info-soft)' },
  DOC: { color: 'var(--info)', bg: 'var(--info-soft)' },
  GIT: { color: THU_PURPLE, bg: alpha(THU_PURPLE, 0.1) },
  SHEET: { color: 'var(--success)', bg: 'var(--success-soft)' },
  SHT: { color: 'var(--success)', bg: 'var(--success-soft)' },
  PDF: { color: 'var(--danger)', bg: 'var(--danger-soft)' },
  SLD: { color: 'var(--warn)', bg: 'var(--warn-soft)' },
  FLD: { color: THU_PURPLE, bg: alpha(THU_PURPLE, 0.1) },
  IMG: { color: 'var(--success)', bg: 'var(--success-soft)' },
};

/** Chip tone for a file kind — kinds are open-ended, so unknowns tint neutral. */
function fileTone(kind: string): { color: string; bg: string } {
  return FILE_TONES[kind.trim().toUpperCase()] ?? { color: 'var(--text-2)', bg: 'var(--surface-3)' };
}

/** Insight card dot colour per insight kind. */
const INSIGHT_DOTS: Record<PersonInsightRow['kind'], string> = {
  theme: 'var(--accent)',
  followthrough: 'var(--success)',
  nextstep: 'var(--warn)',
  project: 'var(--info)',
};

export interface PersonDrawerProps {
  /** The selected person (live from the roster cache); null = closed. */
  person: Person | null;
  onEdit: () => void;
  onClose: () => void;
}

/** Right slide-over with the person's full AI relationship context (six tabs). */
export function PersonDrawer({ person, onEdit, onClose }: PersonDrawerProps) {
  const [tab, setTab] = useState<TabKey>('overview');
  const [selDay, setSelDay] = useState<number | null>(null);
  const [openProject, setOpenProject] = useState<Project | null>(null);
  const [openKpi, setOpenKpi] = useState<Kpi | null>(null);
  const context = usePersonContext(person?.id ?? null);
  const deletePerson = useDeletePerson();

  // Reset the tab + calendar selection whenever a different person opens.
  const personId = person?.id ?? null;
  useEffect(() => {
    setTab('overview');
    setSelDay(null);
  }, [personId]);

  // Escape closes while open.
  const open = person !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!person) return null;

  const catColor = CATEGORY_COLORS[person.category];
  const statusColor = STATUS_COLORS[person.engagement.statusLabel];
  const trend = TREND[person.engagement.trend];
  const ctx = context.data;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={`${person.name} context`}>
        {/* ── Header ── */}
        <div className={styles.head}>
          <span className={styles.avatar} style={{ background: alpha(catColor, 0.12), color: catColor }}>
            {initials(person.name)}
          </span>
          <div className={styles.headMain}>
            <div className={styles.name}>{person.name}</div>
            <div className={styles.sub}>
              {[person.func, person.location, person.category, person.role, person.company, person.cadence]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <button type="button" className={styles.iconBtn} title="Edit person" aria-label="Edit person" onClick={onEdit}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.removeBtn}`}
            title="Remove person"
            aria-label="Remove person"
            onClick={() => deletePerson.mutate(person.id, { onSuccess: onClose })}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
          </button>
          <button type="button" className={`${styles.iconBtn} ${styles.closeBtn}`} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className={styles.tabs}>
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={tab === key ? `${styles.tab} ${styles.tabOn}` : styles.tab}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div className={styles.body}>
          {context.isLoading ? (
            <div aria-hidden="true">
              <div className={`iris-skeleton ${styles.skelSummary}`} />
              <div className={`iris-skeleton ${styles.skelStats}`} />
              <div className={`iris-skeleton ${styles.skelHealth}`} />
              <div className={`iris-skeleton ${styles.skelCal}`} />
            </div>
          ) : context.isError ? (
            <div className={styles.inlineError}>
              {(context.error as Error)?.message ?? 'Could not load context.'}
            </div>
          ) : ctx ? (
            <>
              {tab === 'overview' && (
                <OverviewTab
                  person={person}
                  ctx={ctx}
                  statusColor={statusColor}
                  trend={trend}
                  selDay={selDay}
                  onSelectDay={setSelDay}
                />
              )}
              {tab === 'timeline' && <TimelineTab ctx={ctx} />}
              {tab === 'topics' && <TopicsTab ctx={ctx} />}
              {tab === 'actions' && <ActionsTab ctx={ctx} onOpenProject={(p) => setOpenProject(stubProject(p))} />}
              {tab === 'kpi' && <KpiTab ctx={ctx} onOpenKpi={(kpi) => setOpenKpi(stubKpi(kpi))} />}
              {tab === 'files' && <FilesTab ctx={ctx} hasEmail={!!person.email} />}
              {tab === 'insights' && <InsightsTab ctx={ctx} />}
            </>
          ) : null}
        </div>
      </aside>

      {/* Opened on top of the drawer (modal z-index sits above the panel). */}
      <ProjectDetailModal project={openProject} onClose={() => setOpenProject(null)} />
      <KpiDetailModal kpi={openKpi} onClose={() => setOpenKpi(null)} />
    </>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

interface OverviewTabProps {
  person: Person;
  ctx: PersonContext;
  statusColor: string;
  trend: TrendMeta;
  selDay: number | null;
  onSelectDay: (day: number | null) => void;
}

function OverviewTab({ person, ctx, statusColor, trend, selDay, onSelectDay }: OverviewTabProps) {
  const eng = person.engagement;
  const detail = selDay !== null ? (ctx.calendar.find((d) => d.day === selDay)?.detail ?? null) : null;
  return (
    <>
      {ctx.boostNote && (
        <div className={styles.boostBanner}>
          <Check className={styles.boostIcon} size={13} strokeWidth={2.6} />
          <span className={styles.boostText}>{ctx.boostNote}</span>
        </div>
      )}

      <div className={styles.summaryCard}>
        <div className={styles.summaryKicker}>
          <span className={styles.kickerLabel}>IRIS · relationship summary</span>
          <span className={styles.kickerNote}>updates after every meeting</span>
        </div>
        <div className={styles.summaryBody}>{ctx.summary}</div>
      </div>

      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Score</div>
          <div className={styles.statBig} style={{ color: statusColor }}>
            {eng.score}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Meetings</div>
          <div className={styles.statBig}>
            {eng.meetingsThisMonth}
            <span className={styles.statSuffix}>{` /${ctx.monthShort}`}</span>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Last</div>
          <div className={styles.statSmall}>{eng.lastInteraction ?? '—'}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Trend</div>
          <div className={styles.statSmall} style={{ color: trend.color }}>
            {trend.arrow} {trend.word}
          </div>
        </div>
      </div>

      <div className={styles.health}>
        <div className={styles.healthHead}>
          <span>Relationship health</span>
          <span style={{ color: statusColor }}>{eng.score}/100</span>
        </div>
        <div className={styles.healthTrack}>
          <div className={styles.healthFill} style={{ width: `${ctx.healthPct}%`, background: statusColor }} />
        </div>
      </div>

      <div className={styles.calHead}>
        <span className={styles.calTitle}>{ctx.monthLabel} · interactions</span>
        <div className={styles.legend}>
          {/* Only processed meetings produce interactions today; more types come with future integrations. */}
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: INTERACTION_COLORS.Meeting }} />
            Meeting
          </span>
        </div>
      </div>
      <div className={styles.weekRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <div key={`${w}${i}`} className={styles.weekday}>
            {w}
          </div>
        ))}
      </div>
      <div className={styles.calGrid}>
        {Array.from({ length: ctx.calendarLeadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden="true" />
        ))}
        {ctx.calendar.map((d) => {
          const has = d.dots.length > 0;
          const isSel = selDay === d.day;
          return (
            <button
              key={d.day}
              type="button"
              className={[
                styles.calDay,
                has ? styles.calDayHas : '',
                d.isToday ? styles.calDayToday : '',
                isSel ? styles.calDaySel : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!has}
              onClick={() => onSelectDay(isSel ? null : d.day)}
            >
              <span
                className={[styles.calNum, has ? styles.calNumHas : '', d.isToday ? styles.calNumToday : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {d.day}
              </span>
              <span className={styles.calDots}>
                {d.dots.slice(0, 2).map((t, i) => (
                  <span key={`${t}${i}`} className={styles.calDot} style={{ background: INTERACTION_COLORS[t] }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {detail && (
        <div className={styles.dayCard}>
          <div className={styles.dayCardHead}>
            <span className={styles.dayCardTitle}>{detail.title}</span>
            <span
              className={styles.typePill}
              style={{
                color: INTERACTION_COLORS[detail.type],
                background: alpha(INTERACTION_COLORS[detail.type], 0.094),
              }}
            >
              {detail.typeLabel}
            </span>
          </div>
          <div className={styles.daySummary}>{detail.summary}</div>
          {detail.items.map((item) => (
            <div key={`${item.kind}-${item.text}`} className={styles.dayItem}>
              <span className={`${styles.itemChip} ${item.kind === 'ACTION' ? styles.itemAction : styles.itemDecision}`}>
                {item.kind}
              </span>
              {item.text}
            </div>
          ))}
          <div className={styles.dayFoot}>
            <Check size={11} strokeWidth={2.4} />
            Context engine updated from this interaction
          </div>
        </div>
      )}
    </>
  );
}

/* ── Timeline ────────────────────────────────────────────────────────────── */

function TimelineTab({ ctx }: { ctx: PersonContext }) {
  if (!ctx.timeline.length) {
    return <div className={styles.tabEmpty}>No activity yet — meetings and projects this person is on will appear here.</div>;
  }
  return (
    <>
      {ctx.timeline.map((e, i) => (
        <div key={`${e.dateLabel}-${i}`} className={styles.tlRow}>
          <span className={styles.tlDot} style={{ background: INTERACTION_COLORS[e.type] }} />
          <div className={styles.tlMain}>
            <div className={styles.tlHead}>
              <span className={styles.tlTitle}>{e.title}</span>
              <span className={styles.tlDate}>{e.dateLabel}</span>
            </div>
            <div className={styles.tlSnippet}>{e.snippet}</div>
          </div>
        </div>
      ))}
    </>
  );
}

/* ── Topics ──────────────────────────────────────────────────────────────── */

function TopicsTab({ ctx }: { ctx: PersonContext }) {
  if (!ctx.topics.length) {
    return (
      <div className={styles.tabEmpty}>No topics yet — they aggregate from this person’s meetings and projects.</div>
    );
  }
  return (
    <>
      <div className={styles.topicsIntro}>Aggregated from this person’s meetings and projects</div>
      {ctx.topics.map((t, i) => (
        <div key={t.name} className={styles.topicRow}>
          <div className={styles.topicHead}>
            <span className={styles.topicName}>{t.name}</span>
            <span className={styles.topicCount}>{t.mentions} mentions</span>
          </div>
          <div className={styles.topicTrack}>
            <div
              className={styles.topicFill}
              style={{ width: `${t.pct}%`, background: TOPIC_BAR_COLORS[i % TOPIC_BAR_COLORS.length] }}
            />
          </div>
        </div>
      ))}
    </>
  );
}

/* ── Actions ─────────────────────────────────────────────────────────────── */

function ActionsTab({ ctx, onOpenProject }: { ctx: PersonContext; onOpenProject: (p: PersonProjectRow) => void }) {
  if (!ctx.openActions.length && !ctx.doneActions.length && !ctx.projects.length) {
    return (
      <div className={styles.tabEmpty}>No action items yet — IRIS extracts them from meetings this person owns.</div>
    );
  }
  return (
    <>
      {ctx.projects.length > 0 && (
        <>
          <div className={styles.sectionKicker}>Stakeholder on</div>
          {ctx.projects.map((p) => (
            <ProjectRow key={p.id} project={p} onOpen={() => onOpenProject(p)} />
          ))}
        </>
      )}
      {(ctx.openActions.length > 0 || ctx.doneActions.length > 0) && (
        <div className={ctx.projects.length > 0 ? `${styles.sectionKicker} ${styles.sectionKickerDone}` : styles.sectionKicker}>
          Open
        </div>
      )}
      {ctx.openActions.map((a, i) => (
        <div key={`${a.title}-${i}`} className={styles.actionCard}>
          <span className={styles.checkbox} />
          <div className={styles.actionMain}>
            <div className={styles.actionTitle}>{a.title}</div>
            <div className={styles.actionMeta}>{a.meta}</div>
          </div>
          {a.dueLabel && <span className={styles.duePill}>{a.dueLabel}</span>}
        </div>
      ))}
      {ctx.doneActions.length > 0 && (
        <div className={`${styles.sectionKicker} ${styles.sectionKickerDone}`}>Completed</div>
      )}
      {ctx.doneActions.map((a, i) => (
        <div key={`${a.title}-${i}`} className={`${styles.actionCard} ${styles.actionCardDone}`}>
          <span className={styles.checkboxDone}>
            <Check size={9} strokeWidth={3.4} style={{ color: '#fff' }} />
          </span>
          <div className={styles.actionMain}>
            <div className={`${styles.actionTitle} ${styles.actionTitleDone}`}>{a.title}</div>
            <div className={styles.actionMeta}>{a.meta}</div>
          </div>
        </div>
      ))}
    </>
  );
}

function ProjectRow({ project, onOpen }: { project: PersonProjectRow; onOpen: () => void }) {
  const metaParts = [project.status, `${project.progress}% complete`];
  if (project.deadlineLabel) metaParts.push(`Due ${project.deadlineLabel}`);
  return (
    <button type="button" className={`${styles.actionCard} ${styles.linkCard}`} onClick={onOpen} title="Open project">
      <span className={styles.projectDot} style={{ background: PROJECT_PRIORITY_COLORS[project.priority] }} />
      <div className={styles.actionMain}>
        <div className={styles.actionTitle}>{project.name}</div>
        <div className={styles.actionMeta}>{metaParts.join(' · ')}</div>
      </div>
      <ArrowUpRight className={styles.linkArrow} size={13} strokeWidth={2} />
    </button>
  );
}

/* ── KPIs ────────────────────────────────────────────────────────────────── */

function KpiTab({ ctx, onOpenKpi }: { ctx: PersonContext; onOpenKpi: (k: PersonKpiRow) => void }) {
  if (!ctx.kpis.length) {
    return (
      <div className={styles.tabEmpty}>
        No KPIs yet — metrics from the KPIs module whose stakeholder (by email or owner name) is this person appear here.
      </div>
    );
  }
  return (
    <>
      <div className={styles.sectionKicker}>Owns / stakeholder on</div>
      {ctx.kpis.map((kpi) => {
        const trend = KPI_TREND_META[kpi.trend];
        const metricParts = [kpi.status];
        if (kpi.actual || kpi.target) metricParts.push(`${kpi.actual ?? '—'}${kpi.unit ? ` ${kpi.unit}` : ''} / ${kpi.target ?? '—'}`);
        return (
          <button key={kpi.id} type="button" className={`${styles.actionCard} ${styles.linkCard}`} onClick={() => onOpenKpi(kpi)} title="Open KPI">
            <span className={styles.projectDot} style={{ background: PROJECT_PRIORITY_COLORS[kpi.priority] }} />
            <div className={styles.actionMain}>
              <div className={styles.actionTitle}>{kpi.name}</div>
              <div className={styles.actionMeta}>
                {metricParts.join(' · ')} · <span style={{ color: trend.color }}>{trend.arrow} {trend.label}</span>
              </div>
            </div>
            <span className={styles.kpiAttn} style={{ color: attainmentColor(kpi.attainment) }}>
              {kpi.attainment}%
            </span>
            <ArrowUpRight className={styles.linkArrow} size={13} strokeWidth={2} />
          </button>
        );
      })}
    </>
  );
}

/* ── Files ───────────────────────────────────────────────────────────────── */

function FilesTab({ ctx, hasEmail }: { ctx: PersonContext; hasEmail: boolean }) {
  if (!ctx.files.length) {
    return (
      <div className={styles.tabEmpty}>
        {hasEmail
          ? 'No files yet — documents they share with you on Google Drive and files referenced in meetings appear here.'
          : 'Add this person’s email (edit → Contact) to pull the Google Drive files they’ve shared with you.'}
      </div>
    );
  }
  return (
    <>
      {ctx.files.map((f, i) => {
        const tone = fileTone(f.kind);
        const inner = (
          <>
            <span className={styles.fileKind} style={{ background: tone.bg, color: tone.color }}>
              {f.kind}
            </span>
            <div className={styles.fileMain}>
              <div className={styles.fileName}>{f.name}</div>
              <div className={styles.fileMeta}>{f.meta}</div>
            </div>
            {f.ref && <ArrowUpRight className={styles.fileArrow} size={13} strokeWidth={2} />}
          </>
        );
        return f.ref ? (
          <a
            key={`${f.name}-${i}`}
            className={styles.fileRow}
            href={f.ref}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', color: 'inherit' }}
            title={f.ref}
          >
            {inner}
          </a>
        ) : (
          <div key={`${f.name}-${i}`} className={styles.fileRow} style={{ cursor: 'default' }}>
            {inner}
          </div>
        );
      })}
    </>
  );
}

/* ── Insights ────────────────────────────────────────────────────────────── */

function InsightsTab({ ctx }: { ctx: PersonContext }) {
  if (!ctx.insights.length) {
    return (
      <div className={styles.tabEmpty}>No insights yet — they derive from real meeting and action history.</div>
    );
  }
  return (
    <>
      {ctx.insights.map((ins) => (
        <div key={ins.kind} className={styles.insightCard}>
          <div className={styles.insightHead}>
            <span className={styles.insightDot} style={{ background: INSIGHT_DOTS[ins.kind] }} />
            <span className={styles.insightTitle}>{ins.title}</span>
          </div>
          <div className={styles.insightText}>{ins.text}</div>
        </div>
      ))}
    </>
  );
}
