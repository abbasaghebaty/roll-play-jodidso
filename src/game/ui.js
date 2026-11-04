// ============================================================
// src/game/ui.js
// رابط کاربری بازی در گروه: پنل ثابت (لابی/نبرد)، پیام نوبت با دکمه‌ها
// و پردازش کلیک دکمه‌ها (callback_data با پیشوند rp:).
//
// بخش‌ها:
//   ۱) پیام نوبت، پیام دفاع و پاپ‌آپ‌های وضعیت/تکنیک‌ها
//   ۲) پنل ثابت (رندر، ساخت، رفرش و اعلام نوبت)
//   ۳) هندلر کلیک دکمه‌ها (handleBattleCallback)
// دکمه‌ها: rp:go حمله | rp:tl تکنیک‌های من | rp:status وضعیت | rp:back بازگشت
//          rp:t:کلید انتخاب تکنیک | rp:a:کلید:هدف انتخاب هدف | rp:d / rp:n دفاع
// ============================================================

import { all, first, run } from '../db.js';
import { CHARACTERS } from '../data/characters.js';
import { TECHNIQUES } from '../data/techniques.js';
import { DEFENSES } from '../data/defenses.js';
import { getGame, alivePlayers } from './engine.js';
import { mention, esc, sendKeyboard, editMessage, pinMessage, answerCallback, deleteMessage } from '../telegram.js';

const label = (p) => `${mention(p)} — ${esc(CHARACTERS[p.char_key]?.name || p.char_key)} ❤️${p.hp} 🔮${p.np}`;

// ---------- ۱) پیام نوبت و پاپ‌آپ‌ها ----------

function turnPromptView(player) {
  const techs = CHARACTERS[player.char_key]?.techs || [];
  const text = `🎯 ${mention(player)}، نوبت توست!\n\nاز دکمه‌های زیر برای انتخاب حرکت استفاده کن. لازم نیست کامند بنویسی یا کسی را تگ کنی.`;
  const rows = [[{ text: '⚔️ حمله', callback_data: 'rp:go' }]];
  if (techs.length) rows.push([{ text: '📜 تکنیک‌های من', callback_data: 'rp:tl' }]);
  rows.push([{ text: '📋 وضعیت بازیکن‌ها', callback_data: 'rp:status' }]);
  return { text, markup: { inline_keyboard: rows } };
}

async function sendTurnPrompt(env, chat, player) {
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

async function showStatusAlert(query, env, chat, game) {
  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);
  const lines = players.map(p => {
    const mark = game.status === 'active' && p.user_id === game.turn_user ? '🎯' : (p.alive ? '🟢' : '💀');
    const who = CHARACTERS[p.char_key]?.name || p.char_key;
    return `${mark} ${who} (${p.name.slice(0, 12)})  ❤️${p.hp} 🔮${p.np}`;
  });
  await answerCallback(env, query.id, fitAlert(lines.length ? lines : ['بازیکنی نیست.']), true);
}

async function showTechniquesAlert(query, env, chat, uid) {
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

async function settleMenuMessage(env, chat, messageId, before) {
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
      await editMessage(env, chat, messageId, v.text, v.markup);
    }
  } catch (e) {
    console.error('settleMenuMessage failed:', e);
  }
}

async function pendingCount(env, chat) {
  const r = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
  return r?.n || 0;
}

// ---------- ۲) پنل ثابت ----------

export async function renderBattlePanel(env, chat, messageId = null) {
  const game = await getGame(env, chat);
  if (!game) return;
  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);
  const current = players.find(p => p.user_id === game.turn_user);
  const pending = await all(env.DB, 'SELECT * FROM pending WHERE chat_id=? ORDER BY id', chat);

  let text = `⚔️ <b>رول‌پلی انیمه</b>\nوضعیت: <b>${esc(game.status === 'lobby' ? 'لابی ثبت‌نام' : game.status === 'active' ? 'در حال مبارزه' : 'پایان بازی')}</b>\n\n`;

  text += players.map(p => `${p.user_id === game.turn_user && game.status === 'active' ? '🎯 ' : ''}${p.alive ? '🟢' : '💀'} ${label(p)}`).join('\n') || 'هنوز بازیکنی ثبت‌نام نکرده.';

  if (game.status === 'lobby') text += '\n\nبرای ورود، شخصیتت را از دکمه‌ها انتخاب کن.';
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
      rows.push(available.slice(i, i + 2).map(([key, c]) => ({
        text: `👤 ${c.name}`,
        callback_data: `rp:j:${key}`,
      })));
    }

    if (players.length >= 2) {
      rows.push([{ text: '⚔️ شروع بازی', callback_data: 'rp:b' }]);
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

  try {
    await pinMessage(env, chat, id);
  } catch (e) {
    console.error('Could not pin battle panel:', e);
  }

  return id;
}

export async function ensureBattlePanel(env, chat) {
  const game = await getGame(env, chat);

  if (game?.status === 'lobby') {
    try {
      await run(env.DB, 'DELETE FROM battle_turn_ui WHERE chat_id=?', chat);
    } catch (e) {
      console.error('battle_turn_ui reset failed:', e);
    }
  }

  const state = await first(env.DB, 'SELECT message_id FROM battle_ui WHERE chat_id=?', chat);

  if (state?.message_id) return refreshBattlePanel(env, chat);

  return renderBattlePanel(env, chat);
}

export async function refreshBattlePanel(env, chat) {
  try {
    const state = await first(env.DB, 'SELECT message_id FROM battle_ui WHERE chat_id=?', chat);

    if (state?.message_id) {
      try {
        await renderBattlePanel(env, chat, state.message_id);
      } catch (e) {
        console.error('Could not refresh battle panel:', e);

        if (/message to edit not found|message can't be edited|message_id_invalid/i.test(String(e?.message || e))) {
          try {
            await run(env.DB, 'DELETE FROM battle_ui WHERE chat_id=?', chat);
            await renderBattlePanel(env, chat);
          } catch (e2) {
            console.error('Could not recreate battle panel:', e2);
          }
        }
      }
    }

    const game = await getGame(env, chat);

    if (!game || game.status !== 'active' || !game.turn_user) return;

    const player = await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=? AND alive=1', chat, game.turn_user);
    if (!player) return;

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

async function showTechniqueMenu(query, env, chat, player) {
  const keys = CHARACTERS[player.char_key]?.techs || [];

  const rows = keys.filter(key => TECHNIQUES[key]).map(key => [{
    text: `⚔️ ${TECHNIQUES[key].name}`,
    callback_data: `rp:t:${key}`,
  }]);

  rows.push([{ text: '↩️ بازگشت', callback_data: 'rp:back' }]);

  await editMessage(
    env,
    chat,
    query.message.message_id,
    `⚔️ ${mention(player)}، کدام تکنیک را استفاده می‌کنی؟`,
    { inline_keyboard: rows }
  );
}

// ---------- ۳) هندلر کلیک دکمه‌ها ----------

export async function handleBattleCallback(query, env, handlers) {
  const data = String(query.data || '');
  const m = query.message;
  const uid = query.from?.id;

  if (!m || !uid || !data.startsWith('rp:')) {
    return answerCallback(env, query.id, 'این دکمه معتبر نیست.');
  }

  const chat = m.chat.id;
  const game = await getGame(env, chat);

  if (!game) return answerCallback(env, query.id, 'بازی‌ای پیدا نشد.');

  const [, action, key, targetRaw] = data.split(':');
  const targetId = Number(targetRaw);

  const ctx = {
    env,
    private: m.chat.type === 'private',
    chat,
    uid,
    uname: [query.from.first_name, query.from.last_name].filter(Boolean).join(' ') || 'بازیکن',
    args: [],
    rawArgs: '',
    msgId: m.message_id,
    reply: null,
    replyMsg: null,
    anonAdmin: false,
    interactive: true,
  };

  if (action === 'j') {
    if (game.status !== 'lobby') {
      return answerCallback(env, query.id, 'ثبت‌نام بسته شده؛ بازی شروع شده است.');
    }

    await answerCallback(env, query.id, 'در حال ثبت‌نام…');
    await handlers.join(ctx, key);
    await refreshBattlePanel(env, chat);
    return;
  }

  // شروع بازی فقط توسط مستر
  if (action === 'b') {
    if (!handlers.isMaster(ctx)) {
      return answerCallback(env, query.id, 'فقط مستر می‌تواند بازی را شروع کند.', true);
    }

    if (game.status !== 'lobby') {
      return answerCallback(env, query.id, 'بازی قبلاً شروع شده یا لابی بسته است.');
    }

    const players = await alivePlayers(env, chat);

    if (players.length < 2) {
      return answerCallback(env, query.id, 'برای شروع حداقل دو بازیکن لازم است.', true);
    }

    await run(env.DB, "UPDATE games SET status='active', turn_user=? WHERE chat_id=?", players[0].user_id, chat);

    await answerCallback(env, query.id, 'بازی شروع شد!');
    await refreshBattlePanel(env, chat);
    return;
  }

  if (action === 'status') return showStatusAlert(query, env, chat, game);
  if (action === 'tl') return showTechniquesAlert(query, env, chat, uid);

  if (action === 'go' || action === 'back') {
    if (game.status !== 'active' || game.turn_user !== uid) {
      return answerCallback(env, query.id, 'این گزینه فقط برای بازیکن نوبت‌دار است.', true);
    }

    const player = await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=? AND alive=1', chat, uid);

    if (!player) return answerCallback(env, query.id, 'تو در بازی نیستی یا حذف شده‌ای.', true);

    if (action === 'back') {
      await answerCallback(env, query.id, 'بازگشت');
      const v = turnPromptView(player);
      return editMessage(env, chat, m.message_id, v.text, v.markup);
    }

    await answerCallback(env, query.id, 'انتخاب تکنیک');
    return showTechniqueMenu(query, env, chat, player);
  }

  if (action === 't') {
    if (game.status !== 'active' || game.turn_user !== uid) {
      return answerCallback(env, query.id, 'نوبت تو نیست.', true);
    }

    const player = await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=? AND alive=1', chat, uid);
    const tech = TECHNIQUES[key];

    if (!player || !tech || !CHARACTERS[player.char_key]?.techs?.includes(key)) {
      return answerCallback(env, query.id, 'این تکنیک برای تو قابل استفاده نیست.', true);
    }

    if (tech.kind === 'aoe' || tech.kind === 'undefendable') {
      await answerCallback(env, query.id, 'در حال اجرای حمله…');

      ctx.args = [key];
      ctx.msgId = null;

      const before = {
        turnUser: game.turn_user,
        pending: await pendingCount(env, chat),
      };

      await handlers.attack(ctx);
      await settleMenuMessage(env, chat, m.message_id, before);
      return;
    }

    const targets = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? AND alive=1 ORDER BY seat', chat);
    const allowed = targets.filter(p => p.user_id !== uid && (!player.team || p.team !== player.team));

    if (!allowed.length) {
      return answerCallback(env, query.id, 'هدف مجازی وجود ندارد.', true);
    }

    const rows = allowed.map(p => [{
      text: `🎯 ${p.name.slice(0, 30)}`,
      callback_data: `rp:a:${key}:${p.user_id}`,
    }]);

    rows.push([{ text: '↩️ بازگشت به تکنیک‌ها', callback_data: 'rp:go' }]);

    await answerCallback(env, query.id, 'هدف را انتخاب کن');

    await editMessage(
      env,
      chat,
      m.message_id,
      `🎯 ${mention(player)}، هدف حمله را انتخاب کن:`,
      { inline_keyboard: rows }
    );

    return;
  }

  if (action === 'a') {
    if (game.status !== 'active' || game.turn_user !== uid) {
      return answerCallback(env, query.id, 'نوبت تو نیست.', true);
    }

    const tech = TECHNIQUES[key];

    if (!tech) return answerCallback(env, query.id, 'تکنیک پیدا نشد.', true);

    ctx.args = [key, targetId ? String(targetId) : ''];

    if (targetId) ctx.reply = { id: targetId };

    await answerCallback(env, query.id, 'در حال اجرای حمله…');

    ctx.msgId = null;

    const before = {
      turnUser: game.turn_user,
      pending: await pendingCount(env, chat),
    };

    await handlers.attack(ctx);
    await settleMenuMessage(env, chat, m.message_id, before);
    await refreshBattlePanel(env, chat);
    return;
  }

  if (action === 'd' || action === 'n') {
    ctx.msgId = null;

    const actualTargetId = action === 'n'
      ? Number(key === 'x' ? targetRaw : key)
      : targetId;

    const defKey = action === 'd' ? key : null;

    const rows = await all(
      env.DB,
      'SELECT id FROM pending WHERE chat_id=? AND target_id=?',
      chat,
      actualTargetId
    );

    if (actualTargetId !== uid || !rows.length) {
      return answerCallback(env, query.id, 'این دفاع برای تو نیست یا حمله قبلاً حل شده است.', true);
    }

    if (action === 'd') {
      ctx.args = [defKey];
      await answerCallback(env, query.id, 'در حال محاسبه دفاع…');
      await handlers.defend(ctx);
    } else {
      await answerCallback(env, query.id, 'ثبت بدون دفاع…');
      ctx.args = [];
      await handlers.nodefend(ctx);
    }

    await refreshBattlePanel(env, chat);
    return;
  }

  return answerCallback(env, query.id, 'گزینه ناشناخته است.');
}
