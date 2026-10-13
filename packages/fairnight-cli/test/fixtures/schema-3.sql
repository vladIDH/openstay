CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Stays and blocks read from the iCal calendars. Never deleted: when an event
-- disappears from its calendar it gets removed_at, and loses it if it comes back.
CREATE TABLE IF NOT EXISTS calendar_events (
  id            INTEGER PRIMARY KEY,
  listing       TEXT NOT NULL,
  feed          TEXT NOT NULL,
  uid           TEXT NOT NULL,
  check_in      TEXT NOT NULL,
  check_out     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('reservation', 'blocked')),
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  removed_at    TEXT,
  UNIQUE (listing, feed, uid)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id       INTEGER PRIMARY KEY,
  listing  TEXT NOT NULL,
  feed     TEXT NOT NULL,
  at       TEXT NOT NULL,
  ok       INTEGER NOT NULL,
  seen     INTEGER NOT NULL DEFAULT 0,
  added    INTEGER NOT NULL DEFAULT 0,
  changed  INTEGER NOT NULL DEFAULT 0,
  removed  INTEGER NOT NULL DEFAULT 0,
  restored INTEGER NOT NULL DEFAULT 0,
  error    TEXT
);

-- Past nightly prices imported from CSV. One price per listing and night.
CREATE TABLE IF NOT EXISTS price_history (
  listing     TEXT NOT NULL,
  date        TEXT NOT NULL,
  price       REAL NOT NULL,
  source      TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (listing, date)
);

-- Version 2 (Smoobu). Price of each Smoobu stay: the total of the stay, its
-- nights and the average per night. It is an average per STAY, not the price of
-- each night; the historical floor uses it only with --usa-storico-smoobu.
CREATE TABLE IF NOT EXISTS smoobu_stays (
  listing     TEXT NOT NULL,
  uid         TEXT NOT NULL,
  check_in    TEXT NOT NULL,
  check_out   TEXT NOT NULL,
  nights      INTEGER NOT NULL,
  total       REAL NOT NULL,
  per_night   REAL NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (listing, uid)
);

-- Every write to Smoobu, for the record.
CREATE TABLE IF NOT EXISTS smoobu_pushes (
  id           INTEGER PRIMARY KEY,
  listing      TEXT NOT NULL,
  apartment_id INTEGER NOT NULL,
  at           TEXT NOT NULL,
  nights       INTEGER NOT NULL,
  operations   INTEGER NOT NULL,
  mismatches   INTEGER NOT NULL,
  error        TEXT
);

-- Version 3 (Beds24). Same meaning as the Smoobu tables: the total of each
-- stay, its nights and the average per night (an average per STAY), used by
-- the historical floor only with --usa-storico-beds24.
CREATE TABLE IF NOT EXISTS beds24_stays (
  listing     TEXT NOT NULL,
  uid         TEXT NOT NULL,
  check_in    TEXT NOT NULL,
  check_out   TEXT NOT NULL,
  nights      INTEGER NOT NULL,
  total       REAL NOT NULL,
  per_night   REAL NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (listing, uid)
);

-- Every write to Beds24, for the record, with the credits it cost.
CREATE TABLE IF NOT EXISTS beds24_pushes (
  id         INTEGER PRIMARY KEY,
  listing    TEXT NOT NULL,
  room_id    INTEGER NOT NULL,
  at         TEXT NOT NULL,
  nights     INTEGER NOT NULL,
  writes     INTEGER NOT NULL,
  refused    INTEGER NOT NULL,
  mismatches INTEGER NOT NULL,
  credits    INTEGER NOT NULL,
  error      TEXT
);
