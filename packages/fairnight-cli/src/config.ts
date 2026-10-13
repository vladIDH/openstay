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
export const SOURCES = [...ICAL_SOURCES, "smoobu"] as const;
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

export type CalendarLink = IcalLink | SmoobuLink;

export const isSmoobu = (c: CalendarLink): c is SmoobuLink => c.source === "smoobu";

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
}

export interface HostConfig {
  listings: HostListing[];
}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

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
  let smoobu = 0;
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
      if (++smoobu > 1) issues.push({ path: cp, message: "a listing can be linked to one Smoobu apartment only" });
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
  unknownFields(input, "config", ["listings"], issues);
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
    unknownFields(l, lp, ["name", "calendars", "pricing"], issues);
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
        const link: IcalLink = { source: c.source, url: normaliseCalendarUrl(c.url) as string };
        if (c.treatAs !== undefined) link.treatAs = c.treatAs;
        return link;
      });
      listings.push({ name: l.name as string, calendars, pricing: r.value });
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
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { listings } };
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
