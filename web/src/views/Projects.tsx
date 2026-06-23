import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project, ProjectSource } from '@iris/shared';
import { Button, Modal, Spinner } from '@/components/primitives';
import { ArrowUpRight, Calendar, Database, Folder, Plus, Refresh, Sparkle, X } from '@/components/icons';
import { ApiError } from '@/lib/api';
import {
  useAvailableSources,
  useDeleteSource,
  useFetchProjects,
  useLinkSource,
  useProjectSources,
  useProjects,
} from '@/features/projects/useProjects';
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
  const deleteSource = useDeleteSource();

  const [addOpen, setAddOpen] = useState(false);
  const [openProject, setOpenProject] = useState<Project | null>(null);
  const [pickerType, setPickerType] = useState<ProjectSource['type'] | null>(null);

  const fetchErr =
    fetchProjects.error instanceof ApiError ? fetchProjects.error.message : null;

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
            <button className={styles.dashedBtn} onClick={() => setPickerType('folder')}>
              <Folder size={13} strokeWidth={2} />
              Folder
            </button>
            <button className={styles.dashedBtn} onClick={() => setPickerType('sheet')}>
              <span className={styles.glyph}>⊞</span> Sheet
            </button>
            <button className={styles.dashedBtn} onClick={() => setPickerType('doc')}>
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
              {sources.data?.length === 0 && (
                <div className={styles.sourcesEmpty}>
                  No sources linked yet. Add a real Google Drive folder, doc, or sheet above.
                </div>
              )}
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
                    <button
                      className={styles.sourceDelete}
                      onClick={() => deleteSource.mutate(src.id)}
                      aria-label="Remove source"
                    >
                      <X size={12} strokeWidth={2.4} />
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </section>

      {fetchErr && <div className={styles.inlineError}>{fetchErr}</div>}

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
      <SourcePicker type={pickerType} onClose={() => setPickerType(null)} />
    </div>
  );
}

const TYPE_LABEL: Record<ProjectSource['type'], string> = { folder: 'folder', sheet: 'sheet', doc: 'doc' };

/** Lists real Drive items of a type and links the chosen one as a project source. */
function SourcePicker({ type, onClose }: { type: ProjectSource['type'] | null; onClose: () => void }) {
  const navigate = useNavigate();
  const available = useAvailableSources(type);
  const link = useLinkSource();
  const notConnected = available.error instanceof ApiError && available.error.code === 'UPSTREAM_UNAVAILABLE';

  return (
    <Modal open={type !== null} onClose={onClose} width={460} ariaLabel="Link a source">
      <div className={styles.pickerHead}>
        <h2 className={styles.pickerTitle}>Link a Google {type ? TYPE_LABEL[type] : 'source'}</h2>
        <button className={styles.pickerClose} onClick={onClose} aria-label="Close">
          <X size={14} strokeWidth={2.4} />
        </button>
      </div>
      <div className={styles.pickerBody}>
        {available.isLoading && (
          <div className={styles.pickerCenter}>
            <Spinner size={20} />
          </div>
        )}
        {available.isError &&
          (notConnected ? (
            <div className={styles.pickerEmpty}>
              <p>Connect Google to browse your real Drive items.</p>
              <Button onClick={() => navigate('/connectors')}>Go to Connectors</Button>
            </div>
          ) : (
            <div className={styles.inlineError}>
              {available.error instanceof ApiError ? available.error.message : 'Could not list items.'}
            </div>
          ))}
        {available.data && available.data.length === 0 && (
          <div className={styles.pickerEmpty}>No {type ? TYPE_LABEL[type] : 'item'}s found in your Drive.</div>
        )}
        {available.data?.map((item) => (
          <button
            key={item.externalId}
            className={styles.pickerItem}
            disabled={link.isPending}
            onClick={() =>
              link.mutate(
                { type: item.type, externalId: item.externalId, name: item.name, webLink: item.webLink },
                { onSuccess: onClose },
              )
            }
          >
            <span className={styles.pickerItemName}>{item.name}</span>
            <ArrowUpRight size={14} style={{ color: 'var(--text-3)' }} />
          </button>
        ))}
      </div>
    </Modal>
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
