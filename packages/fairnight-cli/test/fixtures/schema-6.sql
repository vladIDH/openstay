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

-- Version 4 (zone data). One source per zone: a new import replaces the zone.
-- expires_on is set for sources whose terms limit how long data is kept
-- (AirROI: 30 days); expired zones are never used and are deleted.
CREATE TABLE IF NOT EXISTS market_areas (
  area        TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  attribution TEXT NOT NULL,
  estimated   INTEGER NOT NULL DEFAULT 0,
  read_on     TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  expires_on  TEXT,
  file        TEXT,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS market_days (
  area          TEXT NOT NULL,
  date          TEXT NOT NULL,
  occupancy     REAL,
  average_price REAL,
  comparables   INTEGER,
  PRIMARY KEY (area, date)
);

-- Version 5 (Fairguest, guest registration). Times are the host's local
-- "YYYY-MM-DDTHH:mm". Personal data only in the sealed columns (channel_data,
-- host_data, data): encrypted for the host's key, see packages/fairguest.
CREATE TABLE IF NOT EXISTS guest_stays (
  id           TEXT PRIMARY KEY,
  listing      TEXT NOT NULL,
  -- where the stay came from: manual, a calendar feed key (airbnb, booking…), smoobu, beds24
  source       TEXT NOT NULL,
  source_uid   TEXT,
  check_in     TEXT NOT NULL,
  check_out    TEXT NOT NULL,
  booked_at    TEXT,
  seen_at      TEXT NOT NULL,
  -- random code of the check-in form /checkin/<code>, valid until check-out
  code         TEXT UNIQUE,
  -- sealed: reference, holder's name and number of guests read from Smoobu or Beds24
  channel_data TEXT,
  -- sealed: corrections typed by the host; they win over channel_data
  host_data    TEXT,
  cancelled_at TEXT,
  erased_at    TEXT,
  UNIQUE (listing, source, source_uid)
);

-- One row per guest, sealed whole.
CREATE TABLE IF NOT EXISTS guest_people (
  id       TEXT PRIMARY KEY,
  stay_id  TEXT NOT NULL REFERENCES guest_stays (id),
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL CHECK (added_by IN ('host', 'form')),
  data     TEXT NOT NULL
);

-- Every communication prepared, sent or confirmed, with its outcome.
CREATE TABLE IF NOT EXISTS guest_submissions (
  id       INTEGER PRIMARY KEY,
  stay_id  TEXT NOT NULL REFERENCES guest_stays (id),
  kind     TEXT NOT NULL CHECK (kind IN ('reservation', 'checkin', 'cancellation')),
  channel  TEXT NOT NULL,
  status   TEXT NOT NULL CHECK (status IN ('prepared', 'sent', 'accepted', 'rejected', 'cancelled')),
  at       TEXT NOT NULL,
  batch    TEXT,
  -- a file written for the host to upload (Mossos); deleted with the personal data
  file     TEXT,
  detail   TEXT
);
