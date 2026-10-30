/**
 * What the MCP tools read from a Fairnight folder. Read only: the database is
 * opened in SQLite read-only mode and the calendars are never downloaded here
 * (that is `fairnight sync`'s job).
 */
import { existsSync } from "node:fs";
import { Availability, formatAmount, type NightQuote } from "fairnight";
import {
  conversation,
  dbPath,
  feedKeys,
  flagsOf,
  guestDeadlines,
  guestsEnabled,
  helloTablesExist,
  lastSync,
  listMarketAreas,
  loadMarket,
  loadHostConfig,
  loadStays,
  localToday,
  nightMarks,
  openDbReadOnly,
  openDrafts,
  priceOne,
  selectListings,
  SetupError,
  textToSend,
  unitsOf,
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
      ...(unitsOf(l) > 1 ? { units: unitsOf(l) } : {}),
      defaultMinStay: l.pricing.defaultMinStay,
      calendars: l.calendars.map((c) => c.source), // never the links: they work like passwords
      lastSync: lastSync(db, l.name),
    })),
  }));
}

/** A night; for a room type with several units also how many are free ("3 of 6"). */
function nightSummary(n: NightQuote) {
  const night = { date: n.date, weekday: n.weekday, status: n.status, price: n.price, minStay: n.minStay };
  return n.units ? { ...night, units: n.units.total, unitsFree: n.units.free } : night;
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
        ...nightMarks(db, listing, today, [n]).get(date),
      };
    },
    args.listing,
  );
}

/** The engine's own count of the nights (and of the units of a room type): one rule for prices and for these tools. */
function availabilityOf(db: Db, listing: HostListing): Availability {
  return new Availability({ stays: loadStays(db, listing) }, unitsOf(listing));
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
      const availability = availabilityOf(db, listing);
      // Nights: reserved or blocked when no unit is left. Room-nights: every unit of every night.
      let reserved = 0;
      let blocked = 0;
      const rooms = { total: 0, reserved: 0, blocked: 0, free: 0 };
      for (let d = first; d <= last; d++) {
        const s = availability.status(d);
        if (s === "reserved") reserved++;
        else if (s === "blocked") blocked++;
        const n = availability.night(d);
        rooms.total += n.total;
        rooms.reserved += n.reserved;
        rooms.blocked += n.blocked;
        rooms.free += n.free;
      }
      const nights = last - first + 1;
      const sellable = rooms.total - rooms.blocked;
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
        occupancyPercent: sellable === 0 ? null : Math.round((rooms.reserved / sellable) * 1000) / 10,
        stillForSale: forSale,
        averagePriceForSale: average,
        currency: listing.pricing.currency,
        ...(availability.units > 1 ? { units: availability.units, roomNights: rooms } : {}),
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
      const availability = availabilityOf(db, listing);
      // A gap is a short stretch with something free between two nights where nothing is (sold out, for a room type).
      const status = (day: number) => availability.status(day);
      const start = toDay(today);
      const end = start + days - 1;
      const priced = new Map(priceOne(db, listing, today, days + maxNights).nights.map((n) => [n.date, n]));
      const gaps: { from: string; to: string; nights: number; prices: (number | null)[]; minStay: number | null; unitsFree?: number[] }[] = [];
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
            ...(availability.units > 1 ? { unitsFree: Array.from({ length }, (_, i) => availability.night(d + i).free) } : {}),
          });
        }
        d = e + 1;
      }
      return {
        listing: listing.name,
        currency: listing.pricing.currency,
        from: today,
        to: fromDay(end),
        maxNights,
        ...(availability.units > 1 ? { units: availability.units } : {}),
        gaps,
      };
    },
    args.listing,
  );
}

export { formatAmount };

interface RunRow {
  at: string;
  ok: number;
  error: string | null;
}

/** Where the data of each listing comes from (iCal calendars, Smoobu) and when it was last read. */
export function syncStatus(folder: Folder) {
  return withFolder(folder, (db, listings) => ({
    listings: listings.map((l) => {
      const keys = feedKeys(l);
      const sources = l.calendars.map((c, i) => {
        const feed = keys[i] as string;
        const last = db.prepare("SELECT at, ok, error FROM sync_runs WHERE listing = ? AND feed = ? ORDER BY at DESC, id DESC LIMIT 1").get(l.name, feed) as
          | RunRow
          | undefined;
        const ok = db.prepare("SELECT MAX(at) AS at FROM sync_runs WHERE listing = ? AND feed = ? AND ok = 1").get(l.name, feed) as { at: string | null };
        return {
          feed,
          kind: c.source === "smoobu" ? ("smoobu" as const) : c.source === "beds24" ? ("beds24" as const) : ("ical" as const),
          channel: c.source,
          // Never the iCal links: they work like passwords.
          ...(c.source === "smoobu" ? { apartmentId: c.apartmentId } : {}),
          ...(c.source === "beds24" ? { roomId: c.roomId } : {}),
          lastSuccess: ok.at,
          lastAttempt: last?.at ?? null,
          lastError: last && last.ok === 0 ? last.error : null,
        };
      });
      const kinds = [...new Set(sources.map((s) => s.kind))].sort();
      return { listing: l.name, dataFrom: kinds.length === 0 ? "none" : kinds.join("+"), sources };
    }),
  }));
}

/**
 * The zone data a listing's prices use: source and attribution, how old it is,
 * the zone's average, and the zone's figures night by night in a range. Read
 * only; expired data is never shown.
 */
export function marketArea(folder: Folder, args: { listing: string; from?: string; to?: string }) {
  const today = localToday(folder.now());
  const from = args.from === undefined ? today : checkDate(args.from, "from");
  const to = args.to === undefined ? fromDay(toDay(from) + 13) : checkDate(args.to, "to");
  if (to < from) throw new ToolError(`"to" (${to}) is before "from" (${from}).`);
  if (toDay(to) - toDay(from) + 1 > MAX_RANGE) throw new ToolError(`Ask for at most ${MAX_RANGE} days.`);
  return withFolder(
    folder,
    (db, listings) => {
      const listing = only(listings);
      const factor = listing.pricing.factors.market ?? null;
      const base = { listing: listing.name, zone: listing.marketArea ?? null, factor, from, to };
      if (listing.marketArea === undefined) return { ...base, data: null, nights: [] };
      const market = loadMarket(db, listing.marketArea, today);
      const summary = listMarketAreas(db, today).find((a) => a.area === listing.marketArea) ?? null;
      if (market === null || summary === null) return { ...base, data: null, nights: [] };
      return {
        ...base,
        data: {
          source: summary.source,
          attribution: summary.attribution,
          estimated: summary.estimated,
          readOn: summary.readOn,
          keptUntil: summary.expiresOn,
          nights: summary.days,
          first: summary.first,
          last: summary.last,
          averageOccupancyPercent: summary.averageOccupancy,
          averagePrice: summary.averagePrice,
          note: summary.note,
        },
        nights: market.days.filter((d) => d.date >= from && d.date <= to),
      };
    },
    args.listing,
  );
}

/**
 * Guest registration (Fairguest): the communications each stay needs, with
 * their 24-hour deadline and whether they are done. Only dates and states: the
 * guests' data is encrypted and this tool never asks for the passphrase.
 */
export type GuestDeadlines = {
  now: string;
  enabled: boolean;
  late: number;
  deadlines: {
    stay: string;
    listing: string;
    authority: string;
    communication: "reservation" | "checkin" | "cancellation";
    due: string;
    state: "done" | "late" | "open";
    doneAt: string | null;
    checkIn: string;
    checkOut: string;
    guestsRegistered: number;
    hoursLeft: number;
  }[];
};

export function guestDeadlinesOf(folder: Folder, args: { includeDone?: boolean }): GuestDeadlines {
  return withFolder(folder, (db) => {
    const now = folder.now();
    const p = (n: number) => String(n).padStart(2, "0");
    const at = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
    const enabled = guestsEnabled(db);
    const rows = enabled ? guestDeadlines(db, loadHostConfig(folder.dir), now) : [];
    return {
      now: at,
      enabled,
      late: rows.filter((r) => r.state === "late").length,
      deadlines: (args.includeDone ? rows : rows.filter((r) => r.state !== "done")).map((r) => ({
        stay: r.stay,
        listing: r.listing,
        authority: r.country === "ES-CT" ? "Mossos d'Esquadra" : "SES.HOSPEDAJES",
        communication: r.kind,
        due: r.due.replace("T", " "),
        state: r.state,
        doneAt: r.doneAt?.replace("T", " ") ?? null,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        guestsRegistered: r.guestsRegistered,
        hoursLeft: r.hoursLeft,
      })),
    };
  });
}

export type GuestReplies = {
  today: string;
  /** False on a folder whose database has no guest assistant tables yet. */
  enabled: boolean;
  waiting: number;
  outdated: number;
  drafts: {
    draft: number;
    listing: string;
    checkIn: string;
    checkOut: string;
    channel: string | null;
    language: string | null;
    needsHost: boolean;
    flags: string[];
    sendable: boolean;
    reason: string | null;
    guestMessage?: string;
    draftText?: string;
  }[];
};

/**
 * The replies to guests waiting for the host (Fairhello). Read only: nothing
 * is approved or sent from here. Message texts only when asked for.
 */
export function guestRepliesOf(folder: Folder, args: { includeText?: boolean }): GuestReplies {
  return withFolder(folder, (db) => {
    const today = localToday(folder.now());
    if (!helloTablesExist(db)) return { today, enabled: false, waiting: 0, outdated: 0, drafts: [] };
    const views = openDrafts(db, today);
    return {
      today,
      enabled: true,
      waiting: views.filter((v) => v.freshness.sendable).length,
      outdated: views.filter((v) => !v.freshness.sendable).length,
      drafts: views.map((v) => {
        const lastGuest = args.includeText ? [...conversation(db, v.stay.id)].reverse().find((m) => m.sender === "guest") : undefined;
        return {
          draft: v.draft.id,
          listing: v.stay.listing,
          checkIn: v.stay.check_in,
          checkOut: v.stay.check_out,
          channel: v.stay.channel,
          language: v.draft.language ?? v.stay.language,
          needsHost: v.draft.needs_host === 1,
          flags: flagsOf(v.draft),
          sendable: v.freshness.sendable,
          reason: v.freshness.reason,
          ...(args.includeText ? { guestMessage: lastGuest?.text ?? "", draftText: textToSend(v.draft) } : {}),
        };
      }),
    };
  });
}
