/**
 * A fake Beds24 API v2 server for tests, on 127.0.0.1. It follows the shapes of
 * the official spec (beds24.com/api/v2/apiV2.yaml) and behaves like Beds24
 * where it matters: invite code -> refresh token -> short tokens that expire,
 * credits per 5-minute window with 429 when they run out, paginated lists,
 * calendar runs ("from"/"to"), and 201 answers with errors per element.
 * It never talks to the real Beds24.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface FakeRoom {
  id: number;
  name: string;
  qty: number;
}

export interface FakeProperty {
  id: number;
  name: string;
  currency: string;
  rooms: FakeRoom[];
}

export interface FakeBooking {
  id: number;
  propertyId: number;
  roomId: number;
  status: "confirmed" | "request" | "new" | "cancelled" | "black" | "inquiry";
  arrival: string;
  departure: string;
  bookingTime: string;
  price: number;
  firstName: string;
  lastName: string;
}

export type FakeDay = Record<string, number | string | null | undefined> & {
  minStay?: number | null;
  numAvail?: number;
  override?: string;
};

export interface FakeOptions {
  inviteCode: string;
  refreshToken: string;
  /** Lifetime of short tokens, in seconds ("expiresIn"). */
  tokenLifetime?: number;
  clock: { now: number };
  creditLimit?: number;
  cost?: { token: number; get: number; post: number };
  properties: FakeProperty[];
  bookings: FakeBooking[];
  /** calendar[roomId][date] */
  calendar?: Record<number, Record<string, FakeDay>>;
  /** How this fake reads "to" in a write: the real behaviour is checked on a live account. */
  rangeEnd?: "inclusive" | "exclusive";
  bookingsPageSize?: number;
  /** Writes on these dates are refused with an error for that element only. */
  refuseDates?: string[];
}

export interface LoggedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
  headers: Record<string, string | string[] | undefined>;
  status: number;
  cost: number;
}

const DAY = 86_400_000;
const next = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

export async function startFakeBeds24(opts: FakeOptions) {
  const limit = opts.creditLimit ?? 100;
  const cost = opts.cost ?? { token: 1, get: 1, post: 2 };
  const lifetime = opts.tokenLifetime ?? 3600;
  const calendar = opts.calendar ?? {};
  const tokens = new Map<string, number>(); // token -> expires at (ms)
  let inviteUsed = false;
  let windowStart: number | null = null;
  let spent = 0;
  const log: LoggedRequest[] = [];
  const forced: { status: number; body?: unknown }[] = [];

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://fake");
    const now = opts.clock.now;
    if (windowStart === null || now - windowStart >= 300_000) {
      windowStart = now;
      spent = 0;
    }
    const entry: LoggedRequest = { method: req.method ?? "", path: url.pathname, query: url.searchParams, body, headers: req.headers, status: 0, cost: 0 };
    log.push(entry);
    const send = (status: number, data: unknown, requestCost: number) => {
      entry.status = status;
      entry.cost = requestCost;
      spent += requestCost;
      res.writeHead(status, {
        "content-type": "application/json",
        "X-FiveMinCreditLimit": String(limit),
        "X-FiveMinCreditLimit-Remaining": String(Math.max(0, limit - spent)),
        "X-FiveMinCreditLimit-ResetsIn": String(Math.ceil((300_000 - (now - (windowStart as number))) / 1000)),
        "X-RequestCost": String(requestCost),
      });
      res.end(JSON.stringify(data));
    };
    const fail = (status: number, error: string, c = 0) => send(status, { success: false, type: "error", code: status, error }, c);
    const price = req.method === "POST" ? cost.post : url.pathname.startsWith("/authentication") ? cost.token : cost.get;
    if (limit - spent < price) return fail(429, "Usage limit exceeded in last 5 minutes");

    // --- authentication ---
    if (url.pathname === "/authentication/setup") {
      if (req.headers.code !== opts.inviteCode || inviteUsed) return fail(400, "Invalid code", price);
      inviteUsed = true;
      const token = randomUUID();
      tokens.set(token, now + lifetime * 1000);
      return send(200, { token, expiresIn: lifetime, refreshToken: opts.refreshToken }, price);
    }
    if (url.pathname === "/authentication/token") {
      if (req.headers.refreshtoken !== opts.refreshToken) return fail(400, "Invalid refresh token", price);
      const token = randomUUID();
      tokens.set(token, now + lifetime * 1000);
      return send(200, { token, expiresIn: lifetime }, price);
    }
    const token = req.headers.token;
    if (typeof token !== "string" || !tokens.has(token)) return fail(401, "Token is missing or invalid");
    if ((tokens.get(token) as number) <= now) return fail(401, "Token is expired");

    const f = forced.shift();
    if (f) return send(f.status, f.body ?? { success: false, code: f.status, error: "Forced" }, price);

    // --- properties ---
    if (req.method === "GET" && url.pathname === "/properties") {
      return send(200, {
        success: true,
        type: "property",
        count: opts.properties.length,
        pages: { nextPageExists: false, nextPageLink: null },
        data: opts.properties.map((p) => ({
          id: p.id,
          name: p.name,
          currency: p.currency,
          ...(url.searchParams.get("includeAllRooms") === "true" ? { roomTypes: p.rooms.map((r) => ({ id: r.id, propertyId: p.id, name: r.name, qty: r.qty })) } : {}),
        })),
      }, price);
    }

    // --- bookings ---
    if (req.method === "GET" && url.pathname === "/bookings") {
      const rooms = url.searchParams.getAll("roomId").map(Number);
      const statuses = url.searchParams.getAll("status");
      const wanted = statuses.length > 0 ? statuses : ["confirmed", "request", "new", "black", "inquiry"];
      const from = url.searchParams.get("departureFrom") ?? "0000-00-00";
      const list = opts.bookings.filter((b) => (rooms.length === 0 || rooms.includes(b.roomId)) && wanted.includes(b.status) && b.departure >= from);
      const size = opts.bookingsPageSize ?? 100;
      const page = Number(url.searchParams.get("page") ?? 1);
      const slice = list.slice((page - 1) * size, page * size);
      const more = page * size < list.length;
      return send(200, {
        success: true,
        type: "booking",
        count: slice.length,
        pages: { nextPageExists: more, nextPageLink: more ? `fake/bookings?page=${page + 1}` : null },
        data: slice,
      }, price);
    }

    // --- calendar ---
    if (req.method === "GET" && url.pathname === "/inventory/rooms/calendar") {
      const start = url.searchParams.get("startDate");
      const end = url.searchParams.get("endDate");
      if (!start || !end) return fail(400, "startDate and endDate are required", price);
      const rooms = url.searchParams.getAll("roomId").map(Number);
      const data = rooms.map((roomId) => {
        const runs: Record<string, unknown>[] = [];
        let current: Record<string, unknown> | null = null;
        let key = "";
        for (let d = start; d <= end; d = next(d)) {
          const day = calendar[roomId]?.[d] ?? {};
          const values: Record<string, unknown> = {};
          if (url.searchParams.get("includePrices") === "true") for (let i = 1; i <= 16; i++) if (day[`price${i}`] !== undefined) values[`price${i}`] = day[`price${i}`];
          if (url.searchParams.get("includeMinStay") === "true" && day.minStay !== undefined) values.minStay = day.minStay;
          if (url.searchParams.get("includeNumAvail") === "true") values.numAvail = day.numAvail ?? 1;
          if (url.searchParams.get("includeOverride") === "true") values.override = day.override ?? "none";
          const k = JSON.stringify(values);
          if (current && k === key) current.to = d;
          else {
            current = { from: d, to: d, ...values };
            key = k;
            runs.push(current);
          }
        }
        return { roomId, propertyId: opts.properties.find((p) => p.rooms.some((r) => r.id === roomId))?.id, calendar: runs };
      });
      return send(200, { success: true, type: "calendar", count: data.length, pages: { nextPageExists: false }, data }, price);
    }
    if (req.method === "POST" && url.pathname === "/inventory/rooms/calendar") {
      const items = JSON.parse(body) as { roomId: number; calendar: Record<string, unknown>[] }[];
      const answers = items.map((item) => {
        const errors: { action: string; field: string; message: string }[] = [];
        for (const c of item.calendar) {
          const from = String(c.from);
          const to = String(c.to ?? from);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            errors.push({ action: "modify", field: "from", message: "invalid date" });
            continue;
          }
          const days: string[] = [];
          for (let d = from; opts.rangeEnd === "exclusive" && to !== from ? d < to : d <= to; d = next(d)) days.push(d);
          if (days.some((d) => opts.refuseDates?.includes(d))) {
            errors.push({ action: "modify", field: "price1", message: "Price is below the minimum price of the room" });
            continue;
          }
          for (const d of days) {
            const day = ((calendar[item.roomId] ??= {})[d] ??= {});
            for (const [k, v] of Object.entries(c)) if (k !== "from" && k !== "to") day[k] = v as number;
          }
        }
        return errors.length > 0 ? { success: false, errors } : { success: true, modified: { field: "calendar" } };
      });
      return send(201, answers, price);
    }
    return fail(404, "Not found", price);
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch((e: unknown) => {
      res.writeHead(500);
      res.end(String(e));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    log,
    calendar,
    forceNext: (...answers: { status: number; body?: unknown }[]) => forced.push(...answers),
    /** Every short token issued so far stops working (as if expired in the middle of a run). */
    expireTokens: () => {
      for (const t of tokens.keys()) tokens.set(t, 0);
    },
    tokensIssued: () => tokens.size,
    creditsSpent: () => spent,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

export type FakeBeds24 = Awaited<ReturnType<typeof startFakeBeds24>>;

/** Invented credentials for tests. */
export const TEST_INVITE = "invite-code-0000-not-real";
export const TEST_REFRESH = "refresh-token-0000-not-real";
