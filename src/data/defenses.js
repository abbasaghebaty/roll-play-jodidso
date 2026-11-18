// دفاع‌ها؛ مقادیر رتبه از جدول canonical قوانین می‌آیند.
import { DEFENSE_RANKS } from '../game/rules/ranks/defense.js';

// مقدار دفاع فعلی = base + perDie × تاس d10.
// فقط جاخالی در داده‌های زنده تعریف شده؛ سه سطح دیگر تا تعیین رفتارشان اضافه نمی‌شوند.
export const DEFENSES = {
  dodge: {
    name: 'جاخالی',
    rank: 'dodge',
    base: 0,
    perDie: DEFENSE_RANKS.dodge.baseValue,
  },
};
