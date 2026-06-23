import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { VIEW_TITLES } from '@iris/shared';
import { IconButton } from '@/components/primitives';
import { Bell, Search, ThemeHalf } from '@/components/icons';
import { useTheme } from '@/providers/ThemeProvider';
import { viewKeyFromPath } from '@/app/nav';
import { NotificationsMenu } from './NotificationsMenu';
import styles from './Header.module.css';

export interface HeaderProps {
  onOpenCommand: () => void;
}

export function Header({ onOpenCommand }: HeaderProps) {
  const { pathname } = useLocation();
  const { toggleTheme } = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);
  const title = VIEW_TITLES[viewKeyFromPath(pathname)];

  return (
    <header className={styles.header}>
      <span className={styles.title}>{title}</span>

      <div className={styles.searchWrap}>
        <button className={styles.search} onClick={onOpenCommand} aria-label="Open command palette">
          <Search size={15} style={{ color: 'var(--text-3)' }} />
          <span className={styles.searchText}>Ask IRIS or jump to anything…</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </button>
      </div>

      <IconButton label="Toggle theme" onClick={toggleTheme}>
        <ThemeHalf size={16} />
      </IconButton>

      <div className={styles.notifWrap}>
        <IconButton label="Notifications" onClick={() => setNotifOpen((o) => !o)}>
          <Bell size={16} />
          <span className={styles.notifDot} />
        </IconButton>
        {notifOpen && <NotificationsMenu onClose={() => setNotifOpen(false)} />}
      </div>
    </header>
  );
}
