-- Dili Cart accounts, sessions and races.
-- Handles are the player's X handle; there is no email or other personal data.

CREATE TABLE players (
  handle        TEXT PRIMARY KEY,               -- lowercase, [a-z0-9_]{3,15}
  pass          TEXT NOT NULL,                  -- pbkdf2$iterations$salt$hash
  created_at    INTEGER NOT NULL,
  points        INTEGER NOT NULL DEFAULT 0,     -- lifetime, after streak bonus
  best          INTEGER NOT NULL DEFAULT 0,     -- best single race score
  best_time     REAL,                           -- fastest three laps, seconds
  races         INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  podiums       INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  last_day      TEXT NOT NULL DEFAULT '',       -- UTC yyyy-mm-dd of the last race
  last_race_at  INTEGER NOT NULL DEFAULT 0,
  char          TEXT NOT NULL DEFAULT 'dili'
);
CREATE INDEX players_best ON players (best DESC);
CREATE INDEX players_points ON players (points DESC);

-- Only a hash of each session token is stored, never the token itself.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  handle      TEXT NOT NULL REFERENCES players (handle) ON DELETE CASCADE,
  expires     INTEGER NOT NULL
);
CREATE INDEX sessions_handle ON sessions (handle);

CREATE TABLE races (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  handle      TEXT NOT NULL REFERENCES players (handle) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  position    INTEGER NOT NULL,
  time        REAL NOT NULL,
  coins       INTEGER NOT NULL,
  earned      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX races_handle ON races (handle, created_at DESC);

-- Fixed-window counters for rate limiting sign-ups and log-in attempts.
CREATE TABLE attempts (
  key       TEXT PRIMARY KEY,
  count     INTEGER NOT NULL,
  window    INTEGER NOT NULL
);
