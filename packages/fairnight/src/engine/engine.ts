/**
 * Fairnight pricing engine.
 *
 * Pure function: configuration + stays + options in, one quote per night out.
 * Same input, same output — there is no hidden clock, no I/O, no randomness.
 *
 * Price pipeline, in this order (each factor can be switched off):
 *   base → season → day of week → last minute → far out → gap → occupancy
 *   → stale calendar → event → historical floor → floor/ceiling → rounding
 *   → date override (wins over everything)
 *
 * Minimum stay, in this order of precedence:
 *   date override → far-out step → last-minute step → default;
 *   then the gap rule, which only applies if it LOWERS the minimum
 *   (an override is never lowered).
 */
import { Availability } from "./calendar.js";
import { fromDay, toDay, weekdayOf } from "./dates.js";
import { explainNight } from "./explain.js";
import { dayOrNull, PriceHistory } from "./history.js";
import {
  cents,
  dayOfWeekFactor,
  eventFactor,
  farOutFactor,
  farOutStepFor,
  gapFactor,
  gapFor,
  historicalFloorFactor,
  lastMinuteFactor,
  lastMinuteStepFor,
  limitsFactor,
  occupancyFactor,
  roundingFactor,
  seasonFactor,
  staleCalendarFactor,
  type NightContext,
} from "./factors.js";
import { parseCalendar, parseListingConfig, parsePricingOptions } from "./schema.js";
import type { MinStaySource, NightQuote, PriceStep, PricingResult } from "./types.js";

type Factor = (ctx: NightContext, price: number) => PriceStep | null;

const PIPELINE: readonly Factor[] = [
  seasonFactor,
  dayOfWeekFactor,
  lastMinuteFactor,
  farOutFactor,
  gapFactor,
  occupancyFactor,
  staleCalendarFactor,
  eventFactor,
  historicalFloorFactor,
  limitsFactor,
  roundingFactor,
];

function resolveMinStay(ctx: NightContext): { minStay: number; source: MinStaySource } {
  const override = overrideFor(ctx);
  if (override?.minStay !== undefined) return { minStay: override.minStay, source: "override" };

  let minStay = ctx.config.defaultMinStay;
  let source: MinStaySource = "default";
  const far = farOutStepFor(ctx);
  const last = lastMinuteStepFor(ctx);
  if (far?.minStay !== undefined) {
    minStay = far.minStay;
    source = "farOut";
  } else if (last?.minStay !== undefined) {
    minStay = last.minStay;
    source = "lastMinute";
  }

  const gaps = ctx.config.factors.gaps;
  if (gaps?.lowerMinStay) {
    const gap = gapFor(ctx);
    if (gap !== null && gap < minStay) return { minStay: gap, source: "gap" };
  }
  return { minStay, source };
}

function overrideFor(ctx: NightContext) {
  const f = ctx.config.factors.overrides;
  if (!f?.enabled) return undefined;
  return f.dates.find((o) => o.date === ctx.date);
}

function priceNight(ctx: NightContext): NightQuote {
  const status = ctx.availability.status(ctx.day);
  if (status !== "available") {
    const quote: NightQuote = {
      date: ctx.date,
      weekday: ctx.weekday,
      status,
      price: null,
      minStay: null,
      minStaySource: null,
      steps: [],
      explanation: "",
    };
    quote.explanation = explainNight(quote, ctx.config.currency);
    return quote;
  }

  const base = cents(ctx.config.basePrice);
  const steps: PriceStep[] = [{ factor: "base", label: "base", before: base, after: base }];
  let price = base;
  for (const factor of PIPELINE) {
    const step = factor(ctx, price);
    if (step) {
      steps.push(step);
      price = step.after;
    }
  }

  const override = overrideFor(ctx);
  if (override?.price !== undefined) {
    const step: PriceStep = { factor: "override", label: "date override", before: price, after: cents(override.price) };
    if (override.note) step.note = override.note;
    steps.push(step);
    price = step.after;
  }

  const { minStay, source } = resolveMinStay(ctx);
  const quote: NightQuote = {
    date: ctx.date,
    weekday: ctx.weekday,
    status,
    price,
    minStay,
    minStaySource: source,
    steps,
    explanation: "",
  };
  quote.explanation = explainNight(quote, ctx.config.currency);
  return quote;
}

/**
 * Price every night of a listing from `options.today` for `options.days` nights.
 *
 * All three inputs are validated first; invalid input throws a ConfigError
 * that lists every problem found. Inputs are never modified.
 */
export function priceListing(listing: unknown, calendar: unknown, options: unknown): PricingResult {
  const config = parseListingConfig(listing);
  const cal = parseCalendar(calendar);
  const opts = parsePricingOptions(options);
  const availability = new Availability(cal);
  const todayDay = toDay(opts.today);
  const history = new PriceHistory(cal.priceHistory);
  const lastBookingDay = dayOrNull(cal.lastBookingReceived);

  const nights: NightQuote[] = [];
  for (let i = 0; i < opts.days; i++) {
    const day = todayDay + i;
    nights.push(
      priceNight({
        config,
        availability,
        day,
        date: fromDay(day),
        weekday: weekdayOf(day),
        leadDays: i,
        todayDay,
        history,
        lastBookingDay,
      }),
    );
  }
  return { listingId: config.listingId, currency: config.currency, today: opts.today, days: opts.days, nights };
}
