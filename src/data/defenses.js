// دفاع‌ها طبق رنک‌بندی مرجع هادی.
// دفاع‌های مطلق و رفلکت با تاس ۱ تا ۴ و فرمول ویژه در موتور مبارزه پردازش می‌شوند.
export const DEFENSES = Object.freeze({
  dodge: { name: 'جاخالی', base: 5, perDie: 0, free: true, mode: 'fixed' },
  simple: { name: 'ساده', base: 15, perDie: 0, mode: 'fixed' },
  reinforced: { name: 'تقویت‌شده', base: 25, perDie: 0, mode: 'fixed' },
  advanced: { name: 'پیشرفته', base: 30, perDie: 0, mode: 'fixed' },
  absolute: { name: 'مطلق', base: 0, perDie: 0, mode: 'absolute' },
  reflect: { name: 'رفلکت', base: 0, perDie: 0, mode: 'reflect' },
});
