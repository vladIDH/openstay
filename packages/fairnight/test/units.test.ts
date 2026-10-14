/**
 * Room types with several identical units (small hotels). All data invented:
 * a 14-room hotel with 6 doubles, 4 triples and 4 singles.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { priceListing, validateCalendar, validateListingConfig } from "../src/engine/index.js";
import type { ListingConfig, Stay } from "../src/engine/index.js";
import { factorsOf, nightOf, plainListing, quote, run, TODAY } from "./helpers.js";

/** Six doubles at one price. */
function doubles(factors: ListingConfig["factors"] = {}, units = 6): ListingConfig {
  return { ...plainListing(factors), listingId: "doppia", units };
}

/** `count` bookings of one room each, with no room number, from checkIn to checkOut. */
function rooms(count: number, checkIn: string, checkOut: string, kind: Stay["kind"] = "reservation"): Stay[] {
  return Array.from({ length: count }, () => ({ checkIn, checkOut, kind }));
}

describe("one unit stays exactly as before", () => {
  const listing = JSON.parse(readFileSync(new URL("../examples/annuncio-esempio.json", import.meta.url), "utf8"));
  const calendar = JSON.parse(readFileSync(new URL("../examples/prenotazioni-esempio.json", import.meta.url), "utf8"));

  it("units: 1 gives the same 365 nights as no units at all, without a units field", () => {
    const before = priceListing(listing, calendar, { today: "2026-11-01", days: 365 });
    const after = priceListing({ ...listing, units: 1 }, calendar, { today: "2026-11-01", days: 365 });
    expect(after).toEqual(before);
    expect(after.nights.some((n) => "units" in n)).toBe(false);
  });

  it("a home with two overlapping calendars is reserved, never overbooked", () => {
    const n = quote(plainListing(), "2026-11-10", [
      { checkIn: "2026-11-09", checkOut: "2026-11-12" },
      { checkIn: "2026-11-10", checkOut: "2026-11-11", kind: "blocked" },
    ]);
    expect(n.status).toBe("reserved");
    expect(n.units).toBeUndefined();
    expect(n.explanation).toBe("Tue 2026-11-10: not for sale (reserved).");
  });
});

describe("counting units", () => {
  it("a night with 4 of 6 doubles booked is still for sale and says so", () => {
    const n = quote(doubles(), "2026-11-10", rooms(4, "2026-11-10", "2026-11-11"));
    expect(n.status).toBe("available");
    expect(n.price).toBe(100);
    expect(n.units).toEqual({ total: 6, free: 2, reserved: 4, blocked: 0 });
    expect(n.explanation).toBe("Tue 2026-11-10 · 100 EUR (2 of 6 rooms free): base 100. Min stay 3 (default).");
  });

  it("a sold-out night is not for sale; with a block among them it is still reserved", () => {
    const stays = [...rooms(5, "2026-11-10", "2026-11-11"), ...rooms(1, "2026-11-10", "2026-11-11", "blocked")];
    const n = quote(doubles(), "2026-11-10", stays);
    expect(n.status).toBe("reserved");
    expect(n.price).toBeNull();
    expect(n.units).toEqual({ total: 6, free: 0, reserved: 5, blocked: 1 });
    expect(n.explanation).toBe("Tue 2026-11-10: not for sale (reserved, 0 of 6 rooms free).");
  });

  it("all units closed is blocked", () => {
    const n = quote(doubles({}, 4), "2026-11-10", rooms(4, "2026-11-10", "2026-11-11", "blocked"));
    expect(n.status).toBe("blocked");
  });

  it("the same room seen in two calendars counts once, and its booking wins over its block", () => {
    const n = quote(doubles(), "2026-11-10", [
      { checkIn: "2026-11-09", checkOut: "2026-11-12", unit: "101" },
      { checkIn: "2026-11-10", checkOut: "2026-11-11", kind: "blocked", unit: "101" },
      { checkIn: "2026-11-10", checkOut: "2026-11-11", unit: "102" },
    ]);
    expect(n.units).toEqual({ total: 6, free: 4, reserved: 2, blocked: 0 });
  });

  it("one booking of several rooms takes that many units", () => {
    const n = quote(doubles(), "2026-11-10", [{ checkIn: "2026-11-10", checkOut: "2026-11-12", units: 3 }]);
    expect(n.units?.free).toBe(3);
  });

  it("more bookings than rooms: 0 free, the overbooking is reported", () => {
    const n = quote(doubles(), "2026-11-10", rooms(7, "2026-11-10", "2026-11-11"));
    expect(n.units).toEqual({ total: 6, free: 0, reserved: 6, blocked: 0, overbooked: 1 });
  });
});

describe("occupancy in room-nights", () => {
  const occupancy = { enabled: true, highThresholdPercent: 60, raisePercent: 10, lowThresholdPercent: 20, lowerPercent: 10, withinDays: 60 };

  it("counts 4 of 6 rooms on every night as 66.7%, closed rooms left out", () => {
    // November from the 2nd: 29 nights × 4 rooms booked of 6, one room closed all month.
    const stays = [...rooms(4, "2026-11-02", "2026-12-01"), ...rooms(1, "2026-11-02", "2026-12-01", "blocked")];
    const n = quote(doubles({ occupancy }), "2026-11-20", stays);
    // 116 of 145 sellable room-nights = 80%.
    expect(n.steps[1]).toMatchObject({ factor: "occupancy", label: "busy month", note: "month 80% booked" });
  });

  it("a quiet month with a few rooms booked lowers the price", () => {
    const n = quote(doubles({ occupancy }), "2026-11-20", rooms(1, "2026-11-02", "2026-12-01"));
    expect(n.steps[1]).toMatchObject({ factor: "occupancy", label: "quiet month", note: "month 17% booked" });
  });
});

describe("gaps between sold-out nights", () => {
  const gaps = { enabled: true, maxNights: 3, discountPercent: 10, lowerMinStay: true };

  it("free rooms between two sold-out nights are a gap, and the min stay drops to fit it", () => {
    const stays = [...rooms(6, "2026-11-09", "2026-11-10"), ...rooms(6, "2026-11-12", "2026-11-13"), ...rooms(3, "2026-11-10", "2026-11-11")];
    const n = quote(doubles({ gaps }), "2026-11-10", stays);
    expect(n.steps[1]).toMatchObject({ factor: "gap", label: "gap of 2 nights", percent: -10 });
    expect(n.minStay).toBe(2);
    expect(n.minStaySource).toBe("gap");
  });

  it("a night next to a partly booked night is not a gap: a longer stay can still run across it", () => {
    const stays = [...rooms(6, "2026-11-09", "2026-11-10"), ...rooms(5, "2026-11-12", "2026-11-13")];
    const n = quote(doubles({ gaps }), "2026-11-10", stays);
    expect(factorsOf(n)).toEqual(["base"]);
    expect(n.minStay).toBe(3);
  });

  it("one room free between bookings of that same room is not a gap while other rooms are free", () => {
    const stays = [
      { checkIn: "2026-11-08", checkOut: "2026-11-10", unit: "101" },
      { checkIn: "2026-11-11", checkOut: "2026-11-14", unit: "101" },
    ];
    expect(factorsOf(quote(doubles({ gaps }), "2026-11-10", stays))).toEqual(["base"]);
  });
});

describe("last minute and stale calendar on residual rooms", () => {
  it("last minute applies while one room is still free", () => {
    const lastMinute = { enabled: true, steps: [{ withinDays: 3, discountPercent: 15 }] };
    const n = quote(doubles({ lastMinute }), TODAY, rooms(5, TODAY, "2026-11-03"));
    expect(n.price).toBe(85);
    expect(n.explanation).toContain("(1 of 6 rooms free)");
    expect(n.explanation).toContain("Weighed most: last minute (≤3 days) -15%.");
  });

  it("the stale-calendar discount applies to nights with free rooms only", () => {
    const staleCalendar = { enabled: true, afterDays: 14, stepPercent: 5, maxPercent: 15 };
    const r = priceListing(
      doubles({ staleCalendar }),
      { stays: rooms(6, "2026-11-03", "2026-11-04"), lastBookingReceived: "2026-10-10" },
      { today: TODAY, days: 3 },
    );
    expect(nightOf(r, TODAY).price).toBe(90);
    expect(nightOf(r, "2026-11-03").price).toBeNull();
  });
});

describe("few rooms left (scarcity)", () => {
  const scarcity = {
    enabled: true,
    steps: [
      { takenPercent: 50, raisePercent: 5 },
      { takenPercent: 70, raisePercent: 10 },
      { takenPercent: 85, raisePercent: 15 },
    ],
  };

  it("raises by the highest step reached", () => {
    expect(quote(doubles({ scarcity }), "2026-11-10", rooms(2, "2026-11-10", "2026-11-11")).price).toBe(100);
    expect(quote(doubles({ scarcity }), "2026-11-10", rooms(3, "2026-11-10", "2026-11-11")).price).toBe(105);
    const n = quote(doubles({ scarcity }), "2026-11-10", rooms(5, "2026-11-10", "2026-11-11"));
    // 5 of 6 taken is 83%: the 70% step, not yet the 85% one.
    expect(n.price).toBe(110);
    expect(n.steps[1]).toMatchObject({ factor: "scarcity", label: "few rooms left (≥70% taken)", note: "1 of 6 rooms free · 83% taken" });
    expect(n.explanation).toContain("Weighed most: few rooms left (≥70% taken) +10%.");
    expect(quote(doubles({ scarcity }), "2026-11-10", [...rooms(4, "2026-11-10", "2026-11-11"), ...rooms(1, "2026-11-10", "2026-11-11", "blocked")]).price).toBe(110);
  });

  it("a closed room counts as taken", () => {
    const stays = [...rooms(2, "2026-11-10", "2026-11-11"), ...rooms(1, "2026-11-10", "2026-11-11", "blocked")];
    expect(quote(doubles({ scarcity }), "2026-11-10", stays).price).toBe(105);
  });

  it("never goes above maxRaisePercent (default 20)", () => {
    const steep = { enabled: true, steps: [{ takenPercent: 50, raisePercent: 40 }] };
    const n = quote(doubles({ scarcity: steep }), "2026-11-10", rooms(3, "2026-11-10", "2026-11-11"));
    expect(n.price).toBe(120);
    expect(n.steps[1]?.note).toBe("3 of 6 rooms free · 50% taken · capped at +20%");
    const capped = quote(doubles({ scarcity: { ...steep, maxRaisePercent: 10 } }), "2026-11-10", rooms(3, "2026-11-10", "2026-11-11"));
    expect(capped.price).toBe(110);
  });

  it("does nothing for a home, even when switched on", () => {
    const n = quote(plainListing({ scarcity }), "2026-11-10");
    expect(factorsOf(n)).toEqual(["base"]);
  });

  it("is off when not configured", () => {
    expect(quote(doubles(), "2026-11-10", rooms(5, "2026-11-10", "2026-11-11")).price).toBe(100);
  });
});

describe("the 14-room example hotel", () => {
  it("prices three room types on their own rooms", () => {
    const night = "2026-11-14";
    const types = [
      { listing: { ...doubles(), listingId: "doppia", units: 6, basePrice: 95 }, booked: 3 },
      { listing: { ...doubles(), listingId: "tripla", units: 4, basePrice: 120 }, booked: 4 },
      { listing: { ...doubles(), listingId: "singola", units: 4, basePrice: 70 }, booked: 1 },
    ];
    const out = types.map(({ listing, booked }) => nightOf(run(listing, rooms(booked, night, "2026-11-15"), 20), night));
    expect(out.map((n) => [n.status, n.units?.free])).toEqual([
      ["available", 3],
      ["reserved", 0],
      ["available", 3],
    ]);
  });
});

describe("validation", () => {
  it("units must be a whole number from 1 to 99", () => {
    for (const bad of [0, 1.5, 100]) {
      const r = validateListingConfig({ ...plainListing(), units: bad });
      expect(r.ok).toBe(false);
    }
    expect(validateListingConfig({ ...plainListing(), units: 99 }).ok).toBe(true);
  });

  it("a stay sets unit or units, not both", () => {
    const r = validateCalendar({ stays: [{ checkIn: "2026-11-01", checkOut: "2026-11-02", unit: "101", units: 2 }, { checkIn: "2026-11-01", checkOut: "2026-11-02", unit: "" }] });
    expect(r.ok ? [] : r.issues.map((i) => i.path)).toEqual(["calendar.stays[0]", "calendar.stays[1].unit"]);
  });

  it("scarcity steps are checked and sorted", () => {
    const bad = validateListingConfig(
      plainListing({ scarcity: { enabled: true, steps: [{ takenPercent: 0, raisePercent: 5 }, { takenPercent: 60, raisePercent: 120 }], maxRaisePercent: 200 } }),
    );
    expect(bad.ok ? [] : bad.issues.map((i) => i.path)).toEqual([
      "listing.factors.scarcity.maxRaisePercent",
      "listing.factors.scarcity.steps[0].takenPercent",
      "listing.factors.scarcity.steps[1].raisePercent",
    ]);
    const good = validateListingConfig(plainListing({ scarcity: { enabled: true, steps: [{ takenPercent: 80, raisePercent: 10 }, { takenPercent: 50, raisePercent: 5 }] } }));
    expect(good.ok && good.value.factors.scarcity).toEqual({
      enabled: true,
      steps: [
        { takenPercent: 50, raisePercent: 5 },
        { takenPercent: 80, raisePercent: 10 },
      ],
      maxRaisePercent: 20,
    });
  });
});
