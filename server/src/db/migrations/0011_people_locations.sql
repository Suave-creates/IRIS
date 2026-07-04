-- ──────────────────────────────────────────────────────────────────────────
-- 0011_people_locations — locations become user-extensible site codes
-- (GGN/BWD/HYD/… — any 2–12 char code, stored uppercase), replacing the
-- fixed two-value ENUM.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE people
  MODIFY COLUMN location VARCHAR(12) NOT NULL DEFAULT 'BWD';
