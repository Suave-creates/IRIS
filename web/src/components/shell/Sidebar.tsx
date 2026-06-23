import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { SessionUser } from '@iris/shared';
import { APP_NAME, APP_TAGLINE } from '@iris/shared';
import { Avatar } from '@/components/primitives';
import { ChevronLeft, ChevronUpDown, IrisMark } from '@/components/icons';
import { NAV_ITEMS } from '@/app/nav';
import { ProfileMenu } from './ProfileMenu';
import styles from './Sidebar.module.css';

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: SessionUser;
  onSignOut: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse, user, onSignOut }: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <aside className={styles.aside} data-collapsed={collapsed} style={{ width: collapsed ? 76 : 248 }}>
      <button
        className={styles.collapseBtn}
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label="Toggle sidebar"
      >
        <ChevronLeft
          size={14}
          style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .22s ease' }}
        />
      </button>

      <div className={styles.brand}>
        <div className={styles.brandMark}>
          <IrisMark size={17} />
        </div>
        {!collapsed && (
          <div className={styles.brandText}>
            <span className={styles.brandName}>{APP_NAME}</span>
            <span className={styles.brandTag}>{APP_TAGLINE}</span>
          </div>
        )}
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map(({ key, label, path, Icon, dividerBefore }) => (
          <div key={key} style={{ display: 'contents' }}>
            {dividerBefore && <div className={styles.divider} />}
            <NavLink
              to={path}
              end={path === '/'}
              title={collapsed ? label : undefined}
              className={({ isActive }) => `${styles.navBtn} ${isActive ? styles.navActive : ''}`}
            >
              <Icon size={17} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          </div>
        ))}
      </nav>

      <div className={styles.footer}>
        {menuOpen && <ProfileMenu user={user} onClose={() => setMenuOpen(false)} onSignOut={onSignOut} />}
        <button
          className={styles.profile}
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <Avatar name={user.name} src={user.avatarUrl} size={32} />
          {!collapsed && (
            <>
              <div className={styles.profileText}>
                <div className={styles.profileName}>{user.name}</div>
                <div className={styles.profileRole}>{user.title ?? user.role}</div>
              </div>
              <ChevronUpDown size={15} className={styles.profileChev} />
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
