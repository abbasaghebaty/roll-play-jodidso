// Combat handlers and the shared flow for resolving pending attacks.
// Keep calculations in game/rules/ and Telegram presentation in game/ui/.
import { all, first, run } from '../db.js';
import { CHARACTERS } from '../data/characters.js';
import { TECHNIQUES } from '../data/techniques.js';
import { DEFENSES } from '../data/defenses.js';
import { rollAttack, techDamage, npCost, d10, defenseValue } from '../game/rules.js';
import { getGame, getPlayer, alivePlayers, checkWin, advanceTurn, applyDamage } from '../game/engine.js';
import { say, sayFlow, isMaster, resolveId, own } from '../util.js';
import { mention, esc } from '../telegram.js';
import { clearResults } from '../game/cleanup.js';
import { logEvent } from '../log.js';
import { refreshBattlePanel, sendDefensePrompt, clearDefensePrompts } from '../game/ui.js';
import { sayThenRefresh } from './helpers.js';

async function afterResolve(ctx) {
  const { env, chat } = ctx;
  const left = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
  if (left.n > 0) return '';

  const win = await checkWin(env, chat);
  if (win) {
    ctx.refreshAfter = true;
    return `\n\n🏆 بازی تمام شد! برنده: ${win.length ? win.map(mention).join('، ') : 'هیچ‌کس'}`;
  }

  const next = await advanceTurn(env, chat);

  // پس از پایان دفاع، اعلان نوبت بعدی باید حتماً دوباره ساخته شود؛
  // این کار وضعیت کهنه‌ی battle_turn_ui را هم پاک می‌کند.
  await run(env.DB, 'DELETE FROM battle_turn_ui WHERE chat_id=?', chat);

  ctx.refreshAfter = true;
  return next ? `\n\n🎯 نوبت: ${mention(next)}` : '';
}

async function passTurn(ctx) {
  const next = await advanceTurn(ctx.env, ctx.chat);
  // اعلان نوبت قبلی دیگر معتبر نیست؛ پنل بازیکن بعدی باید دوباره ساخته شود.
  await run(ctx.env.DB, 'DELETE FROM battle_turn_ui WHERE chat_id=?', ctx.chat);
  ctx.refreshAfter = true;
  return next ? `\n\n🎯 نوبت: ${mention(next)}` : '';
}

async function resolveHits(ctx, target, defValue, label) {
  const { env, chat } = ctx;
  const rows = await all(env.DB, 'SELECT * FROM pending WHERE chat_id=? AND target_id=?', chat, target.user_id);

  if (!rows.length) return say(ctx, 'حمله‌ای منتظر دفاع این بازیکن نیست.');

  await clearResults(env, chat);
  const out = [];

  for (const r of rows) {
    const del = await run(env.DB, 'DELETE FROM pending WHERE id=?', r.id);
    if (del?.meta?.changes === 0) continue;

    const final = Math.max(0, r.dmg - defValue);
    const res = await applyDamage(env, chat, target, final);
    target.hp = res.hp;

    out.push(`${label}: دفاع ${defValue} از ${r.dmg} دمیج ← ${final} دمیج خورد.\n❤️ جان ${mention(target)}: ${res.hp}${res.dead ? ' ☠️ حذف شد' : ''}`);

    await logEvent(env, {
      chat,
      user: target.user_id,
      kind: 'event',
      text: 'defend',
      data: {
        attacker: r.attacker_id,
        tech: r.tech,
        dmg: r.dmg,
        defense: defValue,
        final,
        hp_after: res.hp,
        dead: res.dead
      }
    });
  }

  await clearDefensePrompts(env, chat, target.user_id);

  if (!out.length) return say(ctx, 'این حمله قبلاً حل شده.');

  const tail = await afterResolve(ctx);
  await sayThenRefresh(ctx, out.join('\n') + tail);
}


export async function nodefend(ctx) {
  let targetId = ctx.uid;

  if (isMaster(ctx)) targetId = resolveId(ctx, ctx.args[0]) || ctx.uid;

  const p = await getPlayer(ctx.env, ctx.chat, targetId);

  if (!p) return say(ctx, 'بازیکن پیدا نشد.');

  await resolveHits(ctx, p, 0, 'بدون دفاع');
}

export async function attack(ctx) {
  const { env, chat } = ctx;
  const uid = ctx.uid;
  const game = await getGame(env, chat);

  if (!game || game.status !== 'active') return say(ctx, 'بازی فعال نیست.');
  if (game.turn_user !== uid) return say(ctx, 'نوبت تو نیست.');

  const me = await getPlayer(env, chat, uid);

  if (!me || !me.alive) return say(ctx, 'تو در بازی نیستی یا حذف شده‌ای.');

  const waiting = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);

  if (waiting.n > 0) return say(ctx, 'هنوز دفاع حمله‌ی قبلی تمام نشده.');

  const key = (ctx.args[0] || '').toLowerCase();
  const tech = own(TECHNIQUES, key);

  if (!tech || !CHARACTERS[me.char_key]?.techs?.includes(key)) return say(ctx, 'این تکنیک مال تو نیست. لیست: /techs');

  let targets = [];

  if (tech.kind === 'aoe') {
    const everyone = await alivePlayers(env, chat);
    targets = everyone.filter((p) => p.user_id !== uid && (!me.team || p.team !== me.team));
  } else {
    const tid = resolveId(ctx, ctx.args[1]);

    if (!tid) return say(ctx, 'روی پیام هدف ریپلای کن.');

    const t = await getPlayer(env, chat, tid);

    if (!t || !t.alive || t.user_id === uid) return say(ctx, 'هدف نامعتبر است.');
    if (me.team && t.team === me.team) return say(ctx, 'هم‌تیمی را نمی‌شود زد.');

    targets = [t];
  }

  if (!targets.length) return say(ctx, 'هدفی نیست.');

  await clearResults(env, chat);
  const roll = rollAttack();
  const head = `🎲 ${mention(me)}: مثبت ${roll.pos} − منفی ${roll.neg} = ${roll.result}`;

  if (roll.result === 0) {
    await logEvent(env, { chat, user: uid, kind: 'event', text: 'attack-neutral', data: { tech: key, roll } });
    return sayThenRefresh(ctx, `${head}\n😶 خنثی شد، اتفاقی نیفتاد.${await passTurn(ctx)}`);
  }

  if (roll.result < 0) {
    // نتیجهٔ منفی، شدت شکست را به دمیج خودزنی تبدیل می‌کند؛
    // از همان فرمول دمیج تکنیک و قدرمطلق نتیجه استفاده می‌کنیم.
    const selfDmg = techDamage(tech, Math.abs(roll.result));
    const res = await applyDamage(env, chat, me, selfDmg);

    await logEvent(env, {
      chat,
      user: uid,
      kind: 'event',
      text: 'attack-self-damage',
      data: {
        tech: key,
        roll,
        dmg: selfDmg,
        hp_after: res.hp,
        dead: res.dead
      }
    });

    const tail = await afterResolve(ctx);
    const death = res.dead ? ' ☠️ خودزنی باعث حذف تو شد.' : '';
    return sayThenRefresh(
      ctx,
      `${head}\n💥 ${roll.label}؛ حمله شکست خورد و ${selfDmg} دمیج به خودت وارد کردی. ❤️ جان: ${res.hp}${death}${tail}`
    );
  }

  const dmg = techDamage(tech, roll.result);
  const cost = tech.free ? 0 : npCost(dmg, tech.kind);

  if (me.np < cost) {
    await logEvent(env, { chat, user: uid, kind: 'event', text: 'attack-no-np', data: { tech: key, roll, dmg, cost, np: me.np } });
    return sayThenRefresh(ctx, `${head}\n💥 دمیج ${dmg}، هزینه ${cost} NP ولی فقط ${me.np} داری. تکنیک شکست خورد و نوبت پرید.${await passTurn(ctx)}`);
  }

  const paid = await run(
    env.DB,
    'UPDATE players SET np=np-? WHERE chat_id=? AND user_id=? AND np>=?',
    cost, chat, uid, cost
  );

  if (paid?.meta?.changes === 0) return say(ctx, 'NP کافی نبود (احتمالاً دو دستور هم‌زمان). دوباره امتحان کن.');

  await logEvent(env, {
    chat,
    user: uid,
    kind: 'event',
    text: 'attack',
    data: {
      tech: key,
      kind: tech.kind,
      roll,
      dmg,
      cost,
      np_before: me.np,
      targets: targets.map((t) => t.user_id)
    }
  });

  let text = `${head}\n⚔️ ${esc(tech.name)}: ${dmg} دمیج (هزینه ${cost} NP)`;

  if (tech.kind === 'undefendable') {
    for (const t of targets) {
      const res = await applyDamage(env, chat, t, dmg);
      text += `\n💢 ${mention(t)} ${dmg} دمیج خورد (غیرقابل‌دفاع). ❤️ ${res.hp}${res.dead ? ' ☠️ حذف شد' : ''}`;
    }

    text += await afterResolve(ctx);
    return sayThenRefresh(ctx, text);
  }

  for (const t of targets) {
    await run(
      env.DB,
      'INSERT INTO pending (chat_id, attacker_id, target_id, dmg, tech) VALUES (?,?,?,?,?)',
      chat, uid, t.user_id, dmg, key
    );
  }

  text += `\n\n🛡 منتظر دفاع: ${targets.map(mention).join('، ')}`;

  await sayFlow(ctx, text);

  for (const t of targets) {
    const ok = await sendDefensePrompt(env, chat, t, me, dmg);

    if (!ok) {
      await say(ctx, `⚠️ ارسال دکمه‌های دفاع ${mention(t)} ناموفق بود. با <code>/defend dodge</code> یا /nodefend دفاع کن.`);
    }
  }

  await refreshBattlePanel(env, chat);
}

export async function defend(ctx) {
  const key = (ctx.args[0] || '').toLowerCase();
  const def = own(DEFENSES, key);

  if (!def) return say(ctx, 'دفاع نامعتبر. لیست: /defenses');

  const me = await getPlayer(ctx.env, ctx.chat, ctx.uid);

  if (!me || !me.alive) return say(ctx, 'بازیکن در بازی نیست.');

  const pending = await all(ctx.env.DB, 'SELECT id FROM pending WHERE chat_id=? AND target_id=?', ctx.chat, me.user_id);
  if (!pending.length) return say(ctx, 'حمله‌ای منتظر دفاع تو نیست.');

  await clearResults(ctx.env, ctx.chat);
  const roll = d10();
  const value = defenseValue(def, roll);

  await resolveHits(ctx, me, value, `🛡 ${esc(def.name)} (تاس ${roll})`);
}