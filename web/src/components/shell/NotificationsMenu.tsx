import styles from './NotificationsMenu.module.css';

interface NotificationItem {
  id: number;
  title: string;
  text: string;
  time: string;
  dot: string;
  unread: boolean;
}

/**
 * M0 placeholder feed mirroring the design. Replaced in M2 by a live
 * notifications query (tenant-scoped).
 */
const DEMO_NOTIFICATIONS: NotificationItem[] = [
  { id: 1, title: 'David Chen replied', text: 'Re: Acme renewal — open to a 2-year deal with onboarding.', time: '2m', dot: 'var(--danger)', unread: true },
  { id: 2, title: 'Priya is waiting on you', text: 'Q3 hiring plan needs your approval to proceed.', time: '1h', dot: 'var(--warn)', unread: true },
  { id: 3, title: 'IRIS prepared 5 actions', text: 'From your latest conversation — review & approve.', time: '2h', dot: 'var(--accent)', unread: true },
  { id: 4, title: 'Board deck due Thursday', text: '2 sections remaining before the board meeting.', time: '5h', dot: 'var(--info)', unread: false },
  { id: 5, title: 'Warm intro from Maya', text: 'Connected you with a Sequoia partner for the raise.', time: '1d', dot: 'var(--success)', unread: false },
];

export function NotificationsMenu({ onClose }: { onClose: () => void }) {
  const unread = DEMO_NOTIFICATIONS.filter((n) => n.unread).length;
  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.menu} role="menu">
        <div className={styles.header}>
          <span className={styles.title}>
            Notifications <span className={styles.badge}>{unread}</span>
          </span>
          <span className={styles.markRead}>Mark all read</span>
        </div>
        <div className={styles.list}>
          {DEMO_NOTIFICATIONS.map((n) => (
            <div key={n.id} className={styles.item}>
              <span className={styles.dot} style={{ background: n.dot }} />
              <div className={styles.body}>
                <div className={styles.row}>
                  <span className={styles.itemTitle}>{n.title}</span>
                  <span className={styles.time}>{n.time}</span>
                </div>
                <div className={styles.text}>{n.text}</div>
              </div>
            </div>
          ))}
        </div>
        <div className={styles.viewAll}>View all activity</div>
      </div>
    </>
  );
}
