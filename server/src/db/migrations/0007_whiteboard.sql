-- ──────────────────────────────────────────────────────────────────────────
-- 0007_whiteboard — Smart Whiteboard: persisted canvas windows per user
-- ──────────────────────────────────────────────────────────────────────────

-- Each row is one window on a user's canvas: a connector-backed file
-- (external_id set) or an AI-generated insight (kind='insight', body set).
CREATE TABLE whiteboard_items (
  id           VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id    VARCHAR(40)  NOT NULL,
  user_id      VARCHAR(40)  NOT NULL,
  kind         VARCHAR(16)  NOT NULL,
  title        VARCHAR(255) NOT NULL,
  external_id  VARCHAR(255) NULL,
  web_link     VARCHAR(512) NULL,
  x            INT          NOT NULL DEFAULT 40,
  y            INT          NOT NULL DEFAULT 40,
  w            INT          NOT NULL DEFAULT 300,
  h            INT          NOT NULL DEFAULT 220,
  z            INT          NOT NULL DEFAULT 1,
  ai_included  TINYINT(1)   NOT NULL DEFAULT 1,
  body         MEDIUMTEXT   NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_wb_user (tenant_id, user_id, z)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
