import { all, first, run } from '../db.js';

export async function listSummons(env, chat, ownerId = null) {
  if (ownerId == null) return all(env.DB, 'SELECT * FROM summons WHERE chat_id=? AND active=1 ORDER BY id', chat);
  return all(env.DB, 'SELECT * FROM summons WHERE chat_id=? AND owner_id=? AND active=1 ORDER BY id', chat, ownerId);
}

export async function createSummon(env, { chat, ownerId, key, type, hp = 0, data = {} }) {
  if (type === 'eternal') {
    const current = await first(env.DB,
      "SELECT COUNT(*) AS n FROM summons WHERE chat_id=? AND owner_id=? AND active=1 AND summon_type='eternal'",
      chat, ownerId
    );
    if ((current?.n || 0) >= 2) throw new Error('حداکثر دو سامن ابدی می‌توان فعال کرد.');
  }
  await run(env.DB,
    'INSERT INTO summons (chat_id, owner_id, summon_key, summon_type, hp, max_hp, active, data_json) VALUES (?,?,?,?,?,?,1,?)',
    chat, ownerId, key, type, Math.max(0, hp), Math.max(0, hp), JSON.stringify(data)
  );
}

export async function damageSummon(env, chat, summonId, damage) {
  await run(env.DB,
    'UPDATE summons SET hp=MAX(0,hp-?), active=CASE WHEN hp-?>0 THEN active ELSE 0 END WHERE chat_id=? AND id=? AND active=1',
    Math.max(0, Math.floor(damage)), Math.max(0, Math.floor(damage)), chat, summonId
  );
  return first(env.DB, 'SELECT * FROM summons WHERE chat_id=? AND id=?', chat, summonId);
}

export async function sacrificeCountSummon(env, chat, ownerId, summonId) {
  const row = await first(env.DB,
    "SELECT * FROM summons WHERE chat_id=? AND owner_id=? AND id=? AND active=1 AND summon_type='count'",
    chat, ownerId, summonId
  );
  if (!row) return null;
  await run(env.DB, 'UPDATE summons SET active=0,hp=0 WHERE id=?', summonId);
  return { sacrificed: row, defended: 25 };
}
