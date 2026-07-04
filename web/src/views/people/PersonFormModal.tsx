import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { PERSON_CATEGORIES, PERSON_FUNCTIONS, PERSON_LOCATIONS, isValidLocation, normalizeLocation } from '@iris/shared';
import type { ContactSuggestion, Person, PersonCategory, PersonFunction, PersonInput, PersonLocation } from '@iris/shared';
import { Input, Modal } from '@/components/primitives';
import {
  useContactSuggestions,
  useCreatePerson,
  useDeletePerson,
  usePeople,
  useUpdatePerson,
} from '@/features/people/usePeople';
import { DAY_META, alpha, freqLabel, locationColor } from './helpers';
import styles from './PersonFormModal.module.css';

export interface PersonFormModalProps {
  open: boolean;
  /** Person being edited, or null for add mode. */
  person: Person | null;
  onClose: () => void;
}

/** Active segmented chips take their colour: border, 10% tint, coloured text. */
function chipStyle(on: boolean, color: string): CSSProperties | undefined {
  return on ? { borderColor: color, background: alpha(color, 0.1), color } : undefined;
}

/** Add / edit person modal (name, category, function, location, engagement days). */
export function PersonFormModal({ open, person, onClose }: PersonFormModalProps) {
  const create = useCreatePerson();
  const update = useUpdatePerson();
  const remove = useDeletePerson();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<PersonCategory>('Direct');
  const [func, setFunc] = useState<PersonFunction>('Operations');
  const [location, setLocation] = useState<PersonLocation>('BWD');
  const [days, setDays] = useState<number[]>([2, 4]);
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [addingLoc, setAddingLoc] = useState(false);
  const [newLoc, setNewLoc] = useState('');

  // ── Contact autocomplete (Google Contacts + Workspace directory) ──
  const [suggestQ, setSuggestQ] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // Skips the debounce cycle right after picking a suggestion.
  const pickedRef = useRef(false);
  useEffect(() => {
    if (pickedRef.current) {
      pickedRef.current = false;
      return;
    }
    const t = window.setTimeout(() => setSuggestQ(email.trim()), 250);
    return () => window.clearTimeout(t);
  }, [email]);
  const contactSuggestions = useContactSuggestions(emailFocused ? suggestQ : '');
  const suggestions = contactSuggestions.data ?? [];
  const dropdownOpen = emailFocused && suggestQ.length >= 2 && suggestions.length > 0;
  useEffect(() => setHighlight(0), [suggestions.length, suggestQ]);

  const pickSuggestion = (s: ContactSuggestion) => {
    pickedRef.current = true;
    setEmail(s.email);
    // Fill what the user hasn't typed — never clobber their input.
    if (!name.trim() && s.name && !s.name.includes('@')) setName(s.name);
    if (!company.trim() && s.company) setCompany(s.company);
    if (!role.trim() && s.role) setRole(s.role);
    setSuggestQ('');
  };
  const onEmailKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!dropdownOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = suggestions[highlight];
      if (s) pickSuggestion(s);
    } else if (e.key === 'Escape') {
      // Close only the dropdown, not the whole modal.
      e.stopPropagation();
      setSuggestQ('');
    }
  };

  // Known site codes: default suggestions + everything already in the roster
  // + whatever this form currently holds (so a fresh custom code stays visible).
  const { data: roster } = usePeople();
  const knownLocations = useMemo(() => {
    const set = new Set<string>(PERSON_LOCATIONS);
    for (const p of roster ?? []) set.add(p.location);
    if (location) set.add(location);
    return [...set].sort();
  }, [roster, location]);

  const commitNewLoc = () => {
    const code = normalizeLocation(newLoc);
    if (!isValidLocation(code)) return;
    setLocation(code);
    setAddingLoc(false);
    setNewLoc('');
  };
  const onNewLocKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitNewLoc();
    } else if (e.key === 'Escape') {
      // Close only the inline input, not the whole modal.
      e.stopPropagation();
      setAddingLoc(false);
      setNewLoc('');
    }
  };

  const resetCreate = create.reset;
  const resetUpdate = update.reset;
  const resetRemove = remove.reset;
  // Re-seed the form each time the modal opens (edit pre-fills, add uses defaults).
  useEffect(() => {
    if (!open) return;
    setName(person?.name ?? '');
    setCategory(person?.category ?? 'Direct');
    setFunc(person?.func ?? 'Operations');
    setLocation(person?.location ?? 'BWD');
    setDays(person ? [...person.days] : [2, 4]);
    setEmail(person?.email ?? '');
    setCompany(person?.company ?? '');
    setRole(person?.role ?? '');
    setAddingLoc(false);
    setNewLoc('');
    resetCreate();
    resetUpdate();
    resetRemove();
  }, [open, person, resetCreate, resetUpdate, resetRemove]);

  const toggleDay = (day: number) => {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  };

  const canSave = name.trim() !== '' && days.length > 0;
  const pending = create.isPending || update.isPending || remove.isPending;
  const err = create.error ?? update.error ?? remove.error;

  const submit = () => {
    if (!canSave || pending) return;
    const input: PersonInput = {
      name: name.trim(),
      category,
      func,
      location,
      days,
      email: email.trim() || null,
      company: company.trim() || null,
      role: role.trim() || null,
    };
    if (person) update.mutate({ id: person.id, patch: input }, { onSuccess: onClose });
    else create.mutate(input, { onSuccess: onClose });
  };

  return (
    <Modal open={open} onClose={onClose} width={448} zIndex={80} ariaLabel={person ? 'Edit person' : 'Add person'}>
      <div className={styles.wrap}>
        <div className={styles.head}>
          <span className={styles.title}>{person ? 'Edit person' : 'Add person'}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.fieldBlock}>
          <div className={styles.label}>Name</div>
          <Input
            className={styles.nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            aria-label="Full name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>

        <div className={styles.selectRow}>
          <div>
            <div className={styles.label}>Category</div>
            <select
              className={styles.select}
              value={category}
              onChange={(e) => setCategory(e.target.value as PersonCategory)}
              aria-label="Category"
            >
              {PERSON_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className={styles.label}>Function</div>
            <select
              className={styles.select}
              value={func}
              onChange={(e) => setFunc(e.target.value as PersonFunction)}
              aria-label="Function"
            >
              {PERSON_FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.fieldBlock}>
          <div className={styles.label}>
            Contact <span className={styles.labelHint}>optional</span>
          </div>
          <div className={styles.suggestWrap}>
            <Input
              className={styles.contactInput}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => window.setTimeout(() => setEmailFocused(false), 150)}
              onKeyDown={onEmailKey}
              placeholder="Email — type a name to search your contacts"
              aria-label="Email"
              autoComplete="off"
              role="combobox"
              aria-expanded={dropdownOpen}
            />
            {dropdownOpen && (
              <div className={styles.suggestDrop} role="listbox">
                {suggestions.map((s, i) => (
                  <button
                    key={s.email}
                    type="button"
                    className={styles.suggestRow}
                    data-active={i === highlight ? 'true' : undefined}
                    role="option"
                    aria-selected={i === highlight}
                    onMouseDown={(e) => {
                      // Fires before the input's blur — the click always lands.
                      e.preventDefault();
                      pickSuggestion(s);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                  >
                    <span className={styles.suggestName}>{s.name}</span>
                    <span className={styles.suggestEmail}>{s.email}</span>
                    {(s.role || s.company) && (
                      <span className={styles.suggestOrg}>{[s.role, s.company].filter(Boolean).join(' · ')}</span>
                    )}
                  </button>
                ))}
                <div className={styles.suggestFoot}>Google Contacts · picking fills company &amp; role</div>
              </div>
            )}
          </div>
          <div className={styles.contactRow}>
            <Input
              className={styles.contactInput}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Company"
              aria-label="Company"
            />
            <Input
              className={styles.contactInput}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Role"
              aria-label="Role"
            />
          </div>
        </div>

        <div className={styles.fieldBlock}>
          <div className={styles.label}>Location</div>
          <div className={`${styles.chipRow} ${styles.chipRowWrap}`}>
            {knownLocations.map((loc) => (
              <button
                key={loc}
                type="button"
                className={styles.chip}
                style={chipStyle(location === loc, locationColor(loc))}
                aria-pressed={location === loc}
                onClick={() => setLocation(loc)}
              >
                {loc}
              </button>
            ))}
            {addingLoc ? (
              <input
                className={styles.newLocInput}
                value={newLoc}
                onChange={(e) => setNewLoc(e.target.value.toUpperCase())}
                onKeyDown={onNewLocKey}
                onBlur={commitNewLoc}
                placeholder="Code"
                maxLength={12}
                autoFocus
                aria-label="New location code"
              />
            ) : (
              <button
                type="button"
                className={`${styles.chip} ${styles.newLocChip}`}
                onClick={() => setAddingLoc(true)}
                title="Add a new location code (e.g. HYD)"
              >
                + New
              </button>
            )}
          </div>
        </div>

        <div className={styles.daysBlock}>
          <div className={styles.daysHead}>
            <span className={styles.labelBare}>Engagement days</span>
            <span className={styles.cadence}>{freqLabel(days.length)}</span>
          </div>
          <div className={styles.chipRow}>
            {DAY_META.map((d, i) => {
              const on = days.includes(i + 1);
              return (
                <button
                  key={d.name}
                  type="button"
                  className={styles.chip}
                  style={chipStyle(on, d.color)}
                  aria-pressed={on}
                  onClick={() => toggleDay(i + 1)}
                >
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>

        {err && <div className={styles.error}>{err.message || 'Something went wrong.'}</div>}

        <div className={styles.foot}>
          {person && (
            <button
              type="button"
              className={styles.removeBtn}
              disabled={pending}
              onClick={() => remove.mutate(person.id, { onSuccess: onClose })}
            >
              Remove person
            </button>
          )}
          <div className={styles.spacer} />
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.saveBtn} disabled={!canSave || pending} onClick={submit}>
            {person ? 'Save changes' : 'Add person'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
