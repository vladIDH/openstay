/**
 * Zone data, indexed for the market factor. Each night of the zone is compared
 * with the zone's own average over all the nights it has: "busier than usual"
 * or "quieter than usual", never an absolute level.
 *
 * Occupancy is the signal when the night has it; otherwise the zone's average
 * price is. Nights measured on too few comparable listings are left out, both
 * as nights and from the averages.
 */
import type { MarketData, MarketDay } from "./types.js";

export interface MarketReading {
  signal: "occupancy" | "price";
  value: number;
  average: number;
  comparables: number | undefined;
}

export class MarketIndex {
  private readonly byDate = new Map<string, MarketDay>();
  private readonly averages = new Map<number, { occupancy: number | null; price: number | null }>();

  constructor(readonly data: MarketData) {
    for (const d of data.days) this.byDate.set(d.date, d);
  }

  private usable(d: MarketDay, minComparables: number): boolean {
    return d.comparables === undefined || d.comparables >= minComparables;
  }

  /** Average occupancy and price of the usable nights, cached per threshold. */
  private averagesFor(minComparables: number): { occupancy: number | null; price: number | null } {
    const cached = this.averages.get(minComparables);
    if (cached) return cached;
    let occSum = 0;
    let occN = 0;
    let priceSum = 0;
    let priceN = 0;
    for (const d of this.data.days) {
      if (!this.usable(d, minComparables)) continue;
      if (d.occupancyPercent !== undefined) {
        occSum += d.occupancyPercent;
        occN++;
      }
      if (d.averagePrice !== undefined) {
        priceSum += d.averagePrice;
        priceN++;
      }
    }
    const result = {
      occupancy: occN > 0 && occSum > 0 ? occSum / occN : null,
      price: priceN > 0 ? priceSum / priceN : null,
    };
    this.averages.set(minComparables, result);
    return result;
  }

  reading(date: string, minComparables: number): MarketReading | null {
    const d = this.byDate.get(date);
    if (!d || !this.usable(d, minComparables)) return null;
    const avg = this.averagesFor(minComparables);
    if (d.occupancyPercent !== undefined && avg.occupancy !== null) {
      return { signal: "occupancy", value: d.occupancyPercent, average: avg.occupancy, comparables: d.comparables };
    }
    if (d.averagePrice !== undefined && avg.price !== null) {
      return { signal: "price", value: d.averagePrice, average: avg.price, comparables: d.comparables };
    }
    return null;
  }
}
