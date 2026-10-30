/**
 * The daily cap made visible, and the host's exception to it.
 *
 * - pilot_held keeps, after every run that worked, the nights the cap held back:
 *   the calendar page and `fairnight price` do not read the channel, so this is
 *   the only place they can learn what was sent.
 * - pilot_confirmations keeps what the host confirmed, one row per night. A
 *   confirmed night skips the daily cap and nothing else: the lowest and highest
 *   price still apply. Nothing here ever confirms a night by itself; a row is
 *   written only by `fairnight pilota conferma` and by the button on the page.
 *
 * A confirmation ends by itself: it counts from the day it is made until the
 * date of the night. Rows are never deleted when removed, so the log keeps who
 * confirmed and who took it back.
 */
import { addDays, daysBetween } from "./channel.js";
import type { HostListing } from "./config.js";
import { hasTable, type Db } from "./db.js";
import type { Language } from "./lingua.js";
import { PAGE_TEXTS, type TextKey } from "./page-texts.js";

/** A range longer than this is a typing mistake. */
export const MAX_CONFIRM_NIGHTS = 366;

export interface HeldNight {
  date: string;
  /** The engine's price. */
  calculated: number;
  /** What the autopilot left on the channel. */
  sent: number;
  maxChange: number;
}

export interface Confirmation {
  listing: string;
  date: string;
  /** The price the host saw when confirming; null on a night not for sale. */
  calculated: number | null;
  by: string;
  via: string;
  at: string;
  removedBy: string | null;
  removedAt: string | null;
}

/** What the calendar says about one night: either part can be missing. */
export interface NightMark {
  held?: { calculated: number; sent: number; difference: number; maxChange: number; at: string };
  confirmation?: { by: string; via: string; at: string };
}

export class ConfirmError extends Error {
  constructor(readonly code: "dates" | "past" | "range") {
    super(code);
  }
}

interface ConfirmationRow {
  listing: string;
  date: string;
  calculated: number | null;
  confirmed_by: string;
  confirmed_via: string;
  confirmed_at: string;
  removed_by: string | null;
  removed_at: string | null;
}

const fromRow = (r: ConfirmationRow): Confirmation => ({
  listing: r.listing,
  date: r.date,
  calculated: r.calculated,
  by: r.confirmed_by,
  via: r.confirmed_via,
  at: r.confirmed_at,
  removedBy: r.removed_by,
  removedAt: r.removed_at,
});

const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;

/** The nights from `from` to `to`, both included. */
export function nightsBetween(from: unknown, to: unknown): string[] {
  if (!isDate(from) || !isDate(to)) throw new ConfirmError("dates");
  const count = daysBetween(from, to) + 1;
  if (count < 1 || count > MAX_CONFIRM_NIGHTS) throw new ConfirmError("range");
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

/** Confirm a range of nights; nights already confirmed keep their first confirmation. Returns how many are new. */
export function confirmNights(
  db: Db,
  listing: string,
  nights: readonly string[],
  who: { by: string; via: "page" | "command" },
  at: string,
  priceOf: (date: string) => number | null,
): number {
  const insert = db.prepare(
    `INSERT INTO pilot_confirmations (listing, date, calculated, confirmed_by, confirmed_via, confirmed_at)
     SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM pilot_confirmations WHERE listing = ? AND date = ? AND removed_at IS NULL)`,
  );
  return db.transaction(() => nights.reduce((n, date) => n + insert.run(listing, date, priceOf(date), who.by, who.via, at, listing, date).changes, 0))();
}

/** Take confirmations back; the rows stay, marked removed. Returns how many ended. */
export function removeConfirmations(db: Db, listing: string, nights: readonly string[], by: string, at: string): number {
  const update = db.prepare("UPDATE pilot_confirmations SET removed_by = ?, removed_at = ? WHERE listing = ? AND date = ? AND removed_at IS NULL");
  return db.transaction(() => nights.reduce((n, date) => n + update.run(by, at, listing, date).changes, 0))();
}

/** The confirmations that count today: not removed, and the night has not passed. */
export function activeConfirmations(db: Db, listing: string, today: string): Map<string, Confirmation> {
  if (!hasTable(db, "pilot_confirmations")) return new Map(); // an older database, read only
  const rows = db.prepare("SELECT * FROM pilot_confirmations WHERE listing = ? AND removed_at IS NULL AND date >= ?").all(listing, today) as ConfirmationRow[];
  return new Map(rows.map((r) => [r.date, fromRow(r)]));
}

/** Every confirmation, old ones too: what the log shows. */
export function confirmationHistory(db: Db, listing?: string): Confirmation[] {
  const rows = db
    .prepare(`SELECT * FROM pilot_confirmations ${listing !== undefined ? "WHERE listing = ?" : ""} ORDER BY confirmed_at DESC, listing, date`)
    .all(...(listing !== undefined ? [listing] : [])) as ConfirmationRow[];
  return rows.map(fromRow);
}

/** What the last run that worked held back: replaces what the run before left. */
export function saveHeld(db: Db, listing: string, held: readonly HeldNight[], at: string): void {
  const insert = db.prepare("INSERT INTO pilot_held (listing, date, calculated, sent, max_change, run_at) VALUES (?, ?, ?, ?, ?, ?)");
  db.transaction(() => {
    db.prepare("DELETE FROM pilot_held WHERE listing = ?").run(listing);
    for (const h of held) insert.run(listing, h.date, h.calculated, h.sent, h.maxChange, at);
  })();
}

/**
 * The marks of a listing's nights. The calculated price is today's, the same the
 * calendar shows; the sent price is what the last run left on the channel. With
 * the autopilot off nothing is being held back, so no mark says so.
 */
export function nightMarks(db: Db, listing: HostListing, today: string, nights: readonly { date: string; price: number | null }[]): Map<string, NightMark> {
  const marks = new Map<string, NightMark>();
  const mark = (date: string) => marks.get(date) ?? marks.set(date, {}).get(date) as NightMark;
  const wanted = new Map(nights.map((n) => [n.date, n.price]));
  for (const [date, c] of activeConfirmations(db, listing.name, today)) {
    if (wanted.has(date)) mark(date).confirmation = { by: c.by, via: c.via, at: c.at };
  }
  if (listing.pilot?.enabled !== true || !hasTable(db, "pilot_held")) return marks;
  const rows = db.prepare("SELECT date, sent, max_change, run_at FROM pilot_held WHERE listing = ? AND date >= ?").all(listing.name, today) as {
    date: string;
    sent: number;
    max_change: number;
    run_at: string;
  }[];
  for (const r of rows) {
    const calculated = wanted.get(r.date);
    if (calculated === null || calculated === undefined || calculated === r.sent) continue;
    mark(r.date).held = { calculated, sent: r.sent, difference: Math.round((r.sent - calculated) * 100) / 100, maxChange: r.max_change, at: r.run_at };
  }
  return marks;
}

// ---------------------------------------------------------------- the same sentences as the page, for the commands

export function textOf(lang: Language, key: TextKey, vars: Record<string, string | number> = {}): string {
  let s: string = PAGE_TEXTS[lang][key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export const pluralOf = (lang: Language, key: "confirm_done" | "unconfirm_done", n: number, vars: Record<string, string | number>) =>
  textOf(lang, `${key}_${new Intl.PluralRules(lang).select(n) === "one" ? "one" : "other"}`, { n, ...vars });

export function moneyOf(lang: Language, currency: string, n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

/** A moment as the host reads it: "2026-11-01 09:00". */
export const moment = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** The lines about one night, for `fairnight price`. */
export function markLines(mark: NightMark, currency: string, lang: Language): string[] {
  const m = (n: number) => moneyOf(lang, currency, n);
  const lines: string[] = [];
  if (mark.held) {
    const { calculated, sent, difference, maxChange } = mark.held;
    lines.push(textOf(lang, "held_line", { sent: m(sent), calculated: m(calculated) }));
    lines.push(textOf(lang, "held_detail", { calculated: m(calculated), sent: m(sent), difference: m(Math.abs(difference)), p: maxChange }));
  }
  if (mark.confirmation) {
    lines.push(textOf(lang, "confirmed_line", { by: mark.confirmation.by, when: moment(mark.confirmation.at) }));
    if (mark.held) lines.push(textOf(lang, "confirmed_pending", { calculated: m(mark.held.calculated) }));
  }
  return lines;
}
