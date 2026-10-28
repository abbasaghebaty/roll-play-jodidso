import { run, all } from './db.js';

export function cut(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// تگ‌های HTML پیام‌های ربات را برای لاگ ساده می‌کند
export function plain(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// لاگ هیچ‌وقت نباید بازی را خراب کند؛ اگر جدول logs هنوز ساخته نشده باشد بی‌صدا رد می‌شود.
// شناسه‌ی ردیف لاگ را برمی‌گرداند (یا null).
export async function logEvent(env, { chat = 0, user = 0, kind, msgId = null, text = '', data = null }) {
  if (!env || !env.DB) return null;
  try {
    const r = await run(
      env.DB,
      'INSERT INTO logs (chat_id, user_id, kind, tg_msg_id, text, data) VALUES (?,?,?,?,?,?)',
      chat ?? 0, user ?? 0, kind, msgId ?? null, cut(text, 3000), data == null ? '' : cut(JSON.stringify(data), 4000)
    );
    const id = r?.meta?.last_row_id ?? null;
    // هر ۵۰ ردیف یک‌بار، لاگ‌های قدیمی (بیش از ۳۰۰۰ تای آخر) پاک می‌شوند
    if (id && id % 50 === 0) await run(env.DB, 'DELETE FROM logs WHERE id < ?', id - 3000);
    return id;
  } catch (e) {
    console.error('logEvent failed:', e);
    return null;
  }
}

export async function recentLogs(env, chat, n = 25) {
  const rows = await all(
    env.DB,
    'SELECT id, ts, user_id, kind, tg_msg_id, text, data FROM logs WHERE chat_id=? ORDER BY id DESC LIMIT ?',
    chat, n
  );
  return rows.reverse();
}

const TZ = 'Asia/Tehran';

// ts در دیتابیس UTC است؛ برای نمایش به وقت تهران تبدیل می‌شود
export function fmtTime(ts, withDate = true) {
  const d = new Date(String(ts).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(ts);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      ...(withDate ? { day: '2-digit', month: '2-digit' } : {}),
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(d).replace(',', '');
  } catch {
    return String(ts);
  }
}

export function fmtLog(l) {
  const k = { in: 'IN ', out: 'OUT', event: 'EVT', error: 'ERR' }[l.kind] || String(l.kind).toUpperCase();
  const who = l.user_id ? ` u${l.user_id}` : '';
  const msg = l.tg_msg_id ? ` m${l.tg_msg_id}` : '';
  const text = cut(String(l.text || '').replace(/\s*\n\s*/g, ' ⏎ '), 200);
  const data = l.data ? ` ${cut(l.data, 260)}` : '';
  return `#${l.id} ${fmtTime(l.ts, false)} ${k}${who}${msg}: ${text}${data}`;
}
