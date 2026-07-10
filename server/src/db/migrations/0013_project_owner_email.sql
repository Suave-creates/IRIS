-- ──────────────────────────────────────────────────────────────────────────
-- 0013_project_owner_email — link project stakeholders to People by email
-- AI extraction and manual edits can now capture the stakeholder's email
-- (when the source actually states one); person matching prefers this over
-- the freeform owner name.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN owner_email VARCHAR(255) NULL AFTER owner;
