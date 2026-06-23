-- ──────────────────────────────────────────────────────────────────────────
-- 0004_chat — Conversations + messages for Ask IRIS
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  user_id    VARCHAR(40)  NOT NULL,
  title      VARCHAR(200) NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_conv_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_conv_user (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              VARCHAR(40) NOT NULL PRIMARY KEY,
  conversation_id VARCHAR(40) NOT NULL,
  tenant_id       VARCHAR(40) NOT NULL,
  role            ENUM('user','iris') NOT NULL,
  content         MEDIUMTEXT  NOT NULL,
  has_actions     TINYINT(1)  NOT NULL DEFAULT 0,
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cmsg_conv FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  KEY idx_cmsg_conv (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
