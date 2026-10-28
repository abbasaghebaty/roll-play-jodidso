// تکنیک‌ها. kind: normal (عادی) | aoe (همگانی، همه‌ی دشمن‌ها) | undefendable (غیرقابل‌دفاع)
// base = دمیج پایه (با عدد تاس ۱). به ازای هر عدد بعدی ۵ اضافه می‌شود.
export const TECHNIQUES = {
  // punch فقط یک تکنیک موقتی است تا ماکی بتواند بازی کند؛ عددش را رفیقت بدهد.
  punch: { name: 'مشت', base: 10, kind: 'normal' },
  blackflash: { name: 'بلک فلش', base: 40, kind: 'normal' },

  // فقط برای تست انواع هزینه (در پیوی ربات همه‌ی تکنیک‌ها قابل استفاده‌اند)
  test_aoe: { name: 'تست همگانی', base: 30, kind: 'aoe', test: true },
  test_undef: { name: 'تست غیرقابل‌دفاع', base: 30, kind: 'undefendable', test: true },
};
