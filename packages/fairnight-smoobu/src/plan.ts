/**
 * What `fairnight smoobu spingi` would write: the differences between the
 * prices on Smoobu and Fairnight's, and the operations that write them.
 */
import type { NightQuote } from "fairnight";
import type { RateDay, RateOperation } from "./client.js";

export interface DiffRow {
  date: string;
  currentPrice: number | null;
  currentMinStay: number | null;
  newPrice: number;
  newMinStay: number;
}

export interface PushPlan {
  /** Nights whose price or minimum stay will change. */
  changes: DiffRow[];
  /** Nights for sale that already match. */
  unchanged: number;
  /** Nights Fairnight sees as free but Smoobu as unavailable: not touched, re-import first. */
  unavailableOnSmoobu: string[];
}

/** How Smoobu reads the end of a "from:to" range. Unknown until checked once on a real account. */
export type RangeEnd = "unknown" | "inclusive" | "exclusive";

/** Longest run of nights written by one operation. */
export const MAX_RANGE_NIGHTS = 7;

export function planPush(quotes: readonly NightQuote[], current: Record<string, RateDay>): PushPlan {
  const plan: PushPlan = { changes: [], unchanged: 0, unavailableOnSmoobu: [] };
  for (const q of quotes) {
    if (q.price === null || q.minStay === null) continue; // reserved or blocked
    const now = current[q.date];
    if (now && now.available === 0) {
      plan.unavailableOnSmoobu.push(q.date);
      continue;
    }
    const currentPrice = now?.price ?? null;
    const currentMinStay = now?.min_length_of_stay ?? null;
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
 * One operation per run of consecutive nights with the same price and minimum
 * stay, at most MAX_RANGE_NIGHTS long. Price and minimum stay always travel
 * together (Smoobu refuses a minimum stay on a date without a price).
 *
 * Until it is known that Smoobu includes the last day of a "from:to" range,
 * every night gets its own single-day operation.
 */
export function buildOperations(rows: readonly DiffRow[], rangeEnd: RangeEnd): RateOperation[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (rangeEnd !== "inclusive") {
    return sorted.map((r) => ({ dates: [r.date], daily_price: r.newPrice, min_length_of_stay: r.newMinStay }));
  }
  const ops: RateOperation[] = [];
  let start: DiffRow | null = null;
  let last: DiffRow | null = null;
  let length = 0;
  const flush = () => {
    if (!start || !last) return;
    ops.push({
      dates: [start.date === last.date ? start.date : `${start.date}:${last.date}`],
      daily_price: start.newPrice,
      min_length_of_stay: start.newMinStay,
    });
  };
  for (const r of sorted) {
    const continues =
      start && last && nextDay(last.date) === r.date && r.newPrice === start.newPrice && r.newMinStay === start.newMinStay && length < MAX_RANGE_NIGHTS;
    if (continues) {
      last = r;
      length++;
    } else {
      flush();
      start = r;
      last = r;
      length = 1;
    }
  }
  flush();
  return ops;
}

/** The first two consecutive nights with identical values: used once to check how Smoobu reads a range. */
export function probePair(rows: readonly DiffRow[]): [DiffRow, DiffRow] | null {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i] as DiffRow;
    const b = sorted[i + 1] as DiffRow;
    if (nextDay(a.date) === b.date && a.newPrice === b.newPrice && a.newMinStay === b.newMinStay) return [a, b];
  }
  return null;
}

/** Split a list into chunks (operations per POST request). */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
