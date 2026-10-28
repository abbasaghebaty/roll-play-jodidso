import { handleUpdate } from './commands.js';
import { logEvent } from './log.js';
import { run } from './db.js';
import { send } from './telegram.js';

// هر آپدیت تلگرام فقط یک‌بار پردازش می‌شود (اگر تلگرام دوباره بفرستد، رد می‌شود).
// اگر جدول هنوز ساخته نشده باشد (schema.sql اجرا نشده)، بدون این محافظ ادامه می‌دهد.
async function firstTime(env, id) {
  if (!Number.isInteger(id)) return true;
  try {
    const r = await run(env.DB, 'INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)', id);
    if (r?.meta?.changes === 0) return false;
    if (id % 20 === 0) await run(env.DB, 'DELETE FROM processed_updates WHERE update_id < ?', id - 2000);
  } catch (e) {
    console.error('update dedupe unavailable (did you run schema.sql?):', e);
  }
  return true;
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('anime-rpg-bot is running');

    // Configure WEBHOOK_SECRET in Cloudflare and use the same secret in Telegram's webhook.
    if (!env.WEBHOOK_SECRET) {
      console.error('WEBHOOK_SECRET is not configured');
      return new Response('webhook secret is not configured', { status: 503 });
    }
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    if (!env.BOT_TOKEN || !env.DB) {
      console.error('Missing BOT_TOKEN or D1 binding DB');
      return new Response('server configuration error', { status: 500 });
    }

    let update;
    try {
      update = await req.json();
    } catch {
      return new Response('invalid JSON', { status: 400 });
    }

    if (!(await firstTime(env, update.update_id))) return new Response('duplicate');

    try {
      await handleUpdate(update, env);
    } catch (e) {
      console.error('Failed to handle Telegram update:', e);
      // عمداً 200 برمی‌گردانیم: اگر 500 بدهیم تلگرام همان دستور را بارها تکرار می‌کند
      // و مثلاً NP یا جان چندبار کم می‌شود. به‌جایش خطا در لاگ ثبت می‌شود و به چت خبر می‌دهیم.
      const m = update.message;
      const logId = await logEvent(env, {
        chat: m?.chat?.id ?? 0,
        user: m?.from?.id ?? 0,
        kind: 'error',
        msgId: m?.message_id ?? null,
        text: String(e?.stack || e?.message || e),
        data: { command: m?.text ?? null },
      });
      if (m?.chat?.id) {
        try {
          await send(env, m.chat.id, `⚠️ خطای داخلی ربات${logId ? ` (لاگ #${logId})` : ''}.\nروی همین پیام ریپلای بزن و با <code>/bug</code> توضیح بده چه کاری کرده بودی.`, m.message_id);
        } catch (e2) {
          console.error('Could not notify chat about error:', e2);
        }
      }
    }
    return new Response('ok');
  },
};
