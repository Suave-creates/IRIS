-- ──────────────────────────────────────────────────────────────────────────
-- 0009_chat_insights — store an optional visual artifact (infographic) per reply
-- ──────────────────────────────────────────────────────────────────────────

-- JSON-encoded WhiteboardInsight ({title, blocks}) attached to an assistant reply,
-- so charts/KPI cards/tables survive a conversation reload alongside the text.
ALTER TABLE conversation_messages
  ADD COLUMN artifact_body MEDIUMTEXT NULL AFTER has_actions;
