/**
 * Everything `fairnight sync` reads: the iCal calendars, then the Smoobu
 * bookings of the listings linked to Smoobu. Used by the command and by the
 * Recalculate button of the calendar page.
 */
import { SetupError, type HostListing } from "./config.js";
import type { Db } from "./db.js";
import type { Io } from "./io.js";
import { importBookings, SMOOBU_FEED, smoobuClient, smoobuListings } from "./smoobu.js";
import { syncListings, type FeedReport } from "./sync.js";

export async function syncEverything(db: Db, dir: string, listings: HostListing[], io: Io): Promise<FeedReport[]> {
  const reports = await syncListings(db, listings, { fetch: io.fetch, now: io.now() });
  const linked = smoobuListings(listings);
  if (linked.length === 0) return reports;
  let client;
  try {
    client = smoobuClient(dir, io);
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
    return [
      ...reports,
      ...linked.map((l) => ({ listing: l.name, feed: SMOOBU_FEED, ok: false, seen: 0, added: 0, changed: 0, removed: 0, restored: 0, skipped: [], error: e.message })),
    ];
  }
  return [...reports, ...(await importBookings(db, listings, client, io.now()))];
}

export function formatFeedReport(r: FeedReport): string[] {
  if (!r.ok) {
    const what = r.feed === SMOOBU_FEED ? "Smoobu" : "this calendar";
    return [`${r.listing} · ${r.feed}: NOT READ — ${r.error?.replace(/\.$/, "")}. Nothing was changed for ${what}.`];
  }
  const noun = r.feed === SMOOBU_FEED ? "bookings" : "events";
  return [
    `${r.listing} · ${r.feed}: ${r.seen} ${noun} · ${r.added} new · ${r.changed} changed · ${r.removed} removed · ${r.restored} back`,
    ...r.skipped.map((s) => `    skipped: ${s}`),
  ];
}
