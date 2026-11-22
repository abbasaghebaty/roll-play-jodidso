// Persistent lobby/battle panel rendering and turn-prompt lifecycle.
import { all, first, run } from '../../db.js';
import { CHARACTERS } from '../../data/characters.js';
import { getGame } from '../engine.js';
import { mention, esc, sendKeyboard, editMessage, pinMessage } from '../../telegram.js';
import { sendTurnPrompt } from './prompts.js';
import { buildSelectionUrl } from '../selection/requests.js';

const label = (p) => `${mention(p)} — ${esc(CHARACTERS[p.char_key]?.name || p.char_key)} ❤️${p.hp} 🔮${p.np}`;

export async function renderBattlePanel(env, chat, messageId = null) {
  const game = await getGame(env, chat);
  if (!game) return;
  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);
  const current = players.find(p => p.user_id === game.turn_user);
  const pending = await all(env.DB, 'SELECT * FROM pending WHERE chat_id=? ORDER BY id', chat);

  let text = `⚔️ <b>رول‌پلی انیمه</b>\nوضعیت: <b>${esc(game.status === 'lobby' ? 'لابی ثبت‌نام' : game.status === 'active' ? 'در حال مبارزه' : 'پایان بازی')}</b>\n\n`;

  text += players.map(p => `${p.user_id === game.turn_user && game.status === 'active' ? '🎯 ' : ''}${p.alive ? '🟢' : '💀'} ${label(p)}`).join('\n') || 'هنوز بازیکنی ثبت‌نام نکرده.';

  if (game.status === 'lobby') text += '\n\nبرای ثبت‌نام یا تغییر کاراکتر، دکمه انتخاب را بزن و در پیوی ربات جست‌وجو کن.';
  if (game.status === 'active' && current) text += `\n\n🎯 نوبت: ${mention(current)}`;

  if (pending.length) text += '\n\n🛡 حمله‌های منتظر دفاع:\n' + pending.map(p => {
    const target = players.find(x => x.user_id === p.target_id);
    const attacker = players.find(x => x.user_id === p.attacker_id);
    return `${target ? mention(target) : 'هدف'}: ${p.dmg} دمیج از ${attacker ? mention(attacker) : 'حمله'}`;
  }).join('\n');

  if (game.status === 'ended') text += '\n\n🏆 بازی به پایان رسید.';

  const rows = [];

  if (game.status === 'lobby') {
    try {
      rows.push([{
        text: '👤 انتخاب کاراکتر',
        url: buildSelectionUrl(env, game),
      }]);
    } catch (error) {
      // Never publish an incomplete deep link; keep the lobby visible for diagnosis.
      console.error('Private character selection link unavailable:', error);
    }

    if (players.length >= 2) {
      rows.push([{ text: '⚔️ شروع بازی', callback_data: 'rp:b' }]);
    }
  }

  const markup = { inline_keyboard: rows };

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