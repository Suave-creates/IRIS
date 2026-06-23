import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Connector, ConnectorProvider, ConnectorStatus } from '@iris/shared';
import { Button, Spinner } from '@/components/primitives';
import { Calendar, Folder, Plug, Refresh } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { startConnect } from '@/features/connectors/api';
import { useConnectors, useDisconnectConnector, useSyncConnector } from '@/features/connectors/useConnectors';
import styles from './Connectors.module.css';

export function Connectors() {
  const { data, isLoading, error } = useConnectors();
  const disconnect = useDisconnectConnector();
  const sync = useSyncConnector();
  const [params] = useSearchParams();
  const connected = params.get('connected');
  const oauthError = params.get('error');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Connectors</h1>
          <p className={styles.subtitle}>
            IRIS reads and acts across your tools. Every connector is scoped, revocable, and continuously
            monitored for health.
          </p>
        </div>
        <div className={styles.headerActions}>
          {data && data.length > 0 && <Summary connectors={data} />}
          <Button leftIcon={<Plug size={15} />} onClick={() => startConnect('gmail')}>
            Connect Google
          </Button>
        </div>
      </header>

      {connected && (
        <div className={styles.banner}>
          Google is connected. Use <b>Sync</b> on a connector (or “Sync Everything” on the dashboard) to pull your
          latest data.
        </div>
      )}
      {oauthError && (
        <div className={styles.error}>Authorization didn’t complete ({oauthError}). Please try connecting again.</div>
      )}

      {isLoading && (
        <div className={styles.center}>
          <Spinner size={24} />
        </div>
      )}

      {error && (
        <div className={styles.error}>
          {error instanceof ApiError ? error.message : 'Could not load connectors.'}
        </div>
      )}

      {data && data.length === 0 && (
        <div className={styles.empty}>No connectors yet. Connect a service to get started.</div>
      )}

      {data && data.length > 0 && (
        <div className={styles.groups}>
          {groupConnectors(data).map(([group, items]) => (
            <section key={group} className={styles.group}>
              <div className={styles.groupLabel}>{group}</div>
              <div className={styles.grid}>
                {items.map((c) => (
                  <ConnectorCard
                    key={c.id}
                    connector={c}
                    onSync={() => sync.mutate(c.provider)}
                    onDisconnect={() => disconnect.mutate(c.provider)}
                    busy={
                      (sync.isPending && sync.variables === c.provider) ||
                      (disconnect.isPending && disconnect.variables === c.provider)
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Header summary ────────────────────────────────────────────────────────────
function Summary({ connectors }: { connectors: Connector[] }) {
  const connected = connectors.filter((c) => c.status !== 'disconnected').length;
  const healthy = connectors.filter((c) => c.status === 'connected').length;
  const allHealthy = healthy === connected;

  return (
    <div className={styles.summary}>
      <div className={styles.stat}>
        <div className={styles.statValue}>{connected}</div>
        <div className={styles.statLabel}>connected</div>
      </div>
      <div className={styles.divider} />
      <div className={styles.stat}>
        <div className={`${styles.statValue} ${allHealthy ? styles.statHealthy : styles.statWarn}`}>
          {allHealthy ? 'healthy' : `${connected - healthy} need attention`}
        </div>
        <div className={styles.statLabel}>
          {healthy} of {connected}
        </div>
      </div>
    </div>
  );
}

// ── Connector card ──────────────────────────────────────────────────────────
function ConnectorCard({
  connector,
  onSync,
  onDisconnect,
  busy,
}: {
  connector: Connector;
  onSync: () => void;
  onDisconnect: () => void;
  busy: boolean;
}) {
  const tone = STATUS_TONE[connector.status];
  const visual = PROVIDER_VISUAL[connector.provider];
  const attention = tone === 'warn' || tone === 'danger';
  const isGoogle = ['gmail', 'gcalendar', 'gdrive', 'gsheets'].includes(connector.provider);
  const needsAuth = connector.status === 'expiring' || connector.status === 'error' || connector.status === 'disconnected';

  return (
    <div className={`${styles.card} ${attention ? styles[`cardEdge_${tone}`] : ''}`}>
      <div className={styles.cardHead}>
        <div className={styles.identity}>
          <span className={styles.glyph} style={{ background: `var(${visual.bg})`, color: `var(${visual.fg})` }}>
            {visual.icon ?? visual.letter}
          </span>
          <span className={styles.name}>{connector.displayName}</span>
        </div>
        <span className={`${styles.dot} ${styles[`dot_${tone}`]}`} title={STATUS_LABEL[connector.status]} />
      </div>

      <div className={`${styles.caps} ${attention ? styles[`caps_${tone}`] : ''}`}>
        {attention && connector.note ? connector.note : connector.capabilities ?? STATUS_LABEL[connector.status]}
      </div>

      <div className={styles.cardFoot}>
        <span className={styles.synced}>{busy ? 'Working…' : syncedLabel(connector.lastSyncedAt)}</span>
        <div className={styles.cardBtns}>
          {isGoogle && needsAuth && (
            <button className={`${styles.action} ${styles[`action_${tone}`] ?? ''}`} onClick={() => startConnect(connector.provider)}>
              {connector.status === 'disconnected' ? 'Connect' : 'Reconnect'}
            </button>
          )}
          {isGoogle && !needsAuth && (
            <>
              <button className={styles.action} onClick={onSync} disabled={busy} title="Sync now">
                <Refresh size={13} /> Sync
              </button>
              <button className={styles.actionMuted} onClick={onDisconnect} disabled={busy}>
                Disconnect
              </button>
            </>
          )}
          {!isGoogle && <span className={styles.soon}>Coming soon</span>}
        </div>
      </div>
    </div>
  );
}

// ── Mapping & helpers ─────────────────────────────────────────────────────────
type Tone = 'success' | 'warn' | 'danger';

const STATUS_TONE: Record<ConnectorStatus, Tone> = {
  connected: 'success',
  expiring: 'warn',
  degraded: 'warn',
  error: 'danger',
  disconnected: 'danger',
};

const STATUS_LABEL: Record<ConnectorStatus, string> = {
  connected: 'Connected',
  expiring: 'Token expiring',
  degraded: 'Degraded',
  error: 'Connection error',
  disconnected: 'Disconnected',
};

interface ProviderVisual {
  bg: string;
  fg: string;
  letter: string;
  icon?: ReactNode;
}

const PROVIDER_VISUAL: Record<ConnectorProvider, ProviderVisual> = {
  gmail: { bg: '--danger-soft', fg: '--danger', letter: 'G' },
  gcalendar: { bg: '--info-soft', fg: '--info', letter: 'C', icon: <Calendar size={17} strokeWidth={2} /> },
  gdrive: { bg: '--success-soft', fg: '--success', letter: 'D', icon: <Folder size={17} strokeWidth={2} /> },
  gsheets: { bg: '--success-soft', fg: '--success', letter: '≣' },
  slack: { bg: '--violet-soft', fg: '--violet', letter: '#' },
  notion: { bg: '--surface-3', fg: '--text', letter: 'N' },
  github: { bg: '--surface-3', fg: '--text', letter: 'GH', icon: <GitHubMark /> },
  jira: { bg: '--info-soft', fg: '--info', letter: 'J' },
};

function GitHubMark() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a4 4 0 0 1 1-2.7c-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6a4 4 0 0 1 1 2.7c0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A10 10 0 0 0 12 2z" />
    </svg>
  );
}

/** Stable grouping preserving the API's group/displayName ordering. */
function groupConnectors(connectors: Connector[]): [string, Connector[]][] {
  const map = new Map<string, Connector[]>();
  for (const c of connectors) {
    const bucket = map.get(c.groupLabel);
    if (bucket) bucket.push(c);
    else map.set(c.groupLabel, [c]);
  }
  return [...map.entries()];
}

/** Compact relative time, e.g. "Synced 2m ago". */
function syncedLabel(iso: string | null): string {
  if (!iso) return 'Never synced';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never synced';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'Synced just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `Synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `Synced ${days}d ago`;
}
