// کاراکترها. فقط ماکی و یوجی عدد واقعی دارند؛ بقیه را از رفیقت بگیر و همین‌جا اضافه کن.
// hp = جان، np = انرژی نفرین، techs = کلید تکنیک‌ها از فایل techniques.js
export const CHARACTERS = {
  maki: { name: 'ماکی زنین', hp: 200, np: 0, techs: ['punch'] },
  yuji: { name: 'یوجی ایتادوری', hp: 205, np: 210, techs: ['punch', 'blackflash'] },
  // نمونه برای اضافه کردن:
  // gojo: { name: 'ساتورو گوجو', hp: 0, np: 0, techs: [] },

  // دامی حالت تست (در /chars و /join نمایش داده نمی‌شود)
  dummy: { name: 'دامی', hp: 500, np: 500, techs: ['punch', 'blackflash', 'test_aoe', 'test_undef'], hidden: true },
};
