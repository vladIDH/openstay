/**
 * Schema migrations: a database written by an older Fairnight reaches the
 * latest version, step by step, keeping its data. The old schemas are the
 * exact SQL of those versions (from the history of this repository).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { getMeta, hasColumn, openDb, SCHEMA_VERSION } from "../src/db.js";
import { fixture, tempDir } from "./helpers.js";

const tables = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);

/** A database as that version left it, with one stay in it. */
function oldDatabase(version: 3 | 4 | 5 | 6): string {
  const file = path.join(tempDir(), "data", "fairnight.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(fixture(`schema-${version}.sql`));
  // Versions up to 5 added booked_at with ALTER TABLE, as their upgrade did.
  db.exec("ALTER TABLE calendar_events ADD COLUMN booked_at TEXT");
  // Version 6 added the room of a stay the same way.
  if (version >= 6) db.exec("ALTER TABLE calendar_events ADD COLUMN unit TEXT; ALTER TABLE calendar_events ADD COLUMN units INTEGER");
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(version));
  db.prepare(
    "INSERT INTO calendar_events (listing, feed, uid, check_in, check_out, kind, first_seen_at, last_seen_at, booked_at) VALUES ('casa-prova', 'airbnb', 'prova-1', '2099-06-10', '2099-06-13', 'reservation', 'x', 'x', '2099-05-20')",
  ).run();
  db.close();
  return file;
}

describe("schema migrations", () => {
  it("the latest version is 10: zone data (4), Fairguest (5), rooms of small hotels (6), Fairhello (7), Fairguest in Italy (8), check-in link (9), Istat (10)", () => {
    expect(SCHEMA_VERSION).toBe(10);
  });

  it("takes a database from schema 3 to the latest, keeping its data", () => {
    const file = oldDatabase(3);
    const before = new Database(file, { readonly: true });
    expect(tables(before)).not.toContain("market_days");
    expect(tables(before)).not.toContain("guest_stays");
    before.close();

    const db = openDb(file);
    expect(getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
    expect(tables(db)).toEqual(expect.arrayContaining(["market_areas", "market_days", "guest_stays", "guest_people", "guest_submissions"]));
    expect(db.prepare("SELECT uid, booked_at FROM calendar_events").all()).toEqual([{ uid: "prova-1", booked_at: "2099-05-20" }]);
    db.close();
    // Opening again changes nothing.
    const again = openDb(file);
    expect(getMeta(again, "schema_version")).toBe(String(SCHEMA_VERSION));
    expect(again.prepare("SELECT COUNT(*) AS n FROM calendar_events").get()).toEqual({ n: 1 });
    again.close();
  });

  it("takes a database from schema 4 (zone data) to the latest", () => {
    const file = oldDatabase(4);
    const db = openDb(file);
    expect(getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
    expect(tables(db)).toEqual(expect.arrayContaining(["market_days", "guest_stays"]));
    db.close();
  });

  it("takes a database from schema 5 (Fairguest) to the latest: stays get a room (unit) and a number of rooms (units)", () => {
    const file = oldDatabase(5);
    const db = openDb(file);
    expect(getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
    expect(db.prepare("SELECT uid, unit, units FROM calendar_events").all()).toEqual([{ uid: "prova-1", unit: null, units: null }]);
    // Fairguest in Italy: the recognition of the guests and the receipts.
    expect(hasColumn(db, "guest_stays", "recognized_at")).toBe(true);
    expect(tables(db)).toContain("guest_receipts");
    // The check-in link: the mailbox of a stay, and where a guest from it was sealed.
    expect(hasColumn(db, "guest_stays", "relay_box")).toBe(true);
    expect(hasColumn(db, "guest_people", "place")).toBe(true);
    // Istat: the sealed record of a stay and the days sent.
    expect(hasColumn(db, "guest_stays", "istat_data")).toBe(true);
    expect(tables(db)).toContain("guest_istat_days");
    db.close();
  });

  it("takes a database from schema 6 to the latest: the guest assistant's tables (Fairhello) appear, then Fairguest in Italy", () => {
    const file = oldDatabase(6);
    const before = new Database(file, { readonly: true });
    expect(tables(before)).not.toContain("hello_drafts");
    before.close();
    const db = openDb(file);
    expect(getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
    expect(tables(db)).toEqual(expect.arrayContaining(["hello_stays", "hello_messages", "hello_drafts", "hello_runs"]));
    // Then Fairguest in Italy (8): the recognition of the guests and the receipts.
    expect(hasColumn(db, "guest_stays", "recognized_at")).toBe(true);
    expect(tables(db)).toContain("guest_receipts");
    expect(db.prepare("SELECT uid FROM calendar_events").all()).toEqual([{ uid: "prova-1" }]);
    db.close();
  });

  it("a new database goes through every step and has booked_at", () => {
    const db = openDb(path.join(tempDir(), "data", "fairnight.db"));
    expect(getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
    expect(hasColumn(db, "calendar_events", "booked_at")).toBe(true);
    expect(hasColumn(db, "calendar_events", "unit")).toBe(true);
    expect(hasColumn(db, "calendar_events", "units")).toBe(true);
    db.close();
  });
});
