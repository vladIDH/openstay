import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  parseCalendar,
  parseListingConfig,
  priceListing,
  validateCalendar,
  validateListingConfig,
} from "../src/engine/index.js";
import { plainListing } from "./helpers.js";

const example = JSON.parse(readFileSync(new URL("../examples/annuncio-esempio.json", import.meta.url), "utf8"));

function issuesOf(input: unknown): string[] {
  const r = validateListingConfig(input);
  return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
}

describe("listing configuration", () => {
  it("accepts the example listing", () => {
    expect(issuesOf(example)).toEqual([]);
  });

  it("accepts a listing with no factors", () => {
    expect(validateListingConfig(plainListing()).ok).toBe(true);
  });

  it("reports every problem at once, with the path", () => {
    const issues = issuesOf({
      listingId: "",
      currency: "euro",
      basePrice: -5,
      defaultMinStay: 1.5,
      factors: {
        limits: { enabled: true, floorPrice: 300, ceilingPrice: 200 },
        celing: {},
      },
    });
    expect(issues).toEqual([
      'listing.listingId: must be a non-empty text, got ""',
      'listing.currency: must be a 3-letter code like EUR, got "euro"',
      "listing.basePrice: must be greater than 0, got -5",
      "listing.defaultMinStay: must be a whole number, got 1.5",
      "listing.factors.celing: unknown field (allowed: limits, seasons, dayOfWeek, lastMinute, farOut, gaps, occupancy, events, staleCalendar, historicalFloor, rounding, overrides)",
      "listing.factors.limits: floorPrice (300) is higher than ceilingPrice (200)",
    ]);
  });

  it("checks seasons", () => {
    const issues = issuesOf(
      plainListing({
        seasons: {
          enabled: true,
          periods: [
            { name: "Both", start: "01-01", end: "01-31", multiplier: 1.1, fixedPrice: 90 },
            { name: "None", start: "02-30", end: "13-01" },
          ],
        },
      }),
    );
    expect(issues).toEqual([
      "listing.factors.seasons.periods[0]: set exactly one of multiplier or fixedPrice",
      'listing.factors.seasons.periods[1].start: must be a month-day like 12-31, got "02-30"',
      'listing.factors.seasons.periods[1].end: must be a month-day like 12-31, got "13-01"',
      "listing.factors.seasons.periods[1]: set exactly one of multiplier or fixedPrice",
    ]);
  });

  it("checks steps, events, occupancy and overrides", () => {
    const issues = issuesOf(
      plainListing({
        lastMinute: {
          enabled: true,
          steps: [
            { withinDays: 3, discountPercent: 95 },
            { withinDays: 3, discountPercent: 5, minStay: 0 },
          ],
        },
        occupancy: { enabled: true, highThresholdPercent: 40, raisePercent: 5, lowThresholdPercent: 60, lowerPercent: 5, withinDays: -1 },
        events: {
          enabled: true,
          impactPercent: { "6": 10 } as never,
          list: [{ date: "2026-02-30", name: "X", impact: 7 as never }],
        },
        overrides: {
          enabled: true,
          dates: [{ date: "2026-12-24" }, { date: "2026-12-24", price: 0 }],
        },
      }),
    );
    expect(issues).toEqual([
      "listing.factors.lastMinute.steps[0].discountPercent: must be at most 90, got 95",
      "listing.factors.lastMinute.steps[1].withinDays: 3 is used by another step",
      "listing.factors.lastMinute.steps[1].minStay: must be at least 1, got 0",
      "listing.factors.occupancy.withinDays: must be at least 0, got -1",
      "listing.factors.occupancy: lowThresholdPercent must be lower than highThresholdPercent",
      "listing.factors.events.impactPercent.6: unknown field (allowed: 1, 2, 3, 4, 5)",
      'listing.factors.events.list[0].date: must be a date like 2026-12-31, got "2026-02-30"',
      "listing.factors.events.list[0].impact: must be at most 5, got 7",
      "listing.factors.overrides.dates[0]: set price, minStay or both",
      "listing.factors.overrides.dates[1].date: 2026-12-24 already has an override",
      "listing.factors.overrides.dates[1].price: must be greater than 0, got 0",
    ]);
  });

  it("checks the type of every field", () => {
    const issues = issuesOf({
      listingId: "x",
      currency: "EUR",
      basePrice: "100",
      defaultMinStay: 2,
      factors: {
        dayOfWeek: { enabled: "yes", adjustments: { fri: "10", funday: 5 } },
        gaps: { enabled: true, maxNights: 2, discountPercent: 10, lowerMinStay: 1 },
        rounding: { enabled: true, step: 0 },
        farOut: { enabled: true, steps: "soon" },
        seasons: [],
        overrides: { enabled: true, dates: [{ date: "2026-01-01", minStay: 2, note: 3 }] },
      },
    });
    expect(issues).toEqual([
      'listing.basePrice: must be a number, got "100"',
      'listing.factors.seasons: must be an object, got a list',
      'listing.factors.dayOfWeek.enabled: must be true or false, got "yes"',
      "listing.factors.dayOfWeek.adjustments.funday: unknown field (allowed: mon, tue, wed, thu, fri, sat, sun)",
      'listing.factors.dayOfWeek.adjustments.fri: must be a number, got "10"',
      'listing.factors.farOut.steps: must be a list, got "soon"',
      "listing.factors.gaps.lowerMinStay: must be true or false, got 1",
      "listing.factors.rounding.step: must be greater than 0, got 0",
      "listing.factors.overrides.dates[0].note: must be a text",
    ]);
  });

  it("rejects things that are not objects", () => {
    expect(issuesOf(null)).toEqual(["listing: must be an object, got null"]);
    expect(issuesOf({ listingId: "x", currency: "EUR", basePrice: 1, defaultMinStay: 1 })).toEqual([
      "listing.factors: must be an object, got missing",
    ]);
  });

  it("throws a ConfigError with a readable message", () => {
    expect(() => parseListingConfig({ ...plainListing(), basePrice: 0 })).toThrowError(
      /Invalid listing configuration:\n {2}- listing.basePrice: must be greater than 0, got 0/,
    );
    try {
      parseListingConfig({});
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).issues.length).toBeGreaterThan(1);
    }
  });

  it("fills in the default impact percentages and sorts steps", () => {
    const cfg = parseListingConfig(
      plainListing({
        lastMinute: { enabled: true, steps: [{ withinDays: 9, discountPercent: 5 }, { withinDays: 2, discountPercent: 9 }] },
        farOut: { enabled: true, steps: [{ fromDays: 90, premiumPercent: 5 }, { fromDays: 200, premiumPercent: 9 }] },
        events: { enabled: true, impactPercent: { "5": 50 }, list: [] },
        occupancy: { enabled: true, highThresholdPercent: 70, raisePercent: 5, lowThresholdPercent: 20, lowerPercent: 5 },
      }),
    );
    expect(cfg.factors.occupancy?.withinDays).toBe(60);
    expect(cfg.factors.events?.impactPercent).toEqual({ "1": 0, "2": 5, "3": 12, "4": 25, "5": 50 });
    expect(cfg.factors.lastMinute?.steps.map((s) => s.withinDays)).toEqual([2, 9]);
    expect(cfg.factors.farOut?.steps.map((s) => s.fromDays)).toEqual([200, 90]);
  });
});

describe("calendar", () => {
  it("accepts valid stays", () => {
    expect(parseCalendar({ stays: [{ checkIn: "2026-11-01", checkOut: "2026-11-03", kind: "blocked" }] }).stays).toHaveLength(1);
  });

  it("reports bad stays", () => {
    const r = validateCalendar({
      stays: [
        { checkIn: "2026-11-05", checkOut: "2026-11-05" },
        { checkIn: "2026-11-01", checkOut: "2026-11-02", kind: "owner" },
        { checkIn: "nope", checkOut: "2026-11-02", guest: "x" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
        "calendar.stays[0]: checkOut (2026-11-05) must be after checkIn (2026-11-05)",
        'calendar.stays[1].kind: must be "reservation" or "blocked", got "owner"',
        "calendar.stays[2].guest: unknown field (allowed: checkIn, checkOut, kind)",
        'calendar.stays[2].checkIn: must be a date like 2026-12-31, got "nope"',
      ]);
    }
    expect(() => parseCalendar({ stays: "x" })).toThrowError(/Invalid calendar/);
  });
});

describe("pricing options", () => {
  it("rejects a bad date or horizon", () => {
    expect(() => priceListing(plainListing(), { stays: [] }, { today: "2026-13-01", days: 0 })).toThrowError(
      /options.today: must be a date[\s\S]*options.days: must be at least 1, got 0/,
    );
    expect(() => priceListing(plainListing(), { stays: [] }, "tomorrow")).toThrowError(/options: must be an object/);
  });
});
