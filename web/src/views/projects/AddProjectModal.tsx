import { useEffect, useState } from 'react';
import type { CreateProjectInput, Priority } from '@iris/shared';
import { Button, Field, Input, Modal } from '@/components/primitives';
import { X } from '@/components/icons';
import { useCreateProject } from '@/features/projects/useProjects';
import { PRIORITY_META } from './helpers';
import styles from './AddProjectModal.module.css';

const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'med', 'low'];

export interface AddProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddProjectModal({ open, onClose }: AddProjectModalProps) {
  const create = useCreateProject();
  const [name, setName] = useState('');
  const [priority, setPriority] = useState<Priority>('high');
  const [deadline, setDeadline] = useState('');

  const { reset } = create;
  // Reset the form each time the modal opens fresh.
  useEffect(() => {
    if (open) {
      setName('');
      setPriority('high');
      setDeadline('');
      reset();
    }
  }, [open, reset]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const input: CreateProjectInput = {
      name: trimmed,
      priority,
      deadline: deadline.trim() || null,
    };
    create.mutate(input, { onSuccess: onClose });
  };

  return (
    <Modal open={open} onClose={onClose} width={420} ariaLabel="New project">
      <div className={styles.head}>
        <h2 className={styles.title}>New project</h2>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className={styles.body}>
        <Field label="Project name" htmlFor="proj-name">
          <Input
            id="proj-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Website relaunch"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </Field>

        <div className={styles.prioField}>
          <span className={styles.label}>Priority</span>
          <div className={styles.prioRow}>
            {PRIORITY_ORDER.map((p) => {
              const active = priority === p;
              return (
                <button
                  key={p}
                  type="button"
                  className={active ? styles.prioOn : styles.prio}
                  data-tone={PRIORITY_META[p].tone}
                  aria-pressed={active}
                  onClick={() => setPriority(p)}
                >
                  {PRIORITY_META[p].label}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Deadline (optional)" htmlFor="proj-deadline">
          <Input
            id="proj-deadline"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            placeholder="e.g. Jul 15"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </Field>

        {create.isError && (
          <div className={styles.error}>{(create.error as Error)?.message ?? 'Could not create project.'}</div>
        )}
      </div>

      <div className={styles.foot}>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} loading={create.isPending} disabled={!name.trim()}>
          Create project
        </Button>
      </div>
    </Modal>
  );
}
