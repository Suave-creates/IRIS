-- ──────────────────────────────────────────────────────────────────────────
-- 0014_mail_mentions — flag mail where the mailbox owner is tagged in the BODY
-- Set at sync time (their email / name / @handle appears in the message body),
-- so the Mail view can filter to "where I'm tagged" without storing the body.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE mail_items
  ADD COLUMN mentions_me TINYINT(1) NOT NULL DEFAULT 0 AFTER tags;

CREATE INDEX idx_mail_tenant_mentions ON mail_items (tenant_id, mentions_me);
