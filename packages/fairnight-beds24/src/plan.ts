/**
 * What `fairnight beds24 spingi` would write: the differences between the
 * Beds24 calendar and Fairnight's prices, and the calendar writes.
 */
import type { NightQuote } from "fairnight";
import type { CalendarDay, CalendarWrite } from "./client.js";

export interface DiffRow {
  date: string;
  currentPrice: number | null;
  currentMinStay: number | null;
  newPrice: number;
  newMinStay: number;
}

export interface PushPlan {
  changes: DiffRow[];
  unchanged: number;
  /** Free for Fairnight but unavailable on Beds24 (no unit left, blackout): left alone. */
  unavailableOnBeds24: string[];
  /**
   * Room types with several units: nights where Beds24 has a different number
   * of units free (numAvail) than Fairnight sees. Left alone: re-import first.
   */
  unitsMismatch?: { date: string; free: number; numAvail: number }[];
}

/** How Beds24 reads the end ("to") of a written range. Unknown until checked once on a real account. */
export type RangeEnd = "unknown" | "inclusive" | "exclusive";

export const MAX_RANGE_NIGHTS = 7;

export function planPush(quotes: readonly NightQuote[], current: Record<string, CalendarDay>): PushPlan {
  const plan: PushPlan = { changes: [], unchanged: 0, unavailableOnBeds24: [] };
  for (const q of quotes) {
    if (q.price === null || q.minStay === null) continue;
    const now = current[q.date];
    if (now && !now.available) {
      plan.unavailableOnBeds24.push(q.date);
      continue;
    }
    // One price for the whole room type: write it only where Beds24 agrees on how many units are free.
    if (q.units && typeof now?.numAvail === "number" && now.numAvail !== q.units.free) {
      (plan.unitsMismatch ??= []).push({ date: q.date, free: q.units.free, numAvail: now.numAvail });
      continue;
    }
    const currentPrice = now?.price ?? null;
    const currentMinStay = now?.minStay ?? null;
    if (currentPrice === q.price && currentMinStay === q.minStay) {
      plan.unchanged++;
      continue;
    }
    plan.changes.push({ date: q.date, currentPrice, currentMinStay, newPrice: q.price, newMinStay: q.minStay });
  }
  return plan;
}

const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The calendar writes for one room. Single days (from = to) until it is known
 * that Beds24 includes "to"; after that, runs of at most MAX_RANGE_NIGHTS equal
 * nights.
 */
export function buildWrites(roomId: number, rows: readonly DiffRow[], rangeEnd: RangeEnd): CalendarWrite[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (rangeEnd !== "inclusive") {
    return sorted.map((r) => ({ roomId, from: r.date, to: r.date, price: r.newPrice, minStay: r.newMinStay }));
  }
  const writes: CalendarWrite[] = [];
  let run: DiffRow[] = [];
  const flush = () => {
    const first = run[0];
    const last = run.at(-1);
    if (first && last) writes.push({ roomId, from: first.date, to: last.date, price: first.newPrice, minStay: first.newMinStay });
    run = [];
  };
  for (const r of sorted) {
    const prev = run.at(-1);
    const head = run[0];
    if (prev && head && nextDay(prev.date) === r.date && r.newPrice === head.newPrice && r.newMinStay === head.newMinStay && run.length < MAX_RANGE_NIGHTS) {
      run.push(r);
    } else {
      flush();
      run.push(r);
    }
  }
  flush();
  return writes;
}

/** The first two consecutive equal nights: used once to check how Beds24 reads "to". */
export function probePair(rows: readonly DiffRow[]): [DiffRow, DiffRow] | null {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i] as DiffRow;
    const b = sorted[i + 1] as DiffRow;
    if (nextDay(a.date) === b.date && a.newPrice === b.newPrice && a.newMinStay === b.newMinStay) return [a, b];
  }
  return null;
}

/** Nights covered by a write (from..to inclusive). */
export function nightsOf(write: CalendarWrite): string[] {
  const out: string[] = [];
  for (let d = write.from; d <= write.to; d = nextDay(d)) out.push(d);
  return out;
}
