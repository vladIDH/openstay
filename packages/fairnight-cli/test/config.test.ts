import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ConfigError } from "fairnight";
import { describe, expect, it } from "vitest";
import { feedKeys, type HostListing, loadHostConfig, normaliseCalendarUrl, selectListings, SetupError, validateHostConfig } from "../src/config.js";
import { EXAMPLE_CONFIG } from "../src/template.js";
import { tempDir } from "./helpers.js";

const exampleFile = JSON.parse(readFileSync(new URL("../examples/fairnight.config.json", import.meta.url), "utf8"));

function issuesOf(input: unknown): string[] {
  const r = validateHostConfig(input);
  return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
}

describe("host config", () => {
  it("accepts the example, which is exactly what init writes", () => {
    expect(issuesOf(exampleFile)).toEqual([]);
    expect(exampleFile).toEqual(JSON.parse(JSON.stringify(EXAMPLE_CONFIG)));
  });

  it("keeps the town of a listing and refuses an empty one", () => {
    const input = structuredClone(exampleFile);
    input.listings[0].city = "Costa Adeje";
    const r = validateHostConfig(input);
    expect(r.ok && r.value.listings[0]?.city).toBe("Costa Adeje");
    input.listings[1].city = " ";
    expect(issuesOf(input)).toEqual(['listings[1].city: must be the name of a town, up to 100 characters, got " "']);
  });

  it("fills in the listing id from the name", () => {
    const input = structuredClone(exampleFile);
    delete input.listings[0].pricing.listingId;
    const r = validateHostConfig(input);
    expect(r.ok && r.value.listings[0]?.pricing.listingId).toBe("seaview-loft");
  });

  it("reports every problem with its path, including the engine's", () => {
    const input = structuredClone(exampleFile);
    input.listings[0].name = "Seaview Loft";
    input.listings[0].calendars[0].url = "file:///C:/cal.ics";
    input.listings[0].calendars[1].source = "expedia";
    input.listings[0].pricing.factors.limits.floorPrice = 999;
    input.listings[1].name = "garden-studio";
    input.listings.push(structuredClone(input.listings[1]));
    input.listings[2].calendars[0].treatAs = "maybe";
    input.extra = true;
    expect(issuesOf(input)).toEqual([
      "config.extra: unknown field (allowed: listings, market, language, pilot, fairguestRelay)",
      'listings[0].name: must be a short name with lowercase letters, digits and dashes (like "seaview-loft"), got "Seaview Loft"',
      'listings[0].calendars[0].url: must be an https:// or webcal:// link, got "file:///C:/cal.ics"',
      'listings[0].calendars[1].source: must be one of airbnb, booking, vrbo, other, smoobu, beds24, got "expedia"',
      "listings[0].pricing.factors.limits: floorPrice (999) is higher than ceilingPrice (260)",
      'listings[2].name: "garden-studio" is used by another listing',
      'listings[2].calendars[0].treatAs: must be one of auto, reservation, blocked, got "maybe"',
    ]);
  });

  it("checks the shape of the file", () => {
    expect(issuesOf([])).toEqual(["config: must be an object with a listings list"]);
    expect(issuesOf({ listings: [] })).toEqual(["config.listings: must be a list with at least one listing"]);
    expect(issuesOf({ listings: [3] })).toEqual(["listings[0]: must be an object with name, calendars and pricing"]);
    const twice = { listings: [{ name: "a", calendars: [{ source: "airbnb", url: "https://x.example/1" }, { source: "other", url: "webcal://x.example/1" }, 5], pricing: { currency: "EUR", basePrice: 1, defaultMinStay: 1, factors: {} } }] };
    expect(issuesOf(twice)).toEqual([
      "listings[0].calendars[1].url: the same link is listed twice",
      "listings[0].calendars[2]: must be an object with source and url",
    ]);
    expect(issuesOf({ listings: [{ name: "a", calendars: "x", pricing: null }] })).toEqual([
      "listings[0].calendars: must be a list of calendars (it can be empty)",
      "listings[0].pricing: must be an object, got null",
    ]);
  });

  it("reads webcal links over https and refuses other schemes", () => {
    expect(normaliseCalendarUrl("webcal://cal.example.com/a.ics")).toBe("https://cal.example.com/a.ics");
    expect(normaliseCalendarUrl("  https://cal.example.com/a.ics?t=1 ")).toBe("https://cal.example.com/a.ics?t=1");
    expect(normaliseCalendarUrl("ftp://cal.example.com/a.ics")).toBeNull();
    expect(normaliseCalendarUrl("not a link")).toBeNull();
  });

  it("gives each calendar a key that does not depend on its link", () => {
    const listing = { name: "x", pricing: (EXAMPLE_CONFIG.listings[0] as HostListing).pricing, calendars: [
      { source: "airbnb" as const, url: "https://a.example/1" },
      { source: "booking" as const, url: "https://a.example/2" },
      { source: "airbnb" as const, url: "https://a.example/3" },
    ] };
    expect(feedKeys(listing)).toEqual(["airbnb", "booking", "airbnb-2"]);
  });

  it("loads from the folder with clear errors", () => {
    const dir = tempDir();
    expect(() => loadHostConfig(dir)).toThrow(/Run "fairnight init" in this folder first/);
    writeFileSync(path.join(dir, "fairnight.config.json"), "{ nope");
    expect(() => loadHostConfig(dir)).toThrow(SetupError);
    writeFileSync(path.join(dir, "fairnight.config.json"), "\uFEFF" + JSON.stringify({ listings: [] }));
    expect(() => loadHostConfig(dir)).toThrow(ConfigError);
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify(exampleFile));
    const config = loadHostConfig(dir);
    expect(selectListings(config, undefined)).toHaveLength(2);
    expect(selectListings(config, "garden-studio").map((l) => l.name)).toEqual(["garden-studio"]);
    expect(() => selectListings(config, "nope")).toThrow('No listing called "nope". Listings in the config: seaview-loft, garden-studio.');
  });
});
