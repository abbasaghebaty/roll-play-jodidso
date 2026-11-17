-- اجرای دوباره‌ی این فایل بی‌خطر است (همه‌چیز IF NOT EXISTS است).
CREATE TABLE IF NOT EXISTS games (
  chat_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'lobby',
  turn_user INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS players (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  char_key TEXT NOT NULL,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  np INTEGER NOT NULL,
  max_np INTEGER NOT NULL,
  team TEXT NOT NULL DEFAULT '',
  alive INTEGER NOT NULL DEFAULT 1,
  seat INTEGER NOT NULL DEFAULT 0,
  poisoned INTEGER NOT NULL DEFAULT 0,
  drained INTEGER NOT NULL DEFAULT 0,
  last_tech TEXT NOT NULL DEFAULT '',
  spam INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  attacker_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  dmg INTEGER NOT NULL,
  tech TEXT NOT NULL
);

-- ---------- لاگ و گزارش مشکل ----------

-- لاگ همه‌ی دستورهای ورودی، پیام‌های خروجی ربات، رویدادهای بازی (تاس و دمیج) و خطاها
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  chat_id INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,              -- in | out | event | error
  tg_msg_id INTEGER,
  text TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_logs_chat ON logs (chat_id, id);

-- گزارش‌هایی که با /bug ثبت می‌شوند (به‌همراه عکس لحظه‌ای از بازی و لاگ‌های اطراف)
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  chat_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  reporter_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  ref_msg_id INTEGER,
  ref_from_id INTEGER,
  ref_from_bot INTEGER NOT NULL DEFAULT 0,
  ref_text TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  logs TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',   -- open | done
  resolution TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, id);

-- جلوگیری از اجرای دوباره‌ی یک آپدیت تلگرام (ریتری)
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY
);


-- پیام‌های موقت ربات (نتیجه‌ها و دکمه‌های دفاع) برای پاک‌سازی دقیق.
CREATE TABLE IF NOT EXISTS bot_msgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_msgs_chat_kind ON bot_msgs (chat_id, kind);

-- پیام ثابت پنل مبارزه؛ افزودن این جدول داده‌های بازی‌های قبلی را تغییر نمی‌دهد.
CREATE TABLE IF NOT EXISTS battle_ui (
  chat_id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL
);


-- آخرین بازیکنی که پیام نوبت اختصاصی برایش ارسال شده؛ برای جلوگیری از اعلان تکراری.
CREATE TABLE IF NOT EXISTS battle_turn_ui (
  chat_id INTEGER PRIMARY KEY,
  turn_user INTEGER NOT NULL
);


-- ---------- وضعیت‌های ماندگار قوانین هادی ----------
-- افکت‌ها به‌صورت داده ذخیره می‌شوند تا سیل، مود، سم، آنتی‌سیل،
-- آنتی‌دامین و محدودیت‌های راندی پس از ری‌استارت Worker از بین نروند.
CREATE TABLE IF NOT EXISTS game_effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL DEFAULT 0,
  target_id INTEGER NOT NULL,
  effect_type TEXT NOT NULL,
  rounds_left INTEGER NOT NULL DEFAULT 0,
  stacks INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_game_effects_target ON game_effects(chat_id, target_id, effect_type);

-- سامن‌های فعال و ابدی، با HP مستقل از صاحب سامن.
CREATE TABLE IF NOT EXISTS summons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  summon_key TEXT NOT NULL,
  summon_type TEXT NOT NULL,
  hp INTEGER NOT NULL DEFAULT 0,
  max_hp INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_summons_owner ON summons(chat_id, owner_id, active);

-- شمارنده‌ی راند و داده‌های برخورد قلمروها، مستقل از پیام‌های تلگرام.
CREATE TABLE IF NOT EXISTS game_round_state (
  chat_id INTEGER PRIMARY KEY,
  round_no INTEGER NOT NULL DEFAULT 1,
  domain_clash_json TEXT NOT NULL DEFAULT '{}',
  turn_meta_json TEXT NOT NULL DEFAULT '{}'
);
