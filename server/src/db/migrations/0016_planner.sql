-- ──────────────────────────────────────────────────────────────────────────
-- 0016_planner — per-user macro planner blocks anchored to real dates
-- Day / Week (default) / Month views read a date range; a full-day block
-- renders stretched.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS planner_blocks (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  user_id    VARCHAR(40)  NOT NULL,
  block_date DATE         NOT NULL,
  title      VARCHAR(255) NOT NULL,
  full_day   TINYINT(1)   NOT NULL DEFAULT 0,
  color      VARCHAR(20)  NOT NULL DEFAULT 'neutral',
  notes      TEXT         NULL,
  position   INT          NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_planner_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_planner_user_date (tenant_id, user_id, block_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
