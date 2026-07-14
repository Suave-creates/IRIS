-- ──────────────────────────────────────────────────────────────────────────
-- 0015_kpis — KPI module (mirrors Projects, modeled as a metric)
-- A KPI is an actual value measured against a target, with a unit, review
-- period, and trend. Linked sources + AI extraction reuse the Projects pattern.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kpis (
  id            VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id     VARCHAR(40)  NOT NULL,
  name          VARCHAR(200) NOT NULL,
  source        ENUM('manual','calendar','journal','conversation','sheet','doc','folder') NOT NULL DEFAULT 'manual',
  priority      ENUM('critical','high','med','low') NOT NULL DEFAULT 'med',
  status        VARCHAR(40)  NOT NULL DEFAULT 'No data',
  owner         VARCHAR(160) NOT NULL DEFAULT 'You',
  auto          TINYINT(1)   NOT NULL DEFAULT 0,
  summary       TEXT         NULL,
  source_detail VARCHAR(255) NULL,
  source_ref    VARCHAR(255) NULL,
  unit          VARCHAR(40)  NULL,
  target        VARCHAR(80)  NULL,
  actual        VARCHAR(80)  NULL,
  trend         ENUM('up','down','flat') NOT NULL DEFAULT 'flat',
  period        VARCHAR(60)  NULL,
  attainment    INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_kpis_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_kpis_tenant (tenant_id),
  KEY idx_kpis_tenant_priority (tenant_id, priority),
  KEY idx_kpis_source_ref (tenant_id, source_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_fields (
  id       VARCHAR(40)  NOT NULL PRIMARY KEY,
  kpi_id   VARCHAR(40)  NOT NULL,
  label    VARCHAR(80)  NOT NULL,
  value    VARCHAR(200) NOT NULL,
  position INT          NOT NULL DEFAULT 0,
  CONSTRAINT fk_kfields_kpi FOREIGN KEY (kpi_id) REFERENCES kpis (id) ON DELETE CASCADE,
  KEY idx_kfields_kpi (kpi_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_initiatives (
  id       VARCHAR(40)  NOT NULL PRIMARY KEY,
  kpi_id   VARCHAR(40)  NOT NULL,
  title    VARCHAR(255) NOT NULL,
  done     TINYINT(1)   NOT NULL DEFAULT 0,
  position INT          NOT NULL DEFAULT 0,
  CONSTRAINT fk_kinit_kpi FOREIGN KEY (kpi_id) REFERENCES kpis (id) ON DELETE CASCADE,
  KEY idx_kinit_kpi (kpi_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_activity (
  id         VARCHAR(40)  NOT NULL PRIMARY KEY,
  kpi_id     VARCHAR(40)  NOT NULL,
  who        VARCHAR(120) NOT NULL,
  act        VARCHAR(255) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_kactivity_kpi FOREIGN KEY (kpi_id) REFERENCES kpis (id) ON DELETE CASCADE,
  KEY idx_kactivity_kpi (kpi_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_sources (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  tenant_id   VARCHAR(40)  NOT NULL,
  type        ENUM('folder','sheet','doc') NOT NULL,
  name        VARCHAR(200) NOT NULL,
  meta        VARCHAR(200) NULL,
  external_id VARCHAR(255) NULL,
  web_link    VARCHAR(512) NULL,
  status      ENUM('linked','scanning','scanned') NOT NULL DEFAULT 'linked',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ksources_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  KEY idx_ksources_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
