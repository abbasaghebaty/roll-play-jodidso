// Master-only and administrative game commands.
// Numerical combat rules belong in src/game/rules/, not in this module.
import { run, batch } from '../db.js';
import { getGame, getPlayer, alivePlayers, checkWin, adjustPlayerHp, adjustPlayerNp } from '../game/engine.js';
import { say, isMaster, resolveId } from '../util.js';
import { mention, esc } from '../telegram.js';
import { ensureBattlePanel, refreshBattlePanel } from '../game/ui.js';
import { logEvent } from '../log.js';
import { sayThenRefresh } from './helpers.js';
import { createGameSession } from '../game/selection/requests.js';

export async function newgame(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر می‌تواند بازی بسازد.');

  const { env, chat } = ctx;

  const session = await createGameSession();
  await batch(env.DB, [
    { sql: "UPDATE character_selection_requests SET status='cancelled' WHERE chat_id=? AND status='pending'",
      args: [chat] },
    { sql: `INSERT INTO games (chat_id,status,turn_user,session_id,selection_token_hash,selection_expires_at)
      VALUES (?,'lobby',0,?,?,datetime('now','+7 days'))
      ON CONFLICT(chat_id) DO UPDATE SET status='lobby',turn_user=0,
        session_id=excluded.session_id,selection_token_hash=excluded.selection_token_hash,
        selection_expires_at=datetime('now','+7 days')`,
      args: [chat, session.sessionId, session.tokenHash] },
    { sql: 'DELETE FROM players WHERE chat_id=?', args: [chat] },
    { sql: 'DELETE FROM pending WHERE chat_id=?', args: [chat] },
    { sql: 'UPDATE combat_actions SET turn_claim=0 WHERE chat_id=? AND turn_claim=1', args: [chat] },
    { sql: 'DELETE FROM battle_ui WHERE chat_id=?', args: [chat] },
  ]);

  try {
    await ensureBattlePanel(env, chat);
    await logEvent(env, { chat, user: ctx.uid, kind: 'event', text: 'newgame' });
  } catch (e) {
    console.error('newgame panel failed:', e);
    return say(ctx, '⚠️ بازی ساخته شد ولی ارسال پنل ثبت‌نام با خطا مواجه شد. دوباره /newgame بزن.');
  }
}

export async function endgame(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر می‌تواند بازی را تمام کند.');

  const { env, chat } = ctx;
  const game = await getGame(env, chat);

  if (!game || game.status === 'ended') return say(ctx, 'بازی فعالی برای بستن وجود ندارد.');

  await batch(env.DB, [
    { sql: "UPDATE games SET status='ended' WHERE chat_id=? AND status<>'ended'", args: [chat] },
    { sql: "UPDATE character_selection_requests SET status='cancelled' WHERE chat_id=? AND session_id=? AND status='pending'",
      args: [chat, game.session_id] },
    { sql: 'DELETE FROM pending WHERE chat_id=?', args: [chat] },
    { sql: 'UPDATE combat_actions SET turn_claim=0 WHERE chat_id=? AND turn_claim=1', args: [chat] },
  ]);

  try {
    await run(env.DB, 'DELETE FROM battle_turn_ui WHERE chat_id=?', chat);
  } catch (e) {
    console.error('battle_turn_ui reset failed:', e);
  }

  await logEvent(env, { chat, user: ctx.uid, kind: 'event', text: 'endgame', data: { was: game.status } });
  await say(ctx, '🏁 بازی توسط مستر بسته شد. برای شروع بازی جدید /newgame بزن.');
  await refreshBattlePanel(env, chat);
}

export async function team(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');

  const tid = resolveId(ctx, ctx.args[1]);

  if (!tid || !ctx.args[0]) {
    return say(ctx, 'روی پیام بازیکن ریپلای کن: <code>/team نام_تیم</code> (حذف تیم: <code>/team -</code>)');
  }

  const name = ctx.args[0] === '-' ? '' : ctx.args[0];
  const p = await getPlayer(ctx.env, ctx.chat, tid);

  if (!p) return say(ctx, 'این بازیکن در بازی نیست.');

  await run(ctx.env.DB, 'UPDATE players SET team=? WHERE chat_id=? AND user_id=?', name, ctx.chat, p.user_id);
  await say(ctx, `${mention(p)} → تیم: ${name ? esc(name) : 'بدون تیم'}`);
}

export async function begin(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');

  const { env, chat } = ctx;
  const game = await getGame(env, chat);

  if (!game || game.status !== 'lobby') return say(ctx, 'اول /newgame بزن.');

  const players = await alivePlayers(env, chat);

  if (players.length < 2) return say(ctx, 'حداقل ۲ بازیکن لازم است.');

  await batch(env.DB, [
    { sql: "UPDATE games SET status='active', turn_user=? WHERE chat_id=? AND status='lobby'",
      args: [players[0].user_id, chat] },
    { sql: "UPDATE character_selection_requests SET status='cancelled' WHERE chat_id=? AND session_id=? AND status='pending'",
      args: [chat, game.session_id] },
  ]);
  await ensureBattlePanel(env, chat);
}

export async function buff(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');

  const kind = (ctx.args[0] || '').toLowerCase();
  const amount = parseInt(ctx.args[1], 10);
  const tid = resolveId(ctx, ctx.args[2]);

  if (!tid || !['hp', 'np'].includes(kind) || !amount) {
    return say(ctx, 'روی پیام بازیکن ریپلای کن: <code>/buff hp 20</code> یا <code>/buff np 30</code>');
  }

  if (kind === 'hp') {
    const player = await adjustPlayerHp(ctx.env, ctx.chat, tid, amount);
    if (!player) return say(ctx, 'این بازیکن در بازی نیست.');

    if (player.hp <= 0) {
      const win = await checkWin(ctx.env, ctx.chat);

      if (win) {
        ctx.refreshAfter = true;
        return sayThenRefresh(ctx, `✨ باف جان: ${mention(player)} → ❤️ 0 ☠️ حذف شد\n\n🏆 بازی تمام شد! برنده: ${win.length ? win.map(mention).join('، ') : 'هیچ‌کس'}`);
      }
    }

    return say(ctx, `✨ باف جان: ${mention(player)} → ❤️ ${player.hp}`);
  }

  const player = await adjustPlayerNp(ctx.env, ctx.chat, tid, amount);
  if (!player) return say(ctx, 'این بازیکن در بازی نیست.');
  await say(ctx, `✨ باف انرژی: ${mention(player)} → 🔮 ${player.np}`);
}

export async function effect(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');

  const kind = (ctx.args[0] || '').toLowerCase();
  const tid = resolveId(ctx, ctx.args[1]);

  if (!tid || !['poison', 'drain', 'clear'].includes(kind)) {
    return say(ctx, 'روی پیام بازیکن ریپلای کن: <code>/effect poison</code> | <code>drain</code> | <code>clear</code>');
  }

  const p = await getPlayer(ctx.env, ctx.chat, tid);

  if (!p) return say(ctx, 'این بازیکن در بازی نیست.');

  const { env, chat } = ctx;

  if (kind === 'poison') await run(env.DB, 'UPDATE players SET poisoned=1 WHERE chat_id=? AND user_id=?', chat, p.user_id);
  if (kind === 'drain') await run(env.DB, 'UPDATE players SET drained=1 WHERE chat_id=? AND user_id=?', chat, p.user_id);
  if (kind === 'clear') await run(env.DB, 'UPDATE players SET poisoned=0, drained=0 WHERE chat_id=? AND user_id=?', chat, p.user_id);

  await say(ctx, `🌀 وضعیت ${mention(p)} ثبت شد: ${kind}\n(فعلاً فقط نشان داده می‌شود؛ اثرش را مستر دستی اعمال می‌کند.)`);
}
