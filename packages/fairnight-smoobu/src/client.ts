/**
 * A small client for the Smoobu API: apartments, reservations and rates.
 *
 * - Every request is HMAC-signed (see signing.ts).
 * - Our own brake: at most 300 requests per minute, well under Smoobu's 700.
 * - 429: wait until the time in X-RateLimit-Retry-After (a Unix timestamp,
 *   despite the name) plus one second, then try again.
 * - 5xx without a "detail" message: try again after 1, 2, 4 and 8 seconds.
 *   Smoobu reports validation errors as HTTP 500 WITH a "detail" message:
 *   those are not retried, the message is shown.
 * - Anything else (401, 404, network down…): stop and explain.
 * Credentials never appear in an error message or a log line.
 */
import { canonicalQuery, signedHeaders, type Credentials, type QueryValue } from "./signing.js";

export const SMOOBU_BASE_URL = "https://login.smoobu.com";
export const OWN_LIMIT_PER_MINUTE = 300;
const MAX_RETRIES = 4;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export interface ClientOptions {
  credentials: Credentials;
  fetch: FetchLike;
  baseUrl?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  limitPerMinute?: number;
  timeoutMs?: number;
}

export class SmoobuError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SmoobuError";
  }
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Sliding one-minute window: before each request, wait if the window is full. */
export class RequestBrake {
  private readonly sent: number[] = [];
  constructor(
    private readonly limit: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      while (this.sent.length > 0 && (this.sent[0] as number) <= t - 60_000) this.sent.shift();
      if (this.sent.length < this.limit) {
        this.sent.push(t);
        return;
      }
      await this.sleep((this.sent[0] as number) + 60_000 - t);
    }
  }
}

function explain(status: number, detail: string | null, path: string): string {
  const said = detail ? ` Smoobu says: "${detail}".` : "";
  switch (status) {
    case 401:
      return `Smoobu refused the request (401).${said} Check the API key and secret with "fairnight smoobu collega", and that this computer's clock is right (Smoobu accepts 5 minutes of difference).`;
    case 403:
      return `Smoobu does not allow this request (403).${said} The API key may not have access to this data.`;
    case 404:
      return `Smoobu could not find ${path} (404).${said}`;
    default:
      return `Smoobu answered ${status} for ${path}.${said}`;
  }
}

function detailOf(text: string): string | null {
  try {
    const body = JSON.parse(text) as { detail?: unknown; title?: unknown };
    if (typeof body.detail === "string" && body.detail.trim() !== "") return body.detail;
    if (typeof body.title === "string" && body.title.trim() !== "") return body.title;
  } catch {
    // not JSON
  }
  return null;
}

export interface Apartment {
  id: number;
  name: string;
}

export interface ApartmentDetails {
  id: number;
  name: string;
  currency: string | null;
  timeZone: string | null;
  price: { minimal: number | null; maximal: number | null };
}

/** One booking as Smoobu returns it (only the fields Fairnight reads). */
export interface SmoobuBooking {
  id: number;
  type: string;
  arrival: string;
  departure: string;
  "created-at"?: string | null;
  apartment: { id: number; name?: string };
  price?: number | string | null;
  "is-blocked-booking"?: boolean;
  /** Read only for guest registration (Fairguest); never stored by Fairnight's pricing. */
  "guest-name"?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  adults?: number | string | null;
  children?: number | string | null;
  "reference-id"?: string | null;
}

export interface RateDay {
  price: number | null;
  min_length_of_stay: number | null;
  available: number;
}

export interface RateOperation {
  dates: string[];
  daily_price: number;
  min_length_of_stay: number;
}

export class SmoobuClient {
  private readonly baseUrl: string;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly brake: RequestBrake;
  /** Requests actually sent, for reports and tests. */
  requests = 0;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = (options.baseUrl ?? SMOOBU_BASE_URL).replace(/\/+$/, "");
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? realSleep;
    this.brake = new RequestBrake(options.limitPerMinute ?? OWN_LIMIT_PER_MINUTE, () => this.now().getTime(), this.sleep);
  }

  async request<T>(method: "GET" | "POST", path: string, query: Record<string, QueryValue | undefined> = {}, payload?: unknown): Promise<T> {
    const qs = canonicalQuery(query);
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
    for (let attempt = 0; ; attempt++) {
      await this.brake.take();
      const headers: Record<string, string> = {
        accept: "application/json",
        ...signedHeaders({ method, path, query: qs, body }, this.options.credentials, this.now()),
      };
      if (payload !== undefined) headers["content-type"] = "application/json";
      let res;
      try {
        this.requests++;
        res = await this.options.fetch(url, {
          method,
          headers,
          ...(payload !== undefined ? { body } : {}),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        });
      } catch (e) {
        throw new SmoobuError(`Could not reach Smoobu (${(e as Error).message}). Check the internet connection and try again.`, null);
      }
      const text = await res.text();
      if (res.status >= 200 && res.status < 300) {
        try {
          return (text === "" ? {} : JSON.parse(text)) as T;
        } catch {
          throw new SmoobuError(`Smoobu sent an answer that is not JSON for ${path}.`, res.status);
        }
      }
      const detail = detailOf(text);
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const until = Number(res.headers.get("x-ratelimit-retry-after"));
        const wait = Number.isFinite(until) && until > 0 ? until * 1000 - this.now().getTime() + 1000 : 2 ** attempt * 1000;
        await this.sleep(Math.max(1000, wait));
        continue;
      }
      if (res.status >= 500 && detail === null && attempt < MAX_RETRIES) {
        await this.sleep(2 ** attempt * 1000);
        continue;
      }
      if (res.status === 429) throw new SmoobuError("Smoobu kept answering 429 (too many requests). Wait a minute and try again.", 429);
      throw new SmoobuError(explain(res.status, detail, path), res.status);
    }
  }

  async listApartments(): Promise<Apartment[]> {
    const body = await this.request<{ apartments?: { id: number; name: string }[] }>("GET", "/api/apartments");
    return (body.apartments ?? []).map((a) => ({ id: Number(a.id), name: String(a.name) }));
  }

  async getApartment(id: number): Promise<ApartmentDetails> {
    const a = await this.request<{
      id?: number;
      name?: string;
      currency?: string | null;
      timeZone?: string | null;
      price?: { minimal?: string | number | null; maximal?: string | number | null } | null;
    }>("GET", `/api/apartments/${id}`);
    const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    return {
      id,
      name: a.name ?? String(id),
      currency: a.currency ?? null,
      timeZone: a.timeZone ?? null,
      price: { minimal: num(a.price?.minimal), maximal: num(a.price?.maximal) },
    };
  }

  /** Every booking departing on or after `departureFrom`, cancellations included, all pages. */
  async listReservations(params: { departureFrom: string; apartmentId?: number }): Promise<SmoobuBooking[]> {
    const all: SmoobuBooking[] = [];
    for (let page = 1; ; page++) {
      const body = await this.request<{ bookings?: SmoobuBooking[]; page_count?: number }>("GET", "/api/reservations", {
        departureFrom: params.departureFrom,
        showCancellation: "true",
        pageSize: 100,
        page,
        apartmentId: params.apartmentId,
      });
      all.push(...(body.bookings ?? []));
      if (page >= (body.page_count ?? 1)) return all;
    }
  }

  /** Price, minimum stay and availability per apartment and day. */
  async getRates(apartments: number[], startDate: string, endDate: string): Promise<Record<string, Record<string, RateDay>>> {
    const body = await this.request<{ data?: Record<string, Record<string, RateDay>> }>("GET", "/api/rates", {
      apartments,
      start_date: startDate,
      end_date: endDate,
    });
    return body.data ?? {};
  }

  async postRates(apartments: number[], operations: RateOperation[]): Promise<void> {
    const body = await this.request<{ success?: boolean }>("POST", "/api/rates", {}, { apartments, operations });
    if (body.success !== true) throw new SmoobuError("Smoobu did not confirm the price update.", null);
  }
}
