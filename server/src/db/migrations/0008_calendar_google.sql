-- ──────────────────────────────────────────────────────────────────────────
-- 0008_calendar_google — store the full Google Calendar event id for two-way sync
-- ──────────────────────────────────────────────────────────────────────────

-- The row PK is truncated to 40 chars (evtg_<id>); Google event ids can be longer,
-- so keep the full id here for events.patch / events.delete against Google.
ALTER TABLE calendar_events
  ADD COLUMN google_event_id VARCHAR(1024) NULL AFTER source;
