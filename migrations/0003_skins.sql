-- Dili coins and kart skins. Coins picked up in races become a balance to
-- spend in the shop; everyone starts with the coins from races already run.
ALTER TABLE players ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN skins TEXT NOT NULL DEFAULT '';  -- comma list of owned skin ids
ALTER TABLE players ADD COLUMN skin  TEXT NOT NULL DEFAULT '';  -- equipped skin, '' for none
UPDATE players SET coins = (SELECT COALESCE(SUM(coins), 0) FROM races WHERE races.handle = players.handle);
