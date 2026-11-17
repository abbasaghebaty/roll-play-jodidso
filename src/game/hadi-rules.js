// قوانین مرجع هادی برای رول‌پلی جوجوتسو کایسن.
// این فایل منبع واحد ثابت‌ها و محاسبات خالص است؛ وضعیت‌های زمان‌دار در D1 نگهداری می‌شوند.

export const ATTACK_RANKS = Object.freeze([
  { key: 'pain', name: 'درد', base: 5, free: true, npBuffRatio: 1 / 3 },
  { key: 'scratch', name: 'خراش', base: 10 },
  { key: 'ash', name: 'خاکستر', base: 15 },
  { key: 'wound', name: 'زخم', base: 20 },
  { key: 'blood', name: 'خون', base: 25 },
  { key: 'shadow', name: 'سایه', base: 30 },
  { key: 'death', name: 'مرگ', base: 35 },
  { key: 'calamity', name: 'فاجعه', base: 40 },
  { key: 'chaos', name: 'آشوب', base: 45 },
  { key: 'decay', name: 'پوسیدگی', base: 50 },
  { key: 'crisis', name: 'بحران', base: 55 },
  { key: 'madness', name: 'جنون', base: 60 },
]);

export const DEFENSE_RANKS = Object.freeze({
  dodge: { name: 'جاخالی', base: 5, free: true, type: 'movement' },
  simple: { name: 'ساده', base: 15, type: 'cover' },
  reinforced: { name: 'تقویت‌شده', base: 25, type: 'cover' },
  advanced: { name: 'پیشرفته', base: 30, type: 'cover' },
  absolute: { name: 'مطلق', partialRoll: [1, 3], fullRoll: 4, partialCost: 20, fullCost: 25 },
  reflect: { name: 'رفلکت', partialRoll: [1, 3], fullRoll: 4, partialCost: 25, fullCost: 30 },
});

export const BUFF_RANKS = Object.freeze([
  { key: 'simple', name: 'ساده', base: 5, free: true },
  { key: 'super', name: 'سوپر', base: 15 },
  { key: 'reinforced', name: 'تقویت‌شده', base: 15 },
  { key: 'special', name: 'ویژه', base: 25 },
]);

export const REVERSE_CURSED_HEAL = Object.freeze([
  { min: 1, max: 3, hp: 60, np: 40 },
  { min: 4, max: 6, hp: 65, np: 45 },
  { min: 7, max: 9, hp: 70, np: 50 },
]);

export const DOMAIN_BARRIERS = Object.freeze({
  low: { name: 'حصار سطح پایین', np: 70, hpOutside: 70, hpInside: 100 },
  high: { name: 'حصار سطح بالا', np: 75, hpOutside: 90, hpInside: 135 },
  open: { name: 'حصار باز', np: 80 },
  incomplete: { name: 'حصار ناقص', np: 75 },
});

export const ANTI_DOMAIN = Object.freeze({
  simpleDomain: { name: 'قلمروی نوین', np: 25, breakDamageWithVow: 60, breakDamageWithoutVow: 70 },
  hollowWickerBasket: { name: 'سبد حصیری توخالی', np: 20, breakDamage: 50, reinforcedBreakDamage: 75 },
  fallingBlossom: { name: 'احساس شکوفه در حال سقوط', np: 30, breakDamage: 65 },
  domainAmplification: { name: 'تقویت قلمرو', npPerRound: 15, attackRankPenalty: 2, buffBonus: 5 },
  hollowWickerBarrier: { name: 'حصار توخالی', np: 35 },
});

export const SUMMONS = Object.freeze({
  countSacrificeDefense: 25,
  activeNpCost: 20,
  eternalSelfDamage: [
    { min: 1, max: 4, hp: 10 },
    { min: 5, max: 7, hp: 20 },
    { min: 8, max: 9, hp: 30 },
  ],
});

export const SEALS = Object.freeze({
  oneRoundNp: 10,
  antiSealRounds: 1,
  // برای سیل راندی: هر دو مثبت یک راند دفاع؛ مطلق/رفلکت در مثبت ۱ تا ۳ نصف راندها.
});

export const SPAM_LIMITS = Object.freeze({
  normalAttack: 3,
  undefendableAttack: 2,
  aoeAttack: 3,
  reverseCursedTechnique: 2,
  buff: 3,
});

export const ENERGY_THRESHOLDS = Object.freeze([
  { below: 50, rankPenalty: 2 },
  { below: 100, rankPenalty: 1 },
]);

export const POISON = Object.freeze({ positivePerRound: 2, rankPenalty: 1 });
export const UNBUFFABLE_DAMAGE = Object.freeze({
  reverseHealPenalty: 35,
  specialCharacterRankPenalty: 1,
  reverseBuffDeduction: 10,
});

export function positiveDamage(base, positiveResult) {
  const roll = Math.max(1, Math.floor(Number(positiveResult) || 1));
  return Math.max(0, Math.floor(Number(base) || 0) + 5 * (roll - 1));
}

export function attackNpCost(damage, kind = 'normal') {
  const half = Math.floor(Math.max(0, Number(damage) || 0) / 2);
  if (kind === 'undefendable') return half + 5;
  if (kind === 'aoe') return half + 10;
  return half;
}

export function painRankNpBuff(damage) {
  return Math.floor(Math.max(0, Number(damage) || 0) / 3);
}

export function selfDamageFromTechnique(mirroredDamage) {
  return Math.floor(Math.max(0, Number(mirroredDamage) || 0) / 2);
}

export function physicalSelfDamage(positiveMagnitude) {
  const n = Math.abs(Math.floor(Number(positiveMagnitude) || 0));
  if (n >= 7 && n <= 9) return 30;
  if (n >= 4 && n <= 6) return 20;
  if (n >= 1 && n <= 3) return 10;
  return 0;
}

export function defenseResolution(kind, roll, incomingDamage) {
  const d = Math.max(0, Math.floor(Number(incomingDamage) || 0));
  const r = Math.floor(Number(roll) || 0);
  if (kind === 'absolute' || kind === 'reflect') {
    if (r === 4) return { defended: d, reflected: kind === 'reflect' ? d : 0, cost: kind === 'absolute' ? 25 : 30 };
    if (r >= 1 && r <= 3) {
      const amount = Math.ceil(d / 2);
      return { defended: amount, reflected: kind === 'reflect' ? amount : 0, cost: kind === 'absolute' ? 20 : 25 };
    }
    return { defended: 0, reflected: 0, cost: 0 };
  }
  const base = DEFENSE_RANKS[kind]?.base || 0;
  return { defended: base, reflected: 0, cost: 0 };
}

export function reverseCursedResult(roll) {
  const r = Math.floor(Number(roll) || 0);
  return REVERSE_CURSED_HEAL.find(x => r >= x.min && r <= x.max) || null;
}

export function energyRankPenalty(np) {
  const value = Math.max(0, Number(np) || 0);
  return ENERGY_THRESHOLDS.find(x => value < x.below)?.rankPenalty || 0;
}

export function domainRounds(positiveResult) {
  return Math.ceil(Math.max(0, Number(positiveResult) || 0) / 2);
}

export function sealRoundsDefended(positiveResult) {
  return Math.ceil(Math.max(0, Number(positiveResult) || 0) / 2);
}

export function simpleDomainDamageLimit(bindingVow = true) {
  return bindingVow ? ANTI_DOMAIN.simpleDomain.breakDamageWithVow : ANTI_DOMAIN.simpleDomain.breakDamageWithoutVow;
}

export function domainBarrierBreakDamage(barrier, fromOutside) {
  const item = DOMAIN_BARRIERS[barrier];
  if (!item) return null;
  return fromOutside ? (item.hpOutside ?? null) : (item.hpInside ?? null);
}

export function domainClashWinner(a, b) {
  const rank = { low: 1, high: 2, open: 2 };
  if (!(a in rank) || !(b in rank)) return 'unresolved';
  const ar = rank[a];
  const br = rank[b];
  if (ar === br) return 'tie';
  return ar > br ? 'a' : 'b';
}

export function sealTargetCount(roll) {
  const r = Math.floor(Number(roll) || 0);
  if (r <= 2) return 1;
  if (r <= 4) return 2;
  if (r <= 6) return 3;
  if (r <= 8) return 4;
  if (r === 9) return 5;
  return 0;
}
