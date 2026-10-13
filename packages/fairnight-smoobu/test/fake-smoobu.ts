/**
 * A fake Smoobu server for tests, on 127.0.0.1. It speaks the shapes of the
 * public docs (docs.smoobu.com) and checks every request like Smoobu would:
 * HMAC signature, timestamp within 5 minutes, nonce never reused, and no legacy
 * Api-Key header. It never talks to the real Smoobu.
 */
import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface FakeBooking {
  id: number;
  type: "reservation" | "modification of booking" | "cancellation";
  arrival: string;
  departure: string;
  "created-at": string;
  apartment: { id: number; name: string };
  channel: { id: number; name: string };
  "guest-name": string;
  price: number | null;
  "is-blocked-booking": boolean;
}

export interface FakeOptions {
  apiKey: string;
  apiSecret: string;
  now: () => Date;
  apartments: { id: number; name: string; currency: string; minimal: string; maximal: string }[];
  bookings: FakeBooking[];
  /** rates[apartmentId][date] */
  rates?: Record<number, Record<string, { price: number | null; min_length_of_stay: number | null; available: number }>>;
  /** How this fake reads the end of "from:to": Smoobu's real behaviour is checked on a live account. */
  rangeEnd?: "inclusive" | "exclusive";
}

export interface LoggedRequest {
  method: string;
  path: string;
  query: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
  status: number;
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export async function startFakeSmoobu(opts: FakeOptions) {
  const usedNonces = new Set<string>();
  const log: LoggedRequest[] = [];
  /** Forced answers for the next requests, e.g. { status: 429, retryAfter: … }. */
  const forced: { status: number; body?: unknown; retryAfter?: number }[] = [];
  const rates = opts.rates ?? {};

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://fake");
    const rawQuery = url.search.startsWith("?") ? url.search.slice(1) : "";
    const entry: LoggedRequest = { method: req.method ?? "", path: url.pathname, query: rawQuery, body, headers: req.headers, status: 0 };
    log.push(entry);
    const send = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      entry.status = status;
      res.writeHead(status, { "content-type": "application/json", "x-ratelimit-limit": "700", "x-ratelimit-remaining": "699", ...headers });
      res.end(JSON.stringify(data));
    };
    const unauthorized = () => send(401, { status: 401, title: "Unauthorized", detail: "Authentication required" });

    // --- authentication, as documented ---
    if (req.headers["api-key"] !== undefined) return unauthorized(); // legacy header: we must never send it
    const key = req.headers["x-api-key"];
    const ts = req.headers["x-timestamp"];
    const nonce = req.headers["x-nonce"];
    const sig = req.headers["x-signature"];
    if (typeof key !== "string" || typeof ts !== "string" || typeof nonce !== "string" || typeof sig !== "string") return unauthorized();
    if (key !== opts.apiKey) return unauthorized();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ts) || Math.abs(Date.parse(ts) - opts.now().getTime()) > 5 * 60_000) return unauthorized();
    if (usedNonces.has(nonce)) return unauthorized();
    usedNonces.add(nonce);
    // Smoobu signs the sorted, encoded query: rebuild it from the parameters received.
    const pairs = [...url.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)] as [string, string]);
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const canonicalQuery = pairs.map(([k, v]) => `${k}=${v}`).join("&");
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const canonical = [req.method, url.pathname, canonicalQuery, ts, nonce, bodyHash, key].join("\n");
    const expected = createHmac("sha256", opts.apiSecret).update(canonical).digest("base64");
    if (sig !== expected) return unauthorized();

    // --- forced answers (rate limit, outages) ---
    const f = forced.shift();
    if (f) {
      const headers: Record<string, string> = f.retryAfter !== undefined ? { "x-ratelimit-retry-after": String(f.retryAfter), "x-ratelimit-remaining": "0" } : {};
      return send(f.status, f.body ?? {}, headers);
    }

    // --- endpoints ---
    if (req.method === "GET" && url.pathname === "/api/apartments") {
      return send(200, { apartments: opts.apartments.map((a) => ({ id: a.id, name: a.name })) });
    }
    const one = /^\/api\/apartments\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && one) {
      const a = opts.apartments.find((x) => x.id === Number(one[1]));
      if (!a) return send(404, { status: 404, title: "Not Found", detail: "Apartment not found" });
      return send(200, { id: a.id, name: a.name, timeZone: "Europe/Rome", currency: a.currency, price: { minimal: a.minimal, maximal: a.maximal }, type: { id: 1, name: "Apartment" } });
    }
    if (req.method === "GET" && url.pathname === "/api/reservations") {
      const pageSize = Math.min(100, Number(url.searchParams.get("pageSize") ?? 25));
      const page = Number(url.searchParams.get("page") ?? 1);
      const from = url.searchParams.get("departureFrom") ?? "0000-00-00";
      const apt = url.searchParams.get("apartmentId");
      const showCancellation = url.searchParams.get("showCancellation") === "true";
      const list = opts.bookings.filter(
        (b) => b.departure >= from && (apt === null || b.apartment.id === Number(apt)) && (showCancellation || b.type !== "cancellation"),
      );
      const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
      return send(200, {
        page_count: pageCount,
        page_size: pageSize,
        total_items: list.length,
        page,
        bookings: list.slice((page - 1) * pageSize, page * pageSize),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/rates") {
      const ids = url.searchParams.getAll("apartments[]").map(Number);
      const start = url.searchParams.get("start_date");
      const end = url.searchParams.get("end_date");
      if (!start || !end || ids.length === 0) return send(500, { title: "Error occurred", detail: "start_date, end_date and apartments are required" });
      const data: Record<string, Record<string, unknown>> = {};
      for (const id of ids) {
        if (!opts.apartments.some((a) => a.id === id)) return send(500, { title: "Error occurred", detail: "Apartment not found for this user" });
        const days: Record<string, unknown> = {};
        for (let d = start; d <= end; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
          days[d] = rates[id]?.[d] ?? { price: null, min_length_of_stay: null, available: 1 };
        }
        data[String(id)] = days;
      }
      return send(200, { data });
    }
    if (req.method === "POST" && url.pathname === "/api/rates") {
      const payload = JSON.parse(body) as {
        apartments: number[];
        operations: { dates: string[]; daily_price?: number; min_length_of_stay?: number }[];
      };
      for (const op of payload.operations) {
        for (const d of op.dates) {
          if (!/^\d{4}-\d{2}-\d{2}(:\d{4}-\d{2}-\d{2})?$/.test(d)) return send(500, { title: "Error occurred", detail: `invalid Date format ${d}` });
        }
      }
      for (const id of payload.apartments) {
        for (const op of payload.operations) {
          for (const d of op.dates) {
            const [a, b = a] = d.split(":") as [string, string?];
            const days: string[] = [];
            for (let x = a; opts.rangeEnd === "exclusive" && b !== a ? x < b : x <= b; x = new Date(Date.parse(`${x}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) days.push(x);
            for (const day of days) {
              const cur = (rates[id] ??= {})[day] ?? { price: null, min_length_of_stay: null, available: 1 };
              if (op.daily_price === undefined && cur.price === null) return send(500, { title: "Error occurred", detail: "Price is required" });
              rates[id][day] = {
                price: op.daily_price ?? cur.price,
                min_length_of_stay: op.min_length_of_stay ?? cur.min_length_of_stay,
                available: cur.available,
              };
            }
          }
        }
      }
      return send(200, { success: true });
    }
    return send(404, { status: 404, title: "Not Found", detail: "No route" });
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch((e: unknown) => {
      res.writeHead(500);
      res.end(String(e));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    baseUrl,
    log,
    rates,
    forceNext: (...answers: { status: number; body?: unknown; retryAfter?: number }[]) => forced.push(...answers),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

export type FakeSmoobu = Awaited<ReturnType<typeof startFakeSmoobu>>;

/** Credentials that look real enough but are invented for tests. */
export const TEST_CREDENTIALS = { apiKey: "test-key-0000-not-real", apiSecret: "test-secret-0000-not-real" };
