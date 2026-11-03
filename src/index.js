// ============================================================
// src/index.js
// نقطه‌ی ورود ورکر: وبهوک تلگرام را می‌گیرد، اعتبارسنجی می‌کند،
// آپدیت تکراری را رد می‌کند و به handleUpdate می‌دهد.
// اگر خطایی رخ دهد در جدول logs ثبت و به چت اطلاع داده می‌شود.
// ============================================================
import { handleUpdate } from './commands.js';
import { run } from './db.js';
import { logEvent } from './log.js';
import { send, answerCallback } from './telegram.js';

// --- جلوگیری از پردازش دوباره‌ی یک آپدیت (تلگرام گاهی دوباره می‌فرستد) ---
async function firstTime(env, id) {
  if (!Number.isInteger(id)) return true;
  try {
    const r = await run(
      env.DB,
      'INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)',
      id
    );
    if (r?.meta?.changes === 0) return false;
    // هر چند وقت یک‌بار آپدیت‌های قدیمی پاک می‌شوند
    if (id % 20 === 0) {
      await run(env.DB, 'DELETE FROM processed_updates WHERE update_id < ?', id - 2000);
    }
  } catch (e) {
    console.error('update dedupe unavailable (did you run schema.sql?):', e);
  }
  return true;
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') {
      return new Response('anime-rpg-bot is running');
    }
    if (!env.BOT_TOKEN || !env.DB) {
      console.error('Missing BOT_TOKEN or D1 binding DB');
      return new Response('server configuration error', { status: 500 });
    }
    if (env.WEBHOOK_SECRET && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }

    let update;
    try {
      update = await req.json();
    } catch {
      return new Response('invalid JSON', { status: 400 });
    }

    if (!(await firstTime(env, update.update_id))) {
      return new Response('duplicate');
    }

    try {
      await handleUpdate(update, env);
    } catch (e) {
      console.error('Failed to handle Telegram update:', e);

      const cb = update.callback_query;
      const m = update.message || cb?.message;
      const fromId = update.message?.from?.id ?? cb?.from?.id ?? 0;

      // ثبت خطا در لاگ
      let logId = null;
      try {
        logId = await logEvent(env, {
          chat: m?.chat?.id ?? 0,
          user: fromId,
          kind: 'error',
          msgId: m?.message_id ?? null,
          text: String(e?.stack || e?.message || e),
          data: { command: update.message?.text ?? null, callback: cb?.data ?? null },
        });
      } catch (logError) {
        console.error('Could not save error log:', logError);
      }

      // تشخیص اینکه خطا از خود دستور /bug بوده یا نه
      const command = String(update.message?.text || '')
        .trim()
        .split(/\s+/, 1)[0]
        .split('@')[0]
        .toLowerCase();
      const isBugCommand = ['/bug', '/report', '/باگ', '/مشکل'].includes(command);

      // اگر از دکمه بود، پاپ‌آپ خطا نشان بده
      if (cb?.id) {
        try {
          await answerCallback(env, cb.id, '⚠️ خطایی رخ داد. دوباره امتحان کن.');
        } catch (e3) {
          console.error('Could not answer callback after error:', e3);
        }
      }

      // اطلاع به چت
      if (m?.chat?.id) {
        try {
          if (isBugCommand) {
            await send(
              env,
              m.chat.id,
              '⚠️ ثبت گزارش با خطا مواجه شد؛ خطا برای بررسی در لاگ سرور ثبت شده است. لطفاً فعلاً گزارش را دوباره ارسال نکن.',
              m.message_id
            );
          } else {
            await send(
              env,
              m.chat.id,
              `⚠️ خطای داخلی ربات${logId ? ` (لاگ #${logId})` : ''}.\nروی همین پیام ریپلای بزن و با <code>/bug</code> توضیح بده چه کاری کرده بودی.`,
              m.message_id
            );
          }
        } catch (e2) {
          console.error('Could not notify chat about error:', e2);
        }
      }
    }

    return new Response('ok');
  },
};
