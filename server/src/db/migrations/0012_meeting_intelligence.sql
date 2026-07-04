-- ──────────────────────────────────────────────────────────────────────────
-- 0012_meeting_intelligence — premium meeting pipeline
-- People gain contact identity (email/company/role) for attendee linking;
-- meetings gain extracted artifacts (docs/repos/tickets/links), carry-over
-- items from previous meetings, and the STT engine that produced the
-- transcript (whisper-large-v3 vs browser fallback).
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE people
  ADD COLUMN email   VARCHAR(255) NULL AFTER location,
  ADD COLUMN company VARCHAR(160) NULL AFTER email,
  ADD COLUMN role    VARCHAR(160) NULL AFTER company;

ALTER TABLE meetings
  ADD COLUMN artifacts  JSON        NULL AFTER ctx_updates,
  ADD COLUMN carryovers JSON        NULL AFTER artifacts,
  ADD COLUMN stt_engine VARCHAR(40) NULL AFTER source;
