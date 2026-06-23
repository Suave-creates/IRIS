import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VIEW_TITLES } from '@iris/shared';
import { Modal } from '@/components/primitives';
import { Search } from '@/components/icons';
import { NAV_ITEMS } from '@/app/nav';
import styles from './CommandPalette.module.css';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/** ⌘K palette — fuzzy filter + keyboard navigation across the app's views. */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = NAV_ITEMS.map((n) => ({ key: n.key, label: VIEW_TITLES[n.key], nav: n.label, path: n.path, Icon: n.Icon }));
    if (!q) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.nav.toLowerCase().includes(q) || i.key.includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus after the modal mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const choose = (path: string) => {
    navigate(path);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[active];
      if (item) choose(item.path);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={560} ariaLabel="Command palette" zIndex={70}>
      <div className={styles.palette}>
        <div className={styles.searchRow}>
          <Search size={17} style={{ color: 'var(--text-3)' }} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Ask IRIS or jump to anything…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className={styles.kbd}>ESC</kbd>
        </div>
        <div className={styles.results}>
          {results.length === 0 && <div className={styles.empty}>No matches.</div>}
          {results.map((item, i) => (
            <button
              key={item.key}
              className={`${styles.result} ${i === active ? styles.active : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item.path)}
            >
              <span className={styles.resultIcon}>
                <item.Icon size={16} />
              </span>
              <span className={styles.resultLabel}>{item.label}</span>
              <span className={styles.resultHint}>Jump</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
