import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Meeting } from '@iris/shared';
import { Spinner } from '@/components/primitives';
import { Search } from '@/components/icons';
import { useLiveMeetings, useMeetings } from '@/features/meetings/useMeetings';
import { VIEW_COPY } from './copy';
import { adhocLiveMeeting, SENTIMENT_COLORS, SUGGESTIONS, dayBlockColors, livePromptMeeting, matchScore } from './meetings/helpers';
import { Recorder } from './meetings/Recorder';
import { LiveMeetingPrompt } from './meetings/LiveMeetingPrompt';
import { MeetingDetailModal } from './meetings/MeetingDetailModal';
import styles from './Meetings.module.css';

/** Session-scoped record of live-meeting prompts the user has already dealt with. */
const DISMISS_KEY = 'iris.meetings.dismissedLive';

function readDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* private mode / bad JSON — start fresh */
  }
  return new Set();
}

export function Meetings() {
  const meetings = useMeetings();
  const liveMeetings = useLiveMeetings();
  const [query, setQuery] = useState('');
  const [openMeeting, setOpenMeeting] = useState<Meeting | null>(null);

  // Live-meeting auto-prompt: which meetings the user has dealt with, whether a
  // recording is underway, and a counter that focuses the recorder on demand.
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [recorderBusy, setRecorderBusy] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);

  // Ad-hoc meeting handed off by the IRIS Meeting Capture browser extension
  // (?adhoc=1&title=…&start=…&code=…&platform=…). It stands in for a calendar
  // meeting so an off-calendar Meet/Zoom/Teams call drives the same prompt.
  const [searchParams] = useSearchParams();
  const adhoc = useMemo(
    () =>
      adhocLiveMeeting(
        {
          adhoc: searchParams.get('adhoc'),
          title: searchParams.get('title'),
          start: searchParams.get('start'),
          code: searchParams.get('code'),
          platform: searchParams.get('platform'),
          people: searchParams.get('people'),
        },
        new Date().toISOString(),
      ),
    [searchParams],
  );

  // An ad-hoc call from the extension wins; otherwise the soonest synced live meeting.
  const primaryLive = adhoc ?? liveMeetings.data?.[0] ?? null;
  const promptMeeting = livePromptMeeting(primaryLive, dismissed, recorderBusy);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try {
        sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode — keep the in-memory set */
      }
      return next;
    });
  }, []);

  // Recording via the recorder's own Start button also retires the prompt for
  // that meeting, so it never re-pops once the meeting has been captured.
  useEffect(() => {
    if (recorderBusy && primaryLive) dismiss(primaryLive.id);
  }, [recorderBusy, primaryLive, dismiss]);

  const focusRecorder = () => {
    if (primaryLive) dismiss(primaryLive.id);
    setFocusSignal((n) => n + 1);
  };

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

      {promptMeeting && (
        <LiveMeetingPrompt
          meeting={promptMeeting}
          onRecord={focusRecorder}
          onDismiss={() => dismiss(promptMeeting.id)}
        />
      )}

      <Recorder
        onViewMeeting={setOpenMeeting}
        liveMeeting={primaryLive}
        focusSignal={focusSignal}
        hideLiveBanner={!!promptMeeting}
        onActiveChange={setRecorderBusy}
      />

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
