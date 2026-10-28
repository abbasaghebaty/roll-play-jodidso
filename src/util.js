import { send } from './telegram.js';

export const say = (ctx, text) => send(ctx.env, ctx.chat, text, ctx.msgId);

// در پیوی ربات (حالت تست) هر کاربر مستر بازی خودش است
export function isMaster(ctx) {
  if (ctx.private) return true;
  return (ctx.env.MASTER_IDS || '').split(',').map((s) => s.trim()).includes(String(ctx.uid));
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
