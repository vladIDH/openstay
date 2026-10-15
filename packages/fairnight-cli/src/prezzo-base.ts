/**
 * `fairnight mercato prezzo-base`: the base price that the zone data suggests
 * for each listing, with its explanation. Only a suggestion: the base price in
 * fairnight.config.json changes only with --applica (or the button of the
 * calendar page), for one listing, after the host has seen the figure.
 *
 * The suggestion uses the zone the listing names (marketArea) and the homes
 * the zone's figures describe, as the host chose them at import (--camere,
 * --ospiti, --tipo). When they do not look like the listing, it says so.
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { describeComparables, suggestBasePrice, type BasePriceResult, type ComparableHomes } from "fairnight";
import { readRawConfig } from "./configura.js";
import { loadHostConfig, selectListings, SetupError, validateHostConfig, type HostListing } from "./config.js";
import { openDb, type Db } from "./db.js";
import { CONFIG_FILE, configPath, dbPath, localToday, type Io } from "./io.js";
import { loadComparables, loadMarket } from "./market-store.js";

export interface ListingSuggestion {
  listing: string;
  title: string;
  area: string | null;
  /** Null when there is nothing to compute: no zone, or no data for it. */
  result: BasePriceResult | null;
  /** Why there is no result (no zone, no data). */
  missing: "no-zone" | "no-data" | null;
  /** Which homes the zone's figures describe; null: the whole zone. */
  comparables: ComparableHomes | null;
  /** Things to check before using the suggestion. */
  warnings: Warning[];
}

export type Warning =
  | { kind: "whole-zone" }
  | { kind: "guests-differ"; listing: number; zone: number }
  | { kind: "guests-unknown"; listing: number }
  | { kind: "below-floor"; floor: number }
  | { kind: "above-ceiling"; ceiling: number };

export function warningText(w: Warning): string {
  switch (w.kind) {
    case "whole-zone":
      return "The zone's figures are for every home of the zone, not only homes like yours: import them with --camere and --ospiti for a closer figure.";
    case "guests-differ":
      return `The zone's homes take ${w.zone} guests, this listing takes ${w.listing}.`;
    case "guests-unknown":
      return `This listing takes ${w.listing} guests, but the zone's figures are not limited to homes for ${w.listing} guests.`;
    case "below-floor":
      return `The suggestion is below your floor price (${w.floor}): the floor would still apply.`;
    case "above-ceiling":
      return `The suggestion is above your ceiling price (${w.ceiling}): the ceiling would still apply.`;
  }
}

export function suggestionFor(db: Db, listing: HostListing, today: string): ListingSuggestion {
  const base = { listing: listing.name, title: listing.pricing.name ?? listing.name, area: listing.marketArea ?? null };
  if (listing.marketArea === undefined) return { ...base, result: null, missing: "no-zone", comparables: null, warnings: [] };
  const market = loadMarket(db, listing.marketArea, today);
  if (!market) return { ...base, result: null, missing: "no-data", comparables: null, warnings: [] };
  const comparables = loadComparables(db, listing.marketArea);
  const result = suggestBasePrice(
    market,
    { basePrice: listing.pricing.basePrice, currency: listing.pricing.currency },
    comparables ? { comparableHomes: comparables } : {},
  );
  const warnings: Warning[] = [];
  if (comparables === null || describeComparables(comparables) === "") warnings.push({ kind: "whole-zone" });
  if (listing.guests !== undefined) {
    if (comparables?.guests === undefined) {
      if (comparables !== null) warnings.push({ kind: "guests-unknown", listing: listing.guests });
    } else if (comparables.guests !== listing.guests) {
      warnings.push({ kind: "guests-differ", listing: listing.guests, zone: comparables.guests });
    }
  }
  const limits = listing.pricing.factors.limits;
  if (result.ok && limits?.enabled) {
    if (result.suggested < limits.floorPrice) warnings.push({ kind: "below-floor", floor: limits.floorPrice });
    if (result.suggested > limits.ceilingPrice) warnings.push({ kind: "above-ceiling", ceiling: limits.ceilingPrice });
  }
  return { ...base, result, missing: null, comparables, warnings };
}

/** Write a new base price for one listing in fairnight.config.json (the old file is kept as .bak). */
export function writeBasePrice(dir: string, listingName: string, price: number): void {
  const raw = readRawConfig(dir);
  if (raw === null) throw new SetupError(`No ${CONFIG_FILE} in ${dir}.`);
  const listings = raw.listings as Record<string, unknown>[];
  const entry = listings.find((l) => l.name === listingName);
  if (!entry) throw new SetupError(`No listing called "${listingName}".`);
  const pricing = entry.pricing as Record<string, unknown>;
  pricing.basePrice = price;
  const checked = validateHostConfig(raw);
  if (!checked.ok) throw new SetupError(`The new base price does not fit the config: ${checked.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
  const file = configPath(dir);
  copyFileSync(file, `${file}.bak`);
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n", "utf8");
}

export function basePriceCommand(dir: string, io: Io, options: { listing?: string; apply: boolean }): number {
  const config = loadHostConfig(dir);
  if (options.apply && options.listing === undefined) {
    throw new SetupError("--applica changes one listing at a time: add --listing <name>.");
  }
  const listings = selectListings(config, options.listing);
  const today = localToday(io.now());
  const db = openDb(dbPath(dir));
  let suggestions: ListingSuggestion[];
  try {
    suggestions = listings.map((l) => suggestionFor(db, l, today));
  } finally {
    db.close();
  }
  for (const s of suggestions) {
    io.out(`${s.title} (${s.listing}):`);
    if (s.missing === "no-zone") {
      io.out(`  no zone: add "marketArea": "<zone>" to this listing in ${CONFIG_FILE} to get a suggestion.`);
      continue;
    }
    if (s.missing === "no-data") {
      io.out(`  no data for zone "${s.area}": "fairnight mercato importa <file> --zona ${s.area}" first.`);
      continue;
    }
    const r = s.result as BasePriceResult;
    io.out(`  ${r.explanation}`);
    if (r.ok) for (const w of s.warnings) io.out(`  Check: ${warningText(w)}`);
  }

  if (!options.apply) {
    const one = suggestions.find((s) => s.result?.ok && s.result.suggested !== s.result.currentBasePrice);
    if (one) io.out(`To use it: fairnight mercato prezzo-base --listing ${one.listing} --applica`);
    return 0;
  }
  const s = suggestions[0] as ListingSuggestion;
  const r = s.result;
  if (!r || !r.ok) {
    io.err("Nothing changed: there is no suggestion for this listing.");
    return 1;
  }
  if (r.suggested === r.currentBasePrice) {
    io.out("Nothing changed: the base price is already the suggested one.");
    return 0;
  }
  writeBasePrice(dir, s.listing, r.suggested);
  io.out(`Base price of ${s.listing}: ${r.currentBasePrice} → ${r.suggested} ${r.currency}. The previous settings are in ${CONFIG_FILE}.bak.`);
  return 0;
}
