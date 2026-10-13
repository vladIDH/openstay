/**
 * A small client for the AirROI API (api.airroi.com), used with the HOST's own
 * API key, for the host's own pricing. There is no Fairnight key and no hosted
 * service in between: the request goes from the host's computer to AirROI.
 *
 * Only zone metrics, on purpose:
 * - GET  /markets/search        find the market (country, region, locality) of a place;
 * - POST /markets/metrics/all   monthly occupancy, average daily rate and active listings of a market.
 * The client cannot call anything else: never the price recommendation
 * endpoints, never listing-level data.
 *
 * Terms (airroi.com/tos, 10 September 2026) the callers must honour:
 * - attribution "powered by AirROI" wherever the data is shown (§5.3(c));
 * - no data kept beyond 30 days (§10), all of it deleted on request (§32).
 * Every call is paid by the host: see airroi.com/api/pricing.
 * The key never appears in an error message.
 */
import type { MarketDay } from "fairnight";

export const AIRROI_BASE_URL = "https://api.airroi.com";
export const AIRROI_ATTRIBUTION = "powered by AirROI";
/** AirROI's terms: API data is not kept for more than 30 days (§10). */
export const AIRROI_MAX_DAYS = 30;
const MAX_RETRIES = 3;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export class AirRoiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "AirRoiError";
  }
}

export interface AirRoiMarket {
  country: string;
  region: string;
  locality: string;
  district?: string;
}

export interface AirRoiFilter {
  /** AirROI's room types, e.g. "entire_home", "private_room". */
  roomType?: string;
  bedrooms?: number;
}

export interface MarketSearchEntry extends AirRoiMarket {
  fullName: string;
  nativeCurrency: string | null;
  activeListings: number | null;
}

/** One month of zone figures. */
export interface MonthlyMetrics {
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  /** 0–100. */
  occupancyPercent: number | null;
  averageDailyRate: number | null;
  activeListings: number | null;
}

export interface AirRoiClientOptions {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** The only calls this client can make. */
const ENDPOINTS = {
  search: { method: "GET", path: "/markets/search" },
  metrics: { method: "POST", path: "/markets/metrics/all" },
} as const;

type Endpoint = keyof typeof ENDPOINTS;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A metric is either a number or an object with "avg". */
const avgOf = (v: unknown): number | null => (isObj(v) ? num(v.avg) : num(v));
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export class AirRoiClient {
  /** Calls made by this client: each one is billed by AirROI. */
  calls = 0;
  private readonly baseUrl: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: AirRoiClientOptions) {
    this.baseUrl = (options.baseUrl ?? AIRROI_BASE_URL).replace(/\/$/, "");
    this.sleep = options.sleep ?? realSleep;
  }

  async searchMarkets(query: string): Promise<MarketSearchEntry[]> {
    const body = await this.call("search", { query });
    const entries = isObj(body) && Array.isArray(body.entries) ? body.entries : [];
    return entries.filter(isObj).map((e) => {
      const entry: MarketSearchEntry = {
        fullName: str(e.full_name),
        country: str(e.country),
        region: str(e.region),
        locality: str(e.locality),
        nativeCurrency: typeof e.native_currency === "string" ? e.native_currency : null,
        activeListings: num(e.active_listings_count),
      };
      if (typeof e.district === "string" && e.district !== "") entry.district = e.district;
      return entry;
    });
  }

  /** Monthly zone figures of a market, for the last numMonths months (default 12). */
  async marketMetrics(market: AirRoiMarket, options: { filter?: AirRoiFilter; numMonths?: number } = {}): Promise<MonthlyMetrics[]> {
    const filter: Obj = {};
    if (options.filter?.roomType !== undefined) filter.room_type = { eq: options.filter.roomType };
    if (options.filter?.bedrooms !== undefined) filter.bedrooms = { eq: options.filter.bedrooms };
    const marketBody: Obj = { country: market.country, region: market.region, locality: market.locality };
    if (market.district !== undefined) marketBody.district = market.district;
    const request: Obj = { market: marketBody, num_months: options.numMonths ?? 12, currency: "native" };
    if (Object.keys(filter).length > 0) request.filter = filter;
    const body = await this.call("metrics", undefined, request);
    const results = isObj(body) && Array.isArray(body.results) ? body.results : [];
    const out: MonthlyMetrics[] = [];
    for (const r of results) {
      if (!isObj(r) || typeof r.date !== "string" || !/^\d{4}-\d{2}/.test(r.date)) continue;
      const occ = avgOf(r.occupancy);
      out.push({
        month: `${r.date.slice(0, 7)}-01`,
        occupancyPercent: occ === null ? null : Math.round((occ <= 1 ? occ * 100 : occ) * 10) / 10,
        averageDailyRate: avgOf(r.average_daily_rate),
        activeListings: avgOf(r.active_listings_count),
      });
    }
    return out.sort((a, b) => a.month.localeCompare(b.month));
  }

  private async call(endpoint: Endpoint, query?: Record<string, string>, body?: unknown): Promise<unknown> {
    const { method, path } = ENDPOINTS[endpoint];
    const url = `${this.baseUrl}${path}${query ? `?${new URLSearchParams(query).toString()}` : ""}`;
    const headers: Record<string, string> = { "X-API-KEY": this.options.apiKey, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        this.calls++;
        res = await this.options.fetch(url, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        });
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new AirRoiError(`AirROI cannot be reached: ${this.clean((e as Error).message)}`, null);
      }
      const text = await res.text();
      if (res.status >= 200 && res.status < 300) {
        try {
          return JSON.parse(text);
        } catch {
          throw new AirRoiError("AirROI answered with something that is not JSON.", res.status);
        }
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(res.status === 429 && retryAfter > 0 ? retryAfter * 1000 + 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new AirRoiError(this.explain(res.status, text), res.status);
    }
  }

  private explain(status: number, text: string): string {
    if (status === 401 || status === 403) return `AirROI refused the API key (HTTP ${status}). Check it, then run "fairnight mercato collega" again.`;
    if (status === 402) return "AirROI says the account has no credit left (HTTP 402): top it up on airroi.com.";
    if (status === 429) return "AirROI is limiting the requests (HTTP 429): try again in a minute.";
    let detail = "";
    try {
      const body = JSON.parse(text) as Obj;
      detail = str(body.message) || str(body.error) || str(body.detail);
    } catch {
      // not JSON: no detail
    }
    return `AirROI answered HTTP ${status}${detail ? `: ${this.clean(detail).slice(0, 200)}` : ""}.`;
  }

  /** Never let the key into a message. */
  private clean(message: string): string {
    return this.options.apiKey ? message.split(this.options.apiKey).join("[key]") : message;
  }
}

const DAY_MS = 86_400_000;

/**
 * AirROI gives one figure per past month. For each night to price, use the
 * most recent month with the same calendar month (November 2025 for a night in
 * November 2026): the zone's season, not a forecast.
 */
export function monthlyToDays(metrics: MonthlyMetrics[], today: string, days: number): MarketDay[] {
  const byMonth = new Map<string, MonthlyMetrics>();
  for (const m of metrics) byMonth.set(m.month.slice(5, 7), m); // sorted: the latest year wins
  const start = Date.parse(`${today}T00:00:00Z`);
  const out: MarketDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
    const m = byMonth.get(date.slice(5, 7));
    if (!m) continue;
    const day: MarketDay = { date };
    if (m.occupancyPercent !== null) day.occupancyPercent = Math.min(100, Math.max(0, m.occupancyPercent));
    if (m.averageDailyRate !== null && m.averageDailyRate > 0) day.averagePrice = Math.round(m.averageDailyRate * 100) / 100;
    if (m.activeListings !== null) day.comparables = Math.round(m.activeListings);
    if (day.occupancyPercent !== undefined || day.averagePrice !== undefined) out.push(day);
  }
  return out;
}
