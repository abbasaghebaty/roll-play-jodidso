// گزارش مشکل (/bug) و ابزارهای بررسی لاگ. گزارش‌ها در جدول reports ذخیره می‌شوند.
import { all, first, run } from './db.js';
import { say, isStaff } from './util.js';
import { esc, send, sendDocument } from './telegram.js';
import { logEvent, recentLogs, fmtLog, fmtTime, cut } from './log.js';

const safeParse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

async function needStaff(ctx) {
  if (isStaff(ctx)) return true;
  await say(ctx, `این دستور فقط برای مستر و سازنده‌ی ربات است.\nآیدی تو: <code>${ctx.uid}</code>`);
  return false;
}

async function snapshot(env, chat) {
  const game = await first(env.DB, 'SELECT * FROM games WHERE chat_id=?', chat);
  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);
  const pending = await all(env.DB, 'SELECT * FROM pending WHERE chat_id=?', chat);
  return { game, players, pending };
}

// خطوط طولانی را در چند پیام <pre> می‌فرستد (حد تلگرام ۴۰۹۶ کاراکتر است)
async function sendPre(ctx, title, lines, first = false) {
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    const l = cut(line, 600);
    if (cur && cur.length + l.length + 1 > 3300) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur) chunks.push(cur);
  if (!chunks.length) chunks.push('(خالی)');
  for (let i = 0; i < chunks.length; i++) {
    const head = i === 0 ? `${title}\n` : '';
    const text = `${head}<pre>${esc(chunks[i])}</pre>`;
    if (first && i === 0) await say(ctx, text);
    else await send(ctx.env, ctx.chat, text);
  }
}

// ---------- ثبت گزارش ----------

// روی پیام مشکل‌دار ریپلای کن و بنویس: /bug توضیح مشکل
export async function bug(ctx) {
  const { env, chat } = ctx;
  const note = ctx.rawArgs.trim().slice(0, 1500);
  const rm = ctx.replyMsg;
  if (!note && !rm) {
    return say(ctx, 'روی پیامی که مشکل داشت ریپلای کن و بنویس:\n<code>/bug این‌جا مشکل چیه</code>');
  }

  let ref = { id: null, fromId: null, fromBot: 0, text: '' };
  if (rm) {
    ref = {
      id: rm.message_id,
      fromId: rm.from?.id ?? null,
      fromBot: rm.from?.is_bot ? 1 : 0,
      text: rm.text || rm.caption || '[پیام بدون متن]',
    };
  } else {
    // بدون ریپلای: آخرین پیام خود ربات در همین چت
    const last = await first(env.DB, "SELECT tg_msg_id, text FROM logs WHERE chat_id=? AND kind='out' ORDER BY id DESC LIMIT 1", chat);
    if (last) ref = { id: last.tg_msg_id, fromId: null, fromBot: 1, text: last.text };
  }

  const logs = (await recentLogs(env, chat, 25)).map((l) => ({
    id: l.id, ts: l.ts, kind: l.kind, user: l.user_id, msg: l.tg_msg_id, text: cut(l.text, 700), data: cut(l.data, 700),
  }));
  const state = await snapshot(env, chat);

  const r = await run(
    env.DB,
    `INSERT INTO reports (chat_id, reporter_id, reporter_name, note, ref_msg_id, ref_from_id, ref_from_bot, ref_text, state, logs)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    chat, ctx.uid, ctx.uname, note, ref.id, ref.fromId, ref.fromBot, cut(ref.text, 3000),
    JSON.stringify(state), JSON.stringify(logs)
  );
  const id = r?.meta?.last_row_id;
  await logEvent(env, { chat, user: ctx.uid, kind: 'event', text: 'report', data: { report: id } });
  await say(ctx, `✅ گزارش <b>#${id}</b> ثبت شد (همراه پیام، وضعیت بازی و لاگ‌ها). می‌توانی چند گزارش دیگر هم بدهی.`);
}

// ---------- بررسی گزارش‌ها (فقط مستر/سازنده) ----------

export async function bugs(ctx) {
  if (!(await needStaff(ctx))) return;
  const mode = (ctx.args[0] || '').toLowerCase();
  const where = mode === 'all' ? '' : mode === 'done' ? "WHERE status='done'" : "WHERE status='open'";
  const rows = await all(ctx.env.DB, `SELECT id, ts, reporter_name, note, status, ref_text FROM reports ${where} ORDER BY id DESC LIMIT 25`);
  if (!rows.length) return say(ctx, 'گزارشی نیست. 🎉');
  const lines = rows.map((r) => {
    const what = r.note || `(بدون متن) ${r.ref_text}`;
    return `${r.status === 'done' ? '✅' : '🐞'} <b>#${r.id}</b> ${fmtTime(r.ts)} — ${esc(r.reporter_name)}: ${esc(cut(what.replace(/\s+/g, ' '), 90))}`;
  });
  await say(ctx, `${lines.join('\n')}\n\nجزئیات: <code>/bugshow شماره</code>\nفایل همه: <code>/bugexport</code>`);
}

async function getReport(ctx) {
  const id = parseInt(ctx.args[0], 10);
  if (!id) { await say(ctx, 'شماره‌ی گزارش را بنویس. مثال: <code>/bugshow 3</code>'); return null; }
  const r = await first(ctx.env.DB, 'SELECT * FROM reports WHERE id=?', id);
  if (!r) { await say(ctx, 'گزارشی با این شماره نیست.'); return null; }
  return r;
}

export async function bugshow(ctx) {
  if (!(await needStaff(ctx))) return;
  const r = await getReport(ctx);
  if (!r) return;

  const head = [
    `🐞 <b>گزارش #${r.id}</b> (${r.status === 'done' ? 'بسته‌شده' : 'باز'})`,
    `🕒 ${fmtTime(r.ts)}  |  👤 ${esc(r.reporter_name)} (<code>${r.reporter_id}</code>)  |  چت <code>${r.chat_id}</code>`,
    '',
    '📝 <b>متن گزارش:</b>',
    esc(r.note || '(بدون متن)'),
    '',
    `💬 <b>پیام مورد اشاره</b> (${r.ref_from_bot ? 'از ربات' : `از کاربر ${r.ref_from_id ?? '؟'}`}${r.ref_msg_id ? `، پیام ${r.ref_msg_id}` : ''}):`,
    `<pre>${esc(cut(r.ref_text, 1800))}</pre>`,
    ...(r.resolution ? ['', `✔️ <b>نتیجه:</b> ${esc(r.resolution)}`] : []),
  ].join('\n');
  await say(ctx, head);

  const st = safeParse(r.state);
  if (st) {
    const lines = [`بازی: ${st.game ? `${st.game.status} | نوبت: ${st.game.turn_user}` : 'ندارد'}`];
    for (const p of st.players || []) {
      lines.push(`${p.alive ? '' : '💀 '}${p.name} [${p.char_key}] id=${p.user_id} hp=${p.hp}/${p.max_hp} np=${p.np}/${p.max_np} team=${p.team || '-'} last=${p.last_tech || '-'}×${p.spam}`);
    }
    for (const x of st.pending || []) lines.push(`⏳ منتظر دفاع: ${x.attacker_id} → ${x.target_id} (${x.tech}, ${x.dmg} دمیج)`);
    await sendPre(ctx, '🎮 <b>وضعیت بازی لحظه‌ی گزارش:</b>', lines);
  }

  const logs = safeParse(r.logs) || [];
  await sendPre(ctx, '🧾 <b>لاگ‌های قبل از گزارش:</b>', logs.map((l) => fmtLog({ ...l, user_id: l.user, tg_msg_id: l.msg })));
}

export async function bugdone(ctx) {
  if (!(await needStaff(ctx))) return;
  const r = await getReport(ctx);
  if (!r) return;
  const note = ctx.args.slice(1).join(' ').slice(0, 500);
  await run(ctx.env.DB, "UPDATE reports SET status='done', resolution=? WHERE id=?", note, r.id);
  await say(ctx, `✅ گزارش #${r.id} بسته شد.`);
}

export async function bugopen(ctx) {
  if (!(await needStaff(ctx))) return;
  const r = await getReport(ctx);
  if (!r) return;
  await run(ctx.env.DB, "UPDATE reports SET status='open', resolution='' WHERE id=?", r.id);
  await say(ctx, `🐞 گزارش #${r.id} دوباره باز شد.`);
}

// /bugexport [all] — همه‌ی گزارش‌های باز (یا همه) را به‌صورت یک فایل JSON می‌فرستد
export async function bugexport(ctx) {
  if (!(await needStaff(ctx))) return;
  const all_ = (ctx.args[0] || '').toLowerCase() === 'all';
  const rows = await all(ctx.env.DB, `SELECT * FROM reports ${all_ ? '' : "WHERE status='open'"} ORDER BY id`);
  if (!rows.length) return say(ctx, 'گزارشی برای خروجی نیست.');
  const data = rows.map((r) => ({
    id: r.id,
    time_tehran: fmtTime(r.ts),
    status: r.status,
    resolution: r.resolution,
    chat_id: r.chat_id,
    reporter: { id: r.reporter_id, name: r.reporter_name },
    note: r.note,
    message: { id: r.ref_msg_id, from_id: r.ref_from_id, from_bot: !!r.ref_from_bot, text: r.ref_text },
    state: safeParse(r.state),
    logs: safeParse(r.logs),
  }));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  await sendDocument(ctx.env, ctx.chat, `reports-${stamp}.json`, JSON.stringify(data, null, 2), `📦 ${rows.length} گزارش`, ctx.msgId);
}

// /logs [تعداد] [آیدی_چت] — آخرین لاگ‌های همین چت
export async function logs(ctx) {
  if (!(await needStaff(ctx))) return;
  const n = Math.min(60, Math.max(1, parseInt(ctx.args[0], 10) || 20));
  const chat = ctx.args[1] ? parseInt(ctx.args[1], 10) : ctx.chat;
  if (!Number.isInteger(chat)) return say(ctx, 'مثال: <code>/logs 30</code> یا <code>/logs 30 -100123456</code>');
  const rows = await recentLogs(ctx.env, chat, n);
  await sendPre(ctx, `🧾 <b>${rows.length} لاگ آخر چت ${chat}:</b>`, rows.map(fmtLog), true);
}

// /id — آیدی عددی خودت و چت (برای تنظیم MASTER_IDS / OWNER_IDS)
export async function id(ctx) {
  await say(ctx, `آیدی تو: <code>${ctx.uid}</code>\nآیدی این چت: <code>${ctx.chat}</code>`);
}
