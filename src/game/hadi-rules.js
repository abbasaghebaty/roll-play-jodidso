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
      : { defended: amount, reflected: amount, cost: roll <= 3 ? 25 : 30 };
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

// محدودیت‌های استفاده که مقدارشان در مرجع هادی صریح است.
export const SPAM_COOLDOWNS = Object.freeze({
  normalAttack: 3,
  undefendableAttack: 2,
  aoeAttack: 2,
  aoeUndefendableAttack: 2,
  rct: 2,
  buff: 3,
});

export const BUFF_HP_BY_RANK = Object.freeze({
  simple: 5,
  super: 15,
  reinforced: 15,
  special: 25,
});

export const SUMMON_RULES_FULL = Object.freeze({
  activeCost: 20,
  countSacrificeDefense: 25,
  maxEternalSummons: 2,
  extraTurnsPerEternalSummon: 1,
});

export const SEAL_RULES = Object.freeze({
  singleTurnNpCost: 10,
  antiSealRoundsAfterRelease: 1,
});

export const DOMAIN_RULES = Object.freeze({
  guaranteedHitExceptions: Object.freeze(['higuruma', 'hakari', 'megumi']),
  postDomainNoDeathRankRounds: 1,
  postDomainNoHighDefenseRounds: 1,
});

export const EMPTY_BARRIER_RULES = Object.freeze({
  cost: 35,
  low: Object.freeze({ rounds: 0, positiveRoll: 0 }),
  high: Object.freeze({ rounds: 1, positiveRoll: 3 }),
  open: Object.freeze({ rounds: 2, positiveRoll: 5 }),
});

export const DOMAIN_AMPLIFICATION_RULES = Object.freeze({
  npPerRound: 15,
  techniqueRankPenalty: 2,
  incomingDamageReduction: 0.5,
  buffBonus: 5,
});

export const NEW_SHADOW_STYLE_RULES = Object.freeze({
  cost: 25,
  breakWithBindingVow: 60,
  breakWithoutBindingVow: 70,
});

export const HOLLOW_WICKER_BASKET_RULES = Object.freeze({
  cost: 20,
  break: 50,
  reinforcedBreak: 75,
  reinforcedDomainDamageBlock: 0.5,
});

export const FALLING_BLOSSOM_EMOTION_RULES = Object.freeze({
  cost: 30,
  break: 65,
});

export function cooldownForAttack(kind = 'normal', undefendable = false) {
  if (kind === 'aoe' && undefendable) return SPAM_COOLDOWNS.aoeUndefendableAttack;
  if (kind === 'aoe') return SPAM_COOLDOWNS.aoeAttack;
  if (undefendable || kind === 'undefendable') return SPAM_COOLDOWNS.undefendableAttack;
  return SPAM_COOLDOWNS.normalAttack;
}

export function buffValue(rank) {
  return BUFF_HP_BY_RANK[rank] ?? 0;
}

export function sealCanBeResisted(defenseKind, positiveRoll, sealType = 'single') {
  const roll = Math.trunc(Number(positiveRoll));
  if (roll <= 0) return false;
  if (sealType === 'single') {
    return ['simple', 'reinforced', 'advanced', 'absolute', 'reflect'].includes(defenseKind);
  }
  return ['reinforced', 'advanced'].includes(defenseKind) ||
    (['absolute', 'reflect'].includes(defenseKind) && roll <= 3);
}

export function sealResistanceRounds(defenseKind, positiveRoll, sealType = 'round') {
  if (!sealCanBeResisted(defenseKind, positiveRoll, sealType)) return 0;
  const roll = Math.max(0, Math.trunc(Number(positiveRoll)));
  if (['absolute', 'reflect'].includes(defenseKind)) return Math.ceil(roll / 2);
  return sealType === 'single' ? 1 : 1;
}

export function summonDefenseResult(isQuantitative, sacrificed) {
  return isQuantitative && sacrificed ? SUMMON_RULES.countSacrificeDefense : 0;
}

export function antiDomainBreakThreshold(kind, reinforced = false, bindingVow = false) {
  if (kind === 'new-shadow-style') {
    return bindingVow
      ? NEW_SHADOW_STYLE_RULES.breakWithBindingVow
      : NEW_SHADOW_STYLE_RULES.breakWithoutBindingVow;
  }
  if (kind === 'hollow-wicker-basket') {
    return reinforced
      ? HOLLOW_WICKER_BASKET_RULES.reinforcedBreak
      : HOLLOW_WICKER_BASKET_RULES.break;
  }
  if (kind === 'falling-blossom-emotion') return FALLING_BLOSSOM_EMOTION_RULES.break;
  return null;
}

export function emptyBarrierRequirement(barrier) {
  return EMPTY_BARRIER_RULES[barrier] ?? null;
}

export function domainHasGuaranteedHit(characterKey) {
  return !DOMAIN_RULES.guaranteedHitExceptions.includes(String(characterKey || '').toLowerCase());
}

export function poisonAttackRankPenalty(positiveRoll) {
  return Math.floor(Math.max(0, Math.trunc(Number(positiveRoll))) / 2);
}

export function canPayCost(np, cost) {
  return Math.max(0, Number(np) || 0) >= Math.max(0, Number(cost) || 0);
}
