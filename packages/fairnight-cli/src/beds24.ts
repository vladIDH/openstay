/**
 * The Beds24 commands: `fairnight beds24 collega | importa | spingi`, and the
 * import of Beds24 bookings that `fairnight sync` also runs.
 *
 * One Fairnight listing = one Beds24 room (roomId). Rooms with more than one
 * identical unit are not handled in this version: the engine prices one home.
 * Writing: the chosen price field and minStay only, ONLY with --applica.
 */
import { existsSync } from "node:fs";
import { Beds24Client, Beds24Error, buildWrites, mapBookings, nightsOf, planPush, probePair, type CreditState, type RangeEnd, type Room } from "fairnight-beds24";
import { noteChannelGuests } from "./guests/store.js";
import { addDays, appendListings, daysBetween, diffTable, emptyReport, HISTORY_DAYS, recordRun, slugify, storeStays } from "./channel.js";
import { beds24Room, isBeds24, loadHostConfig, SetupError, type HostListing } from "./config.js";
import { BEDS24_CREDENTIALS_FILE, loadBeds24Credentials, saveBeds24Credentials, saveBeds24Token } from "./beds24-credentials.js";
import { getMeta, openDb, setMeta, type Db } from "./db.js";
import { CONFIG_FILE, configPath, dbPath, localToday, type Io } from "./io.js";
import { priceOne } from "./price.js";
import type { FeedReport } from "./sync.js";

export const BEDS24_FEED = "beds24";
const RANGE_END_KEY = "beds24_range_end";
const RANGE_CHECKED_KEY = "beds24_range_end_checked_on";

export const beds24Listings = (listings: HostListing[]) => listings.filter((l) => l.calendars.some(isBeds24));

export function beds24Client(dir: string, io: Io): Beds24Client {
  const creds = loadBeds24Credentials(dir, io.env ?? {});
  return new Beds24Client({
    refreshToken: creds.refreshToken,
    cachedToken: creds.cachedToken,
    onToken: (token) => saveBeds24Token(dir, creds.refreshToken, token),
    fetch: io.beds24Fetch ?? ((url, init) => fetch(url, init)),
    ...(io.beds24BaseUrl ? { baseUrl: io.beds24BaseUrl } : {}),
    now: () => io.now(),
    ...(io.sleep ? { sleep: io.sleep } : {}),
  });
}

/** "Beds24 credits: 7 used in this run · 93 left of 100 in this 5-minute window." */
export function creditsLine(c: CreditState): string {
  const left = c.remaining !== null && c.limit !== null ? `${c.remaining} left of ${c.limit} in this 5-minute window` : "credits left not reported";
  return `Beds24 credits: ${c.used} used in this run · ${left}.`;
}

// ---------------------------------------------------------------- collega

export async function connect(dir: string, io: Io): Promise<number> {
  if (!existsSync(configPath(dir))) throw new SetupError(`No ${CONFIG_FILE} in ${dir}. Run "fairnight init" in this folder first.`);
  if (!io.prompt) throw new SetupError('"fairnight beds24 collega" needs a terminal to ask for the invite code.');
  io.out("Create an invite code in Beds24: Settings → Marketplace → API → Generate invite code.");
  io.out("Choose these permissions now, they cannot be changed later: read:bookings, all:inventory, read:properties.");
  io.out("The code works once and for 24 hours. Nothing you type is shown.");
  let code: string;
  try {
    code = (await io.prompt("Beds24 invite code: ", { hidden: true })).trim();
  } catch {
    throw new SetupError("Cancelled: nothing was saved.");
  }
  if (code === "") throw new SetupError("The invite code was empty: nothing was saved.");
  const fetchFn = io.beds24Fetch ?? ((url, init) => fetch(url, init));
  let setup;
  try {
    setup = await Beds24Client.setup({ inviteCode: code, fetch: fetchFn, ...(io.beds24BaseUrl ? { baseUrl: io.beds24BaseUrl } : {}), now: () => io.now() });
  } catch (e) {
    if (e instanceof Beds24Error) {
      io.err(`${e.message} Nothing was saved.`);
      return 1;
    }
    throw e;
  }
  const protection = saveBeds24Credentials(dir, setup.refreshToken, setup.token);
  const client = beds24Client(dir, { ...io, env: {} });
  const rooms = await client.listRooms();
  io.out(`Connected to Beds24: ${rooms.length} room${rooms.length === 1 ? "" : "s"} found.`);
  io.out(`Refresh token saved in ${BEDS24_CREDENTIALS_FILE}, ${protection}. Never share or commit this file.`);
  io.out("A refresh token stops working after 30 days without use: run any Beds24 command at least once a month.");
  if (io.env?.BEDS24_REFRESH_TOKEN) io.out("Note: BEDS24_REFRESH_TOKEN is set in this shell and takes precedence over the saved file.");
  io.out(creditsLine({ ...client.credits, used: client.credits.used + setup.credits.used }));
  io.out('Next: "fairnight beds24 importa".');
  return 0;
}

// ---------------------------------------------------------------- import of bookings

/**
 * Bookings of every listing linked to Beds24, into the same tables the iCal
 * calendars use (feed "beds24"). If Beds24 cannot be read, nothing changes.
 */
export async function importBookings(db: Db, listings: HostListing[], client: Beds24Client, now: Date): Promise<FeedReport[]> {
  const linked = beds24Listings(listings);
  if (linked.length === 0) return [];
  const at = now.toISOString();
  const from = addDays(localToday(now), -HISTORY_DAYS);
  let bookings;
  try {
    bookings = await client.listBookings({ departureFrom: from, roomIds: linked.map((l) => (beds24Room(l) as { roomId: number }).roomId) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return linked.map((l) => {
      const r = { ...emptyReport(l.name, BEDS24_FEED), error: message };
      recordRun(db, r, at);
      return r;
    });
  }
  const mapped = mapBookings(bookings);
  return linked.map((listing) => {
    const roomId = (beds24Room(listing) as { roomId: number }).roomId;
    const stays = mapped.stays.filter((s) => s.roomId === roomId);
    const r = { ...emptyReport(listing.name, BEDS24_FEED), ok: true, seen: stays.length, skipped: mapped.skipped };
    storeStays(db, { listing: listing.name, feed: BEDS24_FEED, priceTable: "beds24_stays", stays, from, at, report: r });
    noteChannelGuests(db, listing, BEDS24_FEED, stays, now);
    recordRun(db, r, at);
    return r;
  });
}

// ---------------------------------------------------------------- importa

export interface ImportSummary {
  added: { name: string; roomId: number; title: string; basePrice: number; currency: string }[];
  skipped: Room[];
  reports: FeedReport[];
  credits: CreditState;
}

export async function importFromBeds24(dir: string, io: Io): Promise<ImportSummary> {
  const config = loadHostConfig(dir);
  const client = beds24Client(dir, io);
  const rooms = await client.listRooms();
  const linked = new Set(config.listings.map((l) => beds24Room(l)?.roomId).filter((x): x is number => x !== undefined));
  const taken = new Set(config.listings.map((l) => l.name));
  const added: ImportSummary["added"] = [];
  const skipped: Room[] = [];
  const newListings: unknown[] = [];
  for (const room of rooms) {
    if (linked.has(room.roomId)) continue;
    if (room.qty > 1) {
      skipped.push(room);
      continue;
    }
    const base = Math.round(room.rackRate ?? (room.minPrice !== null ? room.minPrice * 1.5 : 100));
    const floor = Math.round(Math.min(room.minPrice ?? base * 0.6, base));
    const currency = room.currency && /^[A-Z]{3}$/.test(room.currency) ? room.currency : "EUR";
    const name = slugify(room.name, taken, `beds24-${room.roomId}`);
    newListings.push({
      name,
      calendars: [{ source: "beds24", roomId: room.roomId }],
      pricing: {
        name: `${room.propertyName} · ${room.name}`,
        currency,
        basePrice: base,
        defaultMinStay: 2,
        factors: {
          limits: { enabled: true, floorPrice: floor, ceilingPrice: Math.round(base * 2.5) },
          rounding: { enabled: true, step: 1 },
        },
      },
    });
    added.push({ name, roomId: room.roomId, title: `${room.propertyName} · ${room.name}`, basePrice: base, currency });
  }
  appendListings(dir, newListings);
  const fresh = loadHostConfig(dir);
  const db = openDb(dbPath(dir));
  try {
    return { added, skipped, reports: await importBookings(db, fresh.listings, client, io.now()), credits: client.credits };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------- spingi

export interface PushOptions {
  apply: boolean;
  from?: string;
  to?: string;
  room?: number;
  useBeds24History?: boolean;
}

export async function push(dir: string, io: Io, opts: PushOptions): Promise<number> {
  const config = loadHostConfig(dir);
  let listings = beds24Listings(config.listings);
  if (opts.room !== undefined) listings = listings.filter((l) => beds24Room(l)?.roomId === opts.room);
  if (listings.length === 0) {
    throw new SetupError(
      opts.room !== undefined
        ? `No listing is linked to Beds24 room ${opts.room}. Run "fairnight beds24 importa" first.`
        : 'No listing is linked to Beds24 yet. Run "fairnight beds24 importa" first.',
    );
  }
  const today = localToday(io.now());
  const from = opts.from ?? today;
  const to = opts.to ?? addDays(from, 89);
  if (from < today) throw new SetupError(`--da ${from} is in the past: Fairnight prices nights from today (${today}).`);
  if (to < from) throw new SetupError(`--a ${to} is before --da ${from}.`);
  if (daysBetween(today, to) + 1 > 366) throw new SetupError("Push at most 366 days from today.");

  const client = beds24Client(dir, io);
  const db = openDb(dbPath(dir));
  let failed = 0;
  let total = 0;
  try {
    let rangeEnd = (getMeta(db, RANGE_END_KEY) as RangeEnd | null) ?? "unknown";
    for (const listing of listings) {
      const { roomId, priceField } = beds24Room(listing) as { roomId: number; priceField: Parameters<Beds24Client["getCalendar"]>[3] };
      const creditsBefore = client.credits.used;
      const quotes = priceOne(db, listing, today, daysBetween(today, to) + 1, { useBeds24History: opts.useBeds24History ?? false }).nights.filter((n) => n.date >= from);
      let current;
      try {
        current = (await client.getCalendar([roomId], from, to, priceField))[roomId] ?? {};
      } catch (e) {
        if (!(e instanceof Beds24Error)) throw e;
        failed++;
        io.out(`${listing.name} → Beds24 room ${roomId}: NOT READ — ${e.message}`);
        continue;
      }
      const plan = planPush(quotes, current);
      io.out(`${listing.name} → Beds24 room ${roomId} (${priceField}) · ${from} → ${to} · prices in ${listing.pricing.currency}`);
      if (plan.changes.length > 0) for (const line of diffTable(plan.changes, "Beds24")) io.out(line);
      io.out(
        `${plan.changes.length} night${plan.changes.length === 1 ? "" : "s"} to change · ${plan.unchanged} already right` +
          (plan.unavailableOnBeds24.length > 0
            ? ` · ${plan.unavailableOnBeds24.length} free here but unavailable on Beds24, left alone (run "fairnight beds24 importa")`
            : ""),
      );
      total += plan.changes.length;
      if (!opts.apply || plan.changes.length === 0) {
        io.out("");
        continue;
      }

      let rows = plan.changes;
      let writes = 0;
      const refused: { date: string; why: string }[] = [];
      try {
        if (rangeEnd === "unknown") {
          // The spec does not say whether "to" is included. Check it once with two equal nights.
          const pair = probePair(rows);
          if (pair) {
            const [a, b] = pair;
            const [probe] = await client.writeCalendar([{ roomId, from: a.date, to: b.date, price: a.newPrice, minStay: a.newMinStay }], priceField);
            writes++;
            if (probe?.ok) {
              const back = (await client.getCalendar([roomId], b.date, b.date, priceField))[roomId]?.[b.date];
              rangeEnd = back?.price === b.newPrice && back.minStay === b.newMinStay ? "inclusive" : "exclusive";
              setMeta(db, RANGE_END_KEY, rangeEnd);
              setMeta(db, RANGE_CHECKED_KEY, today);
              io.out(
                rangeEnd === "inclusive"
                  ? `Checked once how Beds24 reads a date range (${a.date} to ${b.date}): the last day IS written. From now on, runs of equal nights go in ranges of up to 7.`
                  : `Checked once how Beds24 reads a date range (${a.date} to ${b.date}): the last day is NOT written. Fairnight keeps writing one night per element.`,
              );
              rows = rows.filter((r) => r.date !== a.date && (rangeEnd !== "inclusive" || r.date !== b.date));
            }
          }
        }
        const results = await client.writeCalendar(buildWrites(roomId, rows, rangeEnd), priceField);
        writes += results.length;
        for (const r of results) if (!r.ok) for (const d of nightsOf(r.write)) refused.push({ date: d, why: r.errors.join("; ") });
        const after = (await client.getCalendar([roomId], from, to, priceField))[roomId] ?? {};
        const wrong = plan.changes.filter((r) => after[r.date]?.price !== r.newPrice || after[r.date]?.minStay !== r.newMinStay);
        const spent = client.credits.used - creditsBefore;
        db.prepare("INSERT INTO beds24_pushes (listing, room_id, at, nights, writes, refused, mismatches, credits, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)").run(
          listing.name,
          roomId,
          io.now().toISOString(),
          plan.changes.length,
          writes,
          refused.length,
          wrong.length,
          spent,
        );
        io.out(`Sent to Beds24: ${plan.changes.length} nights in ${writes} calendar writes.`);
        for (const r of refused) io.out(`  not written: ${r.date} — Beds24 says: ${r.why}`);
        if (wrong.length === 0) io.out("Read back from Beds24: every night matches.");
        else {
          failed++;
          io.out(`Read back from Beds24: ${wrong.length} night${wrong.length === 1 ? "" : "s"} do not match: ${wrong.map((r) => r.date).join(", ")}.`);
        }
      } catch (e) {
        if (!(e instanceof Beds24Error)) throw e;
        failed++;
        db.prepare("INSERT INTO beds24_pushes (listing, room_id, at, nights, writes, refused, mismatches, credits, error) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)").run(
          listing.name,
          roomId,
          io.now().toISOString(),
          plan.changes.length,
          writes,
          refused.length,
          client.credits.used - creditsBefore,
          e.message,
        );
        io.out(`Stopped: ${e.message}`);
      }
      io.out("");
    }
  } finally {
    db.close();
  }
  if (!opts.apply) {
    io.out(total > 0 ? `Dry run: nothing was written to Beds24. Add --applica to write these ${total} nights.` : "Dry run: Beds24 already has Fairnight's prices, nothing to write.");
  }
  io.out(creditsLine(client.credits));
  return failed > 0 ? 1 : 0;
}
