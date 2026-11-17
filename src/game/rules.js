// قوانین عددی عمومی. جدول احتمال تاس فعلی حفظ شده چون متن هادی احتمال/ساختار تاس را تغییر نداده.
import { positiveDamage, attackNpCost } from './hadi-rules.js';

export const STEP = 5;
export const AOE_EXTRA = 10;
export const UNDEFENDABLE_EXTRA = 5;

export const DICE_WEIGHTS = Object.freeze({
  1: 5, 2: 7, 3: 8, 4: 10, 5: 20,
  6: 20, 7: 10, 8: 8, 9: 7, 10: 5
});

export const POSITIVE_DICE_WEIGHTS = Object.freeze({
  1: 5, 2: 5, 3: 5, 4: 9, 5: 19,
  6: 21, 7: 12, 8: 10, 9: 8, 10: 6
});

export const RESULT_LABELS = Object.freeze([
  { min: 7, max: 9, label: 'موفقیت فوق‌العاده' },
  { min: 4, max: 6, label: 'موفقیت قوی' },
  { min: 1, max: 3, label: 'موفقیت معمولی' },
  { min: 0, max: 0, label: 'وضعیت خنثی' },
  { min: -3, max: -1, label: 'شکست نسبی' },
  { min: -6, max: -4, label: 'شکست سنگین' },
  { min: -9, max: -7, label: 'شکست بحرانی' }
]);

function secureInt(maxExclusive) {
  const range = 0x100000000;
  const limit = range - (range % maxExclusive);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
}

function checkWeights(weights) {
  let total = 0;
  for (const [face, weight] of Object.entries(weights)) {
    if (!Number.isInteger(Number(face)) || !Number.isInteger(weight) || weight <= 0) {
      throw new Error(`DICE_WEIGHTS نامعتبر است: ${face} → ${weight}`);
    }
    total += weight;
  }
  if (total !== 100) throw new Error(`مجموع DICE_WEIGHTS باید ۱۰۰ باشد، الان ${total} است`);
  return total;
}

export function weightedDie(weights = DICE_WEIGHTS) {
  let pick = secureInt(checkWeights(weights));
  for (const [face, weight] of Object.entries(weights)) {
    if (pick < weight) return Number(face);
    pick -= weight;
  }
  throw new Error('weightedDie: انتخاب ناموفق');
}

export function d10() {
  return secureInt(10) + 1;
}

export function d4() {
  return secureInt(4) + 1;
}

export function d9() {
  return secureInt(9) + 1;
}

export function resultLabel(result) {
  return RESULT_LABELS.find(x => result >= x.min && result <= x.max)?.label || 'نامعتبر';
}

export function rollAttack() {
  const pos = weightedDie(POSITIVE_DICE_WEIGHTS);
  const neg = weightedDie(DICE_WEIGHTS);
  const result = pos - neg;
  const label = resultLabel(result);
  const signed = result > 0 ? `+${result}` : String(result);
  const text = `🔵 تاس آبی: ${pos}\n🔴 تاس قرمز: ${neg}\nمحاسبه: ${pos} - ${neg} = ${signed}\nوضعیت: <b>${label}</b>`;
  return { pos, neg, result, label, text };
}

export function techDamage(tech, result) {
  if (!tech || !Number.isFinite(Number(tech.base)) || !Number.isFinite(Number(result))) return 0;
  return positiveDamage(tech.base, result);
}

export function npCost(dmg, kind = 'normal') {
  return attackNpCost(dmg, kind);
}

export function defenseValue(defense, roll) {
  if (!defense) return 0;
  return Math.max(0, Number(defense.base) + Number(defense.perDie || 0) * Number(roll));
}
