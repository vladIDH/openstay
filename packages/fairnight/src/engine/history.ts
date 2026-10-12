/**
 * Past sold prices of a listing, grouped by month, for the historical floor.
 */
import { fromDay, toDay } from "./dates.js";
import type { PastPrice } from "./types.js";

export interface MonthHistory {
  /** "YYYY-MM" */
  month: string;
  nights: number;
  /** Average price, to the cent. */
  average: number;
}

export class PriceHistory {
  private readonly months = new Map<string, { sum: number; nights: number }>();

  constructor(prices: readonly PastPrice[] = []) {
    // One price per night: if a date appears twice, the last one counts.
    const byDate = new Map<string, number>();
    for (const p of prices) byDate.set(p.date, p.price);
    for (const [date, price] of byDate) {
      const key = date.slice(0, 7);
      const m = this.months.get(key) ?? { sum: 0, nights: 0 };
      m.sum += price;
      m.nights += 1;
      this.months.set(key, m);
    }
  }

  /** The same calendar month, one year before the month of `day`. */
  sameMonthLastYear(day: number): MonthHistory | null {
    const iso = fromDay(day);
    const month = `${Number(iso.slice(0, 4)) - 1}-${iso.slice(5, 7)}`;
    const m = this.months.get(month);
    if (!m) return null;
    return { month, nights: m.nights, average: Math.round((m.sum / m.nights + Number.EPSILON) * 100) / 100 };
  }
}

export function dayOrNull(iso: string | undefined): number | null {
  return iso === undefined ? null : toDay(iso);
}
