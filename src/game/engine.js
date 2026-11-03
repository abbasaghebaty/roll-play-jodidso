import { all, first, run } from '../db.js';

export async function getGame(env, chat) {
  return await first(env.DB, 'SELECT * FROM games WHERE chat_id=?', chat);
}

export async function getPlayer(env, chat, uid) {
  return await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=?', chat, uid);
}

export async function alivePlayers(env, chat) {
  return await all(env.DB, 'SELECT * FROM players WHERE chat_id=? AND alive=1 ORDER BY seat, user_id', chat);
}

// اگر فقط یک نفر یا یک تیم زنده مانده باشد، بازی تمام می‌شود و زنده‌ها برگردانده می‌شوند
export async function checkWin(env, chat) {
  const alive = await alivePlayers(env, chat);
  const groups = new Set(alive.map((p) => (p.team ? 't:' + p.team : 'u:' + p.user_id)));
  if (groups.size <= 1) {
    await run(env.DB, "UPDATE games SET status='ended' WHERE chat_id=?", chat);
    return alive;
  }
  return null;
}

// نوبت بعدی: اولین بازیکن زنده با شماره‌ی صندلی بزرگ‌تر، وگرنه اولین نفر
export async function advanceTurn(env, chat) {
  const game = await getGame(env, chat);
  if (!game) return null; // بازی پاک شده یا هنوز ساخته نشده
  const alive = await alivePlayers(env, chat);
  if (!alive.length) return null;
  const cur = await getPlayer(env, chat, game.turn_user);
  const curSeat = cur ? cur.seat : -1;
  // اگر دو نفر هم‌زمان جوین شده باشند و صندلی یکسان بگیرند، با user_id ترتیب را مشخص می‌کنیم
  const next =
    alive.find((p) => p.seat > curSeat || (cur && p.seat === curSeat && p.user_id > cur.user_id)) || alive[0];
  await run(env.DB, 'UPDATE games SET turn_user=? WHERE chat_id=?', next.user_id, chat);
  return next;
}

// کم‌کردن جان به‌صورت اتمیک در خود دیتابیس (نه با مقدار قدیمیِ هدف در حافظه)،
// تا اگر دو دمیج هم‌زمان رسید یکی روی دیگری بازنویسی نشود. دمیج منفی/نامعتبر = صفر.
export async function applyDamage(env, chat, target, dmg) {
  const d = Math.max(0, Math.floor(Number(dmg)) || 0);
  await run(
    env.DB,
    'UPDATE players SET hp = MAX(0, hp - ?), alive = CASE WHEN alive = 1 AND hp - ? > 0 THEN 1 ELSE 0 END WHERE chat_id=? AND user_id=?',
    d, d, chat, target.user_id
  );
  const row = await first(env.DB, 'SELECT hp, alive FROM players WHERE chat_id=? AND user_id=?', chat, target.user_id);
  if (!row) return { hp: 0, dead: true };
  return { hp: row.hp, dead: !row.alive };
}
