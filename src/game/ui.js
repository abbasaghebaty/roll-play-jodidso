import { all, first, run } from '../db.js';
import { CHARACTERS } from '../data/characters.js';
import { TECHNIQUES } from '../data/techniques.js';
import { DEFENSES } from '../data/defenses.js';
import { getGame, alivePlayers } from './engine.js';
import { mention, esc, sendKeyboard, editMessage, pinMessage, answerCallback } from '../telegram.js';

const label = (p) => `${mention(p)} — ${esc(CHARACTERS[p.char_key]?.name || p.char_key)} ❤️${p.hp} 🔮${p.np}`;

export async function renderBattlePanel(env, chat, messageId = null) {
  const game = await getGame(env, chat);
  if (!game) return;
  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);
  const alive = players.filter(p => p.alive);
  const current = players.find(p => p.user_id === game.turn_user);
  const pending = await all(env.DB, 'SELECT * FROM pending WHERE chat_id=? ORDER BY id', chat);
  let text = `⚔️ <b>رول‌پلی انیمه</b>\nوضعیت: <b>${esc(game.status)}</b>\n\n`;
  text += players.map(p => `${p.user_id === game.turn_user && game.status === 'active' ? '🎯 ' : ''}${p.alive ? '🟢' : '💀'} ${label(p)}`).join('\n') || 'هنوز بازیکنی ثبت‌نام نکرده.';
  if (game.status === 'lobby') text += '\n\nبرای ورود از /join کلید_کاراکتر استفاده کنید. مستر برای شروع /begin بزند.';
  if (game.status === 'active' && current) text += `\n\n🎯 نوبت: ${mention(current)}`;
  if (pending.length) text += '\n\n🛡 حمله‌های منتظر دفاع:\n' + pending.map(p => {
    const target = players.find(x => x.user_id === p.target_id);
    const attacker = players.find(x => x.user_id === p.attacker_id);
    return `${target ? mention(target) : 'هدف'}: ${p.dmg} دمیج از ${attacker ? mention(attacker) : 'حمله'}`;
  }).join('\n');
  if (game.status === 'ended') text += '\n\n🏆 بازی به پایان رسید.';
  const rows = [];
  if (game.status === 'lobby') {
    const available = Object.entries(CHARACTERS).filter(([, c]) => !c.hidden);
    for (let i = 0; i < available.length; i += 2) {
      rows.push(available.slice(i, i + 2).map(([key, c]) => ({ text: `👤 ${c.name}`, callback_data: `rp:j:${key}` })));
    }
  } else if (game.status === 'active') {
    if (current) {
      const techs = CHARACTERS[current.char_key]?.techs || [];
      for (const key of techs) {
        const tech = TECHNIQUES[key];
        if (!tech) continue;
        if (tech.kind === 'aoe' || tech.kind === 'undefendable') {
          rows.push([{ text: `⚔️ ${tech.name} — همه اهداف`, callback_data: `rp:a:${key}:0` }]);
        } else {
          const targets = alive.filter(p => p.user_id !== current.user_id && (!current.team || p.team !== current.team));
          for (const target of targets) rows.push([{ text: `⚔️ ${tech.name} → ${target.name.slice(0, 22)}`, callback_data: `rp:a:${key}:${target.user_id}` }]);
        }
      }
    }
    const waitingTargets = [...new Set(pending.map(p => p.target_id))];
    for (const id of waitingTargets) {
      const target = players.find(p => p.user_id === id);
      if (!target) continue;
      const defs = Object.keys(DEFENSES);
      for (const key of defs) rows.push([{ text: `🛡 ${DEFENSES[key].name} (دفاع ${target.name.slice(0, 18)})`, callback_data: `rp:d:${key}:${id}` }]);
      rows.push([{ text: `⏭️ بدون دفاع: ${target.name.slice(0, 20)}`, callback_data: `rp:n:${id}` }]);
    }
  }
  const markup = { inline_keyboard: rows.slice(0, 90) };
  if (messageId) {
    await editMessage(env, chat, messageId, text, markup);
    return messageId;
  }
  const sent = await sendKeyboard(env, chat, text, markup);
  const id = sent.result.message_id;
  await run(env.DB, 'INSERT OR REPLACE INTO battle_ui (chat_id, message_id) VALUES (?,?)', chat, id);
  try { await pinMessage(env, chat, id); } catch (e) { console.error('Could not pin battle panel:', e); }
  return id;
}

export async function ensureBattlePanel(env, chat) {
  const state = await first(env.DB, 'SELECT message_id FROM battle_ui WHERE chat_id=?', chat);
  if (state?.message_id) return refreshBattlePanel(env, chat);
  return renderBattlePanel(env, chat);
}

export async function refreshBattlePanel(env, chat) {
  const state = await first(env.DB, 'SELECT message_id FROM battle_ui WHERE chat_id=?', chat);
  if (!state?.message_id) return;
  try { await renderBattlePanel(env, chat, state.message_id); }
  catch (e) { console.error('Could not refresh battle panel:', e); }
}

export async function handleBattleCallback(query, env, handlers) {
  const data = String(query.data || '');
  const m = query.message;
  const uid = query.from?.id;
  if (!m || !uid || !data.startsWith('rp:')) return answerCallback(env, query.id, 'این دکمه معتبر نیست.');
  const chat = m.chat.id;
  if (data === 'rp:info') return answerCallback(env, query.id, 'برای ثبت‌نام، یکی از شخصیت‌های پنل را انتخاب کن.');
  const game = await getGame(env, chat);
  if (!game) return answerCallback(env, query.id, 'بازی‌ای پیدا نشد.');
  const [, action, key, targetRaw] = data.split(':');
  const target = Number(targetRaw);
  const ctx = {
    env, private: false, chat, uid,
    uname: [query.from.first_name, query.from.last_name].filter(Boolean).join(' ') || 'بازیکن',
    args: [], rawArgs: '', msgId: m.message_id, reply: null, replyMsg: null,
    anonAdmin: false, interactive: true,
  };
  if (action === 'j') {
    if (game.status !== 'lobby') return answerCallback(env, query.id, 'ثبت‌نام بسته شده؛ بازی شروع شده است.');
    await answerCallback(env, query.id, 'در حال ثبت‌نام…');
    await handlers.join(ctx, key);
    await refreshBattlePanel(env, chat);
    return;
  }
  if (game.status !== 'active') return answerCallback(env, query.id, 'الان بازی فعال نیست.');
  if (action === 'a') {
    if (game.turn_user !== uid) return answerCallback(env, query.id, 'نوبت تو نیست.');
    ctx.args = [key, target ? String(target) : ''];
    if (target) ctx.reply = { id: target };
    await answerCallback(env, query.id, 'در حال اجرای حمله…');
    await handlers.attack(ctx);
  } else if (action === 'd' || action === 'n') {
    const rows = await all(env.DB, 'SELECT id FROM pending WHERE chat_id=? AND target_id=?', chat, target);
    if (target !== uid || !rows.length) return answerCallback(env, query.id, 'این دفاع برای تو نیست یا حمله قبلاً حل شده.');
    if (action === 'd') {
      ctx.args = [key];
      await answerCallback(env, query.id, 'در حال محاسبه دفاع…');
      await handlers.defend(ctx);
    } else {
      await answerCallback(env, query.id, 'ثبت بدون دفاع…');
      await handlers.nodefend(ctx);
    }
  } else return answerCallback(env, query.id, 'گزینه ناشناخته است.');
  await refreshBattlePanel(env, chat);
}
