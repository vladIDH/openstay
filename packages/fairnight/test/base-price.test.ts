import { describe, expect, it } from "vitest";
import { describeComparables, suggestBasePrice } from "../src/engine/index.js";
import type { MarketData, MarketDay } from "../src/engine/index.js";

/** Invented zone: one price per month, every night of the month, from 2025-11 on. */
function zone(prices: number[], comparables: number | null = 20, extra: Partial<MarketData> = {}): MarketData {
  const days: MarketDay[] = [];
  prices.forEach((price, i) => {
    const y = 2025 + Math.floor((10 + i) / 12);
    const m = ((10 + i) % 12) + 1;
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= n; d++) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date, averagePrice: price, ...(comparables !== null ? { comparables } : {}) });
    }
  });
  return { source: "csv", attribution: "invented test data", area: "test-zone", readOn: "2026-10-15", days, ...extra };
}

const CURRENT = { basePrice: 100, currency: "EUR" };

describe("suggested base price", () => {
  it("is the median of the monthly averages, rounded", () => {
    const r = suggestBasePrice(zone([80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190]), CURRENT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.suggested).toBe(135);
    expect(r.differencePercent).toBe(35);
    expect(r.farOff).toBe(true);
    expect(r.low).toBe(80);
    expect(r.high).toBe(190);
    expect(r.comparables).toBe(20);
    expect(r.months.map((m) => m.month)).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(r.explanation).toContain("Suggested base price 135 EUR");
    expect(r.explanation).toContain("20 homes of the whole zone");
    expect(r.explanation).toContain('zone "test-zone", 2025-11 → 2026-10 (12 months, from 80 EUR to 190 EUR)');
    expect(r.explanation).toContain("+35%");
    expect(r.explanation).toContain("Very different from yours");
    expect(r.explanation).toContain("Source: invented test data, read 2026-10-15. Nothing changes until you confirm it.");
  });

  it("keeps only the 12 most recent months", () => {
    const r = suggestBasePrice(zone([1000, 1000, 100, 100, 100, 100, 100, 100, 110, 110, 110, 110, 110, 110]), CURRENT);
    if (!r.ok) throw new Error(r.explanation);
    expect(r.months).toHaveLength(12);
    expect(r.months[0]?.month).toBe("2026-01");
    expect(r.suggested).toBe(105);
    expect(r.farOff).toBe(false);
    expect(r.explanation).not.toContain("Very different");
  });

  it("leaves out nights measured on too few homes", () => {
    const data = zone([100, 100, 100, 100, 100, 100, 100], 20);
    data.days = data.days.map((d) => (d.date.startsWith("2025-11") ? { ...d, comparables: 3, averagePrice: 999 } : d));
    const r = suggestBasePrice(data, CURRENT);
    if (!r.ok) throw new Error(r.explanation);
    expect(r.months.map((m) => m.month)).not.toContain("2025-11");
    expect(r.suggested).toBe(100);
    expect(r.differencePercent).toBe(0);
    expect(r.explanation).toContain("the same");
  });

  it("gives no suggestion with fewer than 6 months, and says why", () => {
    const r = suggestBasePrice(zone([100, 110, 120]), CURRENT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("too-few-months");
    expect(r.needed).toBe(6);
    expect(r.explanation).toBe(
      'No base price suggestion: zone "test-zone" has prices for 3 months, at least 6 are needed so that more than one season counts (invented test data, read 2026-10-15).',
    );
  });

  it("gives no suggestion without prices (occupancy only)", () => {
    const data: MarketData = { source: "csv", attribution: "invented", days: [{ date: "2026-11-01", occupancyPercent: 60 }] };
    const r = suggestBasePrice(data, CURRENT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no-prices");
    expect(r.explanation).toContain("the zone has no average prices");
  });

  it("names the comparable homes and says the data is estimated", () => {
    const r = suggestBasePrice(zone([90, 90, 90, 90, 90, 90], null, { estimated: true }), CURRENT, {
      comparableHomes: { bedrooms: 2, guests: 4, roomType: "Entire home/apt" },
    });
    if (!r.ok) throw new Error(r.explanation);
    expect(r.comparables).toBeUndefined();
    expect(r.explanation).toContain("the homes with 2 bedrooms, 4 guests, Entire home/apt");
    expect(r.explanation).toContain("invented test data, estimated");
    expect(r.differencePercent).toBe(-10);
  });

  it("describes the comparable homes", () => {
    expect(describeComparables(undefined)).toBe("");
    expect(describeComparables({ bedrooms: 1, guests: 1 })).toBe("1 bedroom, 1 guest");
    expect(describeComparables({ neighbourhood: "Costa Adeje" })).toBe("in Costa Adeje");
  });

  it("never changes the data it is given", () => {
    const data = zone([100, 100, 100, 100, 100, 100]);
    const before = JSON.stringify(data);
    suggestBasePrice(data, CURRENT);
    expect(JSON.stringify(data)).toBe(before);
  });
});
