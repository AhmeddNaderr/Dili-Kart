-- Infinite mode on the Dlicom Skyway: each player's best run, and every run.
ALTER TABLE players ADD COLUMN endless       INTEGER NOT NULL DEFAULT 0;  -- best Infinite score
ALTER TABLE players ADD COLUMN endless_dist  INTEGER NOT NULL DEFAULT 0;  -- metres covered in that run
ALTER TABLE players ADD COLUMN endless_runs  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN last_run_at   INTEGER NOT NULL DEFAULT 0;
CREATE INDEX players_endless ON players (endless DESC);

CREATE TABLE runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  handle      TEXT NOT NULL REFERENCES players (handle) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  distance    INTEGER NOT NULL,
  time        REAL NOT NULL,
  coins       INTEGER NOT NULL,
  stage       INTEGER NOT NULL,
  earned      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  rid         TEXT
);
CREATE UNIQUE INDEX runs_rid ON runs (rid);
CREATE INDEX runs_handle ON runs (handle, created_at DESC);
