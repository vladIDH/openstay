import { describe, expect, it } from "vitest";
import { priceListing, validateCalendar, validateListingConfig } from "../src/engine/index.js";
import type { ListingCalendar, ListingConfig, NightQuote } from "../src/engine/index.js";
import { plainListing, TODAY } from "./helpers.js";

function night(listing: ListingConfig, calendar: ListingCalendar, date: string, today = TODAY): NightQuote {
  const r = priceListing(listing, calendar, { today, days: 120 });
  const n = r.nights.find((x) => x.date === date);
  if (!n) throw new Error(`no ${date}`);
  return n;
}

/** Ten sold nights in November 2025, average 150. */
const NOVEMBER_2025 = Array.from({ length: 10 }, (_, i) => ({
  date: `2025-11-${String(i + 1).padStart(2, "0")}`,
  price: i % 2 === 0 ? 140 : 160,
}));

describe("historical floor", () => {
  const listing = plainListing({
    dayOfWeek: { enabled: true, adjustments: { mon: -40 } },
    historicalFloor: { enabled: true, percent: 80 },
  });

  it("keeps the price above a share of last year's average for the same month", () => {
    // Monday 2026-11-02: 100 - 40% = 60, floor = 80% of 150 = 120.
    const n = night(listing, { stays: [], priceHistory: NOVEMBER_2025 }, "2026-11-02");
    expect(n.price).toBe(120);
    expect(n.steps.at(-1)).toMatchObject({
      factor: "historicalFloor",
      before: 60,
      after: 120,
      note: "80% of the 2025-11 average of 150 over 10 sold nights",
    });
  });

  it("does nothing when the price is already above it", () => {
    // Floor at 60% of 150 = 90; Tuesday stays at 100.
    const low = plainListing({ historicalFloor: { enabled: true, percent: 60 } });
    const n = night(low, { stays: [], priceHistory: NOVEMBER_2025 }, "2026-11-03");
    expect(n.price).toBe(100);
    expect(n.steps.map((s) => s.factor)).toEqual(["base"]);
  });

  it("needs history for that very month, with enough nights", () => {
    // December 2026: no December 2025 history.
    expect(night(listing, { stays: [], priceHistory: NOVEMBER_2025 }, "2026-12-07").price).toBe(60);
    const thin = NOVEMBER_2025.slice(0, 2);
    expect(night(listing, { stays: [], priceHistory: thin }, "2026-11-02").price).toBe(60);
    const strict = plainListing({ ...listing.factors, historicalFloor: { enabled: true, percent: 80, minNights: 2 } });
    expect(night(strict, { stays: [], priceHistory: thin }, "2026-11-02").price).toBe(120);
  });

  it("counts a night once if it appears twice in the history", () => {
    const dup = [...NOVEMBER_2025, { date: "2025-11-01", price: 1000 }];
    // 2025-11-01 now sold at 1000 instead of 140: (1500 - 140 + 1000) / 10 = 236.
    const n = night(listing, { stays: [], priceHistory: dup }, "2026-11-02");
    expect(n.steps.at(-1)?.note).toBe("80% of the 2025-11 average of 236 over 10 sold nights");
  });

  it("is beaten by the ceiling and by a date override", () => {
    const capped = plainListing({
      ...listing.factors,
      limits: { enabled: true, floorPrice: 50, ceilingPrice: 110 },
      overrides: { enabled: true, dates: [{ date: "2026-11-09", price: 70 }] },
    });
    expect(night(capped, { stays: [], priceHistory: NOVEMBER_2025 }, "2026-11-02").price).toBe(110);
    expect(night(capped, { stays: [], priceHistory: NOVEMBER_2025 }, "2026-11-09").price).toBe(70);
  });

  it("is off by default", () => {
    expect(night(plainListing({ dayOfWeek: { enabled: true, adjustments: { mon: -40 } } }), { stays: [], priceHistory: NOVEMBER_2025 }, "2026-11-02").price).toBe(60);
  });
});

describe("stale calendar", () => {
  const staleCalendar = { enabled: true, afterDays: 14, stepPercent: 5, everyDays: 7, maxPercent: 15, withinDays: 10 };
  const listing = plainListing({ staleCalendar });
  const since = (lastBookingReceived: string): ListingCalendar => ({ stays: [], lastBookingReceived });

  it("starts after N days without new bookings", () => {
    expect(night(listing, since("2026-10-20"), TODAY).price).toBe(100); // 13 days
    const n = night(listing, since("2026-10-19"), TODAY); // 14 days
    expect(n.price).toBe(95);
    expect(n.steps[1]).toMatchObject({ factor: "staleCalendar", label: "no new bookings", percent: -5, note: "14 days since the last new booking" });
  });

  it("grows step by step up to its cap", () => {
    expect(night(listing, since("2026-10-12"), TODAY).price).toBe(90); // 21 days: 2 steps
    expect(night(listing, since("2026-10-05"), TODAY).price).toBe(85); // 28 days: 3 steps
    expect(night(listing, since("2026-07-01"), TODAY).price).toBe(85); // capped at 15%
  });

  it("only touches the next withinDays nights", () => {
    expect(night(listing, since("2026-10-19"), "2026-11-12").price).toBe(95); // 10 days ahead
    expect(night(listing, since("2026-10-19"), "2026-11-13").price).toBe(100); // 11 days ahead
  });

  it("goes back to zero when a new booking arrives", () => {
    expect(night(listing, since(TODAY), TODAY).price).toBe(100);
  });

  it("does nothing when the date of the last booking is unknown, or when off", () => {
    expect(night(listing, { stays: [] }, TODAY).price).toBe(100);
    expect(night(plainListing(), since("2026-01-01"), TODAY).price).toBe(100);
  });

  it("uses the default step interval and window", () => {
    const r = validateListingConfig(plainListing({ staleCalendar: { enabled: true, afterDays: 10, stepPercent: 3, maxPercent: 9 } }));
    expect(r.ok && r.value.factors.staleCalendar).toEqual({ enabled: true, afterDays: 10, stepPercent: 3, maxPercent: 9, everyDays: 7, withinDays: 30 });
    const h = validateListingConfig(plainListing({ historicalFloor: { enabled: true, percent: 70 } }));
    expect(h.ok && h.value.factors.historicalFloor?.minNights).toBe(3);
  });
});

describe("validation of the new inputs", () => {
  it("checks both factors", () => {
    const r = validateListingConfig(
      plainListing({
        staleCalendar: { enabled: true, afterDays: 0, stepPercent: 20, maxPercent: 10, everyDays: 0, withinDays: -1 },
        historicalFloor: { enabled: true, percent: 0, minNights: 40 },
      }),
    );
    expect(r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      "listing.factors.staleCalendar.afterDays: must be at least 1, got 0",
      "listing.factors.staleCalendar.everyDays: must be at least 1, got 0",
      "listing.factors.staleCalendar.withinDays: must be at least 0, got -1",
      "listing.factors.staleCalendar: stepPercent must not be higher than maxPercent",
      "listing.factors.historicalFloor.percent: must be greater than 0, got 0",
      "listing.factors.historicalFloor.minNights: must be at most 31, got 40",
    ]);
  });

  it("checks the price history and the last booking date", () => {
    const r = validateCalendar({ stays: [], priceHistory: [{ date: "2025-13-01", price: 0 }, "x"], lastBookingReceived: "yesterday" });
    expect(r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      'calendar.lastBookingReceived: must be a date like 2026-12-31, got "yesterday"',
      'calendar.priceHistory[0].date: must be a date like 2026-12-31, got "2025-13-01"',
      "calendar.priceHistory[0].price: must be greater than 0, got 0",
      'calendar.priceHistory[1]: must be an object, got "x"',
    ]);
    expect(validateCalendar({ stays: [], priceHistory: "x" }).ok).toBe(false);
  });
});
