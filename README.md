# Anime RPG Bot (Cloudflare Workers + D1)

## ساختار

- `src/index.js`: ورودی Worker و اعتبارسنجی webhook
- `src/commands.js`: دستورهای ربات
- `src/util.js` و `src/testmode.js`: ابزارهای کمکی و حالت تست
- `src/report.js`: ثبت گزارش مشکل (`/bug`) و بررسی گزارش‌ها و لاگ‌ها
- `src/log.js`: ذخیره‌ی لاگ در دیتابیس
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
7. در تنظیم webhook تلگرام، همان مقدار `WEBHOOK_SECRET` را در فیلد `secret_token` بفرست. این مقدار باید با secret ثبت‌شده در Cloudflare دقیقاً یکسان باشد. در PowerShell (آدرس و مقدارها را عوض کن):

```powershell
$token = "BOT_TOKEN_اینجا"
$secret = "WEBHOOK_SECRET_اینجا"
$url = "https://anime-rpg-bot.<ساب‌دامین-تو>.workers.dev"
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType "application/json" -Body (@{ url = $url; secret_token = $secret; allowed_updates = @("message") } | ConvertTo-Json)
```

8. بعد از هر آپدیت که `schema.sql` عوض شده، دوباره دستور مرحله ۳ را اجرا کن (بی‌خطر است و جدول‌های جدید `logs` و `reports` را می‌سازد).
9. در گروه، اگر مستر به‌صورت «ادمین ناشناس» (Anonymous) پیام بدهد هم مستر حساب می‌شود.

## گزارش مشکل و لاگ

هر دستور ورودی، هر پیام ربات، هر تاس/دمیج/دفاع و هر خطا در جدول `logs` ثبت می‌شود.

**مستر (رفیقت) هنگام تست:** روی پیام مشکل‌دار ریپلای کند و بنویسد:

```
/bug این‌جا دمیج اشتباه حساب شد
```

(`/report` و `/باگ` و `/مشکل` هم همین کار را می‌کنند.) گزارش همراه متن همان پیام، وضعیت کامل بازی در همان لحظه و ۲۵ لاگ آخر ذخیره می‌شود.

**بررسی (فقط MASTER_IDS و OWNER_IDS):**

- `/bugs` لیست گزارش‌های باز (`/bugs all` همه، `/bugs done` بسته‌شده‌ها)
- `/bugshow 3` جزئیات کامل گزارش ۳: متن، پیام، وضعیت بازی، لاگ‌ها
- `/bugdone 3 توضیح` بستن گزارش، `/bugopen 3` باز کردن دوباره
- `/bugexport` فایل JSON همه‌ی گزارش‌های باز (برای فرستادن به من)، `/bugexport all` همه
- `/logs 30` سی لاگ آخر همین چت
- `/id` آیدی عددی خودت (برای پر کردن `OWNER_IDS` در `wrangler.toml`)

اگر خطای داخلی پیش بیاید، ربات خودش در چت خبر می‌دهد (با شماره‌ی لاگ) و خطا در `logs` ثبت می‌شود؛ دیگر تلگرام همان دستور را بارها تکرار نمی‌کند.

## نکته درباره قوانین

`STEP=5` و `MAX_SPAM=2` و هزینه‌ی اضافه‌ی همگانی (`AOE_EXTRA=10`) و غیرقابل‌دفاع (`UNDEFENDABLE_EXTRA=5`) طبق قوانین توافق‌شده‌اند. اگر چیزی تغییر کرد، فقط `src/game/rules.js` را عوض کن.

تکنیک موقتی `punch` با `free: true` NP مصرف نمی‌کند، چون ماکی NP صفر دارد و وگرنه هیچ‌وقت نمی‌توانست حمله کند. وقتی تکنیک‌های واقعی ماکی آمد، این را عوض کن.

## تست و دیپلوی

```powershell
npx wrangler deploy
```

برای دیدن لاگ‌های Worker:

```powershell
npx wrangler tail
```
