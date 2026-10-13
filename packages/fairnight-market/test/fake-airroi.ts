/**
 * A fake AirROI API for tests, on 127.0.0.1, with invented numbers only. It
 * follows the shapes of the public documentation (airroi.com/api/documentation):
 * X-API-KEY header, GET /markets/search, POST /markets/metrics/all. Every other
 * path answers 404, and every request is recorded, so tests can check that the
 * client never calls anything else. It never talks to the real AirROI.
 */
import { createServer, type Server } from "node:http";

export interface FakeRequest {
  method: string;
  path: string;
  key: string | undefined;
  body: unknown;
}

export interface FakeAirRoiOptions {
  apiKey: string;
  /** Answers to give to the next requests, before the normal ones (e.g. 429, 500). */
  failures?: { status: number; retryAfter?: number }[];
  /** Monthly results returned by /markets/metrics/all. */
  months?: { date: string; occupancy: number; adr: number; listings: number }[];
}

export interface FakeAirRoi {
  url: string;
  requests: FakeRequest[];
  close(): Promise<void>;
}

const OCCUPANCY = [0.55, 0.82, 0.6, 0.62, 0.66, 0.7, 0.64, 0.75, 0.88, 0.9, 0.72, 0.6];
const ADR = [95, 140, 100, 102, 105, 110, 104, 125, 150, 155, 118, 98];

/** Invented: a seaside zone, busy in summer and at Christmas, November 2025 to October 2026. */
export const INVENTED_MONTHS = OCCUPANCY.map((occupancy, i) => {
  const d = new Date(Date.UTC(2025, 10 + i, 1));
  return { date: d.toISOString().slice(0, 10), occupancy, adr: ADR[i] as number, listings: 400 + i };
});

export async function startFakeAirRoi(options: FakeAirRoiOptions): Promise<FakeAirRoi> {
  const requests: FakeRequest[] = [];
  const failures = [...(options.failures ?? [])];
  const months = options.months ?? INVENTED_MONTHS;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const header = req.headers["x-api-key"];
      const key = Array.isArray(header) ? header[0] : header;
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({ method: req.method ?? "", path: url.pathname, key, body });
      const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers });
        res.end(JSON.stringify(payload));
      };
      const failure = failures.shift();
      if (failure) {
        send(failure.status, { message: "invented failure" }, failure.retryAfter ? { "Retry-After": String(failure.retryAfter) } : {});
        return;
      }
      if (key !== options.apiKey) {
        send(401, { message: "Invalid API key" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/markets/search") {
        send(200, {
          entries: [
            {
              full_name: "Costa Inventada, Isla Ficticia, Spain",
              country: "Spain",
              region: "Isla Ficticia",
              locality: "Costa Inventada",
              district: "",
              native_currency: "EUR",
              active_listings_count: 412,
            },
          ],
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/markets/metrics/all") {
        send(200, {
          market: (body as { market?: unknown } | null)?.market ?? {},
          results: months.map((m) => ({
            date: m.date,
            occupancy: { avg: m.occupancy, p25: m.occupancy - 0.1, p50: m.occupancy, p75: m.occupancy + 0.05, p90: m.occupancy + 0.08 },
            average_daily_rate: { avg: m.adr, p25: m.adr - 20, p50: m.adr, p75: m.adr + 20, p90: m.adr + 40 },
            active_listings_count: m.listings,
          })),
        });
        return;
      }
      send(404, { message: "Not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
