/**
 * The pricing factors. Each one looks at a single night and either leaves the
 * running price alone (returns null) or returns the step it applied, with the
 * price before and after. Factors never read the clock, files or the network.
 */
import { inRecurringPeriod, monthDayOf } from "./dates.js";
import { DEFAULT_HISTORICAL_MIN_NIGHTS, DEFAULT_OCCUPANCY_WITHIN_DAYS, DEFAULT_STALE } from "./schema.js";
import type { PriceHistory } from "./history.js";
import type { Availability } from "./calendar.js";
import type { Weekday } from "./dates.js";
import type { FarOutStep, HostEvent, LastMinuteStep, ListingConfig, PriceStep } from "./types.js";

export interface NightContext {
  config: ListingConfig;
  availability: Availability;
  day: number;
  date: string;
  weekday: Weekday;
  /** Days between today and this night (0 = tonight). */
  leadDays: number;
  todayDay: number;
  history: PriceHistory;
  /** Day number of the most recent new booking, or null if unknown. */
  lastBookingDay: number | null;
}

/** "1 day ahead", "5 days ahead". */
function daysAhead(ctx: NightContext): string {
  return `${ctx.leadDays} day${ctx.leadDays === 1 ? "" : "s"} ahead`;
}

/** Money is kept to the cent at every step, so explanations add up exactly. */
export function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percentStep(
  factor: PriceStep["factor"],
  label: string,
  before: number,
  percent: number,
  note?: string,
): PriceStep {
  const step: PriceStep = { factor, label, before, after: cents(before * (1 + percent / 100)), percent };
  if (note !== undefined) step.note = note;
  return step;
}

export function seasonFactor(ctx: NightContext, price: number): PriceStep | null {
  const f = ctx.config.factors.seasons;
  if (!f?.enabled) return null;
  const md = monthDayOf(ctx.day);
  // The first matching period in the list wins.
  const period = f.periods.find((p) => inRecurringPeriod(md, p.start, p.end));
  if (!period) return null;
  if (period.fixedPrice !== undefined) {
    return { factor: "season", label: `season "${period.name}"`, before: price, after: cents(period.fixedPrice), note: "fixed price" };
  }
  const percent = cents(((period.multiplier ?? 1) - 1) * 100);
  return percentStep("season", `season "${period.name}"`, price, percent);
}

export function dayOfWeekFactor(ctx: NightContext, price: number): PriceStep | null {
  const f = ctx.config.factors.dayOfWeek;
  if (!f?.enabled) return null;
  const percent = f.adjustments[ctx.weekday] ?? 0;
  if (percent === 0) return null;
  return percentStep("dayOfWeek", ctx.weekday, price, percent);
}

/** The tightest last-minute step that covers this night (steps sorted by withinDays). */
export function lastMinuteStepFor(ctx: NightContext): LastMinuteStep | null {
  const f = ctx.config.factors.lastMinute;
  if (!f?.enabled) return null;
  return f.steps.find((s) => ctx.leadDays <= s.withinDays) ?? null;
}

/** The farthest far-out step that covers this night (steps sorted by fromDays, descending). */
export function farOutStepFor(ctx: NightContext): FarOutStep | null {
  const f = ctx.config.factors.farOut;
  if (!f?.enabled) return null;
  return f.steps.find((s) => ctx.leadDays >= s.fromDays) ?? null;
}

/** Discount (percent) the last-minute factor would give this night, 0 if none. */
function lastMinuteDiscount(ctx: NightContext): number {
  return lastMinuteStepFor(ctx)?.discountPercent ?? 0;
}

/** Discount (percent) the gap factor would give this night, 0 if none. */
function gapDiscount(ctx: NightContext): number {
  const f = ctx.config.factors.gaps;
  if (!f || gapFor(ctx) === null) return 0;
  return f.discountPercent;
}

// Last-minute and gap discounts never stack: only the larger one applies
// (on a tie, the last-minute discount is kept).

export function lastMinuteFactor(ctx: NightContext, price: number): PriceStep | null {
  const step = lastMinuteStepFor(ctx);
  if (!step || step.discountPercent === 0) return null;
  const gap = gapDiscount(ctx);
  if (gap > step.discountPercent) return null;
  const ahead = daysAhead(ctx);
  const note = gap > 0 ? `${ahead}; gap discount ${gap}% not added` : ahead;
  return percentStep("lastMinute", `last minute (≤${step.withinDays} days)`, price, -step.discountPercent, note);
}

export function farOutFactor(ctx: NightContext, price: number): PriceStep | null {
  const step = farOutStepFor(ctx);
  if (!step || step.premiumPercent === 0) return null;
  return percentStep("farOut", `far out (≥${step.fromDays} days)`, price, step.premiumPercent, daysAhead(ctx));
}

/** Length of the gap this night belongs to, if the gap factor is on. */
export function gapFor(ctx: NightContext): number | null {
  const f = ctx.config.factors.gaps;
  if (!f?.enabled) return null;
  return ctx.availability.gapLength(ctx.day, f.maxNights);
}

export function gapFactor(ctx: NightContext, price: number): PriceStep | null {
  const gap = gapFor(ctx);
  const discount = gapDiscount(ctx);
  if (gap === null || discount === 0) return null;
  const lastMinute = lastMinuteDiscount(ctx);
  if (lastMinute >= discount) return null;
  const label = `gap of ${gap} night${gap === 1 ? "" : "s"}`;
  return percentStep("gap", label, price, -discount, lastMinute > 0 ? `last-minute discount ${lastMinute}% not added` : undefined);
}

export function occupancyFactor(ctx: NightContext, price: number): PriceStep | null {
  const f = ctx.config.factors.occupancy;
  if (!f?.enabled || ctx.leadDays > (f.withinDays ?? DEFAULT_OCCUPANCY_WITHIN_DAYS)) return null;
  const occ = ctx.availability.monthOccupancy(ctx.day, ctx.todayDay);
  if (!occ) return null;
  const shown = `month ${Math.round(occ.percent)}% booked`;
  if (occ.percent >= f.highThresholdPercent && f.raisePercent !== 0) {
    return percentStep("occupancy", "busy month", price, f.raisePercent, shown);
  }
  if (occ.percent <= f.lowThresholdPercent && f.lowerPercent !== 0) {
    return percentStep("occupancy", "quiet month", price, -f.lowerPercent, shown);
  }
  return null;
}

/** Events on this night; the list is sorted by date, then by impact (highest first). */
export function eventsOn(ctx: NightContext): HostEvent[] {
  const f = ctx.config.factors.events;
  if (!f?.enabled) return [];
  return f.list.filter((e) => e.date === ctx.date);
}

export function eventFactor(ctx: NightContext, price: number): PriceStep | null {
  const f = ctx.config.factors.events;
  const events = eventsOn(ctx);
  const top = events[0];
  if (!f || !top) return null;
  // Overlapping events do not add up: the one with the highest impact counts.
  const percent = f.impactPercent?.[`${top.impact}`] ?? 0;
  const note =
    events.length > 1
      ? `highest impact counts; also ${events.slice(1).map((e) => `"${e.name}" (impact ${e.impact})`).join(", ")}`
      : undefined;
  return percentStep("event", `event "${top.name}" (impact ${top.impact})`, price, percent, note);
}

export function limitsFactor(ctx: NightContext, price: number): PriceStep | null {
  const f = ctx.config.factors.limits;
  if (!f?.enabled) return null;
  if (price < f.floorPrice) {
    return { factor: "limits", label: "floor", before: price, after: f.floorPrice, note: `raised to floor ${f.floorPrice}` };
  }
  if (price > f.ceilingPrice) {
    return { factor: "limits", label: "ceiling", before: price, after: f.ceilingPrice, note: `lowered to ceiling ${f.ceilingPrice}` };
  }
  return { factor: "limits", label: "limits", before: price, after: price, note: `within floor ${f.floorPrice} and ceiling ${f.ceilingPrice}` };
}

export function roundingFactor(ctx: NightContext, price: number): PriceStep | null {
  const f = ctx.config.factors.rounding;
  if (!f?.enabled) return null;
  let after = cents(Math.round(price / f.step) * f.step);
  // Rounding must never push the price back outside the limits.
  const limits = ctx.config.factors.limits;
  if (limits?.enabled) {
    if (after > limits.ceilingPrice) after = limits.ceilingPrice;
    if (after < limits.floorPrice) after = limits.floorPrice;
  }
  if (after === price) return null;
  return { factor: "rounding", label: `rounded to ${f.step}`, before: price, after };
}

/**
 * No new booking for a while: a discount that grows by stepPercent every
 * everyDays, up to maxPercent, on the next withinDays nights. It disappears by
 * itself as soon as a new booking arrives (lastBookingReceived moves).
 */
export function staleCalendarFactor(ctx: NightContext, price: number): PriceStep | null {
  const f = ctx.config.factors.staleCalendar;
  if (!f?.enabled || ctx.lastBookingDay === null) return null;
  if (ctx.leadDays > (f.withinDays ?? DEFAULT_STALE.withinDays)) return null;
  const idle = ctx.todayDay - ctx.lastBookingDay;
  if (idle < f.afterDays) return null;
  const steps = 1 + Math.floor((idle - f.afterDays) / (f.everyDays ?? DEFAULT_STALE.everyDays));
  const percent = Math.min(f.maxPercent, cents(f.stepPercent * steps));
  return percentStep("staleCalendar", "no new bookings", price, -percent, `${idle} days since the last new booking`);
}

/**
 * Never below a share of what the same month sold for a year earlier, when
 * there is enough history for that month.
 */
export function historicalFloorFactor(ctx: NightContext, price: number): PriceStep | null {
  const f = ctx.config.factors.historicalFloor;
  if (!f?.enabled) return null;
  const month = ctx.history.sameMonthLastYear(ctx.day);
  if (!month || month.nights < (f.minNights ?? DEFAULT_HISTORICAL_MIN_NIGHTS)) return null;
  const floor = cents((month.average * f.percent) / 100);
  if (price >= floor) return null;
  return {
    factor: "historicalFloor",
    label: "historical floor",
    before: price,
    after: floor,
    note: `${f.percent}% of the ${month.month} average of ${month.average} over ${month.nights} sold nights`,
  };
}
