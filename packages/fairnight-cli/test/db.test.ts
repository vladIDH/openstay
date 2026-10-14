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
function oldDatabase(version: 3 | 4 | 5): string {
  const file = path.join(tempDir(), "data", "fairnight.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(fixture(`schema-${version}.sql`));
  // Versions up to 5 added booked_at with ALTER TABLE, as their upgrade did.
  db.exec("ALTER TABLE calendar_events ADD COLUMN booked_at TEXT");
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(version));
  db.prepare(
    "INSERT INTO calendar_events (listing, feed, uid, check_in, check_out, kind, first_seen_at, last_seen_at, booked_at) VALUES ('casa-prova', 'airbnb', 'prova-1', '2099-06-10', '2099-06-13', 'reservation', 'x', 'x', '2099-05-20')",
  ).run();
  db.close();
  return file;
}

describe("schema migrations", () => {
  it("the latest version is 6: zone data (4), Fairguest (5), then rooms of small hotels (6)", () => {
    expect(SCHEMA_VERSION).toBe(6);
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
