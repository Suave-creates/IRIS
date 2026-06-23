-- ──────────────────────────────────────────────────────────────────────────
-- 0006_projects_sources — Real connector-backed sources + AI-extracted cards
-- ──────────────────────────────────────────────────────────────────────────

-- Link a project source to a real connector item (e.g. a Google Drive file id).
ALTER TABLE project_sources
  ADD COLUMN external_id VARCHAR(255) NULL AFTER meta,
  ADD COLUMN web_link    VARCHAR(512) NULL AFTER external_id;

-- Link an AI-extracted project back to the source it came from, so re-fetching
-- refreshes that card instead of duplicating it.
ALTER TABLE projects
  ADD COLUMN source_ref VARCHAR(255) NULL AFTER source_detail,
  ADD KEY idx_projects_source_ref (tenant_id, source_ref);
