// Canonical base-damage ranks for attacks. Edit rank values here only.
// ---------- رنک‌های پایه حمله ----------
// فقط داده‌های قطعی رنک‌ها؛ هنوز به تکنیک‌ها یا محاسبه دمیج متصل نشده‌اند.
// اتصال هر تکنیک به رنک باید جداگانه و بر اساس داده واقعی همان تکنیک انجام شود.
export const ATTACK_RANKS = Object.freeze({
  pain: Object.freeze({ id: "pain", name: "درد", baseDamage: 5 }),
  scratch: Object.freeze({ id: "scratch", name: "خراش", baseDamage: 10 }),
  ash: Object.freeze({ id: "ash", name: "خاکستر", baseDamage: 15 }),
  wound: Object.freeze({ id: "wound", name: "زخم", baseDamage: 20 }),
  blood: Object.freeze({ id: "blood", name: "خون", baseDamage: 25 }),
  shadow: Object.freeze({ id: "shadow", name: "سایه", baseDamage: 30 }),
  death: Object.freeze({ id: "death", name: "مرگ", baseDamage: 35 }),
  disaster: Object.freeze({ id: "disaster", name: "فاجعه", baseDamage: 40 }),
  chaos: Object.freeze({ id: "chaos", name: "آشوب", baseDamage: 45 }),
  decay: Object.freeze({ id: "decay", name: "پوسیدگی", baseDamage: 50 }),
  crisis: Object.freeze({ id: "crisis", name: "بحران", baseDamage: 55 }),
  madness: Object.freeze({ id: "madness", name: "جنون", baseDamage: 60 })
});

// دریافت دمیج پایه رنک؛ برای شناسه ناشناخته null برمی‌گرداند تا خطا پنهان نشود.
export function getAttackRankBaseDamage(rankId) {
  return ATTACK_RANKS[rankId]?.baseDamage ?? null;
}

