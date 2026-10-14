/**
 * Each step carries its facts as data (params), next to the English label and
 * note, so a page can say them in the host's language. Labels, notes and
 * explanations do not change.
 */
import { describe, expect, it } from "vitest";
import type { PriceStep, Stay } from "../src/engine/index.js";
import { plainListing, quote, TODAY } from "./helpers.js";

const stepOf = (steps: PriceStep[], factor: PriceStep["factor"]) => steps.find((s) => s.factor === factor);

describe("step params", () => {
  it("season, weekday, last minute, far out, limits and rounding", () => {
    const n = quote(
      plainListing({
        seasons: { enabled: true, periods: [{ name: "Alta stagione", start: "11-01", end: "11-30", multiplier: 1.2 }] },
        dayOfWeek: { enabled: true, adjustments: { mon: -10 } },
        lastMinute: { enabled: true, steps: [{ withinDays: 3, discountPercent: 5 }] },
        limits: { enabled: true, floorPrice: 50, ceilingPrice: 300 },
        rounding: { enabled: true, step: 5 },
      }),
      TODAY,
    );
    expect(stepOf(n.steps, "season")).toMatchObject({ label: 'season "Alta stagione"', params: { name: "Alta stagione" } });
    expect(stepOf(n.steps, "dayOfWeek")?.params).toEqual({ weekday: "mon" });
    expect(stepOf(n.steps, "lastMinute")).toMatchObject({ note: "0 days ahead", params: { withinDays: 3, daysAhead: 0 } });
    expect(stepOf(n.steps, "limits")?.params).toEqual({ kind: "within", floor: 50, ceiling: 300 });
    expect(stepOf(n.steps, "rounding")?.params).toEqual({ step: 5 });
    const far = quote(plainListing({ farOut: { enabled: true, steps: [{ fromDays: 90, premiumPercent: 10 }] } }), "2027-03-01");
    expect(stepOf(far.steps, "farOut")?.params).toEqual({ fromDays: 90, daysAhead: 119 });
  });

  it("a fixed-price season and the floor", () => {
    const n = quote(
      plainListing({
        seasons: { enabled: true, periods: [{ name: "Ponte", start: "11-01", end: "11-30", fixedPrice: 40 }] },
        limits: { enabled: true, floorPrice: 60, ceilingPrice: 300 },
      }),
      TODAY,
    );
    expect(stepOf(n.steps, "season")?.params).toEqual({ name: "Ponte", fixed: true });
    expect(stepOf(n.steps, "limits")).toMatchObject({ label: "floor", params: { kind: "floor", floor: 60, ceiling: 300 } });
  });

  it("gap with the last-minute discount left out, and occupancy", () => {
    const stays: Stay[] = [
      { checkIn: "2026-11-01", checkOut: "2026-11-03" },
      { checkIn: "2026-11-05", checkOut: "2026-11-30" },
    ];
    const n = quote(
      plainListing({
        gaps: { enabled: true, maxNights: 3, discountPercent: 20, lowerMinStay: false },
        lastMinute: { enabled: true, steps: [{ withinDays: 3, discountPercent: 10 }] },
        occupancy: { enabled: true, highThresholdPercent: 70, raisePercent: 10, lowThresholdPercent: 20, lowerPercent: 10 },
      }),
      "2026-11-03",
      stays,
    );
    expect(stepOf(n.steps, "gap")).toMatchObject({ label: "gap of 2 nights", params: { nights: 2, lastMinuteNotAdded: 10 } });
    expect(stepOf(n.steps, "occupancy")).toMatchObject({ label: "busy month", note: "month 90% booked", params: { kind: "busy", monthPercent: 90 } });
  });

  it("events, stale calendar and few rooms left", () => {
    const n = quote(
      { ...plainListing({
        events: {
          enabled: true,
          list: [
            { date: TODAY, name: "Sagra", impact: 3 },
            { date: TODAY, name: "Mercato", impact: 1 },
          ],
        },
        scarcity: { enabled: true, steps: [{ takenPercent: 50, raisePercent: 40 }], maxRaisePercent: 20 },
      }), units: 4 },
      TODAY,
      [{ checkIn: TODAY, checkOut: "2026-11-03", units: 3 }],
    );
    expect(stepOf(n.steps, "event")?.params).toEqual({ name: "Sagra", impact: 3, others: 1 });
    expect(stepOf(n.steps, "scarcity")?.params).toEqual({ takenPercent: 50, free: 1, total: 4, takenNow: 75, cap: 20 });
  });
});
