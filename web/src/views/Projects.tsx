import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Priority, Project, ProjectSource } from '@iris/shared';
import { Button, Modal, Spinner } from '@/components/primitives';
import { ArrowUpRight, Calendar, Database, Folder, Plus, Refresh, Search, Sparkle, X } from '@/components/icons';
import { ApiError } from '@/lib/api';
import {
  useAvailableSources,
  useDeleteSource,
  useFetchProjects,
  useLinkSource,
  useLinkSourceByRef,
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

/** Sentinel for the "all sources" filter option. */
const SOURCE_ALL = '__all__';

export function Projects() {
  const projects = useProjects();
  const sources = useProjectSources();
  const fetchProjects = useFetchProjects();
  const deleteSource = useDeleteSource();

  const [addOpen, setAddOpen] = useState(false);
  const [openProject, setOpenProject] = useState<Project | null>(null);
  const [pickerType, setPickerType] = useState<ProjectSource['type'] | null>(null);

  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [sourceFilter, setSourceFilter] = useState<string>(SOURCE_ALL);

  const fetchErr =
    fetchProjects.error instanceof ApiError ? fetchProjects.error.message : null;

  // Lightweight refresh: re-pull the current cards + sources from the server (no AI).
  const refreshing = projects.isFetching || sources.isFetching;
  const refresh = () => {
    void projects.refetch();
    void sources.refetch();
  };

  const allProjects = projects.data ?? [];

  // Distinct source files present (each linked sheet/doc/folder, plus non-file origins).
  const sourceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allProjects) {
      const key = p.sourceDetail ?? `kind:${p.source}`;
      if (!map.has(key)) map.set(key, p.sourceDetail ?? SOURCE_META[p.source].label);
    }
    return [...map].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [allProjects]);

  // Priorities present, in severity order.
  const priorityOptions = useMemo(() => {
    const present = new Set(allProjects.map((p) => p.priority));
    return (['critical', 'high', 'med', 'low'] as Priority[]).filter((p) => present.has(p));
  }, [allProjects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allProjects.filter((p) => {
      if (priorityFilter !== 'all' && p.priority !== priorityFilter) return false;
      if (sourceFilter !== SOURCE_ALL && (p.sourceDetail ?? `kind:${p.source}`) !== sourceFilter) return false;
      if (q) {
        const hay = [p.name, p.summary, p.sourceDetail ?? '', ...p.fields.map((f) => `${f.label} ${f.value}`)]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allProjects, query, priorityFilter, sourceFilter]);

  const filtersActive = query.trim() !== '' || priorityFilter !== 'all' || sourceFilter !== SOURCE_ALL;

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
          <Button
            variant="secondary"
            leftIcon={<Refresh size={15} className={refreshing ? styles.spin : undefined} />}
            onClick={refresh}
            disabled={refreshing}
            title="Re-pull the latest project cards (no AI)"
          >
            Refresh
          </Button>
          <Button variant="secondary" leftIcon={<Plus size={15} />} onClick={() => setAddOpen(true)}>
            Add project
          </Button>
          <Button
            leftIcon={<Sparkle size={15} />}
            loading={fetchProjects.isPending}
            onClick={() => fetchProjects.mutate()}
            title="Re-read your linked sources and re-extract project cards with AI"
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
      ) : allProjects.length === 0 ? (
        <div className={styles.emptyState}>
          No projects yet. Link a source and fetch, or add one manually.
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <Search size={15} strokeWidth={2} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects by name, summary, or field…"
                aria-label="Search projects"
              />
              {query && (
                <button className={styles.searchClear} onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={12} strokeWidth={2.4} />
                </button>
              )}
            </div>

            <label className={styles.selectField}>
              <span className={styles.selectLabel}>Priority</span>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as 'all' | Priority)}
                aria-label="Filter by priority"
              >
                <option value="all">All priorities</option>
                {priorityOptions.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.selectField}>
              <span className={styles.selectLabel}>Source file</span>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                aria-label="Filter by source file"
              >
                <option value={SOURCE_ALL}>All sources</option>
                {sourceOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <span className={styles.resultCount}>
              {filtered.length} of {allProjects.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className={styles.emptyState}>
              No projects match your filters.{' '}
              {filtersActive && (
                <button
                  className={styles.linkBtn}
                  onClick={() => {
                    setQuery('');
                    setPriorityFilter('all');
                    setSourceFilter(SOURCE_ALL);
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className={styles.cardsGrid}>
              {filtered.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => setOpenProject(p)} />
              ))}
            </div>
          )}
        </>
      )}

      <AddProjectModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ProjectDetailModal project={openProject} onClose={() => setOpenProject(null)} />
      <SourcePicker type={pickerType} onClose={() => setPickerType(null)} />
    </div>
  );
}

const TYPE_LABEL: Record<ProjectSource['type'], string> = { folder: 'folder', sheet: 'sheet', doc: 'doc' };
const REF_PLACEHOLDER: Record<ProjectSource['type'], string> = {
  sheet: 'Paste a Google Sheets link or ID',
  doc: 'Paste a Google Docs link or ID',
  folder: 'Paste a Drive folder link or ID',
};

/** Links a Drive item — by pasted URL/ID (reliable) or by picking from the live Drive list. */
function SourcePicker({ type, onClose }: { type: ProjectSource['type'] | null; onClose: () => void }) {
  const navigate = useNavigate();
  const available = useAvailableSources(type);
  const link = useLinkSource();
  const linkByRef = useLinkSourceByRef();
  const [ref, setRef] = useState('');
  const notConnected = available.error instanceof ApiError && available.error.code === 'UPSTREAM_UNAVAILABLE';
  const refErr = linkByRef.error instanceof ApiError ? linkByRef.error.message : null;
  const listErr = link.error instanceof ApiError ? link.error.message : null;

  // Reset both mutations' state whenever the picker opens for a different type.
  const resetRefLink = linkByRef.reset;
  const resetListLink = link.reset;
  useEffect(() => {
    setRef('');
    resetRefLink();
    resetListLink();
  }, [type, resetRefLink, resetListLink]);

  const submitRef = () => {
    const value = ref.trim();
    if (!value || !type || linkByRef.isPending) return;
    linkByRef.mutate({ type, ref: value }, { onSuccess: onClose });
  };

  return (
    <Modal open={type !== null} onClose={onClose} width={460} ariaLabel="Link a source">
      <div className={styles.pickerHead}>
        <h2 className={styles.pickerTitle}>Link a Google {type ? TYPE_LABEL[type] : 'source'}</h2>
        <button className={styles.pickerClose} onClick={onClose} aria-label="Close">
          <X size={14} strokeWidth={2.4} />
        </button>
      </div>
      <div className={styles.pickerBody}>
        {/* Paste a link / ID — works even when Drive listing is blocked */}
        <div className={styles.refForm}>
          <div className={styles.refRow}>
            <input
              className={styles.refInput}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitRef();
                }
              }}
              placeholder={type ? REF_PLACEHOLDER[type] : 'Paste a link or ID'}
              aria-label="Google link or ID"
              autoFocus
            />
            <Button onClick={submitRef} loading={linkByRef.isPending} disabled={!ref.trim()}>
              Link
            </Button>
          </div>
          {refErr ? (
            <div className={styles.refError}>{refErr}</div>
          ) : (
            <div className={styles.pickerHint}>
              We&apos;ll fetch the {type ? TYPE_LABEL[type] : 'item'}&apos;s real title automatically.
            </div>
          )}
        </div>

        <div className={styles.pickerDivider}>
          <span>or pick from your Drive</span>
        </div>

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
          <div className={styles.pickerEmpty}>
            No {type ? TYPE_LABEL[type] : 'item'}s found in your Drive — paste a link above instead.
          </div>
        )}
        {listErr && <div className={styles.refError}>{listErr}</div>}
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
