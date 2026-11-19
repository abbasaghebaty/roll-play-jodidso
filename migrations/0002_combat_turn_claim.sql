-- Hold a single active combat action per chat until the turn is resolved.
ALTER TABLE combat_actions ADD COLUMN turn_claim INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_combat_actions_active_turn
  ON combat_actions (chat_id) WHERE turn_claim=1;
