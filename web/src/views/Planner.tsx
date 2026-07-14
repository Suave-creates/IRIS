import { useMemo, useRef, useState } from 'react';
import type { PlannerBlock, PlannerColor } from '@iris/shared';
import { PLANNER_COLORS } from '@iris/shared';
import { Spinner } from '@/components/primitives';
import { Check, Plus, X } from '@/components/icons';
import { ApiError } from '@/lib/api';
import {
  useCreatePlannerBlock,
  useDeletePlannerBlock,
  usePlannerBlocks,
  useReorderPlannerBlocks,
  useRolloverWeek,
  useUpdatePlannerBlock,
} from '@/features/planner/usePlanner';
import {
  PLANNER_COLOR_CSS,
  type PlannerView,
  blockCovers,
  blockEndDate,
  dayLabel,
  dayOfMonth,
  daysBetween,
  isSameMonth,
  monthWeeks,
  rangeLabel,
  step,
  toYmd,
  viewRange,
  weekDates,
  weekStart,
  weekdayLabel,
} from './planner/helpers';
import styles from './Planner.module.css';

const VIEWS: PlannerView[] = ['day', 'week', 'month'];
const VIEW_LABEL: Record<PlannerView, string> = { day: 'Day', week: 'Week', month: 'Month' };

function safeColor(color: string): PlannerColor {
  return (color as PlannerColor) in PLANNER_COLOR_CSS ? (color as PlannerColor) : 'neutral';
}

/** The classic 6-dot drag grip. */
function Grip() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
      <circle cx="2.5" cy="2" r="1.05" />
      <circle cx="7.5" cy="2" r="1.05" />
      <circle cx="2.5" cy="6" r="1.05" />
      <circle cx="7.5" cy="6" r="1.05" />
      <circle cx="2.5" cy="10" r="1.05" />
      <circle cx="7.5" cy="10" r="1.05" />
    </svg>
  );
}

export function Planner() {
  const today = toYmd(new Date());
  const [view, setView] = useState<PlannerView>('week');
  const [anchor, setAnchor] = useState(today);
  const [composing, setComposing] = useState<{ date: string; block?: PlannerBlock } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ id: string; span: number } | null>(null);
  const dragRef = useRef<string | null>(null); // id of the block being moved
  const resizeRef = useRef<{ block: PlannerBlock; span: number } | null>(null);

  const range = viewRange(view, anchor);
  const blocksQ = usePlannerBlocks(range.from, range.to);
  const reorder = useReorderPlannerBlocks();
  const update = useUpdatePlannerBlock();
  const rollover = useRolloverWeek();

  const blocks = useMemo(() => blocksQ.data ?? [], [blocksQ.data]);
  const blocksById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  /** Effective span for a block — the live preview while it's being resized. */
  const spanOf = (b: PlannerBlock): number => (resizing?.id === b.id ? resizing.span : b.span);

  /** Ordered ids of blocks whose START day is `date` (the members eligible for reorder). */
  const startMembers = (date: string): string[] =>
    blocks.filter((b) => b.date === date).sort((a, b) => a.position - b.position).map((b) => b.id);

  const dates = view === 'day' ? [anchor] : weekDates(anchor);

  const dropOnDay = (targetDate: string) => {
    const id = dragRef.current;
    dragRef.current = null;
    setDragOver(null);
    if (!id) return;
    const block = blocksById.get(id);
    if (!block) return;
    const ids = startMembers(targetDate).filter((x) => x !== id);
    ids.push(id);
    reorder.mutate({ date: targetDate, ids });
  };

  const dropBefore = (targetDate: string, beforeId: string) => {
    const id = dragRef.current;
    dragRef.current = null;
    setDragOver(null);
    if (!id) return;
    const ids = startMembers(targetDate).filter((x) => x !== id);
    const idx = ids.indexOf(beforeId);
    ids.splice(idx < 0 ? ids.length : idx, 0, id);
    reorder.mutate({ date: targetDate, ids });
  };

  // Pointer-based resize: drag the grip over day rows to stretch the block live.
  const startResize = (block: PlannerBlock) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { block, span: block.span };
    setResizing({ id: block.id, span: block.span });
    const onMove = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const dayEl = el?.closest('[data-date]') as HTMLElement | null;
      const hovered = dayEl?.dataset.date;
      if (!hovered || !resizeRef.current) return;
      const span = Math.max(1, Math.min(31, daysBetween(resizeRef.current.block.date, hovered) + 1));
      resizeRef.current.span = span;
      setResizing({ id: resizeRef.current.block.id, span });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const data = resizeRef.current;
      resizeRef.current = null;
      setResizing(null);
      if (data && data.span !== data.block.span) update.mutate({ id: data.block.id, patch: { span: data.span } });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const doRollover = () => {
    if (!window.confirm('Copy this week’s blocks forward into next week?')) return;
    rollover.mutate(weekStart(anchor), { onSuccess: () => setAnchor(step('week', anchor, 1)) });
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Planner</h1>
          <p className={styles.lede}>Block out the macro shape of your day, week, or month — the big rocks, not every to-do.</p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.segmented} role="tablist">
          {VIEWS.map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? styles.segOn : styles.seg} onClick={() => setView(v)}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <div className={styles.navGroup}>
          <button className={styles.navBtn} onClick={() => setAnchor((a) => step(view, a, -1))} aria-label="Previous">
            ‹
          </button>
          <button className={styles.todayBtn} onClick={() => setAnchor(today)}>
            Today
          </button>
          <button className={styles.navBtn} onClick={() => setAnchor((a) => step(view, a, 1))} aria-label="Next">
            ›
          </button>
        </div>
        <span className={styles.rangeLabel}>{rangeLabel(view, anchor)}</span>
        <span className={styles.spacer} />
        {view !== 'month' && (
          <button className={styles.rolloverBtn} onClick={doRollover} disabled={rollover.isPending} title="Copy this week's blocks into next week">
            {rollover.isPending ? <Spinner size={13} /> : '↷'} Roll week over
          </button>
        )}
      </div>

      {view !== 'month' && <p className={styles.hint}>Drag a block to another day to move it · drag the grip to stretch it across days.</p>}

      {blocksQ.isLoading ? (
        <div className={styles.center}>
          <Spinner size={22} />
        </div>
      ) : blocksQ.isError ? (
        <div className={styles.errorMsg}>{blocksQ.error instanceof ApiError ? blocksQ.error.message : 'Could not load the planner.'}</div>
      ) : view === 'month' ? (
        <MonthGrid anchor={anchor} today={today} blocks={blocks} onPick={(date) => { setView('day'); setAnchor(date); }} />
      ) : (
        <div className={styles.board}>
          {dates.map((date) => (
            <DayRow
              key={date}
              date={date}
              today={today}
              blocks={blocks}
              spanOf={spanOf}
              dragOver={dragOver === date}
              composing={composing?.date === date ? composing : null}
              dragRef={dragRef}
              onCompose={setComposing}
              onDragOverDay={setDragOver}
              onDropDay={dropOnDay}
              onDropBefore={dropBefore}
              onStartResize={startResize}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DayRowProps {
  date: string;
  today: string;
  blocks: PlannerBlock[];
  spanOf: (b: PlannerBlock) => number;
  dragOver: boolean;
  composing: { date: string; block?: PlannerBlock } | null;
  dragRef: React.MutableRefObject<string | null>;
  onCompose: (c: { date: string; block?: PlannerBlock } | null) => void;
  onDragOverDay: (date: string | null) => void;
  onDropDay: (date: string) => void;
  onDropBefore: (date: string, beforeId: string) => void;
  onStartResize: (block: PlannerBlock) => (e: React.PointerEvent) => void;
}

function DayRow({ date, today, blocks, spanOf, dragOver, composing, dragRef, onCompose, onDragOverDay, onDropDay, onDropBefore, onStartResize }: DayRowProps) {
  const isToday = date === today;
  const del = useDeletePlannerBlock();

  const segments = blocks
    .filter((b) => blockCovers(b.date, spanOf(b), date))
    .sort((a, b) => a.position - b.position || (a.date < b.date ? -1 : 1));

  return (
    <div
      data-date={date}
      className={`${styles.dayRow} ${isToday ? styles.dayRowToday : ''} ${dragOver ? styles.dayRowOver : ''}`}
      onDragOver={(e) => {
        if (dragRef.current) {
          e.preventDefault();
          onDragOverDay(date);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragOverDay(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropDay(date);
      }}
    >
      <div className={styles.dayHead}>
        <span className={`${styles.dayName} ${isToday ? styles.dayNameToday : ''}`}>{weekdayLabel(date)}</span>
        <span className={styles.dayDate}>{dayLabel(date)}</span>
      </div>
      <div className={styles.blocks}>
        {segments.map((b) =>
          composing?.block?.id === b.id && b.date === date ? (
            <BlockComposer key={b.id} date={b.date} block={b} onDone={() => onCompose(null)} />
          ) : (
            <BlockSegment
              key={b.id}
              block={b}
              date={date}
              span={spanOf(b)}
              dragRef={dragRef}
              onEdit={() => onCompose({ date: b.date, block: b })}
              onDelete={() => del.mutate(b.id)}
              onDropBefore={() => onDropBefore(date, b.id)}
              onStartResize={onStartResize(b)}
            />
          ),
        )}
        {composing && !composing.block ? (
          <BlockComposer date={date} onDone={() => onCompose(null)} />
        ) : (
          <button className={styles.addBlock} onClick={() => onCompose({ date })}>
            <Plus size={13} strokeWidth={2.4} /> Add block
          </button>
        )}
      </div>
    </div>
  );
}

function BlockSegment({
  block,
  date,
  span,
  dragRef,
  onEdit,
  onDelete,
  onDropBefore,
  onStartResize,
}: {
  block: PlannerBlock;
  date: string;
  span: number;
  dragRef: React.MutableRefObject<string | null>;
  onEdit: () => void;
  onDelete: () => void;
  onDropBefore: () => void;
  onStartResize: (e: React.PointerEvent) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const isStart = block.date === date;
  const isEnd = blockEndDate(block.date, span) === date;
  const multi = block.fullDay || span > 1;
  const color = PLANNER_COLOR_CSS[safeColor(block.color)];

  const spanClass = multi ? (isStart ? styles.spanStart : isEnd ? styles.spanEnd : styles.spanMid) : '';
  const cls = [multi ? styles.blockFull : styles.block, spanClass, !isStart ? styles.cont : '', dragging ? styles.dragging : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      draggable
      onDragStart={(e) => {
        dragRef.current = block.id;
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(e) => {
        if (dragRef.current && isStart) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDrop={(e) => {
        if (dragRef.current && isStart) {
          e.preventDefault();
          e.stopPropagation();
          onDropBefore();
        }
      }}
      onClick={onEdit}
      role="button"
      tabIndex={0}
    >
      {!multi && <span className={styles.blockDot} style={{ background: color }} />}
      <span className={styles.blockTitle} title={block.title}>
        {block.title}
      </span>
      {isStart && span > 1 && <span className={styles.spanBadge}>{span}d</span>}
      {isStart && block.fullDay && span === 1 && <span className={styles.fullTag}>All day</span>}

      {isEnd && (
        <span
          className={styles.resizeGrip}
          title="Drag over the days to stretch this block"
          onPointerDown={onStartResize}
          onClick={(e) => e.stopPropagation()}
        >
          <Grip />
        </span>
      )}
      {isStart && (
        <button
          className={styles.blockDel}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Delete block"
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

function BlockComposer({ date, block, onDone }: { date: string; block?: PlannerBlock; onDone: () => void }) {
  const create = useCreatePlannerBlock();
  const update = useUpdatePlannerBlock();
  const [title, setTitle] = useState(block?.title ?? '');
  const [fullDay, setFullDay] = useState(block?.fullDay ?? false);
  const [span, setSpan] = useState(block?.span ?? 1);
  const [color, setColor] = useState<PlannerColor>(block ? safeColor(block.color) : 'accent');
  const pending = create.isPending || update.isPending;

  const save = () => {
    const t = title.trim();
    if (!t) return;
    if (block) update.mutate({ id: block.id, patch: { title: t, fullDay, span, color } }, { onSuccess: onDone });
    else create.mutate({ date, title: t, fullDay, span, color }, { onSuccess: onDone });
  };

  return (
    <div className={styles.composer}>
      <input
        className={styles.composerInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What's the block? e.g. Plan a WBR"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onDone();
        }}
      />
      <div className={styles.composerRow}>
        <div className={styles.swatches}>
          {PLANNER_COLORS.filter((c) => c !== 'neutral').map((c) => (
            <button key={c} className={`${styles.swatch} ${color === c ? styles.swatchOn : ''}`} style={{ background: PLANNER_COLOR_CSS[c] }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />
          ))}
        </div>
        <span className={styles.spanStepper}>
          Days
          <button className={styles.stepBtn} onClick={() => setSpan((s) => Math.max(1, s - 1))} aria-label="Fewer days">
            −
          </button>
          <span className={styles.spanVal}>{span}</span>
          <button className={styles.stepBtn} onClick={() => setSpan((s) => Math.min(31, s + 1))} aria-label="More days">
            +
          </button>
        </span>
        <label className={styles.fullToggle}>
          <input type="checkbox" checked={fullDay} onChange={(e) => setFullDay(e.target.checked)} />
          Full day
        </label>
        <div className={styles.composerActions}>
          <button className={styles.cancelBtn} onClick={onDone}>
            Cancel
          </button>
          <button className={styles.saveBtn} onClick={save} disabled={!title.trim() || pending}>
            {block ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ anchor, today, blocks, onPick }: { anchor: string; today: string; blocks: PlannerBlock[]; onPick: (date: string) => void }) {
  const weeks = monthWeeks(anchor);
  return (
    <div className={styles.monthGrid}>
      <div className={styles.monthHeadRow}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className={styles.monthHeadCell}>
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className={styles.monthWeek}>
          {week.map((date) => {
            const covering = blocks.filter((b) => blockCovers(b.date, b.span, date));
            const out = !isSameMonth(date, anchor);
            const isToday = date === today;
            return (
              <div key={date} className={`${styles.monthCell} ${out ? styles.monthCellOut : ''} ${isToday ? styles.monthCellToday : ''}`} onClick={() => onPick(date)}>
                <span className={styles.monthNum}>{dayOfMonth(date)}</span>
                {covering.slice(0, 3).map((b) => (
                  <span key={b.id} className={styles.monthBlock} title={b.title}>
                    {!(b.fullDay || b.span > 1) && <span className={styles.blockDot} style={{ background: PLANNER_COLOR_CSS[safeColor(b.color)] }} />}
                    {b.fullDay || b.span > 1 ? <Check size={10} strokeWidth={3} style={{ color: 'var(--accent)' }} /> : null}
                    {b.title}
                  </span>
                ))}
                {covering.length > 3 && <span className={styles.monthMore}>+{covering.length - 3} more</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
