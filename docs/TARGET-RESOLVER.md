# Target Resolver — Phase 2

## دامنه

این ماژول یک Resolver خالص و فقط‌خواندنی برای هدف‌گیری Ability است. ورودی آن Ability نرمال‌شده Phase 1، snapshot بازیکن Actor و snapshot بازیکنان بازی است. این ماژول نه Telegram را می‌شناسد، نه D1 را فراخوانی می‌کند و نه HP/NP، نوبت، Effect یا وضعیت بازی را تغییر می‌دهد.

## ارتباط با قرارداد Phase 1

Resolver مستقیماً از `ability.targeting.mode` و `ability.targeting.selection` موجود استفاده می‌کند؛ schema موازی ساخته نشده و قرارداد Phase 1 تغییر ساختاری نکرده است.

| mode | selection | رفتار Runtime فعلی |
|---|---|---|
| `self` | `automatic` | Actor زنده |
| `single_enemy` | `manual` | یک دشمن زنده؛ در نبود انتخاب، فهرست Candidate برمی‌گردد |
| `single_enemy` | `automatic` | فقط اگر دقیقاً یک دشمن باشد؛ در حالت مبهم سیاست انتخاب اختراع نمی‌شود |
| `single_ally` | `manual` / `automatic` | یک هم‌تیمی زنده؛ automatic فقط با یک Candidate |
| `all_enemies` | `automatic` | همه بازیکنان زنده خارج از تیم Actor |
| `all_allies` | `automatic` | همه هم‌تیمی‌های زنده به‌جز Actor |
| `none` | `none` | بدون هدف؛ برای قابلیت‌های بدون Target |
| `single_summon`, `owned_summons`, `custom` | هر مقدار قراردادی معتبر | در Runtime فعلی پشتیبانی نمی‌شوند و `unsupported` برمی‌گردانند |

### معنای تیم

این ماژول رفتار فعلی Combat را حفظ می‌کند:

- دشمن: هر بازیکن زنده غیر از Actor که تیمش با تیم Actor برابر نباشد؛ اگر Actor تیم خالی داشته باشد، تمام بازیکنان زنده دیگر دشمن محسوب می‌شوند.
- هم‌تیمی: بازیکن زنده دیگری با همان تیم غیرخالی Actor.
- Actor در `single_ally` و `all_allies` وارد نمی‌شود؛ هدف `self` حالت مستقلی است.
- فقط `alive=1` یا `alive=true` Candidate معتبر است. داده بازیکن حذف‌شده از نتیجه حذف می‌شود. Actor نیز باید زنده و عضو snapshot همان بازی باشد.

این تعاریف از شرط‌های واقعی `commands/combat.js` استخراج شده‌اند، نه از حدس درباره قوانین آینده.

## API

```js
import { resolveTargets } from './targeting/resolver.js';

const result = resolveTargets({
  ability,                   // Ability record from Phase 1 Registry
  actor,                     // Player snapshot; user_id is required
  context: {
    game: { status: 'active' }, // optional; if supplied, must be active
    players: playerSnapshots,   // required, same chat/game only
  },
  selectedTargetIds: [123],  // optional; IDs for manual selection
});
```

هر snapshot بازیکن باید حداقل `user_id`، `team` و `alive` داشته باشد. برای کنترل مالکیت Ability، `char_key` نیز در Actor لازم است. Actor دوباره از `context.players` بر اساس `user_id` خوانده می‌شود؛ مقادیر team/alive ارسالی جداگانه نمی‌توانند snapshot معتبر را override کنند.

Candidate خروجی حداقلی و بدون HP/NP یا فیلدهای داخلی است: `{ type: 'player', id, name }`.

### وضعیت خروجی

| status | معنا |
|---|---|
| `resolved` | هدف یا اهداف معتبر تعیین شدند |
| `needs_selection` | انتخاب دستی لازم است؛ `candidates` گزینه‌های مجاز را می‌دهد |
| `invalid_selection` | انتخاب ارائه‌شده با Candidateها یا روش انتخاب سازگار نیست |
| `invalid_actor` | Actor وجود ندارد، زنده نیست یا مالک Ability نیست |
| `invalid_context` | snapshot بازی ناقص/ناسازگار است یا بازی در وضعیت فعال نیست |
| `invalid_ability` | Ability غیرفعال یا تعریف targeting/مالکیت آن نامعتبر است |
| `no_valid_targets` | هیچ Candidate مجازی برای این Ability وجود ندارد |
| `unsupported` | نوع هدف یا سیاست انتخاب در Runtime فعلی پشتیبانی نمی‌شود |

`reason` کد پایدار برای بررسی برنامه‌ای است؛ پیام کاربرپسند باید در لایه بالاتر ساخته شود.

## توابع مستقل

- `getTargetDefinition(ability)`: استخراج و بررسی تعریف targeting.
- `resolvePlayerCandidates({ mode, actor, players })`: فیلتر Candidateهای بازیکن بر اساس mode، تیم و alive.
- `validateTargetSelection(...)`: اعتبارسنجی تعداد، تکرار و عضویت هدف انتخاب‌شده.
- `resolveTargets(...)`: orchestration محدود این توابع و تولید خروجی ساختاریافته.

## محدودیت‌ها و مرزهای معماری

- هیچ Query یا تغییر D1 در Resolver وجود ندارد؛ caller باید snapshotهای متعلق به همان بازی را تهیه کند.
- Resolver وضعیت نوبت Actor را enforce نمی‌کند؛ کنترل نوبت همچنان مسئولیت جریان Combat/Engine است. اگر `context.game.status` داده شود، فقط فعال‌بودن بازی بررسی می‌شود.
- Ability غیرفعال یا دارای تعریف targeting/owners ناقص رد می‌شود. Abilityهای allowlist فقط وقتی پذیرفته می‌شوند که `actor.char_key` به شخصیت واقعی Catalog نگاشت شود و شناسه آن در `owners.characterIds` باشد.
- اگر انتخاب خودکار برای یک هدف تکی بیش از یک Candidate داشته باشد، Resolver `unsupported / automatic_selection_ambiguous` می‌دهد؛ هیچ انتخاب تصادفی یا مبتنی بر ترتیب صندلی انجام نمی‌شود.
- Summon Runtime، جدول/Entity، مالکیت Summon و snapshot آن وجود ندارد؛ هیچ Candidate یا داده جعلی Summon ساخته نمی‌شود.
- `custom` به handler سفارشی متصل نشده است؛ در حال حاضر فقط وضعیت unsupported دارد.
- این ماژول هیچ Attack/Defense/Effect/NP یا تغییر نوبتی اجرا نمی‌کند و به مسیر Combat فعلی متصل نشده است.

## تست

`tests/targeting.test.mjs` سناریوهای self، enemy/ally، چندهدفه خودکار، تیم خالی، حذف‌شده، انتخاب دستی/خودکار، تکرار، تعداد اشتباه، Actor غیرمجاز، Context نامعتبر و حالت‌های پشتیبانی‌نشده را پوشش می‌دهد. Summonها فقط به‌عنوان unsupported تست می‌شوند؛ هیچ Runtime جعلی ساخته نشده است.
