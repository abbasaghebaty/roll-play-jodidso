// قوانین مرجع هادی — منبع واحد محاسبات رول‌پلی جوجوتسو کایسن.
// این ماژول مستقل از تلگرام و D1 است تا همهٔ مسیرهای بازی از یک فرمول استفاده کنند.

export const ATTACK_RANKS = Object.freeze({
  pain: 5, scratch: 10, ash: 15, wound: 20, blood: 25,
  shadow: 30, death: 35, catastrophe: 40, chaos: 45,
  decay: 50, crisis: 55, madness: 60,
});

export const DEFENSE_RANKS = Object.freeze({
  dodge: 5, simple: 15, reinforced: 25, advanced: 30,
});

export const BUFF_RANKS = Object.freeze({
  simple: 5, super: 15, reinforced: 15, special: 25,
});

export const DOMAIN_BARRIER_COSTS = Object.freeze({
  low: 70, high: 75, open: 80, incomplete: 75,
});

export const DOMAIN_BARRIER_BREAK = Object.freeze({
  low: Object.freeze({ outside: 70, inside: 100 }),
  high: Object.freeze({ outside: 90, inside: 135 }),
});

export const ANTI_DOMAIN = Object.freeze({
  simpleDomain: 25,
  hollowWickerBasket: 20,
  fallingBlossomEmotion: 30,
  hollowWickerBasketReinforcedBreak: 75,
  hollowWickerBasketBreak: 50,
  domainAmplificationPerRound: 15,
  hollowWickerBasketDomainDamage: 65,
  newShadowStyleBreakWithBindingVow: 60,
  newShadowStyleBreakWithoutBindingVow: 70,
});

export const SUMMON_RULES = Object.freeze({
  activeCost: 20,
  countSacrificeDefense: 25,
  maxEternalSummons: 2,
});

export const SEAL_COSTS = Object.freeze({ singleRound: 10 });
export const MOOD_COSTS = Object.freeze({ eternal: 20 });

export const RCT_TIERS = Object.freeze([
  { min: 1, max: 3, hp: 60, np: 40 },
  { min: 4, max: 6, hp: 65, np: 45 },
  { min: 7, max: 9, hp: 70, np: 50 },
]);

export const EXPOSURE_TARGETS = Object.freeze([
  { min: 1, max: 2, targets: 1 },
  { min: 3, max: 4, targets: 2 },
  { min: 5, max: 6, targets: 3 },
  { min: 7, max: 8, targets: 4 },
  { min: 9, max: 9, targets: 5 },
]);

export const SELF_DAMAGE_PHYSICAL = Object.freeze([
  { min: 1, max: 3, damage: 10 },
  { min: 4, max: 6, damage: 20 },
  { min: 7, max: 9, damage: 30 },
]);

export const ETERNAL_SUMMON_SELF_DAMAGE = Object.freeze([
  { min: 1, max: 4, damage: 10 },
  { min: 5, max: 7, damage: 20 },
  { min: 8, max: 9, damage: 30 },
]);

export function attackDamage(baseDamage, positiveResult) {
  const roll = Math.trunc(Number(positiveResult));
  const base = Math.max(0, Math.trunc(Number(baseDamage) || 0));
  if (roll < 1 || roll > 9) return 0;
  return base + (roll - 1) * 5;
}

export function npCost(damage, kind = 'normal') {
  const half = Math.floor(Math.max(0, Number(damage) || 0) / 2);
  if (kind === 'undefendable') return half + 5;
  if (kind === 'aoe') return half + 10;
  if (kind === 'exposure') return 5;
  if (kind === 'pain') return 0;
  return half;
}

function tierValue(tiers, roll, key) {
  const n = Math.abs(Math.trunc(Number(roll)));
  return tiers.find(t => n >= t.min && n <= t.max)?.[key] ?? 0;
}

export function selfDamageTechnique(baseDamage, negativeResult) {
  const magnitude = Math.abs(Math.trunc(Number(negativeResult)));
  return Math.floor(attackDamage(baseDamage, magnitude) / 2);
}

export function physicalSelfDamage(negativeResult) {
  return tierValue(SELF_DAMAGE_PHYSICAL, negativeResult, 'damage');
}

export function eternalSummonSelfDamage(negativeResult) {
  return tierValue(ETERNAL_SUMMON_SELF_DAMAGE, negativeResult, 'damage');
}

export function defenseResult(kind, positiveRoll, incomingDamage) {
  const roll = Math.trunc(Number(positiveRoll));
  const damage = Math.max(0, Math.trunc(Number(incomingDamage) || 0));
  if (kind === 'absolute' || kind === 'reflect') {
    if (roll < 1 || roll > 4) return { defended: 0, reflected: 0, cost: 0 };
    const amount = roll <= 3 ? Math.ceil(damage / 2) : damage;
    return kind === 'absolute'
      ? { defended: amount, reflected: 0, cost: roll <= 3 ? 20 : 25 }
      : { defended: 0, reflected: amount, cost: roll <= 3 ? 25 : 30 };
  }
  const minimum = DEFENSE_RANKS[kind];
  return { defended: minimum && roll > 0 ? minimum : 0, reflected: 0, cost: 0 };
}

export function rctResult(positiveRoll) {
  const roll = Math.trunc(Number(positiveRoll));
  return RCT_TIERS.find(t => roll >= t.min && roll <= t.max) || null;
}

export function exposureTargetCount(positiveRoll) {
  return tierValue(EXPOSURE_TARGETS, positiveRoll, 'targets');
}

export function domainRounds(positiveRoll) {
  return Math.floor(Math.max(0, Math.trunc(Number(positiveRoll))) / 2);
}

export function sealDefenseRounds(positiveRoll) {
  return Math.floor(Math.max(0, Math.trunc(Number(positiveRoll))) / 2);
}

export function antiDomainRounds(positiveRoll) {
  return domainRounds(positiveRoll);
}

export function energyRankPenalty(np) {
  const energy = Math.max(0, Number(np) || 0);
  if (energy < 50) return 2;
  if (energy < 100) return 1;
  return 0;
}

export function debuffHpCost(missingNp) {
  return Math.ceil(Math.max(0, Number(missingNp) || 0) / 5) * 5;
}

export function poisonRounds(positiveRoll) {
  return Math.floor(Math.max(0, Math.trunc(Number(positiveRoll))) / 2);
}

export function domainAmplificationDamage(incomingDamage) {
  return Math.ceil(Math.max(0, Number(incomingDamage) || 0) / 2);
}

export function domainAmplificationBuff(baseBuff) {
  return Math.max(0, Number(baseBuff) || 0) + 5;
}

export function domainAmplificationAttackCost(damage) {
  return Math.max(0, Math.trunc(Number(damage) || 0));
}

export function barrierBreakThreshold(barrier, side) {
  return DOMAIN_BARRIER_BREAK[barrier]?.[side] ?? null;
}
