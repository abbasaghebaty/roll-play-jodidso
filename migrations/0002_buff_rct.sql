-- افزودن سپر باف به بازیکنان موجود بدون پاک‌کردن اطلاعات بازی.
ALTER TABLE players ADD COLUMN buff_hp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN buff_rank TEXT NOT NULL DEFAULT '';

ALTER TABLE players ADD COLUMN turns_taken INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN last_buff_turn INTEGER NOT NULL DEFAULT -1000;
ALTER TABLE players ADD COLUMN last_rct_turn INTEGER NOT NULL DEFAULT -1000;
