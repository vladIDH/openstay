/**
 * The Smoobu commands: `fairnight smoobu collega | importa | spingi`, and the
 * import of Smoobu bookings that `fairnight sync` also runs.
 *
 * Reading: apartments and bookings through the official API (HMAC-signed).
 * Writing: prices and minimum stays, ONLY with --applica; without it, a dry run
 * that shows the differences and writes nothing.
 */
import { existsSync } from "node:fs";
import {
  buildOperations,
  chunks,
  mapBookings,
  planPush,
  probePair,
  SmoobuClient,
  SmoobuError,
  type RangeEnd,
} from "fairnight-smoobu";
import { CONFIG_FILE, configPath, localToday, type Io } from "./io.js";
import { noteChannelGuests } from "./guests/store.js";
import { addDays, appendListings, daysBetween, diffTable, emptyReport, HISTORY_DAYS, recordRun, slugify, storeStays } from "./channel.js";
import { isSmoobu, loadHostConfig, SetupError, smoobuApartment, type HostListing } from "./config.js";
import { CREDENTIALS_FILE, loadCredentials, saveCredentials } from "./credentials.js";
import { getMeta, openDb, setMeta, type Db } from "./db.js";
import { dbPath } from "./io.js";
import { priceOne } from "./price.js";
import type { FeedReport } from "./sync.js";

export const SMOOBU_FEED = "smoobu";
/** Operations per POST /api/rates request (Smoobu documents no maximum). */
const OPERATIONS_PER_REQUEST = 50;
const RANGE_END_KEY = "smoobu_range_end";
const RANGE_CHECKED_KEY = "smoobu_range_end_checked_on";

export function smoobuClient(dir: string, io: Io): SmoobuClient {
  const { credentials } = loadCredentials(dir, io.env ?? {});
  return new SmoobuClient({
    credentials,
    fetch: io.smoobuFetch ?? ((url, init) => fetch(url, init)),
    ...(io.smoobuBaseUrl ? { baseUrl: io.smoobuBaseUrl } : {}),
    now: () => io.now(),
    ...(io.sleep ? { sleep: io.sleep } : {}),
  });
}

export const smoobuListings = (listings: HostListing[]) => listings.filter((l) => l.calendars.some(isSmoobu));

// ---------------------------------------------------------------- collega

export async function connect(dir: string, io: Io): Promise<number> {
  if (!existsSync(configPath(dir))) throw new SetupError(`No ${CONFIG_FILE} in ${dir}. Run "fairnight init" in this folder first.`);
  if (!io.prompt) throw new SetupError('"fairnight smoobu collega" needs a terminal to ask for the key.');
  io.out("Create the key in Smoobu: Settings → Advanced → API Keys → Create API Key, then Generate Secret.");
  io.out("Fairnight signs every request (HMAC): it needs both the key and the secret. Nothing you type is shown.");
  let apiKey: string;
  let apiSecret: string;
  try {
    apiKey = (await io.prompt("Smoobu API key: ", { hidden: true })).trim();
    apiSecret = (await io.prompt("Smoobu API secret: ", { hidden: true })).trim();
  } catch {
    throw new SetupError("Cancelled: nothing was saved.");
  }
  if (apiKey === "" || apiSecret === "") throw new SetupError("The key or the secret was empty: nothing was saved.");

  const client = new SmoobuClient({
    credentials: { apiKey, apiSecret },
    fetch: io.smoobuFetch ?? ((url, init) => fetch(url, init)),
    ...(io.smoobuBaseUrl ? { baseUrl: io.smoobuBaseUrl } : {}),
    now: () => io.now(),
    ...(io.sleep ? { sleep: io.sleep } : {}),
  });
  let count: number;
  try {
    count = (await client.listApartments()).length;
  } catch (e) {
    if (e instanceof SmoobuError) {
      io.err(`${e.message} Nothing was saved.`);
      return 1;
    }
    throw e;
  }
  const protection = saveCredentials(dir, { apiKey, apiSecret });
  io.out(`Connected to Smoobu: ${count} apartment${count === 1 ? "" : "s"} found.`);
  io.out(`Key and secret saved in ${CREDENTIALS_FILE}, ${protection}. Never share or commit this file.`);
  if (io.env?.SMOOBU_API_KEY || io.env?.SMOOBU_API_SECRET) {
    io.out("Note: SMOOBU_API_KEY / SMOOBU_API_SECRET are set in this shell and take precedence over the saved file.");
  }
  io.out('Next: "fairnight smoobu importa".');
  return 0;
}

// ---------------------------------------------------------------- import of bookings

/**
 * Bookings of every listing linked to Smoobu, into the same tables the iCal
 * calendars use (feed "smoobu"). One request series for all apartments.
 * Blocked dates enter as unavailable ("blocked"), never as bookings.
 * If Smoobu cannot be read, nothing is changed.
 */
export async function importBookings(db: Db, listings: HostListing[], client: SmoobuClient, now: Date): Promise<FeedReport[]> {
  const linked = smoobuListings(listings);
  if (linked.length === 0) return [];
  const at = now.toISOString();
  const from = addDays(localToday(now), -HISTORY_DAYS);
  const record = (r: FeedReport) => recordRun(db, r, at);

  let bookings;
  try {
    bookings = await client.listReservations({ departureFrom: from });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return linked.map((l) => {
      const r = { ...emptyReport(l.name, SMOOBU_FEED), error: message };
      record(r);
      return r;
    });
  }
  const mapped = mapBookings(bookings);

  const reports: FeedReport[] = [];
  for (const listing of linked) {
    const apt = smoobuApartment(listing) as number;
    const stays = mapped.stays.filter((s) => s.apartmentId === apt);
    const r = { ...emptyReport(listing.name, SMOOBU_FEED), ok: true, seen: stays.length, skipped: mapped.skipped };
    storeStays(db, { listing: listing.name, feed: SMOOBU_FEED, priceTable: "smoobu_stays", stays, from, at, report: r });
    noteChannelGuests(db, listing, SMOOBU_FEED, stays, now);
    record(r);
    reports.push(r);
  }
  return reports;
}

// ---------------------------------------------------------------- importa

export interface ImportSummary {
  added: { name: string; apartmentId: number; title: string; basePrice: number; currency: string }[];
  reports: FeedReport[];
}

/** `fairnight smoobu importa`: new Smoobu apartments become listings, then every linked listing gets its bookings. */
export async function importFromSmoobu(dir: string, io: Io): Promise<ImportSummary> {
  const config = loadHostConfig(dir);
  const client = smoobuClient(dir, io);
  const apartments = await client.listApartments();
  const linked = new Set(config.listings.map(smoobuApartment).filter((x): x is number => x !== null));
  const taken = new Set(config.listings.map((l) => l.name));
  const added: ImportSummary["added"] = [];
  const newListings: unknown[] = [];

  for (const apt of apartments) {
    if (linked.has(apt.id)) continue;
    const d = await client.getApartment(apt.id);
    const min = d.price.minimal;
    const max = d.price.maximal;
    const base = Math.round(min !== null && max !== null ? (min + max) / 2 : (min ?? max ?? 100));
    const floor = Math.round(min ?? base * 0.6);
    const ceiling = Math.round(Math.max(max ?? base * 2.5, base));
    const name = slugify(apt.name, taken, `smoobu-${apt.id}`);
    const currency = d.currency && /^[A-Z]{3}$/.test(d.currency) ? d.currency : "EUR";
    newListings.push({
      name,
      calendars: [{ source: "smoobu", apartmentId: apt.id }],
      pricing: {
        name: apt.name,
        currency,
        basePrice: base,
        defaultMinStay: 2,
        factors: {
          limits: { enabled: true, floorPrice: Math.min(floor, base), ceilingPrice: ceiling },
          rounding: { enabled: true, step: 1 },
        },
      },
    });
    added.push({ name, apartmentId: apt.id, title: apt.name, basePrice: base, currency });
  }

  appendListings(dir, newListings);

  const fresh = loadHostConfig(dir);
  const db = openDb(dbPath(dir));
  try {
    return { added, reports: await importBookings(db, fresh.listings, client, io.now()) };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------- spingi

export interface PushOptions {
  apply: boolean;
  from?: string;
  to?: string;
  apartment?: number;
  useSmoobuHistory?: boolean;
}

/** `fairnight smoobu spingi`: show the differences; write them only with apply. */
export async function push(dir: string, io: Io, opts: PushOptions): Promise<number> {
  const config = loadHostConfig(dir);
  let listings = smoobuListings(config.listings);
  if (opts.apartment !== undefined) listings = listings.filter((l) => smoobuApartment(l) === opts.apartment);
  if (listings.length === 0) {
    throw new SetupError(
      opts.apartment !== undefined
        ? `No listing is linked to Smoobu apartment ${opts.apartment}. Run "fairnight smoobu importa" first.`
        : 'No listing is linked to Smoobu yet. Run "fairnight smoobu importa" first.',
    );
  }
  const today = localToday(io.now());
  const from = opts.from ?? today;
  const to = opts.to ?? addDays(from, 89);
  if (from < today) throw new SetupError(`--da ${from} is in the past: Fairnight prices nights from today (${today}).`);
  if (to < from) throw new SetupError(`--a ${to} is before --da ${from}.`);
  if (daysBetween(today, to) + 1 > 366) throw new SetupError("Push at most 366 days from today.");

  const client = smoobuClient(dir, io);
  const db = openDb(dbPath(dir));
  let failed = 0;
  let totalChanges = 0;
  try {
    let rangeEnd = (getMeta(db, RANGE_END_KEY) as RangeEnd | null) ?? "unknown";
    for (const listing of listings) {
      const apt = smoobuApartment(listing) as number;
      const quotes = priceOne(db, listing, today, daysBetween(today, to) + 1, { useSmoobuHistory: opts.useSmoobuHistory ?? false }).nights.filter(
        (n) => n.date >= from,
      );
      const current = (await client.getRates([apt], from, to))[String(apt)] ?? {};
      const plan = planPush(quotes, current);
      io.out(`${listing.name} → Smoobu apartment ${apt} · ${from} → ${to} · prices in ${listing.pricing.currency}`);
      if (plan.changes.length > 0) for (const line of diffTable(plan.changes, "Smoobu")) io.out(line);
      io.out(
        `${plan.changes.length} night${plan.changes.length === 1 ? "" : "s"} to change · ${plan.unchanged} already right` +
          (plan.unavailableOnSmoobu.length > 0
            ? ` · ${plan.unavailableOnSmoobu.length} free here but unavailable on Smoobu, left alone (run "fairnight smoobu importa")`
            : ""),
      );
      totalChanges += plan.changes.length;
      if (!opts.apply || plan.changes.length === 0) {
        io.out("");
        continue;
      }

      let rows = plan.changes;
      let operations = 0;
      try {
        if (rangeEnd === "unknown") {
          // Smoobu's docs do not say whether "from:to" includes "to". Check it once with two nights.
          const pair = probePair(rows);
          if (pair) {
            const [a, b] = pair;
            await client.postRates([apt], [{ dates: [`${a.date}:${b.date}`], daily_price: a.newPrice, min_length_of_stay: a.newMinStay }]);
            operations++;
            const back = (await client.getRates([apt], a.date, b.date))[String(apt)] ?? {};
            const second = back[b.date];
            rangeEnd = second?.price === b.newPrice && second.min_length_of_stay === b.newMinStay ? "inclusive" : "exclusive";
            setMeta(db, RANGE_END_KEY, rangeEnd);
            setMeta(db, RANGE_CHECKED_KEY, today);
            io.out(
              rangeEnd === "inclusive"
                ? `Checked once how Smoobu reads a date range (${a.date}:${b.date}): the last day IS written. From now on, runs of equal nights go in ranges of up to 7.`
                : `Checked once how Smoobu reads a date range (${a.date}:${b.date}): the last day is NOT written. Fairnight keeps writing one night per operation.`,
            );
            rows = rows.filter((r) => r.date !== a.date && (rangeEnd !== "inclusive" || r.date !== b.date));
          }
        }
        const ops = buildOperations(rows, rangeEnd);
        for (const part of chunks(ops, OPERATIONS_PER_REQUEST)) {
          await client.postRates([apt], part);
          operations += part.length;
        }
        const after = (await client.getRates([apt], from, to))[String(apt)] ?? {};
        const wrong = plan.changes.filter((r) => after[r.date]?.price !== r.newPrice || after[r.date]?.min_length_of_stay !== r.newMinStay);
        db.prepare("INSERT INTO smoobu_pushes (listing, apartment_id, at, nights, operations, mismatches, error) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(
          listing.name,
          apt,
          io.now().toISOString(),
          plan.changes.length,
          operations,
          wrong.length,
        );
        io.out(`Written to Smoobu: ${plan.changes.length} nights in ${operations} operations.`);
        if (wrong.length === 0) io.out("Read back from Smoobu: every night matches.");
        else {
          failed++;
          io.out(`Read back from Smoobu: ${wrong.length} nights do not match yet: ${wrong.map((r) => r.date).join(", ")}.`);
        }
      } catch (e) {
        if (!(e instanceof SmoobuError)) throw e;
        failed++;
        db.prepare("INSERT INTO smoobu_pushes (listing, apartment_id, at, nights, operations, mismatches, error) VALUES (?, ?, ?, ?, ?, 0, ?)").run(
          listing.name,
          apt,
          io.now().toISOString(),
          plan.changes.length,
          operations,
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
    io.out(
      totalChanges > 0
        ? `Dry run: nothing was written to Smoobu. Add --applica to write these ${totalChanges} nights.`
        : "Dry run: Smoobu already has Fairnight's prices, nothing to write.",
    );
  }
  return failed > 0 ? 1 : 0;
}
