import type { Weekday } from "./dates.js";

/** Impact scale of a host event: 1 (barely noticeable) … 5 (exceptional). */
export type Impact = 1 | 2 | 3 | 4 | 5;

export interface SeasonPeriod {
  name: string;
  /** "MM-DD", inclusive. Repeats every year. */
  start: string;
  /** "MM-DD", inclusive. May be earlier than `start` to wrap the new year. */
  end: string;
  /** Multiplies the running price (1.15 = +15%). Use this OR `fixedPrice`. */
  multiplier?: number;
  /** Replaces the running price for the period. Use this OR `multiplier`. */
  fixedPrice?: number;
}

export interface LastMinuteStep {
  /** Applies when the night is at most this many days away (0 = tonight). */
  withinDays: number;
  discountPercent: number;
  /** Optional minimum stay for nights in this step. */
  minStay?: number;
}

export interface FarOutStep {
  /** Applies when the night is at least this many days away. */
  fromDays: number;
  premiumPercent: number;
  /** Optional minimum stay for nights in this step. */
  minStay?: number;
}

export interface ScarcityStep {
  /** Applies when at least this share of the units of the night is taken (booked or closed), 1–100. */
  takenPercent: number;
  raisePercent: number;
}

export interface HostEvent {
  /** ISO date of the night affected. */
  date: string;
  name: string;
  impact: Impact;
}

export interface DateOverride {
  date: string;
  /** Final price for the night: wins over every factor, floor and ceiling included. */
  price?: number;
  /** Minimum stay for the night: wins over every other min-stay rule. */
  minStay?: number;
  note?: string;
}

export interface ListingConfig {
  listingId: string;
  name?: string;
  /** ISO 4217 code, e.g. "EUR". Only used for display. */
  currency: string;
  basePrice: number;
  defaultMinStay: number;
  /**
   * Identical units sold at this one price: 1 (default) for a home, N for a
   * room type of a small hotel ("Double", 6 rooms). Occupancy, gaps and the
   * other rules then look at how many units are still free.
   */
  units?: number;
  factors: {
    limits?: { enabled: boolean; floorPrice: number; ceilingPrice: number };
    seasons?: { enabled: boolean; periods: SeasonPeriod[] };
    dayOfWeek?: { enabled: boolean; adjustments: Partial<Record<Weekday, number>> };
    lastMinute?: { enabled: boolean; steps: LastMinuteStep[] };
    farOut?: { enabled: boolean; steps: FarOutStep[] };
    gaps?: {
      enabled: boolean;
      /** Free stretches of up to this many nights between two stays count as gaps. */
      maxNights: number;
      discountPercent: number;
      /** Lower the minimum stay to the gap length, so a single booking can fill it. */
      lowerMinStay: boolean;
    };
    occupancy?: {
      enabled: boolean;
      /** At or above this share of the month booked, raise prices. */
      highThresholdPercent: number;
      raisePercent: number;
      /** At or below this share of the month booked, lower prices. */
      lowThresholdPercent: number;
      lowerPercent: number;
      /** Only nights at most this many days ahead are adjusted (default 60): far months are always empty. */
      withinDays?: number;
    };
    events?: {
      enabled: boolean;
      /** Price change per impact level, in percent. Defaults: 0, 5, 12, 25, 40. */
      impactPercent?: Partial<Record<`${Impact}`, number>>;
      list: HostEvent[];
    };
    staleCalendar?: {
      enabled: boolean;
      /** The discount starts when no new booking has arrived for this many days. */
      afterDays: number;
      /** First discount, then added again every `everyDays` days (default 7). */
      stepPercent: number;
      everyDays?: number;
      /** The discount never goes above this. */
      maxPercent: number;
      /** Only nights at most this many days ahead are discounted (default 30). */
      withinDays?: number;
    };
    historicalFloor?: {
      enabled: boolean;
      /** Never below this share of last year's average sold price for the same month. */
      percent: number;
      /** Ignore months with fewer sold nights than this (default 3). */
      minNights?: number;
    };
    scarcity?: {
      enabled: boolean;
      /**
       * Raise the price as the units of a night run out: the highest step whose
       * takenPercent is reached applies. Only with units > 1.
       */
      steps: ScarcityStep[];
      /** Never raise by more than this, whatever the steps say (default 20). */
      maxRaisePercent?: number;
    };
    market?: {
      enabled: boolean;
      /** Share of the zone's difference from its average passed on to the price, 0–1 (default 0.5). */
      weight?: number;
      /** The zone must be at least this much busier than its average (relative %, default 10) to raise prices. */
      highPercent?: number;
      /** The zone must be at least this much quieter than its average (relative %, default 10) to lower prices. */
      lowPercent?: number;
      /** Never raise by more than this (default 15). */
      maxRaisePercent?: number;
      /** Never lower by more than this (default 10). */
      maxLowerPercent?: number;
      /** Only nights at most this many days ahead are adjusted (default 365). */
      withinDays?: number;
      /** Ignore zone nights measured on fewer comparable listings than this (default 5). */
      minComparables?: number;
    };
    rounding?: { enabled: boolean; step: number };
    overrides?: { enabled: boolean; dates: DateOverride[] };
  };
}

/** A night sold in the past and its price. */
export interface PastPrice {
  date: string;
  price: number;
}

export interface Stay {
  /** First night (ISO date). */
  checkIn: string;
  /** Departure day (ISO date): the night before is the last one occupied. */
  checkOut: string;
  /** "reservation" (default) or "blocked" (owner use, maintenance…). */
  kind?: "reservation" | "blocked";
  /**
   * The unit (room) this stay is on, e.g. "101", when it is known. Stays of the
   * same unit are merged, so two calendars of one room never count it twice.
   */
  unit?: string;
  /** Units taken by a stay without `unit` (default 1), e.g. one booking of 2 rooms. */
  units?: number;
}

/** What the zone looked like on one night, from a market source. */
export interface MarketDay {
  date: string;
  /** Share of the zone's comparable listings booked that night, 0–100. */
  occupancyPercent?: number;
  /** Average nightly price of the zone that night. */
  averagePrice?: number;
  /** How many comparable listings the figures of that night are measured on. */
  comparables?: number;
}

/**
 * Zone data for one listing, already read by an adapter (CSV, Inside Airbnb,
 * AirROI…). The engine never fetches it: it only compares each night with the
 * zone's own average.
 */
export interface MarketData {
  /** Short name of the source, e.g. "csv", "insideairbnb", "airroi". */
  source: string;
  /** Shown in every explanation that uses the data, e.g. "powered by AirROI". */
  attribution: string;
  /** Name of the zone, e.g. "adeje". */
  area?: string;
  /** The day the data was read or imported (ISO date). */
  readOn?: string;
  /** True when the occupancy is an estimate (for instance booked and blocked nights cannot be told apart). */
  estimated?: boolean;
  days: MarketDay[];
}

export interface ListingCalendar {
  stays: Stay[];
  /** Prices of nights sold in the past: used by the historical floor. */
  priceHistory?: PastPrice[];
  /** The day the most recent NEW booking arrived (ISO date): used by the stale-calendar discount. */
  lastBookingReceived?: string;
  /** Zone data: used by the market factor. */
  market?: MarketData;
}

export interface PricingOptions {
  /** The first night to price (ISO date). There is no hidden "now". */
  today: string;
  /** How many nights to price, starting from `today`. */
  days: number;
}

export type FactorId =
  | "base"
  | "season"
  | "dayOfWeek"
  | "lastMinute"
  | "farOut"
  | "gap"
  | "occupancy"
  | "scarcity"
  | "event"
  | "market"
  | "limits"
  | "staleCalendar"
  | "historicalFloor"
  | "rounding"
  | "override";

export interface PriceStep {
  factor: FactorId;
  /** Short human label, e.g. `season "High season"`. */
  label: string;
  before: number;
  after: number;
  /** Percentage change applied by this step, when it is a percentage. */
  percent?: number;
  /** Extra detail, e.g. "ceiling not reached". */
  note?: string;
  /**
   * The same facts as label and note, as data, so a page can say them in the
   * host's language without parsing English. See StepParams for each factor.
   */
  params?: StepParams;
}

/**
 * Facts behind a step, by factor (names written by the host stay as written):
 * - season: name, fixed (true for a fixed price)
 * - dayOfWeek: weekday
 * - lastMinute: withinDays, daysAhead, gapNotAdded (gap discount % left out)
 * - farOut: fromDays, daysAhead
 * - gap: nights, lastMinuteNotAdded (last-minute discount % left out)
 * - occupancy: kind ("busy" | "quiet"), monthPercent
 * - scarcity: takenPercent (the step), free, total, takenNow, cap (when capped)
 * - market: signal ("occupancy" | "price"), value, average, attribution, area, cap, comparables, estimated, readOn
 * - event: name, impact, others (other events that night)
 * - limits: kind ("floor" | "ceiling" | "within"), floor, ceiling
 * - staleCalendar: idleDays
 * - historicalFloor: percent, month, average, nights
 * - rounding: step
 */
export type StepParams = Record<string, string | number | boolean>;

export type MinStaySource = "override" | "farOut" | "lastMinute" | "default" | "gap";

export interface NightQuote {
  date: string;
  weekday: Weekday;
  status: "available" | "reserved" | "blocked";
  /** Null when the night is not for sale. */
  price: number | null;
  minStay: number | null;
  minStaySource: MinStaySource | null;
  steps: PriceStep[];
  /** One-line explanation of how price and minimum stay were decided. */
  explanation: string;
  /** Units of the night: only for listings with more than one unit. */
  units?: NightUnits;
}

/** How the units of one night are taken. `free + reserved + blocked = total`. */
export interface NightUnits {
  total: number;
  free: number;
  reserved: number;
  blocked: number;
  /** Units taken beyond the total (an overbooking on the channel), when there are any. */
  overbooked?: number;
}

export interface PricingResult {
  listingId: string;
  currency: string;
  today: string;
  days: number;
  nights: NightQuote[];
}
