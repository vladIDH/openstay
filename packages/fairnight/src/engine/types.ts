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
}

export interface ListingCalendar {
  stays: Stay[];
  /** Prices of nights sold in the past: used by the historical floor. */
  priceHistory?: PastPrice[];
  /** The day the most recent NEW booking arrived (ISO date): used by the stale-calendar discount. */
  lastBookingReceived?: string;
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
  | "event"
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
}

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
}

export interface PricingResult {
  listingId: string;
  currency: string;
  today: string;
  days: number;
  nights: NightQuote[];
}
