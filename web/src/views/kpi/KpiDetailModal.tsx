import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Kpi, KpiField, KpiTrend, Priority } from '@iris/shared';
import { KPI_STATUSES } from '@iris/shared';
import { Check, Lock, Plus, X } from '@/components/icons';
import {
  useDeleteKpi,
  useKpiFieldMutations,
  useKpiInitiativeMutations,
  useKpis,
  useToggleKpiInitiative,
  useUpdateKpi,
} from '@/features/kpi/useKpi';
import { PRIORITY_META, TREND_META, attainmentColor, statusColor } from './helpers';
import styles from '../projects/ProjectDetailModal.module.css';
import k from './Kpi.module.css';

type Tab = 'overview' | 'initiatives' | 'activity';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'initiatives', label: 'Initiatives' },
  { key: 'activity', label: 'Activity' },
];
const PRIORITIES: Priority[] = ['critical', 'high', 'med', 'low'];
const TRENDS: KpiTrend[] = ['up', 'down', 'flat'];

export interface KpiDetailModalProps {
  kpi: Kpi | null;
  onClose: () => void;
}

export function KpiDetailModal({ kpi, onClose }: KpiDetailModalProps) {
  const { data: list } = useKpis();
  const live = list?.find((p) => p.id === kpi?.id) ?? kpi;

  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const toggle = useToggleKpiInitiative();
  const del = useDeleteKpi();

  useEffect(() => {
    setTab('overview');
    setEditing(false);
  }, [kpi?.id]);

  useEffect(() => {
    if (!kpi) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [kpi, onClose]);

  if (!kpi || !live) return null;

  const pri = PRIORITY_META[live.priority];
  const statusC = statusColor(live.status);
  const doneCount = live.initiatives.filter((t) => t.done).length;

  const remove = () => {
    if (window.confirm(`Delete “${live.name}”? This can’t be undone.`)) del.mutate(live.id, { onSuccess: onClose });
  };

  return createPortal(
    <div className={styles.overlay} onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={live.name} className={styles.window} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.tabStrip}>
          <div className={styles.browserTab}>
            <span className={styles.tabDot} />
            <span className={styles.tabName}>{live.name}</span>
            <button className={styles.tabClose} onClick={onClose} aria-label="Close">
              <X size={11} strokeWidth={2.6} />
            </button>
          </div>
          <span className={styles.tabPlus}>+</span>
        </div>

        <div className={styles.addrBar}>
          <div className={styles.urlBox}>
            <Lock size={12} strokeWidth={2.2} style={{ color: 'var(--success)' }} />
            <span className={styles.url}>iris://kpi/{live.id}</span>
          </div>
          <span className={styles.priPill} data-tone={pri.tone}>
            {pri.label}
          </span>
          <span className={styles.statusChip} style={{ color: statusC }}>
            <span className={styles.statusDot} style={{ background: statusC }} />
            {live.status}
          </span>
          <div className={styles.addrActions}>
            <button className={editing ? styles.editOn : styles.editBtn} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done' : 'Edit'}
            </button>
            <button className={styles.deleteBtn} onClick={remove} disabled={del.isPending}>
              Delete
            </button>
          </div>
        </div>

        <div className={styles.nav}>
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? styles.navTabOn : styles.navTab} onClick={() => setTab(t.key)}>
              {t.label}
              {t.key === 'initiatives' && live.initiatives.length > 0 && (
                <span className={styles.navCount}>
                  {doneCount}/{live.initiatives.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {tab === 'overview' && (editing ? <EditOverview kpi={live} /> : <Overview kpi={live} />)}
          {tab === 'initiatives' && <Initiatives kpi={live} editing={editing} toggle={toggle} />}
          {tab === 'activity' && <Activity kpi={live} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({ kpi }: { kpi: Kpi }) {
  const trend = TREND_META[kpi.trend];
  return (
    <>
      <div className={styles.summary}>{kpi.summary || 'No summary yet — click Edit to add one, or Fetch to let IRIS write it.'}</div>
      {kpi.sourceDetail && (
        <div className={styles.sourceBanner}>
          <b className={styles.sourceBannerLabel}>Data source</b>
          <span className={styles.sourceSep}>·</span>
          {kpi.sourceDetail}
        </div>
      )}

      <div className={k.metricGrid}>
        <MetricCell label="Actual" value={`${kpi.actual ?? '—'}${kpi.actual && kpi.unit ? ` ${kpi.unit}` : ''}`} />
        <MetricCell label="Target" value={kpi.target ?? '—'} />
        <MetricCell label="Trend" value={`${trend.arrow} ${trend.label}`} color={trend.color} />
        <MetricCell label="Attainment" value={`${kpi.attainment}%`} color={attainmentColor(kpi.attainment)} />
      </div>

      <div className={k.attnBlock} style={{ marginBottom: 22 }}>
        <div className={k.attnHead}>
          <span className={k.attnLabel}>Attainment vs target</span>
          <span className={k.attnPct}>{kpi.attainment}%</span>
        </div>
        <div className={k.attnTrack}>
          <div className={k.attnFill} style={{ width: `${Math.max(0, Math.min(100, kpi.attainment))}%`, background: attainmentColor(kpi.attainment) }} />
        </div>
      </div>

      <div className={styles.metaGrid}>
        <MetaCell label="Owner" value={kpi.owner || '—'} />
        <MetaCell label="Period" value={kpi.period ?? '—'} />
        <MetaCell label="Unit" value={kpi.unit ?? '—'} />
        <MetaCell label="Status" value={kpi.status} />
      </div>

      {kpi.fields.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Key details</div>
          <div className={styles.detailGrid}>
            {kpi.fields.map((f, i) => (
              <div key={`${f.label}-${i}`} className={styles.detailRow}>
                <span className={styles.detailLabel}>{f.label}</span>
                <span className={styles.detailValue}>{f.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ── Edit overview ─────────────────────────────────────────────────────────────
function EditOverview({ kpi }: { kpi: Kpi }) {
  const update = useUpdateKpi();
  const fields = useKpiFieldMutations();
  const [draft, setDraft] = useState({
    name: kpi.name,
    summary: kpi.summary,
    priority: kpi.priority,
    status: kpi.status,
    owner: kpi.owner,
    unit: kpi.unit ?? '',
    target: kpi.target ?? '',
    actual: kpi.actual ?? '',
    trend: kpi.trend,
    period: kpi.period ?? '',
    attainment: kpi.attainment,
  });
  const [newField, setNewField] = useState({ label: '', value: '' });

  const save = () =>
    update.mutate({
      id: kpi.id,
      patch: {
        name: draft.name.trim() || kpi.name,
        summary: draft.summary,
        priority: draft.priority,
        status: draft.status.trim() || kpi.status,
        owner: draft.owner.trim() || kpi.owner,
        unit: draft.unit.trim() ? draft.unit.trim() : null,
        target: draft.target.trim() ? draft.target.trim() : null,
        actual: draft.actual.trim() ? draft.actual.trim() : null,
        trend: draft.trend,
        period: draft.period.trim() ? draft.period.trim() : null,
        attainment: Math.max(0, Math.min(100, Number(draft.attainment) || 0)),
      },
    });

  return (
    <div className={styles.editForm}>
      <Labeled label="Metric name">
        <input className={styles.input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </Labeled>
      <Labeled label="Summary (IRIS-written; editable)">
        <textarea className={styles.textarea} rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
      </Labeled>
      <div className={styles.editRow}>
        <Labeled label="Priority">
          <select className={styles.input} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Status">
          <input className={styles.input} list="kpi-status-list" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} />
          <datalist id="kpi-status-list">
            {KPI_STATUSES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Labeled>
      </div>
      <div className={styles.editRow}>
        <Labeled label="Actual">
          <input className={styles.input} value={draft.actual} onChange={(e) => setDraft({ ...draft, actual: e.target.value })} placeholder="e.g. 98.2%" />
        </Labeled>
        <Labeled label="Target">
          <input className={styles.input} value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} placeholder="e.g. 99.5%" />
        </Labeled>
      </div>
      <div className={styles.editRow}>
        <Labeled label="Unit">
          <input className={styles.input} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="%, days…" />
        </Labeled>
        <Labeled label="Period">
          <input className={styles.input} value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value })} placeholder="Jun 2026" />
        </Labeled>
      </div>
      <div className={styles.editRow}>
        <Labeled label="Trend">
          <select className={styles.input} value={draft.trend} onChange={(e) => setDraft({ ...draft, trend: e.target.value as KpiTrend })}>
            {TRENDS.map((t) => (
              <option key={t} value={t}>
                {TREND_META[t].arrow} {TREND_META[t].label}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label={`Attainment (${draft.attainment}%)`}>
          <input className={styles.input} type="number" min={0} max={100} value={draft.attainment} onChange={(e) => setDraft({ ...draft, attainment: Number(e.target.value) })} />
        </Labeled>
      </div>
      <Labeled label="Owner">
        <input className={styles.input} value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} />
      </Labeled>
      <button className={styles.saveBtn} onClick={save} disabled={update.isPending}>
        {update.isPending ? 'Saving…' : 'Save changes'}
      </button>

      <div className={styles.sectionLabel}>Key details</div>
      <div className={styles.fieldEditor}>
        {kpi.fields.map((f) => (
          <FieldEditRow key={f.id} kpiId={kpi.id} field={f} mut={fields} />
        ))}
        <div className={styles.addFieldRow}>
          <input className={styles.inputSm} placeholder="Label" value={newField.label} onChange={(e) => setNewField({ ...newField, label: e.target.value })} />
          <input className={styles.inputSm} placeholder="Value" value={newField.value} onChange={(e) => setNewField({ ...newField, value: e.target.value })} />
          <button
            className={styles.addBtn}
            disabled={!newField.label.trim() || fields.add.isPending}
            onClick={() => fields.add.mutate({ kpiId: kpi.id, label: newField.label.trim(), value: newField.value.trim() }, { onSuccess: () => setNewField({ label: '', value: '' }) })}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldEditRow({ kpiId, field, mut }: { kpiId: string; field: KpiField; mut: ReturnType<typeof useKpiFieldMutations> }) {
  const [d, setD] = useState({ label: field.label, value: field.value });
  const commit = () => {
    if (d.label.trim() === field.label && d.value === field.value) return;
    if (!d.label.trim()) return;
    mut.edit.mutate({ kpiId, fieldId: field.id, label: d.label.trim(), value: d.value });
  };
  return (
    <div className={styles.fieldRow}>
      <input className={styles.inputSm} value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} onBlur={commit} />
      <input className={styles.inputSm} value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} onBlur={commit} />
      <button className={styles.taskDelete} onClick={() => mut.remove.mutate({ kpiId, fieldId: field.id })} aria-label="Delete field">
        <X size={12} strokeWidth={2.4} />
      </button>
    </div>
  );
}

// ── Initiatives ───────────────────────────────────────────────────────────────
function Initiatives({ kpi, editing, toggle }: { kpi: Kpi; editing: boolean; toggle: ReturnType<typeof useToggleKpiInitiative> }) {
  const inits = useKpiInitiativeMutations();
  const [title, setTitle] = useState('');
  return (
    <div className={styles.tasks}>
      {kpi.initiatives.length === 0 && !editing && <div className={styles.empty}>No initiatives yet.</div>}
      {kpi.initiatives.map((t) => (
        <div key={t.id} className={styles.taskRowWrap}>
          <button className={styles.taskRow} onClick={() => toggle.mutate({ kpiId: kpi.id, initiativeId: t.id })}>
            <span className={t.done ? styles.checkOn : styles.check}>{t.done && <Check size={11} strokeWidth={3} style={{ color: '#fff' }} />}</span>
            <span className={t.done ? styles.taskDone : styles.taskText}>{t.title}</span>
          </button>
          {editing && (
            <button className={styles.taskDelete} onClick={() => inits.remove.mutate({ kpiId: kpi.id, initiativeId: t.id })} aria-label="Delete initiative">
              <X size={12} strokeWidth={2.4} />
            </button>
          )}
        </div>
      ))}
      {editing && (
        <div className={styles.addTaskRow}>
          <input
            className={styles.input}
            placeholder="Add an initiative…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) inits.add.mutate({ kpiId: kpi.id, title: title.trim() }, { onSuccess: () => setTitle('') });
            }}
          />
          <button className={styles.addBtn} disabled={!title.trim() || inits.add.isPending} onClick={() => inits.add.mutate({ kpiId: kpi.id, title: title.trim() }, { onSuccess: () => setTitle('') })}>
            <Plus size={13} /> Add
          </button>
        </div>
      )}
    </div>
  );
}

function Activity({ kpi }: { kpi: Kpi }) {
  return (
    <div className={styles.activity}>
      {kpi.activity.length === 0 ? (
        <div className={styles.empty}>No activity recorded.</div>
      ) : (
        kpi.activity.map((x, i) => (
          <div key={`${x.who}-${i}`} className={styles.actRow}>
            <div className={styles.actRail}>
              <span className={styles.actDot} />
              {i < kpi.activity.length - 1 && <span className={styles.actLine} />}
            </div>
            <div className={styles.actBody}>
              <div className={styles.actText}>
                <b>{x.who}</b> {x.act}
              </div>
              <div className={styles.actTime}>{x.time}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.labeled}>
      <span className={styles.labeledText}>{label}</span>
      {children}
    </label>
  );
}
function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaCell}>
      <div className={styles.metaLabel}>{label}</div>
      <div className={styles.metaValue}>{value}</div>
    </div>
  );
}
function MetricCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className={k.metricCell}>
      <div className={k.metricCellLabel}>{label}</div>
      <div className={k.metricCellValue} style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
