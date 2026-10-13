/**
 * Validation of a listing configuration and of a calendar.
 *
 * Hand-written on purpose: the engine has no runtime dependencies. Every problem
 * is reported with the path of the field and a plain message, and validation
 * returns ALL problems at once, not just the first one. Unknown fields are
 * errors too, so a typo ("celingPrice") never goes unnoticed.
 */
import { WEEKDAYS, isIsoDate, isMonthDay } from "./dates.js";
import type {
  DateOverride,
  FarOutStep,
  HostEvent,
  Impact,
  LastMinuteStep,
  ListingCalendar,
  ListingConfig,
  MarketData,
  PricingOptions,
  Stay,
} from "./types.js";

export interface ConfigIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ConfigIssue[] };

export class ConfigError extends Error {
  readonly issues: ConfigIssue[];
  constructor(what: string, issues: ConfigIssue[]) {
    super(`Invalid ${what}:\n` + issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n"));
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export const DEFAULT_IMPACT_PERCENT: Record<`${Impact}`, number> = {
  "1": 0,
  "2": 5,
  "3": 12,
  "4": 25,
  "5": 40,
};

export const DEFAULT_OCCUPANCY_WITHIN_DAYS = 60;
export const DEFAULT_STALE = { everyDays: 7, withinDays: 30 } as const;
export const DEFAULT_HISTORICAL_MIN_NIGHTS = 3;
/** Prudent on purpose: the zone moves the price by half its own swing, at most +15% or -10%. */
export const DEFAULT_MARKET = {
  weight: 0.5,
  highPercent: 10,
  lowPercent: 10,
  maxRaisePercent: 15,
  maxLowerPercent: 10,
  withinDays: 365,
  minComparables: 5,
} as const;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === undefined) return "missing";
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

class Checker {
  readonly issues: ConfigIssue[] = [];

  fail(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  object(v: unknown, path: string, allowed: readonly string[]): v is Obj {
    if (!isObj(v)) {
      this.fail(path, `must be an object, got ${describe(v)}`);
      return false;
    }
    for (const key of Object.keys(v)) {
      if (!allowed.includes(key)) {
        this.fail(`${path}.${key}`, `unknown field (allowed: ${allowed.join(", ")})`);
      }
    }
    return true;
  }

  list(v: unknown, path: string): v is unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, `must be a list, got ${describe(v)}`);
      return false;
    }
    return true;
  }

  string(v: unknown, path: string): v is string {
    if (typeof v !== "string" || v.trim() === "") {
      this.fail(path, `must be a non-empty text, got ${describe(v)}`);
      return false;
    }
    return true;
  }

  bool(v: unknown, path: string): v is boolean {
    if (typeof v !== "boolean") {
      this.fail(path, `must be true or false, got ${describe(v)}`);
      return false;
    }
    return true;
  }

  number(
    v: unknown,
    path: string,
    opts: { min?: number; max?: number; positive?: boolean; integer?: boolean } = {},
  ): v is number {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.fail(path, `must be a number, got ${describe(v)}`);
      return false;
    }
    if (opts.integer && !Number.isInteger(v)) {
      this.fail(path, `must be a whole number, got ${v}`);
      return false;
    }
    if (opts.positive && v <= 0) {
      this.fail(path, `must be greater than 0, got ${v}`);
      return false;
    }
    if (opts.min !== undefined && v < opts.min) {
      this.fail(path, `must be at least ${opts.min}, got ${v}`);
      return false;
    }
    if (opts.max !== undefined && v > opts.max) {
      this.fail(path, `must be at most ${opts.max}, got ${v}`);
      return false;
    }
    return true;
  }

  isoDate(v: unknown, path: string): v is string {
    if (!isIsoDate(v)) {
      this.fail(path, `must be a date like 2026-12-31, got ${describe(v)}`);
      return false;
    }
    return true;
  }

  monthDay(v: unknown, path: string): v is string {
    if (!isMonthDay(v)) {
      this.fail(path, `must be a month-day like 12-31, got ${describe(v)}`);
      return false;
    }
    return true;
  }

  minStay(v: unknown, path: string): v is number {
    return this.number(v, path, { integer: true, min: 1, max: 365 });
  }
}

const PERCENT = { min: -90, max: 500 };
const DISCOUNT = { min: 0, max: 90 };
const PREMIUM = { min: 0, max: 500 };

function validateSeasons(c: Checker, v: unknown, path: string): void {
  if (!c.object(v, path, ["enabled", "periods"])) return;
  c.bool(v.enabled, `${path}.enabled`);
  if (!c.list(v.periods, `${path}.periods`)) return;
  v.periods.forEach((p, i) => {
    const pp = `${path}.periods[${i}]`;
    if (!c.object(p, pp, ["name", "start", "end", "multiplier", "fixedPrice"])) return;
    c.string(p.name, `${pp}.name`);
    c.monthDay(p.start, `${pp}.start`);
    c.monthDay(p.end, `${pp}.end`);
    const hasMult = p.multiplier !== undefined;
    const hasFixed = p.fixedPrice !== undefined;
    if (hasMult === hasFixed) {
      c.fail(pp, "set exactly one of multiplier or fixedPrice");
    }
    if (hasMult) c.number(p.multiplier, `${pp}.multiplier`, { positive: true, max: 10 });
    if (hasFixed) c.number(p.fixedPrice, `${pp}.fixedPrice`, { positive: true });
  });
}

function validateSteps(
  c: Checker,
  v: unknown,
  path: string,
  dayKey: "withinDays" | "fromDays",
  pctKey: "discountPercent" | "premiumPercent",
): void {
  if (!c.object(v, path, ["enabled", "steps"])) return;
  c.bool(v.enabled, `${path}.enabled`);
  if (!c.list(v.steps, `${path}.steps`)) return;
  const seen = new Set<number>();
  v.steps.forEach((s, i) => {
    const sp = `${path}.steps[${i}]`;
    if (!c.object(s, sp, [dayKey, pctKey, "minStay"])) return;
    if (c.number(s[dayKey], `${sp}.${dayKey}`, { integer: true, min: 0, max: 730 })) {
      const d = s[dayKey] as number;
      if (seen.has(d)) c.fail(`${sp}.${dayKey}`, `${d} is used by another step`);
      seen.add(d);
    }
    c.number(s[pctKey], `${sp}.${pctKey}`, pctKey === "discountPercent" ? DISCOUNT : PREMIUM);
    if (s.minStay !== undefined) c.minStay(s.minStay, `${sp}.minStay`);
  });
}

function validateEvents(c: Checker, v: unknown, path: string): void {
  if (!c.object(v, path, ["enabled", "impactPercent", "list"])) return;
  c.bool(v.enabled, `${path}.enabled`);
  if (v.impactPercent !== undefined && c.object(v.impactPercent, `${path}.impactPercent`, ["1", "2", "3", "4", "5"])) {
    for (const [k, pct] of Object.entries(v.impactPercent)) {
      c.number(pct, `${path}.impactPercent.${k}`, PERCENT);
    }
  }
  if (!c.list(v.list, `${path}.list`)) return;
  v.list.forEach((e, i) => {
    const ep = `${path}.list[${i}]`;
    if (!c.object(e, ep, ["date", "name", "impact"])) return;
    c.isoDate(e.date, `${ep}.date`);
    c.string(e.name, `${ep}.name`);
    c.number(e.impact, `${ep}.impact`, { integer: true, min: 1, max: 5 });
  });
}

function validateOverrides(c: Checker, v: unknown, path: string): void {
  if (!c.object(v, path, ["enabled", "dates"])) return;
  c.bool(v.enabled, `${path}.enabled`);
  if (!c.list(v.dates, `${path}.dates`)) return;
  const seen = new Set<string>();
  v.dates.forEach((o, i) => {
    const op = `${path}.dates[${i}]`;
    if (!c.object(o, op, ["date", "price", "minStay", "note"])) return;
    if (c.isoDate(o.date, `${op}.date`)) {
      if (seen.has(o.date)) c.fail(`${op}.date`, `${o.date} already has an override`);
      seen.add(o.date);
    }
    if (o.price === undefined && o.minStay === undefined) {
      c.fail(op, "set price, minStay or both");
    }
    if (o.price !== undefined) c.number(o.price, `${op}.price`, { positive: true });
    if (o.minStay !== undefined) c.minStay(o.minStay, `${op}.minStay`);
    if (o.note !== undefined && typeof o.note !== "string") c.fail(`${op}.note`, "must be a text");
  });
}

const FACTOR_KEYS = [
  "limits",
  "seasons",
  "dayOfWeek",
  "lastMinute",
  "farOut",
  "gaps",
  "occupancy",
  "events",
  "staleCalendar",
  "historicalFloor",
  "market",
  "rounding",
  "overrides",
] as const;

const MARKET_KEYS = ["enabled", "weight", "highPercent", "lowPercent", "maxRaisePercent", "maxLowerPercent", "withinDays", "minComparables"] as const;

function validateMarket(c: Checker, v: unknown, path: string): void {
  if (!c.object(v, path, MARKET_KEYS)) return;
  c.bool(v.enabled, `${path}.enabled`);
  if (v.weight !== undefined) c.number(v.weight, `${path}.weight`, { min: 0, max: 1 });
  if (v.highPercent !== undefined) c.number(v.highPercent, `${path}.highPercent`, { min: 0, max: 100 });
  if (v.lowPercent !== undefined) c.number(v.lowPercent, `${path}.lowPercent`, { min: 0, max: 100 });
  if (v.maxRaisePercent !== undefined) c.number(v.maxRaisePercent, `${path}.maxRaisePercent`, { min: 0, max: 100 });
  if (v.maxLowerPercent !== undefined) c.number(v.maxLowerPercent, `${path}.maxLowerPercent`, DISCOUNT);
  if (v.withinDays !== undefined) c.number(v.withinDays, `${path}.withinDays`, { integer: true, min: 0, max: 1096 });
  if (v.minComparables !== undefined) c.number(v.minComparables, `${path}.minComparables`, { integer: true, min: 0, max: 100000 });
}

function validateMarketData(c: Checker, v: unknown, path: string): void {
  if (!c.object(v, path, ["source", "attribution", "area", "readOn", "estimated", "days"])) return;
  c.string(v.source, `${path}.source`);
  c.string(v.attribution, `${path}.attribution`);
  if (v.area !== undefined) c.string(v.area, `${path}.area`);
  if (v.readOn !== undefined) c.isoDate(v.readOn, `${path}.readOn`);
  if (v.estimated !== undefined) c.bool(v.estimated, `${path}.estimated`);
  if (!c.list(v.days, `${path}.days`)) return;
  const seen = new Set<string>();
  v.days.forEach((d, i) => {
    const dp = `${path}.days[${i}]`;
    if (!c.object(d, dp, ["date", "occupancyPercent", "averagePrice", "comparables"])) return;
    if (c.isoDate(d.date, `${dp}.date`)) {
      if (seen.has(d.date)) c.fail(`${dp}.date`, `${d.date} appears twice`);
      seen.add(d.date);
    }
    if (d.occupancyPercent === undefined && d.averagePrice === undefined) c.fail(dp, "set occupancyPercent, averagePrice or both");
    if (d.occupancyPercent !== undefined) c.number(d.occupancyPercent, `${dp}.occupancyPercent`, { min: 0, max: 100 });
    if (d.averagePrice !== undefined) c.number(d.averagePrice, `${dp}.averagePrice`, { positive: true });
    if (d.comparables !== undefined) c.number(d.comparables, `${dp}.comparables`, { integer: true, min: 0 });
  });
}

function checkListing(c: Checker, input: unknown): void {
  if (!c.object(input, "listing", ["listingId", "name", "currency", "basePrice", "defaultMinStay", "factors"])) {
    return;
  }
  c.string(input.listingId, "listing.listingId");
  if (input.name !== undefined) c.string(input.name, "listing.name");
  if (c.string(input.currency, "listing.currency") && !/^[A-Z]{3}$/.test(input.currency)) {
    c.fail("listing.currency", `must be a 3-letter code like EUR, got "${input.currency}"`);
  }
  c.number(input.basePrice, "listing.basePrice", { positive: true });
  c.minStay(input.defaultMinStay, "listing.defaultMinStay");

  const f = input.factors;
  if (!c.object(f, "listing.factors", FACTOR_KEYS)) return;
  const p = "listing.factors";

  if (f.limits !== undefined && c.object(f.limits, `${p}.limits`, ["enabled", "floorPrice", "ceilingPrice"])) {
    c.bool(f.limits.enabled, `${p}.limits.enabled`);
    const okFloor = c.number(f.limits.floorPrice, `${p}.limits.floorPrice`, { positive: true });
    const okCeil = c.number(f.limits.ceilingPrice, `${p}.limits.ceilingPrice`, { positive: true });
    if (okFloor && okCeil && (f.limits.floorPrice as number) > (f.limits.ceilingPrice as number)) {
      c.fail(`${p}.limits`, `floorPrice (${f.limits.floorPrice}) is higher than ceilingPrice (${f.limits.ceilingPrice})`);
    }
  }
  if (f.seasons !== undefined) validateSeasons(c, f.seasons, `${p}.seasons`);
  if (f.dayOfWeek !== undefined && c.object(f.dayOfWeek, `${p}.dayOfWeek`, ["enabled", "adjustments"])) {
    c.bool(f.dayOfWeek.enabled, `${p}.dayOfWeek.enabled`);
    if (c.object(f.dayOfWeek.adjustments, `${p}.dayOfWeek.adjustments`, WEEKDAYS)) {
      for (const [day, pct] of Object.entries(f.dayOfWeek.adjustments)) {
        c.number(pct, `${p}.dayOfWeek.adjustments.${day}`, PERCENT);
      }
    }
  }
  if (f.lastMinute !== undefined) {
    validateSteps(c, f.lastMinute, `${p}.lastMinute`, "withinDays", "discountPercent");
  }
  if (f.farOut !== undefined) validateSteps(c, f.farOut, `${p}.farOut`, "fromDays", "premiumPercent");
  if (
    f.gaps !== undefined &&
    c.object(f.gaps, `${p}.gaps`, ["enabled", "maxNights", "discountPercent", "lowerMinStay"])
  ) {
    c.bool(f.gaps.enabled, `${p}.gaps.enabled`);
    c.number(f.gaps.maxNights, `${p}.gaps.maxNights`, { integer: true, min: 1, max: 14 });
    c.number(f.gaps.discountPercent, `${p}.gaps.discountPercent`, DISCOUNT);
    c.bool(f.gaps.lowerMinStay, `${p}.gaps.lowerMinStay`);
  }
  if (
    f.occupancy !== undefined &&
    c.object(f.occupancy, `${p}.occupancy`, [
      "enabled",
      "highThresholdPercent",
      "raisePercent",
      "lowThresholdPercent",
      "lowerPercent",
      "withinDays",
    ])
  ) {
    const o = f.occupancy;
    c.bool(o.enabled, `${p}.occupancy.enabled`);
    const okHigh = c.number(o.highThresholdPercent, `${p}.occupancy.highThresholdPercent`, { min: 0, max: 100 });
    const okLow = c.number(o.lowThresholdPercent, `${p}.occupancy.lowThresholdPercent`, { min: 0, max: 100 });
    c.number(o.raisePercent, `${p}.occupancy.raisePercent`, PREMIUM);
    c.number(o.lowerPercent, `${p}.occupancy.lowerPercent`, DISCOUNT);
    if (o.withinDays !== undefined) c.number(o.withinDays, `${p}.occupancy.withinDays`, { integer: true, min: 0, max: 730 });
    if (okHigh && okLow && (o.lowThresholdPercent as number) >= (o.highThresholdPercent as number)) {
      c.fail(`${p}.occupancy`, "lowThresholdPercent must be lower than highThresholdPercent");
    }
  }
  if (f.events !== undefined) validateEvents(c, f.events, `${p}.events`);
  if (
    f.staleCalendar !== undefined &&
    c.object(f.staleCalendar, `${p}.staleCalendar`, ["enabled", "afterDays", "stepPercent", "everyDays", "maxPercent", "withinDays"])
  ) {
    const st = f.staleCalendar;
    c.bool(st.enabled, `${p}.staleCalendar.enabled`);
    c.number(st.afterDays, `${p}.staleCalendar.afterDays`, { integer: true, min: 1, max: 365 });
    const okStep = c.number(st.stepPercent, `${p}.staleCalendar.stepPercent`, { positive: true, max: 90 });
    if (st.everyDays !== undefined) c.number(st.everyDays, `${p}.staleCalendar.everyDays`, { integer: true, min: 1, max: 365 });
    const okMax = c.number(st.maxPercent, `${p}.staleCalendar.maxPercent`, { positive: true, max: 90 });
    if (st.withinDays !== undefined) c.number(st.withinDays, `${p}.staleCalendar.withinDays`, { integer: true, min: 0, max: 730 });
    if (okStep && okMax && (st.stepPercent as number) > (st.maxPercent as number)) {
      c.fail(`${p}.staleCalendar`, "stepPercent must not be higher than maxPercent");
    }
  }
  if (
    f.historicalFloor !== undefined &&
    c.object(f.historicalFloor, `${p}.historicalFloor`, ["enabled", "percent", "minNights"])
  ) {
    c.bool(f.historicalFloor.enabled, `${p}.historicalFloor.enabled`);
    c.number(f.historicalFloor.percent, `${p}.historicalFloor.percent`, { positive: true, max: 200 });
    if (f.historicalFloor.minNights !== undefined) {
      c.number(f.historicalFloor.minNights, `${p}.historicalFloor.minNights`, { integer: true, min: 1, max: 31 });
    }
  }
  if (f.market !== undefined) validateMarket(c, f.market, `${p}.market`);
  if (f.rounding !== undefined && c.object(f.rounding, `${p}.rounding`, ["enabled", "step"])) {
    c.bool(f.rounding.enabled, `${p}.rounding.enabled`);
    c.number(f.rounding.step, `${p}.rounding.step`, { positive: true });
  }
  if (f.overrides !== undefined) validateOverrides(c, f.overrides, `${p}.overrides`);
}

/**
 * Validate a listing configuration (for instance parsed from JSON).
 * On success returns a normalised deep copy: steps sorted, defaults filled in.
 */
export function validateListingConfig(input: unknown): ValidationResult<ListingConfig> {
  const c = new Checker();
  checkListing(c, input);
  if (c.issues.length > 0) return { ok: false, issues: c.issues };
  return { ok: true, value: normalise(input as ListingConfig) };
}

/** Like validateListingConfig, but throws a ConfigError listing every problem. */
export function parseListingConfig(input: unknown): ListingConfig {
  const r = validateListingConfig(input);
  if (!r.ok) throw new ConfigError("listing configuration", r.issues);
  return r.value;
}

function normalise(cfg: ListingConfig): ListingConfig {
  // Validated input is plain JSON data, so a JSON round trip is a complete deep copy.
  const copy = JSON.parse(JSON.stringify(cfg)) as ListingConfig;
  const f = copy.factors;
  if (f.lastMinute) f.lastMinute.steps.sort((a: LastMinuteStep, b: LastMinuteStep) => a.withinDays - b.withinDays);
  if (f.farOut) f.farOut.steps.sort((a: FarOutStep, b: FarOutStep) => b.fromDays - a.fromDays);
  if (f.events) {
    f.events.impactPercent = { ...DEFAULT_IMPACT_PERCENT, ...f.events.impactPercent };
    f.events.list.sort((a: HostEvent, b: HostEvent) => a.date.localeCompare(b.date) || b.impact - a.impact);
  }
  if (f.occupancy && f.occupancy.withinDays === undefined) f.occupancy.withinDays = DEFAULT_OCCUPANCY_WITHIN_DAYS;
  if (f.staleCalendar) {
    f.staleCalendar.everyDays ??= DEFAULT_STALE.everyDays;
    f.staleCalendar.withinDays ??= DEFAULT_STALE.withinDays;
  }
  if (f.historicalFloor) f.historicalFloor.minNights ??= DEFAULT_HISTORICAL_MIN_NIGHTS;
  if (f.market) f.market = { ...DEFAULT_MARKET, ...f.market };
  if (f.overrides) f.overrides.dates.sort((a: DateOverride, b: DateOverride) => a.date.localeCompare(b.date));
  return copy;
}

/** Validate the stays of a listing. */
export function validateCalendar(input: unknown): ValidationResult<ListingCalendar> {
  const c = new Checker();
  if (!c.object(input, "calendar", ["stays", "priceHistory", "lastBookingReceived", "market"])) {
    return { ok: false, issues: c.issues };
  }
  if (input.lastBookingReceived !== undefined) c.isoDate(input.lastBookingReceived, "calendar.lastBookingReceived");
  if (input.market !== undefined) validateMarketData(c, input.market, "calendar.market");
  if (input.priceHistory !== undefined && c.list(input.priceHistory, "calendar.priceHistory")) {
    input.priceHistory.forEach((p, i) => {
      const pp = `calendar.priceHistory[${i}]`;
      if (!c.object(p, pp, ["date", "price"])) return;
      c.isoDate(p.date, `${pp}.date`);
      c.number(p.price, `${pp}.price`, { positive: true });
    });
  }
  if (c.list(input.stays, "calendar.stays")) {
    input.stays.forEach((s, i) => {
      const sp = `calendar.stays[${i}]`;
      if (!c.object(s, sp, ["checkIn", "checkOut", "kind"])) return;
      const okIn = c.isoDate(s.checkIn, `${sp}.checkIn`);
      const okOut = c.isoDate(s.checkOut, `${sp}.checkOut`);
      if (okIn && okOut && (s.checkOut as string) <= (s.checkIn as string)) {
        c.fail(sp, `checkOut (${s.checkOut}) must be after checkIn (${s.checkIn})`);
      }
      if (s.kind !== undefined && s.kind !== "reservation" && s.kind !== "blocked") {
        c.fail(`${sp}.kind`, `must be "reservation" or "blocked", got ${describe(s.kind)}`);
      }
    });
  }
  if (c.issues.length > 0) return { ok: false, issues: c.issues };
  const cal = input as unknown as ListingCalendar;
  const value: ListingCalendar = { stays: cal.stays.map((s: Stay) => ({ ...s })) };
  if (cal.priceHistory) value.priceHistory = cal.priceHistory.map((p) => ({ date: p.date, price: p.price }));
  if (cal.lastBookingReceived) value.lastBookingReceived = cal.lastBookingReceived;
  if (cal.market) value.market = JSON.parse(JSON.stringify(cal.market)) as MarketData;
  return { ok: true, value };
}

export function parseCalendar(input: unknown): ListingCalendar {
  const r = validateCalendar(input);
  if (!r.ok) throw new ConfigError("calendar", r.issues);
  return r.value;
}

export function parsePricingOptions(input: unknown): PricingOptions {
  const c = new Checker();
  if (c.object(input, "options", ["today", "days"])) {
    c.isoDate(input.today, "options.today");
    c.number(input.days, "options.days", { integer: true, min: 1, max: 1096 });
  }
  if (c.issues.length > 0) throw new ConfigError("pricing options", c.issues);
  return { ...(input as PricingOptions) };
}
