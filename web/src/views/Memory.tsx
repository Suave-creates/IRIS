import { useMemo } from 'react';
import type { KnowledgeGraph, Memory as MemoryDTO, MemoryType } from '@iris/shared';
import { Badge, Card, Spinner } from '@/components/primitives';
import type { BadgeTone } from '@/components/primitives';
import { ApiError } from '@/lib/api';
import { useForgetMemory, useMemoryOverview } from '@/features/memory/useMemory';
import styles from './Memory.module.css';

const TYPE_TONE: Record<MemoryType, BadgeTone> = {
  preference: 'accent',
  fact: 'success',
  contact: 'info',
  project: 'warn',
  correction: 'violet',
};

const TYPE_LABEL: Record<MemoryType, string> = {
  preference: 'Preference',
  fact: 'Fact',
  contact: 'Contact',
  project: 'Project',
  correction: 'Correction',
};

const nf = new Intl.NumberFormat('en-US');

export function Memory() {
  const { data, isLoading, error } = useMemoryOverview();
  const forget = useForgetMemory();

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.center}>
          <Spinner size={24} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>
          {error instanceof ApiError ? error.message : 'Could not load memory overview.'}
        </div>
      </div>
    );
  }

  const { counts, recent, graph } = data;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Memory &amp; Context Engine</h1>
        <p className={styles.lede}>
          Everything IRIS learns is structured, attributed to a source, and fully under your control. You can
          inspect, edit, or forget any memory at any time.
        </p>
      </header>

      <div className={styles.stats}>
        <StatCard label="Short-term" value={counts.shortTerm} sub="active this session" />
        <StatCard label="Long-term" value={counts.longTerm} sub="durable facts" />
        <StatCard
          label="Knowledge nodes"
          value={counts.nodes}
          sub={`${nf.format(counts.edges)} relations`}
        />
        <StatCard label="Preferences" value={counts.preferences} sub="learned · tunable" />
      </div>

      <div className={styles.grid}>
        <Card className={styles.recentCard} padded={false}>
          <div className={styles.recentHead}>
            <h3 className={styles.cardTitle}>Recently learned</h3>
            <span className={styles.viewAll}>View all</span>
          </div>
          <div className={styles.recentList}>
            {recent.length === 0 ? (
              <div className={styles.empty}>Nothing learned yet — IRIS will surface new memories here.</div>
            ) : (
              recent.map((m, i) => (
                <MemoryRow
                  key={m.id}
                  memory={m}
                  last={i === recent.length - 1}
                  pending={forget.isPending && forget.variables === m.id}
                  onForget={() => forget.mutate(m.id)}
                />
              ))
            )}
          </div>
        </Card>

        <div className={styles.sideCol}>
          <Card className={styles.graphCard} padded={false}>
            <h3 className={styles.cardTitle}>Knowledge graph</h3>
            <KnowledgeGraphSvg graph={graph} />
            <p className={styles.graphNote}>
              Entities and relationships IRIS maintains to reason across your work.
            </p>
          </Card>

          <Card className={styles.privacyCard} padded={false}>
            <div className={styles.privacyTitle}>Privacy by design</div>
            <p className={styles.privacyBody}>
              Memories never leave your isolated workspace. Set retention windows, pause learning, or export
              everything in Settings.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <Card className={styles.statCard} padded={false}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{nf.format(value)}</div>
      <div className={styles.statSub}>{sub}</div>
    </Card>
  );
}

function MemoryRow({
  memory,
  last,
  pending,
  onForget,
}: {
  memory: MemoryDTO;
  last: boolean;
  pending: boolean;
  onForget: () => void;
}) {
  const source = sourceLine(memory);
  return (
    <div className={`${styles.row} ${last ? styles.rowLast : ''} ${pending ? styles.rowPending : ''}`}>
      <Badge tone={TYPE_TONE[memory.type]} uppercase style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap' }}>
        {TYPE_LABEL[memory.type]}
      </Badge>
      <div className={styles.rowBody}>
        <div className={styles.rowContent}>{memory.content}</div>
        {source && <div className={styles.rowSource}>{source}</div>}
      </div>
      <button className={styles.forget} onClick={onForget} disabled={pending} aria-label="Forget this memory">
        {pending ? 'Forgetting…' : 'Forget'}
      </button>
    </div>
  );
}

function sourceLine(m: MemoryDTO): string | null {
  const parts: string[] = [];
  if (m.source) parts.push(`From: ${m.source}`);
  if (m.confidence != null) parts.push(`confidence ${Math.round(m.confidence * 100)}%`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Radial layout of the knowledge graph: the first node anchors the centre and the
 * remaining nodes fan out as evenly-spaced spokes. Edges are drawn beneath the nodes;
 * spokes that touch the centre read brighter than peripheral links.
 */
function KnowledgeGraphSvg({ graph }: { graph: KnowledgeGraph }) {
  const W = 280;
  const H = 170;
  const cx = W / 2;
  const cy = H / 2;
  const ringR = 58;

  const layout = useMemo(() => {
    const nodes = graph.nodes.slice(0, 7);
    const center = nodes[0];
    if (!center) return null;
    const spokes = nodes.slice(1);
    const pos = new Map<string, { x: number; y: number }>();
    pos.set(center.id, { x: cx, y: cy });
    const n = spokes.length;
    spokes.forEach((node, i) => {
      // Start at the top and spread clockwise; nudge radius so labels don't clip.
      const angle = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
      const rx = ringR + (Math.abs(Math.cos(angle)) > 0.7 ? 12 : 0);
      pos.set(node.id, { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ringR });
    });
    const centerSet = new Set([center.id]);
    return { center, spokes, pos, centerSet };
  }, [graph, cx, cy]);

  if (!layout) {
    return <div className={styles.graphEmpty}>No graph yet.</div>;
  }

  const { center, spokes, pos, centerSet } = layout;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.graphSvg} role="img" aria-label="Knowledge graph">
      {graph.edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const primary = centerSet.has(e.from) || centerSet.has(e.to);
        return (
          <line
            key={`e${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className={primary ? styles.edgePrimary : styles.edgeFaint}
          />
        );
      })}

      {spokes.map((node) => {
        const p = pos.get(node.id)!;
        return (
          <g key={node.id}>
            <circle cx={p.x} cy={p.y} r={16} className={styles.nodeSpoke} />
            <text x={p.x} y={p.y + 3} className={styles.nodeSpokeLabel}>
              {truncate(node.label, 8)}
            </text>
          </g>
        );
      })}

      <circle cx={cx} cy={cy} r={22} className={styles.nodeCenter} />
      <text x={cx} y={cy + 4} className={styles.nodeCenterLabel}>
        {truncate(center.label, 9)}
      </text>
    </svg>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
