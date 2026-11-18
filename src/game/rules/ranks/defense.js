// Canonical base-value ranks for defenses. Edit rank values here only.
// ---------- رنک‌های پایه دفاع ----------
// مقادیر قطعی اعلام‌شده؛ هنوز به فرمول دفاع زنده متصل نشده‌اند.
export const DEFENSE_RANKS = Object.freeze({
  dodge: Object.freeze({ id: "dodge", name: "جاخالی", baseValue: 5 }),
  simple: Object.freeze({ id: "simple", name: "ساده", baseValue: 15 }),
  reinforced: Object.freeze({ id: "reinforced", name: "تقویت‌شده", baseValue: 25 }),
  advanced: Object.freeze({ id: "advanced", name: "پیشرفته", baseValue: 30 })
});

// دریافت مقدار پایه رنک دفاع؛ شناسه ناشناخته null برمی‌گرداند.
export function getDefenseRankBaseValue(rankId) {
  return DEFENSE_RANKS[rankId]?.baseValue ?? null;
}

