import { Spinner } from '@/components/primitives';
import { relativeTime } from '@/lib/time';
import { useMarkAllRead, useNotifications } from '@/features/notifications/useNotifications';
import styles from './NotificationsMenu.module.css';

export function NotificationsMenu({ onClose }: { onClose: () => void }) {
  const { data: notifications, isLoading } = useNotifications();
  const markAll = useMarkAllRead();
  const unread = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.menu} role="menu">
        <div className={styles.header}>
          <span className={styles.title}>
            Notifications {unread > 0 && <span className={styles.badge}>{unread}</span>}
          </span>
          <span className={styles.markRead} onClick={() => markAll.mutate()}>
            Mark all read
          </span>
        </div>
        <div className={styles.list}>
          {isLoading && (
            <div className={styles.empty}>
              <Spinner size={18} />
            </div>
          )}
          {!isLoading && (notifications?.length ?? 0) === 0 && <div className={styles.empty}>You're all caught up.</div>}
          {notifications?.map((n) => (
            <div key={n.id} className={styles.item} style={{ opacity: n.read ? 0.7 : 1 }}>
              <span className={styles.dot} style={{ background: n.dotColor }} />
              <div className={styles.body}>
                <div className={styles.row}>
                  <span className={styles.itemTitle}>{n.title}</span>
                  <span className={styles.time}>{relativeTime(n.createdAt)}</span>
                </div>
                <div className={styles.text}>{n.body}</div>
              </div>
            </div>
          ))}
        </div>
        <div className={styles.viewAll}>View all activity</div>
      </div>
    </>
  );
}
