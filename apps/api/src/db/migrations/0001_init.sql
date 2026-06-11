-- 0001_init.sql — baseline schema for the CyOpsArenaCookbook backend.
-- Tables: credit_ledger, chat_log, vote_snapshot, prompt_draft.
-- A `meta` table tracks which migrations have run.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  balance    INTEGER NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT    NOT NULL,
  ref        TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_created_at
  ON credit_ledger (created_at);

CREATE TABLE IF NOT EXISTS chat_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('user','assistant','system')),
  content     TEXT    NOT NULL,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_log_session
  ON chat_log (session_id, id);

CREATE TABLE IF NOT EXISTS vote_snapshot (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  votes       INTEGER NOT NULL,
  raw_json    TEXT    NOT NULL,
  observed_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vote_snapshot_observed_at
  ON vote_snapshot (observed_at);

CREATE TABLE IF NOT EXISTS prompt_draft (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  track        TEXT,
  answers_json TEXT    NOT NULL,
  prompt       TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_draft_created_at
  ON prompt_draft (created_at);
