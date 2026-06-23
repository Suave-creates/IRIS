import { useEffect, useRef, useState } from 'react';
import type { BadgeTone } from '@/components/primitives';
import { Badge, Button, Card, Spinner } from '@/components/primitives';
import { Check, Refresh } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { useDashboard } from '@/features/dashboard/useDashboard';
import { ApprovalModal } from '@/features/actions/ApprovalModal';
import type {
  DashboardData,
  DashboardDeadline,
  DashboardPriority,
  DashboardRisk,
  Tone,
} from '@iris/shared';
import styles from './Dashboard.module.css';

// Domain Tone maps 1:1 onto the Badge tones we use here.
const TONE_TO_BADGE: Record<Tone, BadgeTone> = {
  danger: 'danger',
  warn: 'warn',
  neutral: 'neutral',
  accent: 'accent',
  info: 'info',
  success: 'success',
};

const RISK_DOT: Record<DashboardRisk['severity'], string> = {
  high: 'var(--danger)',
  med: 'var(--warn)',
  low: 'var(--success)',
};

const DEADLINE_TONE: Record<Tone, { bg: string; color: string }> = {
  danger: { bg: 'var(--danger-soft)', color: 'var(--danger)' },
  warn: { bg: 'var(--warn-soft)', color: 'var(--warn)' },
  success: { bg: 'var(--success-soft)', color: 'var(--success)' },
  info: { bg: 'var(--info-soft)', color: 'var(--info)' },
  accent: { bg: 'var(--accent-soft)', color: 'var(--accent)' },
  neutral: { bg: 'var(--surface-3)', color: 'var(--text-2)' },
};

export function Dashboard() {
  const { data, isLoading, error } = useDashboard();
  const [modalOpen, setModalOpen] = useState(false);

  if (isLoading || !data) {
    return (
      <div className={styles.page}>
        {error ? (
          <div className={styles.errorBox}>
            {error instanceof ApiError ? error.message : 'Could not load your dashboard.'}
          </div>
        ) : (
          <div className={styles.loading}>
            <Spinner size={24} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header data={data} />

      <div className={styles.topGrid}>
        <PrioritiesCard priorities={data.priorities} />
        <PendingApprovalsCard count={data.pendingApprovals} onReview={() => setModalOpen(true)} />
      </div>

      <div className={styles.bottomGrid}>
        <DeadlinesCard deadlines={data.deadlines} />
        <RisksCard risks={data.risks} />
        <NextMeetingCard meeting={data.nextMeeting} />
      </div>

      <ApprovalModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

function Header({ data }: { data: DashboardData }) {
  const { priorities, deadlines, approvals } = data.briefing;
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(data.lastSync);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  // M2 stub: no real backend sync yet (M4). Show a brief spinner, then settle.
  const startSync = () => {
    if (syncing) return;
    setSyncing(true);
    timer.current = setTimeout(() => {
      setSyncing(false);
      setLastSync('just now');
    }, 1200);
  };

  return (
    <div className={styles.header}>
      <div>
        <div className={styles.dateLabel}>{data.dateLabel}</div>
        <h1 className={styles.greeting}>{data.greeting}</h1>
        <p className={styles.briefing}>
          You have <b>{plural(priorities, 'priority', 'priorities')}</b>, {plural(deadlines, 'approaching deadline', 'approaching deadlines')}, and{' '}
          <b>{plural(approvals, 'action', 'actions')}</b> awaiting your approval today.
        </p>
      </div>
      <div className={styles.headerRight}>
        <Button
          onClick={startSync}
          loading={syncing}
          leftIcon={syncing ? undefined : <Refresh size={16} />}
          className={styles.syncBtn}
        >
          {syncing ? 'Syncing…' : 'Sync everything'}
        </Button>
        <span className={styles.lastSync}>Last synced {lastSync}</span>
      </div>
    </div>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function PrioritiesCard({ priorities }: { priorities: DashboardPriority[] }) {
  return (
    <Card className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>Today's priorities</h3>
        <Badge tone="accent" uppercase>
          Ranked by IRIS
        </Badge>
      </div>
      <div className={styles.priorityList}>
        {priorities.map((p, i) => (
          <div
            key={p.id}
            className={`${styles.priorityRow} ${i === priorities.length - 1 ? styles.priorityRowLast : ''}`}
          >
            <span className={styles.rank}>{String(p.rank).padStart(2, '0')}</span>
            <div className={styles.priorityBody}>
              <div className={styles.priorityTitle}>{p.title}</div>
              {p.detail && <div className={styles.priorityDetail}>{p.detail}</div>}
            </div>
            {p.tag && (
              <Badge tone={TONE_TO_BADGE[p.tagTone]} style={{ whiteSpace: 'nowrap', height: 'fit-content' }}>
                {p.tag}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PendingApprovalsCard({ count, onReview }: { count: number; onReview: () => void }) {
  return (
    <div className={styles.approvalsCard}>
      <div className={styles.approvalsHead}>
        <span className={styles.approvalsIcon}>
          <Check size={17} strokeWidth={1.8} />
        </span>
        <h3 className={styles.approvalsTitle}>Pending approvals</h3>
      </div>
      <div className={styles.approvalsCount}>{count}</div>
      <p className={styles.approvalsCopy}>
        Actions IRIS prepared from your conversations and inbox — ready for your review before anything is sent.
      </p>
      <button className={styles.reviewBtn} onClick={onReview}>
        Review &amp; approve →
      </button>
    </div>
  );
}

function DeadlinesCard({ deadlines }: { deadlines: DashboardDeadline[] }) {
  return (
    <Card className={styles.card}>
      <h3 className={styles.smallTitle}>Upcoming deadlines</h3>
      <div className={styles.deadlineList}>
        {deadlines.map((d) => {
          const t = DEADLINE_TONE[d.tone];
          return (
            <div key={d.id} className={styles.deadlineRow}>
              <div className={styles.chip} style={{ background: t.bg, color: t.color }}>
                <span className={styles.chipWeekday}>{d.weekday}</span>
                <span className={styles.chipDay}>{d.day}</span>
              </div>
              <div>
                <div className={styles.deadlineTitle}>{d.title}</div>
                <div className={styles.deadlineMeta}>{d.daysLabel}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RisksCard({ risks }: { risks: DashboardRisk[] }) {
  return (
    <Card className={styles.card}>
      <h3 className={styles.smallTitle}>Risks IRIS is watching</h3>
      <div className={styles.riskList}>
        {risks.map((r) => (
          <div key={r.id} className={styles.riskRow}>
            <span className={styles.riskDot} style={{ background: RISK_DOT[r.severity] }} />
            <div>
              <div className={styles.riskTitle}>{r.title}</div>
              {r.detail && <div className={styles.riskMeta}>{r.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NextMeetingCard({ meeting }: { meeting: DashboardData['nextMeeting'] }) {
  return (
    <Card className={styles.meetingCard}>
      <div className={styles.meetingHead}>
        <h3 className={styles.smallTitle}>Next meeting</h3>
        {meeting && <Badge tone="accent">{meeting.inLabel}</Badge>}
      </div>
      {meeting ? (
        <>
          <div className={styles.meetingTitle}>{meeting.title}</div>
          <div className={styles.meetingMeta}>
            {[meeting.timeLabel, `${meeting.attendees} attendees`, meeting.location]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {meeting.brief && (
            <div className={styles.meetingBrief}>
              <b>Brief ready.</b> {meeting.brief}
            </div>
          )}
        </>
      ) : (
        <div className={styles.meetingEmpty}>No upcoming meetings.</div>
      )}
    </Card>
  );
}
