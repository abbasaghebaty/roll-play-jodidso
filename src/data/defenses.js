// رنک‌های دفاع مطابق مرجع هادی.
// سطح‌های عادی مقدار پایهٔ دفاع‌اند؛ مطلق و رفلکت تابع تاس و هزینهٔ مستقل دارند.
export const DEFENSES = Object.freeze({
  dodge: { name: 'جاخالی', base: 5, perDie: 0, kind: 'dodge', npCost: 0 },
  simple: { name: 'ساده', base: 15, perDie: 0, kind: 'simple', npCost: null },
  reinforced: { name: 'تقویت‌شده', base: 25, perDie: 0, kind: 'reinforced', npCost: null },
  advanced: { name: 'پیشرفته', base: 30, perDie: 0, kind: 'advanced', npCost: null },
  absolute: { name: 'مطلق', base: 0, perDie: 0, kind: 'absolute', npCost: 'roll' },
  reflect: { name: 'رفلکت', base: 0, perDie: 0, kind: 'reflect', npCost: 'roll' },
});
