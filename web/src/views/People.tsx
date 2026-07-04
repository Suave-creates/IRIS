import { useCallback, useMemo, useState } from 'react';
import type { Person, PersonInput } from '@iris/shared';
import { Check } from '@/components/icons';
import { usePeople, useUpdatePerson } from '@/features/people/usePeople';
import { VIEW_COPY } from './copy';
import {
  CATEGORY_COLORS,
  CATEGORY_ORDER,
  DAY_META,
  FILTER_CATS,
  TREND,
  alpha,
  initials,
  locationColor,
  type PeopleFilterCat,
} from './people/helpers';
import { PersonDrawer } from './people/PersonDrawer';
import { PersonFormModal } from './people/PersonFormModal';
import { PersonBulkAddModal } from './people/PersonBulkAddModal';
import { PersonBulkRemoveModal } from './people/PersonBulkRemoveModal';
import styles from './People.module.css';

export function People() {
  const people = usePeople();
  const updatePerson = useUpdatePerson();

  const [cat, setCat] = useState<PeopleFilterCat>('all');
  const [hiddenLocs, setHiddenLocs] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formPerson, setFormPerson] = useState<Person | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);

  const allPeople = people.data ?? [];
  const selected = allPeople.find((p) => p.id === selectedId) ?? null;

  // Site codes present in the roster, in stable order for the filter chips.
  const locations = useMemo(() => [...new Set(allPeople.map((p) => p.location))].sort(), [allPeople]);

  const visible = useMemo(
    () => allPeople.filter((p) => (cat === 'all' || p.category === cat) && !hiddenLocs.has(p.location)),
    [allPeople, cat, hiddenLocs],
  );

  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((c) => ({ cat: c, people: visible.filter((p) => p.category === c) })).filter(
        (g) => g.people.length > 0,
      ),
    [visible],
  );

  // Location chips are multi-on: refuse turning the last visible one off.
  const toggleLoc = (loc: string) => {
    setHiddenLocs((prev) => {
      const next = new Set(prev);
      if (next.has(loc)) {
        next.delete(loc);
        return next;
      }
      const visibleLocs = locations.filter((l) => !prev.has(l));
      if (visibleLocs.length <= 1) return prev;
      next.add(loc);
      return next;
    });
  };

  const toggleDay = (person: Person, dayIndex: number) => {
    const day = dayIndex + 1;
    const days = person.days.includes(day)
      ? person.days.filter((d) => d !== day)
      : [...person.days, day].sort((a, b) => a - b);
    const patch: PersonInput = {
      name: person.name,
      category: person.category,
      func: person.func,
      location: person.location,
      days,
    };
    updatePerson.mutate({ id: person.id, patch });
  };

  const openAdd = () => {
    setFormPerson(null);
    setFormOpen(true);
  };
  const openEdit = useCallback(() => {
    setFormPerson(selected);
    setFormOpen(true);
  }, [selected]);

  // Ignore drawer close requests while the form modal is on top (its Escape wins).
  const closeDrawer = useCallback(() => {
    if (!formOpen) setSelectedId(null);
  }, [formOpen]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{VIEW_COPY.people.title}</h1>
        <p className={styles.subtitle}>{VIEW_COPY.people.subtitle}</p>
      </header>

      <section className={styles.card}>
        {people.isLoading ? (
          <div aria-hidden="true">
            <div className={`iris-skeleton ${styles.skeletonHead}`} />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`iris-skeleton ${styles.skeletonRow}`} />
            ))}
          </div>
        ) : people.isError ? (
          <div className={styles.inlineError}>
            {(people.error as Error)?.message ?? 'Could not load people.'}
          </div>
        ) : (
          <>
            {/* ── Filter row ── */}
            <div className={styles.filters}>
              {FILTER_CATS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cat === c ? styles.catChipOn : styles.catChip}
                  aria-pressed={cat === c}
                  onClick={() => setCat(c)}
                >
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
              <div className={styles.locGroup}>
                {locations.length > 0 && <span className={styles.locLabel}>Location</span>}
                {locations.map((loc) => {
                  const on = !hiddenLocs.has(loc);
                  const color = locationColor(loc);
                  return (
                    <button
                      key={loc}
                      type="button"
                      className={styles.locChip}
                      style={on ? { color, borderColor: color, background: alpha(color, 0.13) } : undefined}
                      aria-pressed={on}
                      onClick={() => toggleLoc(loc)}
                    >
                      {loc}
                    </button>
                  );
                })}
                <button type="button" className={styles.bulkBtn} onClick={() => setBulkOpen(true)}>
                  Bulk add
                </button>
                {allPeople.length > 0 && (
                  <button type="button" className={styles.bulkRemoveBtn} onClick={() => setBulkRemoveOpen(true)}>
                    Bulk remove
                  </button>
                )}
                <button type="button" className={styles.addBtn} onClick={openAdd}>
                  + Add person
                </button>
              </div>
            </div>

            {allPeople.length === 0 ? (
              <div className={styles.emptyState}>
                No people yet — add your first person, or bulk add your roster from the weekly planner.
              </div>
            ) : (
              <div className={styles.roster}>
                {/* ── Day header (shown once) ── */}
                <div className={`${styles.gridRow} ${styles.dayHead}`}>
                  <div className={styles.countCell}>
                    <span className={styles.countText}>{visible.length} people</span>
                  </div>
                  {DAY_META.map((d, i) => (
                    <div
                      key={d.name}
                      className={styles.dayHeadCell}
                      style={{ borderColor: alpha(d.color, 0.25), background: alpha(d.color, 0.05) }}
                    >
                      <div className={styles.dayHeadTop}>
                        <span className={styles.dayHeadName} style={{ color: d.color }}>
                          {d.name}
                        </span>
                        <span
                          className={styles.dayHeadPill}
                          style={{ color: d.color, background: alpha(d.color, 0.11) }}
                        >
                          {visible.filter((p) => p.days.includes(i + 1)).length}
                        </span>
                      </div>
                      <div className={styles.dayHeadTheme}>{d.theme}</div>
                    </div>
                  ))}
                  <div className={styles.engHead}>
                    <span className={styles.countText}>Engagement</span>
                  </div>
                </div>

                {visible.length === 0 ? (
                  <div className={styles.emptyState}>No people match your filters.</div>
                ) : (
                  groups.map((g) => (
                    <div key={g.cat}>
                      <div className={styles.groupLabel}>
                        <span className={styles.groupSwatch} style={{ background: CATEGORY_COLORS[g.cat] }} />
                        {g.cat}
                        <span className={styles.groupCount}>· {g.people.length}</span>
                      </div>
                      {g.people.map((p) => (
                        <PersonRow
                          key={p.id}
                          person={p}
                          selected={p.id === selectedId}
                          onOpen={() => setSelectedId(p.id)}
                          onToggleDay={(di) => toggleDay(p, di)}
                        />
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </section>

      <PersonDrawer person={selected} onEdit={openEdit} onClose={closeDrawer} />
      <PersonFormModal open={formOpen} person={formPerson} onClose={() => setFormOpen(false)} />
      <PersonBulkAddModal open={bulkOpen} existing={allPeople} onClose={() => setBulkOpen(false)} />
      <PersonBulkRemoveModal open={bulkRemoveOpen} people={allPeople} onClose={() => setBulkRemoveOpen(false)} />
    </div>
  );
}

interface PersonRowProps {
  person: Person;
  selected: boolean;
  onOpen: () => void;
  onToggleDay: (dayIndex: number) => void;
}

function PersonRow({ person, selected, onOpen, onToggleDay }: PersonRowProps) {
  const catColor = CATEGORY_COLORS[person.category];
  const trend = TREND[person.engagement.trend];
  return (
    <div
      className={[styles.gridRow, styles.row, selected ? styles.rowSelected : ''].filter(Boolean).join(' ')}
      onClick={onOpen}
    >
      <div className={styles.nameCell}>
        <span className={styles.avatar} style={{ background: alpha(catColor, 0.12), color: catColor }}>
          {initials(person.name)}
        </span>
        <span className={styles.nameCol}>
          <span className={styles.personName}>{person.name}</span>
          <span className={styles.personMeta}>
            {person.location} · {person.func} · {person.cadence}
          </span>
        </span>
      </div>
      {DAY_META.map((d, di) => {
        const active = person.days.includes(di + 1);
        return (
          <button
            key={d.name}
            type="button"
            className={styles.dayCell}
            style={
              active
                ? { borderColor: alpha(d.color, 0.31), background: alpha(d.color, 0.086), color: d.color }
                : undefined
            }
            title={`${active ? 'Remove' : 'Add'} ${d.name} for ${person.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleDay(di);
            }}
          >
            {active && <Check size={13} strokeWidth={3} />}
          </button>
        );
      })}
      <div className={styles.engCell}>
        <span className={styles.scoreRow}>
          <span className={styles.score}>{person.engagement.score}</span>
          <span className={styles.trendArrow} style={{ color: trend.color }}>
            {trend.arrow}
          </span>
          {person.engagement.boostDelta > 0 && (
            <span className={styles.boostPill}>+{person.engagement.boostDelta}</span>
          )}
        </span>
        <span className={styles.lastInt}>{person.engagement.lastInteraction ?? '—'}</span>
      </div>
    </div>
  );
}
