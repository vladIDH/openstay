/**
 * What the channel-manager connectors (Smoobu, Beds24) have in common: dates,
 * listing names, the table of differences, storing bookings, adding listings.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { formatAmount } from "fairnight";
import type { Db } from "./db.js";
import { configPath, stripBom } from "./io.js";
import type { FeedReport } from "./sync.js";

export const DAY = 86_400_000;
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const weekday = (iso: string) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()] as string;

/** How far back bookings are imported: enough for "same month last year". */
export const HISTORY_DAYS = 400;

/** A listing name from a channel's name: lowercase letters, digits and dashes, unique. */
export function slugify(name: string, taken: Set<string>, fallback: string): string {
  let base = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  if (!/^[a-z0-9]/.test(base)) base = fallback;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

/** Append listings to fairnight.config.json, keeping the previous file as .bak. */
export function appendListings(dir: string, listings: unknown[]): void {
  if (listings.length === 0) return;
  const file = configPath(dir);
  copyFileSync(file, `${file}.bak`);
  const raw = JSON.parse(stripBom(readFileSync(file, "utf8"))) as { listings: unknown[] };
  raw.listings.push(...listings);
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n", "utf8");
}

export interface DiffLike {
  date: string;
  currentPrice: number | null;
  currentMinStay: number | null;
  newPrice: number;
  newMinStay: number;
}

const pad = (s: string, n: number) => s.padStart(n);
const money = (n: number | null) => (n === null ? "—" : formatAmount(n));
const minStay = (n: number | null) => (n === null ? "—" : String(n));

/** The table of differences printed by `spingi`. */
export function diffTable(rows: readonly DiffLike[], channel: string): string[] {
  const head = `on ${channel}`;
  const width = Math.max(10, head.length);
  const lines = [`date        day  ${pad(head, width)}  ${pad("Fairnight", 10)}  min stay`];
  for (const r of rows) {
    lines.push(`${r.date}  ${weekday(r.date)}  ${pad(money(r.currentPrice), width)}  ${pad(money(r.newPrice), 10)}  ${minStay(r.currentMinStay)} → ${r.newMinStay}`);
  }
  return lines;
}

export function emptyReport(listing: string, feed: string): FeedReport {
  return { listing, feed, ok: false, seen: 0, added: 0, changed: 0, removed: 0, restored: 0, skipped: [] };
}

export function recordRun(db: Db, r: FeedReport, at: string): void {
  db.prepare(
    `INSERT INTO sync_runs (listing, feed, at, ok, seen, added, changed, removed, restored, error)
     VALUES (@listing, @feed, @at, @ok, @seen, @added, @changed, @removed, @restored, @error)`,
  ).run({ listing: r.listing, feed: r.feed, at, ok: r.ok ? 1 : 0, seen: r.seen, added: r.added, changed: r.changed, removed: r.removed, restored: r.restored, error: r.error ?? null });
}

export interface StayToStore {
  uid: string;
  checkIn: string;
  checkOut: string;
  kind: "reservation" | "blocked";
  bookedAt: string | null;
  stayPrice: { total: number; nights: number; perNight: number } | null;
  /** The room (unit) the stay is on, when the channel says it. */
  unit?: string | null;
  /** Rooms taken by a stay without a unit, when more than one. */
  units?: number | null;
}

interface Row {
  uid: string;
  check_in: string;
  check_out: string;
  kind: string;
  booked_at: string | null;
  removed_at: string | null;
  unit: string | null;
  units: number | null;
}

/**
 * Store the bookings of one listing from one channel: no duplicates, changes
 * updated, anything gone from the channel (cancelled, deleted) inside the
 * imported window marked removed, never deleted. Stay prices go to priceTable.
 */
export function storeStays(
  db: Db,
  args: { listing: string; feed: string; priceTable: "smoobu_stays" | "beds24_stays"; stays: readonly StayToStore[]; from: string; at: string; report: FeedReport },
): void {
  const { listing, feed, at, report: r } = args;
  const select = db.prepare("SELECT uid, check_in, check_out, kind, booked_at, removed_at, unit, units FROM calendar_events WHERE listing = ? AND feed = ?");
  const insert = db.prepare(
    `INSERT INTO calendar_events (listing, feed, uid, check_in, check_out, kind, first_seen_at, last_seen_at, booked_at, unit, units)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE calendar_events SET check_in = ?, check_out = ?, kind = ?, booked_at = ?, unit = ?, units = ?, last_seen_at = ?, removed_at = NULL
     WHERE listing = ? AND feed = ? AND uid = ?`,
  );
  const markRemoved = db.prepare("UPDATE calendar_events SET removed_at = ? WHERE listing = ? AND feed = ? AND uid = ?");
  const upsertPrice = db.prepare(
    `INSERT INTO ${args.priceTable} (listing, uid, check_in, check_out, nights, total, per_night, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (listing, uid) DO UPDATE SET check_in = excluded.check_in, check_out = excluded.check_out, nights = excluded.nights,
       total = excluded.total, per_night = excluded.per_night, imported_at = excluded.imported_at`,
  );
  const dropPrice = db.prepare(`DELETE FROM ${args.priceTable} WHERE listing = ? AND uid = ?`);

  db.transaction(() => {
    const existing = new Map((select.all(listing, feed) as Row[]).map((row) => [row.uid, row]));
    const present = new Set<string>();
    for (const s of args.stays) {
      present.add(s.uid);
      const row = existing.get(s.uid);
      const unit = s.unit ?? null;
      const units = s.units ?? null;
      if (!row) {
        insert.run(listing, feed, s.uid, s.checkIn, s.checkOut, s.kind, at, at, s.bookedAt, unit, units);
        r.added++;
      } else {
        if (row.removed_at !== null) r.restored++;
        else if (
          row.check_in !== s.checkIn ||
          row.check_out !== s.checkOut ||
          row.kind !== s.kind ||
          row.booked_at !== s.bookedAt ||
          row.unit !== unit ||
          row.units !== units
        )
          r.changed++;
        update.run(s.checkIn, s.checkOut, s.kind, s.bookedAt, unit, units, at, listing, feed, s.uid);
      }
      if (s.stayPrice) upsertPrice.run(listing, s.uid, s.checkIn, s.checkOut, s.stayPrice.nights, s.stayPrice.total, s.stayPrice.perNight, at);
      else dropPrice.run(listing, s.uid);
    }
    for (const row of existing.values()) {
      if (row.removed_at === null && !present.has(row.uid) && row.check_out >= args.from) {
        markRemoved.run(at, listing, feed, row.uid);
        dropPrice.run(listing, row.uid);
        r.removed++;
      }
    }
  })();
}
