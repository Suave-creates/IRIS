import { useMemo } from 'react';
import type { ActionProposal } from '@iris/shared';
import { Button, Modal, Spinner } from '@/components/primitives';
import { Brain } from '@/components/icons';
import { ApiError } from '@/lib/api';
import {
  useApproveAction,
  useApproveAllActions,
  usePendingActions,
  useRejectAction,
  useRejectAllActions,
} from './useActions';
import styles from './ApprovalModal.module.css';

export interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
}

/** Approval gate — review the actions IRIS prepared before anything is sent. */
export function ApprovalModal({ open, onClose }: ApprovalModalProps) {
  const { data: actions, isLoading, error } = usePendingActions(open);
  const approve = useApproveAction();
  const reject = useRejectAction();
  const approveAll = useApproveAllActions();
  const rejectAll = useRejectAllActions();

  const count = actions?.length ?? 0;
  const busy = approveAll.isPending || rejectAll.isPending;

  const headline = useMemo(() => {
    if (isLoading) return 'Reviewing prepared actions';
    if (count === 0) return 'Nothing left to approve';
    return `This conversation generated ${count} action${count === 1 ? '' : 's'}`;
  }, [isLoading, count]);

  return (
    <Modal open={open} onClose={onClose} width={560} tall ariaLabel="Review pending actions">
      <div className={styles.header}>
        <div className={styles.headRow}>
          <span className={styles.headIcon}>
            <Brain size={15} strokeWidth={2.2} />
          </span>
          <h2 className={styles.title}>{headline}</h2>
        </div>
        <p className={styles.sub}>
          Nothing leaves IRIS until you approve it. Review each action — approve or reject before anything is sent.
        </p>
      </div>

      <div className={styles.body}>
        {isLoading ? (
          <div className={styles.center}>
            <Spinner size={22} />
          </div>
        ) : error ? (
          <div className={styles.error}>{error instanceof ApiError ? error.message : 'Could not load actions.'}</div>
        ) : count === 0 ? (
          <div className={styles.empty}>All caught up. There are no actions waiting for your review.</div>
        ) : (
          actions!.map((a) => (
            <ActionRow
              key={a.id}
              action={a}
              onApprove={() => approve.mutate(a.id)}
              onReject={() => reject.mutate(a.id)}
              disabled={busy}
            />
          ))
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.footNote}>
          {count > 0 ? `${count} action${count === 1 ? '' : 's'} awaiting review` : 'Reviewed'}
        </span>
        <div className={styles.footActions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={count === 0 || busy}
            loading={rejectAll.isPending}
            onClick={() => rejectAll.mutate()}
          >
            Reject all
          </Button>
          <Button
            size="sm"
            disabled={count === 0 || busy}
            loading={approveAll.isPending}
            onClick={() => approveAll.mutate()}
          >
            {count > 0 ? `Approve all (${count})` : 'Approve all'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function initial(target: string): string {
  const ch = target.trim().charAt(0);
  return ch ? ch.toUpperCase() : '·';
}

function ActionRow({
  action,
  onApprove,
  onReject,
  disabled,
}: {
  action: ActionProposal;
  onApprove: () => void;
  onReject: () => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <div className={styles.cardIcon}>{initial(action.target)}</div>
        <div className={styles.cardBody}>
          <div className={styles.metaRow}>
            <span className={styles.kind}>{action.kind}</span>
            <span className={styles.dot}>·</span>
            <span className={styles.target}>{action.target}</span>
          </div>
          <div className={styles.cardTitle}>{action.title}</div>
          {action.detail && <div className={styles.cardDetail}>{action.detail}</div>}
        </div>
        <span className={styles.statusPill}>Pending</span>
      </div>
      <div className={styles.cardActions}>
        <Button variant="primary" size="sm" disabled={disabled} onClick={onApprove}>
          Approve
        </Button>
        <Button variant="secondary" size="sm" disabled={disabled} onClick={onReject}>
          Reject
        </Button>
      </div>
    </div>
  );
}
