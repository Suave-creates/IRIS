import { useEffect, useState } from 'react';
import type { CreateKpiInput, Priority } from '@iris/shared';
import { Button, Field, Input, Modal } from '@/components/primitives';
import { X } from '@/components/icons';
import { useCreateKpi } from '@/features/kpi/useKpi';
import { PRIORITY_META } from './helpers';
import styles from '../projects/AddProjectModal.module.css';

const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'med', 'low'];

export interface AddKpiModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddKpiModal({ open, onClose }: AddKpiModalProps) {
  const create = useCreateKpi();
  const [name, setName] = useState('');
  const [priority, setPriority] = useState<Priority>('high');
  const [unit, setUnit] = useState('');
  const [target, setTarget] = useState('');
  const [period, setPeriod] = useState('');

  const { reset } = create;
  useEffect(() => {
    if (open) {
      setName('');
      setPriority('high');
      setUnit('');
      setTarget('');
      setPeriod('');
      reset();
    }
  }, [open, reset]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const input: CreateKpiInput = {
      name: trimmed,
      priority,
      unit: unit.trim() || null,
      target: target.trim() || null,
      period: period.trim() || null,
    };
    create.mutate(input, { onSuccess: onClose });
  };

  return (
    <Modal open={open} onClose={onClose} width={440} ariaLabel="New KPI">
      <div className={styles.head}>
        <h2 className={styles.title}>New KPI</h2>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className={styles.body}>
        <Field label="Metric name" htmlFor="kpi-name">
          <Input
            id="kpi-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. NDD network uptime"
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
                <button key={p} type="button" className={active ? styles.prioOn : styles.prio} data-tone={PRIORITY_META[p].tone} aria-pressed={active} onClick={() => setPriority(p)}>
                  {PRIORITY_META[p].label}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Target (optional)" htmlFor="kpi-target">
          <Input id="kpi-target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 99.5%  ·  ≤ 2 days" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Unit (optional)" htmlFor="kpi-unit">
            <Input id="kpi-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, days, M…" onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </Field>
          <Field label="Period (optional)" htmlFor="kpi-period">
            <Input id="kpi-period" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Jun 2026, Q3 FY26" onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </Field>
        </div>

        {create.isError && <div className={styles.error}>{(create.error as Error)?.message ?? 'Could not create KPI.'}</div>}
      </div>

      <div className={styles.foot}>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} loading={create.isPending} disabled={!name.trim()}>
          Create KPI
        </Button>
      </div>
    </Modal>
  );
}
