/**
 * `fairnight price`: read config and database, run the engine, print the nights.
 */
import { formatAmount, MAX_UNITS, priceListing } from "fairnight";
import type { ListingCalendar, NightQuote, PastPrice, PricingResult, Stay } from "fairnight";
import { localToday } from "./io.js";
import { feedKeys, isIcal, unitsOf, type HostListing } from "./config.js";
import { hasColumn, type Db } from "./db.js";
import { loadMarket } from "./market-store.js";

/**
 * Live (not removed) stays and blocks of a listing, from the calendars still in
 * its config. On a room type with several units each stay says
 * its room: an iCal calendar's from its "unit" in the config, a Smoobu or
 * Beds24 booking from the channel. A home (one unit) needs none of it.
 */
export function loadStays(db: Db, listing: HostListing): Stay[] {
  const feeds = feedKeys(listing);
  if (feeds.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT feed, check_in, check_out, kind${hasColumn(db, "calendar_events", "unit") ? ", unit, units" : ""} FROM calendar_events
       WHERE listing = ? AND removed_at IS NULL AND feed IN (${feeds.map(() => "?").join(", ")})
       ORDER BY check_in, check_out, kind`,
    )
    .all(listing.name, ...feeds) as { feed: string; check_in: string; check_out: string; kind: "reservation" | "blocked"; unit?: string | null; units?: number | null }[];
  if (unitsOf(listing) === 1) return rows.map((r) => ({ checkIn: r.check_in, checkOut: r.check_out, kind: r.kind }));
  const feedUnit = new Map<string, string>();
  listing.calendars.forEach((c, i) => {
    if (isIcal(c) && c.unit !== undefined) feedUnit.set(feeds[i] as string, c.unit);
  });
  return rows.map((r) => {
    const stay: Stay = { checkIn: r.check_in, checkOut: r.check_out, kind: r.kind };
    const unit = feedUnit.get(r.feed) ?? r.unit ?? undefined;
    if (unit !== undefined) stay.unit = unit;
    else if (r.units && r.units > 1) stay.units = Math.min(r.units, MAX_UNITS);
    return stay;
  });
}

export function lastSync(db: Db, listing: string): string | null {
  const row = db.prepare("SELECT MAX(at) AS at FROM sync_runs WHERE listing = ? AND ok = 1").get(listing) as { at: string | null };
  return row.at;
}

/** Past nightly prices imported with `fairnight import`. */
export function loadPriceHistory(db: Db, listing: string): PastPrice[] {
  return db.prepare("SELECT date, price FROM price_history WHERE listing = ? ORDER BY date").all(listing) as PastPrice[];
}

/**
 * The day the most recent new booking arrived: the first time `fairnight sync`
 * saw a stay that was not there before. Calendars do not say when a booking
 * was made, so this is as precise as the sync is frequent. Right after the
 * first sync every stay looks new, so the stale-calendar discount waits.
 */
export function lastBookingReceived(db: Db, listing: HostListing): string | null {
  const feeds = feedKeys(listing);
  if (feeds.length === 0) return null;
  // Smoobu tells the real booking day (booked_at); for iCal stays it is the day
  // the sync first saw them. Older databases have no booked_at column yet.
  const when = hasColumn(db, "calendar_events", "booked_at") ? "COALESCE(booked_at, first_seen_at)" : "first_seen_at";
  const rows = db
    .prepare(
      `SELECT ${when} AS at FROM calendar_events
       WHERE listing = ? AND kind = 'reservation' AND feed IN (${feeds.map(() => "?").join(", ")})`,
    )
    .all(listing.name, ...feeds) as { at: string }[];
  let latest: string | null = null;
  for (const r of rows) {
    // booked_at is already a day (YYYY-MM-DD); first_seen_at is a UTC timestamp.
    const day = r.at.length === 10 ? r.at : localToday(new Date(r.at));
    if (latest === null || day > latest) latest = day;
  }
  return latest;
}

/**
 * Average price per night of each Smoobu stay, spread over its nights. It is
 * the average of a whole STAY (total / nights), not what each night sold for.
 */
export function loadSmoobuHistory(db: Db, listing: string): PastPrice[] {
  return loadStayHistory(db, "smoobu_stays", listing);
}

/** The same for Beds24 stays (total / nights of each stay). */
export function loadBeds24History(db: Db, listing: string): PastPrice[] {
  return loadStayHistory(db, "beds24_stays", listing);
}

function loadStayHistory(db: Db, table: "smoobu_stays" | "beds24_stays", listing: string): PastPrice[] {
  const rows = db.prepare(`SELECT check_in, nights, per_night FROM ${table} WHERE listing = ? ORDER BY check_in`).all(listing) as {
    check_in: string;
    nights: number;
    per_night: number;
  }[];
  const out: PastPrice[] = [];
  for (const r of rows) {
    const first = Date.parse(`${r.check_in}T00:00:00Z`);
    for (let i = 0; i < r.nights; i++) out.push({ date: new Date(first + i * 86_400_000).toISOString().slice(0, 10), price: r.per_night });
  }
  return out;
}

export interface PriceOptions {
  /** Add Smoobu stay averages to the history used by the historical floor (CSV prices win on the same night). */
  useSmoobuHistory?: boolean;
  /** The same for Beds24 stay averages (--usa-storico-beds24). */
  useBeds24History?: boolean;
}

export function priceOne(db: Db, listing: HostListing, today: string, days: number, options: PriceOptions = {}): PricingResult {
  const csv = loadPriceHistory(db, listing.name);
  const calendar: ListingCalendar = {
    stays: loadStays(db, listing),
    // Later entries win for the same night: Smoobu averages first, then the CSV prices.
    priceHistory: [
      ...(options.useSmoobuHistory ? loadSmoobuHistory(db, listing.name) : []),
      ...(options.useBeds24History ? loadBeds24History(db, listing.name) : []),
      ...csv,
    ],
  };
  const last = lastBookingReceived(db, listing);
  if (last !== null) calendar.lastBookingReceived = last;
  if (listing.marketArea !== undefined) {
    const market = loadMarket(db, listing.marketArea, today);
    if (market !== null) calendar.market = market;
  }
  return priceListing(listing.pricing, calendar, { today, days });
}

/** Short reason for the table: every step except the base, e.g. `season "Summer" +25%, sat +15%`. */
function shortReason(n: NightQuote): string {
  const free = n.units ? `${n.units.free}/${n.units.total} free` : null;
  if (n.price === null) return free ? `${n.status}, ${free}` : n.status;
  const parts = n.steps
    .filter((s) => s.factor !== "base" && !(s.factor === "limits" && s.before === s.after) && s.factor !== "rounding")
    .map((s) => {
      if (s.percent !== undefined) return `${s.label} ${s.percent >= 0 ? "+" : ""}${formatAmount(s.percent)}%`;
      if (s.factor === "limits") return s.label;
      return `${s.label} ${formatAmount(s.after)}`;
    });
  if (free) parts.unshift(free);
  return parts.length > 0 ? parts.join(", ") : "base";
}

const pad = (s: string, n: number) => s.padEnd(n);
const lpad = (s: string, n: number) => s.padStart(n);

export function formatTable(result: PricingResult, name: string, synced: string | null, explain: boolean): string[] {
  const lines: string[] = [];
  const units = result.nights[0]?.units?.total;
  lines.push(`${name} · ${units ? `${units} units at one price · ` : ""}${result.days} nights from ${result.today} · prices in ${result.currency}`);
  if (synced === null) lines.push("  (no calendar read yet: run \"fairnight sync\" — every night is treated as free)");
  if (explain) {
    for (const n of result.nights) lines.push(n.explanation);
  } else {
    lines.push(`${pad("date", 10)}  ${pad("day", 3)}  ${lpad("price", 7)}  ${lpad("min", 3)}  why`);
    for (const n of result.nights) {
      const price = n.price === null ? "—" : formatAmount(n.price);
      const min = n.minStay === null ? "—" : String(n.minStay);
      lines.push(`${n.date}  ${pad(n.weekday, 3)}  ${lpad(price, 7)}  ${lpad(min, 3)}  ${shortReason(n)}`);
    }
  }
  const forSale = result.nights.filter((n) => n.price !== null).map((n) => n.price as number);
  const reserved = result.nights.filter((n) => n.status === "reserved").length;
  const blocked = result.nights.filter((n) => n.status === "blocked").length;
  const avg = forSale.length > 0 ? forSale.reduce((a, b) => a + b, 0) / forSale.length : null;
  lines.push(
    `${forSale.length} for sale · ${reserved} reserved · ${blocked} blocked` +
      (avg === null ? "" : ` · average ${formatAmount(Math.round(avg * 100) / 100)}, from ${formatAmount(Math.min(...forSale))} to ${formatAmount(Math.max(...forSale))}`),
  );
  return lines;
}
