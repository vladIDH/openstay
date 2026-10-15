/**
 * The host's local database: one SQLite file in <folder>/data/fairnight.db.
 * Nothing in here ever leaves the host's machine.
 *
 * We keep only what pricing needs: dates and whether a night is a stay or a
 * block. No guest names, phone numbers or descriptions from the calendars.
 * The guest registration (Fairguest, the guest_* tables) keeps every personal
 * field encrypted: in clear there are only random ids, dates and states.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SetupError } from "./config.js";

export type Db = Database.Database;

export const SCHEMA_VERSION = 8;

const SCHEMA = `
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
  -- Italy: when the host confirmed they saw the guests in person or on a live video call
  recognized_at TEXT,
  -- the mailbox of the check-in link on the relay (version 8): its id and secrets, no personal data
  relay_box    TEXT,
  relay_read   TEXT,
  relay_write  TEXT,
  UNIQUE (listing, source, source_uid)
);

-- One row per guest, sealed whole.
CREATE TABLE IF NOT EXISTS guest_people (
  id       TEXT PRIMARY KEY,
  stay_id  TEXT NOT NULL REFERENCES guest_stays (id),
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL CHECK (added_by IN ('host', 'form')),
  data     TEXT NOT NULL,
  -- version 8: where a guest from the check-in link was sealed (relay/<box>); null = guest_people/<id>/data
  place    TEXT
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

-- Version 7: the Alloggiati Web receipts (one PDF per account and day), kept
-- 5 years. No personal data: the PDF holds only the number of schedine.
CREATE TABLE IF NOT EXISTS guest_receipts (
  account    TEXT NOT NULL,
  day        TEXT NOT NULL,
  file       TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (account, day)
);
`;

/**
 * The steps from one schema version to the next, applied in order to an older
 * database (a new one starts at 1 and runs them all). New tables come from
 * SCHEMA (CREATE TABLE IF NOT EXISTS), so a step only changes what exists.
 */
const MIGRATIONS: { to: number; run(db: Database.Database): void }[] = [
  {
    to: 2, // Smoobu: the day the booking was made, when the source knows it (Smoobu's created-at)
    run: (db) => {
      if (!hasColumn(db, "calendar_events", "booked_at")) db.exec("ALTER TABLE calendar_events ADD COLUMN booked_at TEXT");
    },
  },
  { to: 3, run: () => {} }, // Beds24: new tables only
  { to: 4, run: () => {} }, // zone data: new tables only
  { to: 5, run: () => {} }, // Fairguest: new tables only
  {
    to: 6, // small hotels: the room of a stay (unit) or how many rooms it takes (units), from Smoobu or Beds24
    run: (db) => {
      if (!hasColumn(db, "calendar_events", "unit")) db.exec("ALTER TABLE calendar_events ADD COLUMN unit TEXT");
      if (!hasColumn(db, "calendar_events", "units")) db.exec("ALTER TABLE calendar_events ADD COLUMN units INTEGER");
    },
  },
  {
    to: 7, // Fairguest Italy: the recognition of the guests (and the receipts table, new)
    run: (db) => {
      if (hasTable(db, "guest_stays") && !hasColumn(db, "guest_stays", "recognized_at")) db.exec("ALTER TABLE guest_stays ADD COLUMN recognized_at TEXT");
    },
  },
  {
    to: 8, // the check-in link: the relay mailbox of a stay, and where a guest from it was sealed
    run: (db) => {
      for (const c of ["relay_box", "relay_read", "relay_write"]) if (!hasColumn(db, "guest_stays", c)) db.exec(`ALTER TABLE guest_stays ADD COLUMN ${c} TEXT`);
      if (!hasColumn(db, "guest_people", "place")) db.exec("ALTER TABLE guest_people ADD COLUMN place TEXT");
    },
  },
];

function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function upgrade(db: Database.Database): void {
  const current = Number(getMeta(db, "schema_version") ?? "1");
  db.transaction(() => {
    for (const m of MIGRATIONS) {
      if (m.to <= current || m.to > SCHEMA_VERSION) continue;
      m.run(db);
      setMeta(db, "schema_version", String(m.to));
    }
  })();
}

/** Does this (possibly older, read-only) database have the column? */
export function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
}

export function getMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

/**
 * Open an existing database for reading only: SQLite itself refuses any write.
 * Used by the MCP server, which must never change the host's data.
 */
export function openDbReadOnly(file: string): Db {
  return new Database(file, { readonly: true, fileMustExist: true });
}

/**
 * better-sqlite3 is a compiled module: after Node.js is updated to a new major
 * version it no longer loads. Tell the host how to fix it instead of a stack trace.
 */
function newDatabase(file: string): Db {
  try {
    return new Database(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ERR_DLOPEN_FAILED") throw e;
    throw new SetupError(
      `Fairnight non parte con questa versione di Node.js (${process.version}): rilancia «Installa Fairnight» per adattarlo, i tuoi dati restano dove sono.\n` +
        `(better-sqlite3 was built for another Node.js version: run the installer again, or "npm rebuild better-sqlite3".)`,
    );
  }
}

export function openDb(file: string): Db {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = newDatabase(file);
  db.exec(SCHEMA);
  // A new database starts at version 1 and goes through every migration.
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')").run();
  upgrade(db);
  return db;
}
