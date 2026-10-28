import { all, first, run } from '../db.js';

export async function getGame(env, chat) {
  return await first(env.DB, 'SELECT * FROM games WHERE chat_id=?', chat);
}

export async function getPlayer(env, chat, uid) {
  return await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=?', chat, uid);
}

export async function alivePlayers(env, chat) {
  return await all(env.DB, 'SELECT * FROM players WHERE chat_id=? AND alive=1 ORDER BY seat', chat);
}

// اگر فقط یک نفر یا یک تیم زنده مانده باشد، بازی تمام می‌شود و زنده‌ها برگردانده می‌شوند
export async function checkWin(env, chat) {
  const alive = await alivePlayers(env, chat);
  const groups = new Set(alive.map((p) => p.team || 'u' + p.user_id));
  if (groups.size <= 1) {
    await run(env.DB, "UPDATE games SET status='ended' WHERE chat_id=?", chat);
    return alive;
  }
  return null;
}

// نوبت بعدی: اولین بازیکن زنده با شماره‌ی صندلی بزرگ‌تر، وگرنه اولین نفر
export async function advanceTurn(env, chat) {
  const game = await getGame(env, chat);
  const alive = await alivePlayers(env, chat);
  if (!alive.length) return null;
  const cur = await getPlayer(env, chat, game.turn_user);
  const curSeat = cur ? cur.seat : -1;
  const next = alive.find((p) => p.seat > curSeat) || alive[0];
  await run(env.DB, 'UPDATE games SET turn_user=? WHERE chat_id=?', next.user_id, chat);
  return next;
}

export async function applyDamage(env, chat, target, dmg) {
  const hp = Math.max(0, target.hp - dmg);
  const alive = hp > 0 ? 1 : 0;
  await run(env.DB, 'UPDATE players SET hp=?, alive=? WHERE chat_id=? AND user_id=?', hp, alive, chat, target.user_id);
  return { hp, dead: !alive };
}
