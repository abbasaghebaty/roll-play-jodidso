// Command router: route private selection updates separately from group commands and combat callbacks.
import { deleteMessage } from '../telegram.js';
import { logEvent } from '../log.js';
import { own, isMaster } from '../util.js';
import * as R from '../report.js';
import { handleBattleCallback } from '../game/ui.js';
import { handleSelectionCallback, handleSelectionText, startCharacterSelection } from '../game/selection/index.js';
import { newgame, endgame, team, begin, buff, effect } from './admin.js';
import { chars, techs, defenses, status, help } from './players.js';
import { attack, defend, nodefend } from './combat.js';

const ANON_ADMIN_ID = 1087968824; // Telegram's fixed id for anonymous group admins

export async function handleUpdate(update, env) {
  if (update.callback_query) {
    if (String(update.callback_query.data || '').startsWith('cs:')) {
      return handleSelectionCallback(update.callback_query, env);
    }
    return handleBattleCallback(update.callback_query, env, { attack, defend, nodefend, isMaster });
  }

  const m = update.message;

  // Remove the service message generated when the bot pins its lobby/battle panel.
  if (m?.pinned_message && m.from?.is_bot) {
    const sender = String(m.from.username || '').replace(/^@/, '').toLowerCase();
    const configuredBot = String(env.BOT_USERNAME || '').replace(/^@/, '').toLowerCase();
    if (!configuredBot || sender === configuredBot) await deleteMessage(env, m.chat.id, m.message_id);
    return;
  }

  if (!m || !m.from || typeof m.text !== 'string') return;
  const priv = m.chat.type === 'private';
  const isCommand = m.text.trim().startsWith('/');
  // Ordinary text is accepted only in private chat, where an active selection request owns it.
  if (!isCommand && !priv) return;

  const parts = isCommand ? m.text.trim().split(/\s+/) : [];
  const [cmdName = '', cmdTarget] = isCommand ? parts[0].slice(1).split('@') : ['', null];

  // Ignore commands explicitly addressed to another bot.
  if (cmdTarget && env.BOT_USERNAME &&
      cmdTarget.toLowerCase() !== String(env.BOT_USERNAME).replace(/^@/, '').toLowerCase()) return;

  const cmd = cmdName.toLowerCase();
  const ctx = {
    env,
    operationId: Number.isInteger(update.update_id) ? `update:${update.update_id}` : null,
    private: priv,
    chat: m.chat.id,
    uid: m.from.id,
    uname: [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || 'بازیکن',
    args: parts.slice(1),
    rawArgs: isCommand ? m.text.trim().replace(/^\S+\s*/, '') : m.text,
    msgId: m.message_id,
    reply: !priv && m.reply_to_message ? m.reply_to_message.from || null : null,
    replyMsg: m.reply_to_message || null,
    anonAdmin: !priv && m.from.id === ANON_ADMIN_ID && m.sender_chat?.id === m.chat.id,
  };

  await logEvent(env, { chat: ctx.chat, user: ctx.uid, kind: 'in', msgId: ctx.msgId, text: m.text });

  if (!isCommand) return handleSelectionText(ctx, m.text);
  if (cmd === 'start' && priv && ctx.args[0]?.startsWith('cs_')) {
    return startCharacterSelection(ctx, ctx.args[0]);
  }

  const handler = own(HANDLERS, cmd);
  if (handler) await handler(ctx);
}

// Explicit registry: commands stay separate from their implementation modules.
const HANDLERS = {
  start: help, help, newgame, chars, team, begin, endgame, techs, defenses,
  attack, defend, nodefend, status, buff, effect,
  bug: R.bug, report: R.bug, باگ: R.bug, مشکل: R.bug,
  bugs: R.bugs, bugshow: R.bugshow, bugdone: R.bugdone, bugopen: R.bugopen,
  bugexport: R.bugexport, logs: R.logs, id: R.id,
};

export { attack, defend, nodefend };
