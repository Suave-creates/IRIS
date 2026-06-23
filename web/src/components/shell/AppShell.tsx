import { useCallback, useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useSession, useLogout } from '@/features/auth/useSession';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import styles from './AppShell.module.css';

const COLLAPSE_KEY = 'iris.sidebar.collapsed';

/** Top-level application chrome: sidebar + header wrapping the routed view. */
export function AppShell() {
  const navigate = useNavigate();
  const { user } = useSession();
  const logout = useLogout();
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

  const onSignOut = useCallback(() => {
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
  }, [logout, navigate]);

  // AuthGuard guarantees a user before AppShell renders.
  if (!user) return null;

  return (
    <div className={styles.app}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        user={user}
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
