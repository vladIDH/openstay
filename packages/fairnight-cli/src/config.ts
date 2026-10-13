/**
 * The host's configuration file, fairnight.config.json: the list of listings,
 * each with a name, its price rules (the engine's listing schema) and the iCal
 * links of its calendars. Problems are reported like the engine does: every
 * problem at once, with the path of the field.
 */
import { existsSync, readFileSync } from "node:fs";
import { ConfigError, validateListingConfig } from "fairnight";
import type { ConfigIssue, ListingConfig, ValidationResult } from "fairnight";
import { CONFIG_FILE, configPath, stripBom } from "./io.js";

export const ICAL_SOURCES = ["airbnb", "booking", "vrbo", "other"] as const;
export const SOURCES = [...ICAL_SOURCES, "smoobu", "beds24"] as const;
export type IcalSource = (typeof ICAL_SOURCES)[number];
export type CalendarSource = (typeof SOURCES)[number];
export const TREAT_AS = ["auto", "reservation", "blocked"] as const;
export type TreatAs = (typeof TREAT_AS)[number];

/** A calendar read through its iCal export link. */
export interface IcalLink {
  source: IcalSource;
  url: string;
  /** How to read the events of this calendar. Default "auto": see ical.ts. */
  treatAs?: TreatAs;
}

/** A Smoobu apartment, read (and written) through the Smoobu API. */
export interface SmoobuLink {
  source: "smoobu";
  apartmentId: number;
}

/** A Beds24 room, read (and written) through the Beds24 API v2. */
export interface Beds24Link {
  source: "beds24";
  roomId: number;
  /** Which of the 16 Beds24 price fields Fairnight writes. Default price1. */
  priceField?: Beds24PriceField;
}

export const BEDS24_PRICE_FIELDS = Array.from({ length: 16 }, (_, i) => `price${i + 1}`);
export type Beds24PriceField = `price${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16}`;

export type CalendarLink = IcalLink | SmoobuLink | Beds24Link;

export const isSmoobu = (c: CalendarLink): c is SmoobuLink => c.source === "smoobu";
export const isBeds24 = (c: CalendarLink): c is Beds24Link => c.source === "beds24";
export const isIcal = (c: CalendarLink): c is IcalLink => !isSmoobu(c) && !isBeds24(c);

/** The Beds24 room of a listing and the price field to write, if it has one. */
export function beds24Room(listing: HostListing): { roomId: number; priceField: Beds24PriceField } | null {
  const link = listing.calendars.find(isBeds24);
  return link ? { roomId: link.roomId, priceField: link.priceField ?? "price1" } : null;
}

/** The Smoobu apartment of a listing, if it has one. */
export function smoobuApartment(listing: HostListing): number | null {
  const link = listing.calendars.find(isSmoobu);
  return link ? link.apartmentId : null;
}

export interface HostListing {
  /** Short name used on the command line: lowercase letters, digits and dashes. */
  name: string;
  calendars: CalendarLink[];
  pricing: ListingConfig;
  /** The zone whose data (imported with `fairnight mercato importa --zona`) the market factor uses. */
  marketArea?: string;
}

/** Where AirROI should look for one zone, and which listings count as comparable. */
export interface AirRoiArea {
  country: string;
  region: string;
  locality: string;
  district?: string;
  /** AirROI room type, e.g. "entire_home". */
  roomType?: string;
  bedrooms?: number;
}

export interface MarketSettings {
  airroi?: {
    /** Off until AirROI confirms its terms of use in writing. */
    enabled: boolean;
    /** Zone name → AirROI market. */
    areas?: Record<string, AirRoiArea>;
  };
}

export interface HostConfig {
  listings: HostListing[];
  market?: MarketSettings;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Zone names follow the listing names: lowercase letters, digits and dashes. */
export const isAreaName = (v: unknown): v is string => typeof v === "string" && NAME.test(v);

function checkMarket(v: unknown, issues: ConfigIssue[]): MarketSettings | null {
  const path = "config.market";
  if (!isObj(v)) {
    issues.push({ path, message: "must be an object" });
    return null;
  }
  unknownFields(v, path, ["airroi"], issues);
  if (v.airroi === undefined) return {};
  const ap = `${path}.airroi`;
  const a = v.airroi;
  if (!isObj(a)) {
    issues.push({ path: ap, message: "must be an object with enabled and areas" });
    return null;
  }
  unknownFields(a, ap, ["enabled", "areas"], issues);
  if (typeof a.enabled !== "boolean") issues.push({ path: `${ap}.enabled`, message: `must be true or false, got ${JSON.stringify(a.enabled)}` });
  const areas: Record<string, AirRoiArea> = {};
  if (a.areas !== undefined) {
    if (!isObj(a.areas)) issues.push({ path: `${ap}.areas`, message: "must be an object: zone name → country, region, locality" });
    else {
      for (const [name, area] of Object.entries(a.areas)) {
        const zp = `${ap}.areas.${name}`;
        if (!isAreaName(name)) issues.push({ path: zp, message: "zone names use lowercase letters, digits and dashes" });
        if (!isObj(area)) {
          issues.push({ path: zp, message: "must be an object with country, region and locality" });
          continue;
        }
        unknownFields(area, zp, ["country", "region", "locality", "district", "roomType", "bedrooms"], issues);
        for (const key of ["country", "region", "locality"] as const) {
          if (typeof area[key] !== "string" || (area[key] as string).trim() === "") issues.push({ path: `${zp}.${key}`, message: "must be a non-empty text, as AirROI names it" });
        }
        for (const key of ["district", "roomType"] as const) {
          if (area[key] !== undefined && (typeof area[key] !== "string" || (area[key] as string).trim() === "")) issues.push({ path: `${zp}.${key}`, message: "must be a non-empty text" });
        }
        if (area.bedrooms !== undefined && (typeof area.bedrooms !== "number" || !Number.isInteger(area.bedrooms) || area.bedrooms < 0)) {
          issues.push({ path: `${zp}.bedrooms`, message: `must be a whole number, got ${JSON.stringify(area.bedrooms)}` });
        }
        areas[name] = area as unknown as AirRoiArea;
      }
    }
  }
  return { airroi: { enabled: a.enabled === true, ...(a.areas !== undefined ? { areas } : {}) } };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function unknownFields(v: Obj, path: string, allowed: readonly string[], issues: ConfigIssue[]): void {
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) issues.push({ path: `${path}.${key}`, message: `unknown field (allowed: ${allowed.join(", ")})` });
  }
}

/** Accepts http(s) links, and webcal:// links which are read over https. */
export function normaliseCalendarUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol === "webcal:") url = new URL(`https:${url.href.slice("webcal:".length)}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.href;
}

function checkCalendars(v: unknown, path: string, issues: ConfigIssue[]): void {
  if (!Array.isArray(v)) {
    issues.push({ path, message: "must be a list of calendars (it can be empty)" });
    return;
  }
  const seen = new Set<string>();
  let channels = 0;
  v.forEach((c, j) => {
    const cp = `${path}[${j}]`;
    if (!isObj(c)) {
      issues.push({ path: cp, message: "must be an object with source and url" });
      return;
    }
    if (!SOURCES.includes(c.source as CalendarSource)) {
      issues.push({ path: `${cp}.source`, message: `must be one of ${SOURCES.join(", ")}, got ${JSON.stringify(c.source)}` });
    }
    if (c.source === "smoobu") {
      unknownFields(c, cp, ["source", "apartmentId"], issues);
      if (typeof c.apartmentId !== "number" || !Number.isInteger(c.apartmentId) || c.apartmentId <= 0) {
        issues.push({ path: `${cp}.apartmentId`, message: `must be the number of the Smoobu apartment, got ${JSON.stringify(c.apartmentId)}` });
      }
      if (++channels > 1) issues.push({ path: cp, message: "a listing can be linked to one channel manager only (one Smoobu apartment or one Beds24 room)" });
      return;
    }
    if (c.source === "beds24") {
      unknownFields(c, cp, ["source", "roomId", "priceField"], issues);
      if (typeof c.roomId !== "number" || !Number.isInteger(c.roomId) || c.roomId <= 0) {
        issues.push({ path: `${cp}.roomId`, message: `must be the number of the Beds24 room, got ${JSON.stringify(c.roomId)}` });
      }
      if (c.priceField !== undefined && !BEDS24_PRICE_FIELDS.includes(c.priceField as string)) {
        issues.push({ path: `${cp}.priceField`, message: `must be one of price1 … price16, got ${JSON.stringify(c.priceField)}` });
      }
      if (++channels > 1) issues.push({ path: cp, message: "a listing can be linked to one channel manager only (one Smoobu apartment or one Beds24 room)" });
      return;
    }
    unknownFields(c, cp, ["source", "url", "treatAs"], issues);
    if (typeof c.url !== "string" || normaliseCalendarUrl(c.url) === null) {
      issues.push({ path: `${cp}.url`, message: `must be an https:// or webcal:// link, got ${JSON.stringify(c.url)}` });
    } else {
      const url = normaliseCalendarUrl(c.url) as string;
      if (seen.has(url)) issues.push({ path: `${cp}.url`, message: "the same link is listed twice" });
      seen.add(url);
    }
    if (c.treatAs !== undefined && !TREAT_AS.includes(c.treatAs as TreatAs)) {
      issues.push({ path: `${cp}.treatAs`, message: `must be one of ${TREAT_AS.join(", ")}, got ${JSON.stringify(c.treatAs)}` });
    }
  });
}

export function validateHostConfig(input: unknown): ValidationResult<HostConfig> {
  const issues: ConfigIssue[] = [];
  if (!isObj(input)) {
    return { ok: false, issues: [{ path: "config", message: "must be an object with a listings list" }] };
  }
  unknownFields(input, "config", ["listings", "market"], issues);
  const market = input.market === undefined ? undefined : checkMarket(input.market, issues);
  if (!Array.isArray(input.listings) || input.listings.length === 0) {
    issues.push({ path: "config.listings", message: "must be a list with at least one listing" });
    return { ok: false, issues };
  }

  const listings: HostListing[] = [];
  const names = new Set<string>();
  input.listings.forEach((l, i) => {
    const lp = `listings[${i}]`;
    if (!isObj(l)) {
      issues.push({ path: lp, message: "must be an object with name, calendars and pricing" });
      return;
    }
    unknownFields(l, lp, ["name", "calendars", "pricing", "marketArea"], issues);
    if (l.marketArea !== undefined && !isAreaName(l.marketArea)) {
      issues.push({ path: `${lp}.marketArea`, message: `must be a zone name with lowercase letters, digits and dashes (like "adeje"), got ${JSON.stringify(l.marketArea)}` });
    }
    if (typeof l.name !== "string" || !NAME.test(l.name)) {
      issues.push({
        path: `${lp}.name`,
        message: `must be a short name with lowercase letters, digits and dashes (like "seaview-loft"), got ${JSON.stringify(l.name)}`,
      });
    } else if (names.has(l.name)) {
      issues.push({ path: `${lp}.name`, message: `"${l.name}" is used by another listing` });
    } else {
      names.add(l.name);
    }
    checkCalendars(l.calendars, `${lp}.calendars`, issues);

    // The engine checks the price rules; its paths start with "listing".
    const pricingInput = isObj(l.pricing) && l.pricing.listingId === undefined ? { ...l.pricing, listingId: l.name } : l.pricing;
    const r = validateListingConfig(pricingInput);
    if (!r.ok) {
      for (const issue of r.issues) issues.push({ path: issue.path.replace(/^listing/, `${lp}.pricing`), message: issue.message });
    } else if (issues.length === 0) {
      const calendars = (l.calendars as CalendarLink[]).map((c): CalendarLink => {
        if (isSmoobu(c)) return { source: "smoobu", apartmentId: c.apartmentId };
        if (isBeds24(c)) return c.priceField !== undefined ? { source: "beds24", roomId: c.roomId, priceField: c.priceField } : { source: "beds24", roomId: c.roomId };
        const link: IcalLink = { source: c.source, url: normaliseCalendarUrl(c.url) as string };
        if (c.treatAs !== undefined) link.treatAs = c.treatAs;
        return link;
      });
      const listing: HostListing = { name: l.name as string, calendars, pricing: r.value };
      if (typeof l.marketArea === "string") listing.marketArea = l.marketArea;
      listings.push(listing);
    }
  });

  const byApartment = new Map<number, string>();
  for (const l of listings) {
    const apt = smoobuApartment(l);
    if (apt === null) continue;
    const other = byApartment.get(apt);
    if (other) issues.push({ path: `listings (${l.name})`, message: `Smoobu apartment ${apt} is already linked to "${other}"` });
    byApartment.set(apt, l.name);
  }
  const byRoom = new Map<number, string>();
  for (const l of listings) {
    const room = beds24Room(l);
    if (room === null) continue;
    const other = byRoom.get(room.roomId);
    if (other) issues.push({ path: `listings (${l.name})`, message: `Beds24 room ${room.roomId} is already linked to "${other}"` });
    byRoom.set(room.roomId, l.name);
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: market ? { listings, market } : { listings } };
}

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

/** Read and validate fairnight.config.json from the working folder. */
export function loadHostConfig(dir: string): HostConfig {
  const file = configPath(dir);
  if (!existsSync(file)) {
    throw new SetupError(`No ${CONFIG_FILE} in ${dir}. Run "fairnight init" in this folder first.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(readFileSync(file, "utf8")));
  } catch (e) {
    throw new SetupError(`${CONFIG_FILE} is not valid JSON: ${(e as Error).message}`);
  }
  const r = validateHostConfig(parsed);
  if (!r.ok) throw new ConfigError(CONFIG_FILE, r.issues);
  return r.value;
}

/** The listings a command should work on: one by name, or all of them. */
export function selectListings(config: HostConfig, name: string | undefined): HostListing[] {
  if (name === undefined) return config.listings;
  const found = config.listings.find((l) => l.name === name);
  if (!found) {
    throw new SetupError(`No listing called "${name}". Listings in the config: ${config.listings.map((l) => l.name).join(", ")}.`);
  }
  return [found];
}

/**
 * Stable key of each calendar of a listing: its source, plus -2, -3… when a
 * listing has more than one calendar from the same source. The key does not
 * depend on the link, so a regenerated link keeps the history of the calendar.
 */
export function feedKeys(listing: HostListing): string[] {
  const count = new Map<string, number>();
  return listing.calendars.map((c) => {
    const n = (count.get(c.source) ?? 0) + 1;
    count.set(c.source, n);
    return n === 1 ? c.source : `${c.source}-${n}`;
  });
}
