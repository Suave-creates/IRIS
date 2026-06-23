-- ──────────────────────────────────────────────────────────────────────────
-- 0003_domain — Core domain model
-- Projects, journal, calendar, mail, memory + knowledge graph, connectors,
-- notifications, AI actions (approval gate), risks, priorities.
-- Every table is tenant-scoped; isolation is enforced in the repository layer.
-- ──────────────────────────────────────────────────────────────────────────

-- ── Projects ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id            VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id     VARCHAR(40)  NOT NULL,
  name          VARCHAR(200) NOT NULL,
  source        ENUM('manual','calendar','journal','conversation','sheet','doc','folder') NOT NULL DEFAULT 'manual',
  priority      ENUM('critical','high','med','low') NOT NULL DEFAULT 'med',
  status        VARCHAR(40)  NOT NULL DEFAULT 'New',
  deadline      DATE         NULL,
  progress      INT          NOT NULL DEFAULT 0,
  owner         VARCHAR(160) NOT NULL DEFAULT 'You',
  auto          TINYINT(1)   NOT NULL DEFAULT 0,
  summary       TEXT         NULL,
  source_detail VARCHAR(255) NULL,
  stages        JSON         NULL,              -- ordered stage names
  current_stage INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_projects_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_projects_tenant (tenant_id),
  KEY idx_projects_tenant_priority (tenant_id, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_fields (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  project_id VARCHAR(40)  NOT NULL,
  label      VARCHAR(80)  NOT NULL,
  value      VARCHAR(200) NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  CONSTRAINT fk_pfields_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  KEY idx_pfields_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_tasks (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  project_id VARCHAR(40)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  done       TINYINT(1)   NOT NULL DEFAULT 0,
  position   INT          NOT NULL DEFAULT 0,
  CONSTRAINT fk_ptasks_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  KEY idx_ptasks_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_files (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  project_id VARCHAR(40)  NOT NULL,
  name       VARCHAR(200) NOT NULL,
  kind       VARCHAR(40)  NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  CONSTRAINT fk_pfiles_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  KEY idx_pfiles_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_activity (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  project_id VARCHAR(40)  NOT NULL,
  who        VARCHAR(120) NOT NULL,
  act        VARCHAR(255) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pactivity_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  KEY idx_pactivity_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_sources (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  type       ENUM('folder','sheet','doc') NOT NULL,
  name       VARCHAR(200) NOT NULL,
  meta       VARCHAR(200) NULL,
  status     ENUM('linked','scanning','scanned') NOT NULL DEFAULT 'linked',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_psources_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_psources_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Journal tasks ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_tasks (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  user_id    VARCHAR(40)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  due_date   DATE         NOT NULL,
  due_time   VARCHAR(8)   NULL,
  priority   ENUM('high','med','low') NOT NULL DEFAULT 'med',
  done       TINYINT(1)   NOT NULL DEFAULT 0,
  detail     TEXT         NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_jtasks_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_jtasks_tenant_date (tenant_id, due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Calendar events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  user_id    VARCHAR(40)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  start_at   DATETIME     NOT NULL,
  end_at     DATETIME     NOT NULL,
  color      CHAR(7)      NOT NULL DEFAULT '#4b49d6',
  location   VARCHAR(160) NULL,
  notes      TEXT         NULL,
  attendees  INT          NOT NULL DEFAULT 0,
  source     VARCHAR(40)  NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cal_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_cal_tenant_start (tenant_id, start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Mail intelligence items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mail_items (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id   VARCHAR(40)  NOT NULL,
  from_name   VARCHAR(160) NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  summary     TEXT         NULL,
  category    VARCHAR(40)  NOT NULL DEFAULT 'fyi',
  priority    ENUM('high','med','low') NOT NULL DEFAULT 'low',
  received_at DATE         NOT NULL,
  tags        JSON         NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mail_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_mail_tenant_cat (tenant_id, category),
  KEY idx_mail_tenant_date (tenant_id, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Memory + knowledge graph ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  type       ENUM('preference','fact','contact','project','correction') NOT NULL DEFAULT 'fact',
  content    VARCHAR(500) NOT NULL,
  source     VARCHAR(200) NULL,
  confidence INT          NULL,
  scope      ENUM('short','long') NOT NULL DEFAULT 'long',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mem_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_mem_tenant_type (tenant_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  label      VARCHAR(120) NOT NULL,
  kind       VARCHAR(40)  NOT NULL DEFAULT 'entity',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_knode_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_knode_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  from_node  VARCHAR(40)  NOT NULL,
  to_node    VARCHAR(40)  NOT NULL,
  relation   VARCHAR(80)  NULL,
  CONSTRAINT fk_kedge_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  CONSTRAINT fk_kedge_from FOREIGN KEY (from_node) REFERENCES knowledge_nodes (id) ON DELETE CASCADE,
  CONSTRAINT fk_kedge_to FOREIGN KEY (to_node) REFERENCES knowledge_nodes (id) ON DELETE CASCADE,
  KEY idx_kedge_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Connectors ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connectors (
  id             VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id      VARCHAR(40)  NOT NULL,
  provider       ENUM('gmail','gcalendar','gdrive','gsheets','slack','notion','github','jira') NOT NULL,
  display_name   VARCHAR(80)  NOT NULL,
  group_label    VARCHAR(80)  NOT NULL DEFAULT 'Workspace',
  status         ENUM('connected','degraded','expiring','disconnected','error') NOT NULL DEFAULT 'disconnected',
  capabilities   VARCHAR(200) NULL,
  last_synced_at TIMESTAMP    NULL,
  note           VARCHAR(200) NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_conn_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE KEY uq_conn_tenant_provider (tenant_id, provider),
  KEY idx_conn_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Notifications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  user_id    VARCHAR(40)  NOT NULL,
  title      VARCHAR(160) NOT NULL,
  body       VARCHAR(255) NULL,
  dot_color  CHAR(7)      NOT NULL DEFAULT '#4b49d6',
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_notif_user (user_id, is_read),
  KEY idx_notif_tenant_time (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── AI actions (the approval gate) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS actions (
  id              VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id       VARCHAR(40)  NOT NULL,
  user_id         VARCHAR(40)  NOT NULL,
  conversation_id VARCHAR(40)  NULL,
  kind            VARCHAR(60)  NOT NULL,
  target          VARCHAR(60)  NOT NULL,
  title           VARCHAR(255) NOT NULL,
  detail          TEXT         NULL,
  payload         JSON         NULL,
  status          ENUM('pending','approved','rejected','executed','failed') NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at      TIMESTAMP    NULL,
  CONSTRAINT fk_actions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_actions_tenant_status (tenant_id, status),
  KEY idx_actions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Risks (dashboard "Risks IRIS is watching") ────────────────────────────
CREATE TABLE IF NOT EXISTS risks (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  title      VARCHAR(200) NOT NULL,
  detail     VARCHAR(255) NULL,
  severity   ENUM('high','med','low') NOT NULL DEFAULT 'med',
  position   INT          NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_risks_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_risks_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Priorities (dashboard "Today's priorities, ranked by IRIS") ───────────
CREATE TABLE IF NOT EXISTS priorities (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  user_id    VARCHAR(40)  NOT NULL,
  rank       INT          NOT NULL DEFAULT 0,
  title      VARCHAR(255) NOT NULL,
  detail     VARCHAR(255) NULL,
  tag        VARCHAR(40)  NULL,
  tag_tone   ENUM('danger','warn','neutral','accent','info','success') NOT NULL DEFAULT 'neutral',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prio_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_prio_tenant_rank (tenant_id, rank)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
