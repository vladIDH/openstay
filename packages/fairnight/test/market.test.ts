import { describe, expect, it } from "vitest";
import { priceListing, validateCalendar, validateListingConfig } from "../src/engine/index.js";
import type { ListingConfig, MarketData, MarketDay, NightQuote } from "../src/engine/index.js";
import { plainListing, TODAY } from "./helpers.js";

/** Invented zone: 60% booked every night of November 2026, except the nights given. */
function zone(overrides: Record<string, Partial<MarketDay>> = {}, extra: Partial<MarketData> = {}): MarketData {
  const days: MarketDay[] = Array.from({ length: 30 }, (_, i) => {
    const date = `2026-11-${String(i + 1).padStart(2, "0")}`;
    return { date, occupancyPercent: 60, averagePrice: 100, comparables: 20, ...overrides[date] };
  });
  return { source: "csv", attribution: "invented test data", area: "test-zone", readOn: "2026-11-01", days, ...extra };
}

function night(listing: ListingConfig, market: MarketData | undefined, date: string): NightQuote {
  const r = priceListing(listing, market ? { stays: [], market } : { stays: [] }, { today: TODAY, days: 60 });
  const n = r.nights.find((x) => x.date === date);
  if (!n) throw new Error(`no ${date}`);
  return n;
}

const ON = plainListing({ market: { enabled: true } });

describe("market factor (zone demand)", () => {
  it("is off unless switched on for the listing", () => {
    const busy = zone({ "2026-11-10": { occupancyPercent: 90 } });
    expect(night(plainListing(), busy, "2026-11-10").price).toBe(100);
    expect(night(plainListing({ market: { enabled: false } }), busy, "2026-11-10").price).toBe(100);
  });

  it("does nothing without zone data", () => {
    expect(night(ON, undefined, "2026-11-10").steps.map((s) => s.factor)).toEqual(["base"]);
  });

  it("raises the price by half of the zone's difference from its average", () => {
    // 29 nights at 60% and one at 72%: average 60.4, difference +19.2%, half of it +9.6%.
    const n = night(ON, zone({ "2026-11-10": { occupancyPercent: 72 } }), "2026-11-10");
    const step = n.steps.find((s) => s.factor === "market");
    expect(step?.percent).toBe(9.6);
    expect(n.price).toBe(109.6);
    expect(step?.label).toBe('zone demand "test-zone"');
    expect(step?.note).toBe("zone 72% booked vs 60.4% average · 20 comparable listings · invented test data · read 2026-11-01");
    expect(n.explanation).toContain('zone demand "test-zone" +9.60% = 109.60 (zone 72% booked vs 60.4% average');
  });

  it("caps the raise at 15% and the cut at 10% by default", () => {
    const busy = night(ON, zone({ "2026-11-10": { occupancyPercent: 100 } }), "2026-11-10");
    expect(busy.price).toBe(115);
    expect(busy.steps.find((s) => s.factor === "market")?.note).toContain("capped at +15%");
    const quiet = night(ON, zone({ "2026-11-10": { occupancyPercent: 5 } }), "2026-11-10");
    expect(quiet.price).toBe(90);
    expect(quiet.steps.find((s) => s.factor === "market")?.note).toContain("capped at -10%");
  });

  it("ignores small differences below the thresholds", () => {
    // 64% vs about 60.1%: +6.4%, under the 10% threshold.
    expect(night(ON, zone({ "2026-11-10": { occupancyPercent: 64 } }), "2026-11-10").price).toBe(100);
    const sensitive = plainListing({ market: { enabled: true, highPercent: 5 } });
    expect(night(sensitive, zone({ "2026-11-10": { occupancyPercent: 64 } }), "2026-11-10").price).toBeGreaterThan(100);
  });

  it("follows the weight and the caps of the listing", () => {
    const full = plainListing({ market: { enabled: true, weight: 1, maxRaisePercent: 50 } });
    // 29 × 60 + 90 = 1830 / 30 = 61 → +47.54%.
    expect(night(full, zone({ "2026-11-10": { occupancyPercent: 90 } }), "2026-11-10").steps.find((s) => s.factor === "market")?.percent).toBe(47.54);
    const none = plainListing({ market: { enabled: true, weight: 0 } });
    expect(night(none, zone({ "2026-11-10": { occupancyPercent: 90 } }), "2026-11-10").price).toBe(100);
  });

  it("uses the zone price when the night has no occupancy", () => {
    const n = night(ON, zone({ "2026-11-10": { occupancyPercent: undefined, averagePrice: 130 } }), "2026-11-10");
    const step = n.steps.find((s) => s.factor === "market");
    expect(step?.note?.startsWith("zone price 130 vs 101 average")).toBe(true);
    expect(step?.percent).toBe(14.36);
  });

  it("skips nights measured on too few comparable listings", () => {
    const thin = zone({ "2026-11-10": { occupancyPercent: 95, comparables: 3 } });
    expect(night(ON, thin, "2026-11-10").price).toBe(100);
    const lenient = plainListing({ market: { enabled: true, minComparables: 2 } });
    expect(night(lenient, thin, "2026-11-10").price).toBeGreaterThan(100);
  });

  it("says when the occupancy is an estimate", () => {
    const n = night(ON, zone({ "2026-11-10": { occupancyPercent: 90 } }, { attribution: "Inside Airbnb (insideairbnb.com), CC BY 4.0", estimated: true }), "2026-11-10");
    expect(n.steps.find((s) => s.factor === "market")?.note).toContain("Inside Airbnb (insideairbnb.com), CC BY 4.0, occupancy estimated");
  });

  it("only adjusts nights within withinDays", () => {
    const near = plainListing({ market: { enabled: true, withinDays: 5 } });
    expect(night(near, zone({ "2026-11-10": { occupancyPercent: 90 } }), "2026-11-10").price).toBe(100);
  });

  it("comes after occupancy and before the floor and ceiling", () => {
    const listing = plainListing({
      market: { enabled: true },
      limits: { enabled: true, floorPrice: 50, ceilingPrice: 110 },
    });
    const n = night(listing, zone({ "2026-11-10": { occupancyPercent: 100 } }), "2026-11-10");
    expect(n.steps.map((s) => s.factor)).toEqual(["base", "market", "limits"]);
    expect(n.price).toBe(110);
  });
});

describe("market validation", () => {
  it("fills prudent defaults", () => {
    const r = validateListingConfig(ON);
    expect(r.ok && r.value.factors.market).toEqual({
      enabled: true,
      weight: 0.5,
      highPercent: 10,
      lowPercent: 10,
      maxRaisePercent: 15,
      maxLowerPercent: 10,
      withinDays: 365,
      minComparables: 5,
    });
  });

  it("rejects bad factor settings", () => {
    const r = validateListingConfig(plainListing({ market: { enabled: true, weight: 2, maxLowerPercent: 95 } as never }));
    expect(r.ok ? [] : r.issues.map((i) => i.path)).toEqual(["listing.factors.market.weight", "listing.factors.market.maxLowerPercent"]);
  });

  it("checks the zone data", () => {
    const r = validateCalendar({
      stays: [],
      market: {
        source: "csv",
        attribution: "x",
        days: [
          { date: "2026-11-01", occupancyPercent: 120 },
          { date: "2026-11-01", averagePrice: 90 },
          { date: "2026-11-02" },
        ],
      },
    });
    expect(r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      "calendar.market.days[0].occupancyPercent: must be at most 100, got 120",
      "calendar.market.days[1].date: 2026-11-01 appears twice",
      "calendar.market.days[2]: set occupancyPercent, averagePrice or both",
    ]);
  });

  it("does not change the input", () => {
    const market = zone();
    const copy = JSON.parse(JSON.stringify(market));
    priceListing(ON, { stays: [], market }, { today: TODAY, days: 30 });
    expect(market).toEqual(copy);
  });
});
