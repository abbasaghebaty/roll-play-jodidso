# Ability Planning — Phase 4

## هدف و مرز

این لایه یک Ability معتبر را به Execution Plan توصیفی و قطعی تبدیل می‌کند. Planning به معنی اجرا نیست: هیچ Effect اعمال نمی‌شود، هیچ HP/NP کم یا زیاد نمی‌شود، هیچ snapshot یا Context تغییر نمی‌کند و هیچ D1/Telegram/Combat API فراخوانی نمی‌شود.

Phase 4 قابلیت Phase 3 را با Healing intent و Fixed NP Cost متناسب با تعداد هدف‌های نهایی گسترش می‌دهد. قرارداد عمومی Ability و Adapterهای Catalog همچنان بدون تغییر باقی می‌مانند.

## ماژول‌ها

| ماژول | مسئولیت |
|---|---|
| `src/game/planning/effects.js` | تبدیل Effectهای `damage`، `defense` و `heal` به intent با اعتبارسنجی ورودی‌ها و استفاده از فرمول‌های pure موجود در موارد مربوط |
| `src/game/planning/costs.js` | اعتبارسنجی و محاسبه هزینه‌های `none`، `fixed NP`، `fixed NP perTarget` و `legacy` |
| `src/game/planning/ability.js` | اعتبارسنجی Ability/Actor/Context، فراخوانی Target Resolver و هماهنگی Effect/Cost planning |

## ورودی

```js
planAbility({
  ability,
  actor: { user_id: 1 },
  context: {
    game: { status: 'active' },
    players: [/* PlayerSnapshot rows */],
    calculation: { finalRoll: 1, defenseRoll: 4 },
  },
  selectedTargetIds: [2],
});
```

Actor state از ردیف متناظر در `context.players` خوانده می‌شود. Snapshot باید با Schema فعلی سازگار باشد: `user_id` صحیح مثبت، `team` رشته، `alive` عدد صحیح 0/1، و برای Actor مقادیر صحیح نامنفی `hp`، `np`، `max_hp` و `max_np`. منابع جاری نباید از سقف خود بیشتر باشند. در صورت allowlist، Target Resolver همچنان `char_key` معتبر را لازم دارد.

## Effectهای پشتیبانی‌شده

| type | resolver | ورودی محاسبه | intent |
|---|---|---|---|
| `damage` | `techDamage` | `context.calculation.finalRoll` | `{ type, resolver, amount, targetIds }` |
| `defense` | `defenseValue` | `context.calculation.defenseRoll` | `{ type, resolver, value, targetIds }` |
| `heal` | `fixed` | مقدار صریح `effect.amount`؛ بدون roll | `{ type, resolver, amount, targetIds }` |

### Damage و Defense

- Damage فقط `finalRoll` عددی، finite و بزرگ‌تر از صفر می‌پذیرد.
- Defense فقط `defenseRoll` صحیح بین 1 تا 10 می‌پذیرد؛ این بازه از تابع موجود `d10()` گرفته شده است.
- هر دو محاسبه از `config.legacy` Adapter موجود استفاده می‌کنند.
- فرمول‌های Damage و Defense در Phase 4 تغییر نکرده‌اند.

### Healing

قرارداد حداقلی Healing در این Phase:

```js
{ type: 'heal', resolver: 'fixed', amount: 35 }
```

- `resolver` باید دقیقاً `fixed` باشد؛ resolverهای ناشناخته با `unsupported_effect_resolver` رد می‌شوند.
- `amount` باید عددی، finite و بزرگ‌تر از صفر باشد. مقدار مفقود، رشته‌ای، صفر، منفی، NaN یا Infinity با `invalid_heal_amount` رد می‌شود.
- حداقل یک Target معتبر و resolve‌شده لازم است. هدف‌ها از Target Resolver می‌آیند؛ Planner هدف جدیدی انتخاب یا فیلتر نمی‌کند.
- Intent شامل `type: 'heal'`، `resolver: 'fixed'`، مقدار اعلام‌شده و `targetIds` یکتای هدف‌های resolve‌شده است.
- این قرارداد هیچ healing formula عمومی تعریف نمی‌کند. مقدار ثابت بخشی از تعریف declarative Ability است، نه محاسبهٔ مشتق‌شده از HP فعلی.
- `reversalResult()` عمداً به‌عنوان فرمول عمومی Healing استفاده نشده است: آن تابع جدول اختصاصی Reversed Cursed Technique است و HP buff و NP cost مخصوص همان قانون را با هم برمی‌گرداند. تعمیم آن به قابلیت‌هایی مانند درمان Shoko بدون تصمیم gameplay معتبر نیست.

هیچ سقف HP، مقدار HP فعلی، healing cap، یا ترتیب اعمال درمان در این مرحله محاسبه نمی‌شود.

## Costهای پشتیبانی‌شده

| mode | قرارداد | رفتار |
|---|---|---|
| `none` | `{ mode: 'none' }` | آرایه هزینه خالی |
| `fixed` | `{ mode: 'fixed', resource: 'np', amount: N }` | هزینه ثابت NP |
| `fixed` per-target | `{ mode: 'fixed', resource: 'np', amount: N, perTarget: true }` | `N × resolvedTargetCount` |
| `legacy` | resolver برابر `techNpCost` | محاسبه با Damage intent موجود |

**Fixed Cost فقط NP را می‌پذیرد.** `hp` صریحاً با `fixed_cost_resource_forbidden` رد می‌شود. منابع ناشناخته/پشتیبانی‌نشده با `unsupported_fixed_cost_resource` رد می‌شوند. این محدودیت فقط در Planner اعمال می‌شود.

### Per-target NP

در تعریف per-target، `amount` هزینهٔ NP برای هر هدف است؛ فیلد جدید `perTarget: true` حالت محاسبه را مشخص می‌کند. هیچ cost mode جدیدی ساخته نشده است.

```js
{ mode: 'fixed', resource: 'np', amount: 25, perTarget: true }
```

Planner تعداد هدف‌ها را فقط از آرایهٔ خروجی Target Resolver می‌گیرد، نه از `selectedTargetIds` ورودی یا Candidateها. برای مثال:

| تعداد هدف resolve‌شده | NP برنامه‌ریزی‌شده |
|---:|---:|
| 1 | 25 |
| 2 | 50 |
| 3 | 75 |
| 0 | 0 |

خروجی per-target شامل `unitAmount`، `targetCount` و `amount` کل است. آرایهٔ هدف نامعتبر، شناسه‌های تکراری/نامعتبر یا حاصل‌ضرب غیر finite باعث خطای ساختاریافته می‌شود. هدف صفر هزینهٔ مثبت ایجاد نمی‌کند.

Costهای Fixed قدیمی که `perTarget` ندارند، همان خروجی قبلی `{ mode, resource, amount }` را حفظ می‌کنند. Legacy Cost همچنان فقط از Damage intent همان Planning استفاده می‌کند و Damage را دوباره محاسبه نمی‌کند.

## Targeting و محدودیت‌های آن

Target Resolver مرجع نهایی تعیین و اعتبارسنجی هدف‌هاست. Planner هیچ targeting mode موازی یا فیلتر gameplay ندارد.

- `self` فقط Actor زنده را resolve می‌کند.
- `all_allies` همه هم‌تیمی‌های زنده را به‌جز Actor resolve می‌کند.
- `single_ally` یک هم‌تیمی دیگر را resolve می‌کند.
- `all_enemies` همه دشمنان زنده را resolve می‌کند.
- انتخاب دستی/خودکار و تمام اعتبارسنجی‌های عضویت، زنده‌بودن و تیم همچنان طبق [TARGET-RESOLVER.md](TARGET-RESOLVER.md) هستند.

در نتیجه، Target Resolver فعلی نمی‌تواند «Actor و همه هم‌تیمی‌های زنده» را در یک درخواست واحد نمایش دهد. `self` و `all_allies` دو mode مستقل‌اند و Planner آن‌ها را با هم ادغام نمی‌کند. Healing روی Actor یا روی هم‌تیمی‌ها به‌صورت جداگانه قابل برنامه‌ریزی است؛ ترکیب هر دو خارج از Phase 4 باقی می‌ماند تا قرارداد Target Resolver جداگانه و با حفظ سازگاری توسعه یابد.

اگر Target Resolver هدفی نداشته باشد یا انتخاب نامعتبر باشد، Pipeline پیش از ساخت Effect/Cost موفق متوقف می‌شود. Healing با آرایه هدف خالی نیز رد می‌شود.

## خروجی Execution Plan

نمونهٔ خلاصهٔ یک برنامهٔ موفق برای دو هم‌تیمی:

```js
{
  status: 'planned',
  targets: [
    { type: 'player', id: 2, name: 'Ally A' },
    { type: 'player', id: 3, name: 'Ally B' }
  ],
  effects: [{
    type: 'heal', resolver: 'fixed',
    amount: 35, targetIds: [2, 3]
  }],
  costs: [{
    mode: 'fixed', resource: 'np', perTarget: true,
    unitAmount: 25, targetCount: 2, amount: 50
  }],
  errors: []
}
```

شکست:

```js
{
  status: 'rejected', // or 'unsupported'
  actor: null,
  targets: [],
  effects: [],
  costs: [],
  errors: [{ stage: 'effects', code: 'invalid_heal_amount', message: '...' }]
}
```

وضعیت‌ها:
- `planned`: تمام مراحل موفق‌اند.
- `rejected`: ورودی/تعریف/محاسبه/انتخاب نامعتبر است.
- `unsupported`: Effect، resolver، Cost mode یا target runtime در این Phase پشتیبانی نمی‌شود.

هر شکست، Effect و Costهای خروجی را خالی می‌کند تا Plan ناقص به‌اشتباه قابل اجرا تلقی نشود. خطاها ساختاریافته‌اند و `stage`، `code` و پیام کوتاه دارند.

## ترتیب Pipeline

1. اعتبارسنجی ساختاری Ability و فعال‌بودن آن
2. اعتبارسنجی Context و Actor snapshot
3. فراخوانی Target Resolver موجود و الزام `resolved`
4. Planning Effectها با ورودی‌های معتبر
5. محاسبه Cost با استفاده از Targetهای resolve‌شده و Effect intentهای محاسبه‌شده
6. ساخت Execution Plan

هیچ random، تاس، حدس‌زدن ورودی، mutation، affordability check، resource reservation، commit یا Effect execution وجود ندارد.

## محدودیت‌های صریح

- Effectهای پشتیبانی‌شده فقط `damage`، `defense` و `heal/fixed` هستند.
- Costهای پشتیبانی‌شده فقط `none`، `fixed NP` (ثابت یا per-target) و `legacy techNpCost` هستند.
- Fixed HP و منابع غیر از NP پشتیبانی نمی‌شوند.
- Healing پویا، درصدی، مبتنی بر roll، سقف HP، محاسبه بر اساس HP فعلی و قانون عمومی درمان پیاده‌سازی نشده‌اند.
- ترکیب Actor و همه هم‌تیمی‌ها در یک target set فعلاً قابل بیان نیست.
- Self-damage، Buff، Status Effect، Summon/Entity runtime، affordability، اجرای واقعی، Dispatcher و Round Scheduler خارج از دامنه‌اند.
- هیچ اتصال به Combat، Engine، D1، Telegram، Dispatcher یا Scheduler اضافه نشده است.

## تست و اعتبارسنجی

`tests/planning.test.mjs` تست‌های Effect، Healing، Cost، per-target cost، Pipeline، ورودی نامعتبر، هدف نامعتبر، عدم mutation و determinism را پوشش می‌دهد. قرارداد Target Resolver با تست‌های مستقل خودش حفظ شده است. اجرای کامل تست‌ها با `npm test` و بررسی Syntax و import path طبق Workflow موجود انجام می‌شود.
