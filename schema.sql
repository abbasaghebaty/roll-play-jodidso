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
