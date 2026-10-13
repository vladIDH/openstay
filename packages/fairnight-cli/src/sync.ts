/**
 * `fairnight sync`: download each iCal link written in the config and store
 * its stays and blocks. Safe to run any number of times.
 *
 * - The only network requests go to the links in the host's config.
 * - An event is identified by (listing, calendar, UID): running twice adds nothing.
 * - An event missing from a calendar that was read correctly is marked removed,
 *   never deleted; if it comes back it is restored.
 * - If a calendar cannot be read (network error, not iCal), nothing is changed.
 */
import { classify, IcalError, parseIcal } from "./ical.js";
import { feedKeys, isIcal, type HostListing } from "./config.js";
import type { Db } from "./db.js";
import type { FetchLike } from "./io.js";

export interface FeedReport {
  listing: string;
  feed: string;
  ok: boolean;
  seen: number;
  added: number;
  changed: number;
  removed: number;
  restored: number;
  skipped: string[];
  error?: string;
}

export interface SyncOptions {
  fetch: FetchLike;
  now: Date;
  timeoutMs?: number;
}

/** Host of the placeholder links written by "fairnight init". */
const EXAMPLE_HOST = "calendar.example.com";

/** Calendars bigger than this are refused: a real one is a few tens of kB. */
const MAX_BYTES = 5_000_000;

async function download(url: string, opts: SyncOptions): Promise<string> {
  const res = await opts.fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    headers: { accept: "text/calendar, text/plain;q=0.9" },
  });
  if (!res.ok) throw new Error(`the server answered HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("the calendar is larger than 5 MB");
  return text;
}

function describeError(e: unknown, url: string): string {
  const message = e instanceof IcalError ? e.message : e instanceof Error ? e.message : String(e);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // keep empty
  }
  const hint = host === EXAMPLE_HOST ?" (this is the example link: put your own iCal link in the config)" : "";
  return `${message}${hint}`;
}

interface Row {
  uid: string;
  check_in: string;
  check_out: string;
  kind: string;
  removed_at: string | null;
}

export async function syncListings(db: Db, listings: HostListing[], opts: SyncOptions): Promise<FeedReport[]> {
  const reports: FeedReport[] = [];
  const at = opts.now.toISOString();

  const recordRun = db.prepare(
    `INSERT INTO sync_runs (listing, feed, at, ok, seen, added, changed, removed, restored, error)
     VALUES (@listing, @feed, @at, @ok, @seen, @added, @changed, @removed, @restored, @error)`,
  );
  const selectRows = db.prepare("SELECT uid, check_in, check_out, kind, removed_at FROM calendar_events WHERE listing = ? AND feed = ?");
  const insert = db.prepare(
    `INSERT INTO calendar_events (listing, feed, uid, check_in, check_out, kind, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE calendar_events SET check_in = ?, check_out = ?, kind = ?, last_seen_at = ?, removed_at = NULL
     WHERE listing = ? AND feed = ? AND uid = ?`,
  );
  const markRemoved = db.prepare("UPDATE calendar_events SET removed_at = ? WHERE listing = ? AND feed = ? AND uid = ?");

  for (const listing of listings) {
    const keys = feedKeys(listing);
    for (const [i, calendar] of listing.calendars.entries()) {
      if (!isIcal(calendar)) continue; // Smoobu and Beds24 are read through their APIs
      const feed = keys[i] as string;
      const report: FeedReport = { listing: listing.name, feed, ok: false, seen: 0, added: 0, changed: 0, removed: 0, restored: 0, skipped: [] };
      try {
        const parsed = parseIcal(await download(calendar.url, opts));
        report.skipped = parsed.skipped;
        report.seen = parsed.events.length;
        db.transaction(() => {
          const existing = new Map((selectRows.all(listing.name, feed) as Row[]).map((r) => [r.uid, r]));
          const present = new Set<string>();
          for (const ev of parsed.events) {
            present.add(ev.uid);
            const kind = classify(ev.summary, calendar.source, calendar.treatAs);
            const row = existing.get(ev.uid);
            if (!row) {
              insert.run(listing.name, feed, ev.uid, ev.start, ev.end, kind, at, at);
              report.added++;
              continue;
            }
            if (row.removed_at !== null) report.restored++;
            else if (row.check_in !== ev.start || row.check_out !== ev.end || row.kind !== kind) report.changed++;
            update.run(ev.start, ev.end, kind, at, listing.name, feed, ev.uid);
          }
          for (const row of existing.values()) {
            if (row.removed_at === null && !present.has(row.uid)) {
              markRemoved.run(at, listing.name, feed, row.uid);
              report.removed++;
            }
          }
        })();
        report.ok = true;
      } catch (e) {
        report.error = describeError(e, calendar.url);
      }
      recordRun.run({
        listing: listing.name,
        feed,
        at,
        ok: report.ok ? 1 : 0,
        seen: report.seen,
        added: report.added,
        changed: report.changed,
        removed: report.removed,
        restored: report.restored,
        error: report.error ?? null,
      });
      reports.push(report);
    }
  }
  return reports;
}
