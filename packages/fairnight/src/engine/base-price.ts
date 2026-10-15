/**
 * A suggested base price from zone data: what similar homes of the zone ask
 * on a normal night. It is a SUGGESTION only: the engine never changes the
 * base price, the host confirms it by hand (`fairnight mercato prezzo-base
 * --applica`, or the button of the calendar page).
 *
 * The method, kept simple on purpose so the host can check it:
 * - each night of the zone counts if it has an average price and is measured on
 *   at least `minComparables` comparable homes (when the source says how many);
 * - the nights are grouped by month, and each month gets the average of its nights;
 * - the most recent `months` months with figures are kept (12: a whole year,
 *   so every season weighs once);
 * - the suggestion is the MEDIAN of those monthly averages, rounded to a whole
 *   amount: a normal month, not pulled up by August or down by November;
 * - with fewer than `minMonths` months there is no suggestion: half a year of
 *   one season would say little about the others.
 *
 * Nothing here reads the network or the listing's own prices: only the zone data
 * the host imported. Pure and deterministic, like the rest of the engine.
 */
import { formatAmount } from "./explain.js";
import type { MarketData } from "./types.js";

export interface BasePriceOptions {
  /** Nights measured on fewer comparable homes are left out. Default 5, like the market factor. */
  minComparables?: number;
  /** Months with figures needed for a suggestion. Default 6. */
  minMonths?: number;
  /** Most recent months used. Default 12. */
  months?: number;
  /** A suggestion this far from the current base price (in %) is flagged. Default 30. */
  warnPercent?: number;
}

export const DEFAULT_BASE_PRICE = { minComparables: 5, minMonths: 6, months: 12, warnPercent: 30 } as const;

export interface BasePriceMonth {
  /** YYYY-MM. */
  month: string;
  averagePrice: number;
  /** Nights of the month with a usable price. */
  nights: number;
  /** Fewest comparable homes of the month's nights, when the source says. */
  comparables?: number;
}

/** Which homes the zone data describes, as the host chose them at import. */
export interface ComparableHomes {
  bedrooms?: number;
  guests?: number;
  /** A range of guests instead of one number (e.g. ISTAC's sizes 1–4, 5–8, 9 or more). */
  guestsFrom?: number;
  guestsTo?: number;
  roomType?: string;
  neighbourhood?: string;
}

interface SuggestionFacts {
  area: string | null;
  source: string;
  attribution: string;
  estimated: boolean;
  readOn: string | null;
  currency: string;
  currentBasePrice: number;
  /** The months that count, oldest first. */
  months: BasePriceMonth[];
  comparableHomes?: ComparableHomes;
}

export interface BasePriceSuggestion extends SuggestionFacts {
  ok: true;
  suggested: number;
  /** Suggested vs current base price, in % (positive: the zone asks more). */
  differencePercent: number;
  /** True when the difference is beyond warnPercent: check before using it. */
  farOff: boolean;
  /** Lowest and highest monthly average of the window. */
  low: number;
  high: number;
  /** Median of the months' comparable homes, when the source says. */
  comparables?: number;
  explanation: string;
}

export interface NoBasePriceSuggestion extends SuggestionFacts {
  ok: false;
  reason: "no-prices" | "too-few-months";
  needed: number;
  explanation: string;
}

export type BasePriceResult = BasePriceSuggestion | NoBasePriceSuggestion;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, currency: string) => `${formatAmount(round2(n))} ${currency}`;

/** "2 bedrooms, 4 guests, entire home" — empty when the data is the whole zone. */
export function describeComparables(c: ComparableHomes | undefined): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.bedrooms !== undefined) parts.push(c.bedrooms === 1 ? "1 bedroom" : `${c.bedrooms} bedrooms`);
  if (c.guests !== undefined) parts.push(c.guests === 1 ? "1 guest" : `${c.guests} guests`);
  else if (c.guestsFrom !== undefined) parts.push(c.guestsTo !== undefined ? `${c.guestsFrom}–${c.guestsTo} guests` : `${c.guestsFrom} or more guests`);
  if (c.roomType !== undefined) parts.push(c.roomType);
  if (c.neighbourhood !== undefined) parts.push(`in ${c.neighbourhood}`);
  return parts.join(", ");
}

export function suggestBasePrice(
  market: MarketData,
  current: { basePrice: number; currency: string },
  options: BasePriceOptions & { comparableHomes?: ComparableHomes } = {},
): BasePriceResult {
  const minComparables = options.minComparables ?? DEFAULT_BASE_PRICE.minComparables;
  const minMonths = options.minMonths ?? DEFAULT_BASE_PRICE.minMonths;
  const window = options.months ?? DEFAULT_BASE_PRICE.months;
  const warnPercent = options.warnPercent ?? DEFAULT_BASE_PRICE.warnPercent;

  const byMonth = new Map<string, { sum: number; nights: number; comparables: number | undefined }>();
  for (const d of market.days) {
    if (d.averagePrice === undefined || !(d.averagePrice > 0)) continue;
    if (d.comparables !== undefined && d.comparables < minComparables) continue;
    const key = d.date.slice(0, 7);
    const m = byMonth.get(key) ?? { sum: 0, nights: 0, comparables: undefined };
    m.sum += d.averagePrice;
    m.nights++;
    if (d.comparables !== undefined) m.comparables = m.comparables === undefined ? d.comparables : Math.min(m.comparables, d.comparables);
    byMonth.set(key, m);
  }
  const months: BasePriceMonth[] = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-window)
    .map(([month, m]) => ({
      month,
      averagePrice: round2(m.sum / m.nights),
      nights: m.nights,
      ...(m.comparables !== undefined ? { comparables: m.comparables } : {}),
    }));

  const facts: SuggestionFacts = {
    area: market.area ?? null,
    source: market.source,
    attribution: market.attribution,
    estimated: market.estimated === true,
    readOn: market.readOn ?? null,
    currency: current.currency,
    currentBasePrice: current.basePrice,
    months,
    ...(options.comparableHomes ? { comparableHomes: options.comparableHomes } : {}),
  };
  const zone = market.area !== undefined ? `zone "${market.area}"` : "the zone";
  const source = `${market.attribution}${market.estimated ? ", estimated" : ""}${market.readOn !== undefined ? `, read ${market.readOn}` : ""}`;

  if (months.length < minMonths) {
    const reason = months.length === 0 ? "no-prices" : "too-few-months";
    const why =
      months.length === 0
        ? `${zone} has no average prices measured on at least ${minComparables} comparable homes`
        : `${zone} has prices for ${months.length} month${months.length === 1 ? "" : "s"}, at least ${minMonths} are needed so that more than one season counts`;
    return { ok: false, reason, needed: minMonths, ...facts, explanation: `No base price suggestion: ${why} (${source}).` };
  }

  const averages = months.map((m) => m.averagePrice);
  const suggested = Math.round(median(averages));
  const differencePercent = round2(((suggested - current.basePrice) / current.basePrice) * 100);
  const farOff = Math.abs(differencePercent) > warnPercent;
  const withComparables = months.filter((m) => m.comparables !== undefined).map((m) => m.comparables as number);
  const comparables = withComparables.length > 0 ? Math.round(median(withComparables)) : undefined;
  const low = Math.min(...averages);
  const high = Math.max(...averages);

  const homes = describeComparables(options.comparableHomes);
  const who = [comparables !== undefined ? `${comparables} homes` : "the homes", homes !== "" ? `with ${homes}` : "of the whole zone"].join(" ");
  const first = months[0]?.month as string;
  const last = months.at(-1)?.month as string;
  const sign = differencePercent > 0 ? "+" : "";
  const lines = [
    `Suggested base price ${money(suggested, current.currency)}: median of the monthly average price of ${who} in ${zone}, ${first} → ${last} (${months.length} months, from ${money(low, current.currency)} to ${money(high, current.currency)}).`,
    `Your base price is ${money(current.basePrice, current.currency)}: ${differencePercent === 0 ? "the same" : `${sign}${differencePercent}%`}.`,
  ];
  if (farOff) lines.push(`Very different from yours (more than ${warnPercent}%): check that the zone's homes are really like yours before using it.`);
  lines.push(`Source: ${source}. Nothing changes until you confirm it.`);
  return {
    ok: true,
    suggested,
    differencePercent,
    farOff,
    low,
    high,
    ...(comparables !== undefined ? { comparables } : {}),
    ...facts,
    explanation: lines.join(" "),
  };
}
