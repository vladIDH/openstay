/**
 * Availability of one listing, built from its stays.
 *
 * A listing is a home (1 unit) or a room type of a small hotel with N identical
 * units sold at one price. For every night we count how many units are
 * reserved (a guest sleeps there), blocked (not for sale: owner use,
 * maintenance) and free.
 *
 * - Stays of the same unit (`unit` set) are merged first, as for a single home:
 *   if a reservation and a block overlap on that unit, the reservation wins.
 * - A stay without a unit takes `units` units of its own (default 1).
 * - Reservations are counted before blocks, and never more than N in total:
 *   anything beyond N is an overbooking, reported but never "less than 0 free".
 *
 * With N = 1 this is exactly the single-home rule: the night is reserved if any
 * reservation covers it, otherwise blocked if any block does, otherwise free.
 *
 * The night is "available" while at least one unit is free. Gaps and the
 * "is the night taken" rules look at sold-out nights (no unit free): no stay
 * can run across a sold-out night, whatever unit it lands on.
 */
import { monthBounds, toDay } from "./dates.js";
import type { ListingCalendar, NightUnits } from "./types.js";

export type NightStatus = "available" | "reserved" | "blocked";

export interface MonthOccupancy {
  /** Unit-nights reserved (nights for a home). */
  reserved: number;
  /** Unit-nights that could be sold: blocked ones are left out. */
  sellable: number;
  percent: number;
}

interface NightCount {
  /** Status of each named unit on this night. */
  named: Map<string, Exclude<NightStatus, "available">>;
  /** Units taken by stays without a unit. */
  reserved: number;
  blocked: number;
}

export class Availability {
  readonly units: number;
  private readonly counts = new Map<number, NightCount>();
  private readonly unitsCache = new Map<number, NightUnits>();
  private readonly occupancyCache = new Map<string, MonthOccupancy | null>();

  constructor(calendar: ListingCalendar, units = 1) {
    this.units = units;
    for (const stay of calendar.stays) {
      const kind = stay.kind ?? "reservation";
      const last = toDay(stay.checkOut) - 1;
      for (let d = toDay(stay.checkIn); d <= last; d++) {
        let c = this.counts.get(d);
        if (!c) {
          c = { named: new Map(), reserved: 0, blocked: 0 };
          this.counts.set(d, c);
        }
        if (stay.unit !== undefined) {
          if (kind === "reservation" || !c.named.has(stay.unit)) c.named.set(stay.unit, kind === "reservation" ? "reserved" : "blocked");
        } else if (kind === "reservation") {
          c.reserved += stay.units ?? 1;
        } else {
          c.blocked += stay.units ?? 1;
        }
      }
    }
  }

  /** Units of the night: total, free, reserved, blocked. */
  night(day: number): NightUnits {
    const cached = this.unitsCache.get(day);
    if (cached) return cached;
    const c = this.counts.get(day);
    let result: NightUnits;
    if (!c) {
      result = { total: this.units, free: this.units, reserved: 0, blocked: 0 };
    } else {
      let r = c.reserved;
      let b = c.blocked;
      for (const s of c.named.values()) {
        if (s === "reserved") r++;
        else b++;
      }
      const reserved = Math.min(this.units, r);
      const blocked = Math.min(this.units - reserved, b);
      result = { total: this.units, free: this.units - reserved - blocked, reserved, blocked };
      if (r + b > this.units) result.overbooked = r + b - this.units;
    }
    this.unitsCache.set(day, result);
    return result;
  }

  status(day: number): NightStatus {
    const n = this.night(day);
    if (n.free > 0) return "available";
    return n.reserved > 0 ? "reserved" : "blocked";
  }

  /** At least one unit free. */
  isFree(day: number): boolean {
    return this.night(day).free > 0;
  }

  /**
   * If `day` has a unit free and sits inside a stretch of such nights that has
   * a sold-out night (no unit free) on BOTH sides, and the stretch is at most
   * `maxNights` long, return its length. Otherwise null.
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
   * onwards (the past is no longer for sale), in unit-nights: 4 rooms of 6
   * booked on a night count 4 of 6. Blocked units are left out of both counts.
   * Null when no unit-night of the month is sellable.
   */
  monthOccupancy(day: number, fromDay: number): MonthOccupancy | null {
    const { first, last } = monthBounds(day);
    const start = Math.max(first, fromDay);
    const key = `${first}:${start}`;
    if (this.occupancyCache.has(key)) return this.occupancyCache.get(key) ?? null;
    let reserved = 0;
    let sellable = 0;
    for (let d = start; d <= last; d++) {
      const n = this.night(d);
      sellable += n.total - n.blocked;
      reserved += n.reserved;
    }
    const result = sellable === 0 ? null : { reserved, sellable, percent: (reserved / sellable) * 100 };
    this.occupancyCache.set(key, result);
    return result;
  }
}
