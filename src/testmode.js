// حالت تست: فقط در پیوی ربات کار می‌کند. بازیکن تنهاست و دو دامی (d1 و d2) دارد.
import { say, resolveId, own } from './util.js';
import { esc } from './telegram.js';
import { run } from './db.js';
import { getPlayer } from './game/engine.js';
import { CHARACTERS } from './data/characters.js';
import { TECHNIQUES } from './data/techniques.js';
import { DEFENSES } from './data/defenses.js';
import { rollAttack, techDamage, npCost, defenseValue, MAX_SPAM, STEP, AOE_EXTRA, UNDEFENDABLE_EXTRA } from './game/rules.js';

async function only(ctx) {
  if (ctx.private) return true;
  await say(ctx, 'این دستور فقط در پیوی ربات (حالت تست) کار می‌کند.');
  return false;
}

async function addPlayer(env, chat, uid, name, key, seat) {
  const c = CHARACTERS[key];
  await run(
    env.DB,
    'INSERT INTO players (chat_id, user_id, name, char_key, hp, max_hp, np, max_np, seat) VALUES (?,?,?,?,?,?,?,?,?)',
    chat, uid, name, key, c.hp, c.hp, c.np, c.np, seat
  );
}

// /test [کاراکتر] — ساخت بازی تستی با دو دامی
export async function test(ctx) {
  if (!(await only(ctx))) return;
  const { env, chat, uid } = ctx;
  const key = (ctx.args[0] || 'yuji').toLowerCase();
  const c = own(CHARACTERS, key);
  if (!c || c.hidden) return say(ctx, 'کاراکتر پیدا نشد. لیست: /chars');
  await run(env.DB, "INSERT OR REPLACE INTO games (chat_id, status, turn_user) VALUES (?, 'active', ?)", chat, uid);
  await run(env.DB, 'DELETE FROM players WHERE chat_id=?', chat);
  await run(env.DB, 'DELETE FROM pending WHERE chat_id=?', chat);
  await addPlayer(env, chat, uid, ctx.uname, key, 0);
  await addPlayer(env, chat, -1, 'دامی ۱', 'dummy', 1);
  await addPlayer(env, chat, -2, 'دامی ۲', 'dummy', 2);
  await say(
    ctx,
    [
      `🧪 حالت تست شروع شد. تو: ${esc(c.name)} (❤️${c.hp} 🔮${c.np})`,
      'دو دامی داری: <code>d1</code> و <code>d2</code> (هرکدام ❤️500 🔮500)',
      '',
      'نمونه‌ها:',
      '<code>/attack blackflash d1</code> — تو به دامی ۱ حمله می‌کنی',
      '<code>/defend dodge d1</code> — دامی ۱ دفاع می‌کند (یا /nodefend d1)',
      '<code>/hit d1 blackflash</code> — دامی ۱ به تو حمله می‌کند',
      '<code>/defend dodge</code> — تو دفاع می‌کنی',
      '<code>/attack test_aoe</code> همگانی، <code>/attack test_undef d1</code> غیرقابل‌دفاع',
      '',
      'ابزار تست: /roll /sim /simdef /set /fill /rules /status',
    ].join('\n')
  );
}

// /roll [تعداد] — ریختن تاس حمله برای بررسی تاس
export async function roll(ctx) {
  const n = Math.min(30, Math.max(1, parseInt(ctx.args[0], 10) || 1));
  const lines = [];
  let neutral = 0;
  let max = -99;
  for (let i = 0; i < n; i++) {
    const r = rollAttack();
    if (r.result <= 0) neutral++;
    if (r.result > max) max = r.result;
    lines.push(`${r.pos} − ${r.neg} = ${r.result}${r.result <= 0 ? ' (خنثی)' : ''}`);
  }
  await say(ctx, `🎲 ${n} بار:\n${lines.join('\n')}\n\nخنثی: ${neutral} از ${n} | بیشترین: ${max}`);
}

// /sim [تکنیک] — جدول دمیج و هزینه برای نتیجه‌ی ۱ تا ۹
export async function sim(ctx) {
  const key = (ctx.args[0] || 'blackflash').toLowerCase();
  const t = own(TECHNIQUES, key);
  if (!t) return say(ctx, 'تکنیک پیدا نشد: ' + Object.keys(TECHNIQUES).join(', '));
  const lines = [];
  for (let r = 1; r <= 9; r++) {
    const dmg = techDamage(t, r);
    lines.push(
      t.free
        ? `نتیجه ${r}: دمیج ${dmg} | بدون هزینه NP`
        : `نتیجه ${r}: دمیج ${dmg} | هزینه عادی ${npCost(dmg, 'normal')} | همگانی ${npCost(dmg, 'aoe')} | غیرقابل‌دفاع ${npCost(dmg, 'undefendable')}`
    );
  }
  await say(ctx, `📊 ${esc(t.name)} (پایه ${t.base}، نوع ${t.kind}):\n${lines.join('\n')}`);
}

// /simdef [دفاع] — جدول مقدار دفاع برای تاس ۱ تا ۱۰
export async function simdef(ctx) {
  const key = (ctx.args[0] || 'dodge').toLowerCase();
  const d = own(DEFENSES, key);
  if (!d) return say(ctx, 'دفاع پیدا نشد: ' + Object.keys(DEFENSES).join(', '));
  const lines = [];
  for (let r = 1; r <= 10; r++) lines.push(`تاس ${r}: ${defenseValue(d, r)}`);
  await say(ctx, `🛡 ${esc(d.name)} (پایه ${d.base} + ${d.perDie}×تاس):\n${lines.join('\n')}`);
}

// /set <me|d1|d2> hp|np <عدد> — تغییر مستقیم جان یا انرژی برای تست
export async function set(ctx) {
  if (!(await only(ctx))) return;
  const id = resolveId(ctx, ctx.args[0]);
  const kind = (ctx.args[1] || '').toLowerCase();
  const n = parseInt(ctx.args[2], 10);
  if (!id || !['hp', 'np'].includes(kind) || Number.isNaN(n) || n < 0) {
    return say(ctx, 'مثال: <code>/set me np 0</code> یا <code>/set d1 hp 30</code>');
  }
  const p = await getPlayer(ctx.env, ctx.chat, id);
  if (!p) return say(ctx, 'بازیکن پیدا نشد (me یا d1 یا d2).');
  if (kind === 'hp') {
    await run(ctx.env.DB, 'UPDATE players SET hp=?, max_hp=MAX(max_hp, ?), alive=? WHERE chat_id=? AND user_id=?', n, n, n > 0 ? 1 : 0, ctx.chat, id);
  } else {
    await run(ctx.env.DB, 'UPDATE players SET np=?, max_np=MAX(max_np, ?) WHERE chat_id=? AND user_id=?', n, n, ctx.chat, id);
  }
  await say(ctx, `✅ ${esc(p.name)}: ${kind} = ${n}`);
}

// /fill — برگرداندن همه به حالت کامل
export async function fill(ctx) {
  if (!(await only(ctx))) return;
  const { env, chat, uid } = ctx;
  await run(env.DB, "UPDATE players SET hp=max_hp, np=max_np, alive=1, poisoned=0, drained=0, last_tech='', spam=0 WHERE chat_id=?", chat);
  await run(env.DB, 'DELETE FROM pending WHERE chat_id=?', chat);
  await run(env.DB, "UPDATE games SET status='active', turn_user=? WHERE chat_id=?", uid, chat);
  await say(ctx, '♻️ همه کامل شدند و دفاع‌های معلق پاک شد.');
}

// /rules — خلاصه‌ی قوانینی که الان در ربات پیاده شده، برای بررسی رفیقت
export async function rules(ctx) {
  await say(
    ctx,
    [
      '<b>قوانین پیاده‌شده</b>',
      '• تاس: دو تاس ۱ تا ۱۰. نتیجه = مثبت − منفی (حداکثر ۹). صفر یا منفی = خنثی و نوبت می‌پرد.',
      `• دمیج = پایه‌ی تکنیک + ${STEP} × (نتیجه − ۱). مثال بلک‌فلش: نتیجه ۱ = ۴۰ ، نتیجه ۹ = ۸۰.`,
      `• هزینه NP = (دمیج ÷ ۲، گرد به پایین تا مضرب ۵) + ۵. همگانی +${AOE_EXTRA} ، غیرقابل‌دفاع +${UNDEFENDABLE_EXTRA}.`,
      '• اگر NP کم باشد: تکنیک شکست می‌خورد و نوبت می‌پرد. (مشت موقتی NP مصرف نمی‌کند.)',
      `• ضد اسپم: حداکثر ${MAX_SPAM} بار پشت هم یک تکنیک؛ بار سوم ممنوع.`,
      '• دفاع: پایه + افزایش × تاس d10 مخصوص همان دفاع. دفاع فقط از دمیج کم می‌کند (کمتر از صفر نمی‌شود).',
      '• ضدحمله نداریم. هر کس در نوبت خودش حمله می‌کند. حمله‌ی همگانی: هر آسیب‌دیده جداگانه دفاع می‌کند.',
      '• جان صفر = حذف. آخرین نفر یا تیم زنده برنده است.',
      '• HP و NP فقط با باف (مستر) برمی‌گردند. مسمومیت و کاهش بازدهی فعلاً فقط برچسب‌اند.',
      '',
      'اگر چیزی با قوانین واقعی نمی‌خواند، دقیقاً همان را برای من بفرست.',
    ].join('\n')
  );
}
