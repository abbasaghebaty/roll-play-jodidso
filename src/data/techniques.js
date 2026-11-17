// تکنیک‌ها؛ base برابر دمیج تاس مثبت ۱ است.
// kind: normal | aoe | undefendable | seal
// attackType: projectile | physical
export const TECHNIQUES = {
  punch: { name: 'مشت', base: 10, rank: 'scratch', kind: 'normal', attackType: 'physical' },
  blackflash: { name: 'بلک فلش', base: 40, rank: 'calamity', kind: 'normal', attackType: 'physical' },

  // تکنیک‌های تستی برای بررسی نوع هزینه؛ فقط در محیط تست باید به شخصیت‌ها وصل شوند.
  test_aoe: { name: 'تست همگانی', base: 30, rank: 'blood', kind: 'aoe', attackType: 'projectile', test: true },
  test_undef: { name: 'تست غیرقابل‌دفاع', base: 30, rank: 'blood', kind: 'undefendable', attackType: 'projectile', test: true },
};
