import { useState, type KeyboardEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { LensGather } from '@iris/shared';
import { Card, Spinner } from '@/components/primitives';
import { ArrowUpRight, Search, Sparkle } from '@/components/icons';
import { Markdown } from '@/components/Markdown';
import { ApiError } from '@/lib/api';
import { lensApi } from '@/features/lens/api';
import styles from './Lens.module.css';

export function Lens() {
  const [input, setInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [result, setResult] = useState<LensGather | null>(null);

  const gather = useMutation({
    mutationFn: (kw: string) => lensApi.gather(kw),
    onSuccess: (data) => {
      setResult(data);
      setKeywords((k) => (k.includes(data.keyword) ? k : [data.keyword, ...k].slice(0, 6)));
    },
  });

  const run = (kw: string) => {
    const k = kw.trim();
    if (!k || gather.isPending) return;
    setInput('');
    gather.mutate(k);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') run(input);
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Lens</h1>
        <p className={styles.sub}>
          Type any keyword — a person, account, project, or topic — and IRIS gathers everything related from across your
          workspace and synthesizes it.
        </p>
      </div>

      <div className={styles.searchBar}>
        <Search size={17} style={{ color: 'var(--text-3)' }} />
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search a person, account, project, topic…"
        />
        <button className={styles.gatherBtn} onClick={() => run(input)} disabled={!input.trim() || gather.isPending}>
          <Sparkle size={14} /> Gather
        </button>
      </div>

      {keywords.length > 0 && (
        <div className={styles.recent}>
          <span className={styles.recentLabel}>Recent:</span>
          {keywords.map((k) => (
            <button
              key={k}
              className={`${styles.chip} ${result?.keyword === k ? styles.chipActive : ''}`}
              onClick={() => run(k)}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {gather.isPending && (
        <div className={styles.loadingBanner}>
          <Spinner size={17} />
          <span>Gathering across Mail, Projects, Calendar, and Memory…</span>
        </div>
      )}

      {gather.error instanceof ApiError && <div className={styles.error}>{gather.error.message}</div>}

      {result && !gather.isPending && (
        <>
          <div className={styles.resultHead}>
            <h2 className={styles.resultTitle}>
              Everything about <span className={styles.kw}>“{result.keyword}”</span>
            </h2>
            <span className={styles.sourcesLine}>
              {result.results.length} item{result.results.length === 1 ? '' : 's'} · {result.sources.join(', ') || 'no sources'}
            </span>
          </div>

          {result.summary && (
            <Card className={styles.summary}>
              <div className={styles.summaryHead}>
                <Sparkle size={15} /> IRIS synthesis
              </div>
              <Markdown className={styles.summaryBody}>{result.summary}</Markdown>
            </Card>
          )}

          {result.results.length === 0 ? (
            <div className={styles.empty}>Nothing related found across your connected workspace yet.</div>
          ) : (
            <div className={styles.grid}>
              {result.results.map((r, i) => (
                <Card key={i} className={styles.resultCard} interactive>
                  <div className={styles.cardTop}>
                    <span className={styles.cardIcon}>{r.icon}</span>
                    <span className={styles.cardSource}>{r.source}</span>
                    <ArrowUpRight size={14} style={{ marginLeft: 'auto', color: 'var(--text-3)' }} />
                  </div>
                  <div className={styles.cardTitle}>{r.title}</div>
                  <div className={styles.cardSnippet}>{r.snippet}</div>
                  <div className={styles.cardMeta}>{r.meta}</div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
