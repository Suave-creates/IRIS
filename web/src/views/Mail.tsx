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

const SCOPE_TABS = ['Recent', 'Last 7 days', 'Date range'] as const;
const RECENT_OPTIONS = ['25 most recent', '50', '100', '200'] as const;
const RECENT_LIMITS = [25, 50, 100, 200] as const;
const SUGGESTED_KEYWORDS = ['invoice', 'renewal', 'deadline', 'board'] as const;

export function Mail() {
  const [scope, setScope] = useState<(typeof SCOPE_TABS)[number]>('Recent');
  const [recentN, setRecentN] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [kwInput, setKwInput] = useState('');
  const [taggedMe, setTaggedMe] = useState(false);

  const stats = useMailStats();
  // The scope box drives the date/count window; "tagged me" and category/keyword layer on top.
  const scopeQuery =
    scope === 'Recent'
      ? { limit: RECENT_LIMITS[recentN] }
      : scope === 'Last 7 days'
        ? { days: 7 }
        : { from: from || undefined, to: to || undefined };
  const items = useMailItems({ category, q: keyword, taggedMe, ...scopeQuery });
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

      {/* Scope + filters — one coherent box over the already-indexed mail. */}
      <section className={styles.scopeBar} aria-label="Scope & filters">
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

        {scope === 'Recent' && (
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
        )}

        {scope === 'Date range' && (
          <div className={styles.dateRange}>
            <label className={styles.dateField}>
              <span className={styles.scopeLabel}>From</span>
              <input
                type="date"
                className={styles.dateInput}
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From date"
              />
            </label>
            <label className={styles.dateField}>
              <span className={styles.scopeLabel}>To</span>
              <input
                type="date"
                className={styles.dateInput}
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To date"
              />
            </label>
          </div>
        )}

        <div className={styles.scopeGroup}>
          <span className={styles.scopeLabel}>Show</span>
          <button
            className={taggedMe ? styles.filterToggleOn : styles.filterToggle}
            aria-pressed={taggedMe}
            onClick={() => setTaggedMe((v) => !v)}
            title="Only messages where you're tagged in the body"
          >
            Tagged me
          </button>
        </div>

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

      {/* Honesty note: what the box controls vs. what the Fetch button does. */}
      <p className={styles.deferNote}>
        Scope, date range, &ldquo;tagged me&rdquo;, category and keyword all filter the already-indexed mail below.
        &ldquo;Fetch &amp; summarize&rdquo; pulls fresh Gmail and re-triages it.
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
          {item.mentionsMe && (
            <span className={styles.taggedBadge} title="You're tagged in this message">
              @ Tagged
            </span>
          )}
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
