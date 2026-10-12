import { priceListing } from "../src/engine/index.js";
import type { ListingConfig, NightQuote, PricingResult, Stay } from "../src/engine/index.js";

/** A listing with every factor switched off: base 100, min stay 3. */
export function plainListing(factors: ListingConfig["factors"] = {}): ListingConfig {
  return { listingId: "test", currency: "EUR", basePrice: 100, defaultMinStay: 3, factors };
}

/** Monday 2 November 2026. */
export const TODAY = "2026-11-02";

export function run(listing: ListingConfig, stays: Stay[] = [], days = 30, today = TODAY): PricingResult {
  return priceListing(listing, { stays }, { today, days });
}

export function nightOf(result: PricingResult, date: string): NightQuote {
  const n = result.nights.find((x) => x.date === date);
  if (!n) throw new Error(`night ${date} not in result`);
  return n;
}

/** Price one night with the given listing and stays. */
export function quote(listing: ListingConfig, date: string, stays: Stay[] = [], today = TODAY): NightQuote {
  return nightOf(run(listing, stays, 400, today), date);
}

export function factorsOf(n: NightQuote): string[] {
  return n.steps.map((s) => s.factor);
}
