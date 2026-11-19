# ربات رول‌پلی انیمه

ربات گروهی رول‌پلی و مبارزه بر پایه‌ی **Cloudflare Workers، D1 و Telegram Bot API**. این فایل نقشه‌ی پروژه است تا برای تغییر یک قابلیت، لازم نباشد همه‌ی کدها از ابتدا بررسی شوند.

## نمای کلی ساختار

```text
.
├── README.md
├── wrangler.toml
├── schema.sql
├── migrations/
│   ├── 0001_combat_actions.sql
│   └── 0002_combat_turn_claim.sql
├── docs/
│   └── jujutsu/
│       ├── README.md
│       ├── DECISIONS.md
│       ├── IMPLEMENTATION-STATUS.md
│       └── 01..11-topic-files.md
├── tests/
│   ├── rules.test.mjs
│   ├── atomic-combat.test.mjs
│   ├── catalog-search.test.mjs
│   ├── private-selection.test.mjs
│   └── import-paths.test.mjs
├── .github/workflows/validate.yml
└── src/
    ├── index.js
    ├── commands.js              # backward-compatible entry point
    ├── commands/
    │   ├── index.js
    │   ├── admin.js
    │   ├── players.js
    │   ├── combat.js
    │   └── helpers.js
    ├── db.js
    ├── telegram.js
    ├── util.js
    ├── log.js
    ├── report.js
    ├── testmode.js
    ├── data/
    │   ├── characters.js
    │   ├── techniques.js
    │   └── defenses.js
    └── game/
        ├── engine.js
        ├── rules.js              # backward-compatible entry point
        ├── rules/
        │   ├── index.js
        │   ├── constants.js
        │   ├── dice.js
        │   ├── attack.js
        │   ├── defense.js
        │   └── ranks/
        │       ├── index.js
        │       ├── attack.js
        │       ├── defense.js
        │       └── buffs.js
        ├── ui.js                 # backward-compatible entry point
        ├── ui/
        │   ├── prompts.js
        │   ├── panel.js
        │   └── callbacks.js
        └── cleanup.js
```

## نقشه‌ی فایل‌ها

### ورودی و مدیریت دستورها

| فایل | مسئولیت |
|---|---|
| `src/index.js` | ورودی اصلی Worker؛ دریافت وبهوک تلگرام، بررسی تنظیمات و در صورت تنظیم بودن، اعتبارسنجی `WEBHOOK_SECRET`. جلوگیری از پردازش دوباره‌ی آپدیت‌ها و مدیریت خطاهای کلی |
| `src/commands/index.js` | دریافت آپدیت، ساخت context و اتصال نام دستورها به handlerهای تخصصی در پوشه `src/commands/` |
| `src/util.js` | توابع مشترک دستورها: ارسال پاسخ، پیام نتیجه، بررسی مستر/کارمند، اعتبارسنجی کلیدهای آبجکت و تشخیص شناسه‌ی بازیکن/دامی |
| `src/db.js` | wrapperهای D1 برای `all`، `first`، `run` و تراکنش‌های چنددستوری `batch` |

### ارتباط با تلگرام و گزارش‌گیری

| فایل | مسئولیت |
|---|---|
| `src/telegram.js` | لایه‌ی ارتباط با Telegram Bot API؛ ارسال پیام و فایل، ارسال کیبورد، ویرایش/حذف/پین پیام و پاسخ به callbackها. قالب HTML و صف ارسال پیام نیز اینجاست |
| `src/log.js` | ثبت رویدادها در جدول `logs`، ساده‌سازی متن HTML، دریافت لاگ‌های اخیر و قالب‌بندی زمان/لاگ |
| `src/report.js` | ثبت گزارش با `/bug`، ذخیره‌ی snapshot بازی و لاگ‌های اطراف خطا، مشاهده و بستن/بازکردن گزارش‌ها و خروجی JSON |
| `src/testmode.js` | مجموعه‌ی توابع حالت تست خصوصی، از جمله ساخت بازی با دامی‌ها و ابزارهای بررسی تاس/دمیج/دفاع. این فایل در نسخه‌ی فعلی از `commands.js` وارد نشده؛ بنابراین وجود فایل به‌تنهایی به معنی فعال بودن دستورهای آن نیست |

### داده‌های بازی

این سه فایل منبع تعریف ثابت شخصیت‌ها و قابلیت‌ها هستند؛ اطلاعات پایه از D1 خوانده نمی‌شوند:

| فایل | مسئولیت |
|---|---|
| `src/data/catalog/characters/` | منبع canonical شخصیت‌ها بر اساس فرنچایز؛ شناسه و کد پایدار، نام‌ها، سقف منابع و تکنیک‌های مجاز |
| `src/data/registry/` | دسترسی مرکزی به شخصیت/تکنیک با ID و Code و جست‌وجوی دقیق/تقریبی صفحه‌بندی‌شده |
| `src/data/validation/` | اعتبارسنجی شناسه‌ها، کدها، مقادیر و ارجاع تکنیک‌ها؛ داده انگلیسی ناقص به‌صورت warning گزارش می‌شود |
| `src/data/characters.js` | لایه سازگاری runtime برای مصرف‌کننده‌های قدیمی Combat؛ منبع canonical در `data/catalog/` است |
| `src/data/catalog/techniques/` | داده canonical تکنیک‌ها؛ مقادیر Rank/Base/نوع/هزینه رایگان مطابق داده قبلی |
| `src/data/techniques.js` | لایه سازگاری runtime برای مصرف‌کننده‌های قدیمی Combat |
| `src/data/catalog/defenses/` | داده canonical دفاع‌ها؛ فرمول‌ها همچنان در `game/rules/` هستند |
| `src/data/defenses.js` | لایه سازگاری runtime برای مصرف‌کننده‌های قدیمی Combat |

**برای اضافه یا اصلاح کردن شخصیت، تکنیک یا دفاع، ابتدا فایل داده‌ی مربوط به آن را تغییر بده.** اتصال تکنیک‌های هر شخصیت از طریق کلیدهای موجود در `characters.js` انجام می‌شود؛ کلید تکنیک باید در `techniques.js` نیز تعریف شده باشد.

### موتور و رابط بازی

| فایل | مسئولیت |
|---|---|
| `src/game/engine.js` | عملیات وضعیت بازی در D1؛ ثبت اتمیک حمله/NP، حل اتمیک دفاع، خودزنی و جابه‌جایی compare-and-swap نوبت |
| `src/game/rules/` | قوانین خالص و مستقل از Telegram/D1؛ قرارداد `finalRoll`، فرمول دمیج/خودزنی و دفاع، محاسبات مستقل دفاع مطلق/رفلکت و جدول تکنیک معکوس. `src/game/rules.js` فقط barrel سازگاری است |
| `src/game/ui/` | رابط گروه تفکیک‌شده به پیام‌ها و promptها، پنل ثابت و callbackها. `src/game/ui.js` مسیر سازگاری exportهاست |
| `src/game/cleanup.js` | مدیریت پیام‌های موقت ربات؛ نگه‌داشتن نتیجه‌ی اخیر، حذف پیام‌های قدیمی، چرخش پیام نوبت و پاک‌سازی پیام‌های ثبت‌شده در `bot_msgs` |

## جریان اجرای معمول

1. تلگرام آپدیت را به Worker می‌فرستد.
2. `index.js` آپدیت را دریافت و از تکراری نبودنش اطمینان حاصل می‌کند.
3. پیام‌های دستوری به `commands/index.js` می‌رسند و به handler مناسب در `admin.js`، `players.js` یا `combat.js` سپرده می‌شوند.
4. handler مربوطه از داده‌های `src/data/`، محاسبات `game/rules/` و عملیات وضعیت `engine.js` استفاده می‌کند.
5. وضعیت بازی و بازیکنان در D1 ذخیره می‌شود؛ رابط دکمه‌ای در `game/ui/` و ارتباط تلگرام از طریق `telegram.js` مدیریت می‌شود.
6. رویدادها و خطاها در صورت امکان در `logs` ثبت می‌شوند و گزارش‌های دستی در `reports` قرار می‌گیرند.

## نقش فایل‌های دیتابیس

فایل `schema.sql` ساختار جدول‌های D1 را تعریف می‌کند. مهم‌ترین جدول‌ها:

| جدول | کاربرد |
|---|---|
| `games` | وضعیت بازی هر چت، شناسه Session مستقل و Hash شناسه‌ی لینک Lobby |
| `character_selection_requests` | درخواست خصوصی مستقل برای هر کاربر؛ متصل به چت، Session، Private Chat، وضعیت و انقضا |
| `players` | بازیکنان هر بازی، کلید شخصیت انتخابی و وضعیت جاری HP/NP، تیم و وضعیت‌های جانبی |
| `pending` | حمله‌هایی که ثبت شده‌اند و هنوز دفاعشان تعیین تکلیف نشده |
| `bot_msgs` | پیام‌های موقت ربات که برای پاک‌سازی باید شناسه‌شان نگهداری شود |
| `battle_ui` | شناسه‌ی پیام پنل ثابت مبارزه در هر چت |
| `battle_turn_ui` | آخرین بازیکنی که پیام نوبت اختصاصی برایش ساخته شده |
| `logs` | رویدادهای ورودی/خروجی، اتفاقات بازی و خطاها |
| `reports` | گزارش‌های ثبت‌شده به همراه snapshot وضعیت بازی و لاگ‌های مرتبط |
| `processed_updates` | شناسه‌ی آپدیت‌های تلگرام برای جلوگیری از اجرای دوباره |
| `combat_actions` | دفتر شناسه عملیات رزمی و قفل یک عملیات در هر نوبت برای جلوگیری از تکرار/هم‌زمانی |

### نکته‌ی مهم درباره‌ی داده‌ها

تعریف شخصیت‌ها، تکنیک‌ها و دفاع‌ها در فایل‌های JavaScript است؛ D1 وضعیت هر بازیکن را در زمان بازی نگه می‌دارد. هنگام `/join`، مقادیر پایه‌ی HP و NP شخصیت در ردیف بازیکن کپی می‌شوند. بنابراین تغییر HP/NP پایه در فایل شخصیت‌ها، بازیکنانی را که قبلاً وارد بازی شده‌اند به‌صورت خودکار به‌روزرسانی نمی‌کند.

## تنظیمات و راه‌اندازی

- نام Worker: `anime-rpg-bot`
- فایل ورودی: `src/index.js`
- دیتابیس D1 متصل‌شده: `anime-rpg`
- Binding دیتابیس در کد: `env.DB`
- تنظیمات غیرمحرمانه مانند `MASTER_IDS`، `OWNER_IDS` و `BOT_USERNAME` در `wrangler.toml` قرار دارند.
- نام کاربری ربات فقط از `[vars].BOT_USERNAME` خوانده می‌شود؛ لینک انتخاب خصوصی از این مقدار و شناسه Session ساخته می‌شود.
- توکن ربات باید به‌صورت secret با نام `BOT_TOKEN` تنظیم شود.
- `WEBHOOK_SECRET` اختیاری است؛ اگر تنظیم شود، درخواست وبهوک باید هدر معتبر تلگرام را داشته باشد.

دستورهای اصلی:

```bash
npx wrangler d1 execute anime-rpg --remote --file=./schema.sql
npx wrangler deploy
npx wrangler tail
```

اجرای `schema.sql` برای ایجاد جدول‌های موجود با `IF NOT EXISTS` نوشته شده و قرار نیست داده‌های جدول‌های موجود را پاک کند. اگر ساختار دیتابیس در آینده نیاز به تغییر داشته باشد، قبل از اجرا باید اثر تغییر روی داده‌های فعلی بررسی شود.

## راهنمای تغییر نقطه‌ای

برای شروع هر تغییر، فقط از فایل مرتبط شروع کن:

- **شخصیت جدید یا HP/NP پایه:** فایل فرنچایز مربوط در `src/data/catalog/characters/`؛ برای اتصال/جست‌وجو `src/data/registry/`
- **تکنیک و مشخصات آن:** `src/data/techniques.js`؛ **فرمول حمله/هزینه NP:** `src/game/rules/attack.js`؛ **رنک حمله:** `src/game/rules/ranks/attack.js`
- **تعریف دفاع:** `src/data/defenses.js`؛ **فرمول دفاع:** `src/game/rules/defense.js`؛ **رنک دفاع:** `src/game/rules/ranks/defense.js`
- **قوانین نوبت، زنده‌بودن، برنده یا دمیج در دیتابیس:** `src/game/engine.js`
- **انتخاب خصوصی:** `src/game/selection/requests.js` (Session و درخواست D1)، `resolver.js` (جست‌وجو و تأیید)، `src/commands/index.js` (مسیر پیام خصوصی)
- **پنل مبارزه:** `src/game/ui/panel.js`؛ **پیام‌ها و منوها:** `src/game/ui/prompts.js`؛ **callbackهای مبارزه:** `src/game/ui/callbacks.js`
- **دریافت و مسیریابی دستورها:** `src/commands/index.js`؛ **عملیات مستر:** `src/commands/admin.js`؛ **عملیات بازیکن:** `src/commands/players.js`؛ **حمله و دفاع:** `src/commands/combat.js`
- **پیام‌های موقت و پاک‌سازی:** `src/game/cleanup.js`
- **API تلگرام:** `src/telegram.js`
- **ساختار جدول‌ها:** `schema.sql`
- **لاگ و گزارش باگ:** `src/log.js` و `src/report.js`

این راهنما نقشه‌ی مسئولیت فایل‌هاست، نه جایگزین بررسی کد مرتبط. برای تغییرهای حساس، فایل مسئول و فایل‌هایی را که مستقیماً به آن وابسته‌اند بررسی کن؛ از بازخوانی کل پروژه خودداری کن مگر اینکه تغییر واقعاً بین چند بخش پخش شده باشد.

## نقشه توسعه قوانین رزمی جوجوتسو کایسن

زیرساخت اتمیک مبارزه، مسیر فعلی حمله و حل دفاع‌های pending فعال‌اند؛ قرارداد `finalRoll` و فرمول افزایش دمیج برای نتیجه مثبت به مسیر محاسبه متصل شده‌اند؛ مقدار خودزنی منفی به‌دلیل تناقض مثال و فرمول اصلی هنوز تغییر نکرده است. ترتیب باف/کاهش/دفاع و دفاع‌های رتبه‌ای هنوز در حال تکمیل‌اند. وضعیت واقعی هر حوزه و ابهام‌های باقی‌مانده در اسناد زیر ثبت می‌شود:

- [نقشه مرکزی قوانین رزمی جوجوتسو کایسن](docs/jujutsu/README.md)
- [وضعیت اجرایی و میزان تکمیل هر قانون](docs/jujutsu/IMPLEMENTATION-STATUS.md)

## Migrationهای D1

برای دیتابیس موجود، Migrationها را به‌ترتیب و فقط یک‌بار اجرا کنید:

```bash
npx wrangler d1 execute anime-rpg --remote --file=./migrations/0001_combat_actions.sql
npx wrangler d1 execute anime-rpg --remote --file=./migrations/0002_combat_turn_claim.sql
npx wrangler d1 execute anime-rpg --remote --file=./migrations/0003_private_character_selection.sql
```

این دو Migration فقط جدول/ستون/ایندکس افزایشی ایجاد می‌کنند و داده‌های قبلی بازی را حذف یا بازنویسی نمی‌کنند.

**قاعده نگهداری:** هر قابلیت فقط پس از پیاده‌سازی و بررسی رفتاری از فهرست کارهای باز به بخش انجام‌شده منتقل می‌شود. وجود مکانیک مشابه در نسخه فعلی به‌تنهایی به معنی تکمیل قانون جدید نیست.



## انتخاب کاراکتر خصوصی و Catalog مرکزی

- پنل Lobby فقط یک دکمه URL با عنوان «👤 انتخاب کاراکتر» دارد؛ جست‌وجو، پیشنهادها، تأیید و خطاها در Private Chat هستند.
- [vars].BOT_USERNAME تنها محل تنظیم نام کاربری ربات است. نام کاربری فعلی abbas_developerbot است.
- هر /newgame یک session_id تصادفی ۱۲۸ بیتی تازه و Hash آن ایجاد می‌کند. Payload لینک مشترک فقط Session را مشخص می‌کند؛ در /start برای هر Telegram user یک درخواست مستقل با private_chat_id و انقضای ۳۰ دقیقه‌ای ساخته می‌شود.
- Session قدیمی پس از /newgame یا شروع/پایان Lobby قابل استفاده نیست. درخواست‌ها به user، private chat، گروه و Session متصل‌اند.
- انتخاب کاراکتر تکراری مجاز است؛ کلید اصلی بازیکن همچنان (chat_id,user_id) است. تغییر کاراکتر در Lobby همان ردیف را به‌روزرسانی می‌کند و team، seat، نام و وضعیت‌های جانبی را حفظ می‌کند.
- HP/NP فعلی با انتخاب مجدد یا Deploy افزایش پیدا نمی‌کنند. سقف‌های جدید از Catalog اعمال می‌شوند و مقدار فعلی فقط در صورت بالاتر بودن از سقف پایین می‌آید.
- پس از Deploy جدید، اولین آپدیت گروهی یا callback سقف منابع بازیکنان همان گروه را با Catalog جاری هماهنگ می‌کند؛ تکنیک‌ها و دفاع‌ها نیز از داده‌های runtime نسخه Deployشده خوانده می‌شوند.
- Migration 0003_private_character_selection.sql افزایشی است و داده‌های فعلی بازی/بازیکنان را حذف نمی‌کند. آن را یک‌بار روی D1 اجرا کنید؛ اجرای Migration روی دیتابیس واقعی از این مخزن انجام نشده است.
- داده‌های فعلی Repository برای ماکی و یوجی نام انگلیسی ندارند؛ این فیلدها null باقی مانده و Validator آن‌ها را به‌صورت warning گزارش می‌کند تا نامی حدس زده نشود.

جزئیات چرخه درخواست، امنیت لینک و وضعیت Migration در docs/character-selection.md آمده است.
