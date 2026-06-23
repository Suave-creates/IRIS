import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, CalendarEventInput } from '@iris/shared';
import { Button, Modal, Spinner } from '@/components/primitives';
import { Plus, X } from '@/components/icons';
import { ApiError } from '@/lib/api';
import {
  useCalendarEvents,
  useCreateEvent,
  useDeleteEvent,
  useGuestSearch,
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
const pad2 = (n: number) => String(n).padStart(2, '0');
/** Local date as YYYY-MM-DD for a <input type="date">. */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** Local time as HH:MM for a <input type="time">. */
function toTimeStr(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
  date: string; // YYYY-MM-DD (local)
  start: string; // HH:MM (local)
  end: string; // HH:MM (local)
  color: string;
  location: string;
  guests: string[];
  notes: string;
}

export function Calendar() {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset]);
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

  // Header label: "June 2026 · This week" (relative to the viewed week).
  const relLabel =
    weekOffset === 0
      ? 'This week'
      : weekOffset === 1
        ? 'Next week'
        : weekOffset === -1
          ? 'Last week'
          : `Week of ${(MONTHS[weekStart.getMonth()] ?? '').slice(0, 3)} ${weekStart.getDate()}`;
  const headerLabel = `${MONTHS[weekStart.getMonth()]} ${weekStart.getFullYear()} · ${relLabel}`;

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
    const base = days.find((d) => sameDay(d, today)) ?? weekStart;
    setForm({
      id: null,
      title: '',
      date: toDateStr(base),
      start: '09:00',
      end: '10:00',
      color: DEFAULT_COLOR,
      location: '',
      guests: [],
      notes: '',
    });
  }

  function openEdit(e: CalendarEvent) {
    const start = new Date(e.startAt);
    const end = new Date(e.endAt);
    setForm({
      id: e.id,
      title: e.title,
      date: toDateStr(start),
      start: toTimeStr(start),
      end: toTimeStr(end),
      color: e.color,
      location: e.location ?? '',
      guests: [],
      notes: e.notes ?? '',
    });
  }

  function close() {
    setForm(null);
  }

  /** Returns the built input, or null if the date/time is incomplete. */
  function buildInput(f: EventForm): CalendarEventInput | null {
    if (!f.date || !f.start) return null;
    const start = new Date(`${f.date}T${f.start}`);
    let end = f.end ? new Date(`${f.date}T${f.end}`) : start;
    if (Number.isNaN(start.getTime())) return null;
    if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 60 * 60 * 1000); // default to a 1-hour event
    }
    return {
      title: f.title.trim() || 'Untitled event',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      color: f.color,
      location: f.location.trim() ? f.location.trim() : null,
      notes: f.notes.trim() ? f.notes.trim() : null,
      attendees: f.guests,
    };
  }

  function save() {
    if (!form) return;
    const input = buildInput(form);
    if (!input) return;
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
          <div className={styles.weekNav}>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => setWeekOffset((o) => o - 1)}
              aria-label="Previous week"
            >
              ‹
            </button>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => setWeekOffset(0)}
              disabled={weekOffset === 0}
            >
              Today
            </button>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => setWeekOffset((o) => o + 1)}
              aria-label="Next week"
            >
              ›
            </button>
          </div>
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
        minDate={toDateStr(weekStart)}
        maxDate={toDateStr(addDays(weekStart, 6))}
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
  minDate,
  maxDate,
  onChange,
  onClose,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  form: EventForm | null;
  minDate: string;
  maxDate: string;
  onChange: (f: EventForm) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  const [guestInput, setGuestInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [guestNames, setGuestNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(guestInput.trim()), 220);
    return () => clearTimeout(t);
  }, [guestInput]);
  const suggest = useGuestSearch(debouncedQ);

  if (!form) return null;
  const editing = form.id !== null;
  const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  const addEmail = (email: string, name?: string) => {
    const g = email.trim().toLowerCase();
    if (!isEmail(g) || form.guests.includes(g)) return;
    if (name) setGuestNames((m) => ({ ...m, [g]: name }));
    onChange({ ...form, guests: [...form.guests, g] });
  };
  const addGuest = () => {
    addEmail(guestInput);
    setGuestInput('');
  };
  const removeGuest = (g: string) => onChange({ ...form, guests: form.guests.filter((x) => x !== g) });

  const picks = (suggest.data ?? []).filter((p) => !form.guests.includes(p.email.toLowerCase())).slice(0, 6);
  const showPicks = focused && debouncedQ.length >= 2 && picks.length > 0;

  return (
    <Modal open onClose={onClose} width={460} ariaLabel="Event details">
      <div className={styles.modalHead}>
        <h2 className={styles.modalTitle}>{editing ? 'Event details' : 'New event'}</h2>
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
            <label className={styles.fieldLabel}>Date</label>
            <input
              type="date"
              className={styles.textInput}
              value={form.date}
              min={minDate}
              max={maxDate}
              onChange={(e) => onChange({ ...form, date: e.target.value })}
            />
          </div>
          <div className={styles.hourColField}>
            <label className={styles.fieldLabel}>Start</label>
            <input
              type="time"
              className={styles.textInput}
              value={form.start}
              onChange={(e) => onChange({ ...form, start: e.target.value })}
            />
          </div>
          <div className={styles.hourColField}>
            <label className={styles.fieldLabel}>End</label>
            <input
              type="time"
              className={styles.textInput}
              value={form.end}
              onChange={(e) => onChange({ ...form, end: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className={styles.fieldLabel}>Location</label>
          <input
            className={styles.textInput}
            value={form.location}
            onChange={(e) => onChange({ ...form, location: e.target.value })}
            placeholder="Room, address, or video link"
          />
        </div>

        <div>
          <label className={styles.fieldLabel}>Guests</label>
          {form.guests.length > 0 && (
            <div className={styles.guestChips}>
              {form.guests.map((g) => (
                <span key={g} className={styles.guestChip} title={guestNames[g] ? g : undefined}>
                  {guestNames[g] ?? g}
                  <button type="button" onClick={() => removeGuest(g)} aria-label={`Remove ${g}`}>
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={styles.guestSearch}>
            <input
              className={styles.textInput}
              value={guestInput}
              onChange={(e) => setGuestInput(e.target.value)}
              onFocus={() => setFocused(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addGuest();
                }
              }}
              onBlur={() => {
                setFocused(false);
                addGuest();
              }}
              placeholder="Search name or email…"
              inputMode="email"
            />
            {showPicks && (
              <div className={styles.guestPicks}>
                {picks.map((p) => (
                  <button
                    key={p.email}
                    type="button"
                    className={styles.guestPick}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      addEmail(p.email, p.name);
                      setGuestInput('');
                      setDebouncedQ('');
                    }}
                  >
                    <span className={styles.guestPickName}>{p.name}</span>
                    {p.name !== p.email && <span className={styles.guestPickEmail}>{p.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.guestHint}>Type to search your contacts &amp; directory — guests are invited via Google.</div>
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
            placeholder="Add details or an agenda…"
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
