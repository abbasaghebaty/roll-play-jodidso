// Canonical base-value ranks for buffs. Incomplete fields stay intentionally absent.
// ---------- رنک‌های پایه باف ----------
// این جدول فقط مقدار پایه هر سطح و رایگان‌بودن سطح ساده را نگه می‌دارد.
// نوع اثر، مدت و هزینه سایر سطوح تا زمان نهایی‌شدن قوانین عمداً تعریف نشده‌اند.
export const BUFF_RANKS = Object.freeze({
  simple: Object.freeze({ id: "simple", name: "ساده", baseValue: 5, free: true }),
  super: Object.freeze({ id: "super", name: "سوپر", baseValue: 15 }),
  reinforced: Object.freeze({ id: "reinforced", name: "تقویت‌شده", baseValue: 15 }),
  special: Object.freeze({ id: "special", name: "ویژه", baseValue: 25 })
});

// دریافت مقدار پایه سطح باف؛ برای شناسه ناشناخته null برمی‌گرداند.
export function getBuffRankBaseValue(rankId) {
  return BUFF_RANKS[rankId]?.baseValue ?? null;
}

