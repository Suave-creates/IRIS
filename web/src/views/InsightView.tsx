import type { InsightBlock, WhiteboardInsight } from '@iris/shared';
import { Markdown } from '@/components/Markdown';
import { Chart } from '@/components/charts/Chart';
import styles from './InsightView.module.css';

/** Renders a whiteboard insight window: a structured artifact, or legacy plain text. */
export function InsightView({ body }: { body: string | null }) {
  if (!body) return null;

  let artifact: WhiteboardInsight | null = null;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as WhiteboardInsight).blocks)) {
      artifact = parsed as WhiteboardInsight;
    }
  } catch {
    /* legacy plain-text / markdown insight */
  }

  if (!artifact) return <Markdown>{body}</Markdown>;

  return (
    <div className={styles.blocks}>
      {artifact.blocks.map((block, i) => (
        <InsightBlockView key={i} block={block} />
      ))}
    </div>
  );
}

function InsightBlockView({ block }: { block: InsightBlock }) {
  switch (block.type) {
    case 'markdown':
      return <Markdown>{block.text}</Markdown>;

    case 'kpis':
      return (
        <div className={styles.kpis}>
          {block.items.map((k, i) => (
            <div key={i} className={styles.kpiCard}>
              <div className={styles.kpiVal}>{k.value}</div>
              <div className={styles.kpiLabel}>{k.label}</div>
              {k.sub && <div className={styles.kpiSub}>{k.sub}</div>}
            </div>
          ))}
        </div>
      );

    case 'table':
      return (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'chart':
      return (
        <Chart kind={block.chart} title={block.title} xLabel={block.xLabel} yLabel={block.yLabel} series={block.series} />
      );

    default:
      return null;
  }
}
