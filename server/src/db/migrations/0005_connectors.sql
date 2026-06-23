-- ──────────────────────────────────────────────────────────────────────────
-- 0005_connectors — Encrypted token vault, sync run history, durable job queue
-- ──────────────────────────────────────────────────────────────────────────

-- OAuth tokens for connectors. access_token/refresh_token are AES-256-GCM
-- encrypted at the application layer (never stored or returned in plaintext).
CREATE TABLE IF NOT EXISTS connector_tokens (
  id            VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id     VARCHAR(40)  NOT NULL,
  provider      ENUM('gmail','gcalendar','gdrive','gsheets','slack','notion','github','jira') NOT NULL,
  access_token  TEXT         NOT NULL,
  refresh_token TEXT         NULL,
  scopes        TEXT         NULL,
  expires_at    TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ctok_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE KEY uq_ctok_tenant_provider (tenant_id, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per connector sync attempt (monitoring + idempotency audit).
CREATE TABLE IF NOT EXISTS sync_runs (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id   VARCHAR(40)  NOT NULL,
  provider    VARCHAR(40)  NOT NULL,
  status      ENUM('running','success','error') NOT NULL DEFAULT 'running',
  stats       JSON         NULL,
  error       VARCHAR(500) NULL,
  started_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP    NULL,
  CONSTRAINT fk_srun_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_srun_tenant_time (tenant_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Durable background-job queue (connector sync, token refresh, health, retries).
CREATE TABLE IF NOT EXISTS jobs (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NULL,
  type       VARCHAR(60)  NOT NULL,
  payload    JSON         NULL,
  status     ENUM('pending','running','done','failed') NOT NULL DEFAULT 'pending',
  attempts   INT          NOT NULL DEFAULT 0,
  max_attempts INT        NOT NULL DEFAULT 5,
  run_after  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_jobs_claim (status, run_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
