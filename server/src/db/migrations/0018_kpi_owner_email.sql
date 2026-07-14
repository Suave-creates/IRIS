-- ──────────────────────────────────────────────────────────────────────────
-- 0018_kpi_owner_email — link KPI stakeholders to People by email
-- Mirrors projects.owner_email: captured silently from a stakeholder person-chip
-- in the source sheet, used to surface a person's KPIs in the People drawer.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE kpis
  ADD COLUMN owner_email VARCHAR(255) NULL AFTER owner;
