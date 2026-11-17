// رنک‌های دفاع مطابق مرجع هادی.
// جاخالی مقدار وابسته به تاس دارد؛ سایر دفاع‌های عادی مقدار ثابت دارند.
export const DEFENSES = {
  dodge: { name: 'جاخالی', kind: 'dodge', base: 0, perDie: 5 },
  simple: { name: 'دفاع ساده', kind: 'rank', value: 15 },
  reinforced: { name: 'دفاع تقویت‌شده', kind: 'rank', value: 25 },
  advanced: { name: 'دفاع پیشرفته', kind: 'rank', value: 30 },
  absolute: { name: 'دفاع مطلق', kind: 'absolute' },
  reflect: { name: 'رفلکت', kind: 'reflect' },
};
