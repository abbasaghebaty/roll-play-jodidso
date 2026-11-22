# Ability Planning — Phase 3

## هدف و مرز

این لایه یک Ability معتبر را به Execution Plan توصیفی و قطعی تبدیل می‌کند. Planning به معنی اجرا نیست: هیچ Effect اعمال نمی‌شود، هیچ HP/NP کم نمی‌شود، هیچ snapshot یا Context تغییر نمی‌کند و هیچ D1/Telegram/Combat API فراخوانی نمی‌شود.

## ماژول‌ها

| ماژول | مسئولیت |
|---|---|
| `src/game/planning/effects.js` | تبدیل Effectهای پشتیبانی‌شده به intent با استفاده از فرمول‌های موجود |
| `src/game/planning/costs.js` | اعتبارسنجی و محاسبه هزینه‌های `none`، `fixed` و `legacy` |
| `src/game/planning/ability.js` | اعتبارسنجی Ability/Actor/Context، Target Resolver و هماهنگی Effect/Cost planning |

قرارداد مشترک و Adapterهای Phase 1 تغییر نکرده‌اند. Adapter تکنیک همچنان `config.legacy` را با `rank/base/kind/free/test` تولید می‌کند؛ Adapter دفاع نیز `rank/base/perDie` را نگه می‌دارد. Planner این داده‌ها را فقط به فرمول‌های pure موجود می‌دهد.

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

- Damage فقط `finalRoll` عددی، finite و بزرگ‌تر از صفر می‌پذیرد.
- Defense فقط `defenseRoll` صحیح بین 1 تا 10 می‌پذیرد؛ این بازه از تابع موجود `d10()` گرفته شده است.
- هر دو محاسبه از `config.legacy` Adapter موجود استفاده می‌کنند.
- هر Effect یا resolver دیگر صریحاً رد می‌شود. Self-damage منفی در این Planner نیست.

## Costهای پشتیبانی‌شده

| mode | رفتار |
|---|---|
| `none` | آرایه هزینه خالی |
| `fixed` | فقط `{ mode: 'fixed', resource: 'np', amount: finite non-negative number }` |
| `legacy` | فقط resolver برابر `techNpCost`؛ مقدار Damage از intent محاسبه‌شده همان Planning دریافت می‌شود |

**Fixed Cost فقط NP را می‌پذیرد.** `hp` صریحاً با `fixed_cost_resource_forbidden` رد می‌شود. منابع ناشناخته/پشتیبانی‌نشده با `unsupported_fixed_cost_resource` رد می‌شوند. این محدودیت فقط در Phase 3 Planner اعمال می‌شود؛ Snapshot، قرارداد مشترک و Combat تغییر نکرده‌اند.

Legacy Cost فقط روی Damage intent مثبت همان Planning کار می‌کند. Planner دمیج را دوباره محاسبه نمی‌کند. Cost خروجی صرفاً مقدار پیشنهادی مصرف است و هیچ affordability check، deduction یا commit ندارد.

## خروجی Execution Plan

نمونهٔ موفق واقعی با Ability فعلی `blackflash`، `finalRoll: 1` و snapshot بازیکن:

```js
{
  status: 'planned',
  abilityId: 'tech_jjk_blackflash',
  actor: {
    userId: 1, characterKey: 'yuji',
    hp: 100, np: 80, maxHp: 205, maxNp: 210
  },
  targets: [{ type: 'player', id: 2, name: 'Target' }],
  effects: [{
    type: 'damage', resolver: 'techDamage',
    amount: 40, targetIds: [2]
  }],
  costs: [{
    mode: 'legacy', resource: 'np',
    resolver: 'techNpCost', amount: 25
  }],
  errors: []
}
```

شکست:

```js
{
  status: 'rejected', // or 'unsupported'
  abilityId: 'tech_jjk_blackflash',
  actor: null,
  targets: [],
  effects: [],
  costs: [],
  errors: [{ stage: 'costs', code: 'fixed_cost_resource_forbidden', message: '...' }]
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
4. Planning Effectها با فرمول‌های موجود
5. محاسبه Cost با استفاده از Effect intentهای محاسبه‌شده
6. ساخت Execution Plan

هیچ random، تاس، حدس‌زدن ورودی، mutation، affordability check، resource reservation، commit یا Effect execution وجود ندارد.

## محدودیت‌های صریح

- Effectهای غیر از `damage` و `defense` پشتیبانی نمی‌شوند.
- Costهای غیر از `none`، `fixed NP` و `legacy techNpCost` پشتیبانی نمی‌شوند.
- HP، درصدی، پویا، per-target و multi-resource برای Fixed Cost پشتیبانی نمی‌شوند.
- Self-damage، چند منبع، شرایط پویا، هزینه‌سنجی affordability و اجرای واقعی در دامنه این مرحله نیستند.
- Target Resolver همچنان مرجع نهایی target semantics است؛ Planner فیلتر یا انتخاب هدف را دوباره پیاده‌سازی نمی‌کند.
- هیچ اتصال به Combat، Engine، D1، Telegram، Dispatcher یا Scheduler اضافه نشده است.

## تست و اعتبارسنجی

`tests/planning.test.mjs` تست‌های Effect، Cost، Pipeline، ورودی نامعتبر، هدف نامعتبر، عدم mutation و determinism را پوشش می‌دهد. اجرای کامل تست‌ها با `npm test` و بررسی Syntax طبق Workflow موجود انجام می‌شود.
