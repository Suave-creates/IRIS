import type { LiveMeeting } from '@iris/shared';
import { Mic, Users, X } from '@/components/icons';
import { livePromptTiming } from './helpers';
import styles from './LiveMeetingPrompt.module.css';

export interface LiveMeetingPromptProps {
  meeting: LiveMeeting;
  /** Focuses the recorder (with this meeting already pre-linked) — never auto-starts. */
  onRecord: () => void;
  onDismiss: () => void;
}

/**
 * Auto-surfaced prompt that slides into the top of the Meetings panel the moment
 * a synced calendar meeting goes live. Non-blocking: recording still starts from
 * the recorder below — this just points the user at it, meeting pre-linked.
 */
export function LiveMeetingPrompt({ meeting, onRecord, onDismiss }: LiveMeetingPromptProps) {
  const timing = livePromptTiming(meeting.startAt, Date.now());
  const attendees = meeting.attendees || meeting.attendeeNames.length;

  return (
    <section className={styles.prompt} role="status" aria-live="polite">
      <span className={styles.pulse} aria-hidden="true">
        <span className={styles.pulseRing} />
        <span className={styles.pulseDot} />
      </span>

      <div className={styles.body}>
        <div className={styles.kicker}>{timing}</div>
        <div className={styles.title}>{meeting.title}</div>
        <div className={styles.meta}>
          {meeting.location && <span className={styles.metaItem}>{meeting.location}</span>}
          {attendees > 0 && (
            <span className={styles.metaItem}>
              <Users size={13} strokeWidth={1.8} />
              {attendees} {attendees === 1 ? 'attendee' : 'attendees'}
            </span>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.recordBtn} onClick={onRecord}>
          <Mic size={15} strokeWidth={2} />
          Record this meeting
        </button>
        <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
          <X size={15} />
        </button>
      </div>
    </section>
  );
}
