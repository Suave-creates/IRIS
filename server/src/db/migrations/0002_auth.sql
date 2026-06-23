-- ──────────────────────────────────────────────────────────────────────────
-- 0002_auth — Tenant domain routing + per-user settings
-- ──────────────────────────────────────────────────────────────────────────

-- Tenants are resolved by the email domain of the first SSO user.
ALTER TABLE tenants
  ADD COLUMN primary_domain VARCHAR(255) NULL AFTER name,
  ADD UNIQUE KEY uq_tenants_domain (primary_domain);

-- User-level preferences (Settings view). One row per user.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id             VARCHAR(40) NOT NULL PRIMARY KEY,
  tenant_id           VARCHAR(40) NOT NULL,
  continuous_learning TINYINT(1)  NOT NULL DEFAULT 1,
  auto_save_memory    TINYINT(1)  NOT NULL DEFAULT 0,
  retention_months    INT         NOT NULL DEFAULT 24,
  approve_email       TINYINT(1)  NOT NULL DEFAULT 1,
  approve_calendar    TINYINT(1)  NOT NULL DEFAULT 1,
  approve_delete      TINYINT(1)  NOT NULL DEFAULT 1,
  voice_replies       TINYINT(1)  NOT NULL DEFAULT 0,
  voice               VARCHAR(60) NOT NULL DEFAULT 'Calm · Neutral',
  updated_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  KEY idx_user_settings_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
