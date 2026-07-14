-- ──────────────────────────────────────────────────────────────────────────
-- 0017_planner_span — multi-day planner blocks
-- A block covers `span` consecutive days starting at block_date (1 = single day),
-- so it can be resized to stretch across the week.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE planner_blocks
  ADD COLUMN span INT NOT NULL DEFAULT 1 AFTER full_day;
