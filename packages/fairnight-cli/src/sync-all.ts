/**
 * Everything `fairnight sync` reads: the iCal calendars, then the bookings of
 * the listings linked to Smoobu and to Beds24. Used by the command and by the
 * Recalculate button of the calendar page.
 */
import { BEDS24_FEED, beds24Client, beds24Listings, creditsLine, importBookings as importBeds24 } from "./beds24.js";
import { SetupError, type HostListing } from "./config.js";
import type { Db } from "./db.js";
import type { Io } from "./io.js";
import { importBookings as importSmoobu, SMOOBU_FEED, smoobuClient, smoobuListings } from "./smoobu.js";
import { syncListings, type FeedReport } from "./sync.js";

export interface SyncResult {
  reports: FeedReport[];
  /** Extra lines for the user, e.g. the Beds24 credits spent. */
  notes: string[];
}

const notRead = (listings: HostListing[], feed: string, error: string): FeedReport[] =>
  listings.map((l) => ({ listing: l.name, feed, ok: false, seen: 0, added: 0, changed: 0, removed: 0, restored: 0, skipped: [], error }));

export async function syncEverything(db: Db, dir: string, listings: HostListing[], io: Io): Promise<SyncResult> {
  const reports = await syncListings(db, listings, { fetch: io.fetch, now: io.now() });
  const notes: string[] = [];

  const smoobu = smoobuListings(listings);
  if (smoobu.length > 0) {
    try {
      reports.push(...(await importSmoobu(db, listings, smoobuClient(dir, io), io.now())));
    } catch (e) {
      if (!(e instanceof SetupError)) throw e;
      reports.push(...notRead(smoobu, SMOOBU_FEED, e.message));
    }
  }

  const beds24 = beds24Listings(listings);
  if (beds24.length > 0) {
    try {
      const client = beds24Client(dir, io);
      reports.push(...(await importBeds24(db, listings, client, io.now())));
      notes.push(creditsLine(client.credits));
    } catch (e) {
      if (!(e instanceof SetupError)) throw e;
      reports.push(...notRead(beds24, BEDS24_FEED, e.message));
    }
  }
  return { reports, notes };
}

const CHANNEL_NAMES: Record<string, string> = { [SMOOBU_FEED]: "Smoobu", [BEDS24_FEED]: "Beds24" };

export function formatFeedReport(r: FeedReport): string[] {
  const channel = CHANNEL_NAMES[r.feed];
  if (!r.ok) {
    return [`${r.listing} · ${r.feed}: NOT READ — ${r.error?.replace(/\.$/, "")}. Nothing was changed for ${channel ?? "this calendar"}.`];
  }
  const noun = channel ? "bookings" : "events";
  return [
    `${r.listing} · ${r.feed}: ${r.seen} ${noun} · ${r.added} new · ${r.changed} changed · ${r.removed} removed · ${r.restored} back`,
    ...r.skipped.map((s) => `    skipped: ${s}`),
  ];
}
