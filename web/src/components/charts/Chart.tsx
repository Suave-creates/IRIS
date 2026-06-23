import styles from './Chart.module.css';

export interface ChartSeries {
  name: string;
  points: { x: string; y: number }[];
}
export interface ChartProps {
  kind: 'line' | 'bar';
  title?: string | null;
  xLabel?: string | null;
  yLabel?: string | null;
  series: ChartSeries[];
}

const PALETTE = ['var(--accent)', 'var(--success)', 'var(--warn)', 'var(--info)', 'var(--danger)', 'var(--violet)'];

const W = 520;
const H = 260;
const PAD = { left: 46, right: 14, top: 12, bottom: 40 };

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

/** Self-contained, themed SVG line/bar chart (no charting dependency). */
export function Chart({ kind, title, xLabel, yLabel, series }: ChartProps) {
  const clean = (series ?? []).filter((s) => Array.isArray(s.points) && s.points.length > 0);
  if (clean.length === 0) return <div className={styles.empty}>No chart data.</div>;

  // Ordered union of x categories across all series.
  const cats: string[] = [];
  const seen = new Set<string>();
  for (const s of clean) {
    for (const p of s.points) {
      if (!seen.has(p.x)) {
        seen.add(p.x);
        cats.push(p.x);
      }
    }
  }

  const ys = clean.flatMap((s) => s.points.map((p) => p.y)).filter((y) => Number.isFinite(y));
  if (ys.length === 0) return <div className={styles.empty}>No chart data.</div>;
  // Keep zero as a boundary on BOTH sides so all-positive and all-negative data
  // share a correct, zero-anchored baseline (bars never invert).
  const yMin = Math.min(0, ...ys);
  let yMax = Math.max(0, ...ys);
  if (yMax === yMin) yMax = yMin + 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x1 = PAD.left + plotW;
  const y1 = PAD.top + plotH;

  const yPos = (v: number) => y1 - ((v - yMin) / (yMax - yMin)) * plotH;
  // Categorical x: line uses centers of evenly spaced slots; bar groups within slots.
  const slot = plotW / Math.max(cats.length, 1);
  const xCenter = (i: number) => PAD.left + slot * (i + 0.5);

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);

  const labelStep = Math.ceil(cats.length / 10);

  return (
    <div className={styles.wrap}>
      {title && <div className={styles.title}>{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={title ?? 'chart'}>
        {/* gridlines + y ticks */}
        {tickVals.map((v, i) => {
          const y = yPos(v);
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={x1} y2={y} className={styles.grid} />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" className={styles.axisText}>
                {formatNum(v)}
              </text>
            </g>
          );
        })}

        {/* x axis baseline */}
        <line x1={PAD.left} y1={y1} x2={x1} y2={y1} className={styles.axis} />

        {/* x category labels (thinned if dense) */}
        {cats.map((c, i) =>
          i % labelStep === 0 ? (
            <text key={c + i} x={xCenter(i)} y={y1 + 16} textAnchor="middle" className={styles.axisText}>
              {c.length > 10 ? `${c.slice(0, 9)}…` : c}
            </text>
          ) : null,
        )}

        {/* series */}
        {kind === 'line'
          ? clean.map((s, si) => {
              const color = PALETTE[si % PALETTE.length];
              const pts = s.points
                .map((p) => {
                  const ci = cats.indexOf(p.x);
                  return ci < 0 ? null : `${xCenter(ci)},${yPos(p.y)}`;
                })
                .filter((p): p is string => p !== null);
              return (
                <g key={s.name}>
                  <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2.2} />
                  {s.points.map((p) => {
                    const ci = cats.indexOf(p.x);
                    return ci < 0 ? null : (
                      <circle key={p.x} cx={xCenter(ci)} cy={yPos(p.y)} r={2.6} fill={color} />
                    );
                  })}
                </g>
              );
            })
          : clean.map((s, si) => {
              const color = PALETTE[si % PALETTE.length];
              const groupW = slot * 0.7;
              const barW = groupW / clean.length;
              const zeroY = yPos(Math.max(yMin, Math.min(0, yMax)));
              return (
                <g key={s.name}>
                  {s.points.map((p) => {
                    const ci = cats.indexOf(p.x);
                    if (ci < 0) return null;
                    const gx = xCenter(ci) - groupW / 2 + si * barW;
                    const yv = yPos(p.y);
                    const top = Math.min(yv, zeroY);
                    const h = Math.max(1, Math.abs(zeroY - yv));
                    return <rect key={p.x} x={gx} y={top} width={Math.max(barW - 2, 1)} height={h} fill={color} rx={2} />;
                  })}
                </g>
              );
            })}
      </svg>

      {(yLabel || xLabel) && (
        <div className={styles.axisLabels}>
          <span>{yLabel}</span>
          <span>{xLabel}</span>
        </div>
      )}

      {clean.length > 1 && (
        <div className={styles.legend}>
          {clean.map((s, si) => (
            <span key={s.name} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: PALETTE[si % PALETTE.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
