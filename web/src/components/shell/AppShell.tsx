import { useCallback, useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { VIEW_PATHS } from '@iris/shared';
import { DEMO_USER } from '@/app/demoUser';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import styles from './AppShell.module.css';

const COLLAPSE_KEY = 'iris.sidebar.collapsed';

/** Top-level application chrome: sidebar + header wrapping the routed view. */
export function AppShell() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [cmdOpen, setCmdOpen] = useState(false);

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // M0: sign-out returns to the welcome screen. M1 wires real session teardown.
  const onSignOut = useCallback(() => navigate(VIEW_PATHS.onboarding), [navigate]);

  return (
    <div className={styles.app}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        user={DEMO_USER}
        onSignOut={onSignOut}
      />
      <main className={styles.main}>
        <Header onOpenCommand={() => setCmdOpen(true)} />
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
