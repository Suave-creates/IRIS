import type { ViewKey } from '@iris/shared';
import { Card } from '@/components/primitives';
import { Sparkle } from '@/components/icons';
import { VIEW_COPY } from './copy';
import styles from './ViewPage.module.css';

/**
 * M0 view scaffold. Renders each section's real product header (from the
 * approved design) inside the working app chrome. The interactive build for
 * every view lands in its milestone (M1–M5) — see `delivers`.
 */
export function ViewPage({ view }: { view: ViewKey }) {
  const copy = VIEW_COPY[view];
  return (
    <div className={styles.page}>
      {copy.eyebrow && <div className={styles.eyebrow}>{copy.eyebrow}</div>}
      <h1 className={styles.title}>{copy.title}</h1>
      {copy.subtitle && <p className={styles.subtitle}>{copy.subtitle}</p>}

      <Card className={styles.note}>
        <span className={styles.noteIcon}>
          <Sparkle size={16} />
        </span>
        <div>
          <div className={styles.noteTitle}>This section is being built</div>
          <div className={styles.noteText}>
            The interactive experience is delivered in <b>{copy.delivers}</b>. The design system, theming, navigation,
            and command palette around it are live now.
          </div>
        </div>
      </Card>
    </div>
  );
}
