# ربات رول‌پلی انیمه

ربات گروهی رول‌پلی و مبارزه بر پایه‌ی **Cloudflare Workers، D1 و Telegram Bot API**. این فایل نقشه‌ی پروژه است تا برای تغییر یک قابلیت، لازم نباشد همه‌ی کدها از ابتدا بررسی شوند.

## نمای کلی ساختار

```text
.
├── README.md
├── wrangler.toml
├── schema.sql
├── migrations/
│   ├── 0000_initial_schema.sql
│   ├── 0001_combat_actions.sql
│   ├── 0002_combat_turn_claim.sql
│   └── 0003_private_character_selection.sql
├── docs/
│   ├── ABILITY-CONTRACT.md          # قرارداد مشترک Ability و سازگاری قدیمی
│   ├── TARGET-RESOLVER.md           # قرارداد و API تعیین/اعتبارسنجی اهداف Ability
│   ├── character-selection.md
│   └── jujutsu/
│       ├── README.md
│       ├── DECISIONS.md
│       ├── IMPLEMENTATION-STATUS.md
│       └── 01..11-topic-files.md
├── tests/
│   ├── abilities.test.mjs           # قرارداد، Registry و Adapterهای Ability
│   ├── targeting.test.mjs           # تعیین و اعتبارسنجی هدف Ability
│   ├── planning.test.mjs             # Effect/Cost planning و Pipeline یکپارچه
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
    │   ├── abilities/                # shared Ability contract and Handler result validation
    │   ├── adapters/                 # read-only projections from legacy catalogs to Ability
    │   ├── characters.js             # runtime compatibility adapter
    │   ├── techniques.js             # runtime compatibility adapter
    │   ├── defenses.js               # runtime compatibility adapter
    │   ├── catalog/                  # canonical franchise-based data
    │   ├── registry/                 # stable IDs, codes and search
    │   └── validation/               # Catalog integrity checks
    └── game/
        ├── selection/                # private selection sessions and requests
        ├── targeting/                # pure Ability target resolution and validation
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

Catalogهای زیر منبع canonical داده‌های ثابت‌اند؛ فایل‌های سه‌گانه‌ی قدیمی فقط برای سازگاری مصرف‌کننده‌های موجود باقی مانده‌اند:

| فایل | مسئولیت |
|---|---|
| `src/data/catalog/characters/` | منبع canonical شخصیت‌ها بر اساس فرنچایز؛ شناسه و کد پایدار، نام‌ها، سقف منابع و تکنیک‌های مجاز |
| `src/data/registry/` | دسترسی مرکزی به شخصیت/تکنیک و Ability با ID و Code و جست‌وجوی دقیق/تقریبی صفحه‌بندی‌شده |
| `src/data/validation/` | اعتبارسنجی شناسه‌ها، کدها، مقادیر، ارجاع تکنیک‌ها و قرارداد Ability؛ داده انگلیسی ناقص به‌صورت warning گزارش می‌شود |
| `src/data/abilities/contract.js` | قرارداد داده‌ای مشترک Ability و اعتبارسنجی نتیجه declarative Handler |
| `src/data/validation/abilities.js` | اعتبارسنجی ساختار Ability و ارجاع مالکیت به شناسه شخصیت‌های واقعی |
| `src/data/adapters/abilities.js` | تبدیل read-only تکنیک‌ها و دفاع‌های قدیمی به Ability بدون تغییر Catalog اصلی |
| `src/data/registry/abilities.js` | Registry یکپارچه‌ی خواندنی Abilityها؛ مالکیت تکنیک از `character.techniqueIds` مشتق می‌شود |
| `src/data/characters.js` | لایه سازگاری runtime برای مصرف‌کننده‌های قدیمی Combat؛ منبع canonical در `data/catalog/` است |
| `src/data/catalog/techniques/` | داده canonical تکنیک‌ها؛ مقادیر Rank/Base/نوع/هزینه رایگان مطابق داده قبلی |
| `src/data/techniques.js` | لایه سازگاری runtime برای مصرف‌کننده‌های قدیمی Combat |
| `src/data/catalog/defenses/` | داده canonical دفاع‌ها؛ فرمول‌ها همچنان در `game/rules/` هستند |
| `src/data/defenses.js` | لایه سازگاری runtime برای مصرف‌کننده‌های قدیمی Combat |

**برای اضافه یا اصلاح کردن شخصیت، تکنیک یا دفاع، ابتدا فایل داده‌ی مربوط به آن را تغییر بده.** اتصال تکنیک‌های هر شخصیت از طریق کلیدهای موجود در `characters.js` انجام می‌شود؛ کلید تکنیک باید در `techniques.js` نیز تعریف شده باشد.

### موتور و رابط بازی

| فایل | مسئولیت |
|---|---|
| `src/game/selection/` | Sessionهای بازی، درخواست مستقل هر کاربر، اعتبارسنجی لینک، جست‌وجو و ثبت انتخاب خصوصی |
| `src/game/targeting/resolver.js` | تعیین Candidateهای مجاز و اعتبارسنجی انتخاب هدف بر اساس `ability.targeting`؛ pure و مستقل از UI/D1 |
| `src/game/planning/` | اعتبارسنجی و ساخت Execution Plan قطعی برای Effectهای `damage/defense` و Costهای پشتیبانی‌شده؛ بدون اجرا یا mutation |
| `src/game/engine.js` | عملیات وضعیت بازی در D1؛ ثبت اتمیک حمله/NP، حل اتمیک دفاع، خودزنی، همگام‌سازی سقف Catalog و جابه‌جایی compare-and-swap نوبت |
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

فایل `schema.sql` Snapshot کامل Schema فعلی D1 است؛ تاریخچه تغییرات و اجرای نسخه‌ای Schema در پوشه `migrations/` نگهداری می‌شود. مهم‌ترین جدول‌ها:

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

تعریف شخصیت‌ها، تکنیک‌ها و دفاع‌ها در فایل‌های JavaScript است؛ D1 وضعیت هر بازیکن را در زمان بازی نگه می‌دارد. هنگام تأیید انتخاب خصوصی، بازیکن جدید با سقف‌های Catalog ساخته می‌شود؛ تغییر کاراکتر سقف‌ها را عوض می‌کند اما HP/NP جاری را بازیابی نمی‌کند. پس از Deploy نیز `syncPlayerCatalogCaps` سقف‌های جدید را برای بازیکنان موجود اعمال می‌کند.

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
npm install
npm run db:migrate:local
npm run db:migrate:remote
npx wrangler deploy
npx wrangler tail
```

برای جزئیات راه‌اندازی دیتابیس تازه، مهاجرت دیتابیس موجود و ترتیب Migration/Deploy، بخش «Migrationهای D1» را ببینید. اجرای `wrangler deploy` به‌تنهایی Migrationها را اجرا نمی‌کند.

`schema.sql` فقط Snapshot فعلی Schema برای مرجع و مقایسه است؛ برای ساخت دیتابیس تازه یا تغییر ساختار، از Migrationهای نسخه‌بندی‌شده در `migrations/` استفاده کنید. اجرای مستقیم این Snapshot روی دیتابیس موجود جایگزین Migration نیست.

## راهنمای تغییر نقطه‌ای

برای شروع هر تغییر، فقط از فایل مرتبط شروع کن:

- **شخصیت جدید یا HP/NP پایه:** فایل فرنچایز مربوط در `src/data/catalog/characters/`؛ برای اتصال/جست‌وجو `src/data/registry/`
- **تکنیک و مشخصات آن:** فایل فرنچایز مربوط در `src/data/catalog/techniques/`؛ **فرمول حمله/هزینه NP:** `src/game/rules/attack.js`؛ **رنک حمله:** `src/game/rules/ranks/attack.js`
- **تعریف دفاع:** `src/data/catalog/defenses/`؛ **فرمول دفاع:** `src/game/rules/defense.js`؛ **رنک دفاع:** `src/game/rules/ranks/defense.js`
- **تعیین و اعتبارسنجی اهداف Ability:** `src/game/targeting/resolver.js`؛ جزئیات API در `docs/TARGET-RESOLVER.md`
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

**منبع اصلی تغییرات Schema پوشه `migrations/` است.** Wrangler نام Migrationهای اعمال‌شده را در جدول داخلی `d1_migrations` نگه می‌دارد و در اجرای بعدی فقط فایل‌های ثبت‌نشده را، به‌ترتیب نام/شماره، اجرا می‌کند. فایل `schema.sql` یک Snapshot از Schema فعلی برای مطالعه و مقایسه است؛ آن را به‌عنوان مسیر معمول Migration اجرا نکنید.

### راه‌اندازی دیتابیس جدید

پس از ساخت دیتابیس D1 جدید، مقدار `database_id` آن را در `wrangler.toml` تنظیم کنید و نام دیتابیس را مطابق binding نگه دارید. سپس از ریشه پروژه اجرا کنید:

```bash
npm install
npm run db:migrate:local
```

برای دیتابیس Remote تازه، پس از اطمینان از نام و شناسه صحیح دیتابیس:

```bash
npm run db:migrate:remote
```

این دستورها تمام Migrationها را از `0000_initial_schema.sql` به بعد اجرا می‌کنند. اجرای دوباره فقط Migrationهای اعمال‌نشده را اجرا می‌کند؛ داده‌های موجود Reset یا حذف نمی‌شوند.

### دیتابیس موجود و مهاجرت از روش قدیمی

اگر دیتابیس قبلاً با `schema.sql` یا `d1 execute --file` ساخته/به‌روزرسانی شده باشد، جدول `d1_migrations` ممکن است سابقه‌ای نداشته باشد. در این وضعیت **نباید کورکورانه دستور Remote را اجرا کرد**: Wrangler فایل‌های ثبت‌نشده را اجرا می‌کند و Migrationهای `0002` و `0003` شامل `ALTER TABLE ... ADD COLUMN` هستند که روی ستونی که از قبل وجود دارد خطا می‌دهند.

اگر با بررسی Schema مطمئن شدید دیتابیس قدیمی تمام ساختار پایه و تغییرات `0001` و `0002` را دارد، باید فقط یک‌بار سابقه آن‌ها را در جدول رسمی ثبت کنید تا Wrangler آن‌ها را دوباره اجرا نکند. نمونه ثبت baseline (فقط پس از تأیید ساختار واقعی دیتابیس):

```sql
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0000_initial_schema.sql'),
  ('0001_combat_actions.sql'),
  ('0002_combat_turn_claim.sql');
```

این SQL را به‌عنوان یک عملیات Adopt یک‌باره و کنترل‌شده اجرا کنید؛ این کار Migrationهای Schema را اجرا نمی‌کند، فقط سابقه‌ای را ثبت می‌کند که قبلاً در دیتابیس اعمال شده است. سپس:

```bash
npm run db:migrate:remote
```

Wrangler از آن پس `0003_private_character_selection.sql` و Migrationهای بعدی را از مسیر رسمی اجرا و ثبت می‌کند. اگر حتی یکی از پیش‌نیازهای baseline برقرار نیست، این ردیف‌ها را ثبت نکنید؛ ابتدا وضعیت دیتابیس باید جداگانه بررسی و با تاریخچه واقعی آن تطبیق داده شود.

**مهم:** این مخزن به دیتابیس Remote دسترسی خواندن/بررسی Schema نداشته و هیچ Migration Remote اجرا یا baseline نشده است. پس از انتقال دیتابیس یا وقتی سابقه آن نامشخص است، baseline را حدس نزنید.

### اجرای Migration محلی

```bash
npm run db:migrate:local
npx wrangler d1 migrations list anime-rpg --local
```

دیتابیس محلی Wrangler مستقل از دیتابیس Remote است. موفقیت تست Local، وضعیت Migrationهای Remote را اثبات نمی‌کند.

### اجرای Migration روی Remote

```bash
npx wrangler d1 migrations list anime-rpg --remote
npm run db:migrate:remote
npx wrangler d1 migrations list anime-rpg --remote
```

قبل از اجرا، خروجی فهرست را بررسی کنید، از داده‌ها پشتیبان داشته باشید و مطمئن شوید نام/شناسه D1 درست است. دستور Remote فقط با تأیید صریح مالک دیتابیس اجرا شود.

### افزودن Migration جدید

Migration جدید را با Wrangler بسازید تا شماره بعدی خودکار انتخاب شود:

```bash
npx wrangler d1 migrations create anime-rpg describe_the_change
```

فایل تازه را فقط به انتهای تاریخچه اضافه کنید؛ فایل‌های قبلی را ویرایش یا بازنویسی نکنید. SQL باید افزایشی و سازگار با داده‌های موجود باشد. سپس آن را در محیط Local آزمایش کنید و فایل را همراه کد Commit کنید.

### ترتیب صحیح Migration و Deploy

1. Migration را ایجاد و روی دیتابیس Local اجرا/آزمایش کنید.
2. تغییرات کد و Migration را Commit و CI را بررسی کنید.
3. روی دیتابیس هدف، ابتدا `npm run db:migrate:remote` را اجرا و نتیجه را با `d1 migrations list` بررسی کنید.
4. پس از موفقیت Migration، `npx wrangler deploy` را اجرا کنید.

Deploy به‌تنهایی Migration اجرا نمی‌کند. کدی که به ستون/جدول جدید وابسته است نباید پیش از اعمال Migration متناظر روی دیتابیس هدف Deploy شود.

## انتخاب کاراکتر خصوصی و Catalog مرکزی

- پنل Lobby فقط یک دکمه URL با عنوان «👤 انتخاب کاراکتر» دارد؛ جست‌وجو، پیشنهادها، تأیید و خطاها در Private Chat هستند.
- [vars].BOT_USERNAME تنها محل تنظیم نام کاربری ربات است. نام کاربری فعلی abbas_developerbot است.
- هر /newgame یک session_id تصادفی ۱۲۸ بیتی تازه و Hash آن ایجاد می‌کند. Payload لینک مشترک فقط Session را مشخص می‌کند؛ در /start برای هر Telegram user یک درخواست مستقل با private_chat_id و انقضای ۳۰ دقیقه‌ای ساخته می‌شود.
- Session قدیمی پس از /newgame یا شروع/پایان Lobby قابل استفاده نیست. درخواست‌ها به user، private chat، گروه و Session متصل‌اند.
- انتخاب کاراکتر تکراری مجاز است؛ کلید اصلی بازیکن همچنان (chat_id,user_id) است. تغییر کاراکتر در Lobby همان ردیف را به‌روزرسانی می‌کند و team، seat، نام و وضعیت‌های جانبی را حفظ می‌کند.
- HP/NP فعلی با انتخاب مجدد یا Deploy افزایش پیدا نمی‌کنند. سقف‌های جدید از Catalog اعمال می‌شوند و مقدار فعلی فقط در صورت بالاتر بودن از سقف پایین می‌آید.
- پس از Deploy جدید، اولین آپدیت گروهی یا callback سقف منابع بازیکنان همان گروه را با Catalog جاری هماهنگ می‌کند؛ تکنیک‌ها و دفاع‌ها نیز از داده‌های runtime نسخه Deployشده خوانده می‌شوند.
- Migrationهای D1 از طریق Wrangler و تاریخچه `d1_migrations` مدیریت می‌شوند؛ برای دیتابیس قدیمی ابتدا baseline را طبق راهنمای Migrationهای D1 بررسی کنید.
- داده‌های فعلی Repository برای ماکی و یوجی نام انگلیسی ندارند؛ این فیلدها null باقی مانده و Validator آن‌ها را به‌صورت warning گزارش می‌کند تا نامی حدس زده نشود.

جزئیات چرخه درخواست، امنیت لینک و وضعیت Migration در docs/character-selection.md آمده است.


## قرارداد مشترک Ability

قرارداد داده‌ای مشترک و Adapterهای سازگاری در [docs/ABILITY-CONTRACT.md](docs/ABILITY-CONTRACT.md) مستند شده‌اند. این لایه فعلاً فقط projection، Registry و Validation است؛ مسیر فعلی Combat همچنان از `TECHNIQUES` و `DEFENSES` قدیمی استفاده می‌کند و هیچ Effect/Target/Handler جدیدی را اجرا نمی‌کند.


## Target Resolver (Phase 2)

ماژول مستقل `src/game/targeting/resolver.js` از `targeting.mode` و `targeting.selection` قرارداد Ability استفاده می‌کند. این ماژول فقط snapshotهای خواندنی را فیلتر و اعتبارسنجی می‌کند؛ به D1، Telegram، مسیر Combat یا اجرای Effect متصل نیست. نوع‌های Summon و custom تا زمان وجود Runtime واقعی، صریحاً `unsupported` هستند. راهنمای کامل: [docs/TARGET-RESOLVER.md](docs/TARGET-RESOLVER.md).


## Ability Planning (Phase 3)

ماژول‌های \`src/game/planning/\` یک Execution Plan فقط‌خواندنی از Ability، Actor، Context و هدف‌های Resolveشده می‌سازند. این لایه Effectهای \`damage/defense\` و Costهای \`none/fixed NP/legacy\` را برنامه‌ریزی می‌کند؛ هیچ Effect یا منبعی را اجرا/مصرف نمی‌کند و به Combat متصل نیست. جزئیات قرارداد ورودی/خروجی و خطاها در [docs/ABILITY-PLANNING.md](docs/ABILITY-PLANNING.md) آمده است.
