import { useState } from 'react';
import type { Project, ProjectSource } from '@iris/shared';
import { Button, Spinner } from '@/components/primitives';
import { Calendar, Database, Folder, Plus, Refresh, Sparkle } from '@/components/icons';
import {
  useAddSource,
  useFetchProjects,
  useProjectSources,
  useProjects,
} from '@/features/projects/useProjects';
import type { AddSourceInput } from '@/features/projects/api';
import { PRIORITY_META, SOURCE_META, deadlineLabel, statusColor } from './projects/helpers';
import { AddProjectModal } from './projects/AddProjectModal';
import { ProjectDetailModal } from './projects/ProjectDetailModal';
import styles from './Projects.module.css';

const SOURCE_LETTER: Record<ProjectSource['type'], string> = {
  folder: 'F',
  sheet: '⊞',
  doc: '¶',
};
const SOURCE_TONE: Record<ProjectSource['type'], { bg: string; c: string }> = {
  folder: { bg: 'var(--info-soft)', c: 'var(--info)' },
  sheet: { bg: 'var(--success-soft)', c: 'var(--success)' },
  doc: { bg: 'var(--accent-soft)', c: 'var(--accent)' },
};
const SOURCE_STATUS: Record<ProjectSource['status'], { label: string; color: string }> = {
  linked: { label: 'Linked', color: 'var(--text-3)' },
  scanning: { label: 'Scanning…', color: 'var(--warn)' },
  scanned: { label: 'Scanned', color: 'var(--success)' },
};

export function Projects() {
  const projects = useProjects();
  const sources = useProjectSources();
  const fetchProjects = useFetchProjects();
  const addSource = useAddSource();

  const [addOpen, setAddOpen] = useState(false);
  const [openProject, setOpenProject] = useState<Project | null>(null);

  const onAddSource = (type: AddSourceInput['type']) => {
    const defaults: Record<AddSourceInput['type'], { name: string; meta: string }> = {
      folder: { name: 'New folder', meta: 'Drive folder' },
      sheet: { name: 'New sheet', meta: 'Spreadsheet' },
      doc: { name: 'New doc', meta: 'Document' },
    };
    addSource.mutate({ type, ...defaults[type] });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Projects</h1>
          <p className={styles.subtitle}>
            Pulled from your calendar, journal, conversations, and linked files — auto-prioritized by
            deadline.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" leftIcon={<Plus size={15} />} onClick={() => setAddOpen(true)}>
            Add project
          </Button>
          <Button
            leftIcon={<Sparkle size={15} />}
            loading={fetchProjects.isPending}
            onClick={() => fetchProjects.mutate()}
          >
            Fetch from sources
          </Button>
        </div>
      </header>

      {/* Linked sources */}
      <section className={styles.sourcesPanel}>
        <div className={styles.sourcesHead}>
          <div>
            <h3 className={styles.sourcesTitle}>Linked sources</h3>
            <div className={styles.sourcesSub}>
              IRIS scans these to read docs &amp; sheets and extract projects
            </div>
          </div>
          <div className={styles.sourceAddRow}>
            <button className={styles.dashedBtn} onClick={() => onAddSource('folder')} disabled={addSource.isPending}>
              <Folder size={13} strokeWidth={2} />
              Folder
            </button>
            <button className={styles.dashedBtn} onClick={() => onAddSource('sheet')} disabled={addSource.isPending}>
              <span className={styles.glyph}>⊞</span> Sheet
            </button>
            <button className={styles.dashedBtn} onClick={() => onAddSource('doc')} disabled={addSource.isPending}>
              <span className={styles.glyph}>¶</span> Doc
            </button>
          </div>
        </div>

        <div className={styles.sourcesGrid}>
          {sources.isLoading ? (
            <div className={styles.sourcesLoading}>
              <Spinner size={18} />
            </div>
          ) : sources.isError ? (
            <div className={styles.inlineError}>
              {(sources.error as Error)?.message ?? 'Could not load sources.'}
            </div>
          ) : (
            <>
              {sources.data?.map((src) => {
                const tone = SOURCE_TONE[src.type];
                const st = SOURCE_STATUS[src.status];
                return (
                  <div key={src.id} className={styles.sourceCard}>
                    <div className={styles.sourceLetter} style={{ background: tone.bg, color: tone.c }}>
                      {SOURCE_LETTER[src.type]}
                    </div>
                    <div className={styles.sourceMeta}>
                      <div className={styles.sourceName}>{src.name}</div>
                      <div className={styles.sourceDetail}>{src.meta ?? src.type}</div>
                    </div>
                    <span className={styles.sourceStatus} style={{ color: st.color }}>
                      {st.label}
                    </span>
                  </div>
                );
              })}
              <div className={styles.addSourceCard}>
                <div className={styles.addSourceIcon}>
                  <Plus size={16} strokeWidth={2.2} />
                </div>
                <div className={styles.sourceMeta}>
                  <div className={styles.addSourceName}>Add source</div>
                  <div className={styles.addSourceBtns}>
                    <button className={styles.miniBtn} onClick={() => onAddSource('folder')} disabled={addSource.isPending}>
                      Folder
                    </button>
                    <button className={styles.miniBtn} onClick={() => onAddSource('sheet')} disabled={addSource.isPending}>
                      Sheet
                    </button>
                    <button className={styles.miniBtn} onClick={() => onAddSource('doc')} disabled={addSource.isPending}>
                      Doc
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Fetching banner */}
      {fetchProjects.isPending && (
        <div className={styles.fetchBanner}>
          <Refresh size={18} strokeWidth={2.2} className={styles.spin} style={{ color: 'var(--accent)' }} />
          <div>
            <div className={styles.fetchTitle}>Reading your linked sources…</div>
            <div className={styles.fetchSub}>
              Scanning docs &amp; sheets, detecting deadlines, and auto-prioritizing new projects.
            </div>
          </div>
        </div>
      )}

      {/* Project cards grid */}
      {projects.isLoading ? (
        <div className={styles.gridLoading}>
          <Spinner size={24} />
        </div>
      ) : projects.isError ? (
        <div className={styles.inlineError}>
          {(projects.error as Error)?.message ?? 'Could not load projects.'}
        </div>
      ) : projects.data && projects.data.length === 0 ? (
        <div className={styles.emptyState}>
          No projects yet. Link a source and fetch, or add one manually.
        </div>
      ) : (
        <div className={styles.cardsGrid}>
          {projects.data?.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => setOpenProject(p)} />
          ))}
        </div>
      )}

      <AddProjectModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ProjectDetailModal project={openProject} onClose={() => setOpenProject(null)} />
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const pri = PRIORITY_META[project.priority];
  const src = SOURCE_META[project.source];
  const statusC = statusColor(project.status);
  const stages = project.stages.length > 0 ? project.stages : ['Planned', 'In progress', 'Done'];
  const sprintLabel = stages[Math.min(project.currentStage, stages.length - 1)] ?? 'Progress';

  return (
    <button className={styles.card} onClick={onOpen}>
      <div className={styles.cardTop}>
        <span className={styles.priPill} data-tone={pri.tone}>
          {pri.label}
        </span>
        <span className={styles.srcTag}>
          <span className={styles.srcDot} style={{ background: src.color }} />
          {src.label}
        </span>
        {project.auto && <span className={styles.autoTag}>AUTO</span>}
        <span className={styles.statusTag} style={{ color: statusC }}>
          <span className={styles.statusDot} style={{ background: statusC }} />
          {project.status}
        </span>
      </div>

      <div className={styles.cardName}>{project.name}</div>
      <div className={styles.cardSummary}>{project.summary}</div>

      {project.fields.length > 0 && (
        <div className={styles.chips}>
          {project.fields.slice(0, 3).map((f, i) => (
            <span key={`${f.label}-${i}`} className={styles.chip}>
              <b>{f.label}</b> {f.value}
            </span>
          ))}
        </div>
      )}

      <div className={styles.sprint}>
        <div className={styles.sprintHead}>
          <span className={styles.sprintLabel}>{sprintLabel}</span>
          <span className={styles.sprintPct}>{project.progress}%</span>
        </div>
        <div className={styles.segments}>
          {stages.map((s, i) => (
            <div
              key={`${s}-${i}`}
              className={styles.segment}
              data-on={i < project.currentStage ? 'true' : undefined}
              data-current={i === project.currentStage ? 'true' : undefined}
            />
          ))}
        </div>
      </div>

      <div className={styles.cardFoot}>
        <span className={styles.deadline}>
          <Calendar size={13} strokeWidth={2} />
          {deadlineLabel(project.deadline)}
        </span>
        {project.sourceDetail && (
          <span className={styles.footSource}>
            <Database size={12} strokeWidth={1.8} />
            <span className={styles.footSourceText}>{project.sourceDetail}</span>
          </span>
        )}
      </div>
    </button>
  );
}
