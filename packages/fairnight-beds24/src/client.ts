/**
 * A small client for the Beds24 API v2 (beds24.com/api/v2, apiV2.yaml).
 *
 * Authentication
 * - An invite code (24 hours, created in the Beds24 control panel) is exchanged
 *   once for a REFRESH token: GET /authentication/setup, header "code".
 * - The refresh token gives short tokens: GET /authentication/token, header
 *   "refreshToken". Their lifetime is whatever "expiresIn" says. A token is
 *   renewed when less than 2 minutes are left, and once, at once, if Beds24
 *   answers 401 in the middle of a run.
 * - Every call sends the short token in the "token" header.
 *
 * Credits
 * - Beds24 allows a number of credits per 5 minutes per account (100 by
 *   default) and charges each request by its complexity. Responses report
 *   X-FiveMinCreditLimit, -Remaining, -ResetsIn and X-RequestCost (the wiki
 *   spells them x-five-min-limit-*, both are read).
 * - Our own brake: never go below half of the window. When fewer credits
 *   remain, wait until the window resets, plus one second.
 * - 429: wait until the window resets (ResetsIn) plus one second.
 * - 5xx: try again after 1, 2, 4 and 8 seconds.
 * - 400 and the rest: stop with Beds24's message.
 * Tokens never appear in an error message or a log line.
 */

export const BEDS24_BASE_URL = "https://beds24.com/api/v2";
const MAX_RETRIES = 4;
/** Renew the short token when less than this is left. */
export const TOKEN_MARGIN_MS = 2 * 60_000;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export interface Beds24Token {
  token: string;
  /** ISO time when the token stops working. */
  expiresAt: string;
}

export class Beds24Error extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "Beds24Error";
  }
}

export interface CreditState {
  /** Credits allowed per 5 minutes, as last reported. */
  limit: number | null;
  /** Credits left in the current window, as last reported. */
  remaining: number | null;
  /** Credits spent by this client (sum of X-RequestCost). */
  used: number;
  /** When the current window ends (ms since epoch), if known. */
  resetAt: number | null;
}

export interface ClientOptions {
  refreshToken: string;
  fetch: FetchLike;
  /** A short token saved by a previous run, used while it is still valid. */
  cachedToken?: Beds24Token | null;
  /** Called with every new short token, so it can be saved. */
  onToken?: (token: Beds24Token) => void;
  baseUrl?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export type QueryValue = string | number | boolean | readonly (string | number)[] | undefined;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const positive = (v: unknown) => (v === null || v === undefined || v === "" || !(Number(v) > 0) ? null : Number(v));

function header(h: { get(name: string): string | null }, ...names: string[]): number | null {
  for (const n of names) {
    const v = h.get(n);
    if (v !== null && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function errorOf(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string" && body.error.trim() !== "") return body.error;
    if (typeof body.message === "string" && body.message.trim() !== "") return body.message;
  } catch {
    // not JSON
  }
  return null;
}

function buildUrl(base: string, path: string, query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, String(v));
    else params.append(key, String(value));
  }
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

interface RawResponse {
  status: number;
  text: string;
}

/** One room (Beds24 "room type") with the property it belongs to. */
export interface Room {
  propertyId: number;
  propertyName: string;
  currency: string | null;
  roomId: number;
  name: string;
  /** How many identical units the room has. */
  qty: number;
  /** The room's standard and minimum price in Beds24, when set. */
  rackRate: number | null;
  minPrice: number | null;
}

/** One booking as Beds24 returns it (only the fields Fairnight reads). */
export interface Beds24Booking {
  id: number;
  roomId: number;
  status: string;
  arrival: string;
  departure: string;
  bookingTime?: string | null;
  price?: number | string | null;
}

/** One night of a room's calendar, as Fairnight reads it. */
export interface CalendarDay {
  price: number | null;
  minStay: number | null;
  /** False when Beds24 has no unit left (numAvail 0) or a blackout override. */
  available: boolean;
}

/** One value written to the calendar: the price field chosen and minStay, nothing else. */
export interface CalendarWrite {
  roomId: number;
  from: string;
  to: string;
  price: number;
  minStay: number;
}

export interface WriteResult {
  write: CalendarWrite;
  ok: boolean;
  errors: string[];
}

export const PRICE_FIELDS = Array.from({ length: 16 }, (_, i) => `price${i + 1}`) as readonly string[];
export type PriceField = `price${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16}`;

const DAY = 86_400_000;
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

export class Beds24Client {
  private readonly baseUrl: string;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private token: Beds24Token | null;
  readonly credits: CreditState = { limit: null, remaining: null, used: 0, resetAt: null };
  /** Requests actually sent, for reports and tests. */
  requests = 0;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = (options.baseUrl ?? BEDS24_BASE_URL).replace(/\/+$/, "");
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? realSleep;
    this.token = options.cachedToken ?? null;
  }

  /** Exchange an invite code for a refresh token (and a first short token). */
  static async setup(options: { inviteCode: string; fetch: FetchLike; baseUrl?: string; now?: () => Date }): Promise<{
    refreshToken: string;
    token: Beds24Token;
    credits: CreditState;
  }> {
    const client = new Beds24Client({ refreshToken: "", fetch: options.fetch, baseUrl: options.baseUrl, now: options.now });
    const res = await client.send("GET", "/authentication/setup", {}, undefined, { code: options.inviteCode, deviceName: "Fairnight" });
    if (res.status !== 200) {
      const message = errorOf(res.text);
      throw new Beds24Error(
        `Beds24 did not accept the invite code (${res.status})${message ? `: "${message}"` : ""}. Invite codes work once and only for 24 hours: create a new one in Beds24.`,
        res.status,
      );
    }
    const body = JSON.parse(res.text) as { token?: string; refreshToken?: string; expiresIn?: number };
    if (!body.refreshToken || !body.token) throw new Beds24Error("Beds24 did not send a refresh token for this invite code.", 200);
    return { refreshToken: body.refreshToken, token: client.tokenFrom(body.token, body.expiresIn), credits: client.credits };
  }

  private tokenFrom(token: string, expiresIn: number | undefined): Beds24Token {
    const seconds = Number.isFinite(expiresIn) && (expiresIn as number) > 0 ? (expiresIn as number) : 3600;
    return { token, expiresAt: new Date(this.now().getTime() + seconds * 1000).toISOString() };
  }

  /** Wait if our own brake says so: never use more than half of the 5-minute window. */
  private async brake(): Promise<void> {
    const c = this.credits;
    if (c.limit === null || c.remaining === null) return;
    if (c.remaining >= c.limit / 2) return;
    const wait = c.resetAt !== null ? c.resetAt - this.now().getTime() + 1000 : 300_000;
    if (wait > 0) await this.sleep(wait);
    c.remaining = null; // a new window: unknown until the next response
    c.resetAt = null;
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    query: Record<string, QueryValue>,
    body: unknown,
    extraHeaders: Record<string, string>,
  ): Promise<RawResponse> {
    await this.brake();
    const headers: Record<string, string> = { accept: "application/json", ...extraHeaders };
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      this.requests++;
      res = await this.options.fetch(buildUrl(this.baseUrl, path, query), {
        method,
        headers,
        ...(payload !== undefined ? { body: payload } : {}),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (e) {
      throw new Beds24Error(`Could not reach Beds24 (${(e as Error).message}). Check the internet connection and try again.`, null);
    }
    const limit = header(res.headers, "x-fivemincreditlimit", "x-five-min-limit");
    const remaining = header(res.headers, "x-fivemincreditlimit-remaining", "x-five-min-limit-remaining");
    const resetsIn = header(res.headers, "x-fivemincreditlimit-resetsin", "x-five-min-limit-resets-in");
    const cost = header(res.headers, "x-requestcost", "x-request-cost");
    if (limit !== null) this.credits.limit = limit;
    if (remaining !== null) this.credits.remaining = remaining;
    if (resetsIn !== null) this.credits.resetAt = this.now().getTime() + resetsIn * 1000;
    if (cost !== null) this.credits.used += cost;
    return { status: res.status, text: await res.text() };
  }

  /** A valid short token, renewed when less than 2 minutes are left (or when forced). */
  private async validToken(force = false): Promise<string> {
    const t = this.token;
    if (!force && t && Date.parse(t.expiresAt) - this.now().getTime() > TOKEN_MARGIN_MS) return t.token;
    for (let attempt = 0; ; attempt++) {
      const res = await this.send("GET", "/authentication/token", {}, undefined, { refreshToken: this.options.refreshToken });
      if (res.status === 200) {
        const body = JSON.parse(res.text) as { token?: string; expiresIn?: number };
        if (!body.token) throw new Beds24Error("Beds24 did not send a token.", 200);
        this.token = this.tokenFrom(body.token, body.expiresIn);
        this.options.onToken?.(this.token);
        return this.token.token;
      }
      if (await this.shouldRetry(res, attempt)) continue;
      const message = errorOf(res.text);
      throw new Beds24Error(
        `Beds24 refused the refresh token (${res.status})${message ? `: "${message}"` : ""}. A refresh token stops working after 30 days without use: run "fairnight beds24 collega" with a new invite code.`,
        res.status,
      );
    }
  }

  /** 429 and 5xx: wait and say "try again"; anything else: false. */
  private async shouldRetry(res: RawResponse, attempt: number): Promise<boolean> {
    if (attempt >= MAX_RETRIES) return false;
    if (res.status === 429) {
      const reset = this.credits.resetAt;
      const wait = reset !== null ? reset - this.now().getTime() + 1000 : 2 ** attempt * 1000;
      await this.sleep(Math.max(1000, wait));
      this.credits.remaining = null;
      return true;
    }
    if (res.status >= 500) {
      await this.sleep(2 ** attempt * 1000);
      return true;
    }
    return false;
  }

  async request<T>(method: "GET" | "POST", path: string, query: Record<string, QueryValue> = {}, body?: unknown): Promise<{ status: number; body: T }> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const res = await this.send(method, path, query, body, { token: await this.validToken() });
      if (res.status === 401 && !refreshed) {
        // The token expired in the middle of a run: renew it once and go on.
        refreshed = true;
        await this.validToken(true);
        attempt--;
        continue;
      }
      if (res.status >= 200 && res.status < 300) {
        try {
          return { status: res.status, body: (res.text === "" ? {} : JSON.parse(res.text)) as T };
        } catch {
          throw new Beds24Error(`Beds24 sent an answer that is not JSON for ${path}.`, res.status);
        }
      }
      if (await this.shouldRetry(res, attempt)) continue;
      const message = errorOf(res.text);
      const said = message ? ` Beds24 says: "${message}".` : "";
      if (res.status === 429) throw new Beds24Error(`Beds24 kept answering 429 (credits used up).${said} Wait 5 minutes and try again.`, 429);
      if (res.status === 401) {
        throw new Beds24Error(`Beds24 refused the token (401).${said} Run "fairnight beds24 collega" again.`, 401);
      }
      if (res.status === 403) {
        throw new Beds24Error(
          `Beds24 does not allow this request (403).${said} The invite code needs the permissions read:bookings, all:inventory and read:properties.`,
          403,
        );
      }
      throw new Beds24Error(`Beds24 answered ${res.status} for ${path}.${said}`, res.status);
    }
  }

  /** Every page of a list endpoint ("data" + "pages.nextPageExists"). */
  private async allPages<T>(path: string, query: Record<string, QueryValue>): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const { body } = await this.request<{ data?: T[]; pages?: { nextPageExists?: boolean } }>("GET", path, { ...query, page: page > 1 ? page : undefined });
      out.push(...(body.data ?? []));
      if (!body.pages?.nextPageExists) return out;
    }
  }

  async listRooms(): Promise<Room[]> {
    const properties = await this.allPages<{
      id: number;
      name?: string;
      currency?: string | null;
      roomTypes?: { id: number; name?: string; qty?: number; rackRate?: number | string | null; minPrice?: number | string | null }[];
    }>("/properties", { includeAllRooms: true });
    return properties.flatMap((p) =>
      (p.roomTypes ?? []).map((r) => ({
        propertyId: Number(p.id),
        propertyName: p.name ?? String(p.id),
        currency: p.currency ?? null,
        roomId: Number(r.id),
        name: r.name ?? String(r.id),
        qty: Number(r.qty ?? 1),
        rackRate: positive(r.rackRate),
        minPrice: positive(r.minPrice),
      })),
    );
  }

  /** Bookings of these rooms departing on or after `departureFrom`; enquiries are not asked for. */
  async listBookings(params: { departureFrom: string; roomIds: number[] }): Promise<Beds24Booking[]> {
    if (params.roomIds.length === 0) return [];
    return this.allPages<Beds24Booking>("/bookings", {
      roomId: params.roomIds,
      departureFrom: params.departureFrom,
      status: ["confirmed", "request", "new", "cancelled", "black"],
    });
  }

  /**
   * Price (the chosen price field), minimum stay and availability per room and
   * night. Beds24 answers with runs of equal days ("from"/"to", both included);
   * they are expanded night by night and cut to the dates asked for.
   */
  async getCalendar(roomIds: number[], startDate: string, endDate: string, priceField: PriceField): Promise<Record<number, Record<string, CalendarDay>>> {
    const rooms = await this.allPages<{ roomId: number; calendar?: Record<string, unknown>[] }>("/inventory/rooms/calendar", {
      roomId: roomIds,
      startDate,
      endDate,
      includePrices: true,
      includeMinStay: true,
      includeNumAvail: true,
      includeOverride: true,
    });
    const out: Record<number, Record<string, CalendarDay>> = {};
    for (const r of rooms) {
      const days = (out[Number(r.roomId)] ??= {});
      for (const entry of r.calendar ?? []) {
        const from = String(entry.from ?? "");
        const to = String(entry.to ?? from);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) continue;
        const price = entry[priceField];
        const day: CalendarDay = {
          price: typeof price === "number" ? price : price === null || price === undefined ? null : Number(price),
          minStay: typeof entry.minStay === "number" ? entry.minStay : null,
          available: !(entry.override === "blackout" || (typeof entry.numAvail === "number" && entry.numAvail <= 0)),
        };
        for (let d = from < startDate ? startDate : from; d <= to && d <= endDate; d = nextDay(d)) days[d] = day;
      }
    }
    return out;
  }

  /**
   * Write prices and minimum stays. One element per write, all in one request,
   * so every night gets its own answer. Only the chosen price field and minStay
   * are sent: numAvail, override and the other prices are never touched.
   */
  async writeCalendar(writes: CalendarWrite[], priceField: PriceField): Promise<WriteResult[]> {
    if (writes.length === 0) return [];
    const payload = writes.map((w) => ({ roomId: w.roomId, calendar: [{ from: w.from, to: w.to, [priceField]: w.price, minStay: w.minStay }] }));
    const { body } = await this.request<unknown>("POST", "/inventory/rooms/calendar", {}, payload);
    const answers = Array.isArray(body) ? (body as { success?: boolean; errors?: { field?: string; message?: string }[] }[]) : [];
    return writes.map((write, i) => {
      const a = answers[i];
      const errors = (a?.errors ?? []).map((e) => [e.field, e.message].filter(Boolean).join(": ") || "error");
      const ok = a !== undefined && a.success !== false && errors.length === 0;
      return { write, ok, errors: ok ? [] : errors.length > 0 ? errors : ["no answer for this element"] };
    });
  }
}
