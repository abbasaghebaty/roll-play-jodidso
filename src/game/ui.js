import { all, first, run } from '../db.js';
import { CHARACTERS } from '../data/characters.js';
import { TECHNIQUES } from '../data/techniques.js';
import { DEFENSES } from '../data/defenses.js';
import { getGame, alivePlayers } from './engine.js';
import { mention, esc, sendKeyboard, editMessage, pinMessage, answerCallback } from '../telegram.js';
import { sendPrompt, dropMessage, purgeAll } from './cleanup.js';
import { isMaster } from '../util.js';

const label = (p) => `${mention(p)} — ${esc(CHARACTERS[p.char_key]?.name || p.char_key)} ❤️${p.hp} 🔮${p.np}`;

async function sendTurnPrompt(env, chat, player) {
  const techs = CHARACTERS[player.char_key]?.techs || [];
  const text = `🎯 ${mention(player)}، نوبت توست!\n\nاز دکمه‌های زیر برای انتخاب حرکت استفاده کن. لازم نیست کامند بنویسی یا کسی را تگ کنی.`;
  const rows = [[{ text: '⚔️ حمله', callback_data: 'rp:go' }]];
  if (techs.length) rows.push([{ text: '📜 تکنیک‌های من', callback_data: 'rp:go' }]);
  rows.push([{ text: '📋 وضعیت بازیکن‌ها', callback_data: 'rp:status' }]);
  await sendPrompt(env, chat, text, { inline_keyboard: rows });
}

export async function renderBattlePanel(env, chat, messageId = null) {
  const game = await getGame(env, chat);
  if (!game) return;
  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);
  const alive = players.filter(p => p.alive);
  const current = players.find(p => p.user_id === game.turn_user);
  const pending = await all(env.DB, 'SELECT * FROM pending WHERE chat_id=? ORDER BY id', chat);
  let text = `⚔️ <b>رول‌پلی انیمه</b>\nوضعیت: <b>${esc(game.status === 'lobby' ? 'لابی ثبت‌نام' : game.status === 'active' ? 'در حال مبارزه' : game.status === 'cancelled' ? 'لغو شد 🛑' : 'پایان بازی')}</b>\n\n`;
  text += players.map(p => `${p.user_id === game.turn_user && game.status === 'active' ? '🎯 ' : ''}${p.alive ? '🟢' : '💀'} ${label(p)}`).join('\n') || 'هنوز بازیکنی ثبت‌نام نکرده.';
  if (game.status === 'lobby') text += '\n\nبرای ورود، شخصیتت را از دکمه‌ها انتخاب کن.';
  if (game.status === 'active' && current) text += `\n\n🎯 نوبت: ${mention(current)}`;
  if (pending.length) text += '\n\n🛡 حمله‌های منتظر دفاع:\n' + pending.map(p => {
    const target = players.find(x => x.user_id === p.target_id);
    const attacker = players.find(x => x.user_id === p.attacker_id);
    return `${target ? mention(target) : 'هدف'}: ${p.dmg} دمیج از ${attacker ? mention(attacker) : 'حمله'}`;
  }).join('\n');
  if (game.status === 'ended') text += '\n\n🏆 بازی به پایان رسید.';
  if (game.status === 'cancelled') text += '\n\n🛑 بازی توسط مستر لغو شد.';

  const rows = [];
  if (game.status === 'lobby') {
    const available = Object.entries(CHARACTERS).filter(([, c]) => !c.hidden);
    for (let i = 0; i < available.length; i += 2) {
      rows.push(available.slice(i, i + 2).map(([key, c]) => ({ text: `👤 ${c.name}`, callback_data: `rp:j:${key}` })));
    }
    if (players.length >= 2) rows.push([{ text: '⚔️ شروع بازی', callback_data: 'rp:b' }]);
  } else if (game.status === 'active') {
    const waitingTargets = [...new Set(pending.map(p => p.target_id))];
    for (const id of waitingTargets) {
      const target = players.find(p => p.user_id === id);
      if (!target) continue;
      for (const [key, def] of Object.entries(DEFENSES)) {
        rows.push([{ text: `🛡 ${def.name} — ${target.name.slice(0, 18)}`, callback_data: `rp:d:${key}:${id}` }]);
      }
      rows.push([{ text: `⏭️ بدون دفاع — ${target.name.slice(0, 18)}`, callback_data: `rp:n:x:${id}` }]);
    }
  }

  if (game.status === 'lobby' || game.status === 'active') rows.push([{ text: '🛑 لغو بازی (مستر)', callback_data: 'rp:x' }]);
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
  const game = await getGame(env, chat);
  // هر بازی جدید باید اعلان نوبت را از نو فعال کند، حتی اگر نفر اول همان نفر بازی قبلی باشد.
  if (game?.status === 'lobby') {
    try { await run(env.DB, 'DELETE FROM battle_turn_ui WHERE chat_id=?', chat); }
    catch (e) { console.error('battle_turn_ui reset failed:', e); }
  }
  const state = await first(env.DB, 'SELECT message_id FROM battle_ui WHERE chat_id=?', chat);
  if (state?.message_id) return refreshBattlePanel(env, chat);
  return renderBattlePanel(env, chat);
}

export async function refreshBattlePanel(env, chat) {
  // رفرش پنل هرگز نباید حمله/دفاع را خراب کند؛ هر خطایی فقط لاگ می‌شود.
  try {
    const state = await first(env.DB, 'SELECT message_id FROM battle_ui WHERE chat_id=?', chat);
    if (state?.message_id) {
      try { await renderBattlePanel(env, chat, state.message_id); }
      catch (e) { console.error('Could not refresh battle panel:', e); }
    }
    const game = await getGame(env, chat);
    if (!game || game.status !== 'active' || !game.turn_user) return;
    const player = await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=? AND alive=1', chat, game.turn_user);
    if (!player) return;
    // اگر هنوز حمله‌ای منتظر دفاع است، نوبت جدید اعلام نمی‌شود
    const waiting = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
    if (waiting?.n > 0) return;
    const stateTurn = await first(env.DB, 'SELECT turn_user FROM battle_turn_ui WHERE chat_id=?', chat);
    if (stateTurn?.turn_user === player.user_id) return;
    await sendTurnPrompt(env, chat, player);
    await run(env.DB, 'INSERT OR REPLACE INTO battle_turn_ui (chat_id, turn_user) VALUES (?,?)', chat, player.user_id);
  } catch (e) {
    console.error('refreshBattlePanel failed:', e);
  }
}

// لغو بازی توسط مستر: پنل به «لغو شد» تبدیل می‌شود و پیام‌های قدیمی پاک می‌شوند
export async function cancelGame(env, chat) {
  const game = await getGame(env, chat);
  if (!game || game.status === 'ended' || game.status === 'cancelled') return false;
  await run(env.DB, "UPDATE games SET status='cancelled', turn_user=0 WHERE chat_id=?", chat);
  await run(env.DB, 'DELETE FROM pending WHERE chat_id=?', chat);
  try { await run(env.DB, 'DELETE FROM battle_turn_ui WHERE chat_id=?', chat); } catch (e) { console.error(e); }
  await purgeAll(env, chat);
  await refreshBattlePanel(env, chat);
  return true;
}

// بعد از حمله: اگر نوبت تمام شد، پیام منوی همان بازیکن حذف شود
async function dropIfDone(env, chat, messageId, uid) {
  const g = await getGame(env, chat);
  const w = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
  if (!g || g.status !== 'active' || g.turn_user !== uid || w?.n > 0) await dropMessage(env, chat, messageId);
}

// پاپ‌آپ فقط برای همان کسی که کلیک کرده؛ هیچ پیامی در گروه ارسال یا ویرایش نمی‌شود
function privateAlert(env, query, state) {
  return async (text) => { state.answered = true; return answerCallback(env, query.id, String(text).slice(0, 190), true); };
}

async function showTechniqueMenu(query, env, chat, player) {
  const keys = CHARACTERS[player.char_key]?.techs || [];
  const rows = keys.filter(key => TECHNIQUES[key]).map(key => [{
    text: `⚔️ ${TECHNIQUES[key].name}`,
    callback_data: `rp:t:${key}`,
  }]);
  rows.push([{ text: '↩️ بازگشت', callback_data: 'rp:back' }]);
  await editMessage(env, chat, query.message.message_id,
    `⚔️ ${mention(player)}، کدام تکنیک را استفاده می‌کنی؟`,
    { inline_keyboard: rows });
}

export async function handleBattleCallback(query, env, handlers) {
  const data = String(query.data || '');
  const m = query.message;
  const uid = query.from?.id;
  if (!m || !uid || !data.startsWith('rp:')) return answerCallback(env, query.id, 'این دکمه معتبر نیست.');
  const chat = m.chat.id;
  const game = await getGame(env, chat);
  if (!game) return answerCallback(env, query.id, 'بازی‌ای پیدا نشد.');
  const [, action, key, targetRaw] = data.split(':');
  const targetId = Number(targetRaw);
  const ctx = {
    env, private: false, chat, uid,
    uname: [query.from.first_name, query.from.last_name].filter(Boolean).join(' ') || 'بازیکن',
    args: [], rawArgs: '', msgId: m.message_id, reply: null, replyMsg: null,
    anonAdmin: false, interactive: true,
  };
  const st = { answered: false };
  ctx.alert = privateAlert(env, query, st);
  const finish = async (text) => { if (!st.answered) await answerCallback(env, query.id, text); };

  if (action === 'j') {
    if (game.status !== 'lobby') return answerCallback(env, query.id, 'ثبت‌نام بسته شده؛ بازی شروع شده است.');
    await handlers.join(ctx, key);
    await finish('ثبت‌نام شدی ✅');
    await refreshBattlePanel(env, chat);
    return;
  }

  if (action === 'b') {
    if (game.status !== 'lobby') return answerCallback(env, query.id, 'بازی قبلاً شروع شده یا لابی بسته است.');
    const players = await alivePlayers(env, chat);
    if (players.length < 2) return answerCallback(env, query.id, 'برای شروع حداقل دو بازیکن لازم است.', true);
    await run(env.DB, "UPDATE games SET status='active', turn_user=? WHERE chat_id=?", players[0].user_id, chat);
    await answerCallback(env, query.id, 'بازی شروع شد!');
    await refreshBattlePanel(env, chat);
    return;
  }

  if (action === 'x') {
    if (!isMaster(ctx)) return answerCallback(env, query.id, 'فقط مستر می‌تواند بازی را لغو کند.', true);
    const ok = await handlers.cancel(ctx);
    return answerCallback(env, query.id, 'بازی لغو شد 🛑');
  }

  if (action === 'status') {
    // فقط برای کلیک‌کننده: خودش اول، بعد بقیه بر اساس جان؛ حد تلگرام برای پاپ‌آپ ۲۰۰ کاراکتر است
    const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY hp DESC', chat);
    const mine = players.filter(p => p.user_id === uid);
    const rest = players.filter(p => p.user_id !== uid);
    const lines = [];
    let len = 0;
    for (const p of [...mine, ...rest]) {
      const line = `${p.alive ? '🟢' : '💀'} ${p.user_id === uid ? '(تو) ' : ''}${CHARACTERS[p.char_key]?.name || p.char_key} ❤️${p.hp} 🔮${p.np}`;
      if (len + line.length + 1 > 190) break;
      lines.push(line);
      len += line.length + 1;
    }
    return answerCallback(env, query.id, lines.join('\n') || 'بازیکنی نیست.', true);
  }

  if (action === 'go' || action === 'back') {
    if (game.status !== 'active' || game.turn_user !== uid) return answerCallback(env, query.id, 'این گزینه فقط برای بازیکن نوبت‌دار است.', true);
    const player = await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=? AND alive=1', chat, uid);
    if (!player) return answerCallback(env, query.id, 'تو در بازی نیستی یا حذف شده‌ای.', true);
    await answerCallback(env, query.id, 'انتخاب تکنیک');
    return showTechniqueMenu(query, env, chat, player);
  }

  if (action === 't') {
    if (game.status !== 'active' || game.turn_user !== uid) return answerCallback(env, query.id, 'نوبت تو نیست.', true);
    const player = await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=? AND alive=1', chat, uid);
    const tech = TECHNIQUES[key];
    if (!player || !tech || !CHARACTERS[player.char_key]?.techs?.includes(key)) return answerCallback(env, query.id, 'این تکنیک برای تو قابل استفاده نیست.', true);
    if (tech.kind === 'aoe' || tech.kind === 'undefendable') {
      ctx.args = [key];
      await handlers.attack(ctx);
      await finish('⚔️ انجام شد');
      await dropIfDone(env, chat, m.message_id, uid);
      await refreshBattlePanel(env, chat);
      return;
    }
    const targets = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? AND alive=1 ORDER BY seat', chat);
    const allowed = targets.filter(p => p.user_id !== uid && (!player.team || p.team !== player.team));
    if (!allowed.length) return answerCallback(env, query.id, 'هدف مجازی وجود ندارد.', true);
    const rows = allowed.map(p => [{ text: `🎯 ${p.name.slice(0, 30)}`, callback_data: `rp:a:${key}:${p.user_id}` }]);
    rows.push([{ text: '↩️ بازگشت به تکنیک‌ها', callback_data: 'rp:back' }]);
    await answerCallback(env, query.id, 'هدف را انتخاب کن');
    await editMessage(env, chat, m.message_id, `🎯 ${mention(player)}، هدف حمله را انتخاب کن:`, { inline_keyboard: rows });
    return;
  }

  if (action === 'a') {
    if (game.status !== 'active' || game.turn_user !== uid) return answerCallback(env, query.id, 'نوبت تو نیست.', true);
    const tech = TECHNIQUES[key];
    if (!tech) return answerCallback(env, query.id, 'تکنیک پیدا نشد.', true);
    ctx.args = [key, targetId ? String(targetId) : ''];
    if (targetId) ctx.reply = { id: targetId };
    await handlers.attack(ctx);
    await finish('⚔️ انجام شد');
    await dropIfDone(env, chat, m.message_id, uid);
    await refreshBattlePanel(env, chat);
    return;
  }

  if (action === 'd' || action === 'n') {
    const actualTargetId = action === 'n' ? Number(key === 'x' ? targetRaw : key) : targetId;
    const defKey = action === 'd' ? key : null;
    const rows = await all(env.DB, 'SELECT id FROM pending WHERE chat_id=? AND target_id=?', chat, actualTargetId);
    if (actualTargetId !== uid || !rows.length) return answerCallback(env, query.id, 'این دفاع برای تو نیست یا حمله قبلاً حل شده است.', true);
    if (action === 'd') {
      ctx.args = [defKey];
      await handlers.defend(ctx);
    } else {
      await handlers.nodefend(ctx);
    }
    await finish('🛡 ثبت شد');
    await refreshBattlePanel(env, chat);
    return;
  }

  return answerCallback(env, query.id, 'گزینه ناشناخته است.');
}
