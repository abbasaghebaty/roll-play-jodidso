import { send, mention, esc, deleteMessage } from './telegram.js';
import { clearResults } from './game/cleanup.js';
import { all, first, run } from './db.js';
import { CHARACTERS } from './data/characters.js';
import { TECHNIQUES } from './data/techniques.js';
import { DEFENSES } from './data/defenses.js';
import { rollAttack, techDamage, npCost, d10, d4, d9, defenseValue } from './game/rules.js';
import { defenseResolution, DOMAIN_BARRIERS, domainClashWinner } from './game/hadi-rules.js';
import { getEffect, setEffect, removeEffect } from './game/effects.js';
import { activateDomain } from './game/domains.js';
import { activateSimpleDomain, activateHollowWickerBasket, reinforceHollowWickerBasket, activateFallingBlossom, activateDomainAmplification, damageAntiDomain } from './game/anti-domain.js';
import { isSealed } from './game/seals.js';
import { selfDamageFromTechnique, physicalSelfDamage, painRankNpBuff, reverseCursedResult, energyRankPenalty } from './game/hadi-rules.js';
import { getGame, getPlayer, alivePlayers, checkWin, advanceTurn, applyDamage } from './game/engine.js';
import { say, note, sayFlow, isMaster, resolveId, own } from './util.js';
import { logEvent } from './log.js';
import * as R from './report.js';
import { ensureBattlePanel, handleBattleCallback, refreshBattlePanel, sendDefensePrompt, clearDefensePrompts } from './game/ui.js';

const ANON_ADMIN_ID = 1087968824; // آیدی ثابتی که تلگرام برای «ادمین ناشناس» می‌فرستد

export async function handleUpdate(update, env) {
  if (update.callback_query) return handleBattleCallback(update.callback_query, env, { attack, defend, nodefend, isMaster, join: async (ctx, key) => { ctx.args = [key]; return join(ctx); } });
  const m = update.message;

  // تلگرام پس از پین‌کردن پیام، یک پیام سرویس با pinned_message می‌فرستد.
  // اگر پین را خود همین ربات انجام داده باشد، پیام سرویس را حذف می‌کنیم.
  if (m?.pinned_message && m.from?.is_bot) {
    const sender = String(m.from.username || '').replace(/^@/, '').toLowerCase();
    const configuredBot = String(env.BOT_USERNAME || '').replace(/^@/, '').toLowerCase();
    if (!configuredBot || sender === configuredBot) {
      await deleteMessage(env, m.chat.id, m.message_id);
    }
    return;
  }

  if (!m || !m.from || typeof m.text !== 'string' || !m.text.startsWith('/')) return;
  const parts = m.text.trim().split(/\s+/);
  const [cmdName, cmdTarget] = parts[0].slice(1).split('@');

  // اگر BOT_USERNAME تنظیم شده باشد، دستورهایی که برای ربات دیگری در گروه نوشته شده (/attack@other_bot) نادیده گرفته می‌شود
  if (cmdTarget && env.BOT_USERNAME && cmdTarget.toLowerCase() !== String(env.BOT_USERNAME).replace(/^@/, '').toLowerCase()) return;

  const cmd = cmdName.toLowerCase();
  const priv = m.chat.type === 'private';
  const ctx = {
    env,
    private: priv,
    chat: m.chat.id,
    uid: m.from.id,
    uname: [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || 'بازیکن',
    args: parts.slice(1),
    rawArgs: m.text.trim().replace(/^\S+\s*/, ''),
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

async function sayThenRefresh(ctx, text) {
  await sayFlow(ctx, text);
  if (ctx.refreshAfter) {
    ctx.refreshAfter = false;
    await refreshBattlePanel(ctx.env, ctx.chat);
  }
}

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

async function resolveHits(ctx, target, defValue, label, special = null) {
  const { env, chat } = ctx;
  const rows = await all(env.DB, 'SELECT * FROM pending WHERE chat_id=? AND target_id=?', chat, target.user_id);

  if (!rows.length) return say(ctx, 'حمله‌ای منتظر دفاع این بازیکن نیست.');

  await clearResults(env, chat);
  const out = [];

  for (const r of rows) {
    const del = await run(env.DB, 'DELETE FROM pending WHERE id=?', r.id);
    if (del?.meta?.changes === 0) continue;

    const specialResult = special ? defenseResolution(special.kind, special.roll, r.dmg) : null;
    const defended = specialResult ? specialResult.defended : defValue;
    const reflected = specialResult ? specialResult.reflected : 0;
    const final = Math.max(0, r.dmg - defended);
    const res = await applyDamage(env, chat, target, final);
    target.hp = res.hp;

    if (reflected > 0) {
      const attacker = await getPlayer(env, chat, r.attacker_id);
      if (attacker?.alive) {
        const reflectedResult = await applyDamage(env, chat, attacker, reflected);
        out.push(`↩️ ${reflected} دمیج به مهاجم بازگشت؛ HP مهاجم: ${reflectedResult.hp}`);
      }
    }

    out.push(`${label}: دفاع ${defended} از ${r.dmg} دمیج؛ ${final} دمیج دریافت شد.\n❤️ جان ${mention(target)}: ${res.hp}${res.dead ? ' ☠️ حذف شد' : ''}`);

    await logEvent(env, {
      chat,
      user: target.user_id,
      kind: 'event',
      text: 'defend',
      data: {
        attacker: r.attacker_id,
        tech: r.tech,
        dmg: r.dmg,
        defense: defended,
        reflected,
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

// ---------- دستورهای مستر ----------

async function newgame(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر می‌تواند بازی بسازد.');

  const { env, chat } = ctx;

  await run(env.DB, "INSERT OR REPLACE INTO games (chat_id, status, turn_user) VALUES (?, 'lobby', 0)", chat);
  await run(env.DB, 'DELETE FROM players WHERE chat_id=?', chat);
  await run(env.DB, 'DELETE FROM pending WHERE chat_id=?', chat);
  await run(env.DB, 'DELETE FROM game_effects WHERE chat_id=?', chat);
  await run(env.DB, 'DELETE FROM summons WHERE chat_id=?', chat);
  await run(env.DB, 'DELETE FROM game_round_state WHERE chat_id=?', chat);
  await run(env.DB, 'DELETE FROM battle_ui WHERE chat_id=?', chat);

  try {
    await ensureBattlePanel(env, chat);
    await logEvent(env, { chat, user: ctx.uid, kind: 'event', text: 'newgame' });
  } catch (e) {
    console.error('newgame panel failed:', e);
    return say(ctx, '⚠️ بازی ساخته شد ولی ارسال پنل ثبت‌نام با خطا مواجه شد. دوباره /newgame بزن.');
  }
}

async function endgame(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر می‌تواند بازی را تمام کند.');

  const { env, chat } = ctx;
  const game = await getGame(env, chat);

  if (!game || game.status === 'ended') return say(ctx, 'بازی فعالی برای بستن وجود ندارد.');

  await run(env.DB, "UPDATE games SET status='ended' WHERE chat_id=?", chat);
  await run(env.DB, 'DELETE FROM pending WHERE chat_id=?', chat);

  try {
    await run(env.DB, 'DELETE FROM battle_turn_ui WHERE chat_id=?', chat);
  } catch (e) {
    console.error('battle_turn_ui reset failed:', e);
  }

  await logEvent(env, { chat, user: ctx.uid, kind: 'event', text: 'endgame', data: { was: game.status } });
  await say(ctx, '🏁 بازی توسط مستر بسته شد. برای شروع بازی جدید /newgame بزن.');
  await refreshBattlePanel(env, chat);
}

async function team(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');

  const tid = resolveId(ctx, ctx.args[1]);

  if (!tid || !ctx.args[0]) {
    return say(ctx, 'روی پیام بازیکن ریپلای کن: <code>/team نام_تیم</code> (حذف تیم: <code>/team -</code>)');
  }

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
  await run(env.DB, 'INSERT OR REPLACE INTO game_round_state (chat_id, round_no) VALUES (?,1)', chat);
  await ensureBattlePanel(env, chat);
}

async function buff(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');

  const kind = (ctx.args[0] || '').toLowerCase();
  const amount = parseInt(ctx.args[1], 10);
  const tid = resolveId(ctx, ctx.args[2]);

  if (!tid || !['hp', 'np'].includes(kind) || !amount) {
    return say(ctx, 'روی پیام بازیکن ریپلای کن: <code>/buff hp 20</code> یا <code>/buff np 30</code>');
  }

  const p = await getPlayer(ctx.env, ctx.chat, tid);

  if (!p) return say(ctx, 'این بازیکن در بازی نیست.');

  if (kind === 'hp') {
    const hp = Math.max(0, p.hp + amount);

    await run(ctx.env.DB, 'UPDATE players SET hp=?, max_hp=MAX(max_hp, ?), alive=? WHERE chat_id=? AND user_id=?', hp, hp, hp > 0 ? 1 : 0, ctx.chat, p.user_id);

    if (hp <= 0) {
      const win = await checkWin(ctx.env, ctx.chat);

      if (win) {
        ctx.refreshAfter = true;
        return sayThenRefresh(ctx, `✨ باف جان: ${mention(p)} → ❤️ 0 ☠️ حذف شد\n\n🏆 بازی تمام شد! برنده: ${win.length ? win.map(mention).join('، ') : 'هیچ‌کس'}`);
      }
    }

    return say(ctx, `✨ باف جان: ${mention(p)} → ❤️ ${hp}`);
  }

  const np = Math.max(0, p.np + amount);

  await run(ctx.env.DB, 'UPDATE players SET np=?, max_np=MAX(max_np, ?) WHERE chat_id=? AND user_id=?', np, np, ctx.chat, p.user_id);
  await say(ctx, `✨ باف انرژی: ${mention(p)} → 🔮 ${np}`);
}

async function effect(ctx) {
  if (!isMaster(ctx)) return say(ctx, 'فقط مستر.');

  const kind = (ctx.args[0] || '').toLowerCase();
  const tid = resolveId(ctx, ctx.args[1]);

  if (!tid || !['poison', 'drain', 'clear'].includes(kind)) {
    return say(ctx, 'روی پیام بازیکن ریپلای کن: <code>/effect poison</code> | <code>drain</code> | <code>clear</code>');
  }

  const p = await getPlayer(ctx.env, ctx.chat, tid);

  if (!p) return say(ctx, 'این بازیکن در بازی نیست.');

  const { env, chat } = ctx;

  if (kind === 'poison') await run(env.DB, 'UPDATE players SET poisoned=1 WHERE chat_id=? AND user_id=?', chat, p.user_id);
  if (kind === 'drain') await run(env.DB, 'UPDATE players SET drained=1 WHERE chat_id=? AND user_id=?', chat, p.user_id);
  if (kind === 'clear') await run(env.DB, 'UPDATE players SET poisoned=0, drained=0 WHERE chat_id=? AND user_id=?', chat, p.user_id);

  await say(ctx, `🌀 وضعیت ${mention(p)} ثبت شد: ${kind}\n(فعلاً فقط نشان داده می‌شود؛ اثرش را مستر دستی اعمال می‌کند.)`);
}

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

  if (!game || game.status !== 'lobby') return note(ctx, 'الان بازی‌ای در حالت ثبت‌نام نیست.');

  const key = (ctx.args[0] || '').toLowerCase();
  const c = own(CHARACTERS, key);

  if (!c || c.hidden) return note(ctx, 'کاراکتر پیدا نشد.');
  if (await getPlayer(env, chat, ctx.uid)) return note(ctx, 'قبلاً وارد شده‌ای.');

  const taken = await first(env.DB, 'SELECT user_id FROM players WHERE chat_id=? AND char_key=?', chat, key);
  if (taken) return note(ctx, 'این کاراکتر قبلاً انتخاب شده.');

  const cnt = await first(env.DB, 'SELECT COALESCE(MAX(seat), -1) + 1 AS n FROM players WHERE chat_id=?', chat);
  await run(
    env.DB,
    'INSERT INTO players (chat_id, user_id, name, char_key, hp, max_hp, np, max_np, seat) VALUES (?,?,?,?,?,?,?,?,?)',
    chat, ctx.uid, ctx.uname, key, c.hp, c.hp, c.np, c.np, cnt.n
  );

  await note(ctx, `✅ کاراکتر ${esc(c.name)} برای تو ثبت شد. ❤️ ${c.hp}  🔮 ${c.np}`);
  await refreshBattlePanel(env, chat);
}

async function chars(ctx) {
  const lines = Object.entries(CHARACTERS)
    .filter(([, c]) => !c.hidden)
    .map(([k, c]) => `<code>${k}</code> — ${esc(c.name)} (❤️${c.hp} 🔮${c.np})`);

  await say(ctx, '👤 کاراکترها:\n' + lines.join('\n'));
}

async function techs(ctx) {
  const p = await getPlayer(ctx.env, ctx.chat, ctx.uid);

  if (!p) return say(ctx, 'تو در بازی نیستی.');

  const keys = CHARACTERS[p.char_key]?.techs || [];

  const lines = keys.map((k) => {
    const t = TECHNIQUES[k];
    return t ? `<code>${k}</code> — ${esc(t.name)} (پایه ${t.base}، ${t.kind})` : '';
  }).filter(Boolean);

  await say(ctx, '⚔️ تکنیک‌های تو:\n' + lines.join('\n'));
}

async function defenses(ctx) {
  const lines = Object.entries(DEFENSES)
    .map(([k, d]) => `<code>${k}</code> — ${esc(d.name)} (پایه ${d.base} + ${d.perDie}×تاس)`);

  await say(ctx, '🛡 دفاع‌ها:\n' + lines.join('\n'));
}

async function status(ctx) {
  const { env, chat } = ctx;
  const game = await getGame(env, chat);

  if (!game) return say(ctx, 'بازی‌ای نیست. مستر /newgame بزند.');

  const players = await all(env.DB, 'SELECT * FROM players WHERE chat_id=? ORDER BY seat', chat);

  const lines = players.map((p) => {
    const flags = [
      p.poisoned ? '☠️مسموم' : '',
      p.drained ? '📉کاهش بازدهی' : '',
      p.team ? '👥' + esc(p.team) : ''
    ].filter(Boolean).join(' ');

    const turn = game.status === 'active' && p.user_id === game.turn_user ? '🎯 ' : '';

    return `${turn}${p.alive ? '' : '💀 '}${mention(p)} (${esc(CHARACTERS[p.char_key]?.name || p.char_key)}) ❤️${p.hp} 🔮${p.np} ${flags}`;
  });

  await say(ctx, `📋 وضعیت (${game.status}):\n` + (lines.join('\n') || 'بازیکنی نیست.'));
}

export async function attack(ctx) {
  const { env, chat } = ctx;
  const uid = ctx.uid;
  const game = await getGame(env, chat);

  if (!game || game.status !== 'active') return say(ctx, 'بازی فعال نیست.');
  if (game.turn_user !== uid) return say(ctx, 'نوبت تو نیست.');

  const me = await getPlayer(env, chat, uid);

  if (!me || !me.alive) return say(ctx, 'تو در بازی نیستی یا حذف شده‌ای.');
  if (await isSealed(env, chat, uid)) return say(ctx, 'تا زمانی که سیل فعال است امکان اجرای نوبت را نداری.');

  const waiting = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);

  if (waiting.n > 0) return say(ctx, 'هنوز دفاع حمله‌ی قبلی تمام نشده.');

  const key = (ctx.args[0] || '').toLowerCase();
  const tech = own(TECHNIQUES, key);

  if (!tech || !CHARACTERS[me.char_key]?.techs?.includes(key)) return say(ctx, 'این تکنیک مال تو نیست. لیست: /techs');
  const simpleDomainState = await getEffect(env, chat, uid, 'anti_domain_simple');
  const simpleDomainData = simpleDomainState ? JSON.parse(simpleDomainState.data_json || '{}') : null;
  if (simpleDomainState && !simpleDomainData?.canAttack) return say(ctx, 'با عهد الزام‌آور قلمروی نوین فقط دفاع و باف مجاز است.');
  if (await getEffect(env, chat, uid, 'anti_domain_wicker')) return say(ctx, 'تا وقتی هندساین سبد حصیری توخالی حفظ می‌شود، حمله مجاز نیست.');
  const amplificationState = await getEffect(env, chat, uid, 'domain_amplification');
  if (amplificationState && tech.attackType !== 'physical') return say(ctx, 'در حالت تقویت قلمرو فقط حملات فیزیکی مجاز است.');
  const exhausted = await getEffect(env, chat, uid, 'domain_exhausted');
  if (exhausted && Number(tech.base) >= 35) {
    return say(ctx, 'به‌دلیل پایان قلمرو، تا یک راند نمی‌توانی از حملات مرتبه مرگ به بالا استفاده کنی.');
  }

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

  const spamKey = `spam_attack:${key}`;
  const spamState = await getEffect(env, chat, uid, spamKey);
  if (spamState?.rounds_left > 0) {
    return say(ctx, `این تکنیک در محدودیت اسپم است و ${spamState.rounds_left} راند دیگر قابل استفاده نیست.`);
  }

  await clearResults(env, chat);
  const roll = rollAttack();
  const spamRounds = tech.kind === 'undefendable' ? 2 : tech.kind === 'aoe' ? 3 : 4;
  await setEffect(env, { chat, ownerId: uid, targetId: uid, type: spamKey, rounds: spamRounds, data: { technique: key, kind: tech.kind } });
  const head = `🎲 ${mention(me)}: مثبت ${roll.pos} − منفی ${roll.neg} = ${roll.result}`;

  if (roll.result === 0) {
    await logEvent(env, { chat, user: uid, kind: 'event', text: 'attack-neutral', data: { tech: key, roll } });
    return sayThenRefresh(ctx, `${head}\n😶 خنثی شد، اتفاقی نیفتاد.${await passTurn(ctx)}`);
  }

  const energyPenalty = energyRankPenalty(me.np);
  const poisonState = await getEffect(env, chat, uid, 'poison');
  const immuneToPoison = ['yuji', 'yuji_normal', 'yuji_modulo', 'sukuna', 'yuji_sukuna', 'meguna', 'heian_sukuna'].includes(String(me.char_key).toLowerCase());
  const poisonPenalty = poisonState && !immuneToPoison ? 1 : 0;
  const effectiveRankPenalty = energyPenalty + poisonPenalty + (amplificationState ? 2 : 0);
  const effectiveTech = effectiveRankPenalty > 0
    ? { ...tech, base: Math.max(0, Number(tech.base) - effectiveRankPenalty * 5) }
    : tech;

  if (roll.result < 0) {
    const mirrored = techDamage(effectiveTech, Math.abs(roll.result));
    const painRank = tech.rank === 'pain' || Number(tech.base) === 5;
    const cost = painRank ? 0 : npCost(mirrored, tech.kind);
    const deficit = Math.max(0, cost - Number(me.np || 0));
    const hpPenalty = deficit > 0 && me.hp >= 5 ? Math.ceil(deficit / 5) * 5 : 0;
    const exceptionalSealUser = ['naoya', 'naobito'].includes(String(me.char_key).toLowerCase());
    const selfDmg = tech.attackType === 'physical'
      ? physicalSelfDamage(Math.abs(roll.result))
      : tech.kind === 'seal' && !exceptionalSealUser
        ? 0
        : selfDamageFromTechnique(mirrored);

    // حتی در تاس منفی، هزینه انرژی قرینه تکنیک مصرف می‌شود؛ کمبود انرژی فقط دیباف حمله است.
    await run(env.DB,
      'UPDATE players SET np=MAX(0,np-?), hp=MAX(0,hp-?), alive=CASE WHEN hp-?>0 THEN alive ELSE 0 END WHERE chat_id=? AND user_id=?',
      Math.min(cost, Number(me.np || 0)), hpPenalty, hpPenalty, chat, uid
    );
    const res = selfDmg ? await applyDamage(env, chat, me, selfDmg) : { hp: Math.max(0, me.hp - hpPenalty), dead: me.hp - hpPenalty <= 0 };
    const finalHp = res.hp;
    const death = res.dead ? ' ☠️ حذف شدی.' : '';
    await logEvent(env, {
      chat, user: uid, kind: 'event',
      text: tech.kind === 'seal' ? 'seal-failed' : 'attack-self-damage',
      data: { tech: key, roll, mirrored_damage: mirrored, cost, np_deficit: deficit, hp_debuff: hpPenalty, energy_rank_penalty: energyPenalty, poison_rank_penalty: poisonPenalty, dmg: selfDmg, hp_after: finalHp, dead: res.dead }
    });

    const tail = await afterResolve(ctx);
    const description = tech.kind === 'seal' && !exceptionalSealUser
      ? 'مهروموم ناموفق بود؛ فقط NP آن هدر رفت.'
      : `حمله شکست خورد؛ ${selfDmg} دمیج خودزنی و ${hpPenalty} دمیج دیباف دریافت کردی.`;
    return sayThenRefresh(ctx, `${head}\n💥 ${description} ❤️ جان: ${finalHp}${death}${tail}`);
  }

  const dmg = techDamage(effectiveTech, roll.result);
  const domainEffect = await getEffect(env, chat, uid, 'domain');
  const domainData = domainEffect ? JSON.parse(domainEffect.data_json || '{}') : null;
  const domainGuaranteed = Boolean(domainEffect && domainData?.guaranteedHit);
  const effectiveCostKind = domainGuaranteed && tech.kind === 'normal' ? 'undefendable' : tech.kind;
  const painRank = tech.rank === 'pain' || Number(tech.base) === 5;
  const cost = painRank ? 0 : amplificationState ? dmg : npCost(dmg, effectiveCostKind);
  const npBefore = Number(me.np || 0);
  const deficit = Math.max(0, cost - npBefore);
  const hpPenalty = deficit > 0 ? Math.ceil(deficit / 5) * 5 : 0;

  if (hpPenalty > 0 && me.hp < 5) {
    return sayThenRefresh(ctx, `${head}\n💥 انرژی کافی نیست و برای دیباف حداقل ۵ HP لازم داری. حمله اجرا نشد.${await passTurn(ctx)}`);
  }

  const paid = await run(
    env.DB,
    'UPDATE players SET np=MAX(0,np-?), hp=MAX(0,hp-?), alive=CASE WHEN hp-?>0 THEN alive ELSE 0 END WHERE chat_id=? AND user_id=?',
    Math.min(cost, Number(me.np || 0)), hpPenalty, hpPenalty, chat, uid
  );
  if (paid?.meta?.changes === 0) return say(ctx, 'وضعیت بازیکن تغییر کرده؛ دوباره امتحان کن.');
  if (hpPenalty > 0) {
    const refreshed = await getPlayer(env, chat, uid);
    me.hp = refreshed?.hp ?? Math.max(0, me.hp - hpPenalty);
    me.np = 0;
    if (!refreshed?.alive || me.hp <= 0) {
      return sayThenRefresh(ctx, `${head}\n💥 دیباف به دلیل کمبود انرژی باعث حذف تو شد؛ حمله اجرا نشد.${await passTurn(ctx)}`);
    }
  } else {
    me.np = Math.max(0, me.np - cost);
  }
  const painBuff = painRank ? painRankNpBuff(dmg) : 0;
  if (painBuff > 0) {
    await run(env.DB, 'UPDATE players SET np=np+? WHERE chat_id=? AND user_id=?', painBuff, chat, uid);
    me.np += painBuff;
  }

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
      np_before: npBefore,
      targets: targets.map((t) => t.user_id)
    }
  });

  let text = `${head}\n⚔️ ${esc(tech.name)}: ${dmg} دمیج (هزینه ${cost} NP)${hpPenalty ? ` | دیباف: -${hpPenalty} HP` : ''}${painBuff ? ` | باف NP درد: +${painBuff}` : ''}`;

  if (tech.poison) {
    const poisonRounds = Math.floor(Math.max(0, roll.result) / 2);
    if (poisonRounds > 0) {
      for (const target of targets) {
        const targetKey = String(target.char_key || '').toLowerCase();
        if (!['yuji', 'yuji_normal', 'yuji_modulo', 'sukuna', 'yuji_sukuna', 'meguna', 'heian_sukuna'].includes(targetKey)) {
          await setEffect(env, { chat, ownerId: uid, targetId: target.user_id, type: 'poison', rounds: poisonRounds, data: { sourceTechnique: key } });
        }
      }
    }
  }

  const pendingTargets = [];
  for (const target of targets) {
    const targetAmp = await getEffect(env, chat, target.user_id, 'domain_amplification');
    const targetSimple = await getEffect(env, chat, target.user_id, 'anti_domain_simple');
    const targetWicker = await getEffect(env, chat, target.user_id, 'anti_domain_wicker');
    const targetBlossom = await getEffect(env, chat, target.user_id, 'anti_domain_blossom');
    let blossomBroken = false;
    let simpleBroken = false;
    let wickerBroken = false;

    if (domainGuaranteed && targetSimple) {
      const result = await damageAntiDomain(env, chat, target.user_id, 'anti_domain_simple', dmg);
      simpleBroken = Boolean(result.broken);
    }
    if (domainGuaranteed && targetWicker) {
      const result = await damageAntiDomain(env, chat, target.user_id, 'anti_domain_wicker', dmg);
      wickerBroken = Boolean(result.broken);
    }
    if (domainGuaranteed && targetBlossom) {
      const blossomResult = await damageAntiDomain(env, chat, target.user_id, 'anti_domain_blossom', dmg);
      if (!blossomResult.broken) {
        text += `\n🌸 احساس شکوفه در حال سقوط، ضربه تضمینی قلمرو را دفع کرد (${blossomResult.remaining} دمیج تا غیرفعال‌شدن).`;
        continue;
      }
      blossomBroken = true;
      text += '\n🌸 احساس شکوفه در حال سقوط شکست؛ اثر تضمینی قلمرو دوباره فعال شد.';
    }

    const guaranteedForTarget = domainGuaranteed && !targetAmp && (!targetSimple || simpleBroken) && (!targetWicker || wickerBroken) && (!targetBlossom || blossomBroken);
    const undefendableForTarget = tech.kind === 'undefendable' && !targetAmp;
    if (guaranteedForTarget || undefendableForTarget) {
      const res = await applyDamage(env, chat, target, dmg);
      text += `\n💢 ${mention(target)} ${dmg} دمیج خورد (${guaranteedForTarget ? 'ضربه تضمینی قلمرو' : 'غیرقابل‌دفاع'}). ❤️ ${res.hp}${res.dead ? ' ☠️ حذف شد' : ''}`;
      continue;
    }

    const incoming = targetAmp ? Math.ceil(dmg / 2) : dmg;
    await run(env.DB,
      'INSERT INTO pending (chat_id, attacker_id, target_id, dmg, tech) VALUES (?,?,?,?,?)',
      chat, uid, target.user_id, incoming, key
    );
    pendingTargets.push(target);
  }

  if (!pendingTargets.length) {
    text += await afterResolve(ctx);
    return sayThenRefresh(ctx, text);
  }

  text += `\n\n🛡 منتظر دفاع: ${pendingTargets.map(mention).join('، ')}`;

  await sayFlow(ctx, text);

  for (const t of pendingTargets) {
    const adjusted = await first(env.DB, 'SELECT dmg FROM pending WHERE chat_id=? AND target_id=? AND attacker_id=? ORDER BY id DESC LIMIT 1', chat, t.user_id, uid);
    const ok = await sendDefensePrompt(env, chat, t, me, adjusted?.dmg ?? dmg);

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
  const exhausted = await getEffect(ctx.env, ctx.chat, ctx.uid, 'domain_exhausted');
  if (exhausted && ['reinforced', 'advanced', 'absolute', 'reflect'].includes(key)) {
    return say(ctx, 'به‌دلیل پایان قلمرو، این سطح دفاع تا یک راند قابل استفاده نیست.');
  }

  const me = await getPlayer(ctx.env, ctx.chat, ctx.uid);

  if (!me || !me.alive) return say(ctx, 'بازیکن در بازی نیست.');

  const pending = await all(ctx.env.DB, 'SELECT id FROM pending WHERE chat_id=? AND target_id=?', ctx.chat, me.user_id);
  if (!pending.length) return say(ctx, 'حمله‌ای منتظر دفاع تو نیست.');

  await clearResults(ctx.env, ctx.chat);
  const special = def.mode === 'absolute' || def.mode === 'reflect';
  const roll = special ? d4() : d10();
  const value = special ? 0 : defenseValue(def, roll);
  const specialCost = special ? defenseResolution(def.mode, roll, 0).cost : 0;

  if (specialCost > 0 && Number(me.np || 0) < specialCost) {
    return say(ctx, `برای این دفاع ${specialCost} NP لازم داری؛ موجودی تو ${me.np} است.`);
  }
  if (specialCost > 0) {
    await run(ctx.env.DB, 'UPDATE players SET np=np-? WHERE chat_id=? AND user_id=? AND np>=?', specialCost, ctx.chat, me.user_id, specialCost);
  }

  await resolveHits(ctx, me, value, `🛡 ${esc(def.name)} (تاس ${roll}${specialCost ? `، هزینه ${specialCost} NP` : ''})`, special ? { kind: def.mode, roll } : null);
}

async function antiDomain(ctx) {
  const { env, chat, uid } = ctx;
  const me = await getPlayer(env, chat, uid);
  if (!me?.alive) return say(ctx, 'تو در بازی نیستی یا حذف شده‌ای.');
  const action = String(ctx.args[0] || '').toLowerCase();

  if (action === 'simple') {
    const vow = String(ctx.args[1] || '').toLowerCase() === 'vow';
    const kusakabe = String(me.char_key).toLowerCase() === 'kusakabe';
    if (!vow && !kusakabe) return say(ctx, 'برای قلمروی نوین باید عهد الزام‌آور را با /antidomain simple vow اعلام کنی.');
    if (Number(me.np || 0) < 25) return say(ctx, 'قلمروی نوین ۲۵ NP لازم دارد.');
    const roll = d9();
    const result = await activateSimpleDomain(env, { chat, userId: uid, positiveRoll: roll, bindingVow: vow, character: me.char_key });
    await run(env.DB, 'UPDATE players SET np=np-25 WHERE chat_id=? AND user_id=?', chat, uid);
    return say(ctx, `🛡 قلمروی نوین فعال شد؛ تاس ${roll}، مدت ${result.rounds} راند، هزینه ۲۵ NP.${vow ? ' عهد الزام‌آور فعال است؛ فقط دفاع و باف مجاز است.' : ''}`);
  }

  if (action === 'wicker') {
    if (String(ctx.args[1] || '').toLowerCase() === 'reinforce') {
      const game = await getGame(env, chat);
      if (!game || game.status !== 'active' || game.turn_user !== uid) return say(ctx, 'تقویت سبد حصیری فقط در نوبت خودت انجام می‌شود.');
      const result = await reinforceHollowWickerBasket(env, chat, uid);
      return sayThenRefresh(ctx, `سبد حصیری تقویت شد؛ آستانه نابودی ${result.breakAtDamage} دمیج است.${await passTurn(ctx)}`);
    }
    if (Number(me.np || 0) < 20) return say(ctx, 'سبد حصیری توخالی ۲۰ NP لازم دارد.');
    await activateHollowWickerBasket(env, { chat, userId: uid });
    await run(env.DB, 'UPDATE players SET np=np-20 WHERE chat_id=? AND user_id=?', chat, uid);
    return say(ctx, '🧺 سبد حصیری توخالی فعال شد؛ باید هندساین را حفظ کنی. حمله ممنوع است.');
  }

  if (action === 'blossom') {
    if (Number(me.np || 0) < 30) return say(ctx, 'احساس شکوفه در حال سقوط ۳۰ NP لازم دارد.');
    const result = await activateFallingBlossom(env, { chat, userId: uid });
    await run(env.DB, 'UPDATE players SET np=np-30 WHERE chat_id=? AND user_id=?', chat, uid);
    return say(ctx, `🌸 احساس شکوفه در حال سقوط فعال شد؛ آستانه غیرفعال‌شدن ${result.breakAtDamage} دمیج است.`);
  }

  if (action === 'amplification') {
    const rounds = Math.max(1, Math.min(9, Number(ctx.args[1]) || 1));
    const cost = rounds * 15;
    if (Number(me.np || 0) < cost) return say(ctx, `تقویت قلمرو برای ${rounds} راند ${cost} NP لازم دارد.`);
    await activateDomainAmplification(env, { chat, userId: uid, rounds });
    await run(env.DB, 'UPDATE players SET np=np-? WHERE chat_id=? AND user_id=?', cost, chat, uid);
    return say(ctx, `🌀 تقویت قلمرو برای ${rounds} راند فعال شد؛ ${cost} NP مصرف شد.`);
  }

  return say(ctx, 'روش‌ها: /antidomain simple [vow] | wicker | wicker reinforce | blossom | amplification [rounds]');
}

async function domain(ctx) {
  const { env, chat, uid } = ctx;
  const game = await getGame(env, chat);
  if (!game || game.status !== 'active') return say(ctx, 'بازی فعال نیست.');
  if (game.turn_user !== uid) return say(ctx, 'نوبت تو نیست.');
  const me = await getPlayer(env, chat, uid);
  if (!me?.alive) return say(ctx, 'تو در بازی نیستی یا حذف شده‌ای.');
  if (await isSealed(env, chat, uid)) return say(ctx, 'در حالت سیل نمی‌توانی قلمرو فعال کنی.');
  const waiting = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
  if (waiting?.n > 0) return say(ctx, 'ابتدا دفاع حمله‌ی قبلی باید تمام شود.');

  const barrier = String(ctx.args[0] || '').toLowerCase();
  const spec = DOMAIN_BARRIERS[barrier];
  if (!spec) return say(ctx, 'نوع حصار: low | high | open | incomplete');
  if (await getEffect(env, chat, uid, 'domain')) return say(ctx, 'قلمرو تو از قبل فعال است.');
  if (Number(me.np || 0) < spec.np) {
    return sayThenRefresh(ctx, `برای این قلمرو ${spec.np} NP لازم است؛ موجودی تو ${me.np} است.${await passTurn(ctx)}`);
  }

  const activeDomains = await all(env.DB, "SELECT * FROM game_effects WHERE chat_id=? AND effect_type='domain' AND rounds_left>0", chat);
  for (const active of activeDomains) {
    const otherData = JSON.parse(active.data_json || '{}');
    if (otherData.barrier === 'incomplete' || barrier === 'incomplete') {
      return say(ctx, 'قانون برخورد قلمرو ناقص با این نوع حصار در متن هادی مشخص نشده؛ این کلش را مستر باید تعیین کند.');
    }
  }

  const roll = d9();
  const result = await activateDomain(env, {
    chat, ownerId: uid, barrier, positiveRoll: roll,
    data: { character: me.char_key }
  });
  await run(env.DB, 'UPDATE players SET np=np-? WHERE chat_id=? AND user_id=? AND np>=?', result.npCost, chat, uid, result.npCost);

  let clashText = '';
  const others = activeDomains.filter(x => x.owner_id !== uid);
  for (const other of others) {
    const otherData = JSON.parse(other.data_json || '{}');
    const winner = domainClashWinner(otherData.barrier, barrier);
    if (winner === 'tie') {
      otherData.guaranteedHit = false;
      const myData = { barrier, guaranteedHit: false, character: me.char_key };
      await setEffect(env, { chat, ownerId: other.owner_id, targetId: other.target_id, type: 'domain', rounds: other.rounds_left, data: otherData });
      await setEffect(env, { chat, ownerId: uid, targetId: uid, type: 'domain', rounds: result.rounds, data: myData });
      clashText = '\\n⚔️ دومین کلش مساوی شد؛ حملات تضمینی دو قلمرو برای صاحبانشان قابل دفاع است.';
    } else if (winner === 'a') {
      await removeEffect(env, chat, uid, 'domain');
      clashText = '\\n⚔️ قلمرو حریف قوی‌تر بود و قلمرو تو را نابود کرد.';
      break;
    } else if (winner === 'b') {
      await removeEffect(env, chat, other.target_id, 'domain');
      clashText = '\\n⚔️ قلمرو تو برنده کلش شد و قلمرو حریف نابود شد.';
    }
  }

  const tail = await afterResolve(ctx);
  return sayThenRefresh(ctx, `🏯 گسترش قلمرو فعال شد: ${spec.name}\n🎲 تاس مثبت: ${roll}\n⏳ مدت: ${result.rounds} راند\n🔮 مصرف NP: ${result.npCost}${clashText}${tail}`);
}

async function rct(ctx) {
  const { env, chat, uid } = ctx;
  const game = await getGame(env, chat);
  if (!game || game.status !== 'active') return say(ctx, 'بازی فعال نیست.');
  if (game.turn_user !== uid) return say(ctx, 'نوبت تو نیست.');
  const me = await getPlayer(env, chat, uid);
  if (!me?.alive) return say(ctx, 'تو در بازی نیستی یا حذف شده‌ای.');
  const waiting = await first(env.DB, 'SELECT COUNT(*) AS n FROM pending WHERE chat_id=?', chat);
  if (waiting?.n > 0) return say(ctx, 'ابتدا دفاع حمله‌ی قبلی باید تمام شود.');

  const rctSpam = await getEffect(env, chat, uid, 'spam_rct');
  if (rctSpam?.rounds_left > 0) return say(ctx, `ریورس کرس تکنیک تا ${rctSpam.rounds_left} راند دیگر در محدودیت اسپم است.`);
  const roll = d9();
  const result = reverseCursedResult(roll);
  await setEffect(env, { chat, ownerId: uid, targetId: uid, type: 'spam_rct', rounds: 2 });
  if (!result) return say(ctx, 'نتیجه تاس برای ریورس نامعتبر است.');
  if (Number(me.np || 0) < result.np) {
    return sayThenRefresh(ctx, `🌀 ریورس کرس تکنیک: تاس ${roll}؛ ${result.np} NP لازم بود ولی ${me.np} داری. تکنیک اجرا نشد.${await passTurn(ctx)}`);
  }

  await run(env.DB,
    'UPDATE players SET np=np-?, hp=hp+?, max_hp=MAX(max_hp,hp+?) WHERE chat_id=? AND user_id=? AND np>=?',
    result.np, result.hp, result.hp, chat, uid, result.np
  );
  await logEvent(env, {
    chat, user: uid, kind: 'event', text: 'reverse-cursed-technique',
    data: { roll, hp_buff: result.hp, np_cost: result.np }
  });
  const tail = await afterResolve(ctx);
  return sayThenRefresh(ctx, `🌀 ریورس کرس تکنیک: تاس ${roll}\n❤️ باف HP: +${result.hp}\n🔮 مصرف NP: ${result.np}${tail}`);
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
      '/rct — تکنیک نفرینی معکوس',
      '/domain low|high|open|incomplete — گسترش قلمرو',
      '/antidomain simple|wicker|blossom|amplification — ضدقلمرو',
      '/nodefend — بدون دفاع',
      '',
      '<b>مستر</b>',
      '/newgame /begin /endgame',
      '/team نام — (ریپلای)',
      '/buff hp|np عدد — (ریپلای)',
      '/effect poison|drain|clear — (ریپلای)',
      '/nodefend — (ریپلای) رد کردن دفاع یک بازیکن',
      '',
      '<b>گزارش مشکل</b>',
      '/bug توضیح — (ریپلای روی پیامی که مشکل داشت) ثبت گزارش',
      '/id — آیدی عددی تو و چت',
      '<b>بررسی (فقط مستر/سازنده):</b> /bugs /bugshow N /bugdone N /bugopen N /bugexport /logs',
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
  endgame,
  techs,
  defenses,
  attack,
  defend,
  domain,
  rct,
  nodefend,
  status,
  buff,
  effect,
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
