/**
 * What the MCP tools read from a Fairnight folder. Read only: the database is
 * opened in SQLite read-only mode and the calendars are never downloaded here
 * (that is `fairnight sync`'s job).
 */
import { existsSync } from "node:fs";
import { formatAmount, type NightQuote } from "fairnight";
import {
  dbPath,
  lastSync,
  loadHostConfig,
  loadStays,
  localToday,
  openDbReadOnly,
  priceOne,
  selectListings,
  SetupError,
  type Db,
  type HostListing,
} from "fairnight-cli";

/** An error the model should read and can act on (bad date, unknown listing…). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface Folder {
  dir: string;
  now: () => Date;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE = 366;
const DAY_MS = 86_400_000;

const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const fromDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

function checkDate(value: unknown, name: string): string {
  if (typeof value !== "string" || !ISO.test(value) || fromDay(toDay(value)) !== value) {
    throw new ToolError(`${name} must be a date like 2026-11-03, got ${JSON.stringify(value)}`);
  }
  return value;
}

function withFolder<T>(folder: Folder, fn: (db: Db, listings: HostListing[]) => T, listing?: string): T {
  let listings: HostListing[];
  try {
    listings = selectListings(loadHostConfig(folder.dir), listing);
  } catch (e) {
    if (e instanceof SetupError) throw new ToolError(e.message);
    throw e;
  }
  const file = dbPath(folder.dir);
  if (!existsSync(file)) throw new ToolError(`No database in ${folder.dir}: run "fairnight init" and "fairnight sync" there first.`);
  const db = openDbReadOnly(file);
  try {
    return fn(db, listings);
  } finally {
    db.close();
  }
}

function only<T>(items: T[]): T {
  return items[0] as T;
}

export function listListings(folder: Folder) {
  return withFolder(folder, (db, listings) => ({
    today: localToday(folder.now()),
    listings: listings.map((l) => ({
      name: l.name,
      title: l.pricing.name ?? l.name,
      currency: l.pricing.currency,
      basePrice: l.pricing.basePrice,
      defaultMinStay: l.pricing.defaultMinStay,
      calendars: l.calendars.map((c) => c.source), // never the links: they work like passwords
      lastSync: lastSync(db, l.name),
    })),
  }));
}

function nightSummary(n: NightQuote) {
  return { date: n.date, weekday: n.weekday, status: n.status, price: n.price, minStay: n.minStay };
}

/** Price the nights from today up to `to` and keep [from, to]. */
function pricedRange(db: Db, listing: HostListing, today: string, from: string, to: string) {
  const days = toDay(to) - toDay(today) + 1;
  return priceOne(db, listing, today, days).nights.filter((n) => n.date >= from && n.date <= to);
}

export function getPrices(folder: Folder, args: { listing: string; from?: string; to?: string }) {
  const today = localToday(folder.now());
  const from = args.from === undefined ? today : checkDate(args.from, "from");
  const to = args.to === undefined ? fromDay(toDay(from) + 13) : checkDate(args.to, "to");
  if (from < today) throw new ToolError(`Past nights have no price: start from today (${today}) or later.`);
  if (to < from) throw new ToolError(`"to" (${to}) is before "from" (${from}).`);
  if (toDay(to) - toDay(today) + 1 > MAX_RANGE) throw new ToolError(`Ask for at most ${MAX_RANGE} days from today.`);
  return withFolder(
    folder,
    (db, listings) => {
      const listing = only(listings);
      const nights = pricedRange(db, listing, today, from, to);
      return { listing: listing.name, currency: listing.pricing.currency, from, to, nights: nights.map(nightSummary) };
    },
    args.listing,
  );
}

export function explainNight(folder: Folder, args: { listing: string; date: string }) {
  const today = localToday(folder.now());
  const date = checkDate(args.date, "date");
  if (date < today) throw new ToolError(`${date} is in the past: only nights from today (${today}) have a price.`);
  if (toDay(date) - toDay(today) + 1 > MAX_RANGE) throw new ToolError(`Ask about a night at most ${MAX_RANGE} days from today.`);
  return withFolder(
    folder,
    (db, listings) => {
      const listing = only(listings);
      const n = pricedRange(db, listing, today, date, date)[0] as NightQuote;
      return {
        listing: listing.name,
        currency: listing.pricing.currency,
        ...nightSummary(n),
        minStaySource: n.minStaySource,
        steps: n.steps,
        explanation: n.explanation,
      };
    },
    args.listing,
  );
}

type Status = "available" | "reserved" | "blocked";

function statusMap(db: Db, listing: HostListing): (day: number) => Status {
  const nights = new Map<number, Status>();
  for (const s of loadStays(db, listing)) {
    for (let d = toDay(s.checkIn); d < toDay(s.checkOut); d++) {
      if (s.kind === "reservation" || !nights.has(d)) nights.set(d, s.kind === "blocked" ? "blocked" : "reserved");
    }
  }
  return (day) => nights.get(day) ?? "available";
}

export function occupancy(folder: Folder, args: { listing: string; month: string }) {
  if (typeof args.month !== "string" || !/^\d{4}-\d{2}$/.test(args.month) || Number(args.month.slice(5)) < 1 || Number(args.month.slice(5)) > 12) {
    throw new ToolError(`month must look like 2026-11, got ${JSON.stringify(args.month)}`);
  }
  const today = localToday(folder.now());
  const first = toDay(`${args.month}-01`);
  const [y, m] = args.month.split("-").map(Number) as [number, number];
  const last = Date.UTC(y, m, 0) / DAY_MS;
  return withFolder(
    folder,
    (db, listings) => {
      const listing = only(listings);
      const status = statusMap(db, listing);
      let reserved = 0;
      let blocked = 0;
      for (let d = first; d <= last; d++) {
        const s = status(d);
        if (s === "reserved") reserved++;
        else if (s === "blocked") blocked++;
      }
      const nights = last - first + 1;
      const sellable = nights - blocked;
      // Average price of the nights still for sale, from today on.
      const start = Math.max(first, toDay(today));
      let average: number | null = null;
      let forSale = 0;
      if (start <= last && last - toDay(today) + 1 <= MAX_RANGE) {
        const priced = pricedRange(db, listing, today, fromDay(start), fromDay(last)).filter((n) => n.price !== null);
        forSale = priced.length;
        if (forSale > 0) average = Math.round((priced.reduce((a, n) => a + (n.price as number), 0) / forSale) * 100) / 100;
      }
      return {
        listing: listing.name,
        month: args.month,
        nights,
        reserved,
        blocked,
        free: nights - reserved - blocked,
        occupancyPercent: sellable === 0 ? null : Math.round((reserved / sellable) * 1000) / 10,
        stillForSale: forSale,
        averagePriceForSale: average,
        currency: listing.pricing.currency,
      };
    },
    args.listing,
  );
}

export function nextGaps(folder: Folder, args: { listing: string; days?: number; maxNights?: number }) {
  const days = args.days ?? 90;
  const maxNights = args.maxNights ?? 3;
  if (!Number.isInteger(days) || days < 1 || days > MAX_RANGE) throw new ToolError(`days must be a whole number from 1 to ${MAX_RANGE}`);
  if (!Number.isInteger(maxNights) || maxNights < 1 || maxNights > 14) throw new ToolError("maxNights must be a whole number from 1 to 14");
  const today = localToday(folder.now());
  return withFolder(
    folder,
    (db, listings) => {
      const listing = only(listings);
      const status = statusMap(db, listing);
      const start = toDay(today);
      const end = start + days - 1;
      const priced = new Map(priceOne(db, listing, today, days + maxNights).nights.map((n) => [n.date, n]));
      const gaps: { from: string; to: string; nights: number; prices: (number | null)[]; minStay: number | null }[] = [];
      let d = start;
      while (d <= end) {
        if (status(d) !== "available") {
          d++;
          continue;
        }
        let e = d;
        while (status(e + 1) === "available" && e - d + 1 <= maxNights) e++;
        const length = e - d + 1;
        const closed = status(d - 1) !== "available" && status(e + 1) !== "available";
        if (closed && length <= maxNights) {
          const nights = Array.from({ length }, (_, i) => priced.get(fromDay(d + i)));
          gaps.push({
            from: fromDay(d),
            to: fromDay(e),
            nights: length,
            prices: nights.map((n) => n?.price ?? null),
            minStay: nights[0]?.minStay ?? null,
          });
        }
        d = e + 1;
      }
      return { listing: listing.name, currency: listing.pricing.currency, from: today, to: fromDay(end), maxNights, gaps };
    },
    args.listing,
  );
}

export { formatAmount };
