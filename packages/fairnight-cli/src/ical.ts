/**
 * A small iCalendar (RFC 5545) reader for the calendars that Airbnb, Booking,
 * Vrbo and channel managers export. It only needs the VEVENT blocks and their
 * dates: no recurrence, no time zones (a night is a calendar date).
 */
import { createHash } from "node:crypto";
import type { IcalSource, TreatAs } from "./config.js";

export interface IcalEvent {
  uid: string;
  /** First night, YYYY-MM-DD. */
  start: string;
  /** Departure day, YYYY-MM-DD (exclusive). */
  end: string;
  summary: string;
}

export class IcalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcalError";
  }
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Undo line folding: a line starting with a space or tab continues the previous one. */
function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function parseProperty(line: string): Property | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  const [rawName = "", ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: rawName.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

/** "20261103" or "20261103T150000Z" → "2026-11-03". The time and zone are ignored on purpose. */
function toIsoDate(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

function addDays(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export interface ParseResult {
  events: IcalEvent[];
  /** Events that could not be read (no start date, bad date…), with the reason. */
  skipped: string[];
}

export function parseIcal(text: string): ParseResult {
  const lines = unfold(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (!lines.some((l) => l.trim().toUpperCase() === "BEGIN:VCALENDAR")) {
    throw new IcalError("this is not an iCal calendar (no BEGIN:VCALENDAR)");
  }

  const events: IcalEvent[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let current: Property[] | null = null;

  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (upper === "END:VEVENT") {
      if (current) {
        const r = toEvent(current);
        if (typeof r === "string") skipped.push(r);
        else if (r !== null && !seen.has(r.uid)) {
          seen.add(r.uid);
          events.push(r);
        }
      }
      current = null;
      continue;
    }
    if (current) {
      const p = parseProperty(line);
      if (p) current.push(p);
    }
  }
  return { events, skipped };
}

/** An event, a reason it was skipped, or null for cancelled events (silently dropped). */
function toEvent(props: Property[]): IcalEvent | string | null {
  const get = (name: string) => props.find((p) => p.name === name);
  const status = get("STATUS")?.value.trim().toUpperCase();
  if (status === "CANCELLED") return null;

  const summary = unescapeText(get("SUMMARY")?.value ?? "").trim();
  const rawStart = get("DTSTART")?.value;
  if (rawStart === undefined) return `event "${summary || "?"}" has no start date`;
  const start = toIsoDate(rawStart);
  if (!start) return `event "${summary || "?"}" has an unreadable start date "${rawStart}"`;

  let end: string | null = null;
  const rawEnd = get("DTEND")?.value;
  if (rawEnd !== undefined) {
    end = toIsoDate(rawEnd);
    if (!end) return `event "${summary || "?"}" has an unreadable end date "${rawEnd}"`;
  } else {
    const days = /^P(\d+)D$/.exec(get("DURATION")?.value.trim() ?? "");
    end = addDays(start, days ? Number(days[1]) : 1);
  }
  // A same-day event still occupies its night.
  if (end <= start) end = addDays(start, 1);

  const rawUid = get("UID")?.value.trim();
  const uid = rawUid || `gen-${createHash("sha256").update(`${start}|${end}|${summary}`).digest("hex").slice(0, 16)}`;
  return { uid, start, end, summary };
}

/**
 * Is an event a guest's stay or a blocked date?
 *
 * - airbnb: "Reserved" is a stay; "Airbnb (Not available)" is a block.
 * - booking: the export does not tell stays from closed dates, so every
 *   event counts as a stay.
 * - vrbo: "Blocked"/"Unavailable" is a block, the rest are stays.
 * - other: "not available", "unavailable", "blocked" or "closed" is a block.
 *
 * A calendar can force one reading with `treatAs` in the config.
 */
export function classify(summary: string, source: IcalSource, treatAs: TreatAs = "auto"): "reservation" | "blocked" {
  if (treatAs !== "auto") return treatAs;
  const s = summary.toLowerCase();
  switch (source) {
    case "airbnb":
      return /not available|blocked/.test(s) ? "blocked" : "reservation";
    case "booking":
      return "reservation";
    case "vrbo":
      return /blocked|unavailable/.test(s) ? "blocked" : "reservation";
    case "other":
      return /not available|unavailable|blocked|closed/.test(s) ? "blocked" : "reservation";
  }
}
