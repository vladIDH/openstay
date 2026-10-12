/**
 * The host's local database: one SQLite file in <folder>/data/fairnight.db.
 * Nothing in here ever leaves the host's machine.
 *
 * We keep only what pricing needs: dates and whether a night is a stay or a
 * block. No guest names, phone numbers or descriptions from the calendars.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA_VERSION = 1;

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
`;

/**
 * Open an existing database for reading only: SQLite itself refuses any write.
 * Used by the MCP server, which must never change the host's data.
 */
export function openDbReadOnly(file: string): Db {
  return new Database(file, { readonly: true, fileMustExist: true });
}

export function openDb(file: string): Db {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  return db;
}
