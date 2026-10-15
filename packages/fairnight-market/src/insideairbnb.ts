/**
 * Import of the files the host downloads from Inside Airbnb (insideairbnb.com,
 * "Get the data"), licensed CC BY 4.0. Fairnight never downloads them and never
 * reads the Inside Airbnb site: the host downloads a city once, by hand, and
 * points the import at the files.
 *
 * - calendar.csv(.gz): listing_id, date, available ("t"/"f"), price… One line
 *   per listing and night, for about a year ahead of the snapshot.
 * - listings.csv(.gz), optional: id, room_type, bedrooms, accommodates,
 *   neighbourhood_cleansed… Used only to keep the comparable listings (same room
 *   type, bedrooms, guests, neighbourhood).
 *
 * The occupancy is an ESTIMATE: "available = f" means booked OR closed by the
 * host, and the file cannot tell them apart. Listings closed on every night of
 * the file are left out (they look inactive, not fully booked).
 *
 * Both readers take the text in chunks (feed / end), so a city of tens of
 * thousands of listings is read without holding the file in memory.
 */
import type { MarketData, MarketDay } from "fairnight";
import { CsvRecords } from "./csv-records.js";
import { isIsoDay, parseAmount } from "./csv.js";

export const INSIDE_AIRBNB_ATTRIBUTION = "Inside Airbnb (insideairbnb.com), CC BY 4.0";
export const INSIDE_AIRBNB_ESTIMATE_NOTE =
  "Occupancy is an estimate: Inside Airbnb marks a night as not available whether it is booked or closed by the host.";

export interface ComparableFilter {
  /** e.g. "Entire home/apt", "Private room" (case does not matter). */
  roomType?: string;
  bedrooms?: number;
  /** Matches accommodates: how many guests the listing takes. */
  guests?: number;
  /** Matches neighbourhood_cleansed (case does not matter). */
  neighbourhood?: string;
}

export class InsideAirbnbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsideAirbnbError";
  }
}

function columnsOf(cells: string[], wanted: readonly string[], file: string): Map<string, number> {
  const map = new Map<string, number>();
  cells.forEach((c, i) => map.set(c.toLowerCase(), i));
  const missing = wanted.filter((w) => !map.has(w));
  if (missing.length > 0) {
    throw new InsideAirbnbError(`This does not look like the Inside Airbnb ${file} file: no ${missing.join(", ")} column.`);
  }
  return map;
}

/** Reads listings.csv and keeps the ids of the listings that match the filter. */
export class InsideAirbnbListings {
  readonly ids = new Set<string>();
  seen = 0;
  private columns: Map<string, number> | null = null;
  private readonly reader: CsvRecords;

  constructor(private readonly filter: ComparableFilter) {
    this.reader = new CsvRecords((cells) => this.record(cells));
  }

  feed(chunk: string): void {
    this.reader.push(chunk);
  }

  end(): Set<string> {
    this.reader.end();
    if (this.columns === null) throw new InsideAirbnbError("The listings file is empty.");
    return this.ids;
  }

  private record(cells: string[]): void {
    if (this.columns === null) {
      const wanted = ["id"];
      if (this.filter.roomType !== undefined) wanted.push("room_type");
      if (this.filter.bedrooms !== undefined) wanted.push("bedrooms");
      if (this.filter.guests !== undefined) wanted.push("accommodates");
      if (this.filter.neighbourhood !== undefined) wanted.push("neighbourhood_cleansed");
      this.columns = columnsOf(cells, wanted, "listings");
      return;
    }
    this.seen++;
    const get = (name: string) => cells[this.columns?.get(name) ?? -1] ?? "";
    const f = this.filter;
    if (f.roomType !== undefined && get("room_type").toLowerCase() !== f.roomType.toLowerCase()) return;
    if (f.bedrooms !== undefined && Number(get("bedrooms")) !== f.bedrooms) return;
    if (f.guests !== undefined && Number(get("accommodates")) !== f.guests) return;
    if (f.neighbourhood !== undefined && get("neighbourhood_cleansed").toLowerCase() !== f.neighbourhood.toLowerCase()) return;
    const id = get("id");
    if (id !== "") this.ids.add(id);
  }
}

interface DayTotal {
  listings: number;
  closed: number;
  priceSum: number;
  priceN: number;
}

export interface InsideAirbnbSummary {
  days: MarketDay[];
  /** Listings counted. */
  listings: number;
  /** Listings left out because closed on every night of the file. */
  alwaysClosed: number;
  /** Lines that could not be read (bad date or availability). */
  badLines: number;
}

/**
 * Reads calendar.csv and turns it into one zone figure per night: share of the
 * comparable listings not available (estimated occupancy), their average price
 * and how many listings were counted.
 *
 * The file is grouped by listing, so the nights of one listing are kept until
 * the next listing starts; a listing that appears again later is counted again
 * as a separate group (it does not happen in the files Inside Airbnb publishes).
 */
export class InsideAirbnbCalendar {
  private columns: Map<string, number> | null = null;
  private readonly reader: CsvRecords;
  private readonly totals = new Map<string, DayTotal>();
  private current: string | null = null;
  private nights: { date: string; closed: boolean; price: number | null }[] = [];
  private listings = 0;
  private alwaysClosed = 0;
  private badLines = 0;

  /** only: ids of the comparable listings (from InsideAirbnbListings); all listings when missing. */
  constructor(private readonly only?: Set<string>) {
    this.reader = new CsvRecords((cells) => this.record(cells));
  }

  feed(chunk: string): void {
    this.reader.push(chunk);
  }

  end(): InsideAirbnbSummary {
    this.reader.end();
    if (this.columns === null) throw new InsideAirbnbError("The calendar file is empty.");
    this.closeListing();
    const days = [...this.totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, t]): MarketDay => {
        const day: MarketDay = { date, occupancyPercent: Math.round((t.closed / t.listings) * 1000) / 10, comparables: t.listings };
        if (t.priceN > 0) day.averagePrice = Math.round((t.priceSum / t.priceN) * 100) / 100;
        return day;
      });
    return { days, listings: this.listings, alwaysClosed: this.alwaysClosed, badLines: this.badLines };
  }

  private record(cells: string[]): void {
    if (this.columns === null) {
      this.columns = columnsOf(cells, ["listing_id", "date", "available"], "calendar");
      return;
    }
    const get = (name: string) => cells[this.columns?.get(name) ?? -1] ?? "";
    const id = get("listing_id");
    if (this.only && !this.only.has(id)) return;
    const date = get("date");
    const available = get("available").toLowerCase();
    if (!isIsoDay(date) || (available !== "t" && available !== "f")) {
      this.badLines++;
      return;
    }
    if (id !== this.current) {
      this.closeListing();
      this.current = id;
    }
    const price = this.columns.has("price") ? parseAmount(get("price"), false) : null;
    this.nights.push({ date, closed: available === "f", price: price !== null && price > 0 ? price : null });
  }

  private closeListing(): void {
    const nights = this.nights;
    this.nights = [];
    if (nights.length === 0) return;
    if (nights.every((n) => n.closed)) {
      this.alwaysClosed++;
      return;
    }
    this.listings++;
    for (const n of nights) {
      let t = this.totals.get(n.date);
      if (!t) {
        t = { listings: 0, closed: 0, priceSum: 0, priceN: 0 };
        this.totals.set(n.date, t);
      }
      t.listings++;
      if (n.closed) t.closed++;
      if (n.price !== null) {
        t.priceSum += n.price;
        t.priceN++;
      }
    }
  }
}

/** The zone data as the engine wants it. */
export function insideAirbnbMarket(summary: InsideAirbnbSummary, area: string, readOn: string): MarketData {
  return { source: "insideairbnb", attribution: INSIDE_AIRBNB_ATTRIBUTION, area, readOn, estimated: true, days: summary.days };
}
