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

/** One night of a room type made of several Smoobu apartments. */
export interface TypeDiffRow extends DiffRow {
  /** The apartments to write: free on Smoobu and not at Fairnight's price yet. */
  apartments: number[];
}

export interface TypePushPlan {
  changes: TypeDiffRow[];
  unchanged: number;
  /**
   * Nights where Smoobu has a different number of apartments free than
   * Fairnight has rooms free: not touched, re-import first. For a single
   * apartment these are the nights free here but unavailable on Smoobu.
   */
  unavailableOnSmoobu: string[];
}

/**
 * Smoobu has no room types: a small hotel's "Double" with 6 rooms is 6
 * apartments that Fairnight joins into one room type with one price. Each
 * night is written to the apartments still free on Smoobu, and only when
 * their number matches the rooms Fairnight sees free.
 */
export function planTypePush(quotes: readonly NightQuote[], current: Record<string, Record<string, RateDay>>, apartments: readonly number[]): TypePushPlan {
  const plan: TypePushPlan = { changes: [], unchanged: 0, unavailableOnSmoobu: [] };
  for (const q of quotes) {
    if (q.price === null || q.minStay === null) continue; // sold out or blocked
    const free = apartments.filter((a) => current[String(a)]?.[q.date]?.available !== 0);
    if (free.length !== (q.units?.free ?? 1)) {
      plan.unavailableOnSmoobu.push(q.date);
      continue;
    }
    const differ = free.filter((a) => {
      const now = current[String(a)]?.[q.date];
      return (now?.price ?? null) !== q.price || (now?.min_length_of_stay ?? null) !== q.minStay;
    });
    if (differ.length === 0) {
      plan.unchanged++;
      continue;
    }
    const now = current[String(differ[0])]?.[q.date];
    plan.changes.push({
      date: q.date,
      currentPrice: now?.price ?? null,
      currentMinStay: now?.min_length_of_stay ?? null,
      newPrice: q.price,
      newMinStay: q.minStay,
      apartments: differ,
    });
  }
  return plan;
}

/** Group the nights by the apartments they go to: one POST per group (usually a single one). */
export function groupByApartments(rows: readonly TypeDiffRow[]): { apartments: number[]; rows: TypeDiffRow[] }[] {
  const groups = new Map<string, { apartments: number[]; rows: TypeDiffRow[] }>();
  for (const r of rows) {
    const apartments = [...r.apartments].sort((a, b) => a - b);
    const key = apartments.join(",");
    let g = groups.get(key);
    if (!g) {
      g = { apartments, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  return [...groups.values()];
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
export function probePair<T extends DiffRow>(rows: readonly T[]): [T, T] | null {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i] as T;
    const b = sorted[i + 1] as T;
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
