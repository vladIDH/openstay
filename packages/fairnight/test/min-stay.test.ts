import { describe, expect, it } from "vitest";
import { plainListing, quote } from "./helpers.js";
import type { ListingConfig } from "../src/engine/index.js";

// Today is Monday 2026-11-02.
function listing(extra: ListingConfig["factors"] = {}): ListingConfig {
  return plainListing({
    lastMinute: { enabled: true, steps: [{ withinDays: 10, discountPercent: 0, minStay: 2 }] },
    farOut: { enabled: true, steps: [{ fromDays: 5, premiumPercent: 0, minStay: 6 }] },
    gaps: { enabled: true, maxNights: 3, discountPercent: 0, lowerMinStay: true },
    overrides: {
      enabled: true,
      dates: [
        { date: "2026-11-09", minStay: 4 },
        { date: "2026-11-20", price: 99 },
      ],
    },
    ...extra,
  });
}

describe("minimum stay precedence", () => {
  it("uses the default when no rule applies", () => {
    const n = quote(plainListing(), "2026-11-04");
    expect(n).toMatchObject({ minStay: 3, minStaySource: "default" });
  });

  it("uses the last-minute step close to the date", () => {
    const n = quote(listing({ farOut: { enabled: false, steps: [] } }), "2026-11-04");
    expect(n).toMatchObject({ minStay: 2, minStaySource: "lastMinute" });
  });

  it("puts far out before last minute when both cover the night", () => {
    // 5 days ahead: inside last minute (≤10) and far out (≥5).
    const n = quote(listing(), "2026-11-07");
    expect(n).toMatchObject({ minStay: 6, minStaySource: "farOut" });
  });

  it("falls back to last minute when the far-out step has no minimum", () => {
    const n = quote(
      listing({ farOut: { enabled: true, steps: [{ fromDays: 5, premiumPercent: 0 }] } }),
      "2026-11-07",
    );
    expect(n).toMatchObject({ minStay: 2, minStaySource: "lastMinute" });
  });

  it("puts a date override before everything", () => {
    const n = quote(listing(), "2026-11-09");
    expect(n).toMatchObject({ minStay: 4, minStaySource: "override" });
  });

  it("does not let a price-only override touch the minimum", () => {
    const n = quote(listing(), "2026-11-20");
    expect(n).toMatchObject({ price: 99, minStay: 6, minStaySource: "farOut" });
  });

  it("lets the gap rule win only when it lowers the minimum", () => {
    const stays = [
      { checkIn: "2026-11-01", checkOut: "2026-11-12" },
      { checkIn: "2026-11-14", checkOut: "2026-11-20" }, // gap: 11-12, 11-13
      { checkIn: "2026-11-23", checkOut: "2026-11-28" }, // gap: 11-20..11-22
    ];
    expect(quote(listing(), "2026-11-12", stays)).toMatchObject({ minStay: 2, minStaySource: "gap" });
    // A 3-night gap against a minimum of 2 (last minute): the gap would raise it, so it does not apply.
    const lm = listing({ farOut: { enabled: false, steps: [] }, lastMinute: { enabled: true, steps: [{ withinDays: 30, discountPercent: 0, minStay: 2 }] } });
    expect(quote(lm, "2026-11-21", stays)).toMatchObject({ minStay: 2, minStaySource: "lastMinute" });
  });

  it("never lowers a minimum set by a date override", () => {
    const stays = [
      { checkIn: "2026-11-01", checkOut: "2026-11-09" },
      { checkIn: "2026-11-10", checkOut: "2026-11-15" }, // 1-night gap on 11-09, which has an override of 4
    ];
    expect(quote(listing(), "2026-11-09", stays)).toMatchObject({ minStay: 4, minStaySource: "override" });
  });
});
