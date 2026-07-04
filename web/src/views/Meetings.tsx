import { useState } from 'react';
import type { Meeting } from '@iris/shared';
import { Spinner } from '@/components/primitives';
import { Search } from '@/components/icons';
import { useLiveMeetings, useMeetings } from '@/features/meetings/useMeetings';
import { VIEW_COPY } from './copy';
import { SENTIMENT_COLORS, SUGGESTIONS, dayBlockColors, matchScore } from './meetings/helpers';
import { Recorder } from './meetings/Recorder';
import { MeetingDetailModal } from './meetings/MeetingDetailModal';
import styles from './Meetings.module.css';

export function Meetings() {
  const meetings = useMeetings();
  const liveMeetings = useLiveMeetings();
  const [query, setQuery] = useState('');
  const [openMeeting, setOpenMeeting] = useState<Meeting | null>(null);

  const all = meetings.data ?? [];
  const q = query.trim();
  // Instant client-side filtering; best token overlap first, ties keep recency order.
  const filtered = q
    ? all
        .map((m) => ({ m, score: matchScore(m, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.m)
    : all;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{VIEW_COPY.meetings.title}</h1>
        <p className={styles.subtitle}>{VIEW_COPY.meetings.subtitle}</p>
      </header>

      <Recorder onViewMeeting={setOpenMeeting} liveMeeting={liveMeetings.data?.[0] ?? null} />

      {meetings.isLoading ? (
        <div className={styles.listLoading}>
          <Spinner size={24} />
        </div>
      ) : meetings.isError ? (
        <div className={styles.inlineError}>{(meetings.error as Error)?.message ?? 'Could not load meetings.'}</div>
      ) : all.length === 0 ? (
        <div className={styles.emptyState}>No meetings yet. Record one above — IRIS processes and files it here.</div>
      ) : (
        <>
          {/* ── Natural-language search + suggestion chips ── */}
          <div className={styles.searchRow}>
            <div className={styles.searchBox}>
              <Search size={15} strokeWidth={2} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search meetings in natural language — topics, people, decisions…"
                aria-label="Search meetings"
              />
            </div>
            {SUGGESTIONS.map((s) => (
              <button key={s} className={styles.suggestChip} onClick={() => setQuery(s)}>
                {s}
              </button>
            ))}
          </div>

          {/* ── List label ── */}
          <div className={styles.listHead}>
            <span className={styles.listLabel}>
              {q ? `Semantic matches · ${filtered.length}` : `Recent meetings · ${filtered.length}`}
            </span>
            <span className={styles.listNote}>Every meeting feeds the context engine · searchable across years</span>
          </div>

          {/* ── Meeting rows ── */}
          {filtered.map((m) => (
            <MeetingRow key={m.id} meeting={m} onOpen={() => setOpenMeeting(m)} />
          ))}
          {q && filtered.length === 0 && (
            <div className={styles.noResults}>
              No meetings match &quot;<span className={styles.noResultsQuery}>{q}</span>&quot; — try a topic,
              person, or project.
            </div>
          )}
        </>
      )}

      <MeetingDetailModal meeting={openMeeting} onClose={() => setOpenMeeting(null)} />
    </div>
  );
}

function MeetingRow({ meeting, onOpen }: { meeting: Meeting; onOpen: () => void }) {
  const [dBg, dC] = dayBlockColors(meeting.dowLabel);
  const openActions = meeting.actions.filter((a) => !a.done).length;
  const firstTopic = meeting.topics[0];
  const sentC = SENTIMENT_COLORS[meeting.sentiment];

  return (
    <button className={styles.row} onClick={onOpen}>
      <div className={styles.dateBlock} style={{ background: dBg, color: dC }}>
        <span className={styles.dateDow}>{meeting.dowLabel}</span>
        <span className={styles.dateNum}>{meeting.dayNum}</span>
      </div>
      <div className={styles.rowMain}>
        <div className={styles.rowTitleLine}>
          <span className={styles.rowTitle}>{meeting.title}</span>
          <span className={styles.modeChip} data-mode={meeting.isNew ? 'new' : meeting.mode}>
            {meeting.isNew ? 'NEW' : meeting.mode === 'online' ? 'Online' : 'In-room'}
          </span>
        </div>
        <div className={styles.rowSummary}>{meeting.summary}</div>
        <div className={styles.rowChips}>
          <span className={styles.chip} data-tone="neutral">
            {meeting.participants.length} people
          </span>
          <span className={styles.chip} data-tone="warn">
            {openActions} open actions
          </span>
          <span className={styles.chip} data-tone="success">
            {meeting.decisions.length} decisions
          </span>
          {firstTopic && (
            <span className={styles.chip} data-tone="accent">
              {firstTopic}
            </span>
          )}
        </div>
      </div>
      <div className={styles.rowRight}>
        <span className={styles.rowWhen}>
          {meeting.timeLabel} · {meeting.durationLabel}
        </span>
        <span className={styles.sentiment} style={{ color: sentC }}>
          <span className={styles.sentimentDot} style={{ background: sentC }} />
          {meeting.sentiment}
        </span>
      </div>
    </button>
  );
}
