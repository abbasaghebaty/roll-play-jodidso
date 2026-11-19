-- Character selection sessions and per-user private requests.
-- Apply once to the existing D1 database. Existing game rows and player data are preserved.
ALTER TABLE games ADD COLUMN session_id TEXT;
ALTER TABLE games ADD COLUMN selection_token_hash TEXT;

-- Existing rows receive an opaque legacy session id, but no usable selection hash.
-- A fresh /newgame creates a new authenticated session and a new lobby link.
UPDATE games
SET session_id = lower(hex(randomblob(16)))
WHERE session_id IS NULL;

CREATE UNIQUE INDEX idx_games_session_id
ON games(session_id)
WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS character_selection_requests (
  request_id TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  private_chat_id INTEGER NOT NULL,
  user_name TEXT NOT NULL DEFAULT 'بازیکن',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  search_query TEXT NOT NULL DEFAULT '',
  selected_char_key TEXT,
  prompt_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_selection_requests_owner
ON character_selection_requests(private_chat_id, user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_selection_requests_session
ON character_selection_requests(chat_id, session_id, status);
