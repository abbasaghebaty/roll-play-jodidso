// Command router: normalize Telegram updates and delegate to focused handlers.
import { deleteMessage } from '../telegram.js';
import { logEvent } from '../log.js';
import { own, isMaster } from '../util.js';
import * as R from '../report.js';
import { handleBattleCallback } from '../game/ui.js';
import { newgame, endgame, team, begin, buff, effect } from './admin.js';
import { join, chars, techs, defenses, status, help } from './players.js';
import { attack, defend, nodefend } from './combat.js';

const ANON_ADMIN_ID = 1087968824; // آیدی ثابتی که تلگرام برای «ادمین ناشناس» می‌فرستد

export async function handleUpdate(update, env) {
  if (update.callback_query) return handleBattleCallback(update.callback_query, env, { attack, defend, nodefend, isMaster, join: async (ctx, key) => { ctx.args = [key]; return join(ctx); } });
  const m = update.message;

  // تلگرام پس از پین‌کردن پیام، یک پیام سرویس با pinned_message می‌فرستد.
  // اگر پین را خود همین ربات انجام داده باشد، پیام سرویس را حذف می‌کنیم.
  if (m?.pinned_message && m.from?.is_bot) {
    const sender = String(m.from.username || '').replace(/^@/, '').toLowerCase();
    const configuredBot = String(env.BOT_USERNAME || '').replace(/^@/, '').toLowerCase();
    if (!configuredBot || sender === configuredBot) {
      await deleteMessage(env, m.chat.id, m.message_id);
    }
    return;
  }

  if (!m || !m.from || typeof m.text !== 'string' || !m.text.startsWith('/')) return;
  const parts = m.text.trim().split(/\s+/);
  const [cmdName, cmdTarget] = parts[0].slice(1).split('@');

  // اگر BOT_USERNAME تنظیم شده باشد، دستورهایی که برای ربات دیگری در گروه نوشته شده (/attack@other_bot) نادیده گرفته می‌شود
  if (cmdTarget && env.BOT_USERNAME && cmdTarget.toLowerCase() !== String(env.BOT_USERNAME).replace(/^@/, '').toLowerCase()) return;

  const cmd = cmdName.toLowerCase();
  const priv = m.chat.type === 'private';
  const ctx = {
    env,
    private: priv,
    chat: m.chat.id,
    uid: m.from.id,
    uname: [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || 'بازیکن',
    args: parts.slice(1),
    rawArgs: m.text.trim().replace(/^\S+\s*/, ''),
    msgId: m.message_id,
    reply: !priv && m.reply_to_message ? m.reply_to_message.from || null : null,
    replyMsg: m.reply_to_message || null,
    anonAdmin: !priv && m.from.id === ANON_ADMIN_ID && m.sender_chat?.id === m.chat.id,
  };

  await logEvent(env, { chat: ctx.chat, user: ctx.uid, kind: 'in', msgId: ctx.msgId, text: m.text });
  const handler = own(HANDLERS, cmd);
  if (handler) await handler(ctx);
}

// Explicit registry: command names stay separate from implementation modules.
const HANDLERS = {
  start: help, help, newgame, join, chars, team, begin, endgame, techs, defenses,
  attack, defend, nodefend, status, buff, effect,
  bug: R.bug, report: R.bug, باگ: R.bug, مشکل: R.bug,
  bugs: R.bugs, bugshow: R.bugshow, bugdone: R.bugdone, bugopen: R.bugopen,
  bugexport: R.bugexport, logs: R.logs, id: R.id,
};

export { attack, defend, nodefend };