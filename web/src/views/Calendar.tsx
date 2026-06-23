import { useMemo, useState } from 'react';
import type { CalendarEvent, CalendarEventInput } from '@iris/shared';
import { Button, Modal, Spinner } from '@/components/primitives';
import { Plus, Refresh, X } from '@/components/icons';
import { ApiError } from '@/lib/api';
import {
  useCalendarEvents,
  useCreateEvent,
  useDeleteEvent,
  useUpdateEvent,
} from '@/features/calendar/useCalendar';
import styles from './Calendar.module.css';

// Visible grid window: 7am → 8pm. START_HOUR inclusive, END_HOUR is the last gridline shown.
const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_PX = 46;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

// Color swatches offered in the modal (status/brand tokens resolved to literals for the picker dots).
const SWATCHES = ['#4b49d6', '#2a6fdb', '#1f9d57', '#c77700', '#d14343', '#6b2fb5'];
const DEFAULT_COLOR = '#4b49d6';

const WEEKDAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Date helpers (all local time) ──────────────────────────────────────────
function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysSinceMonday = (out.getDay() + 6) % 7; // 0 = Sunday
  out.setDate(out.getDate() - daysSinceMonday);
  out.setHours(0, 0, 0, 0);
  return out;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** Hour-of-day as a float, e.g. 14:30 → 14.5. */
function hourFloat(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}
function fmtHourLabel(h: number): string {
  const period = h < 12 || h === 24 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}
function fmtTimeRange(start: Date, end: Date): string {
  const t = (d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const period = h < 12 ? 'AM' : 'PM';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hh} ${period}` : `${hh}:${String(m).padStart(2, '0')} ${period}`;
  };
  return `${t(start)} – ${t(end)}`;
}

interface EventForm {
  id: string | null; // null = creating
  title: string;
  dayIndex: number; // 0..6 within the week
  startHour: number;
  endHour: number;
  color: string;
  notes: string;
}

export function Calendar() {
  const weekStart = useMemo(() => startOfWeek(new Date()), []);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const fromIso = weekStart.toISOString();
  const toIso = weekEnd.toISOString();

  const { data: events, isLoading, error } = useCalendarEvents(fromIso, toIso);
  const createEvent = useCreateEvent(fromIso, toIso);
  const updateEvent = useUpdateEvent(fromIso, toIso);
  const deleteEvent = useDeleteEvent(fromIso, toIso);

  const [form, setForm] = useState<EventForm | null>(null);
  const today = new Date();

  // Header label: "June 2026 · This week".
  const headerLabel = `${MONTHS[weekStart.getMonth()]} ${weekStart.getFullYear()} · This week`;

  // Group events into day columns and project them onto the time grid.
  const columns = useMemo(() => {
    return days.map((day) => {
      const dayEvents = (events ?? [])
        .map((e) => ({ e, start: new Date(e.startAt), end: new Date(e.endAt) }))
        .filter(({ start }) => sameDay(start, day))
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .map(({ e, start, end }) => {
          const startH = Math.max(hourFloat(start), START_HOUR);
          const endH = Math.min(hourFloat(end), END_HOUR + 1);
          const top = (startH - START_HOUR) * HOUR_PX;
          const height = Math.max((endH - startH) * HOUR_PX - 4, 22);
          return { event: e, start, end, top, height };
        });
      return { day, events: dayEvents };
    });
  }, [days, events]);

  function openCreate() {
    // Default to today if it's in this week, else Monday; 9–10am.
    const todayIndex = days.findIndex((d) => sameDay(d, today));
    setForm({
      id: null,
      title: '',
      dayIndex: todayIndex >= 0 ? todayIndex : 0,
      startHour: 9,
      endHour: 10,
      color: DEFAULT_COLOR,
      notes: '',
    });
  }

  function openEdit(e: CalendarEvent) {
    const start = new Date(e.startAt);
    const end = new Date(e.endAt);
    const dayIndex = days.findIndex((d) => sameDay(d, start));
    setForm({
      id: e.id,
      title: e.title,
      dayIndex: dayIndex >= 0 ? dayIndex : 0,
      startHour: Math.round(hourFloat(start)),
      endHour: Math.max(Math.round(hourFloat(end)), Math.round(hourFloat(start)) + 1),
      color: e.color,
      notes: e.notes ?? '',
    });
  }

  function close() {
    setForm(null);
  }

  function buildInput(f: EventForm): CalendarEventInput {
    const day = days[f.dayIndex] ?? weekStart;
    const start = new Date(day);
    start.setHours(f.startHour, 0, 0, 0);
    const end = new Date(day);
    end.setHours(Math.max(f.endHour, f.startHour + 1), 0, 0, 0);
    return {
      title: f.title.trim() || 'Untitled event',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      color: f.color,
      notes: f.notes.trim() ? f.notes.trim() : null,
    };
  }

  function save() {
    if (!form) return;
    const input = buildInput(form);
    if (form.id) {
      updateEvent.mutate({ id: form.id, input });
    } else {
      createEvent.mutate(input);
    }
    close();
  }

  function remove() {
    if (!form?.id) return;
    deleteEvent.mutate(form.id);
    close();
  }

  const apiMessage = error instanceof ApiError ? error.message : error ? 'Could not load events.' : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{headerLabel}</h1>
          <div className={styles.sub}>Connected to Google Calendar · last sync just now</div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.syncBtn} title="Sync (coming soon)">
            <Refresh size={15} />
            Sync
          </button>
          <Button size="sm" leftIcon={<Plus size={15} />} onClick={openCreate}>
            New event
          </Button>
        </div>
      </header>

      {/* Day-of-week header strip aligned to the columns below. */}
      <div className={styles.dayRow}>
        <div className={styles.gutterSpacer} />
        {days.map((day, i) => {
          const isToday = sameDay(day, today);
          return (
            <div key={i} className={styles.dayHead}>
              <div className={styles.dayLabel}>{WEEKDAY_LABELS[i]}</div>
              <div className={`${styles.dayNum} ${isToday ? styles.dayNumToday : ''}`}>{day.getDate()}</div>
            </div>
          );
        })}
      </div>

      <div className={styles.scroll}>
        {isLoading ? (
          <div className={styles.center}>
            <Spinner size={24} />
          </div>
        ) : apiMessage ? (
          <div className={styles.error}>{apiMessage}</div>
        ) : (
          <div className={styles.gridBody}>
            {/* Hour gutter */}
            <div className={styles.gutter}>
              {HOURS.map((h) => (
                <div key={h} className={styles.hourLabel} style={{ height: HOUR_PX }}>
                  {fmtHourLabel(h)}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {columns.map(({ events: dayEvents }, i) => (
              <div key={i} className={styles.col}>
                {HOURS.map((h) => (
                  <div key={h} className={styles.hourCell} style={{ height: HOUR_PX }} />
                ))}
                {dayEvents.map(({ event, start, end, top, height }) => (
                  <button
                    key={event.id}
                    type="button"
                    className={styles.event}
                    style={{
                      top,
                      height,
                      background: softBg(event.color),
                      borderLeftColor: event.color,
                    }}
                    onClick={() => openEdit(event)}
                  >
                    <div className={styles.eventTitle}>{event.title}</div>
                    <div className={styles.eventTime}>{fmtTimeRange(start, end)}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <EventModal
        form={form}
        days={days}
        onChange={setForm}
        onClose={close}
        onSave={save}
        onDelete={remove}
        saving={createEvent.isPending || updateEvent.isPending}
        deleting={deleteEvent.isPending}
      />
    </div>
  );
}

// ── Event modal ─────────────────────────────────────────────────────────────
function EventModal({
  form,
  days,
  onChange,
  onClose,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  form: EventForm | null;
  days: Date[];
  onChange: (f: EventForm) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  if (!form) return null;
  const editing = form.id !== null;

  const dayOpts = days.map((d, i) => {
    const wd = WEEKDAY_LABELS[i] ?? '';
    const titleCase = wd.charAt(0) + wd.slice(1).toLowerCase();
    const month = (MONTHS[d.getMonth()] ?? '').slice(0, 3);
    return { v: i, label: `${titleCase}, ${month} ${d.getDate()}` };
  });
  const hourOpts = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  return (
    <Modal open onClose={onClose} width={440} ariaLabel="Event details">
      <div className={styles.modalHead}>
        <h2 className={styles.modalTitle}>Event details</h2>
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className={styles.modalBody}>
        <div>
          <label className={styles.fieldLabel}>Title</label>
          <input
            className={styles.textInput}
            value={form.title}
            onChange={(e) => onChange({ ...form, title: e.target.value })}
            placeholder="e.g. Strategy review"
            autoFocus
          />
        </div>

        <div className={styles.threeCol}>
          <div className={styles.dayCol}>
            <label className={styles.fieldLabel}>Day</label>
            <select
              className={styles.select}
              value={form.dayIndex}
              onChange={(e) => onChange({ ...form, dayIndex: Number(e.target.value) })}
            >
              {dayOpts.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.hourColField}>
            <label className={styles.fieldLabel}>Start</label>
            <select
              className={styles.select}
              value={form.startHour}
              onChange={(e) => {
                const start = Number(e.target.value);
                onChange({ ...form, startHour: start, endHour: Math.max(form.endHour, start + 1) });
              }}
            >
              {hourOpts.map((h) => (
                <option key={h} value={h}>
                  {fmtHourLabel(h)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.hourColField}>
            <label className={styles.fieldLabel}>End</label>
            <select
              className={styles.select}
              value={form.endHour}
              onChange={(e) => onChange({ ...form, endHour: Number(e.target.value) })}
            >
              {hourOpts
                .filter((h) => h > form.startHour)
                .map((h) => (
                  <option key={h} value={h}>
                    {fmtHourLabel(h)}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div>
          <label className={styles.fieldLabel}>Color</label>
          <div className={styles.swatches}>
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.swatch}
                style={{
                  background: c,
                  boxShadow: form.color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : 'none',
                }}
                aria-label={`Color ${c}`}
                aria-pressed={form.color === c}
                onClick={() => onChange({ ...form, color: c })}
              />
            ))}
          </div>
        </div>

        <div>
          <label className={styles.fieldLabel}>Notes</label>
          <textarea
            className={styles.textArea}
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
            placeholder="Add details, location, or agenda…"
            rows={2}
          />
        </div>
      </div>

      <div className={styles.modalFoot}>
        {editing && (
          <Button variant="danger" size="sm" onClick={onDelete} loading={deleting}>
            Delete
          </Button>
        )}
        <Button variant="secondary" size="sm" className={styles.cancelBtn} onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} loading={saving}>
          Save event
        </Button>
      </div>
    </Modal>
  );
}

/** Builds a soft translucent background from a hex event color (works in light + dark). */
function softBg(hex: string): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.14)`;
}
