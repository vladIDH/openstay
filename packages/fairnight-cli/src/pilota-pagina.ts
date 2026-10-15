/**
 * The autopilot on the calendar page:
 *
 * - GET  /api/pilot           each listing: on, off or paused, its limits, the
 *   last run and the nights it changed with their reasons
 * - POST /api/pilot/preview   what turning it on would write now (nothing is written)
 * - POST /api/pilot/on        turn it on: only with the token of a preview from the last 15 minutes
 * - POST /api/pilot/off       turn it off
 * - POST /api/pilot/resume    clear a pause
 *
 * The switches answer only to this computer (127.0.0.1), even when the page is
 * open on the network with --lan, and only with the X-Fairnight header that
 * other sites cannot send. While `fairnight apri` is open, the page also does
 * the day's run if the computer's daily task has not done it yet.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PriceStep } from "fairnight";
import { loadHostConfig, type HostListing } from "./config.js";
import { openDb } from "./db.js";
import { dbPath, type Io } from "./io.js";
import { writeListingPilot } from "./pilota-comandi.js";
import { channelOf, lastRun, limitsOf, maxChangeOf, pilotDaysOf, pilotOn, pilotState, resumeListing, runPilot, STALE_HOURS } from "./pilota.js";

const PREVIEW_MINUTES = 15;
/** How often an open page checks that today's run is done. */
export const PAGE_CHECK_MS = 60 * 60_000;

export interface PilotPageContext {
  dir: string;
  io: Io;
  /** Preview tokens: token → listing and when it was made. */
  previews: Map<string, { listing: string; at: number }>;
  busy: boolean;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) throw new Error("request too large");
    chunks.push(c as Buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

interface RunSummary {
  listing: string;
  status: string;
  nights: number;
  capped: number;
  wrong: number;
  refused: number;
  error?: string;
  pausedNow?: string;
}

/** What the page shows about the autopilot. */
export function pilotPayload(dir: string, io: Io, control: boolean) {
  const config = loadHostConfig(dir);
  const db = openDb(dbPath(dir));
  try {
    const run = db.prepare("SELECT id, started_at, finished_at, trigger, outcome, listings FROM pilot_runs ORDER BY id DESC LIMIT 1").get() as
      | { id: number; started_at: string; finished_at: string; trigger: string; outcome: string; listings: string }
      | undefined;
    const summaries = run ? (JSON.parse(run.listings) as RunSummary[]) : [];
    const changes = db.prepare(
      "SELECT date, old_price, new_price, target_price, old_min_stay, new_min_stay, limited, steps, verified FROM pilot_changes WHERE run_id = ? AND listing = ? ORDER BY date",
    );
    const last = lastRun(db).at;
    const anyOn = config.listings.some(pilotOn);
    const hours = last ? (io.now().getTime() - Date.parse(last)) / 3_600_000 : null;
    return {
      control,
      lastRun: run ? { at: run.finished_at, trigger: run.trigger, outcome: run.outcome } : null,
      // The computer was probably off: nothing ran for a day and a half.
      stale: anyOn && (hours === null || hours > STALE_HOURS),
      hoursSinceRun: hours === null ? null : Math.floor(hours),
      listings: config.listings.map((l: HostListing) => {
        const s = pilotState(db, l.name);
        const limits = limitsOf(l);
        const summary = summaries.find((x) => x.listing === l.name) ?? null;
        return {
          name: l.name,
          channel: channelOf(l)?.label ?? null,
          enabled: pilotOn(l),
          paused: s.paused_at ? { at: s.paused_at, reason: s.paused_reason } : null,
          failures: s.failures,
          maxChange: maxChangeOf(l),
          days: pilotDaysOf(l),
          floor: limits?.floor ?? null,
          ceiling: limits?.ceiling ?? null,
          last: summary && run ? { ...summary, at: run.finished_at } : null,
          changes:
            summary && run
              ? (changes.all(run.id, l.name) as Record<string, unknown>[]).map((c) => ({
                  date: c.date,
                  oldPrice: c.old_price,
                  newPrice: c.new_price,
                  target: c.target_price,
                  limited: c.limited,
                  verified: c.verified === null ? null : c.verified === 1,
                  steps: JSON.parse(c.steps as string) as PriceStep[],
                }))
              : [],
        };
      }),
    };
  } finally {
    db.close();
  }
}

/** Handle /api/pilot…; false when the request is for something else. */
export async function handlePilot(req: IncomingMessage, res: ServerResponse, url: URL, ctx: PilotPageContext): Promise<boolean> {
  if (!url.pathname.startsWith("/api/pilot")) return false;
  const reply = (status: number, data: unknown): true => {
    json(res, status, data);
    return true;
  };
  const local = LOOPBACK.has(req.socket.remoteAddress ?? "");
  if (req.method === "GET" && url.pathname === "/api/pilot") {
    json(res, 200, pilotPayload(ctx.dir, ctx.io, local));
    return true;
  }
  if (req.method !== "POST") {
    json(res, 404, { error: "not found" });
    return true;
  }
  if (req.headers["x-fairnight"] !== "1") {
    json(res, 403, { error: "missing X-Fairnight header" });
    return true;
  }
  if (!local) {
    json(res, 403, { error: "the autopilot is switched only from the computer Fairnight runs on" });
    return true;
  }
  const body = await readBody(req);
  const config = loadHostConfig(ctx.dir);
  const listing = config.listings.find((l) => l.name === body.listing);
  if (!listing) {
    json(res, 400, { error: "unknown listing" });
    return true;
  }
  const now = ctx.io.now().getTime();
  for (const [token, p] of ctx.previews) if (now - p.at > PREVIEW_MINUTES * 60_000) ctx.previews.delete(token);

  switch (url.pathname) {
    case "/api/pilot/preview": {
      if (channelOf(listing) === null) return reply(400, { error: "no-channel" });
      if (limitsOf(listing) === null) return reply(400, { error: "no-limits" });
      if (ctx.busy) return reply(409, { error: "busy" });
      ctx.busy = true;
      try {
        const r = await runPilot(ctx.dir, ctx.io, { trigger: "page", dryRun: true, includeOff: true, only: [listing.name] }, config);
        const result = r.listings[0];
        if (!result || result.status !== "preview") return reply(502, { error: result?.error ?? result?.status ?? "preview failed" });
        const token = randomBytes(18).toString("base64url");
        ctx.previews.set(token, { listing: listing.name, at: now });
        json(res, 200, {
          token,
          leftAlone: result.leftAlone,
          skipped: result.skipped.length,
          nights: result.nights.map((n) => ({ date: n.date, oldPrice: n.oldPrice, newPrice: n.newPrice, target: n.target, limited: n.limited, steps: n.steps })),
        });
      } finally {
        ctx.busy = false;
      }
      return true;
    }
    case "/api/pilot/on": {
      const p = typeof body.token === "string" ? ctx.previews.get(body.token) : undefined;
      if (!p || p.listing !== listing.name) return reply(400, { error: "preview first" });
      ctx.previews.delete(body.token as string);
      writeListingPilot(ctx.dir, listing.name, { enabled: true });
      json(res, 200, { ok: true });
      return true;
    }
    case "/api/pilot/off":
      writeListingPilot(ctx.dir, listing.name, { enabled: false });
      json(res, 200, { ok: true });
      return true;
    case "/api/pilot/resume": {
      const db = openDb(dbPath(ctx.dir));
      try {
        resumeListing(db, listing.name);
      } finally {
        db.close();
      }
      json(res, 200, { ok: true });
      return true;
    }
    default:
      json(res, 404, { error: "not found" });
      return true;
  }
}

/** While the page is open: today's run, if no daily task did it and some listing is on. */
export async function pageRunIfDue(dir: string, io: Io, ctx: PilotPageContext): Promise<void> {
  if (ctx.busy || !loadHostConfig(dir).listings.some(pilotOn)) return;
  ctx.busy = true;
  try {
    const r = await runPilot(dir, io, { trigger: "page", dryRun: false, onlyIfDue: true });
    if (!r.skipped) io.out(`Pilota automatico: giro fatto (${r.listings.filter((l) => l.status === "written").reduce((a, l) => a + l.nights.length, 0)} notti cambiate).`);
  } finally {
    ctx.busy = false;
  }
}
