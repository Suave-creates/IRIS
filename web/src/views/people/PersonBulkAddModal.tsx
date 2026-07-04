import { useEffect, useMemo, useRef, useState } from 'react';
import type { Person } from '@iris/shared';
import { Button, Modal, Textarea } from '@/components/primitives';
import { ApiError } from '@/lib/api';
import { useBulkCreatePeople } from '@/features/people/usePeople';
import { parseRoster } from './bulk';
import { CATEGORY_COLORS, DAY_META, alpha } from './helpers';
import styles from './PersonBulkAddModal.module.css';

export interface PersonBulkAddModalProps {
  open: boolean;
  /** Current roster, used to flag names that already exist. */
  existing: Person[];
  onClose: () => void;
}

/**
 * Bulk roster import: paste the weekly planner's P-array entries (or the whole
 * HTML file, or a JSON array) — or pick the file — preview what parses, and
 * add everyone new in one request.
 */
export function PersonBulkAddModal({ open, existing, onClose }: PersonBulkAddModalProps) {
  const bulk = useBulkCreatePeople();
  const { reset } = bulk;
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // Bumped on every open/edit so stale async work (file reads, a mutation from
  // a previous open) can't clobber the current session's state.
  const sessionRef = useRef(0);

  useEffect(() => {
    if (open) {
      sessionRef.current += 1;
      setText('');
      reset();
    }
  }, [open, reset]);

  const parsed = useMemo(() => parseRoster(text), [text]);
  const existingNames = useMemo(() => new Set(existing.map((p) => p.name.trim().toLowerCase())), [existing]);
  const toAdd = parsed.people.filter((p) => !existingNames.has(p.name.toLowerCase()));
  const alreadyThere = parsed.people.filter((p) => existingNames.has(p.name.toLowerCase()));

  const pickFile = (file: File | null | undefined) => {
    if (!file) return;
    const session = ++sessionRef.current;
    file
      .text()
      .then((content) => {
        if (sessionRef.current === session) setText(content);
      })
      .catch(() => {
        if (sessionRef.current === session) setText(`Could not read "${file.name}" — paste its contents instead.`);
      });
  };

  const submit = () => {
    if (!toAdd.length || bulk.isPending) return;
    const session = sessionRef.current;
    bulk.mutate(toAdd, {
      onSuccess: () => {
        // Only close the session that submitted (not one reopened meanwhile).
        if (sessionRef.current === session) onClose();
      },
    });
  };

  return (
    <Modal open={open} onClose={onClose} width={560} zIndex={80} ariaLabel="Bulk add people">
      <div className={styles.wrap}>
        <div className={styles.head}>
          <span className={styles.title}>Bulk add people</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.hint}>
          Paste roster entries from the weekly planner — the <span className={styles.mono}>P</span> array, the whole
          HTML file, or a JSON array. Cadence derives from the days (1=Mon … 6=Sat); existing names are skipped.
        </div>

        <Textarea
          className={styles.paste}
          rows={9}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`{n:'Raj Pandey', c:'Direct', f:'Operations', l:'BWD', d:[1,2,3,4,5]},\n{n:'Vimal Kumar', c:'Direct', f:'WH', l:'BWD', d:[2,3,4]},`}
          aria-label="Roster entries"
        />
        <div className={styles.fileRow}>
          <button type="button" className={styles.fileBtn} onClick={() => fileRef.current?.click()}>
            Choose a file…
          </button>
          <span className={styles.fileNote}>.html / .js / .json / .txt — parsed locally, nothing is uploaded as-is</span>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,.js,.json,.txt"
            className={styles.fileInput}
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {/* ── Live preview ── */}
        {text.trim() && (
          <div className={styles.preview}>
            <div className={styles.previewHead}>
              <span className={styles.previewLabel}>
                {toAdd.length} to add
                {alreadyThere.length > 0 && ` · ${alreadyThere.length} already in roster`}
                {parsed.issues.length > 0 && ` · ${parsed.issues.length} issue${parsed.issues.length > 1 ? 's' : ''}`}
              </span>
            </div>
            {toAdd.length > 0 && (
              <div className={styles.chips}>
                {toAdd.slice(0, 60).map((p) => (
                  <span
                    key={p.name}
                    className={styles.personChip}
                    style={{
                      color: CATEGORY_COLORS[p.category],
                      background: alpha(CATEGORY_COLORS[p.category], 0.08),
                      borderColor: alpha(CATEGORY_COLORS[p.category], 0.25),
                    }}
                    title={`${p.category} · ${p.func} · ${p.location} · ${
                      p.days.map((d) => DAY_META[d - 1]?.name ?? d).join(' ') || 'no days'
                    }`}
                  >
                    {p.name}
                  </span>
                ))}
                {toAdd.length > 60 && <span className={styles.moreNote}>+{toAdd.length - 60} more</span>}
              </div>
            )}
            {alreadyThere.length > 0 && (
              <div className={styles.skippedNote}>
                Already in roster (skipped): {alreadyThere.map((p) => p.name).join(', ')}
              </div>
            )}
            {parsed.issues.length > 0 && (
              <ul className={styles.issues}>
                {parsed.issues.slice(0, 8).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
                {parsed.issues.length > 8 && <li>+{parsed.issues.length - 8} more</li>}
              </ul>
            )}
          </div>
        )}

        {bulk.isError && (
          <div className={styles.error}>
            {bulk.error instanceof ApiError ? bulk.error.message : 'Could not add people.'}
          </div>
        )}

        <div className={styles.footer}>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={bulk.isPending} disabled={toAdd.length === 0} onClick={submit}>
            {toAdd.length > 0 ? `Add ${toAdd.length} ${toAdd.length === 1 ? 'person' : 'people'}` : 'Add people'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
