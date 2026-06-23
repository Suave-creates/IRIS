import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '@iris/shared';
import { ArrowUpRight, Check, Database, FileText, Lock, X } from '@/components/icons';
import { useToggleProjectTask } from '@/features/projects/useProjects';
import { PRIORITY_META, SOURCE_META, deadlineLabel, statusColor } from './helpers';
import styles from './ProjectDetailModal.module.css';

type Tab = 'overview' | 'tasks' | 'files' | 'activity';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'files', label: 'Files' },
  { key: 'activity', label: 'Activity' },
];

export interface ProjectDetailModalProps {
  project: Project | null;
  onClose: () => void;
}

export function ProjectDetailModal({ project, onClose }: ProjectDetailModalProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const toggleTask = useToggleProjectTask();

  // Reset to Overview when a different project opens; lock scroll + Escape.
  useEffect(() => {
    if (!project) return;
    setTab('overview');
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [project, onClose]);

  if (!project) return null;

  const pri = PRIORITY_META[project.priority];
  const src = SOURCE_META[project.source];
  const statusC = statusColor(project.status);
  const doneCount = project.tasks.filter((t) => t.done).length;

  return createPortal(
    <div className={styles.overlay} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={project.name}
        className={styles.window}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Browser tab strip */}
        <div className={styles.tabStrip}>
          <div className={styles.browserTab}>
            <span className={styles.tabDot} />
            <span className={styles.tabName}>{project.name}</span>
            <button className={styles.tabClose} onClick={onClose} aria-label="Close">
              <X size={11} strokeWidth={2.6} />
            </button>
          </div>
          <span className={styles.tabPlus}>+</span>
        </div>

        {/* Address bar */}
        <div className={styles.addrBar}>
          <div className={styles.urlBox}>
            <Lock size={12} strokeWidth={2.2} style={{ color: 'var(--success)' }} />
            <span className={styles.url}>iris://projects/{project.id}</span>
          </div>
          <span className={styles.priPill} data-tone={pri.tone}>
            {pri.label}
          </span>
          <span className={styles.statusChip} style={{ color: statusC }}>
            <span className={styles.statusDot} style={{ background: statusC }} />
            {project.status}
          </span>
        </div>

        {/* Tab nav */}
        <div className={styles.nav}>
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? styles.navTabOn : styles.navTab}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === 'tasks' && project.tasks.length > 0 && (
                <span className={styles.navCount}>
                  {doneCount}/{project.tasks.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className={styles.body}>
          {tab === 'overview' && <Overview project={project} srcLabel={src.label} />}

          {tab === 'tasks' && (
            <div className={styles.tasks}>
              {project.tasks.length === 0 ? (
                <div className={styles.empty}>No tasks yet.</div>
              ) : (
                project.tasks.map((t) => (
                  <button
                    key={t.id}
                    className={styles.taskRow}
                    onClick={() => toggleTask.mutate({ projectId: project.id, taskId: t.id })}
                  >
                    <span className={t.done ? styles.checkOn : styles.check}>
                      {t.done && <Check size={11} strokeWidth={3} style={{ color: '#fff' }} />}
                    </span>
                    <span className={t.done ? styles.taskDone : styles.taskText}>{t.title}</span>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === 'files' && (
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
          )}

          {tab === 'activity' && (
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
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Overview({ project, srcLabel }: { project: Project; srcLabel: string }) {
  const stages = project.stages.length > 0 ? project.stages : ['Planned', 'In progress', 'Done'];
  return (
    <>
      <div className={styles.summary}>{project.summary}</div>

      {project.sourceDetail && (
        <div className={styles.sourceBanner}>
          <Database size={13} style={{ color: 'var(--accent)' }} />
          <b className={styles.sourceBannerLabel}>Data source</b>
          <span className={styles.sourceSep}>·</span>
          {project.sourceDetail}
        </div>
      )}

      {/* Stage stepper */}
      <div className={styles.stepperBlock}>
        <div className={styles.stepperHead}>
          <span className={styles.stepperNote}>
            {stages[Math.min(project.currentStage, stages.length - 1)] ?? 'Progress'}
          </span>
          <span className={styles.mono}>{project.progress}%</span>
        </div>
        <div className={styles.stepper}>
          {stages.map((name, i) => {
            const done = i < project.currentStage;
            const current = i === project.currentStage;
            return (
              <div key={`${name}-${i}`} className={styles.step}>
                <div className={styles.stepLine}>
                  <span
                    className={styles.stepBar}
                    data-on={i > 0 && i <= project.currentStage ? 'true' : undefined}
                  />
                  <span
                    className={styles.stepDot}
                    data-state={done ? 'done' : current ? 'current' : 'todo'}
                  />
                  <span
                    className={styles.stepBar}
                    data-on={i < project.currentStage ? 'true' : undefined}
                  />
                </div>
                <span
                  className={styles.stepName}
                  data-active={done || current ? 'true' : undefined}
                >
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4-up meta grid */}
      <div className={styles.metaGrid}>
        <MetaCell label="Deadline" value={deadlineLabel(project.deadline)} />
        <MetaCell label="Owner" value={project.owner || '—'} />
        <MetaCell label="Source" value={srcLabel} />
        <MetaCell label="Progress" value={`${project.progress}%`} />
      </div>

      {/* Key details */}
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

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaCell}>
      <div className={styles.metaLabel}>{label}</div>
      <div className={styles.metaValue}>{value}</div>
    </div>
  );
}
