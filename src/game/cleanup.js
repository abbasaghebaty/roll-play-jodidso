// پاک‌سازی پیام‌های قدیمی ربات در گروه تا گروه پر نشود.
// kind=result: نتیجه‌ی حمله/دفاع (فقط آخرین نتیجه می‌ماند)
// kind=prompt: پیام نوبت با دکمه‌ها (فقط آخرین پیام نوبت می‌ماند)
import { all, run } from '../db.js';
import { send, sendKeyboard, deleteMessage } from '../telegram.js';

// هیچ‌وقت نباید بازی را خراب کند؛ هر خطایی فقط لاگ می‌شود.
async function rotate(env, chat, messageId, kind) {
  try {
    if (!messageId) return;
    const old = await all(env.DB, 'SELECT id, message_id FROM bot_msgs WHERE chat_id=? AND kind=?', chat, kind);
    await run(env.DB, 'INSERT INTO bot_msgs (chat_id, message_id, kind) VALUES (?,?,?)', chat, messageId, kind);
    for (const o of old) {
      try { await deleteMessage(env, chat, o.message_id); } catch (e) { console.error('deleteMessage failed:', e); }
      await run(env.DB, 'DELETE FROM bot_msgs WHERE id=?', o.id);
    }
  } catch (e) {
    console.error('rotate failed (did you create bot_msgs?):', e);
  }
}

export async function sendResult(env, chat, text, replyTo) {
  const r = await send(env, chat, text, replyTo);
  await rotate(env, chat, r.result?.message_id, 'result');
  return r;
}

export async function sendPrompt(env, chat, text, markup) {
  const r = await sendKeyboard(env, chat, text, markup);
  await rotate(env, chat, r.result?.message_id, 'prompt');
  return r;
}

// حذف یک پیام مشخص (مثلاً پیام نوبتی که کارش تمام شده)
export async function dropMessage(env, chat, messageId) {
  try {
    await deleteMessage(env, chat, messageId);
    await run(env.DB, 'DELETE FROM bot_msgs WHERE chat_id=? AND message_id=?', chat, messageId);
  } catch (e) {
    console.error('dropMessage failed:', e);
  }
}

// پاک کردن همه‌ی پیام‌های ردیابی‌شده‌ی این چت (مثلاً بعد از لغو بازی)
export async function purgeAll(env, chat) {
  try {
    const old = await all(env.DB, 'SELECT id, message_id FROM bot_msgs WHERE chat_id=?', chat);
    for (const o of old) {
      try { await deleteMessage(env, chat, o.message_id); } catch (e) { console.error('deleteMessage failed:', e); }
    }
    await run(env.DB, 'DELETE FROM bot_msgs WHERE chat_id=?', chat);
  } catch (e) {
    console.error('purgeAll failed:', e);
  }
    }
      
