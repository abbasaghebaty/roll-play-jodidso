// قوانین فعلی بازی؛ مبنای مقادیر از توضیحات /rules و فایل testmode.js است.
// هزینه‌ی اضافه: همگانی (AOE) = ۱۰ NP ، غیرقابل‌دفاع = ۵ NP (طبق قوانین توافق‌شده).
export const STEP = 5;
export const MAX_SPAM = 2;
export const AOE_EXTRA = 10;
export const UNDEFENDABLE_EXTRA = 5;

export function d10() {
  return Math.floor(Math.random() * 10) + 1;
}

// نتیجه = تاس مثبت - تاس منفی؛ نتیجه‌های صفر و منفی خنثی‌اند.
export function rollAttack() {
  const pos = d10();
  const neg = d10();
  return { pos, neg, result: pos - neg };
}

export function techDamage(tech, result) {
  if (!tech || !Number.isFinite(Number(tech.base)) || !Number.isFinite(Number(result))) return 0;
  return Math.max(0, Number(tech.base) + STEP * (Number(result) - 1));
}

// نصف دمیج، رو به پایین تا مضرب ۵، سپس ۵ هزینه پایه.
// نوع AOE و undefendable هزینه اضافه دارند.
export function npCost(dmg, kind = 'normal') {
  const base = Math.floor((Math.max(0, Number(dmg) || 0) / 2) / 5) * 5 + 5;
  if (kind === 'aoe') return base + AOE_EXTRA;
  if (kind === 'undefendable') return base + UNDEFENDABLE_EXTRA;
  return base;
}

export function defenseValue(defense, roll) {
  if (!defense) return 0;
  return Math.max(0, Number(defense.base) + Number(defense.perDie) * Number(roll));
}
