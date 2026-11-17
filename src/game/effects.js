import { all, first, run } from '../db.js';

export async function getEffects(env, chat, targetId, type = null) {
  return type
    ? all(env.DB, 'SELECT * FROM game_effects WHERE chat_id=? AND target_id=? AND effect_type=? ORDER BY id', chat, targetId, type)
    : all(env.DB, 'SELECT * FROM game_effects WHERE chat_id=? AND target_id=? ORDER BY id', chat, targetId);
}

export async function getEffect(env, chat, targetId, type) {
  return first(env.DB, 'SELECT * FROM game_effects WHERE chat_id=? AND target_id=? AND effect_type=? ORDER BY id DESC LIMIT 1', chat, targetId, type);
}

export async function setEffect(env, { chat, ownerId = 0, targetId, type, rounds = 0, stacks = 1, data = {} }) {
  await run(env.DB,
    'DELETE FROM game_effects WHERE chat_id=? AND target_id=? AND effect_type=?',
    chat, targetId, type
  );
  await run(env.DB,
    'INSERT INTO game_effects (chat_id, owner_id, target_id, effect_type, rounds_left, stacks, data_json) VALUES (?,?,?,?,?,?,?)',
    chat, ownerId, targetId, type, Math.max(0, Math.floor(rounds)), Math.max(1, Math.floor(stacks)), JSON.stringify(data)
  );
}

export async function removeEffect(env, chat, targetId, type) {
  await run(env.DB, 'DELETE FROM game_effects WHERE chat_id=? AND target_id=? AND effect_type=?', chat, targetId, type);
}

export async function tickEffects(env, chat, targetId) {
  const rows = await getEffects(env, chat, targetId);
  for (const effect of rows) {
    if (effect.rounds_left <= 0) continue;
    if (effect.rounds_left === 1) {
      await run(env.DB, 'DELETE FROM game_effects WHERE id=?', effect.id);
      if (effect.effect_type === 'domain') {
        await setEffect(env, {
          chat, ownerId: effect.owner_id, targetId,
          type: 'domain_exhausted', rounds: 1,
          data: { blocksDeathRankAttacks: true, blocksAdvancedDefenses: true }
        });
      }
    } else {
      await run(env.DB, 'UPDATE game_effects SET rounds_left=rounds_left-1 WHERE id=?', effect.id);
    }
  }
}

export async function getRound(env, chat) {
  const row = await first(env.DB, 'SELECT round_no FROM game_round_state WHERE chat_id=?', chat);
  return row?.round_no || 1;
}

export async function advanceRound(env, chat) {
  await run(env.DB,
    'INSERT INTO game_round_state (chat_id, round_no) VALUES (?,2) ON CONFLICT(chat_id) DO UPDATE SET round_no=round_no+1',
    chat
  );
  return getRound(env, chat);
}
