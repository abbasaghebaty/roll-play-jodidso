// Telegram callback router for the rp: inline-keyboard namespace.
import { all, first, run, batch } from '../../db.js';
import { CHARACTERS } from '../../data/characters.js';
import { TECHNIQUES } from '../../data/techniques.js';
import { getGame, alivePlayers } from '../engine.js';
import { mention, answerCallback } from '../../telegram.js';
import { editOrSendKeyboard, turnPromptView, showStatusAlert, showTechniquesAlert, settleMenuMessage, pendingCount, showTechniqueMenu } from './prompts.js';
import { refreshBattlePanel } from './panel.js';

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
    operationId: query.id ? `callback:${query.id}` : null,
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
    alert: (text) => answerCallback(env, query.id, text),
  };

  if (action === 'j') {
    return answerCallback(env, query.id, 'این دکمه قدیمی است؛ از لینک انتخاب کاراکتر در پنل جدید استفاده کن.', true);
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

    const started = await batch(env.DB, [
      { sql: "UPDATE games SET status='active', turn_user=? WHERE chat_id=? AND status='lobby'",
        args: [players[0].user_id, chat] },
      { sql: "UPDATE character_selection_requests SET status='cancelled' WHERE chat_id=? AND session_id=? AND status='pending' AND changes()>=0",
        args: [chat, game.session_id] },
    ]);
    if ((started?.[0]?.meta?.changes || 0) !== 1) {
      return answerCallback(env, query.id, 'لابی هم‌زمان بسته شد؛ پنل را تازه کن.', true);
    }

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
      return editOrSendKeyboard(env, chat, m.message_id, v.text, v.markup);
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

    await editOrSendKeyboard(
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
