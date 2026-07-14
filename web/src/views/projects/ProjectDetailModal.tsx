import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Priority, Project, ProjectField } from '@iris/shared';
import { ArrowUpRight, Check, Database, FileText, Lock, Plus, X } from '@/components/icons';
import {
  useDeleteProject,
  useProjectFieldMutations,
  useProjects,
  useProjectTaskMutations,
  useToggleProjectTask,
  useUpdateProject,
} from '@/features/projects/useProjects';
import { PRIORITY_META, SOURCE_META, deadlineLabel, statusColor } from './helpers';
import styles from './ProjectDetailModal.module.css';

type Tab = 'overview' | 'tasks' | 'files' | 'activity';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'files', label: 'Files' },
  { key: 'activity', label: 'Activity' },
];
const PRIORITIES: Priority[] = ['critical', 'high', 'med', 'low'];

export interface ProjectDetailModalProps {
  project: Project | null;
  onClose: () => void;
}

export function ProjectDetailModal({ project, onClose }: ProjectDetailModalProps) {
  const { data: list } = useProjects();
  // Read live from the cache so edits/CRUD reflect immediately.
  const live = list?.find((p) => p.id === project?.id) ?? project;

  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const toggleTask = useToggleProjectTask();
  const del = useDeleteProject();

  useEffect(() => {
    setTab('overview');
    setEditing(false);
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [project, onClose]);

  if (!project || !live) return null;

  const pri = PRIORITY_META[live.priority];
  const src = SOURCE_META[live.source];
  const statusC = statusColor(live.status);
  const doneCount = live.tasks.filter((t) => t.done).length;

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
            <span className={styles.url}>iris://projects/{live.id}</span>
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
              {t.key === 'tasks' && live.tasks.length > 0 && (
                <span className={styles.navCount}>
                  {doneCount}/{live.tasks.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {tab === 'overview' &&
            (editing ? <EditOverview project={live} /> : <Overview project={live} srcLabel={src.label} />)}
          {tab === 'tasks' && <Tasks project={live} editing={editing} toggle={toggleTask} />}
          {tab === 'files' && <Files project={live} />}
          {tab === 'activity' && <Activity project={live} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── View: Overview ────────────────────────────────────────────────────────────
function Overview({ project, srcLabel }: { project: Project; srcLabel: string }) {
  const stages = project.stages.length > 0 ? project.stages : ['Planned', 'In progress', 'Done'];
  return (
    <>
      <div className={styles.summary}>{project.summary || 'No summary yet — click Edit to add one, or Fetch to let IRIS write it.'}</div>
      {project.sourceDetail && (
        <div className={styles.sourceBanner}>
          <Database size={13} style={{ color: 'var(--accent)' }} />
          <b className={styles.sourceBannerLabel}>Data source</b>
          <span className={styles.sourceSep}>·</span>
          {project.sourceDetail}
        </div>
      )}
      <div className={styles.stepperBlock}>
        <div className={styles.stepperHead}>
          <span className={styles.stepperNote}>{stages[Math.min(project.currentStage, stages.length - 1)] ?? 'Progress'}</span>
          <span className={styles.mono}>{project.progress}%</span>
        </div>
        <div className={styles.stepper}>
          {stages.map((name, i) => {
            const done = i < project.currentStage;
            const current = i === project.currentStage;
            return (
              <div key={`${name}-${i}`} className={styles.step}>
                <div className={styles.stepLine}>
                  <span className={styles.stepBar} data-on={i > 0 && i <= project.currentStage ? 'true' : undefined} />
                  <span className={styles.stepDot} data-state={done ? 'done' : current ? 'current' : 'todo'} />
                  <span className={styles.stepBar} data-on={i < project.currentStage ? 'true' : undefined} />
                </div>
                <span className={styles.stepName} data-active={done || current ? 'true' : undefined}>
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.metaGrid}>
        <MetaCell label="Deadline" value={deadlineLabel(project.deadline)} />
        <MetaCell label="Owner" value={project.owner || '—'} />
        <MetaCell label="Source" value={srcLabel} />
        <MetaCell label="Progress" value={`${project.progress}%`} />
      </div>
      {project.fields.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Key details</div>
          <div className={styles.detailGrid}>
            {project.fields.map((f, i) => (
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

// ── Edit: Overview form + fields editor ─────────────────────────────────────────
function EditOverview({ project }: { project: Project }) {
  const update = useUpdateProject();
  const fields = useProjectFieldMutations();
  const [draft, setDraft] = useState({
    name: project.name,
    summary: project.summary,
    priority: project.priority,
    status: project.status,
    deadline: project.deadline ?? '',
    owner: project.owner,
    progress: project.progress,
    currentStage: project.currentStage,
  });
  const [newField, setNewField] = useState({ label: '', value: '' });
  const stages = project.stages.length ? project.stages : ['Planned', 'In progress', 'Done'];

  const save = () =>
    update.mutate({
      id: project.id,
      patch: {
        name: draft.name.trim() || project.name,
        summary: draft.summary,
        priority: draft.priority,
        status: draft.status.trim() || project.status,
        deadline: draft.deadline.trim() ? draft.deadline.trim() : null,
        owner: draft.owner.trim() || project.owner,
        progress: Math.max(0, Math.min(100, Number(draft.progress) || 0)),
        currentStage: Math.max(0, Math.min(stages.length - 1, Number(draft.currentStage) || 0)),
      },
    });

  return (
    <div className={styles.editForm}>
      <Labeled label="Name">
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
          <input className={styles.input} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} />
        </Labeled>
      </div>
      <div className={styles.editRow}>
        <Labeled label="Deadline">
          <input className={styles.input} type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
        </Labeled>
        <Labeled label="Owner">
          <input className={styles.input} value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} />
        </Labeled>
      </div>
      <div className={styles.editRow}>
        <Labeled label={`Progress (${draft.progress}%)`}>
          <input className={styles.input} type="number" min={0} max={100} value={draft.progress} onChange={(e) => setDraft({ ...draft, progress: Number(e.target.value) })} />
        </Labeled>
        <Labeled label="Current stage">
          <select className={styles.input} value={draft.currentStage} onChange={(e) => setDraft({ ...draft, currentStage: Number(e.target.value) })}>
            {stages.map((s, i) => (
              <option key={`${s}-${i}`} value={i}>
                {s}
              </option>
            ))}
          </select>
        </Labeled>
      </div>
      <button className={styles.saveBtn} onClick={save} disabled={update.isPending}>
        {update.isPending ? 'Saving…' : 'Save changes'}
      </button>

      <div className={styles.sectionLabel}>Key details</div>
      <div className={styles.fieldEditor}>
        {project.fields.map((f) => (
          <FieldEditRow key={f.id} projectId={project.id} field={f} mut={fields} />
        ))}
        <div className={styles.addFieldRow}>
          <input className={styles.inputSm} placeholder="Label" value={newField.label} onChange={(e) => setNewField({ ...newField, label: e.target.value })} />
          <input className={styles.inputSm} placeholder="Value" value={newField.value} onChange={(e) => setNewField({ ...newField, value: e.target.value })} />
          <button
            className={styles.addBtn}
            disabled={!newField.label.trim() || fields.add.isPending}
            onClick={() =>
              fields.add.mutate(
                { projectId: project.id, label: newField.label.trim(), value: newField.value.trim() },
                { onSuccess: () => setNewField({ label: '', value: '' }) },
              )
            }
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldEditRow({
  projectId,
  field,
  mut,
}: {
  projectId: string;
  field: ProjectField;
  mut: ReturnType<typeof useProjectFieldMutations>;
}) {
  const [d, setD] = useState({ label: field.label, value: field.value });
  const commit = () => {
    if (d.label.trim() === field.label && d.value === field.value) return;
    if (!d.label.trim()) return;
    mut.edit.mutate({ projectId, fieldId: field.id, label: d.label.trim(), value: d.value });
  };
  return (
    <div className={styles.fieldRow}>
      <input className={styles.inputSm} value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} onBlur={commit} />
      <input className={styles.inputSm} value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} onBlur={commit} />
      <button className={styles.taskDelete} onClick={() => mut.remove.mutate({ projectId, fieldId: field.id })} aria-label="Delete field">
        <X size={12} strokeWidth={2.4} />
      </button>
    </div>
  );
}

// ── Tasks (view + edit) ─────────────────────────────────────────────────────────
function Tasks({
  project,
  editing,
  toggle,
}: {
  project: Project;
  editing: boolean;
  toggle: ReturnType<typeof useToggleProjectTask>;
}) {
  const tasks = useProjectTaskMutations();
  const [title, setTitle] = useState('');
  return (
    <div className={styles.tasks}>
      {project.tasks.length === 0 && !editing && <div className={styles.empty}>No tasks yet.</div>}
      {project.tasks.map((t) => (
        <div key={t.id} className={styles.taskRowWrap}>
          <button className={styles.taskRow} onClick={() => toggle.mutate({ projectId: project.id, taskId: t.id })}>
            <span className={t.done ? styles.checkOn : styles.check}>
              {t.done && <Check size={11} strokeWidth={3} style={{ color: '#fff' }} />}
            </span>
            <span className={t.done ? styles.taskDone : styles.taskText}>{t.title}</span>
          </button>
          {editing && (
            <button className={styles.taskDelete} onClick={() => tasks.remove.mutate({ projectId: project.id, taskId: t.id })} aria-label="Delete task">
              <X size={12} strokeWidth={2.4} />
            </button>
          )}
        </div>
      ))}
      {editing && (
        <div className={styles.addTaskRow}>
          <input
            className={styles.input}
            placeholder="Add a task…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) {
                tasks.add.mutate({ projectId: project.id, title: title.trim() }, { onSuccess: () => setTitle('') });
              }
            }}
          />
          <button
            className={styles.addBtn}
            disabled={!title.trim() || tasks.add.isPending}
            onClick={() => tasks.add.mutate({ projectId: project.id, title: title.trim() }, { onSuccess: () => setTitle('') })}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      )}
    </div>
  );
}

function Files({ project }: { project: Project }) {
  return (
    <div className={styles.files}>
      {project.files.length === 0 ? (
        <div className={styles.empty}>No files linked.</div>
      ) : (
        project.files.map((f, i) => (
          <div key={`${f.name}-${i}`} className={styles.fileRow}>
            <span className={styles.fileIcon}>
              <FileText size={16} />
            </span>
            <div className={styles.fileMeta}>
              <div className={styles.fileName}>{f.name}</div>
              <div className={styles.fileKind}>{f.kind}</div>
            </div>
            <ArrowUpRight size={15} className={styles.fileArrow} />
          </div>
        ))
      )}
    </div>
  );
}

function Activity({ project }: { project: Project }) {
  return (
    <div className={styles.activity}>
      {project.activity.length === 0 ? (
        <div className={styles.empty}>No activity recorded.</div>
      ) : (
        project.activity.map((x, i) => (
          <div key={`${x.who}-${i}`} className={styles.actRow}>
            <div className={styles.actRail}>
              <span className={styles.actDot} />
              {i < project.activity.length - 1 && <span className={styles.actLine} />}
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
