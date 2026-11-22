# قرارداد مشترک Ability — Phase 1

## هدف و مرز این مرحله

این سند قرارداد داده‌ای مشترک قابلیت‌ها را تعریف می‌کند. در این مرحله فقط projection داده‌ای، Registry، Validation و سازگاری با Catalogهای فعلی اضافه شده‌اند. این قرارداد هنوز مسیر اجرای مبارزه را جایگزین نمی‌کند و به‌تنهایی قابلیت درمان، باف، احضار، هدف‌گیری جدید یا زمان‌بندی را فعال نمی‌کند.

## تصمیم معماری

- Catalogهای Canonical شخصیت، تکنیک و دفاع مستقل باقی می‌مانند؛ هیچ Ability Catalog مرکزی به‌عنوان منبع حقیقت ساخته نشده است.
- `src/data/adapters/abilities.js` رکوردهای فعلی تکنیک/دفاع را بدون تغییر منبع اصلی به شکل Ability projection تبدیل می‌کند.
- `src/data/registry/abilities.js` از Catalogهای موجود یک projection خواندنی (نه منبع canonical) می‌سازد و دسترسی یکپارچه بر اساس ID، Code، Key، دسته و شخصیت را فراهم می‌کند.
- `src/data/abilities/contract.js` ساختار و نتیجه Handler را اعتبارسنجی می‌کند.
- داده‌های قدیمی `CHARACTERS`، `TECHNIQUES` و `DEFENSES` همچنان از Adapterهای قبلی خودشان ساخته می‌شوند؛ مسیر Combat فعلی هنوز همان داده‌ها را مصرف می‌کند.

## شکل رکورد Ability

| فیلد | مسئولیت |
|---|---|
| `id`, `code`, `key` | شناسه‌های پایدار و سازگاری با کلیدهای قدیمی |
| `name` | نام‌های محلی؛ در حال حاضر `name.fa` اجباری است |
| `category` | دسته قابلیت مانند `attack`, `defense`, `support`, `summon` یا `utility` |
| `owners` | `{ mode: 'any' }` یا `{ mode: 'allowlist', characterIds: [...] }` |
| `conditions` | فهرست توصیفی شرط‌ها؛ هنوز ارزیابی نمی‌شوند |
| `targeting` | `{ mode, selection }`؛ قرارداد مشترک هدف‌گیری است و توسط `src/game/targeting/resolver.js` تفسیر می‌شود؛ فهرست modeها و محدودیت Runtime در [TARGET-RESOLVER.md](TARGET-RESOLVER.md) ثبت شده است |
| `cost` | توصیف روش هزینه؛ `legacy` به resolver قدیمی اشاره می‌کند |
| `effects` | توصیف effect intentها؛ اجرا نمی‌شوند |
| `execution` | روش اجرا و در صورت نیاز شناسه Handler |
| `config` | تنظیمات اختصاصی قابلیت، بدون تحمیل فیلدهای آینده به همه Catalogها |
| `active` | وضعیت فعال بودن رکورد در Registry |

مقادیر targeting و cost در قرارداد داده‌ای به فهرست بسته‌ای محدود نشده‌اند تا افزودن نوع‌های جدید قرارداد را مجبور به شکستن نکند. Validation شکل پایه را بررسی می‌کند؛ semantics هدف‌گیری فقط در Target Resolver مستقل تفسیر می‌شود.

## Adapterهای سازگاری

`adaptTechniqueToAbility()` شناسه‌ها و نام تکنیک را حفظ می‌کند، دسته را `attack` می‌گذارد، مالکیت را از `character.techniqueIds` به‌صورت مشتق‌شده می‌سازد، و `rank/base/kind/free/test` را در `config.legacy` نگه می‌دارد. resolverهای `techNpCost` و `techDamage` صرفاً ارجاع به منطق موجودند؛ Ability projection آن‌ها را اجرا نمی‌کند.

`adaptDefenseToAbility()` دفاع‌های فعلی را با دسته `defense` و مالکیت عمومی ثبت می‌کند. `defenseValue` فقط به‌عنوان resolver موجود معرفی می‌شود؛ مسیر اجرای دفاع عوض نشده است.

## قرارداد Handler برای مراحل بعد

Handler یک تابع pure در لایه منطق بازی خواهد بود، نه UI و نه D1. شکل ورودی مورد انتظار:

```js
handler({
  ability,       // normalized Ability record
  actor,         // read-only actor snapshot
  targets,       // read-only target snapshots
  context,       // read-only game/turn context
  config,        // ability.config
})
```

خروجی باید declarative باشد:

```js
{ status: 'ready', effects: [{ type: 'heal', targetId: 42, amount: 20 }], metadata: {} }
// یا
{ status: 'rejected', reason: 'شرایط استفاده برقرار نیست', effects: [] }
```

`validateAbilityHandlerResult()` شکل خروجی را بررسی می‌کند؛ اما Handler registry، dispatcher و اجرای effect در Phase 1 ساخته نشده‌اند. Handler حق ندارد ورودی‌ها را mutate کند، SQL/D1 را صدا بزند یا پیام UI بفرستد. در مراحل بعد Engine باید effect intent را اعتبارسنجی و در تراکنش کنترل‌شده اعمال کند.

## نمونه افزودن Ability جدید

برای یک قابلیت جدید در آینده، Catalog دسته مربوطه را مستقل نگه دارید و رکوردی با قرارداد بالا تعریف کنید. نمونه زیر فقط شکل داده را نشان می‌دهد و در بازی قابل اجرا نیست:

```js
{
  id: 'ability_example_support',
  code: 'EXAMPLE_SUPPORT',
  key: 'example_support',
  name: { fa: 'نمونه پشتیبانی', en: null },
  category: 'support',
  owners: { mode: 'allowlist', characterIds: ['char_example'] },
  conditions: [{ type: 'actor_alive' }],
  targeting: { mode: 'single_ally', selection: 'manual' },
  cost: { mode: 'fixed', resource: 'np', amount: 20 },
  effects: [{ type: 'heal', amount: 30 }],
  execution: { mode: 'handler', handler: 'support.example' },
  config: {},
  active: false,
}
```

تا زمانی که Handler، resolver هدف/هزینه و Engine مربوطه ساخته نشده‌اند، چنین رکوردی صرفاً داده توصیفی است و نباید به UI یا مسیر Combat متصل شود.

## وضعیت توسعه قرارداد Ability و Target Resolver

- [x] قرارداد داده‌ای Ability
- [x] Adapter تکنیک‌های قدیمی
- [x] Adapter دفاع‌های قدیمی
- [x] Registry یکپارچه خواندنی
- [x] Validation ساختاری و Handler result
- [x] تست‌های واحد قرارداد و سازگاری
- [ ] اجرای Ability از مسیر Combat
- [x] Target Resolver مستقل و فقط‌خواندنی (Phase 2)
- [x] Effect Planning و Resource Cost Calculation فقط‌خواندنی (Phase 3؛ بدون اجرای Effect یا مصرف منبع)
- [ ] Handler dispatcher و mutation کنترل‌شده Engine
- [ ] Status، Summon و Round Scheduler


## پیاده‌سازی Target Resolver — Phase 2

Target Resolver از همین فیلدهای `targeting.mode` و `targeting.selection` استفاده می‌کند و قرارداد موازی تعریف نمی‌کند. این مرحله فقط تعیین و اعتبارسنجی هدف‌ها را اضافه کرده است؛ مسیر Combat همچنان از آن استفاده نمی‌کند. جزئیات modeهای پشتیبانی‌شده، وضعیت‌های خروجی و نبود Summon Runtime در [docs/TARGET-RESOLVER.md](TARGET-RESOLVER.md) آمده است.


## Ability Planning — Phase 3

ماژول \`src/game/planning/\` از قرارداد Ability و Target Resolver موجود استفاده می‌کند و خروجی Execution Plan قطعی می‌سازد. این مرحله فقط Effectهای \`damage/defense\` و Costهای \`none/fixed NP/legacy techNpCost\` را برنامه‌ریزی می‌کند. برای Fixed Cost فقط NP معتبر است؛ HP و منابع دیگر رد می‌شوند. قرارداد مشترک و Adapterها تغییر نکرده‌اند. خروجی صرفاً intent و مقدار هزینه است؛ هیچ Effect اجرا، منبع مصرف، affordability check یا اتصال Combat انجام نمی‌شود. جزئیات در [ABILITY-PLANNING.md](ABILITY-PLANNING.md) ثبت شده است.
