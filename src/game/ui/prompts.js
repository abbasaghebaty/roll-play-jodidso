// Reusable message and prompt views for turns, defenses and status popups.
import { all, first, run } from '../../db.js';
import { CHARACTERS } from '../../data/characters.js';
import { TECHNIQUES } from '../../data/techniques.js';
import { DEFENSES } from '../../data/defenses.js';
import { getGame } from '../engine.js';
import { mention, esc, sendKeyboard, editMessage, answerCallback, deleteMessage } from '../../telegram.js';

export async function editOrSendKeyboard(env, chat, messageId, text, markup) {
  try {
    return await editMessage(env, chat, messageId, text, markup);
  } catch (e) {
    if (!/429|Too Many Requests/i.test(String(e?.message || e))) throw e;
    console.warn('Telegram edit rate limited; sending a replacement keyboard message.');
    const sent = await sendKeyboard(env, chat, text, markup);
    await deleteMessage(env, chat, messageId);
    return sent;
  }
}

// ---------- ۱) پیام نوبت و پاپ‌آپ‌ها ----------

export function turnPromptView(player) {
  const techs = CHARACTERS[player.char_key]?.techs || [];
  const text = `🎯 ${mention(player)}، نوبت توست!\n\nاز دکمه‌های زیر برای انتخاب حرکت استفاده کن. لازم نیست کامند بنویسی یا کسی را تگ کنی.`;
  const rows = [[{ text: '⚔️ حمله', callback_data: 'rp:go' }]];
  if (techs.length) rows.push([{ text: '📜 تکنیک‌های من', callback_data: 'rp:tl' }]);
  rows.push([{ text: '📋 وضعیت بازیکن‌ها', callback_data: 'rp:status' }]);
  return { text, markup: { inline_keyboard: rows } };
}

export async function sendTurnPrompt(env, chat, player) {
  const v = turnPromptView(player);
  await sendKeyboard(env, chat, v.text, v.markup);
}

function defensePromptView(target, attacker, dmg) {
  const text = `🛡 ${mention(target)}، ${mention(attacker)} حمله کرد و ${dmg} دمیج به تو می‌رسد!\n\nیکی از دفاع‌ها را انتخاب کن:`;
  const rows = Object.entries(DEFENSES).map(([key, def]) => [
    { text: `🛡 ${def.name}`, callback_data: `rp:d:${key}:${target.user_id}` },
  ]);
  rows.push([{ text: '⏭️ بدون دفاع', callback_data: `rp:n:x:${target.user_id}` }]);
  return { text, markup: { inline_keyboard: rows } };
}

export async function sendDefensePrompt(env, chat, target, attacker, dmg) {
  try {
    const v = defensePromptView(target, attacker, dmg);
    const sent = await sendKeyboard(env, chat, v.text, v.markup);
    const id = sent?.result?.message_id;
    if (id) await run(env.DB, 'INSERT INTO bot_msgs (chat_id, message_id, kind) VALUES (?,?,?)', chat, id, `def:${target.user_id}`);
    return true;
  } catch (e) {
    console.error('sendDefensePrompt failed:', e);
    return false;
  }
}

export async function clearDefensePrompts(env, chat, targetId) {
  try {
    const rows = await all(env.DB, 'SELECT id, message_id FROM bot_msgs WHERE chat_id=? AND kind=?', chat, `def:${targetId}`);
    for (const r of rows) {
      await run(env.DB, 'DELETE FROM bot_msgs WHERE id=?', r.id);
      await deleteMessage(env, chat, r.message_id);
    }
  } catch (e) {
    console.error('clearDefensePrompts failed:', e);
  }
}

const ALERT_MAX = 200;

function fitAlert(lines) {
  let out = '';
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > ALERT_MAX - 2) return out ? `${out}\n…` : `${line.slice(0, ALERT_MAX - 2)}…`;
    out = next;
  }
  return out;
}

const KIND_LABEL = { aoe: ' (همگانی)', undefendable: ' (غیرقابل‌دفاع)' };

export async function showStatusAlert(query, env, chat, game) {
  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);
  const lines = players.map(p => {
    const mark = game.status === 'active' && p.user_id === game.turn_user ? '🎯' : (p.alive ? '🟢' : '💀');
    const who = CHARACTERS[p.char_key]?.name || p.char_key;
    return `${mark} ${who} (${p.name.slice(0, 12)})  ❤️${p.hp} 🔮${p.np}`;
  });
  await answerCallback(env, query.id, fitAlert(lines.length ? lines : ['بازیکنی نیست.']), true);
}

export async function showTechniquesAlert(query, env, chat, uid) {
  const player = await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=?', chat, uid);
  if (!player) return answerCallback(env, query.id, 'تو در این بازی نیستی.', true);
  const keys = (CHARACTERS[player.char_key]?.techs || []).filter(k => TECHNIQUES[k]);
  if (!keys.length) return answerCallback(env, query.id, 'تکنیکی برای تو ثبت نشده.', true);
  const lines = [`📜 تکنیک‌های ${CHARACTERS[player.char_key]?.name || player.char_key}:`];
  for (const k of keys) {
    const t = TECHNIQUES[k];
    lines.push(`• ${t.name} — پایه ${t.base}${t.free ? ' (بدون NP)' : ''}${KIND_LABEL[t.kind] || ''}`);
  }
  await answerCallback(env, query.id, fitAlert(lines), true);
}

export async function settleMenuMessage(env, chat, messageId, before) {
  try {
    const game = await getGame(env, chat);
    const waiting = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
    const done = !game || game.status !== 'active' || game.turn_user !== before.turnUser || (waiting?.n || 0) > before.pending;
    if (done) {
      await deleteMessage(env, chat, messageId);
      return;
    }
    const player = await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=? AND alive=1', chat, before.turnUser);
    if (player) {
      const v = turnPromptView(player);
      await editOrSendKeyboard(env, chat, messageId, v.text, v.markup);
    }
  } catch (e) {
    console.error('settleMenuMessage failed:', e);
  }
}

export async function pendingCount(env, chat) {
  const r = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
  return r?.n || 0;
}


export async function showTechniqueMenu(query, env, chat, player) {
  const keys = CHARACTERS[player.char_key]?.techs || [];

  const rows = keys.filter(key => TECHNIQUES[key]).map(key => [{
    text: `⚔️ ${TECHNIQUES[key].name}`,
    callback_data: `rp:t:${key}`,
  }]);

  rows.push([{ text: '↩️ بازگشت', callback_data: 'rp:back' }]);

  await editOrSendKeyboard(
    env,
    chat,
    query.message.message_id,
    `⚔️ ${mention(player)}، کدام تکنیک را استفاده می‌کنی؟`,
    { inline_keyboard: rows }
  );
}
