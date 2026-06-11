-- 0002_chat_log_latency.sql — AC-5 needs `latency_ms` in chat_log to time
-- every successful LLM call. AC-2's baseline didn't include it; this
-- migration adds the column non-destructively. The DEFAULT 0 keeps
-- existing rows valid and lets the new llm.service write the field
-- without further migrations.

ALTER TABLE chat_log ADD COLUMN latency_ms INTEGER NOT NULL DEFAULT 0;
