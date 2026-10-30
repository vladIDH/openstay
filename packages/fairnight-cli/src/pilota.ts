/**
 * The autopilot: one run reads the calendars and bookings again, prices every
 * night, and for each listing the host turned it on for, writes the new prices
 * to Smoobu or Beds24 and reads them back. Used by `fairnight pilota`, by the
 * daily task of the computer and by the calendar page.
 *
 * Safety, in this order, for every night:
 * - nothing is written for a listing whose calendars could not be read today
 *   (old bookings could sell a night too cheap);
 * - a price moves at most maxDailyChangePercent (15) a day from the price on
 *   the channel now: further away, it gets there over the next days;
 * - a night the host confirmed skips that daily limit (pilota-conferme.ts): never
 *   by itself, and only until its date has passed;
 * - nothing below the listing's lowest price or above its highest, which the
 *   autopilot needs to be on; a price held back by the daily cap, or confirmed
 *   by the host, still stays inside them;
 * - after 3 failed runs in a row, or more than 5 nights that do not match when
 *   read back, the listing pauses until the host resumes it.
 * Every night written is kept in pilot_changes with the reason, and the nights
 * the cap held back in pilot_held, for the calendar.
 */
import type { NightQuote, PriceStep } from "fairnight";
import type { DiffLike, PushTarget, TargetPlan } from "./channel.js";
import { addDays } from "./channel.js";
import { isBeds24, isSmoobu, loadHostConfig, SetupError, type HostConfig, type HostListing } from "./config.js";
import { beds24Client, beds24Target } from "./beds24.js";
import { getMeta, openDb, setMeta, type Db } from "./db.js";
import { dbPath, localToday, type Io } from "./io.js";
import { activeConfirmations, saveHeld, type Confirmation, type HeldNight } from "./pilota-conferme.js";
import { priceOne } from "./price.js";
import { smoobuClient, smoobuTarget } from "./smoobu.js";
import { syncEverything } from "./sync-all.js";
import type { FeedReport } from "./sync.js";

export const DEFAULT_MAX_CHANGE = 15;
export const DEFAULT_PILOT_DAYS = 90;
export const DEFAULT_PILOT_TIME = "06:00";
/** Failed runs in a row before a listing pauses. */
export const MAX_FAILURES = 3;
/** Nights that do not match when read back, in one run, that pause a listing at once. */
export const MAX_WRONG = 5;
/** After this long without a run the page says the computer was probably off. */
export const STALE_HOURS = 36;
const LOCK_MINUTES = 30;
const KEEP_DAYS = 400;

const LAST_DAY_KEY = "pilot_last_day";
const LAST_RUN_KEY = "pilot_last_run_at";
const LOCK_KEY = "pilot_lock_until";

export type Trigger = "scheduled" | "page" | "manual";
export type Limited = "cap" | "floor" | "ceiling";

export const maxChangeOf = (l: HostListing) => l.pilot?.maxDailyChangePercent ?? DEFAULT_MAX_CHANGE;
export const pilotDaysOf = (l: HostListing) => l.pilot?.days ?? DEFAULT_PILOT_DAYS;
export const pilotOn = (l: HostListing) => l.pilot?.enabled === true;

/** The listing's lowest and highest price, when it has them: the autopilot does not run without. */
export function limitsOf(l: HostListing): { floor: number; ceiling: number } | null {
  const lim = l.pricing.factors.limits;
  return lim?.enabled ? { floor: lim.floorPrice, ceiling: lim.ceilingPrice } : null;
}

/** The channel manager a listing writes to, by feed name; null when it has none. */
export function channelOf(l: HostListing): { feed: "smoobu" | "beds24"; label: string } | null {
  if (l.calendars.some(isSmoobu)) return { feed: "smoobu", label: "Smoobu" };
  if (l.calendars.some(isBeds24)) return { feed: "beds24", label: "Beds24" };
  return null;
}

// ---------------------------------------------------------------- the safety rules

export type Guarded = { price: number; limited: Limited | null } | { skip: string };

/**
 * The price the autopilot may write for one night today: the engine's price,
 * held to maxChange percent from the price on the channel, then kept between
 * the lowest and highest price. A last check skips anything still outside.
 */
export function guardPrice(target: number, current: number | null, limits: { floor: number; ceiling: number }, maxChange: number): Guarded {
  if (!Number.isFinite(target) || target <= 0) return { skip: `the engine gave no usable price (${target})` };
  let price = target;
  let limited: Limited | null = null;
  if (current !== null && current > 0) {
    // In cents first: 100 × 1.15 is 114.999… in floating point.
    const up = Math.round(current * (100 + maxChange)) / 100;
    const down = Math.round(current * (100 - maxChange)) / 100;
    // Whole amounts, rounded towards the price on the channel so the cap is never passed.
    if (price > up) {
      price = Math.max(Math.floor(up), Math.min(current, target));
      limited = "cap";
    } else if (price < down) {
      price = Math.min(Math.ceil(down), Math.max(current, target));
      limited = "cap";
    }
  }
  if (price < limits.floor) {
    price = limits.floor;
    limited = "floor";
  } else if (price > limits.ceiling) {
    price = limits.ceiling;
    limited = "ceiling";
  }
  if (!(price >= limits.floor && price <= limits.ceiling)) return { skip: `${price} is outside ${limits.floor}–${limits.ceiling}` };
  return { price, limited };
}

export interface PilotNight {
  date: string;
  oldPrice: number | null;
  newPrice: number;
  /** The engine's price, before the daily cap. */
  target: number;
  oldMinStay: number | null;
  newMinStay: number;
  limited: Limited | null;
  /** The engine's steps: why the price is what it is. */
  steps: PriceStep[];
  /** Read back after writing: true matches, false does not, null not written (preview). */
  verified: boolean | null;
  /** Set when the host's confirmation let this night past the daily cap. */
  confirmation?: { by: string; at: string };
}

/** Apply the safety rules to a plan: the rows to write, the nights for the log and the nights the cap held back. */
export function guardPlan<Row extends DiffLike>(
  changes: readonly Row[],
  quotes: readonly NightQuote[],
  limits: { floor: number; ceiling: number },
  maxChange: number,
  confirmed: ReadonlyMap<string, Confirmation> = new Map(),
): { rows: Row[]; nights: PilotNight[]; held: HeldNight[]; skipped: { date: string; why: string }[] } {
  const byDate = new Map(quotes.map((q) => [q.date, q]));
  const rows: Row[] = [];
  const nights: PilotNight[] = [];
  const held: HeldNight[] = [];
  const skipped: { date: string; why: string }[] = [];
  for (const r of changes) {
    const capped = guardPrice(r.newPrice, r.currentPrice, limits, maxChange);
    if ("skip" in capped) {
      skipped.push({ date: r.date, why: capped.skip });
      continue;
    }
    // The same rules with no price on the channel: everything but the daily cap.
    const uncapped = guardPrice(r.newPrice, null, limits, maxChange);
    const free = "skip" in uncapped ? capped : uncapped;
    const heldBack = capped.price !== free.price;
    const confirmation = heldBack ? confirmed.get(r.date) : undefined;
    const g = confirmation ? free : capped;
    if (heldBack && !confirmation) held.push({ date: r.date, calculated: r.newPrice, sent: g.price, maxChange });
    if (g.price === r.currentPrice && r.newMinStay === r.currentMinStay) continue; // held back to where it already is
    rows.push({ ...r, newPrice: g.price });
    nights.push({
      date: r.date,
      oldPrice: r.currentPrice,
      newPrice: g.price,
      target: r.newPrice,
      oldMinStay: r.currentMinStay,
      newMinStay: r.newMinStay,
      limited: g.limited,
      steps: byDate.get(r.date)?.steps ?? [],
      verified: null,
      ...(confirmation ? { confirmation: { by: confirmation.by, at: confirmation.at } } : {}),
    });
  }
  return { rows, nights, held, skipped };
}

// ---------------------------------------------------------------- one run

export type ListingStatus =
  | "written" // wrote and read back
  | "nothing" // the channel already had the right prices
  | "preview" // a dry run: what it would write
  | "off" // the host has not turned it on
  | "paused" // too many failures: waits for "riprendi"
  | "not-read" // a calendar could not be read today: nothing written
  | "no-limits" // no lowest and highest price
  | "no-channel" // not linked to Smoobu or Beds24
  | "error"; // the channel could not be read or written

export interface PilotListingResult {
  listing: string;
  title: string;
  feed: string | null;
  status: ListingStatus;
  nights: PilotNight[];
  /** Nights the channel and Fairnight do not agree are free: left alone. */
  leftAlone: number;
  skipped: { date: string; why: string }[];
  refused: { date: string; why: string }[];
  wrong: string[];
  error?: string;
  /** Set when this run paused the listing. */
  pausedNow?: string;
}

export interface PilotRunResult {
  /** Why nothing ran: already done today, or another run is going. */
  skipped?: "done-today" | "busy";
  runId: number | null;
  startedAt: string;
  trigger: Trigger;
  dryRun: boolean;
  listings: PilotListingResult[];
  /** Calendars that could not be read. */
  notRead: FeedReport[];
}

export interface PilotOptions {
  trigger: Trigger;
  /** Show what would be written, write nothing, keep nothing. */
  dryRun: boolean;
  /** Only these listings (by name). */
  only?: string[];
  /** Also listings that are off: the preview before turning one on. */
  includeOff?: boolean;
  /** Do nothing if today's run is already done (the computer's daily task and the page). */
  onlyIfDue?: boolean;
}

interface StateRow {
  failures: number;
  paused_at: string | null;
  paused_reason: string | null;
}

export function pilotState(db: Db, listing: string): StateRow {
  return (db.prepare("SELECT failures, paused_at, paused_reason FROM pilot_state WHERE listing = ?").get(listing) as StateRow | undefined) ?? {
    failures: 0,
    paused_at: null,
    paused_reason: null,
  };
}

function saveState(db: Db, listing: string, s: StateRow): void {
  db.prepare(
    `INSERT INTO pilot_state (listing, failures, paused_at, paused_reason) VALUES (?, ?, ?, ?)
     ON CONFLICT (listing) DO UPDATE SET failures = excluded.failures, paused_at = excluded.paused_at, paused_reason = excluded.paused_reason`,
  ).run(listing, s.failures, s.paused_at, s.paused_reason);
}

/** "riprendi": clear the failures and the pause of a listing. */
export function resumeListing(db: Db, listing: string): boolean {
  const was = pilotState(db, listing).paused_at !== null;
  saveState(db, listing, { failures: 0, paused_at: null, paused_reason: null });
  return was;
}

/** Take the run lock; false when another run holds it (it expires on its own after a crash). */
function takeLock(db: Db, now: Date): boolean {
  return db
    .transaction(() => {
      const until = getMeta(db, LOCK_KEY);
      if (until !== null && Date.parse(until) > now.getTime()) return false;
      setMeta(db, LOCK_KEY, new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString());
      return true;
    })
    .immediate();
}

const dropLock = (db: Db) => db.prepare("DELETE FROM meta WHERE key = ?").run(LOCK_KEY);

/** The day of the last real run, and when it ended. */
export function lastRun(db: Db): { day: string | null; at: string | null } {
  return { day: getMeta(db, LAST_DAY_KEY), at: getMeta(db, LAST_RUN_KEY) };
}

function targetFor(db: Db, dir: string, io: Io, listing: HostListing): PushTarget {
  const now = () => io.now();
  // Smoobu's rows also carry their apartments: the safety rules copy rows whole, so they keep them.
  return listing.calendars.some(isSmoobu)
    ? (smoobuTarget(db, listing, smoobuClient(dir, io), now) as unknown as PushTarget)
    : beds24Target(db, listing, beds24Client(dir, io), now);
}

const blank = (l: HostListing, status: ListingStatus, extra: Partial<PilotListingResult> = {}): PilotListingResult => ({
  listing: l.name,
  title: l.pricing.name ?? l.name,
  feed: channelOf(l)?.feed ?? null,
  status,
  nights: [],
  leftAlone: 0,
  skipped: [],
  refused: [],
  wrong: [],
  ...extra,
});

async function runListing(db: Db, dir: string, io: Io, listing: HostListing, reports: FeedReport[], opts: PilotOptions, at: string): Promise<PilotListingResult> {
  if (channelOf(listing) === null) return blank(listing, "no-channel");
  if (!pilotOn(listing) && !opts.includeOff) return blank(listing, "off");
  const state = pilotState(db, listing.name);
  if (state.paused_at !== null && !opts.dryRun) return blank(listing, "paused", { error: state.paused_reason ?? undefined });
  const limits = limitsOf(listing);
  if (limits === null) return blank(listing, "no-limits");
  const failed = reports.filter((r) => r.listing === listing.name && !r.ok);
  if (failed.length > 0) return blank(listing, "not-read", { error: failed.map((r) => `${r.feed}: ${r.error ?? "not read"}`).join("; ") });

  const today = localToday(io.now());
  const days = pilotDaysOf(listing);
  const to = addDays(today, days - 1);
  const quotes = priceOne(db, listing, today, days).nights;
  let target: PushTarget;
  let plan: TargetPlan;
  try {
    target = targetFor(db, dir, io, listing); // throws SetupError without credentials
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
    return failure(db, listing, state, blank(listing, "error", { error: e.message }), opts, at);
  }
  try {
    plan = await target.plan(quotes, today, to);
  } catch (e) {
    if (!target.isChannelError(e)) throw e;
    return failure(db, listing, state, blank(listing, "error", { error: (e as Error).message }), opts, at);
  }
  const guarded = guardPlan(plan.changes, quotes, limits, maxChangeOf(listing), activeConfirmations(db, listing.name, today));
  const base = { nights: guarded.nights, skipped: guarded.skipped, leftAlone: plan.leftAlone.length };
  if (opts.dryRun) return blank(listing, "preview", base);
  if (guarded.rows.length === 0) {
    saveHeld(db, listing.name, guarded.held, at);
    if (state.failures > 0) saveState(db, listing.name, { ...state, failures: 0 });
    return blank(listing, "nothing", base);
  }

  const written = await target.write(guarded.rows, today, to);
  const wrong = new Set(written.wrong);
  const refused = new Set(written.refused.map((r) => r.date));
  const nights = guarded.nights.map((n) => ({ ...n, verified: written.error !== undefined ? false : !wrong.has(n.date) && !refused.has(n.date) }));
  const result = blank(listing, written.error !== undefined ? "error" : "written", {
    ...base,
    nights,
    refused: written.refused,
    wrong: written.wrong,
    ...(written.error !== undefined ? { error: written.error } : {}),
  });
  if (written.error !== undefined || written.wrong.length > 0 || written.refused.length > 0) return failure(db, listing, state, result, opts, at);
  saveHeld(db, listing.name, guarded.held, at);
  saveState(db, listing.name, { failures: 0, paused_at: null, paused_reason: null });
  return result;
}

/** Count a failed run; pause the listing after MAX_FAILURES in a row, or at once when many nights do not match. */
function failure(db: Db, listing: HostListing, state: StateRow, result: PilotListingResult, opts: PilotOptions, at: string): PilotListingResult {
  if (opts.dryRun) return result;
  const failures = state.failures + 1;
  let reason: string | null = null;
  if (result.wrong.length > MAX_WRONG) reason = `${result.wrong.length} nights did not match when read back`;
  else if (failures >= MAX_FAILURES) reason = `${failures} failed runs in a row: ${result.error ?? (result.wrong.length > 0 ? "nights did not match when read back" : "nights refused")}`;
  saveState(db, listing.name, { failures, paused_at: reason ? at : null, paused_reason: reason });
  return reason ? { ...result, pausedNow: reason } : result;
}

/** Keep the log for KEEP_DAYS days. */
function prune(db: Db, now: Date): void {
  const before = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  const old = db.prepare("SELECT id FROM pilot_runs WHERE started_at < ?").all(before) as { id: number }[];
  for (const { id } of old) {
    db.prepare("DELETE FROM pilot_changes WHERE run_id = ?").run(id);
    db.prepare("DELETE FROM pilot_runs WHERE id = ?").run(id);
  }
  db.prepare("DELETE FROM pilot_confirmations WHERE confirmed_at < ? AND date < ?").run(before, before.slice(0, 10));
}

function record(db: Db, r: PilotRunResult, finishedAt: string): number {
  const written = r.listings.reduce((a, l) => a + (l.status === "written" || l.status === "error" ? l.nights.length : 0), 0);
  const errors = r.listings.some((l) => ["error", "not-read", "paused"].includes(l.status) || l.wrong.length > 0 || l.refused.length > 0);
  const summary = r.listings.map((l) => ({
    listing: l.listing,
    feed: l.feed,
    status: l.status,
    nights: l.nights.length,
    capped: l.nights.filter((n) => n.limited !== null).length,
    wrong: l.wrong.length,
    refused: l.refused.length,
    skipped: l.skipped.length,
    ...(l.error ? { error: l.error } : {}),
    ...(l.pausedNow ? { pausedNow: l.pausedNow } : {}),
  }));
  return db.transaction(() => {
    const id = Number(
      db
        .prepare("INSERT INTO pilot_runs (started_at, finished_at, trigger, outcome, written, listings) VALUES (?, ?, ?, ?, ?, ?)")
        .run(r.startedAt, finishedAt, r.trigger, errors ? "errors" : "ok", written, JSON.stringify(summary)).lastInsertRowid,
    );
    const insert = db.prepare(
      `INSERT INTO pilot_changes (run_id, listing, feed, date, old_price, new_price, target_price, old_min_stay, new_min_stay, limited, steps, verified, confirmed_by, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of r.listings) {
      if (l.status !== "written" && l.status !== "error") continue;
      for (const n of l.nights) {
        const verified = n.verified === null ? null : n.verified ? 1 : 0;
        insert.run(id, l.listing, l.feed, n.date, n.oldPrice, n.newPrice, n.target, n.oldMinStay, n.newMinStay, n.limited, JSON.stringify(n.steps), verified, n.confirmation?.by ?? null, n.confirmation?.at ?? null);
      }
    }
    return id;
  })();
}

/** One run of the autopilot. */
export async function runPilot(dir: string, io: Io, opts: PilotOptions, config: HostConfig = loadHostConfig(dir)): Promise<PilotRunResult> {
  const now = io.now();
  const startedAt = now.toISOString();
  const empty: PilotRunResult = { runId: null, startedAt, trigger: opts.trigger, dryRun: opts.dryRun, listings: [], notRead: [] };
  const db = openDb(dbPath(dir));
  try {
    if (!opts.dryRun) {
      if (opts.onlyIfDue && lastRun(db).day === localToday(now)) return { ...empty, skipped: "done-today" };
      if (!takeLock(db, now)) return { ...empty, skipped: "busy" };
    }
    try {
      const listings = opts.only ? config.listings.filter((l) => opts.only?.includes(l.name)) : config.listings;
      const { reports } = await syncEverything(db, dir, config.listings, io, config.market);
      const result: PilotRunResult = { ...empty, notRead: reports.filter((r) => !r.ok) };
      for (const l of listings) result.listings.push(await runListing(db, dir, io, l, reports, opts, startedAt));
      if (opts.dryRun) return result;
      const finishedAt = io.now().toISOString();
      result.runId = record(db, result, finishedAt);
      setMeta(db, LAST_DAY_KEY, localToday(now));
      setMeta(db, LAST_RUN_KEY, finishedAt);
      prune(db, now);
      return result;
    } finally {
      if (!opts.dryRun) dropLock(db);
    }
  } finally {
    db.close();
  }
}
