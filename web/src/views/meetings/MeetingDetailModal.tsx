import { useEffect, useState } from 'react';
import type { Meeting } from '@iris/shared';
import { Modal, Spinner } from '@/components/primitives';
import { ArrowUpRight, Check, Layers } from '@/components/icons';
import { initials } from '@/lib/color';
import { useDeleteMeeting, useMeeting, useMeetings } from '@/features/meetings/useMeetings';
import { artifactTone, dayBlockColors, speakerColor } from './helpers';
import styles from './MeetingDetailModal.module.css';

type Tab = 'summary' | 'transcript' | 'actions' | 'context';
const TABS: { key: Tab; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'actions', label: 'Actions & decisions' },
  { key: 'context', label: 'Context updates' },
];

export interface MeetingDetailModalProps {
  meeting: Meeting | null;
  onClose: () => void;
}

/** Four-tab meeting detail: Summary · Transcript · Actions & decisions · Context updates. */
export function MeetingDetailModal({ meeting, onClose }: MeetingDetailModalProps) {
  const { data: list } = useMeetings();
  // Read live from the list cache so reprocessing reflects immediately.
  const live = list?.find((m) => m.id === meeting?.id) ?? meeting;
  // The list omits transcript lines for speed; fetch the full meeting on demand.
  const full = useMeeting(meeting?.id);
  // Prefer the freshly-fetched transcript, then the meeting passed in (a just-
  // recorded meeting arrives fully hydrated), then the (empty) list entry.
  const transcript = full.data?.transcript?.length
    ? full.data.transcript
    : meeting?.transcript?.length
      ? meeting.transcript
      : (live?.transcript ?? []);

  const [tab, setTab] = useState<Tab>('summary');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteMeeting = useDeleteMeeting();
  const { reset: resetDelete } = deleteMeeting;
  useEffect(() => {
    setTab('summary');
    setConfirmingDelete(false);
    resetDelete();
  }, [meeting?.id, resetDelete]);

  if (!meeting || !live) return null;

  const removeNote = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteMeeting.mutate(live.id, { onSuccess: onClose });
  };

  const [dBg, dC] = dayBlockColors(live.dowLabel);
  const metaLine = `${live.dateLabel} · ${live.timeLabel} · ${live.durationLabel} · ${live.participants.join(
    ', ',
  )} · ${live.mode === 'online' ? 'Online' : 'In-room recording'}`;

  return (
    <Modal open onClose={onClose} width={760} tall ariaLabel={live.title}>
      {/* ── Header ── */}
      <div className={styles.head}>
        <div className={styles.dateBlock} style={{ background: dBg, color: dC }}>
          <span className={styles.dateDow}>{live.dowLabel}</span>
          <span className={styles.dateNum}>{live.dayNum}</span>
        </div>
        <div className={styles.headMain}>
          <div className={styles.title}>{live.title}</div>
          <div className={styles.metaLine}>{metaLine}</div>
        </div>
        <button
          className={styles.deleteBtn}
          data-confirming={confirmingDelete ? 'true' : undefined}
          onClick={removeNote}
          disabled={deleteMeeting.isPending}
          title={confirmingDelete ? 'Permanently deletes this note and its engagement history' : 'Delete meeting note'}
          aria-label="Delete meeting note"
        >
          {confirmingDelete ? 'Delete?' : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
          )}
        </button>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className={styles.tabRow}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={styles.tab}
            data-active={tab === t.key ? 'true' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {tab === 'summary' && (
          <>
            <div className={styles.kicker} data-tone="accent">
              IRIS summary
            </div>
            <p className={styles.summary}>{live.summary}</p>
            <div className={styles.topicChips}>
              {live.topics.map((t) => (
                <span key={t} className={styles.topicChip}>
                  {t}
                </span>
              ))}
            </div>
            {live.artifacts.length > 0 && (
              <>
                <div className={styles.kicker}>Linked artifacts</div>
                <div className={styles.artifactList}>
                  {live.artifacts.map((a, i) => {
                    const tone = artifactTone(a.kind);
                    return (
                      <div key={`${a.kind}-${a.label}-${i}`} className={styles.artifactRow}>
                        <span className={styles.artifactKind} style={{ background: tone.bg, color: tone.color }}>
                          {a.kind.toUpperCase()}
                        </span>
                        <span className={styles.artifactLabel}>{a.label}</span>
                        {a.ref && (
                          <a
                            className={styles.artifactLink}
                            href={a.ref}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${a.label}`}
                            title={a.ref}
                          >
                            <ArrowUpRight size={13} strokeWidth={2} />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {live.carryovers.length > 0 && (
              <div className={styles.carryCard}>
                <div className={styles.carryHead}>Carried over</div>
                {live.carryovers.map((c) => (
                  <div key={c} className={styles.carryRow}>
                    · {c}
                  </div>
                ))}
              </div>
            )}
            <div className={styles.twoCards}>
              <div className={styles.sideCard}>
                <div className={styles.sideHeading} data-tone="danger">
                  Risks flagged
                </div>
                {live.risks.map((r) => (
                  <div key={r} className={styles.sideRow}>
                    · {r}
                  </div>
                ))}
              </div>
              <div className={styles.sideCard}>
                <div className={styles.sideHeading} data-tone="info">
                  Suggested follow-ups
                </div>
                {live.followups.map((f) => (
                  <div key={f} className={styles.sideRow}>
                    · {f}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'transcript' && (
          <>
            <div className={styles.transcriptIntro}>
              Speakers attributed by IRIS from context · timestamped · {live.durationLabel}
              {live.sttEngine === 'whisper-large-v3' ? ' · Whisper large-v3' : ''}
            </div>
            {transcript.map((l, i) => (
              <div key={`${l.tsLabel}-${i}`} className={styles.tLine}>
                <span className={styles.tTs}>{l.tsLabel}</span>
                <span className={styles.tSpeaker} style={{ color: speakerColor(l.speaker) }}>
                  {l.speaker}
                </span>
                <span className={styles.tText}>{l.text}</span>
              </div>
            ))}
            {transcript.length === 0 &&
              (full.isLoading ? (
                <div className={styles.transcriptLoading}>
                  <Spinner size={18} />
                </div>
              ) : (
                <div className={styles.transcriptLoading}>No transcript captured for this meeting.</div>
              ))}
          </>
        )}

        {tab === 'actions' && (
          <>
            <div className={styles.kicker}>Action items</div>
            {live.actions.map((a) => (
              <div key={a.id} className={styles.actionCard} data-done={a.done ? 'true' : undefined}>
                <span className={styles.actionBox} data-done={a.done ? 'true' : undefined}>
                  {a.done && <Check size={9} strokeWidth={3.4} style={{ color: '#fff' }} />}
                </span>
                <div className={styles.actionMain}>
                  <div className={styles.actionTitle} data-done={a.done ? 'true' : undefined}>
                    {a.title}
                  </div>
                  <div className={styles.actionMeta}>{a.ownerMeta} · extracted by IRIS</div>
                </div>
                {!a.done && a.dueLabel && <span className={styles.duePill}>{a.dueLabel}</span>}
              </div>
            ))}
            <div className={styles.kicker} data-gap="true">
              Decisions
            </div>
            {live.decisions.map((d) => (
              <div key={d.id} className={styles.decisionRow}>
                <span className={styles.decidedChip}>DECIDED</span>
                <span className={styles.decisionText}>{d.title}</span>
              </div>
            ))}
          </>
        )}

        {tab === 'context' && (
          <>
            <div className={styles.ctxIntro}>
              IRIS updated the long-term context engine from this meeting — incremental updates, no manual input.
            </div>
            {live.ctxUpdates.map((c) => (
              <div key={c.who} className={styles.ctxCard}>
                <span className={styles.ctxAvatar}>{initials(c.who)}</span>
                <div className={styles.ctxMain}>
                  <div className={styles.ctxHead}>
                    <span className={styles.ctxWho}>{c.who}</span>
                    <span className={styles.ctxDelta}>{c.delta}</span>
                  </div>
                  <div className={styles.ctxChange}>{c.change}</div>
                </div>
              </div>
            ))}
            <div className={styles.ctxFooter}>
              <Layers size={13} strokeWidth={2} style={{ color: 'var(--accent)' }} />
              <span>
                Knowledge graph re-indexed — this meeting is now linked to {live.linkNote} and searchable semantically.
              </span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
