import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatContextSource } from '@iris/shared';
import { Brain, Calendar, Check, Folder, Mail, Search, Send, Sparkle } from '@/components/icons';
import { Markdown } from '@/components/Markdown';
import { ApprovalModal } from '@/features/actions/ApprovalModal';
import { useChat } from '@/features/chat/useChat';
import styles from './Chat.module.css';

const QUICK_PROMPTS = [
  'Prep me for the Acme QBR',
  'Draft the investor update',
  'What changed while I was away?',
];

const KIND_META: Record<ChatContextSource['kind'], { Icon: typeof Mail; bg: string; color: string }> = {
  memory: { Icon: Brain, bg: 'var(--accent-soft)', color: 'var(--accent)' },
  mail: { Icon: Mail, bg: 'var(--danger-soft)', color: 'var(--danger)' },
  calendar: { Icon: Calendar, bg: 'var(--info-soft)', color: 'var(--info)' },
  project: { Icon: Folder, bg: 'var(--warn-soft)', color: 'var(--warn)' },
  task: { Icon: Check, bg: 'var(--success-soft)', color: 'var(--success)' },
  action: { Icon: Sparkle, bg: 'var(--accent-soft)', color: 'var(--accent)' },
};

export function Chat() {
  const { messages, sending, sources, tokens, error, send } = useChat();
  const [draft, setDraft] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const submit = () => {
    if (!draft.trim() || sending) return;
    void send(draft);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const pct = Math.min(100, Math.round((tokens.used / tokens.window) * 100));

  return (
    <div className={styles.wrap}>
      <div className={styles.main}>
        <div className={styles.scroll} ref={scrollRef}>
          <div className={styles.thread}>
            <div className={styles.chipRow}>
              <span className={styles.chip}>
                {sources.length
                  ? `Context assembled from ${sources.length} source${sources.length === 1 ? '' : 's'} · ranked by IRIS`
                  : 'IRIS assembles only the most relevant context before each reply'}
              </span>
            </div>

            {messages.length === 0 && (
              <div className={styles.empty}>
                <div className={styles.emptyMark}>
                  <Sparkle size={22} />
                </div>
                <h2 className={styles.emptyTitle}>Ask IRIS anything</h2>
                <p className={styles.emptySub}>
                  Draft, schedule, summarize, or decide. IRIS grounds every reply in your workspace and never sends
                  anything without your approval.
                </p>
              </div>
            )}

            {messages.map((m) => {
              const user = m.role === 'user';
              const streaming = !user && sending && m.text === '';
              return (
                <div key={m.id} className={`${styles.row} ${user ? styles.rowUser : ''}`}>
                  <div className={styles.bubbleWrap}>
                    <span className={styles.name} style={{ color: user ? 'var(--text-3)' : 'var(--accent)' }}>
                      {user ? 'You' : 'IRIS'}
                    </span>
                    <div className={`${styles.bubble} ${user ? styles.bubbleUser : styles.bubbleIris}`}>
                      {streaming ? (
                        <span className={styles.dots}>
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : user ? (
                        m.text
                      ) : (
                        <Markdown>{m.text}</Markdown>
                      )}
                    </div>
                    {m.hasActions && (
                      <button className={styles.actionsBtn} onClick={() => setModalOpen(true)}>
                        <Check size={15} />
                        Actions prepared — review before sending
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {error && <div className={styles.error}>{error}</div>}
          </div>
        </div>

        <div className={styles.composerWrap}>
          <div className={styles.composerInner}>
            <div className={styles.composer}>
              <textarea
                className={styles.textarea}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                placeholder="Ask IRIS to draft, schedule, summarize, or decide…"
                rows={1}
              />
              <button className={styles.send} onClick={submit} disabled={!draft.trim() || sending} aria-label="Send">
                <Send size={17} />
              </button>
            </div>
            <div className={styles.quick}>
              <span className={styles.tryLabel}>Try:</span>
              {QUICK_PROMPTS.map((q) => (
                <button key={q} className={styles.quickBtn} disabled={sending} onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className={styles.rail}>
        <div className={styles.railHeader}>Context in use</div>
        {sources.length === 0 ? (
          <div className={styles.railEmpty}>
            <Search size={16} />
            <span>The context IRIS selects for each reply will appear here.</span>
          </div>
        ) : (
          <div className={styles.sources}>
            {sources.map((s) => {
              const meta = KIND_META[s.kind];
              return (
                <div key={s.id} className={styles.source}>
                  <span className={styles.sourceIcon} style={{ background: meta.bg, color: meta.color }}>
                    <meta.Icon size={15} />
                  </span>
                  <div className={styles.sourceBody}>
                    <div className={styles.sourceLabel}>{s.label}</div>
                    <div className={styles.sourceSub}>
                      {s.sublabel} · {s.relevance}% relevant
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className={styles.meter}>
          <div className={styles.meterRow}>
            <span>Context window</span>
            <span className={styles.meterVal}>
              {(tokens.used / 1000).toFixed(1)}k / {Math.round(tokens.window / 1000)}k
            </span>
          </div>
          <div className={styles.meterTrack}>
            <div className={styles.meterFill} style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <div className={styles.meterNote}>
            IRIS ranks and injects only the most relevant context to keep responses fast and grounded.
          </div>
        </div>
      </aside>

      <ApprovalModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
