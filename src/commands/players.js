// Player-facing commands: registration, character lists and status display.
import { all } from '../db.js';
import { CHARACTERS } from '../data/characters.js';
import { TECHNIQUES } from '../data/techniques.js';
import { DEFENSES } from '../data/defenses.js';
import { getGame, getPlayer } from '../game/engine.js';
import { refreshBattlePanel } from '../game/ui.js';
import { say, note } from '../util.js';
import { esc, mention } from '../telegram.js';

export async function chars(ctx) {
  if (!ctx.private) return;
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
      'انتخاب کاراکتر: از دکمه پنل گروه وارد پیوی ربات شو.',
      '/chars /techs /defenses /status (دستورهای فهرست فقط در پیوی)',
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
