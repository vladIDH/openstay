/**
 * Availability of one listing, built from its stays.
 *
 * A night is "reserved" (a guest sleeps there), "blocked" (not for sale: owner
 * use, maintenance) or "available". If a reservation and a block overlap, the
 * reservation wins.
 */
import { monthBounds, toDay } from "./dates.js";
import type { ListingCalendar } from "./types.js";

export type NightStatus = "available" | "reserved" | "blocked";

export interface MonthOccupancy {
  reserved: number;
  sellable: number;
  percent: number;
}

export class Availability {
  private readonly nights = new Map<number, Exclude<NightStatus, "available">>();
  private readonly occupancyCache = new Map<string, MonthOccupancy | null>();

  constructor(calendar: ListingCalendar) {
    for (const stay of calendar.stays) {
      const kind = stay.kind ?? "reservation";
      const last = toDay(stay.checkOut) - 1;
      for (let d = toDay(stay.checkIn); d <= last; d++) {
        if (kind === "reservation" || !this.nights.has(d)) {
          this.nights.set(d, kind === "reservation" ? "reserved" : "blocked");
        }
      }
    }
  }

  status(day: number): NightStatus {
    return this.nights.get(day) ?? "available";
  }

  isFree(day: number): boolean {
    return !this.nights.has(day);
  }

  /**
   * If `day` is free and sits inside a stretch of free nights that has an
   * occupied (reserved or blocked) night on BOTH sides, and the stretch is at
   * most `maxNights` long, return its length. Otherwise null.
   */
  gapLength(day: number, maxNights: number): number | null {
    if (!this.isFree(day)) return null;
    let start = day;
    while (this.isFree(start - 1)) {
      start--;
      if (day - start + 1 > maxNights) return null;
    }
    let end = day;
    while (this.isFree(end + 1)) {
      end++;
      if (end - start + 1 > maxNights) return null;
    }
    return end - start + 1;
  }

  /**
   * Share of the month that is reserved, counting only nights from `fromDay`
   * onwards (the past is no longer for sale). Blocked nights are left out of
   * both counts. Null when no night of the month is sellable.
   */
  monthOccupancy(day: number, fromDay: number): MonthOccupancy | null {
    const { first, last } = monthBounds(day);
    const start = Math.max(first, fromDay);
    const key = `${first}:${start}`;
    if (this.occupancyCache.has(key)) return this.occupancyCache.get(key) ?? null;
    let reserved = 0;
    let sellable = 0;
    for (let d = start; d <= last; d++) {
      const s = this.status(d);
      if (s === "blocked") continue;
      sellable++;
      if (s === "reserved") reserved++;
    }
    const result = sellable === 0 ? null : { reserved, sellable, percent: (reserved / sellable) * 100 };
    this.occupancyCache.set(key, result);
    return result;
  }
}
