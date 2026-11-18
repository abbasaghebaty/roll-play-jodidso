-- Add an idempotency ledger without changing or deleting existing game data.
CREATE TABLE IF NOT EXISTS combat_actions (
  operation_id TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_combat_actions_chat_created ON combat_actions (chat_id, created_at);
