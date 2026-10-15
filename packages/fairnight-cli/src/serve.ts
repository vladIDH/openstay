/**
 * `fairnight serve`: a local, read-only page with the calendar of every listing.
 *
 * - Listens on 127.0.0.1 by default; with --lan, on every interface so a phone
 *   on the same network can open it. Nothing is sent anywhere else.
 * - GET  /           the page (HTML, CSS and JS inline, no external files)
 * - GET  /api/data   prices of every listing, computed on each request
 * - POST /api/refresh  reads the iCal calendars again (the only network access)
 * - GET  /api/ping   "this is Fairnight, for this folder": lets `fairnight apri`
 *   find a calendar that is already running instead of starting a second one
 * - GET/POST /checkin/<code>  the guest check-in form (Fairguest), local network only
 * - GET/POST /risposte  the replies to guests to approve (Fairhello), this computer only
 * - GET/POST /api/pilot…  the autopilot: its state, and its switches for this computer only (pilota-pagina.ts)
 * The calendar page writes only through "Recalculate", which runs the same
 * sync as `fairnight sync`, and through the autopilot switches.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { loadHostConfig, type HostConfig } from "./config.js";
import { openDb } from "./db.js";
import { dbPath, localToday, type Io } from "./io.js";
import { handleCheckin, type CheckinContext } from "./guests/checkin.js";
import { handleReplies, type RepliesContext } from "./hello/page.js";
import { applyRetention, guestsEnabled, prefillFromCalendar } from "./guests/store.js";
import { renderPage } from "./page.js";
import { handlePilot, PAGE_CHECK_MS, pageRunIfDue, type PilotPageContext } from "./pilota-pagina.js";
import { lastSync, priceOne } from "./price.js";
import { syncEverything } from "./sync-all.js";

export interface ServeOptions {
  dir: string;
  io: Io;
  days: number;
  /** Fixed "today" (for demos and tests); default: today on this computer. */
  today?: string;
  /** No startup lines: `fairnight apri` prints its own, in Italian. */
  quiet?: boolean;
  /** Shared with the autopilot switches; made by createHandler when missing. */
  pilot?: PilotPageContext;
}

/** Identifies the folder a running calendar serves, without showing its path on the network. */
export function folderId(dir: string): string {
  return createHash("sha256").update(path.resolve(dir)).digest("hex").slice(0, 16);
}

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  });
  res.end(body);
}

const json = (res: ServerResponse, status: number, data: unknown) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(data));

export function pricesPayload(dir: string, config: HostConfig, today: string, days: number) {
  const db = openDb(dbPath(dir));
  try {
    return {
      today,
      days,
      // The page starts in this language unless the browser has another one saved.
      language: config.language ?? "en",
      listings: config.listings.map((l) => {
        const result = priceOne(db, l, today, days);
        return {
          name: l.name,
          title: l.pricing.name ?? l.name,
          currency: result.currency,
          basePrice: l.pricing.basePrice,
          lastSync: lastSync(db, l.name),
          nights: result.nights.map((n) => ({
            date: n.date,
            status: n.status,
            price: n.price,
            minStay: n.minStay,
            minStaySource: n.minStaySource,
            steps: n.steps,
            explanation: n.explanation,
            ...(n.units ? { units: n.units } : {}),
          })),
        };
      }),
    };
  } finally {
    db.close();
  }
}

/** The request handler, separate from the socket so tests can call it. */
export function createHandler(opts: ServeOptions): (req: IncomingMessage, res: ServerResponse) => void {
  let refreshing: Promise<unknown> | null = null;
  const checkin: CheckinContext = { dir: opts.dir, io: opts.io, secret: randomBytes(32), failures: new Map() };
  const pilot = opts.pilot ?? { dir: opts.dir, io: opts.io, previews: new Map(), busy: false };
  const replies: RepliesContext = { dir: opts.dir, io: opts.io, secret: randomBytes(32), ...(opts.today !== undefined ? { today: opts.today } : {}) };

  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const today = opts.today ?? localToday(opts.io.now());
    const run = async () => {
      if (await handleCheckin(req, res, url, checkin, randomBytes(16).toString("base64"))) return;
      if (await handlePilot(req, res, url, pilot)) return;
      if (await handleReplies(req, res, url, replies, randomBytes(16).toString("base64"))) return;
      if (req.method === "GET" && url.pathname === "/") {
        const nonce = randomBytes(16).toString("base64");
        send(res, 200, "text/html; charset=utf-8", renderPage(nonce), {
          "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/ping") {
        json(res, 200, { app: "fairnight", folder: folderId(opts.dir) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/data") {
        json(res, 200, pricesPayload(opts.dir, loadHostConfig(opts.dir), today, opts.days));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/refresh") {
        // A custom header: browsers do not let other sites send it without asking first.
        if (req.headers["x-fairnight"] !== "1") {
          json(res, 403, { error: "missing X-Fairnight header" });
          return;
        }
        if (refreshing) {
          json(res, 409, { error: "already reading the calendars" });
          return;
        }
        const config = loadHostConfig(opts.dir);
        const db = openDb(dbPath(opts.dir));
        const job = syncEverything(db, opts.dir, config.listings, opts.io);
        refreshing = job;
        try {
          const { reports } = await job;
          json(res, 200, {
            reports: reports.map((r) => ({ listing: r.listing, feed: r.feed, ok: r.ok, added: r.added, removed: r.removed, error: r.error ?? null })),
          });
        } finally {
          refreshing = null;
          db.close();
        }
        return;
      }
      json(res, 404, { error: "not found" });
    };
    run().catch((e: unknown) => {
      opts.io.err(`serve: ${(e as Error).message}`);
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
    });
  };
}

/** IPv4 addresses of this computer on the local network. */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

export async function startServer(opts: ServeOptions & { port: number; lan: boolean; autopilot?: boolean }): Promise<Server> {
  const config = loadHostConfig(opts.dir); // fail early on a broken config
  const db = openDb(dbPath(opts.dir));
  let guests = false;
  try {
    guests = guestsEnabled(db);
    prefillFromCalendar(db, config.listings, opts.io.now());
    for (const e of applyRetention(db, config, opts.io.now()).erased) opts.io.out(`Fairguest: erased the personal data of stay ${e.id} (${e.reason}).`);
  } finally {
    db.close();
  }
  const pilot: PilotPageContext = { dir: opts.dir, io: opts.io, previews: new Map(), busy: false };
  const server = createServer(createHandler({ ...opts, pilot }));
  if (opts.autopilot) {
    // While the page is open it does the day's run if the computer's daily task did not (it was off at that hour).
    const check = () => pageRunIfDue(opts.dir, opts.io, pilot).catch((e: unknown) => opts.io.err(`Pilota automatico: ${(e as Error).message}`));
    const first = setTimeout(check, 60_000);
    const hourly = setInterval(check, PAGE_CHECK_MS);
    server.on("close", () => {
      clearTimeout(first);
      clearInterval(hourly);
    });
  }
  const host = opts.lan ? "0.0.0.0" : "127.0.0.1";
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => {
      const port = (server.address() as { port: number }).port;
      if (opts.quiet) return resolve(server);
      opts.io.out(`Fairnight calendar: http://localhost:${port}`);
      if (opts.lan) for (const ip of lanAddresses()) opts.io.out(`  on your network: http://${ip}:${port}`);
      else opts.io.out("  only this computer can open it (add --lan to open it from a phone on the same network)");
      if (guests) {
        opts.io.out(
          opts.lan
            ? '  guest check-in forms: open on this network only ("fairnight ospiti elenco" lists their links)'
            : "  guest check-in forms: only on this computer; add --lan to fill them in on a phone or tablet",
        );
      }
      opts.io.out(`  replies to guests: http://localhost:${port}/risposte (this computer only)`);
      opts.io.out("Press Ctrl+C to stop.");
      resolve(server);
    });
  });
}
