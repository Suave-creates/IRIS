import { useMemo, useState } from 'react';
import type { JournalTask, JournalTaskInput, TaskPriority } from '@iris/shared';
import { Button, Field, Input, Modal, Spinner, Textarea, Toggle } from '@/components/primitives';
import { Plus, X } from '@/components/icons';
import { ApiError } from '@/lib/api';
import {
  useCreateTask,
  useDeleteTask,
  useJournalTasks,
  useUpdateTask,
} from '@/features/journal/useJournal';
import styles from './Journal.module.css';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'med', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
const MAX_CHIPS = 2;

/** Local YYYY-MM-DD (avoids the UTC shift `toISOString` introduces near midnight). */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function priChipClass(p: TaskPriority): string {
  return (p === 'high' ? styles.priHigh : p === 'med' ? styles.priMed : styles.priLow) ?? '';
}
function priSegClass(p: TaskPriority): string {
  return (p === 'high' ? styles.priSegHigh : p === 'med' ? styles.priSegMed : styles.priSegLow) ?? '';
}

interface DraftState {
  task: JournalTask | null; // null → creating
  dueDate: string;
}

export function Journal() {
  const today = useMemo(() => new Date(), []);
  const year = today.getFullYear();
  const month = today.getMonth();
  const todayStr = ymd(year, month, today.getDate());

  const from = ymd(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const to = ymd(year, month, daysInMonth);

  const { data: tasks, isLoading, error } = useJournalTasks(from, to);
  const createTask = useCreateTask(from, to);
  const updateTask = useUpdateTask(from, to);
  const deleteTask = useDeleteTask(from, to);

  const [draft, setDraft] = useState<DraftState | null>(null);

  // Group tasks by dueDate, ordered: undone first, then by time, then priority.
  const byDate = useMemo(() => {
    const map = new Map<string, JournalTask[]>();
    const rank: Record<TaskPriority, number> = { high: 0, med: 1, low: 2 };
    for (const t of tasks ?? []) {
      const list = map.get(t.dueDate) ?? [];
      list.push(t);
      map.set(t.dueDate, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const ta = a.dueTime ?? '99:99';
        const tb = b.dueTime ?? '99:99';
        if (ta !== tb) return ta < tb ? -1 : 1;
        return rank[a.priority] - rank[b.priority];
      });
    }
    return map;
  }, [tasks]);

  // Day options for the modal's Day select (the whole current month).
  const dayOptions = useMemo(
    () =>
      Array.from({ length: daysInMonth }, (_, i) => {
        const d = i + 1;
        const value = ymd(year, month, d);
        const wd = new Date(year, month, d).toLocaleDateString('en-US', { weekday: 'short' });
        return { value, label: `${wd} ${d}` };
      }),
    [year, month, daysInMonth],
  );

  // Leading blanks so the 1st lands under its weekday (Monday-start grid).
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun..6=Sat
  const leadingBlanks = (firstWeekday + 6) % 7; // shift so Monday=0

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            Journal · {MONTHS[month]} {year}
          </h1>
          <div className={styles.sub}>
            Plan your days — add tasks to any date, click a task to open its details.
          </div>
        </div>
        <Button
          leftIcon={<Plus size={15} />}
          onClick={() => setDraft({ task: null, dueDate: todayStr })}
        >
          New task
        </Button>
      </div>

      {error ? (
        <p className={styles.error}>
          {error instanceof ApiError ? error.message : 'Could not load your journal.'}
        </p>
      ) : null}

      <div className={styles.weekdays}>
        {WEEKDAYS.map((w) => (
          <div key={w} className={styles.weekday}>
            {w}
          </div>
        ))}
      </div>

      {isLoading && !tasks ? (
        <div className={styles.center}>
          <Spinner size={24} />
        </div>
      ) : (
        <div className={styles.grid}>
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <div key={`blank-${i}`} className={styles.blank} aria-hidden="true" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dateStr = ymd(year, month, day);
            const isToday = dateStr === todayStr;
            const dayTasks = byDate.get(dateStr) ?? [];
            const visible = dayTasks.slice(0, MAX_CHIPS);
            const moreCount = dayTasks.length - visible.length;

            return (
              <div
                key={dateStr}
                className={`${styles.cell} ${isToday ? styles.cellToday : ''}`}
              >
                <div className={styles.cellHead}>
                  {isToday ? (
                    <span className={styles.dayToday}>{day}</span>
                  ) : (
                    <span className={styles.dayNum}>{day}</span>
                  )}
                  <button
                    className={styles.addBtn}
                    aria-label={`Add task on ${MONTHS[month]} ${day}`}
                    onClick={() => setDraft({ task: null, dueDate: dateStr })}
                  >
                    <Plus size={13} strokeWidth={2.4} />
                  </button>
                </div>

                {visible.map((t) => (
                  <button
                    key={t.id}
                    className={`${styles.chip} ${priChipClass(t.priority)}`}
                    title={t.title}
                    onClick={() => setDraft({ task: t, dueDate: t.dueDate })}
                  >
                    <span className={styles.dot} />
                    <span className={`${styles.chipTitle} ${t.done ? styles.chipDone : ''}`}>
                      {t.title}
                    </span>
                  </button>
                ))}

                {moreCount > 0 ? (
                  <button
                    className={styles.more}
                    onClick={() => setDraft({ task: dayTasks[MAX_CHIPS] ?? null, dueDate: dateStr })}
                  >
                    +{moreCount} more
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {draft ? (
        <TaskModal
          key={draft.task?.id ?? `new-${draft.dueDate}`}
          draft={draft}
          dayOptions={dayOptions}
          saving={createTask.isPending || updateTask.isPending}
          deleting={deleteTask.isPending}
          onClose={() => setDraft(null)}
          onSave={(input) => {
            if (draft.task) {
              updateTask.mutate({ id: draft.task.id, input });
            } else {
              createTask.mutate(input);
            }
            setDraft(null);
          }}
          onDelete={() => {
            if (draft.task) deleteTask.mutate(draft.task.id);
            setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface TaskModalProps {
  draft: DraftState;
  dayOptions: { value: string; label: string }[];
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onSave: (input: JournalTaskInput) => void;
  onDelete: () => void;
}

function TaskModal({
  draft,
  dayOptions,
  saving,
  deleting,
  onClose,
  onSave,
  onDelete,
}: TaskModalProps) {
  const editing = draft.task != null;
  const [title, setTitle] = useState(draft.task?.title ?? '');
  const [dueDate, setDueDate] = useState(draft.task?.dueDate ?? draft.dueDate);
  const [dueTime, setDueTime] = useState(draft.task?.dueTime ?? '');
  const [priority, setPriority] = useState<TaskPriority>(draft.task?.priority ?? 'med');
  const [done, setDone] = useState(draft.task?.done ?? false);
  const [detail, setDetail] = useState(draft.task?.detail ?? '');

  const trimmedTitle = title.trim();
  const trimmedTime = dueTime.trim();
  const canSave = trimmedTitle.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      title: trimmedTitle,
      dueDate,
      dueTime: trimmedTime ? trimmedTime : null,
      priority,
      done,
      detail: detail.trim() ? detail.trim() : null,
    });
  };

  return (
    <Modal open onClose={onClose} width={440} ariaLabel="Task details">
      <div className={styles.modalHead}>
        <h2 className={styles.modalTitle}>Task details</h2>
        <button className={styles.closeBtn} aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className={styles.modalBody}>
        <Field label="Task" htmlFor="task-title">
          <Input
            id="task-title"
            value={title}
            autoFocus
            placeholder="What needs to get done?"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
          />
        </Field>

        <div className={styles.row2}>
          <div className={styles.colDay}>
            <Field label="Day" htmlFor="task-day">
              <select
                id="task-day"
                className={styles.select}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              >
                {dayOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className={styles.colTime}>
            <Field label="Time" htmlFor="task-time">
              <Input
                id="task-time"
                className={styles.timeInput}
                value={dueTime}
                placeholder="09:00"
                onChange={(e) => setDueTime(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <Field label="Priority">
          <div className={styles.priRow}>
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`${styles.priSeg} ${priority === p.value ? priSegClass(p.value) : ''}`}
                aria-pressed={priority === p.value}
                onClick={() => setPriority(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>

        <div className={styles.doneRow}>
          <span className={styles.doneLabel}>{done ? 'Marked done' : 'Mark as done'}</span>
          <Toggle checked={done} onChange={setDone} label="Mark task done" />
        </div>

        <Field label="Details" htmlFor="task-detail">
          <Textarea
            id="task-detail"
            value={detail}
            rows={3}
            placeholder="Add context, links, or sub-steps…"
            onChange={(e) => setDetail(e.target.value)}
          />
        </Field>
      </div>

      <div className={styles.modalFoot}>
        {editing ? (
          <Button variant="danger" onClick={onDelete} disabled={deleting} loading={deleting}>
            Delete
          </Button>
        ) : null}
        <Button variant="secondary" className={styles.spacer} onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave || saving} loading={saving}>
          Save task
        </Button>
      </div>
    </Modal>
  );
}
