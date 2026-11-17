import { ANTI_DOMAIN, simpleDomainDamageLimit, domainRounds } from './hadi-rules.js';
import { setEffect, getEffect, removeEffect } from './effects.js';

export { ANTI_DOMAIN, simpleDomainDamageLimit, domainRounds };

export async function activateSimpleDomain(env, { chat, userId, positiveRoll, bindingVow = true, character = '' }) {
  const rounds = domainRounds(positiveRoll);
  if (!rounds) throw new Error('برای فعال‌سازی قلمروی نوین تاس مثبت لازم است.');
  const unrestricted = String(character).toLowerCase() === 'kusakabe';
  await setEffect(env, {
    chat, ownerId: userId, targetId: userId, type: 'anti_domain_simple', rounds,
    data: { bindingVow, unrestricted, breakAtDamage: simpleDomainDamageLimit(bindingVow), canDefend: true, canBuff: true, canAttack: unrestricted }
  });
  return { rounds, npCost: ANTI_DOMAIN.simpleDomain.np, breakAtDamage: simpleDomainDamageLimit(bindingVow), canAttack: unrestricted };
}

export async function activateHollowWickerBasket(env, { chat, userId }) {
  const rounds = 0;
  await setEffect(env, {
    chat, ownerId: userId, targetId: userId, type: 'anti_domain_wicker', rounds,
    data: { handsLocked: true, canAttack: false, canDefend: true, canBuff: true, reinforced: false, breakAtDamage: 50 }
  });
  return { rounds, npCost: ANTI_DOMAIN.hollowWickerBasket.np };
}

export async function reinforceHollowWickerBasket(env, chat, userId) {
  const effect = await getEffect(env, chat, userId, 'anti_domain_wicker');
  if (!effect) throw new Error('سبد حصیری توخالی فعال نیست.');
  const data = JSON.parse(effect.data_json || '{}');
  data.reinforced = true;
  data.breakAtDamage = 75;
  await setEffect(env, { chat, ownerId: userId, targetId: userId, type: 'anti_domain_wicker', rounds: effect.rounds_left, data });
  return { breakAtDamage: 75, consumesTurn: true };
}

export async function activateFallingBlossom(env, { chat, userId }) {
  const rounds = 0;
  await setEffect(env, {
    chat, ownerId: userId, targetId: userId, type: 'anti_domain_blossom', rounds,
    data: { automaticDomainDamageDefense: true, breakAtDamage: 65 }
  });
  return { rounds, npCost: ANTI_DOMAIN.fallingBlossom.np, breakAtDamage: 65 };
}

export async function activateDomainAmplification(env, { chat, userId, rounds = 1 }) {
  await setEffect(env, {
    chat, ownerId: userId, targetId: userId, type: 'domain_amplification', rounds,
    data: { cancelGuaranteedHit: true, halveIncomingDamage: true, buffBonus: 5, attackRankPenalty: 2, physicalOnly: true }
  });
  return { rounds, npCostPerRound: ANTI_DOMAIN.domainAmplification.npPerRound };
}

export async function damageAntiDomain(env, chat, userId, type, damage) {
  const effect = await getEffect(env, chat, userId, type);
  if (!effect) return { active: false, broken: false };
  const data = JSON.parse(effect.data_json || '{}');
  const next = Math.max(0, Number(data.damageTaken || 0) + Math.max(0, Number(damage) || 0));
  data.damageTaken = next;
  if (next >= Number(data.breakAtDamage || Infinity)) {
    await removeEffect(env, chat, userId, type);
    return { active: false, broken: true, damageTaken: next };
  }
  await setEffect(env, { chat, ownerId: effect.owner_id, targetId: userId, type, rounds: effect.rounds_left, data });
  return { active: true, broken: false, damageTaken: next, remaining: data.breakAtDamage - next };
}
