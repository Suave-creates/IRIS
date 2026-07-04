-- ──────────────────────────────────────────────────────────────────────────
-- 0010_people_meetings — People & Context + Meeting Intelligence
-- Weekly-engagement roster, recorded meetings (transcripts / actions /
-- decisions), and the engagement events that link processed meetings back
-- to each participant's living context.
-- ──────────────────────────────────────────────────────────────────────────

-- ── People ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS people (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(40)  NOT NULL,
  name       VARCHAR(160) NOT NULL,
  category   ENUM('Direct','Direct-1','Direct-2','Indirect','Agent','Support') NOT NULL DEFAULT 'Direct',
  func       VARCHAR(40)  NOT NULL,
  location   ENUM('GGN','BWD') NOT NULL DEFAULT 'BWD',
  days       JSON         NOT NULL,            -- engagement weekdays, 1=Mon … 6=Sat
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_people_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_people_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Meetings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id            VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id     VARCHAR(40)  NOT NULL,
  title         VARCHAR(255) NOT NULL,
  mode          ENUM('online','inroom') NOT NULL DEFAULT 'inroom',
  started_at    DATETIME     NOT NULL,
  duration_secs INT          NOT NULL DEFAULT 0,
  sentiment     ENUM('Positive','Mixed','Neutral') NOT NULL DEFAULT 'Neutral',
  summary       TEXT         NULL,
  topics        JSON         NULL,             -- string[]
  participants  JSON         NULL,             -- speaker display names, includes "You"
  risks         JSON         NULL,             -- string[]
  followups     JSON         NULL,             -- string[]
  ctx_updates   JSON         NULL,             -- [{who, change, delta}] for the Context updates tab
  link_note     VARCHAR(255) NULL,             -- "WH Automation, PdM program"
  source        VARCHAR(20)  NOT NULL DEFAULT 'seed',   -- 'seed' | 'recorder'
  demo_key      VARCHAR(40)  NULL,             -- natural key of the scripted demo recording (re-record replaces)
  status        VARCHAR(20)  NOT NULL DEFAULT 'processed',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_meetings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE KEY uq_meetings_tenant_demo (tenant_id, demo_key),
  KEY idx_meetings_tenant_start (tenant_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  meeting_id VARCHAR(40)  NOT NULL,
  ts_secs    INT          NOT NULL DEFAULT 0,
  speaker    VARCHAR(80)  NOT NULL,
  text       TEXT         NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  CONSTRAINT fk_mtr_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
  KEY idx_mtr_meeting (meeting_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meeting_actions (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  meeting_id VARCHAR(40)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  owner      VARCHAR(80)  NULL,
  due_date   DATE         NULL,
  done       TINYINT(1)   NOT NULL DEFAULT 0,
  position   INT          NOT NULL DEFAULT 0,
  CONSTRAINT fk_mact_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
  KEY idx_mact_meeting (meeting_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meeting_decisions (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  meeting_id VARCHAR(40)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  CONSTRAINT fk_mdec_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
  KEY idx_mdec_meeting (meeting_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Engagement events (meetings → people) ─────────────────────────────────
-- One row per (person, meeting): reprocessing the same meeting upserts
-- instead of stacking. Drives the +N score boost, Rising trend, "Today"
-- last-interaction and the accent Meeting dot in the drawer calendar.
CREATE TABLE IF NOT EXISTS engagement_events (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id   VARCHAR(40)  NOT NULL,
  person_id   VARCHAR(40)  NOT NULL,
  meeting_id  VARCHAR(40)  NOT NULL,
  delta       INT          NOT NULL DEFAULT 2,
  occurred_on DATE         NOT NULL,
  title       VARCHAR(255) NOT NULL,           -- boosting meeting title (drawer banner copy)
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_engev_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  CONSTRAINT fk_engev_person FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE,
  CONSTRAINT fk_engev_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
  UNIQUE KEY uq_engev_person_meeting (person_id, meeting_id),
  KEY idx_engev_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
