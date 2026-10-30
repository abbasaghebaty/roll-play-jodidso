import { send } from './telegram.js';
import { sendResult } from './game/cleanup.js';

export const say = (ctx, text) => send(ctx.env, ctx.chat, text, ctx.msgId);

// خطا/اطلاع کوتاه: اگر از دکمه آمده باشد فقط برای همان کسی که کلیک کرده پاپ‌آپ می‌شود (نه پیام گروه)
export const note = (ctx, text) => (ctx.alert ? ctx.alert(text) : say(ctx, text));

// نتیجه‌ی بازی: در گروه پیام قبلیِ نتیجه حذف می‌شود تا گروه شلوغ نشود
export const sayFlow = (ctx, text) =>
  ctx.private ? say(ctx, text) : sendResult(ctx.env, ctx.chat, text, ctx.interactive ? undefined : ctx.msgId);

const idList = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

// جست‌وجوی امن در آبجکت‌ها: «constructor» و «__proto__» را به‌عنوان کلید قبول نمی‌کند
export function own(obj, key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

// در پیوی ربات (حالت تست) هر کاربر مستر بازی خودش است.
// ادمینِ ناشناس گروه (Anonymous Admin) هم مستر حساب می‌شود، چون تلگرام آیدی واقعی‌اش را نمی‌فرستد.
export function isMaster(ctx) {
  if (ctx.private || ctx.anonAdmin) return true;
  return idList(ctx.env.MASTER_IDS).includes(String(ctx.uid));
}

// دسترسی به بررسی گزارش‌ها و لاگ‌ها: MASTER_IDS و OWNER_IDS (بدون میان‌بُر پیوی)
export function isStaff(ctx) {
  return [...idList(ctx.env.MASTER_IDS), ...idList(ctx.env.OWNER_IDS)].includes(String(ctx.uid));
}

// d1 → -1 ، d2 → -2 (بازیکن‌های دامی در حالت تست آیدی منفی دارند)
export function dummyId(arg) {
  const m = /^d(\d+)$/i.exec(arg || '');
  return m ? -parseInt(m[1], 10) : null;
}

// هدف: ریپلای (در گروه) یا me / d1 / d2 (در پیوی)
export function resolveId(ctx, arg) {
  if (ctx.reply) return ctx.reply.id;
  if (!arg) return null;
  if (arg.toLowerCase() === 'me') return ctx.uid;
  return dummyId(arg);
}
