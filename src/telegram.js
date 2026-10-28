export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mention(p) {
  if (!p) return 'بازیکنی نیست';
  if (p.user_id < 0) return `<b>${esc(p.name)} (d${-p.user_id})</b>`;
  return `<a href="tg://user?id=${p.user_id}">${esc(p.name)}</a>`;
}

export async function send(env, chatId, text, replyTo) {
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(replyTo == null ? {} : { reply_to_message_id: replyTo }),
      allow_sending_without_reply: true,
    }),
  });
  let result;
  try { result = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !result?.ok) {
    throw new Error(`Telegram sendMessage failed (${response.status}): ${result?.description || 'unknown error'}`);
  }
  return result;
}
