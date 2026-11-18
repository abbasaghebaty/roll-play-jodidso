// Player-facing commands: registration, character lists and status display.
import { all, first, run } from '../db.js';
import { CHARACTERS } from '../data/characters.js';
import { TECHNIQUES } from '../data/techniques.js';
import { DEFENSES } from '../data/defenses.js';
import { getGame, getPlayer } from '../game/engine.js';
import { refreshBattlePanel } from '../game/ui.js';
import { say, note } from '../util.js';
import { esc, mention } from '../telegram.js';

export async function join(ctx) {
  const { env, chat } = ctx;
  const game = await getGame(env, chat);

  if (!game || game.status !== 'lobby') return note(ctx, 'الان بازی‌ای در حالت ثبت‌نام نیست.');

  const key = (ctx.args[0] || '').toLowerCase();
  const c = own(CHARACTERS, key);

  if (!c || c.hidden) return note(ctx, 'کاراکتر پیدا نشد.');
  if (await getPlayer(env, chat, ctx.uid)) return note(ctx, 'قبلاً وارد شده‌ای.');

  const taken = await first(env.DB, 'SELECT user_id FROM players WHERE chat_id=? AND char_key=?', chat, key);
  if (taken) return note(ctx, 'این کاراکتر قبلاً انتخاب شده.');

  const cnt = await first(env.DB, 'SELECT COALESCE(MAX(seat), -1) + 1 AS n FROM players WHERE chat_id=?', chat);
  await run(
    env.DB,
    'INSERT INTO players (chat_id, user_id, name, char_key, hp, max_hp, np, max_np, seat) VALUES (?,?,?,?,?,?,?,?,?)',
    chat, ctx.uid, ctx.uname, key, c.hp, c.hp, c.np, c.np, cnt.n
  );

  await note(ctx, `✅ کاراکتر ${esc(c.name)} برای تو ثبت شد. ❤️ ${c.hp}  🔮 ${c.np}`);
  await refreshBattlePanel(env, chat);
}

export async function chars(ctx) {
  const lines = Object.entries(CHARACTERS)
    .filter(([, c]) => !c.hidden)
    .map(([k, c]) => `<code>${k}</code> — ${esc(c.name)} (❤️${c.hp} 🔮${c.np})`);

  await say(ctx, '👤 کاراکترها:\n' + lines.join('\n'));
}

export async function techs(ctx) {
  const p = await getPlayer(ctx.env, ctx.chat, ctx.uid);

  if (!p) return say(ctx, 'تو در بازی نیستی.');

  const keys = CHARACTERS[p.char_key]?.techs || [];

  const lines = keys.map((k) => {
    const t = TECHNIQUES[k];
    return t ? `<code>${k}</code> — ${esc(t.name)} (پایه ${t.base}، ${t.kind})` : '';
  }).filter(Boolean);

  await say(ctx, '⚔️ تکنیک‌های تو:\n' + lines.join('\n'));
}

export async function defenses(ctx) {
  const lines = Object.entries(DEFENSES)
    .map(([k, d]) => `<code>${k}</code> — ${esc(d.name)} (پایه ${d.base} + ${d.perDie}×تاس)`);

  await say(ctx, '🛡 دفاع‌ها:\n' + lines.join('\n'));
}

export async function status(ctx) {
  const { env, chat } = ctx;
  const game = await getGame(env, chat);

  if (!game) return say(ctx, 'بازی‌ای نیست. مستر /newgame بزند.');

  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);

  const lines = players.map((p) => {
    const flags = [
      p.poisoned ? '☠️مسموم' : '',
      p.drained ? '📉کاهش بازدهی' : '',
      p.team ? '👥' + esc(p.team) : ''
    ].filter(Boolean).join(' ');

    const turn = game.status === 'active' && p.user_id === game.turn_user ? '🎯 ' : '';

    return `${turn}${p.alive ? '' : '💀 '}${mention(p)} (${esc(CHARACTERS[p.char_key]?.name || p.char_key)}) ❤️${p.hp} 🔮${p.np} ${flags}`;
  });

  await say(ctx, `📋 وضعیت (${game.status}):\n` + (lines.join('\n') || 'بازیکنی نیست.'));
}

export async function help(ctx) {
  await say(
    ctx,
    [
      '<b>بازیکن</b>',
      '/join کلید — انتخاب کاراکتر',
      '/chars /techs /defenses /status',
      '/attack کلید_تکنیک — (ریپلای روی هدف)',
      '/defend کلید_دفاع — دفاع',
      '/nodefend — بدون دفاع',
      '',
      '<b>مستر</b>',
      '/newgame /begin /endgame',
      '/team نام — (ریپلای)',
      '/buff hp|np عدد — (ریپلای)',
      '/effect poison|drain|clear — (ریپلای)',
      '/nodefend — (ریپلای) رد کردن دفاع یک بازیکن',
      '',
      '<b>گزارش مشکل</b>',
      '/bug توضیح — (ریپلای روی پیامی که مشکل داشت) ثبت گزارش',
      '/id — آیدی عددی تو و چت',
      '<b>بررسی (فقط مستر/سازنده):</b> /bugs /bugshow N /bugdone N /bugopen N /bugexport /logs',
    ].join('\n')
  );
}
