import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { MailItem, TaskPriority } from '@iris/shared';
import { Avatar, Spinner } from '@/components/primitives';
import { Check, Plus, Search, Sparkle } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { useMailItems, useMailStats, useSyncMail } from '@/features/mail/useMail';
import styles from './Mail.module.css';

/**
 * Per-category accent. Keys mirror the demo corpus categories; any unknown
 * key falls back to a neutral tone so new categories still render cleanly.
 */
const CATEGORY_META: Record<string, { label: string; tone: string }> = {
  approvals: { label: 'Approvals', tone: 'var(--danger)' },
  tasks: { label: 'Tasks', tone: 'var(--accent)' },
  finance: { label: 'Finance', tone: 'var(--warn)' },
  deadlines: { label: 'Deadlines', tone: 'var(--danger)' },
  intros: { label: 'Intros', tone: 'var(--info)' },
  meetings: { label: 'Meetings', tone: 'var(--violet)' },
  decisions: { label: 'Decisions', tone: 'var(--success)' },
  fyi: { label: 'FYI', tone: 'var(--text-3)' },
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  high: 'var(--danger)',
  med: 'var(--warn)',
  low: 'var(--success)',
};

function catMeta(key: string) {
  return CATEGORY_META[key] ?? { label: key.charAt(0).toUpperCase() + key.slice(1), tone: 'var(--text-2)' };
}

const SCOPE_TABS = ['Recent', 'Date range'] as const;
const RECENT_OPTIONS = ['25 most recent', '50', '100', '200'] as const;
const SUGGESTED_KEYWORDS = ['invoice', 'renewal', 'deadline', 'board'] as const;

export function Mail() {
  const [scope, setScope] = useState<(typeof SCOPE_TABS)[number]>('Recent');
  const [recentN, setRecentN] = useState(0);
  const [category, setCategory] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [kwInput, setKwInput] = useState('');

  const stats = useMailStats();
  const items = useMailItems(category, keyword);
  const syncMail = useSyncMail();
  const syncErr = syncMail.error instanceof ApiError ? syncMail.error.message : null;

  const totalIndexed = stats.data?.indexed ?? 0;
  const categories = useMemo(() => stats.data?.categories ?? [], [stats.data]);

  const addKeyword = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setKeyword(v);
    setKwInput(v);
  };

  const onKwKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword(kwInput);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Mail Intelligence</h1>
        <p className={styles.lede}>
          Pull the recent inbox or any date range. IRIS reads the full corpus in batches and returns only
          what matters — approvals, pending tasks, deadlines, and decisions — each with a one-line summary.
        </p>
      </header>

      {/* Scope control row — visual only; live fetch + summarize arrives with the AI engine (M3). */}
      <section className={styles.scopeBar} aria-label="Fetch scope">
        <div className={styles.scopeGroup}>
          <span className={styles.scopeLabel}>Scope</span>
          <div className={styles.segmented} role="tablist">
            {SCOPE_TABS.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={scope === tab}
                className={scope === tab ? styles.segOn : styles.seg}
                onClick={() => setScope(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {scope === 'Recent' ? (
          <div className={styles.scopeGroup}>
            <span className={styles.scopeLabel}>Most recent messages</span>
            <div className={styles.recentOpts}>
              {RECENT_OPTIONS.map((opt, i) => (
                <button
                  key={opt}
                  className={recentN === i ? styles.recentOn : styles.recent}
                  onClick={() => setRecentN(i)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.dateRange}>
            <label className={styles.dateField}>
              <span className={styles.scopeLabel}>From</span>
              <input type="date" className={styles.dateInput} aria-label="From date" />
            </label>
            <label className={styles.dateField}>
              <span className={styles.scopeLabel}>To</span>
              <input type="date" className={styles.dateInput} aria-label="To date" />
            </label>
          </div>
        )}

        <button
          className={styles.fetchBtn}
          onClick={() => syncMail.mutate()}
          disabled={syncMail.isPending}
          title="Fetch recent Gmail and let IRIS summarize and triage it"
        >
          {syncMail.isPending ? <Spinner size={14} /> : <Sparkle size={15} />}
          {syncMail.isPending ? 'Reading inbox…' : 'Fetch & summarize'}
        </button>
      </section>

      {syncErr && <div className={styles.syncError}>{syncErr}</div>}

      {/* Stats strip */}
      <section className={styles.statsStrip}>
        <div className={styles.statItem}>
          <svg className={styles.pulseIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 12h4l3 8 4-16 3 8h4" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            <b className={styles.statNum}>{stats.isLoading ? '—' : totalIndexed}</b> messages indexed
          </span>
        </div>
        <span className={styles.statDivider} />
        <div className={styles.statItem}>
          Across <b className={styles.statNum}>{stats.isLoading ? '—' : categories.length}</b> categories
        </div>
        <span className={styles.cachePill}>
          <Check size={12} strokeWidth={2.4} />
          Indexed &amp; cached
        </span>
      </section>

      {/* Honesty note: the deferred live-fetch pipeline. */}
      <p className={styles.deferNote}>
        Live fetch &amp; batch summarization arrives with the AI engine. Below is the already-indexed mail,
        filtered by category and keyword.
      </p>

      {/* Category filter chips */}
      <div className={styles.chips}>
        <button
          className={category === 'all' ? styles.chipOn : styles.chip}
          onClick={() => setCategory('all')}
        >
          All <span className={styles.chipCount}>{totalIndexed}</span>
        </button>
        {categories.map((c) => {
          const meta = catMeta(c.key);
          const active = category === c.key;
          return (
            <button
              key={c.key}
              className={active ? styles.chipOn : styles.chip}
              style={active ? { borderColor: meta.tone, color: meta.tone } : undefined}
              onClick={() => setCategory(active ? 'all' : c.key)}
            >
              <span className={styles.chipDot} style={{ background: meta.tone }} />
              {meta.label} <span className={styles.chipCount}>{c.count}</span>
            </button>
          );
        })}
      </div>

      {/* Keyword filter */}
      <div className={styles.kwRow}>
        <div className={styles.kwBox}>
          <Search size={13} strokeWidth={2.2} className={styles.kwIcon} />
          <input
            className={styles.kwInput}
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={onKwKey}
            placeholder="Add keyword filter…"
          />
          {keyword ? (
            <button
              className={styles.kwClear}
              onClick={() => {
                setKeyword('');
                setKwInput('');
              }}
            >
              Clear
            </button>
          ) : (
            <button className={styles.kwAdd} onClick={() => addKeyword(kwInput)} disabled={!kwInput.trim()}>
              Add
            </button>
          )}
        </div>
        <span className={styles.suggLabel}>Suggested:</span>
        {SUGGESTED_KEYWORDS.map((sg) => (
          <button key={sg} className={styles.sugg} onClick={() => addKeyword(sg)}>
            <Plus size={11} strokeWidth={2.4} />
            {sg}
          </button>
        ))}
      </div>

      {/* Message list */}
      <MailList query={items} />
    </div>
  );
}

function MailList({ query }: { query: ReturnType<typeof useMailItems> }) {
  if (query.isLoading) {
    return (
      <div className={styles.center}>
        <Spinner size={22} />
      </div>
    );
  }
  if (query.isError) {
    const msg = query.error instanceof ApiError ? query.error.message : 'Could not load mail.';
    return <div className={styles.errorMsg}>{msg}</div>;
  }
  const list = query.data ?? [];
  if (list.length === 0) {
    return <div className={styles.empty}>No messages match this filter.</div>;
  }
  return (
    <div className={`${styles.list} ${query.isFetching ? styles.listFetching : ''}`}>
      {list.map((m) => (
        <MailRow key={m.id} item={m} />
      ))}
    </div>
  );
}

function MailRow({ item }: { item: MailItem }) {
  const meta = catMeta(item.category);
  return (
    <article className={styles.row}>
      <Avatar name={item.fromName} size={38} />
      <div className={styles.body}>
        <div className={styles.rowTop}>
          <span className={styles.from}>{item.fromName}</span>
          <span
            className={styles.catPill}
            style={{ color: meta.tone, background: `color-mix(in srgb, ${meta.tone} 12%, transparent)` }}
          >
            {meta.label}
          </span>
          <time className={styles.date}>{formatDate(item.receivedAt)}</time>
        </div>
        <div className={styles.subject}>{item.subject}</div>
        {item.summary ? <div className={styles.summary}>{item.summary}</div> : null}
        {item.tags.length > 0 ? (
          <div className={styles.tags}>
            {item.tags.map((t) => (
              <span key={t} className={styles.tag}>
                #{t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <span
        className={styles.priorityDot}
        style={{ background: PRIORITY_DOT[item.priority] }}
        title={`${item.priority} priority`}
        aria-label={`${item.priority} priority`}
      />
    </article>
  );
}

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
