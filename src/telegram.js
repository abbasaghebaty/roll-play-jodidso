import { logEvent, plain } from './log.js';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mention(p) {
  if (!p) return 'بازیکنی نیست';
  if (p.user_id < 0) return `<b>${esc(p.name)} (d${-p.user_id})</b>`;
  return `<a href="tg://user?id=${p.user_id}">${esc(p.name)}</a>`;
}

async function callTelegram(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  let result;
  try { result = await response.json(); } catch { /* handled below */ }
  return { response, result };
}

export async function send(env, chatId, text, replyTo) {
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');
  const base = {
    chat_id: chatId,
    ...(replyTo == null ? {} : { reply_to_message_id: replyTo }),
    allow_sending_without_reply: true,
  };
  let { response, result } = await callTelegram(env, 'sendMessage', { ...base, text, parse_mode: 'HTML' });

  // اگر HTML خراب بود، همان متن را ساده می‌فرستیم تا پیام گم نشود
  if ((!response.ok || !result?.ok) && /parse entities/i.test(result?.description || '')) {
    console.error('HTML parse failed, resending as plain text:', result?.description);
    ({ response, result } = await callTelegram(env, 'sendMessage', { ...base, text: plain(text) }));
  }
  if (!response.ok || !result?.ok) {
    throw new Error(`Telegram sendMessage failed (${response.status}): ${result?.description || 'unknown error'}`);
  }
  await logEvent(env, { chat: chatId, kind: 'out', msgId: result.result?.message_id, text: plain(text) });
  return result;
}

// ارسال یک فایل متنی/JSON
export async function sendDocument(env, chatId, filename, content, caption = '', replyTo) {
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption.slice(0, 1000));
  if (replyTo != null) {
    form.append('reply_to_message_id', String(replyTo));
    form.append('allow_sending_without_reply', 'true');
  }
  form.append('document', new Blob([content], { type: 'application/json' }), filename);
  const { response, result } = await callTelegram(env, 'sendDocument', form);
  if (!response.ok || !result?.ok) {
    throw new Error(`Telegram sendDocument failed (${response.status}): ${result?.description || 'unknown error'}`);
  }
  await logEvent(env, { chat: chatId, kind: 'out', msgId: result.result?.message_id, text: `[فایل] ${filename}` });
  return result;
}


export async function sendKeyboard(env, chatId, text, replyMarkup) {
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');
  const { response, result } = await callTelegram(env, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
  if (!response.ok || !result?.ok) throw new Error(`Telegram sendMessage failed (${response.status}): ${result?.description || 'unknown error'}`);
  await logEvent(env, { chat: chatId, kind: 'out', msgId: result.result?.message_id, text: plain(text) });
  return result;
}

export async function editMessage(env, chatId, messageId, text, replyMarkup) {
  const { response, result } = await callTelegram(env, 'editMessageText', {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
    reply_markup: replyMarkup, disable_web_page_preview: true,
  });
  if ((!response.ok || !result?.ok) && /message is not modified/i.test(result?.description || '')) return result;
  if (!response.ok || !result?.ok) throw new Error(`Telegram editMessageText failed (${response.status}): ${result?.description || 'unknown error'}`);
  return result;
}

export async function pinMessage(env, chatId, messageId) {
  const { response, result } = await callTelegram(env, 'pinChatMessage', {
    chat_id: chatId, message_id: messageId, disable_notification: true,
  });
  if (!response.ok || !result?.ok) throw new Error(`Telegram pinChatMessage failed (${response.status}): ${result?.description || 'unknown error'}`);
  return result;
}

export async function answerCallback(env, callbackId, text, showAlert = false) {
  const { response, result } = await callTelegram(env, 'answerCallbackQuery', {
    callback_query_id: callbackId, text, show_alert: showAlert,
  });
  if (!response.ok || !result?.ok) console.error('Telegram answerCallbackQuery failed:', result?.description || response.status);
  return result;
}

export async function deleteMessage(env, chatId, messageId) {
  if (!chatId || !messageId) return false;
  const { response, result } = await callTelegram(env, 'deleteMessage', { chat_id: chatId, message_id: messageId });
  return !!(response.ok && result?.ok);
}
