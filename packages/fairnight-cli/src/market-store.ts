/**
 * Zone data in the local database (tables market_areas and market_days).
 *
 * One source per zone: importing a zone again replaces it. Data whose terms
 * limit how long it may be kept (AirROI: 30 days) carries expires_on; from
 * that day it is never used again, and it is deleted by the first command that
 * can write to the database.
 */
import type { MarketData, MarketDay } from "fairnight";
import type { Db } from "./db.js";

export interface MarketAreaRow {
  area: string;
  source: string;
  attribution: string;
  estimated: boolean;
  readOn: string;
  importedAt: string;
  expiresOn: string | null;
  file: string | null;
  note: string | null;
  days: number;
  first: string | null;
  last: string | null;
  averageOccupancy: number | null;
  averagePrice: number | null;
}

export interface MarketImport {
  area: string;
  source: string;
  attribution: string;
  estimated: boolean;
  readOn: string;
  importedAt: string;
  expiresOn?: string;
  file?: string;
  note?: string;
  days: MarketDay[];
}

const hasTables = (db: Db) =>
  (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('market_areas', 'market_days')").get() as { n: number }).n === 2;

/** Replace the data of a zone. */
export function saveMarket(db: Db, m: MarketImport): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM market_days WHERE area = ?").run(m.area);
    db.prepare(
      `INSERT INTO market_areas (area, source, attribution, estimated, read_on, imported_at, expires_on, file, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (area) DO UPDATE SET source = excluded.source, attribution = excluded.attribution, estimated = excluded.estimated,
         read_on = excluded.read_on, imported_at = excluded.imported_at, expires_on = excluded.expires_on, file = excluded.file, note = excluded.note`,
    ).run(m.area, m.source, m.attribution, m.estimated ? 1 : 0, m.readOn, m.importedAt, m.expiresOn ?? null, m.file ?? null, m.note ?? null);
    const insert = db.prepare("INSERT INTO market_days (area, date, occupancy, average_price, comparables) VALUES (?, ?, ?, ?, ?)");
    for (const d of m.days) insert.run(m.area, d.date, d.occupancyPercent ?? null, d.averagePrice ?? null, d.comparables ?? null);
  });
  tx();
}

/** Delete zones whose data may no longer be kept. Returns the zones deleted. */
export function purgeExpiredMarket(db: Db, today: string): string[] {
  if (db.readonly || !hasTables(db)) return [];
  const expired = (db.prepare("SELECT area FROM market_areas WHERE expires_on IS NOT NULL AND expires_on <= ?").all(today) as { area: string }[]).map(
    (r) => r.area,
  );
  for (const area of expired) deleteArea(db, area);
  return expired;
}

function deleteArea(db: Db, area: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM market_days WHERE area = ?").run(area);
    db.prepare("DELETE FROM market_areas WHERE area = ?").run(area);
  })();
}

/** Delete zones on request: one zone, every zone of a source, or everything. Returns the zones deleted. */
export function deleteMarket(db: Db, filter: { area?: string; source?: string }): string[] {
  if (!hasTables(db)) return [];
  const rows = db.prepare("SELECT area, source FROM market_areas ORDER BY area").all() as { area: string; source: string }[];
  const chosen = rows.filter((r) => (filter.area === undefined || r.area === filter.area) && (filter.source === undefined || r.source === filter.source));
  for (const r of chosen) deleteArea(db, r.area);
  return chosen.map((r) => r.area);
}

interface AreaDbRow {
  area: string;
  source: string;
  attribution: string;
  estimated: number;
  read_on: string;
  imported_at: string;
  expires_on: string | null;
  file: string | null;
  note: string | null;
}

/** The zone's data as the engine wants it, or null if there is none (or it has expired). */
export function loadMarket(db: Db, area: string, today: string): MarketData | null {
  if (!hasTables(db)) return null;
  const row = db.prepare("SELECT * FROM market_areas WHERE area = ?").get(area) as AreaDbRow | undefined;
  if (!row) return null;
  if (row.expires_on !== null && row.expires_on <= today) {
    if (!db.readonly) deleteArea(db, area);
    return null;
  }
  const rows = db.prepare("SELECT date, occupancy, average_price, comparables FROM market_days WHERE area = ? ORDER BY date").all(area) as {
    date: string;
    occupancy: number | null;
    average_price: number | null;
    comparables: number | null;
  }[];
  const days = rows.map((r) => {
    const d: MarketDay = { date: r.date };
    if (r.occupancy !== null) d.occupancyPercent = r.occupancy;
    if (r.average_price !== null) d.averagePrice = r.average_price;
    if (r.comparables !== null) d.comparables = r.comparables;
    return d;
  });
  const data: MarketData = { source: row.source, attribution: row.attribution, area, readOn: row.read_on, days };
  if (row.estimated === 1) data.estimated = true;
  return data;
}

/** Every zone still usable today, with a summary of its data. */
export function listMarketAreas(db: Db, today: string): MarketAreaRow[] {
  if (!hasTables(db)) return [];
  const rows = db.prepare("SELECT * FROM market_areas ORDER BY area").all() as AreaDbRow[];
  return rows
    .filter((r) => r.expires_on === null || r.expires_on > today)
    .map((r) => {
      const s = db
        .prepare("SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last, AVG(occupancy) AS occ, AVG(average_price) AS price FROM market_days WHERE area = ?")
        .get(r.area) as { n: number; first: string | null; last: string | null; occ: number | null; price: number | null };
      return {
        area: r.area,
        source: r.source,
        attribution: r.attribution,
        estimated: r.estimated === 1,
        readOn: r.read_on,
        importedAt: r.imported_at,
        expiresOn: r.expires_on,
        file: r.file,
        note: r.note,
        days: s.n,
        first: s.first,
        last: s.last,
        averageOccupancy: s.occ === null ? null : Math.round(s.occ * 10) / 10,
        averagePrice: s.price === null ? null : Math.round(s.price * 100) / 100,
      };
    });
}
