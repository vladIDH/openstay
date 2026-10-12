/**
 * `fairnight price`: read config and database, run the engine, print the nights.
 */
import { formatAmount, priceListing } from "fairnight";
import type { ListingCalendar, NightQuote, PastPrice, PricingResult, Stay } from "fairnight";
import { localToday } from "./io.js";
import { feedKeys, type HostListing } from "./config.js";
import type { Db } from "./db.js";

/** Live (not removed) stays and blocks of a listing, from the calendars still in its config. */
export function loadStays(db: Db, listing: HostListing): Stay[] {
  const feeds = feedKeys(listing);
  if (feeds.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT check_in, check_out, kind FROM calendar_events
       WHERE listing = ? AND removed_at IS NULL AND feed IN (${feeds.map(() => "?").join(", ")})
       ORDER BY check_in, check_out, kind`,
    )
    .all(listing.name, ...feeds) as { check_in: string; check_out: string; kind: "reservation" | "blocked" }[];
  return rows.map((r) => ({ checkIn: r.check_in, checkOut: r.check_out, kind: r.kind }));
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
  const row = db
    .prepare(
      `SELECT MAX(first_seen_at) AS at FROM calendar_events
       WHERE listing = ? AND kind = 'reservation' AND feed IN (${feeds.map(() => "?").join(", ")})`,
    )
    .get(listing.name, ...feeds) as { at: string | null };
  return row.at === null ? null : localToday(new Date(row.at));
}

export function priceOne(db: Db, listing: HostListing, today: string, days: number): PricingResult {
  const calendar: ListingCalendar = {
    stays: loadStays(db, listing),
    priceHistory: loadPriceHistory(db, listing.name),
  };
  const last = lastBookingReceived(db, listing);
  if (last !== null) calendar.lastBookingReceived = last;
  return priceListing(listing.pricing, calendar, { today, days });
}

/** Short reason for the table: every step except the base, e.g. `season "Summer" +25%, sat +15%`. */
function shortReason(n: NightQuote): string {
  if (n.price === null) return n.status;
  const parts = n.steps
    .filter((s) => s.factor !== "base" && !(s.factor === "limits" && s.before === s.after) && s.factor !== "rounding")
    .map((s) => {
      if (s.percent !== undefined) return `${s.label} ${s.percent >= 0 ? "+" : ""}${formatAmount(s.percent)}%`;
      if (s.factor === "limits") return s.label;
      return `${s.label} ${formatAmount(s.after)}`;
    });
  return parts.length > 0 ? parts.join(", ") : "base";
}

const pad = (s: string, n: number) => s.padEnd(n);
const lpad = (s: string, n: number) => s.padStart(n);

export function formatTable(result: PricingResult, name: string, synced: string | null, explain: boolean): string[] {
  const lines: string[] = [];
  lines.push(`${name} · ${result.days} nights from ${result.today} · prices in ${result.currency}`);
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
