-- افزودن سپر باف به بازیکنان موجود بدون پاک‌کردن اطلاعات بازی.
ALTER TABLE players ADD COLUMN buff_hp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN buff_rank TEXT NOT NULL DEFAULT '';
