import { useEffect, useMemo, useState } from 'react';
import type { Person } from '@iris/shared';
import { Button, Modal } from '@/components/primitives';
import { ApiError } from '@/lib/api';
import { useBulkRemovePeople } from '@/features/people/usePeople';
import { CATEGORY_COLORS, CATEGORY_ORDER } from './helpers';
import styles from './PersonBulkRemoveModal.module.css';

export interface PersonBulkRemoveModalProps {
  open: boolean;
  people: Person[];
  onClose: () => void;
}

/**
 * Bulk remove: pick any subset of the roster (or select all) and delete them
 * in one request, behind an explicit confirmation step. Engagement events
 * cascade with each person.
 */
export function PersonBulkRemoveModal({ open, people, onClose }: PersonBulkRemoveModalProps) {
  const bulk = useBulkRemovePeople();
  const { reset } = bulk;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked(new Set());
      setConfirming(false);
      reset();
    }
  }, [open, reset]);

  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({ cat, members: people.filter((p) => p.category === cat) })).filter(
        (g) => g.members.length > 0,
      ),
    [people],
  );

  const toggle = (personId: string) => {
    setConfirming(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };
  const selectAll = () => {
    setConfirming(false);
    setPicked(new Set(people.map((p) => p.id)));
  };
  const selectNone = () => {
    setConfirming(false);
    setPicked(new Set());
  };

  const submit = () => {
    if (!picked.size || bulk.isPending) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    bulk.mutate([...picked], { onSuccess: onClose });
  };

  return (
    <Modal open={open} onClose={onClose} width={520} zIndex={80} ariaLabel="Bulk remove people">
      <div className={styles.wrap}>
        <div className={styles.head}>
          <span className={styles.title}>Bulk remove people</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.toolbar}>
          <span className={styles.count}>
            {picked.size} of {people.length} selected
          </span>
          <button type="button" className={styles.toolBtn} onClick={selectAll}>
            Select all
          </button>
          <button type="button" className={styles.toolBtn} onClick={selectNone} disabled={picked.size === 0}>
            Clear
          </button>
        </div>

        <div className={styles.list}>
          {groups.map((group) => (
            <div key={group.cat}>
              <div className={styles.groupLabel}>
                <span className={styles.groupSwatch} style={{ background: CATEGORY_COLORS[group.cat] }} />
                {group.cat}
              </div>
              {group.members.map((p) => (
                <label key={p.id} className={styles.row}>
                  <input
                    type="checkbox"
                    className={styles.check}
                    checked={picked.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.meta}>
                    {p.func} · {p.location} · {p.cadence}
                  </span>
                </label>
              ))}
            </div>
          ))}
          {people.length === 0 && <div className={styles.empty}>The roster is empty.</div>}
        </div>

        {confirming && picked.size > 0 && (
          <div className={styles.confirmNote}>
            This permanently removes {picked.size} {picked.size === 1 ? 'person' : 'people'} and their engagement
            history. This cannot be undone.
          </div>
        )}
        {bulk.isError && (
          <div className={styles.error}>
            {bulk.error instanceof ApiError ? bulk.error.message : 'Could not remove people.'}
          </div>
        )}

        <div className={styles.footer}>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={bulk.isPending} disabled={picked.size === 0} onClick={submit}>
            {confirming && picked.size > 0
              ? `Yes, remove ${picked.size}`
              : picked.size > 0
                ? `Remove ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`
                : 'Remove'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
