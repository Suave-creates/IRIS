import { useEffect, useRef, useState } from 'react';
import type { WhiteboardItem, WhiteboardKind } from '@iris/shared';
import { Button, Spinner } from '@/components/primitives';
import { ArrowUpRight, Plus, Refresh, Send, Sparkle, X } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { InsightView } from './InsightView';
import { useProjectSources } from '@/features/projects/useProjects';
import { useWhiteboard, useWhiteboardMutations } from '@/features/whiteboard/useWhiteboard';
import styles from './Whiteboard.module.css';

type FileKind = 'sheet' | 'doc' | 'folder';

const KIND_META: Record<WhiteboardKind, { letter: string; label: string; bg: string; color: string }> = {
  sheet: { letter: '⊞', label: 'Google Sheets', bg: 'var(--success-soft)', color: 'var(--success)' },
  doc: { letter: '¶', label: 'Google Docs', bg: 'var(--accent-soft)', color: 'var(--accent)' },
  folder: { letter: 'F', label: 'Drive folder', bg: 'var(--info-soft)', color: 'var(--info)' },
  pdf: { letter: 'PDF', label: 'PDF', bg: 'var(--danger-soft)', color: 'var(--danger)' },
  slide: { letter: '▭', label: 'Slides', bg: 'var(--warn-soft)', color: 'var(--warn)' },
  insight: { letter: '✦', label: 'AI insight', bg: 'var(--accent-soft)', color: 'var(--accent)' },
};

const REF_LABEL: Record<FileKind, string> = { sheet: 'Sheet', doc: 'Doc', folder: 'Folder' };

export function Whiteboard() {
  const board = useWhiteboard();
  const m = useWhiteboardMutations();
  const sources = useProjectSources();

  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [resize, setResize] = useState<{ id: string; w: number; h: number } | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const [refKind, setRefKind] = useState<FileKind>('sheet');
  const [refInput, setRefInput] = useState('');
  const [prompt, setPrompt] = useState('');

  const items = board.data ?? [];
  const aiCount = items.filter((i) => i.aiIncluded).length;

  // Detaches the in-flight drag's window listeners; runs on drop and on unmount.
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  const addErr = m.add.error instanceof ApiError ? m.add.error.message : null;
  const refErr = m.addByRef.error instanceof ApiError ? m.addByRef.error.message : null;
  const aiErr = m.ai.error instanceof ApiError ? m.ai.error.message : null;

  // ── Drag (document-level listeners; persist once on drop) ──────────────────
  const startDrag = (item: WhiteboardItem, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let curX = item.x;
    let curY = item.y;
    let moved = false;
    setDrag({ id: item.id, x: item.x, y: item.y });
    const move = (ev: MouseEvent) => {
      curX = Math.max(0, item.x + (ev.clientX - start.x));
      curY = Math.max(0, item.y + (ev.clientY - start.y));
      moved = true;
      setDrag({ id: item.id, x: curX, y: curY });
    };
    const detach = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dragCleanup.current = null;
    };
    const up = () => {
      detach();
      if (moved) {
        // Keep the overlay until the cache reflects the new position, so the
        // window doesn't flicker back to its origin between drop and persist.
        const maxZ = items.reduce((mx, i) => Math.max(mx, i.z), 0);
        m.update.mutate(
          { id: item.id, patch: { x: curX, y: curY, z: maxZ + 1 } },
          { onSettled: () => setDrag(null) },
        );
      } else {
        setDrag(null);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    // Lets the unmount effect tear down a drag still in progress.
    dragCleanup.current = detach;
  };

  // ── Resize (bottom-right handle; persist once on drop) ─────────────────────
  const startResize = (item: WhiteboardItem, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    let w = item.w;
    let h = item.h;
    let moved = false;
    setResize({ id: item.id, w, h });
    const move = (ev: MouseEvent) => {
      w = Math.max(160, item.w + (ev.clientX - start.x));
      h = Math.max(120, item.h + (ev.clientY - start.y));
      moved = true;
      setResize({ id: item.id, w, h });
    };
    const detach = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dragCleanup.current = null;
    };
    const up = () => {
      detach();
      if (moved) {
        m.update.mutate({ id: item.id, patch: { w, h } }, { onSettled: () => setResize(null) });
      } else {
        setResize(null);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    dragCleanup.current = detach;
  };

  const addFromSource = (kind: FileKind, externalId: string, title: string, webLink: string | null) => {
    const offset = 40 + (items.length % 5) * 28;
    m.add.mutate({ kind, externalId, title, webLink, x: offset, y: offset });
  };

  const submitRef = () => {
    const ref = refInput.trim();
    if (!ref || m.addByRef.isPending) return;
    m.addByRef.mutate(
      { kind: refKind, ref, x: 56, y: 56 },
      {
        onSuccess: () => {
          setRefInput('');
          setRefOpen(false);
        },
      },
    );
  };

  const tidy = () => {
    items.forEach((item, i) => {
      const x = 36 + (i % 3) * 348;
      const y = 34 + Math.floor(i / 3) * 264;
      if (item.x !== x || item.y !== y) m.update.mutate({ id: item.id, patch: { x, y } });
    });
  };

  const linkableSources = (sources.data ?? []).filter((s) => s.externalId);

  return (
    <div className={styles.board}>
      {/* ── Left: file library ── */}
      <aside className={styles.library}>
        <div className={styles.libLabel}>Add to canvas</div>

        {sources.isLoading ? (
          <div className={styles.libCenter}>
            <Spinner size={16} />
          </div>
        ) : sources.isError ? (
          <div className={styles.libError}>
            {(sources.error as Error)?.message ?? 'Could not load linked files.'}
          </div>
        ) : linkableSources.length === 0 ? (
          <div className={styles.libEmpty}>
            No linked files yet. Link a Drive sheet or doc in Projects, or add one by URL below.
          </div>
        ) : (
          linkableSources.map((s) => {
            const meta = KIND_META[s.type];
            return (
              <button
                key={s.id}
                className={styles.libItem}
                disabled={m.add.isPending}
                onClick={() => addFromSource(s.type, s.externalId!, s.name, s.webLink)}
                title={`Add ${s.name} to the canvas`}
              >
                <span className={styles.libIcon} style={{ background: meta.bg, color: meta.color }}>
                  {meta.letter}
                </span>
                <span className={styles.libName}>{s.name}</span>
                <Plus size={13} strokeWidth={2.4} className={styles.libPlus} />
              </button>
            );
          })
        )}

        {addErr && <div className={styles.libError}>{addErr}</div>}

        {/* Add by URL / ID */}
        {refOpen ? (
          <div className={styles.refForm}>
            <div className={styles.refKinds}>
              {(['sheet', 'doc', 'folder'] as FileKind[]).map((k) => (
                <button
                  key={k}
                  className={styles.refKind}
                  data-active={refKind === k}
                  onClick={() => setRefKind(k)}
                >
                  {REF_LABEL[k]}
                </button>
              ))}
            </div>
            <input
              className={styles.refInput}
              value={refInput}
              onChange={(e) => setRefInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitRef();
                }
              }}
              placeholder={`Paste a Google ${REF_LABEL[refKind]} link or ID`}
              aria-label="Google link or ID"
              autoFocus
            />
            {refErr && <div className={styles.libError}>{refErr}</div>}
            <div className={styles.refActions}>
              <Button size="sm" onClick={submitRef} loading={m.addByRef.isPending} disabled={!refInput.trim()}>
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRefOpen(false);
                  setRefInput('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button className={styles.addRefBtn} onClick={() => setRefOpen(true)}>
            <Plus size={13} strokeWidth={2.2} /> Add by link / ID
          </button>
        )}
      </aside>

      {/* ── Center: canvas ── */}
      <div className={styles.canvasWrap}>
        <div className={styles.canvasBar}>
          <span className={styles.ctxBadge}>
            <Sparkle size={13} strokeWidth={2} /> {aiCount} in Claude’s context
          </span>
          <button className={styles.tidyBtn} onClick={tidy} disabled={items.length === 0}>
            <Refresh size={13} strokeWidth={2.2} /> Tidy up
          </button>
        </div>

        <div className={styles.canvas}>
          {board.isLoading ? (
            <div className={styles.canvasCenter}>
              <Spinner size={24} />
            </div>
          ) : board.isError ? (
            <div className={styles.canvasCenter}>
              <div className={styles.canvasError}>
                {(board.error as Error)?.message ?? 'Could not load the whiteboard.'}
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.canvasCenter}>
              <div className={styles.canvasEmpty}>
                Your canvas is empty. Add files from the left, then ask Claude to summarize or reconcile them.
              </div>
            </div>
          ) : (
            items.map((item) => {
              const pos = drag?.id === item.id ? drag : { x: item.x, y: item.y };
              const sizing = resize?.id === item.id ? resize : { w: item.w, h: item.h };
              const meta = KIND_META[item.kind];
              const active = drag?.id === item.id || resize?.id === item.id;
              return (
                <div
                  key={item.id}
                  className={styles.window}
                  data-ai={item.aiIncluded}
                  data-dragging={active}
                  style={{ left: pos.x, top: pos.y, width: sizing.w, height: sizing.h, zIndex: active ? 9999 : item.z }}
                >
                  <div className={styles.winHead} onMouseDown={(e) => startDrag(item, e)}>
                    <span className={styles.winIcon} style={{ background: meta.bg, color: meta.color }}>
                      {meta.letter}
                    </span>
                    <span className={styles.winTitle}>{item.title}</span>
                    {item.kind !== 'insight' && (
                      <button
                        className={styles.aiToggle}
                        data-on={item.aiIncluded}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => m.update.mutate({ id: item.id, patch: { aiIncluded: !item.aiIncluded } })}
                        title={item.aiIncluded ? 'Included in Claude’s context' : 'Add to Claude’s context'}
                      >
                        AI
                      </button>
                    )}
                    <button
                      className={styles.winClose}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => m.remove.mutate(item.id)}
                      aria-label="Remove from canvas"
                    >
                      <X size={12} strokeWidth={2.4} />
                    </button>
                  </div>

                  <div className={styles.winBody}>
                    {item.kind === 'insight' ? (
                      <InsightView body={item.body} />
                    ) : (
                      <div className={styles.fileBody}>
                        <div className={styles.fileKind}>{meta.label}</div>
                        {item.webLink ? (
                          <a className={styles.fileLink} href={item.webLink} target="_blank" rel="noreferrer">
                            Open in Google <ArrowUpRight size={13} />
                          </a>
                        ) : (
                          <div className={styles.fileHint}>Linked file</div>
                        )}
                        <div className={styles.fileHint}>
                          {item.aiIncluded ? 'In Claude’s context' : 'Toggle AI to include in context'}
                        </div>
                      </div>
                    )}
                  </div>
                  <div
                    className={styles.resizeHandle}
                    onMouseDown={(e) => startResize(item, e)}
                    aria-hidden
                    title="Drag to resize"
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: Claude rail ── */}
      <aside className={styles.rail}>
        <div className={styles.railHead}>
          <div className={styles.railTitle}>
            <Sparkle size={15} strokeWidth={2} /> Claude
          </div>
          <div className={styles.railSub}>{aiCount} file{aiCount === 1 ? '' : 's'} in context</div>
        </div>

        <div className={styles.railSection}>
          <div className={styles.railLabel}>Quick actions</div>
          <button
            className={styles.action}
            disabled={m.ai.isPending || aiCount === 0}
            onClick={() => m.ai.mutate({ action: 'summarize' })}
          >
            Summarize all files
          </button>
          <button
            className={styles.action}
            disabled={m.ai.isPending || aiCount === 0}
            onClick={() => m.ai.mutate({ action: 'reconcile' })}
          >
            Find inconsistencies
          </button>
          <button
            className={styles.action}
            disabled={m.ai.isPending || aiCount === 0}
            onClick={() => m.ai.mutate({ action: 'board' })}
          >
            Build board summary
          </button>
        </div>

        <div className={styles.railSection}>
          <div className={styles.railLabel}>Ask across these files</div>
          <textarea
            className={styles.promptBox}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask Claude to work across the files in context…"
            rows={3}
          />
          <Button
            block
            leftIcon={<Send size={14} />}
            loading={m.ai.isPending}
            disabled={!prompt.trim() || aiCount === 0}
            onClick={() =>
              m.ai.mutate(
                { action: 'custom', prompt: prompt.trim() },
                { onSuccess: () => setPrompt('') },
              )
            }
          >
            Run
          </Button>
          {aiCount === 0 && <div className={styles.railHint}>Toggle “AI” on a window to add it to Claude’s context.</div>}
          {m.ai.isPending && (
            <div className={styles.railRunning}>
              <Spinner size={14} /> Reading {aiCount} file{aiCount === 1 ? '' : 's'} and reasoning…
            </div>
          )}
          {aiErr && <div className={styles.libError}>{aiErr}</div>}
        </div>
      </aside>
    </div>
  );
}
