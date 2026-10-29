import { send, mention, esc } from './telegram.js';
import { all, first, run } from './db.js';
import { CHARACTERS } from './data/characters.js';
import { TECHNIQUES } from './data/techniques.js';
import { DEFENSES } from './data/defenses.js';
import { rollAttack, techDamage, npCost, d10, defenseValue, MAX_SPAM } from './game/rules.js';
import { getGame, getPlayer, alivePlayers, checkWin, advanceTurn, applyDamage } from './game/engine.js';
import { say, isMaster, resolveId, dummyId, own } from './util.js';
import { logEvent } from './log.js';
import * as T from './testmode.js';
import * as R from './report.js';
import { ensureBattlePanel, handleBattleCallback, refreshBattlePanel } from './game/ui.js';

const ANON_ADMIN_ID = 1087968824; // آیدی ثابتی که تلگرام برای «ادمین ناشناس» می‌فرستد

export async function handleUpdate(update, env) {
  if (update.callback_query) return handleBattleCallback(update.callback_query, env, { attack, defend, nodefend });
  const m = update.message;
  if (!m || !m.from || typeof m.text !== 'string' || !m.text.startsWith('/')) return;
  const parts = m.text.trim().split(/\s+/);
  const cmd = parts[0].slice(1).split('@')[0].toLowerCase();
  const priv = m.chat.type === 'private';
  const ctx = {
    env,
    private: priv,
    chat: m.chat.id,
    uid: m.from.id,
    uname: [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || 'بازیکن',
    args: parts.slice(1),
    rawArgs: m.text.trim().replace(/^\S+\s*/, ''), // متن کامل بعد از دستور (برای /bug)
    msgId: m.message_id,
    reply: !priv && m.reply_to_message ? m.reply_to_message.from || null : null,
    replyMsg: m.reply_to_message || null,
    anonAdmin: !priv && m.from.id === ANON_ADMIN_ID && m.sender_chat?.id === m.chat.id,
  };
  await logEvent(env, { chat: ctx.chat, user: ctx.uid, kind: 'in', msgId: ctx.msgId, text: m.text });
  const handler = own(HANDLERS, cmd);
  if (handler) await handler(ctx);
}

// ---------- کمکی ----------

// بعد از تمام شدن همه‌ی دفاع‌ها: بررسی برنده یا رفتن به نوبت بعد
async function afterResolve(ctx) {
  const { env, chat } = ctx;
  const left = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
  if (left.n > 0) return '';
  if (ctx.private) return ''; // حالت تست: بازی تمام نمی‌شود و نوبت نداریم
  const win = await checkWin(env, chat);
  if (win) {
    return `\n\n🏆 بازی تمام شد! برنده: ${win.length ? win.map(mention).join('، ') : 'هیچ‌کس'}`;
  }
  const next = await advanceTurn(env, chat);
  return next ? `\n\n🎯 نوبت: ${mention(next)}` : '';
}

// نوبت را به نفر بعد می‌دهد (در پیوی/حالت تست نوبت نداریم)
async function passTurn(ctx) {
  if (ctx.private) return '';
  const next = await advanceTurn(ctx.env, ctx.chat);
  return next ? `\n\n🎯 نوبت: ${mention(next)}` : '';
}

async function resolveHits(ctx, target, defValue, label) {
  const { env, chat } = ctx;
  const rows = await all(env.DB, 'SELECT * FROM pending WHERE chat_id=? AND target_id=?', chat, target.user_id);
  if (!rows.length) return say(ctx, 'حمله‌ای منتظر دفاع این بازیکن نیست.');
  const out = [];
  for (const r of rows) {
    // اول حذف می‌کنیم؛ اگر کس دیگری (مثلاً دوبار زدن /defend) زودتر حلش کرده بود، دمیج دوباره اعمال نمی‌شود
    const del = await run(env.DB, 'DELETE FROM pending WHERE id=?', r.id);
    if (del?.meta?.changes === 0) continue;
    const final = Math.max(0, r.dmg - defValue);
    const res = await applyDamage(env, chat, target, final);
    target.hp = res.hp;
    out.push(`${label}: دفاع ${defValue} از ${r.dmg} دمیج ← ${final} دمیج خورد.\n❤️ جان ${mention(target)}: ${res.hp}${res.dead ? ' ☠️ حذف شد' : ''}`);
    await logEvent(env, { chat, user: target.user_id, kind: 'event', text: 'defend', data: { attacker: r.attacker_id, tech: r.tech, dmg: r.dmg, defense: defValue, final, hp_after: res.hp, dead: res.dead } });
  }
  if (!out.length) return say(ctx, 'این حمله قبلاً حل شده.');
  const tail = await afterResolve(ctx);
  await say(ctx, out.join('\n') + tail);
}

// ---------- دستورهای مستر ----------

async function newgame(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر می‌تواند بازی بسازد.');
  const { env, chat } = ctx;
  await run(env.DB, "INSERT OR REPLACE INTO games (chat_id, status, turn_user) VALUES (?, 'lobby', 0)", chat);
  await run(env.DB, 'DELETE FROM players WHERE chat_id=?', chat);
  await run(env.DB, 'DELETE FROM pending WHERE chat_id=?', chat);
  await say(ctx, '🎮 بازی جدید ساخته شد. بازیکن‌ها با <code>/join کلید_کاراکتر</code> وارد شوند. لیست کاراکترها: /chars');
  await ensureBattlePanel(env, chat);
}

async function team(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');
  const tid = resolveId(ctx, ctx.args[1]);
  if (!tid || !ctx.args[0]) return say(ctx, 'روی پیام بازیکن ریپلای کن: <code>/team نام_تیم</code> (حذف تیم: <code>/team -</code>). در پیوی: <code>/team نام me</code>');
  const name = ctx.args[0] === '-' ? '' : ctx.args[0];
  const p = await getPlayer(ctx.env, ctx.chat, tid);
  if (!p) return say(ctx, 'این بازیکن در بازی نیست.');
  await run(ctx.env.DB, 'UPDATE players SET team=? WHERE chat_id=? AND user_id=?', name, ctx.chat, p.user_id);
  await say(ctx, `${mention(p)} → تیم: ${name ? esc(name) : 'بدون تیم'}`);
}

async function begin(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');
  const { env, chat } = ctx;
  const game = await getGame(env, chat);
  if (!game || game.status !== 'lobby') return say(ctx, 'اول /newgame بزن.');
  const players = await alivePlayers(env, chat);
  if (players.length < 2) return say(ctx, 'حداقل ۲ بازیکن لازم است.');
  await run(env.DB, "UPDATE games SET status='active', turn_user=? WHERE chat_id=?", players[0].user_id, chat);
  await say(ctx, `⚔️ بازی شروع شد!\n🎯 نوبت: ${mention(players[0])}\n\nحمله: <code>/attack کلید_تکنیک</code> (روی پیام هدف ریپلای کن)`);
  await ensureBattlePanel(env, chat);
}

async function buff(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');
  const kind = (ctx.args[0] || '').toLowerCase();
  const amount = parseInt(ctx.args[1], 10);
  const tid = resolveId(ctx, ctx.args[2]);
  if (!tid || !['hp', 'np'].includes(kind) || !amount) return say(ctx, 'روی پیام بازیکن ریپلای کن: <code>/buff hp 20</code> یا <code>/buff np 30</code>. در پیوی: <code>/buff hp 20 me</code>');
  const p = await getPlayer(ctx.env, ctx.chat, tid);
  if (!p) return say(ctx, 'این بازیکن در بازی نیست.');
  if (kind === 'hp') {
    const hp = Math.max(0, p.hp + amount);
    await run(ctx.env.DB, 'UPDATE players SET hp=?, max_hp=MAX(max_hp, ?) WHERE chat_id=? AND user_id=?', hp, hp, ctx.chat, p.user_id);
    return say(ctx, `✨ باف جان: ${mention(p)} → ❤️ ${hp}`);
  }
  const np = Math.max(0, p.np + amount);
  await run(ctx.env.DB, 'UPDATE players SET np=?, max_np=MAX(max_np, ?) WHERE chat_id=? AND user_id=?', np, np, ctx.chat, p.user_id);
  await say(ctx, `✨ باف انرژی: ${mention(p)} → 🔮 ${np}`);
}

// /effect poison | drain | clear  (روی پیام بازیکن ریپلای شود)
async function effect(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');
  const kind = (ctx.args[0] || '').toLowerCase();
  const tid = resolveId(ctx, ctx.args[1]);
  if (!tid || !['poison', 'drain', 'clear'].includes(kind)) return say(ctx, 'روی پیام بازیکن ریپلای کن: <code>/effect poison</code> | <code>drain</code> | <code>clear</code>. در پیوی: <code>/effect poison me</code>');
  const p = await getPlayer(ctx.env, ctx.chat, tid);
  if (!p) return say(ctx, 'این بازیکن در بازی نیست.');
  const { env, chat } = ctx;
  if (kind === 'poison') await run(env.DB, 'UPDATE players SET poisoned=1 WHERE chat_id=? AND user_id=?', chat, p.user_id);
  if (kind === 'drain') await run(env.DB, 'UPDATE players SET drained=1 WHERE chat_id=? AND user_id=?', chat, p.user_id);
  if (kind === 'clear') await run(env.DB, 'UPDATE players SET poisoned=0, drained=0 WHERE chat_id=? AND user_id=?', chat, p.user_id);
  await say(ctx, `🌀 وضعیت ${mention(p)} ثبت شد: ${kind}\n(فعلاً فقط نشان داده می‌شود؛ اثرش را مستر دستی اعمال می‌کند.)`);
}

// مستر می‌تواند دفاع یک بازیکن را رد کند (بدون دفاع)
export async function nodefend(ctx) {
  let targetId = ctx.uid;
  if (isMaster(ctx)) targetId = resolveId(ctx, ctx.args[0]) || ctx.uid;
  const p = await getPlayer(ctx.env, ctx.chat, targetId);
  if (!p) return say(ctx, 'بازیکن پیدا نشد.');
  await resolveHits(ctx, p, 0, 'بدون دفاع');
}

// ---------- دستورهای بازیکن ----------

async function join(ctx) {
  const { env, chat } = ctx;
  const game = await getGame(env, chat);
  if (!game || game.status !== 'lobby') return say(ctx, 'الان بازی‌ای در حالت ثبت‌نام نیست.');
  const key = (ctx.args[0] || '').toLowerCase();
  const c = own(CHARACTERS, key);
  if (!c || c.hidden) return say(ctx, 'کاراکتر پیدا نشد. لیست: /chars');
  if (await getPlayer(env, chat, ctx.uid)) return say(ctx, 'قبلاً وارد شده‌ای.');
  const taken = await first(env.DB, 'SELECT user_id FROM players WHERE chat_id=? AND char_key=?', chat, key);
  if (taken) return say(ctx, 'این کاراکتر قبلاً انتخاب شده.');
  const cnt = await first(env.DB, 'SELECT COUNT(*) AS n FROM players WHERE chat_id=?', chat);
  await run(
    env.DB,
    'INSERT INTO players (chat_id, user_id, name, char_key, hp, max_hp, np, max_np, seat) VALUES (?,?,?,?,?,?,?,?,?)',
    chat, ctx.uid, ctx.uname, key, c.hp, c.hp, c.np, c.np, cnt.n
  );
  await say(ctx, `✅ ${esc(ctx.uname)} شد ${esc(c.name)}\n❤️ ${c.hp}  🔮 ${c.np}`);
  await refreshBattlePanel(env, chat);
}

async function chars(ctx) {
  const lines = Object.entries(CHARACTERS).filter(([, c]) => !c.hidden).map(([k, c]) => `<code>${k}</code> — ${esc(c.name)} (❤️${c.hp} 🔮${c.np})`);
  await say(ctx, '👤 کاراکترها:\n' + lines.join('\n'));
}

async function techs(ctx) {
  const p = await getPlayer(ctx.env, ctx.chat, ctx.uid);
  if (!p) return say(ctx, 'تو در بازی نیستی.');
  const keys = ctx.private ? Object.keys(TECHNIQUES) : CHARACTERS[p.char_key].techs;
  const lines = keys.map((k) => {
    const t = TECHNIQUES[k];
    return `<code>${k}</code> — ${esc(t.name)} (پایه ${t.base}، ${t.kind})`;
  });
  await say(ctx, '⚔️ تکنیک‌های تو:\n' + lines.join('\n'));
}

async function defenses(ctx) {
  const lines = Object.entries(DEFENSES).map(([k, d]) => `<code>${k}</code> — ${esc(d.name)} (پایه ${d.base} + ${d.perDie}×تاس)`);
  await say(ctx, '🛡 دفاع‌ها:\n' + lines.join('\n'));
}

async function status(ctx) {
  const { env, chat } = ctx;
  const game = await getGame(env, chat);
  if (!game) return say(ctx, 'بازی‌ای نیست. مستر /newgame بزند.');
  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);
  const lines = players.map((p) => {
    const flags = [p.poisoned ? '☠️مسموم' : '', p.drained ? '📉کاهش بازدهی' : '', p.team ? '👥' + esc(p.team) : ''].filter(Boolean).join(' ');
    const turn = game.status === 'active' && p.user_id === game.turn_user ? '🎯 ' : '';
    return `${turn}${p.alive ? '' : '💀 '}${mention(p)} (${esc(CHARACTERS[p.char_key].name)}${p.user_id < 0 ? '' : ''}) ❤️${p.hp} 🔮${p.np} ${flags}`;
  });
  await say(ctx, `📋 وضعیت (${game.status}):\n` + (lines.join('\n') || 'بازیکنی نیست.'));
}

export async function attack(ctx) {
  const { env, chat } = ctx;
  const uid = ctx.asId ?? ctx.uid; // در تست، /hit دامی را مهاجم می‌کند
  const game = await getGame(env, chat);
  if (!game || game.status !== 'active') return say(ctx, ctx.private ? 'بازی فعال نیست. /test بزن.' : 'بازی فعال نیست.');
  if (!ctx.private && game.turn_user !== uid) return say(ctx, 'نوبت تو نیست.');
  const me = await getPlayer(env, chat, uid);
  if (!me || !me.alive) return say(ctx, 'تو در بازی نیستی یا حذف شده‌ای.');
  const waiting = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
  if (waiting.n > 0) return say(ctx, 'هنوز دفاع حمله‌ی قبلی تمام نشده.');

  const key = (ctx.args[0] || '').toLowerCase();
  const tech = own(TECHNIQUES, key);
  if (!tech || (!ctx.private && !CHARACTERS[me.char_key].techs.includes(key))) return say(ctx, 'این تکنیک مال تو نیست. لیست: /techs');
  if (me.last_tech === key && me.spam >= MAX_SPAM) return say(ctx, `❌ ضد اسپم: ${MAX_SPAM} بار پشت هم زدی، تکنیک دیگری بزن.`);

  // هدف‌ها
  let targets = [];
  if (tech.kind === 'aoe') {
    const everyone = await alivePlayers(env, chat);
    targets = everyone.filter((p) => p.user_id !== uid && (!me.team || p.team !== me.team));
  } else {
    const tid = resolveId(ctx, ctx.args[1]);
    if (!tid) return say(ctx, ctx.private ? 'هدف را بنویس: me یا d1 یا d2. مثال: <code>/attack blackflash d1</code>' : 'روی پیام هدف ریپلای کن.');
    const t = await getPlayer(env, chat, tid);
    if (!t || !t.alive || t.user_id === uid) return say(ctx, 'هدف نامعتبر است.');
    if (me.team && t.team === me.team) return say(ctx, 'هم‌تیمی را نمی‌شود زد.');
    targets = [t];
  }
  if (!targets.length) return say(ctx, 'هدفی نیست.');

  // تاس
  const roll = rollAttack();
  const head = `🎲 ${mention(me)}: مثبت ${roll.pos} − منفی ${roll.neg} = ${roll.result}`;
  if (roll.result <= 0) {
    await logEvent(env, { chat, user: uid, kind: 'event', text: 'attack-neutral', data: { tech: key, roll } });
    return say(ctx, `${head}\n😶 خنثی شد، اتفاقی نیفتاد.${await passTurn(ctx)}`);
  }

  const dmg = techDamage(tech, roll.result);
  // تکنیک‌های free (مثل مشت موقتی) NP مصرف نمی‌کنند
  const cost = tech.free ? 0 : npCost(dmg, tech.kind);
  if (me.np < cost) {
    await logEvent(env, { chat, user: uid, kind: 'event', text: 'attack-no-np', data: { tech: key, roll, dmg, cost, np: me.np } });
    return say(ctx, `${head}\n💥 دمیج ${dmg}، هزینه ${cost} NP ولی فقط ${me.np} داری. تکنیک شکست خورد و نوبت پرید.${await passTurn(ctx)}`);
  }

  const spam = me.last_tech === key ? me.spam + 1 : 1;
  const paid = await run(env.DB, 'UPDATE players SET np=np-?, last_tech=?, spam=? WHERE chat_id=? AND user_id=? AND np>=?', cost, key, spam, chat, uid, cost);
  if (paid?.meta?.changes === 0) return say(ctx, 'NP کافی نبود (احتمالاً دو دستور هم‌زمان). دوباره امتحان کن.');
  await logEvent(env, { chat, user: uid, kind: 'event', text: 'attack', data: { tech: key, kind: tech.kind, roll, dmg, cost, np_before: me.np, targets: targets.map((t) => t.user_id) } });

  let text = `${head}\n⚔️ ${esc(tech.name)}: ${dmg} دمیج (هزینه ${cost} NP)`;
  if (tech.kind === 'undefendable') {
    for (const t of targets) {
      const res = await applyDamage(env, chat, t, dmg);
      text += `\n💢 ${mention(t)} ${dmg} دمیج خورد (غیرقابل‌دفاع). ❤️ ${res.hp}${res.dead ? ' ☠️ حذف شد' : ''}`;
    }
    text += await afterResolve(ctx);
    return say(ctx, text);
  }

  for (const t of targets) {
    await run(env.DB, 'INSERT INTO pending (chat_id, attacker_id, target_id, dmg, tech) VALUES (?,?,?,?,?)', chat, uid, t.user_id, dmg, key);
  }
  text += `\n\n🛡 منتظر دفاع: ${targets.map(mention).join('، ')}\n<code>/defend dodge</code> یا /nodefend`;
  await say(ctx, text);
}

export async function defend(ctx) {
  const key = (ctx.args[0] || '').toLowerCase();
  const def = own(DEFENSES, key);
  if (!def) return say(ctx, 'دفاع نامعتبر. لیست: /defenses');
  const who = ctx.private && ctx.args[1] ? resolveId(ctx, ctx.args[1]) : ctx.uid;
  const me = await getPlayer(ctx.env, ctx.chat, who);
  if (!me || !me.alive) return say(ctx, 'بازیکن در بازی نیست.');
  const roll = d10();
  const value = defenseValue(def, roll);
  await resolveHits(ctx, me, value, `🛡 ${esc(def.name)} (تاس ${roll})`);
}

// تست: دامی به تو حمله کند. /hit d1 blackflash
async function hit(ctx) {
  if (!ctx.private) return say(ctx, 'این دستور فقط در پیوی ربات (حالت تست) است.');
  const id = dummyId(ctx.args[0]);
  if (!id) return say(ctx, 'مثال: <code>/hit d1 blackflash</code>');
  ctx.asId = id;
  ctx.args = [ctx.args[1] || 'punch', 'me'];
  await attack(ctx);
}

async function help(ctx) {
  await say(
    ctx,
    [
      '<b>بازیکن</b>',
      '/join کلید — انتخاب کاراکتر',
      '/chars /techs /defenses /status',
      '/attack کلید_تکنیک — (ریپلای روی هدف)',
      '/defend کلید_دفاع — دفاع',
      '/nodefend — بدون دفاع',
      '',
      '<b>مستر</b>',
      '/newgame /begin',
      '/team نام — (ریپلای)',
      '/buff hp|np عدد — (ریپلای)',
      '/effect poison|drain|clear — (ریپلای)',
      '/nodefend — (ریپلای) رد کردن دفاع یک بازیکن',
      '',
      '<b>گزارش مشکل</b>',
      '/bug توضیح — (ریپلای روی پیامی که مشکل داشت) ثبت گزارش',
      '/id — آیدی عددی تو و چت',
      '<b>بررسی (فقط مستر/سازنده):</b> /bugs /bugshow N /bugdone N /bugopen N /bugexport /logs',
      '',
      '<b>حالت تست (فقط پیوی ربات)</b>',
      '/test [کاراکتر] — بازی تستی با دو دامی d1 و d2',
      '/attack تکنیک d1 — /hit d1 تکنیک — /defend dodge [d1] — /nodefend [d1]',
      '/roll [تعداد] — بررسی تاس',
      '/sim [تکنیک] — جدول دمیج و هزینه',
      '/simdef [دفاع] — جدول دفاع',
      '/set me|d1|d2 hp|np عدد — /fill — /rules',
    ].join('\n')
  );
}

const HANDLERS = {
  start: help,
  help,
  newgame,
  join,
  chars,
  team,
  begin,
  techs,
  defenses,
  attack,
  defend,
  nodefend,
  status,
  buff,
  effect,
  hit,
  test: T.test,
  roll: T.roll,
  sim: T.sim,
  simdef: T.simdef,
  set: T.set,
  fill: T.fill,
  rules: T.rules,
  bug: R.bug,
  report: R.bug,
  باگ: R.bug,
  مشکل: R.bug,
  bugs: R.bugs,
  bugshow: R.bugshow,
  bugdone: R.bugdone,
  bugopen: R.bugopen,
  bugexport: R.bugexport,
  logs: R.logs,
  id: R.id,
};
