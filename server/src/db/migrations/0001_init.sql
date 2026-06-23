-- ──────────────────────────────────────────────────────────────────────────
-- 0001_init — Multi-tenant SaaS foundation
-- Tenants, users, sessions, and the audit trail. Every domain table created in
-- later milestones carries a tenant_id and is scoped at the repository layer
-- (MySQL has no row-level security, so isolation is enforced in application code).
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id           VARCHAR(40)  NOT NULL PRIMARY KEY,
  name         VARCHAR(160) NOT NULL,
  accent_color CHAR(7)      NOT NULL DEFAULT '#4b49d6',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id     VARCHAR(40)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(160) NOT NULL,
  title         VARCHAR(120) NULL,
  avatar_url    VARCHAR(512) NULL,
  role          ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
  status        ENUM('active','invited','dormant','disabled') NOT NULL DEFAULT 'active',
  -- Auth providers (modular): Google SSO subject and/or local password hash.
  google_sub    VARCHAR(255) NULL,
  password_hash VARCHAR(255) NULL,
  last_login_at TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  UNIQUE KEY uq_users_google_sub (google_sub),
  KEY idx_users_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  user_id     VARCHAR(40)  NOT NULL,
  tenant_id   VARCHAR(40)  NOT NULL,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(512) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP    NOT NULL,
  revoked_at  TIMESTAMP    NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only, searchable audit trail (auth, approvals, connector events, admin actions).
CREATE TABLE IF NOT EXISTS audit_log (
  id            VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id     VARCHAR(40)  NULL,
  actor_user_id VARCHAR(40)  NULL,
  action        VARCHAR(120) NOT NULL,
  target_type   VARCHAR(80)  NULL,
  target_id     VARCHAR(120) NULL,
  metadata      JSON         NULL,
  ip            VARCHAR(64)  NULL,
  log_ref       VARCHAR(40)  NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_tenant_time (tenant_id, created_at),
  KEY idx_audit_action (action),
  KEY idx_audit_actor (actor_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
