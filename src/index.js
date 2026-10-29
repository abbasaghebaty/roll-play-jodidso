
import { handleUpdate } from './commands.js';
import { logEvent } from './log.js';
import { run } from './db.js';
import { send } from './telegram.js';

// هر آپدیت تلگرام فقط یک‌بار پردازش می‌شود.
// اگر جدول processed_updates وجود نداشته باشد، بدون این محافظ ادامه می‌دهد.
async function firstTime(env, id) {
  if (!Number.isInteger(id)) return true;

  try {
    const r = await run(
      env.DB,
      'INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)',
      id
    );

    if (r?.meta?.changes === 0) return false;

    if (id % 20 === 0) {
      await run(
        env.DB,
        'DELETE FROM processed_updates WHERE update_id < ?',
        id - 2000
      );
    }
  } catch (e) {
    console.error(
      'update dedupe unavailable (did you run schema.sql?):',
      e
    );
  }

  return true;
}

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') {
      return new Response('anime-rpg-bot is running');
    }

    // بررسی تنظیمات ضروری
    if (!env.BOT_TOKEN || !env.DB) {
      console.error('Missing BOT_TOKEN or D1 binding DB');
      return new Response('server configuration error', {
        status: 500,
      });
    }

    // دریافت آپدیت تلگرام
    let update;

    try {
      update = await req.json();
    } catch {
      return new Response('invalid JSON', { status: 400 });
    }

    // جلوگیری از پردازش دوباره یک آپدیت
    if (!(await firstTime(env, update.update_id))) {
      return new Response('duplicate');
    }

    try {
      await handleUpdate(update, env);
    } catch (e) {
      console.error('Failed to handle Telegram update:', e);

      const m = update.message;

      let logId = null;

      try {
        logId = await logEvent(env, {
          chat: m?.chat?.id ?? 0,
          user: m?.from?.id ?? 0,
          kind: 'error',
          msgId: m?.message_id ?? null,
          text: String(e?.stack || e?.message || e),
          data: { command: m?.text ?? null },
        });
      } catch (logError) {
        console.error('Could not save error log:', logError);
      }

      // اگر خود دستور گزارش باگ شکست خورد، پیام درخواست /bug نفرست؛
      // وگرنه کاربر با ریپلای روی خطا دوباره /bug می‌زند و حلقه ساخته می‌شود.
      const command = String(m?.text || '').trim().split(/\\s+/, 1)[0].split('@')[0].toLowerCase();
      const isBugCommand = ['/bug', '/report', '/باگ', '/مشکل'].includes(command);

      if (m?.chat?.id && !isBugCommand) {
        try {
          await send(
            env,
            m.chat.id,
            `⚠️ خطای داخلی ربات${logId ? ` (لاگ #${logId})` : ''}.\nروی همین پیام ریپلای بزن و با <code>/bug</code> توضیح بده چه کاری کرده بودی.`,
            m.message_id
          );
        } catch (e2) {
          console.error('Could not notify chat about error:', e2);
        }
      }
    }

    return new Response('ok');
  },
};
