import { useNavigate } from 'react-router-dom';
import type { SessionUser } from '@iris/shared';
import { VIEW_PATHS } from '@iris/shared';
import { Avatar } from '@/components/primitives';
import { LogOut, Moon, Plug, Shield, Sun, User } from '@/components/icons';
import { useTheme } from '@/providers/ThemeProvider';
import styles from './ProfileMenu.module.css';

export interface ProfileMenuProps {
  user: SessionUser;
  onClose: () => void;
  onSignOut: () => void;
}

/** Account dropdown anchored above the sidebar profile button. */
export function ProfileMenu({ user, onClose, onSignOut }: ProfileMenuProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.menu} role="menu">
        <div className={styles.header}>
          <Avatar name={user.name} src={user.avatarUrl} size={40} />
          <div className={styles.identity}>
            <div className={styles.name}>{user.name}</div>
            <div className={styles.email}>{user.email}</div>
          </div>
        </div>

        <div className={styles.section}>
          <button className={styles.item} onClick={() => go(VIEW_PATHS.settings)} role="menuitem">
            <User size={16} /> Your profile
          </button>
          <button className={styles.item} onClick={() => go(VIEW_PATHS.settings)} role="menuitem">
            <Shield size={16} /> Account &amp; security
          </button>
          <button className={styles.item} onClick={() => go(VIEW_PATHS.connectors)} role="menuitem">
            <Plug size={16} /> Connected services
          </button>
        </div>

        <div className={styles.appearance}>
          <span className={styles.apprLabel}>Appearance</span>
          <div className={styles.segmented}>
            <button
              className={`${styles.seg} ${theme !== 'dark' ? styles.segActive : ''}`}
              onClick={() => setTheme('light')}
            >
              <Sun size={12} /> Light
            </button>
            <button
              className={`${styles.seg} ${theme === 'dark' ? styles.segActive : ''}`}
              onClick={() => setTheme('dark')}
            >
              <Moon size={12} /> Dark
            </button>
          </div>
        </div>

        <div className={styles.section}>
          <button className={`${styles.item} ${styles.danger}`} onClick={onSignOut} role="menuitem">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </>
  );
}
