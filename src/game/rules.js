// ============================================================================
// src/game/rules.js
// قوانین عددی بازی: تاس، دمیج، هزینهٔ NP و مقدار دفاع.
// این فایل هیچ ارتباطی با دیتابیس یا تلگرام ندارد (توابع خالص).
// ============================================================================

// ---------- ثابت‌های قوانین ----------
export const STEP = 5;                 // هر پلهٔ نتیجهٔ تاس = +۵ دمیج
export const AOE_EXTRA = 10;           // هزینهٔ اضافهٔ NP برای حملهٔ ناحیه‌ای
export const UNDEFENDABLE_EXTRA = 5;   // هزینهٔ اضافهٔ NP برای حملهٔ غیرقابل‌دفاع

// ---------- جدول احتمال تاس ----------
// کلید = عدد تاس، مقدار = وزن (درصد). مجموع هر جدول باید دقیقاً ۱۰۰ باشد.
// تاس قرمز از جدول اصلی استفاده می‌کند؛ تاس آبی کمی به اعداد بالاتر متمایل شده است.
export const DICE_WEIGHTS = Object.freeze({
  1: 5,
  2: 7,
  3: 8,
  4: 10,
  5: 20,
  6: 20,
  7: 10,
  8: 8,
  9: 7,
  10: 5
});

// وزن‌های تاس آبی؛ مجموع ۱۰۰ و طوری تنظیم شده که:
// با حفظ احتمال تساوی، حدود ۵۵٪ نتایج غیرخنثی مثبت و ۴۵٪ منفی باشند.
export const POSITIVE_DICE_WEIGHTS = Object.freeze({
  1: 5,
  2: 5,
  3: 5,
  4: 9,
  5: 19,
  6: 21,
  7: 12,
  8: 10,
  9: 8,
  10: 6
});

// ---------- دسته‌بندی نتیجهٔ نهایی (فقط برای نمایش شدت نتیجه) ----------
// به ترتیب از بالا به پایین بررسی می‌شود؛ min..max شامل دو سر بازه است.
export const RESULT_LABELS = Object.freeze([
  { min: 7, max: 9, label: "موفقیت فوق‌العاده" },
  { min: 4, max: 6, label: "موفقیت قوی" },
  { min: 1, max: 3, label: "موفقیت معمولی" },
  { min: 0, max: 0, label: "وضعیت خنثی" },
  { min: -3, max: -1, label: "شکست نسبی" },
  { min: -6, max: -4, label: "شکست سنگین" },
  { min: -9, max: -7, label: "شکست بحرانی" }
]);

// ---------- تولید عدد تصادفی امن و بدون سوگیری ----------
// از crypto.getRandomValues استفاده می‌کند و برای حذف سوگیری باقی‌مانده (modulo bias)
// مقادیر بالای بزرگ‌ترین مضرب کامل مجموع وزن‌ها دور ریخته می‌شود (rejection sampling).
function secureInt(maxExclusive) {
  const range = 0x100000000; // 2^32
  const limit = range - (range % maxExclusive);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
}

// بررسی سالم بودن جدول (اعداد صحیح مثبت، مجموع دقیقاً ۱۰۰)
function checkWeights(weights) {
  let total = 0;
  for (const [face, w] of Object.entries(weights)) {
    if (!Number.isInteger(Number(face)) || !Number.isInteger(w) || w <= 0) {
      throw new Error(`DICE_WEIGHTS نامعتبر است: ${face} → ${w}`);
    }
    total += w;
  }
  if (total !== 100) throw new Error(`مجموع DICE_WEIGHTS باید ۱۰۰ باشد، الان ${total} است`);
  return total;
}

// یک تاس وزنی. weights را می‌شود برای تست جایگزین کرد؛ پیش‌فرض جدول اصلی است.
export function weightedDie(weights = DICE_WEIGHTS) {
  const total = checkWeights(weights);
  let pick = secureInt(total);
  for (const [face, w] of Object.entries(weights)) {
    if (pick < w) return Number(face);
    pick -= w;
  }
  throw new Error("weightedDie: انتخاب ناموفق (نباید رخ دهد)");
}

// ---------- تاس ساده d10 (فقط برای دفاع؛ طبق قانون «هر دفاع تاس خودش را دارد») ----------
export function d10() {
  return secureInt(10) + 1;
}

// ---------- برچسب وضعیت نتیجه ----------
export function resultLabel(result) {
  const r = RESULT_LABELS.find((x) => result >= x.min && result <= x.max);
  return r ? r.label : "نامعتبر";
}

// ---------- تاس حمله: آبی (مثبت) منهای قرمز (منفی) ----------
// دو تاس مستقل‌اند؛ آبی از جدول متمایل به اعداد بالاتر و قرمز از جدول اصلی استفاده می‌کند.
// خروجی: pos = تاس آبی، neg = تاس قرمز، result = pos - neg (بین -۹ تا +۹)،
// label = وضعیت، text = متن آمادهٔ نمایش در پیام.
export function rollAttack() {
  const pos = weightedDie(POSITIVE_DICE_WEIGHTS);
  const neg = weightedDie(DICE_WEIGHTS);
  const result = pos - neg;
  const label = resultLabel(result);
  const signed = result > 0 ? `+${result}` : String(result);
  const text =
    `🔵 تاس آبی: ${pos}\\n` +
    `🔴 تاس قرمز: ${neg}\\n` +
    `محاسبه: ${pos} - ${neg} = ${signed}\\n` +
    `وضعیت: <b>${label}</b>`;
  return { pos, neg, result, label, text };
}

// ---------- دمیج، هزینهٔ NP و دفاع (بدون تغییر نسبت به نسخهٔ قبل) ----------
export function techDamage(tech, result) {
  if (!tech || !Number.isFinite(Number(tech.base)) || !Number.isFinite(Number(result))) return 0;
  return Math.max(0, Number(tech.base) + STEP * (Number(result) - 1));
}

export function npCost(dmg, kind = "normal") {
  const base = Math.floor(Math.max(0, Number(dmg) || 0) / 2 / 5) * 5 + 5;
  if (kind === "aoe") return base + AOE_EXTRA;
  if (kind === "undefendable") return base + UNDEFENDABLE_EXTRA;
  return base;
}

export function defenseValue(defense, roll) {
  if (!defense) return 0;
  return Math.max(0, Number(defense.base) + Number(defense.perDie) * Number(roll));
}
