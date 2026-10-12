import { describe, expect, it } from "vitest";
import { factorsOf, nightOf, plainListing, quote, run, TODAY } from "./helpers.js";

describe("base price", () => {
  it("prices every night at the base when no factor is on", () => {
    const r = run(plainListing(), [], 10);
    expect(r.nights).toHaveLength(10);
    expect(r.nights[0]?.date).toBe(TODAY);
    expect(r.nights.every((n) => n.price === 100 && n.minStay === 3)).toBe(true);
    expect(r.nights[0]?.steps.map((s) => s.factor)).toEqual(["base"]);
  });

  it("knows the weekday of each night", () => {
    const r = run(plainListing(), [], 7);
    expect(r.nights.map((n) => n.weekday)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  });
});

describe("floor and ceiling", () => {
  it("raises a price below the floor", () => {
    const n = quote(
      plainListing({
        limits: { enabled: true, floorPrice: 90, ceilingPrice: 200 },
        dayOfWeek: { enabled: true, adjustments: { mon: -50 } },
      }),
      TODAY,
    );
    expect(n.price).toBe(90);
    expect(n.steps.at(-1)).toMatchObject({ factor: "limits", label: "floor", before: 50, after: 90 });
  });

  it("lowers a price above the ceiling", () => {
    const n = quote(
      plainListing({
        limits: { enabled: true, floorPrice: 50, ceilingPrice: 120 },
        dayOfWeek: { enabled: true, adjustments: { mon: 50 } },
      }),
      TODAY,
    );
    expect(n.price).toBe(120);
    expect(n.steps.at(-1)).toMatchObject({ label: "ceiling", before: 150, after: 120 });
  });

  it("says when the price is within the limits", () => {
    const n = quote(plainListing({ limits: { enabled: true, floorPrice: 50, ceilingPrice: 200 } }), TODAY);
    expect(n.price).toBe(100);
    expect(n.steps.at(-1)?.note).toBe("within floor 50 and ceiling 200");
  });

  it("does nothing when switched off", () => {
    const n = quote(
      plainListing({
        limits: { enabled: false, floorPrice: 150, ceilingPrice: 200 },
      }),
      TODAY,
    );
    expect(n.price).toBe(100);
    expect(factorsOf(n)).toEqual(["base"]);
  });
});

describe("seasons", () => {
  const seasons = {
    enabled: true,
    periods: [
      { name: "Holidays", start: "12-20", end: "01-06", multiplier: 1.3 },
      { name: "Fixed week", start: "11-09", end: "11-15", fixedPrice: 77 },
      { name: "November", start: "11-01", end: "11-30", multiplier: 0.9 },
    ],
  };

  it("applies a multiplier", () => {
    const n = quote(plainListing({ seasons }), "2026-11-20");
    expect(n.price).toBe(90);
    expect(n.steps[1]).toMatchObject({ factor: "season", label: 'season "November"', percent: -10 });
  });

  it("applies a fixed price", () => {
    const n = quote(plainListing({ seasons }), "2026-11-10");
    expect(n.price).toBe(77);
    expect(n.steps[1]?.note).toBe("fixed price");
  });

  it("uses the first matching period", () => {
    // 11-10 is inside both "Fixed week" and "November": the earlier one wins.
    expect(quote(plainListing({ seasons }), "2026-11-12").price).toBe(77);
  });

  it("handles periods that wrap the new year", () => {
    expect(quote(plainListing({ seasons }), "2026-12-31").price).toBe(130);
    expect(quote(plainListing({ seasons }), "2027-01-06").price).toBe(130);
    expect(quote(plainListing({ seasons }), "2027-01-07").price).toBe(100);
  });

  it("leaves nights outside every period alone", () => {
    expect(factorsOf(quote(plainListing({ seasons }), "2027-03-01"))).toEqual(["base"]);
  });
});

describe("day of week", () => {
  it("adds the percentage of the weekday", () => {
    const listing = plainListing({ dayOfWeek: { enabled: true, adjustments: { sat: 20, sun: -10 } } });
    expect(quote(listing, "2026-11-07").price).toBe(120);
    expect(quote(listing, "2026-11-08").price).toBe(90);
    expect(factorsOf(quote(listing, "2026-11-04"))).toEqual(["base"]);
  });
});

describe("last minute", () => {
  const lastMinute = {
    enabled: true,
    steps: [
      { withinDays: 7, discountPercent: 10 },
      { withinDays: 2, discountPercent: 20 },
    ],
  };

  it("uses the tightest step that covers the night", () => {
    const listing = plainListing({ lastMinute });
    expect(quote(listing, "2026-11-02").price).toBe(80); // 0 days ahead
    expect(quote(listing, "2026-11-04").price).toBe(80); // 2 days ahead
    expect(quote(listing, "2026-11-05").price).toBe(90); // 3 days ahead
    expect(quote(listing, "2026-11-09").price).toBe(90); // 7 days ahead
    expect(quote(listing, "2026-11-10").price).toBe(100); // 8 days ahead
  });

  it("explains how far ahead the night is", () => {
    const n = quote(plainListing({ lastMinute }), "2026-11-05");
    expect(n.steps[1]).toMatchObject({ factor: "lastMinute", label: "last minute (≤7 days)", percent: -10, note: "3 days ahead" });
    expect(quote(plainListing({ lastMinute }), "2026-11-03").steps[1]?.note).toBe("1 day ahead");
  });
});

describe("far out", () => {
  it("adds the premium of the farthest step reached", () => {
    const listing = plainListing({
      farOut: {
        enabled: true,
        steps: [
          { fromDays: 100, premiumPercent: 5 },
          { fromDays: 200, premiumPercent: 10 },
        ],
      },
    });
    expect(quote(listing, "2027-02-09").price).toBe(100); // 99 days
    expect(quote(listing, "2027-02-10").price).toBe(105); // 100 days
    expect(quote(listing, "2027-05-21").price).toBe(110); // 200 days
  });
});

describe("gaps between stays", () => {
  const gaps = { enabled: true, maxNights: 2, discountPercent: 10, lowerMinStay: true };
  const stays = [
    { checkIn: "2026-11-01", checkOut: "2026-11-05" },
    { checkIn: "2026-11-06", checkOut: "2026-11-08" }, // 1-night gap: 11-05
    { checkIn: "2026-11-10", checkOut: "2026-11-12" }, // 2-night gap: 11-08, 11-09
    { checkIn: "2026-11-15", checkOut: "2026-11-20" }, // 3-night gap: 11-12..11-14
  ];

  it("discounts a one-night gap and lowers the minimum to 1", () => {
    const n = quote(plainListing({ gaps }), "2026-11-05", stays);
    expect(n.price).toBe(90);
    expect(n.steps[1]?.label).toBe("gap of 1 night");
    expect(n).toMatchObject({ minStay: 1, minStaySource: "gap" });
  });

  it("discounts both nights of a two-night gap and lowers the minimum to 2", () => {
    for (const date of ["2026-11-08", "2026-11-09"]) {
      const n = quote(plainListing({ gaps }), date, stays);
      expect(n.price).toBe(90);
      expect(n.steps[1]?.label).toBe("gap of 2 nights");
      expect(n).toMatchObject({ minStay: 2, minStaySource: "gap" });
    }
  });

  it("ignores free stretches longer than maxNights", () => {
    const n = quote(plainListing({ gaps }), "2026-11-13", stays);
    expect(n.price).toBe(100);
    expect(n.minStaySource).toBe("default");
  });

  it("needs a stay on both sides", () => {
    // 11-20 onwards is open-ended: not a gap.
    expect(quote(plainListing({ gaps }), "2026-11-20", stays).price).toBe(100);
  });

  it("treats blocked nights as occupied", () => {
    const blocked = [
      { checkIn: "2026-11-01", checkOut: "2026-11-05", kind: "blocked" as const },
      { checkIn: "2026-11-06", checkOut: "2026-11-08" },
    ];
    expect(quote(plainListing({ gaps }), "2026-11-05", blocked).price).toBe(90);
  });

  it("does not raise the minimum when the gap is longer than it", () => {
    const listing = { ...plainListing({ gaps }), defaultMinStay: 1 };
    const n = quote(listing, "2026-11-08", stays);
    expect(n).toMatchObject({ minStay: 1, minStaySource: "default" });
  });

  it("can keep the minimum stay untouched", () => {
    const n = quote(plainListing({ gaps: { ...gaps, lowerMinStay: false } }), "2026-11-05", stays);
    expect(n.price).toBe(90);
    expect(n.minStay).toBe(3);
  });

  it("can lower the minimum without a discount", () => {
    const n = quote(plainListing({ gaps: { ...gaps, discountPercent: 0 } }), "2026-11-05", stays);
    expect(factorsOf(n)).toEqual(["base"]);
    expect(n.minStay).toBe(1);
  });
});

describe("occupancy of the month", () => {
  const occupancy = { enabled: true, highThresholdPercent: 70, raisePercent: 10, lowThresholdPercent: 20, lowerPercent: 5 };

  it("raises prices in a busy month", () => {
    // From 11-02 to 11-30 there are 29 sellable nights; 22 reserved = 76%.
    const stays = [{ checkIn: "2026-11-02", checkOut: "2026-11-24" }];
    const n = quote(plainListing({ occupancy }), "2026-11-26", stays);
    expect(n.price).toBe(110);
    expect(n.steps[1]).toMatchObject({ label: "busy month", note: "month 76% booked" });
  });

  it("lowers prices in a quiet month", () => {
    const n = quote(plainListing({ occupancy }), "2026-11-26");
    expect(n.price).toBe(95);
    expect(n.steps[1]?.label).toBe("quiet month");
  });

  it("leaves a month in between alone", () => {
    const stays = [{ checkIn: "2026-11-02", checkOut: "2026-11-15" }];
    expect(quote(plainListing({ occupancy }), "2026-11-26", stays).price).toBe(100);
  });

  it("only counts nights from today and ignores blocked nights", () => {
    const stays = [
      { checkIn: "2026-10-20", checkOut: "2026-11-02" }, // past: not counted
      { checkIn: "2026-11-02", checkOut: "2026-11-25", kind: "blocked" as const },
      { checkIn: "2026-11-25", checkOut: "2026-11-30" },
    ];
    // Sellable from 11-02: only 11-25..11-30 (6 nights), 5 reserved = 83%.
    expect(quote(plainListing({ occupancy }), "2026-11-30", stays).price).toBe(110);
  });

  it("only adjusts nights inside its window, so empty far months are not discounted", () => {
    // Default window: 60 days. 2027-01-01 is 60 days ahead, 2027-01-02 is 61.
    expect(quote(plainListing({ occupancy }), "2027-01-01").price).toBe(95);
    expect(quote(plainListing({ occupancy }), "2027-01-02").price).toBe(100);
    const narrow = plainListing({ occupancy: { ...occupancy, withinDays: 10 } });
    expect(quote(narrow, "2026-11-12").price).toBe(95);
    expect(quote(narrow, "2026-11-13").price).toBe(100);
  });

  it("does nothing for a month that is fully blocked", () => {
    const stays = [
      { checkIn: "2026-12-01", checkOut: "2026-12-31", kind: "blocked" as const },
      { checkIn: "2026-11-02", checkOut: "2026-12-01", kind: "blocked" as const },
    ];
    // Only 12-31 is sellable in December; it is free, so the month is quiet.
    expect(quote(plainListing({ occupancy }), "2026-12-31", stays).price).toBe(95);
    const r = run(plainListing({ occupancy }), [{ checkIn: "2026-11-02", checkOut: "2026-12-01", kind: "blocked" }], 29);
    expect(r.nights.every((n) => n.status === "blocked")).toBe(true);
  });
});

describe("events", () => {
  const events = {
    enabled: true,
    list: [
      { date: "2026-11-21", name: "Festival", impact: 3 as const },
      { date: "2026-11-28", name: "Market", impact: 2 as const },
      { date: "2026-11-28", name: "Concert", impact: 5 as const },
      { date: "2026-11-29", name: "Quiet fair", impact: 1 as const },
    ],
  };

  it("uses the default percentage for the impact", () => {
    const n = quote(plainListing({ events }), "2026-11-21");
    expect(n.price).toBe(112);
    expect(n.steps[1]).toMatchObject({ factor: "event", label: 'event "Festival" (impact 3)', percent: 12 });
  });

  it("counts only the highest impact when events overlap", () => {
    const n = quote(plainListing({ events }), "2026-11-28");
    expect(n.price).toBe(140);
    expect(n.steps.filter((s) => s.factor === "event")).toHaveLength(1);
    expect(n.steps[1]?.note).toBe('highest impact counts; also "Market" (impact 2)');
  });

  it("accepts custom percentages per impact", () => {
    const n = quote(plainListing({ events: { ...events, impactPercent: { "3": 30 } } }), "2026-11-21");
    expect(n.price).toBe(130);
  });

  it("shows an event even when its impact does not move the price", () => {
    const n = quote(plainListing({ events }), "2026-11-29");
    expect(n.price).toBe(100);
    expect(n.steps[1]).toMatchObject({ factor: "event", percent: 0 });
  });
});

describe("rounding", () => {
  it("rounds to the chosen step", () => {
    const listing = plainListing({
      dayOfWeek: { enabled: true, adjustments: { mon: 3.7 } },
      rounding: { enabled: true, step: 5 },
    });
    const n = quote(listing, TODAY);
    expect(n.price).toBe(105);
    expect(n.steps.at(-1)).toMatchObject({ factor: "rounding", before: 103.7, after: 105 });
  });

  it("never rounds outside the limits", () => {
    const listing = plainListing({
      limits: { enabled: true, floorPrice: 52, ceilingPrice: 103 },
      dayOfWeek: { enabled: true, adjustments: { mon: 10, tue: -48.6 } },
      rounding: { enabled: true, step: 5 },
    });
    // 110 → ceiling 103 → would round to 105 → kept at 103.
    expect(quote(listing, "2026-11-02").price).toBe(103);
    // 51.40 → floor 52 → would round to 50 → kept at 52.
    expect(quote(listing, "2026-11-03").price).toBe(52);
  });

  it("adds no step when the price is already round", () => {
    const n = quote(plainListing({ rounding: { enabled: true, step: 10 } }), TODAY);
    expect(factorsOf(n)).toEqual(["base"]);
  });
});

describe("date overrides", () => {
  it("fixes the price, beating the ceiling and every factor", () => {
    const listing = plainListing({
      limits: { enabled: true, floorPrice: 50, ceilingPrice: 150 },
      events: { enabled: true, list: [{ date: "2026-11-21", name: "Big night", impact: 5 }] },
      overrides: { enabled: true, dates: [{ date: "2026-11-21", price: 300, note: "by hand" }] },
    });
    const n = quote(listing, "2026-11-21");
    expect(n.price).toBe(300);
    expect(n.steps.at(-1)).toMatchObject({ factor: "override", before: 140, after: 300, note: "by hand" });
  });

  it("can fix only the minimum stay", () => {
    const listing = plainListing({ overrides: { enabled: true, dates: [{ date: "2026-11-21", minStay: 7 }] } });
    const n = quote(listing, "2026-11-21");
    expect(n).toMatchObject({ price: 100, minStay: 7, minStaySource: "override" });
  });

  it("is ignored when switched off", () => {
    const listing = plainListing({ overrides: { enabled: false, dates: [{ date: "2026-11-21", price: 1 }] } });
    expect(quote(listing, "2026-11-21").price).toBe(100);
  });
});

describe("nights that are not for sale", () => {
  it("returns no price for reserved and blocked nights", () => {
    const r = run(plainListing(), [
      { checkIn: "2026-11-03", checkOut: "2026-11-05" },
      { checkIn: "2026-11-05", checkOut: "2026-11-06", kind: "blocked" },
    ]);
    expect(nightOf(r, "2026-11-03")).toMatchObject({ status: "reserved", price: null, minStay: null, steps: [] });
    expect(nightOf(r, "2026-11-04").status).toBe("reserved");
    expect(nightOf(r, "2026-11-05")).toMatchObject({ status: "blocked", price: null });
    expect(nightOf(r, "2026-11-06")).toMatchObject({ status: "available", price: 100 }); // check-out day is free
  });

  it("lets a reservation win over an overlapping block", () => {
    const r = run(plainListing(), [
      { checkIn: "2026-11-03", checkOut: "2026-11-06", kind: "blocked" },
      { checkIn: "2026-11-04", checkOut: "2026-11-05" },
      { checkIn: "2026-11-04", checkOut: "2026-11-05", kind: "blocked" },
    ]);
    expect(nightOf(r, "2026-11-03").status).toBe("blocked");
    expect(nightOf(r, "2026-11-04").status).toBe("reserved");
  });
});

describe("last minute and gap on the same night", () => {
  const stays = [
    { checkIn: "2026-11-01", checkOut: "2026-11-04" },
    { checkIn: "2026-11-05", checkOut: "2026-11-09" }, // 1-night gap on 11-04, 2 days ahead
  ];
  const listing = (lastMinutePct: number, gapPct: number) =>
    plainListing({
      lastMinute: { enabled: true, steps: [{ withinDays: 7, discountPercent: lastMinutePct }] },
      gaps: { enabled: true, maxNights: 2, discountPercent: gapPct, lowerMinStay: true },
    });

  it("keeps only the larger discount when last minute is larger", () => {
    const n = quote(listing(15, 10), "2026-11-04", stays);
    expect(n.price).toBe(85);
    expect(factorsOf(n)).toEqual(["base", "lastMinute"]);
    expect(n.steps[1]?.note).toBe("2 days ahead; gap discount 10% not added");
    expect(n).toMatchObject({ minStay: 1, minStaySource: "gap" }); // the minimum is still lowered
  });

  it("keeps only the larger discount when the gap is larger", () => {
    const n = quote(listing(5, 20), "2026-11-04", stays);
    expect(n.price).toBe(80);
    expect(factorsOf(n)).toEqual(["base", "gap"]);
    expect(n.steps[1]?.note).toBe("last-minute discount 5% not added");
  });

  it("keeps the last-minute discount on a tie", () => {
    const n = quote(listing(10, 10), "2026-11-04", stays);
    expect(n.price).toBe(90);
    expect(factorsOf(n)).toEqual(["base", "lastMinute"]);
  });

  it("applies each one alone when the other does not apply", () => {
    const noGap = quote(listing(10, 20), "2026-11-04"); // no stays: not a gap
    expect(noGap.price).toBe(90);
    expect(noGap.steps[1]?.note).toBe("2 days ahead");
    const farGap = quote(listing(10, 20), "2026-11-20", [
      { checkIn: "2026-11-15", checkOut: "2026-11-20" },
      { checkIn: "2026-11-21", checkOut: "2026-11-25" },
    ]); // 18 days ahead: outside last minute
    expect(farGap.price).toBe(80);
    expect(farGap.steps[1]?.note).toBeUndefined();
  });
});

describe("pipeline order", () => {
  it("applies the factors in the documented order", () => {
    const n = quote(
      plainListing({
        limits: { enabled: true, floorPrice: 10, ceilingPrice: 1000 },
        seasons: { enabled: true, periods: [{ name: "S", start: "11-01", end: "11-30", multiplier: 1.1 }] },
        dayOfWeek: { enabled: true, adjustments: { thu: 5 } },
        lastMinute: { enabled: true, steps: [{ withinDays: 5, discountPercent: 5 }] },
        gaps: { enabled: true, maxNights: 1, discountPercent: 10, lowerMinStay: true },
        occupancy: { enabled: true, highThresholdPercent: 5, raisePercent: 3, lowThresholdPercent: 1, lowerPercent: 1 },
        events: { enabled: true, list: [{ date: "2026-11-05", name: "E", impact: 2 }] },
        rounding: { enabled: true, step: 1 },
        overrides: { enabled: true, dates: [{ date: "2026-11-05", minStay: 2 }] },
      }),
      "2026-11-05",
      [
        { checkIn: "2026-11-02", checkOut: "2026-11-05" },
        { checkIn: "2026-11-06", checkOut: "2026-11-09" },
      ],
    );
    expect(factorsOf(n)).toEqual([
      "base",
      "season",
      "dayOfWeek",
      "gap", // the 10% gap discount beats the 5% last-minute one: they never stack
      "occupancy",
      "event",
      "limits",
      "rounding",
    ]);
  });
});
