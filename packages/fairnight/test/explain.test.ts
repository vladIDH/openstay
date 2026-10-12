import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatAmount, priceListing } from "../src/engine/index.js";
import { plainListing, quote, run } from "./helpers.js";

const listing = JSON.parse(readFileSync(new URL("../examples/annuncio-esempio.json", import.meta.url), "utf8"));
const calendar = JSON.parse(readFileSync(new URL("../examples/prenotazioni-esempio.json", import.meta.url), "utf8"));

describe("explanation", () => {
  it("lists every factor with its contribution", () => {
    const n = quote(
      plainListing({
        limits: { enabled: true, floorPrice: 60, ceilingPrice: 250 },
        seasons: { enabled: true, periods: [{ name: "High season", start: "11-01", end: "11-30", multiplier: 1.15 }] },
        lastMinute: { enabled: true, steps: [{ withinDays: 7, discountPercent: 5, minStay: 2 }] },
        rounding: { enabled: true, step: 1 },
      }),
      "2026-11-07",
    );
    expect(n.explanation).toBe(
      'Sat 2026-11-07 · 109 EUR: base 100 → season "High season" +15% = 115 → last minute (≤7 days) -5% = 109.25 (5 days ahead)' +
        " → within floor 60 and ceiling 250 → rounded to 1 = 109. Min stay 2 (last minute).",
    );
    // Every step starts where the previous one ended.
    for (let i = 1; i < n.steps.length; i++) expect(n.steps[i]?.before).toBe(n.steps[i - 1]?.after);
  });

  it("explains nights that are not for sale", () => {
    const r = run(plainListing(), [{ checkIn: "2026-11-02", checkOut: "2026-11-03" }], 1);
    expect(r.nights[0]?.explanation).toBe("Mon 2026-11-02: not for sale (reserved).");
  });

  it("names the minimum-stay rule", () => {
    const gaps = { enabled: true, maxNights: 1, discountPercent: 10, lowerMinStay: true };
    const stays = [
      { checkIn: "2026-11-01", checkOut: "2026-11-05" },
      { checkIn: "2026-11-06", checkOut: "2026-11-08" },
    ];
    expect(quote(plainListing({ gaps }), "2026-11-05", stays).explanation).toBe(
      "Thu 2026-11-05 · 90 EUR: base 100 → gap of 1 night -10% = 90. Min stay 1 (lowered to fill the gap).",
    );
    const fixed = plainListing({ overrides: { enabled: true, dates: [{ date: "2026-11-10", price: 150, minStay: 2, note: "by hand" }] } });
    expect(quote(fixed, "2026-11-10").explanation).toBe(
      "Tue 2026-11-10 · 150 EUR: base 100 → date override = 150 (by hand). Min stay 2 (date override).",
    );
  });

  it("formats amounts with at most two decimals", () => {
    expect(formatAmount(100)).toBe("100");
    expect(formatAmount(109.25)).toBe("109.25");
    expect(formatAmount(99.5)).toBe("99.50");
  });
});

describe("determinism", () => {
  it("gives the same result for the same input and never changes the input", () => {
    const before = JSON.stringify({ listing, calendar });
    const a = priceListing(listing, calendar, { today: "2026-11-01", days: 365 });
    const b = priceListing(structuredClone(listing), structuredClone(calendar), { today: "2026-11-01", days: 365 });
    expect(a).toEqual(b);
    expect(JSON.stringify({ listing, calendar })).toBe(before);
  });

  it("does not depend on the order of stays or events", () => {
    const shuffled = structuredClone(listing);
    shuffled.factors.events.list.reverse();
    const reversedCalendar = { ...calendar, stays: [...calendar.stays].reverse(), priceHistory: [...calendar.priceHistory].reverse() };
    expect(priceListing(shuffled, reversedCalendar, { today: "2026-11-01", days: 365 })).toEqual(
      priceListing(listing, calendar, { today: "2026-11-01", days: 365 }),
    );
  });
});
