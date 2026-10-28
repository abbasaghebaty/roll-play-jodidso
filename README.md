# Anime RPG Bot (Cloudflare Workers + D1)

## ساختار

- `src/index.js`: ورودی Worker و اعتبارسنجی webhook
- `src/commands.js`: دستورهای ربات
- `src/util.js` و `src/testmode.js`: ابزارهای کمکی و حالت تست
- `src/game/rules.js`: قوانین تاس، دمیج، هزینه و دفاع
- `src/game/engine.js`: منطق بازی
- `src/data/`: کاراکترها، تکنیک‌ها و دفاع‌ها
- `schema.sql`: ساخت جدول‌های اصلی D1

## راه‌اندازی

1. در پوشه پروژه، وابستگی Wrangler را در صورت نیاز نصب/اجرا کن:
   `npx wrangler --version`
2. مطمئن شو دیتابیس D1 با شناسه داخل `wrangler.toml` همان دیتابیس موردنظرت است.
3. اگر جدول‌ها هنوز ساخته نشده‌اند، یک‌بار اجرا کن:
   `npx wrangler d1 execute anime-rpg --remote --file=./schema.sql`
4. توکن ربات را به‌صورت secret ثبت کن:
   `npx wrangler secret put BOT_TOKEN`
5. یک secret تصادفی برای webhook بساز و ثبت کن:
   `npx wrangler secret put WEBHOOK_SECRET`
6. دیپلوی:
   `npx wrangler deploy`
7. در تنظیم webhook تلگرام، همان مقدار `WEBHOOK_SECRET` را در فیلد `secret_token` بفرست. این مقدار باید با secret ثبت‌شده در Cloudflare دقیقاً یکسان باشد.

## نکته درباره قوانین

`STEP=5` و `MAX_SPAM=2` از توضیحات موجود در `testmode.js` استخراج شده‌اند. مقدارهای `AOE_EXTRA` و `UNDEFENDABLE_EXTRA` در فایل‌های قابل‌دسترسی مشخص نبودند؛ در این نسخه هر دو روی ۱۰ گذاشته شده‌اند تا پروژه build شود. اگر مقدار توافق‌شده بازی متفاوت است، فقط همین دو مقدار را در `src/game/rules.js` عوض کن.

## تست و دیپلوی

```powershell
npx wrangler deploy
```

برای دیدن لاگ‌های Worker:

```powershell
npx wrangler tail
```
