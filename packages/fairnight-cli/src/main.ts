/**
 * Command line entry: parses the arguments and runs one command.
 * Returns the exit code instead of exiting, so tests can call it directly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ConfigError } from "fairnight";
import { SmoobuError } from "fairnight-smoobu";
import { loadHostConfig, selectListings, SetupError, type HostListing } from "./config.js";
import { openDb } from "./db.js";
import { importPrices } from "./import.js";
import { UsageError } from "./errors.js";
import { initFolder } from "./init.js";
import { apri } from "./apri.js";
import { configura } from "./configura.js";
import { dbPath, localToday, stripBom, type Io } from "./io.js";
import { defaultExportPath, EXPORT_FORMATS, toCsv, writeExport } from "./export.js";
import { formatTable, lastSync, priceOne } from "./price.js";
import { startServer } from "./serve.js";
import { connect, importFromSmoobu, push } from "./smoobu.js";
import { connect as connectBeds24, creditsLine, importFromBeds24, push as pushBeds24 } from "./beds24.js";
import { Beds24Error } from "fairnight-beds24";
import { AirRoiError, InsideAirbnbError } from "fairnight-market";
import { connectAirRoi, deleteMarketData, importAirRoi, importFile, marketStatus } from "./mercato.js";
import { basePriceCommand } from "./prezzo-base.js";
import { formatFeedReport, syncEverything } from "./sync-all.js";
import { GUEST_USAGE, runGuests } from "./guests/commands.js";

export const USAGE = `Fairnight: dynamic prices for short-term rentals, on your own computer.

Usage:
  fairnight configura                              guided setup in Italian: houses, iCal links, prices, seasons (run again to change them)
  fairnight apri                                   read the calendars, start the calendar page and open it in the browser [--senza-browser]
  fairnight init [folder]                          create a folder with an example config and an empty database
  fairnight sync [--listing <name>]                read the iCal calendars written in the config
  fairnight import <file.csv> --listing <name>     store past nightly prices (columns: date, price) [--dry-run]
  fairnight price [--listing <name>]               price every night [--days 365] [--today YYYY-MM-DD] [--explain] [--json]
  fairnight export [--listing <name>]              write date, price and minimum stay to CSV [--days 365] [--format csv] [--out <file>]
  fairnight serve                                  open the calendar page [--port 4321] [--lan to open it from a phone]
  fairnight smoobu collega                         save your Smoobu API key and secret (asked, never shown)
  fairnight smoobu importa                         Smoobu apartments become listings; bookings into the local database
  fairnight smoobu spingi                          compare with Smoobu; writes only with --applica [--da DATE] [--a DATE] [--alloggio ID]
  fairnight beds24 collega                         exchange a Beds24 invite code for a refresh token (asked, never shown)
  fairnight beds24 importa                         Beds24 rooms become listings; bookings into the local database
  fairnight beds24 spingi                          compare with Beds24; writes only with --applica [--da DATE] [--a DATE] [--alloggio ROOM]
  fairnight mercato importa <file> --zona <name>   zone data from your CSV (date, occupancy, average_price, comparables)
                                                   or from Inside Airbnb files you downloaded (calendar.csv.gz)
                                                   [--fonte csv|insideairbnb] [--annunci listings.csv.gz --tipo T --camere N --ospiti N --quartiere Q] [--dry-run]
  fairnight mercato importa --fonte airroi         AirROI zone metrics with your own key (off until AirROI confirms its terms) [--zona <name>]
  fairnight mercato collega                        save your own AirROI API key (asked, never shown)
  fairnight mercato prezzo-base                    the base price the zone data suggests, and why [--listing <name>] [--applica]
  fairnight mercato stato                          zone data, sources, which listings use them
  fairnight mercato cancella                       delete zone data [--zona <name>] [--fonte csv|insideairbnb|airroi]

Guest registration (Fairguest, Spain: SES.HOSPEDAJES and Mossos d'Esquadra):
${GUEST_USAGE}

Every command works in the current folder; use --dir <folder> to point at another one.`;

const OPTIONS = {
  dir: { type: "string" },
  listing: { type: "string" },
  days: { type: "string" },
  today: { type: "string" },
  explain: { type: "boolean" },
  json: { type: "boolean" },
  "dry-run": { type: "boolean" },
  format: { type: "string" },
  out: { type: "string" },
  port: { type: "string" },
  lan: { type: "boolean" },
  "senza-browser": { type: "boolean" },
  applica: { type: "boolean" },
  da: { type: "string" },
  a: { type: "string" },
  alloggio: { type: "string" },
  // --tipo: the communication for "ospiti", the room type for "mercato".
  tipo: { type: "string" },
  persona: { type: "string" },
  "usa-storico-smoobu": { type: "boolean" },
  "usa-storico-beds24": { type: "boolean" },
  zona: { type: "string" },
  fonte: { type: "string" },
  annunci: { type: "string" },
  camere: { type: "string" },
  ospiti: { type: "string" },
  quartiere: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1096) throw new UsageError(`--${name} must be a whole number from 1 to 1096, got "${raw}"`);
  return n;
}

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    io.err((e as Error).message);
    io.err(USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || command === undefined || command === "help") {
    io.out(USAGE);
    return command === undefined && !values.help ? 2 : 0;
  }
  const dir = path.resolve(io.cwd, values.dir ?? ".");

  try {
    switch (command) {
      case "init":
        return runInit(rest, io);
      case "configura":
      case "setup":
        noExtra(rest);
        return await configura(dir, io);
      case "apri":
      case "open": {
        noExtra(rest);
        const port = values.port === undefined ? 4321 : Number(values.port);
        if (!Number.isInteger(port) || port < 1 || port > 65525) throw new UsageError(`--port must be a number from 1 to 65525, got "${values.port}"`);
        return (await apri(dir, io, { port, days: positiveInt(values.days, 365, "days"), browser: !(values["senza-browser"] ?? false) })).code;
      }
      case "sync":
        return await runSync(dir, values.listing, rest, io);
      case "import":
        return runImport(dir, values.listing, rest, values["dry-run"] ?? false, io);
      case "price":
        return runPrice(dir, values, rest, io);
      case "export":
        return runExport(dir, values, rest, io);
      case "serve":
        return await runServe(dir, values, rest, io);
      case "smoobu":
        return await runSmoobu(dir, values, rest, io);
      case "beds24":
        return await runBeds24(dir, values, rest, io);
      case "mercato":
      case "market":
        return await runMercato(dir, values, rest, io);
      case "ospiti":
      case "guests":
        return await runGuests(dir, values, rest, io);
      default:
        throw new UsageError(`Unknown command "${command}".`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(e.message);
      io.err(USAGE);
      return 2;
    }
    if (e instanceof ConfigError || e instanceof SetupError || e instanceof SmoobuError || e instanceof Beds24Error || e instanceof AirRoiError || e instanceof InsideAirbnbError) {
      io.err(e.message);
      return 1;
    }
    throw e;
  }
}

function noExtra(rest: string[]): void {
  if (rest.length > 0) throw new UsageError(`Unexpected argument "${rest[0]}".`);
}

function runInit(rest: string[], io: Io): number {
  if (rest.length > 1) throw new UsageError(`Unexpected argument "${rest[1]}".`);
  const report = initFolder(path.resolve(io.cwd, rest[0] ?? "."));
  io.out(`Fairnight folder: ${report.folder}`);
  for (const f of report.created) io.out(`  created ${f}`);
  for (const f of report.kept) io.out(`  kept    ${f} (already there, not touched)`);
  io.out("Next: put your iCal links and prices in fairnight.config.json, then run \"fairnight sync\" and \"fairnight price\".");
  return 0;
}

async function runSync(dir: string, listing: string | undefined, rest: string[], io: Io): Promise<number> {
  noExtra(rest);
  const config = loadHostConfig(dir);
  const listings = selectListings(config, listing);
  const db = openDb(dbPath(dir));
  try {
    const { reports, notes } = await syncEverything(db, dir, listings, io);
    let failed = 0;
    for (const r of reports) {
      if (!r.ok) failed++;
      for (const line of formatFeedReport(r)) io.out(line);
    }
    for (const line of notes) io.out(line);
    if (reports.length === 0) io.out("No calendars in the config: add iCal links under \"calendars\".");
    return failed > 0 ? 1 : 0;
  } finally {
    db.close();
  }
}

function runImport(dir: string, listing: string | undefined, rest: string[], dryRun: boolean, io: Io): number {
  const [file, ...extra] = rest;
  if (file === undefined) throw new UsageError("Which file? fairnight import <file.csv> --listing <name>");
  noExtra(extra);
  if (listing === undefined) throw new UsageError("Which listing? Add --listing <name>.");
  const config = loadHostConfig(dir);
  const target = selectListings(config, listing)[0] as HostListing;
  const filePath = path.resolve(io.cwd, file);
  let text: string;
  try {
    text = stripBom(readFileSync(filePath, "utf8"));
  } catch (e) {
    throw new SetupError(`Cannot read ${filePath}: ${(e as Error).message}`);
  }
  const db = openDb(dbPath(dir));
  try {
    const r = importPrices(db, target.name, filePath, text, { now: io.now(), dryRun });
    const verb = r.dryRun ? "would import" : "imported";
    io.out(`${r.listing}: ${verb} ${r.imported} nightly prices from ${r.file}` + (r.first ? ` (${r.first} → ${r.last})` : ""));
    for (const issue of r.issues.slice(0, 20)) io.out(`  line ${issue.line}: ${issue.message}`);
    if (r.issues.length > 20) io.out(`  … and ${r.issues.length - 20} more lines with problems`);
    return r.imported === 0 ? 1 : 0;
  } finally {
    db.close();
  }
}

function runPrice(
  dir: string,
  values: { listing?: string; days?: string; today?: string; explain?: boolean; json?: boolean; "usa-storico-smoobu"?: boolean; "usa-storico-beds24"?: boolean },
  rest: string[],
  io: Io,
): number {
  noExtra(rest);
  const days = positiveInt(values.days, 365, "days");
  const today = todayOf(values, io);
  const config = loadHostConfig(dir);
  const listings = selectListings(config, values.listing);
  const db = openDb(dbPath(dir));
  try {
    const results = listings.map((l) => ({
      listing: l,
      result: priceOne(db, l, today, days, { useSmoobuHistory: values["usa-storico-smoobu"] ?? false, useBeds24History: values["usa-storico-beds24"] ?? false }),
    }));
    if (values.json) {
      io.out(JSON.stringify(results.map((r) => ({ listing: r.listing.name, ...r.result })), null, 2));
      return 0;
    }
    results.forEach((r, i) => {
      if (i > 0) io.out("");
      for (const line of formatTable(r.result, r.listing.name, lastSync(db, r.listing.name), values.explain ?? false)) io.out(line);
    });
    return 0;
  } finally {
    db.close();
  }
}

function todayOf(values: { today?: string }, io: Io): string {
  if (values.today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) {
    throw new UsageError(`--today must be a date like 2026-11-01, got "${values.today}"`);
  }
  return values.today ?? localToday(io.now());
}

function runExport(
  dir: string,
  values: { listing?: string; days?: string; today?: string; format?: string; out?: string },
  rest: string[],
  io: Io,
): number {
  noExtra(rest);
  const format = values.format ?? "csv";
  if (format === "smoobu") {
    throw new UsageError(
      "Smoobu does not publish a CSV format for importing rates, so there is no smoobu export. Use --format csv and enter the prices in Smoobu, or wait for the Smoobu connector.",
    );
  }
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw new UsageError(`Unknown format "${format}". Formats: ${EXPORT_FORMATS.join(", ")}.`);
  const days = positiveInt(values.days, 365, "days");
  const today = todayOf(values, io);
  const config = loadHostConfig(dir);
  const listings = selectListings(config, values.listing);
  if (values.out !== undefined && listings.length > 1) throw new UsageError("--out works with one listing: add --listing <name>.");
  const db = openDb(dbPath(dir));
  try {
    for (const listing of listings) {
      const result = priceOne(db, listing, today, days);
      const file = values.out !== undefined ? path.resolve(io.cwd, values.out) : defaultExportPath(dir, listing.name, today);
      const csv = toCsv(result);
      writeExport(file, csv);
      const rows = result.nights.filter((n) => n.price !== null).length;
      io.out(`${listing.name}: ${rows} nights for sale written to ${file}`);
    }
    return 0;
  } finally {
    db.close();
  }
}

async function runServe(dir: string, values: { port?: string; lan?: boolean; days?: string; today?: string }, rest: string[], io: Io): Promise<number> {
  noExtra(rest);
  const port = values.port === undefined ? 4321 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port must be a number from 0 to 65535, got "${values.port}"`);
  const days = positiveInt(values.days, 365, "days");
  const opts = { dir, io, days, port, lan: values.lan ?? false, ...(values.today !== undefined ? { today: todayOf(values, io) } : {}) };
  try {
    await startServer(opts);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") throw new SetupError(`Port ${port} is already in use: try --port ${port + 1}.`);
    throw e;
  }
  return 0; // the open server keeps the process running until Ctrl+C
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function runSmoobu(
  dir: string,
  values: { applica?: boolean; da?: string; a?: string; alloggio?: string; "usa-storico-smoobu"?: boolean },
  rest: string[],
  io: Io,
): Promise<number> {
  const [sub, ...extra] = rest;
  noExtra(extra);
  switch (sub) {
    case "collega":
    case "connect":
      return connect(dir, io);
    case "importa":
    case "import": {
      const summary = await importFromSmoobu(dir, io);
      for (const a of summary.added) {
        io.out(`Added listing "${a.name}" for Smoobu apartment ${a.apartmentId} (${a.title}): base price ${a.basePrice} ${a.currency}, from the prices set in Smoobu. Check its rules in fairnight.config.json.`);
      }
      if (summary.added.length > 0) io.out("The previous config is kept as fairnight.config.json.bak.");
      let failed = 0;
      for (const r of summary.reports) {
        if (!r.ok) failed++;
        for (const line of formatFeedReport(r)) io.out(line);
      }
      if (summary.reports.length === 0) io.out("No Smoobu apartment found.");
      return failed > 0 ? 1 : 0;
    }
    case "spingi":
    case "push": {
      for (const [flag, v] of [["da", values.da], ["a", values.a]] as const) {
        if (v !== undefined && !ISO_DATE.test(v)) throw new UsageError(`--${flag} must be a date like 2026-11-01, got "${v}"`);
      }
      let apartment: number | undefined;
      if (values.alloggio !== undefined) {
        apartment = Number(values.alloggio);
        if (!Number.isInteger(apartment) || apartment <= 0) throw new UsageError(`--alloggio must be a Smoobu apartment number, got "${values.alloggio}"`);
      }
      return push(dir, io, {
        apply: values.applica ?? false,
        ...(values.da !== undefined ? { from: values.da } : {}),
        ...(values.a !== undefined ? { to: values.a } : {}),
        ...(apartment !== undefined ? { apartment } : {}),
        useSmoobuHistory: values["usa-storico-smoobu"] ?? false,
      });
    }
    default:
      throw new UsageError(sub === undefined ? "Which Smoobu command? collega, importa or spingi." : `Unknown Smoobu command "${sub}". Use collega, importa or spingi.`);
  }
}

async function runBeds24(
  dir: string,
  values: { applica?: boolean; da?: string; a?: string; alloggio?: string; "usa-storico-beds24"?: boolean },
  rest: string[],
  io: Io,
): Promise<number> {
  const [sub, ...extra] = rest;
  noExtra(extra);
  switch (sub) {
    case "collega":
    case "connect":
      return connectBeds24(dir, io);
    case "importa":
    case "import": {
      const summary = await importFromBeds24(dir, io);
      for (const a of summary.added) {
        const units = a.units > 1 ? `, ${a.units} identical units at one price` : "";
        io.out(`Added listing "${a.name}" for Beds24 room ${a.roomId} (${a.title}${units}): base price ${a.basePrice} ${a.currency}, from the prices set in Beds24. Check its rules in fairnight.config.json.`);
      }
      for (const c of summary.unitsChanged) {
        io.out(`Beds24 room ${c.room.roomId} (${c.room.name}) now has ${c.room.qty} unit${c.room.qty === 1 ? "" : "s"}, listing "${c.name}" says ${c.units}: change pricing.units in fairnight.config.json.`);
      }
      if (summary.added.length > 0) io.out("The previous config is kept as fairnight.config.json.bak.");
      let failed = 0;
      for (const r of summary.reports) {
        if (!r.ok) failed++;
        for (const line of formatFeedReport(r)) io.out(line);
      }
      if (summary.reports.length === 0) io.out("No Beds24 room linked to a listing.");
      io.out(creditsLine(summary.credits));
      return failed > 0 ? 1 : 0;
    }
    case "spingi":
    case "push": {
      for (const [flag, v] of [["da", values.da], ["a", values.a]] as const) {
        if (v !== undefined && !ISO_DATE.test(v)) throw new UsageError(`--${flag} must be a date like 2026-11-01, got "${v}"`);
      }
      let room: number | undefined;
      if (values.alloggio !== undefined) {
        room = Number(values.alloggio);
        if (!Number.isInteger(room) || room <= 0) throw new UsageError(`--alloggio must be a Beds24 room number, got "${values.alloggio}"`);
      }
      return pushBeds24(dir, io, {
        apply: values.applica ?? false,
        ...(values.da !== undefined ? { from: values.da } : {}),
        ...(values.a !== undefined ? { to: values.a } : {}),
        ...(room !== undefined ? { room } : {}),
        useBeds24History: values["usa-storico-beds24"] ?? false,
      });
    }
    default:
      throw new UsageError(sub === undefined ? "Which Beds24 command? collega, importa or spingi." : `Unknown Beds24 command "${sub}". Use collega, importa or spingi.`);
  }
}

async function runMercato(
  dir: string,
  values: {
    zona?: string;
    fonte?: string;
    annunci?: string;
    tipo?: string;
    camere?: string;
    ospiti?: string;
    quartiere?: string;
    listing?: string;
    applica?: boolean;
    "dry-run"?: boolean;
  },
  rest: string[],
  io: Io,
): Promise<number> {
  const [sub, ...extra] = rest;
  switch (sub) {
    case "importa":
    case "import": {
      if (values.fonte === "airroi") {
        noExtra(extra);
        return importAirRoi(dir, io, values.zona !== undefined ? { area: values.zona } : {});
      }
      const [file, ...more] = extra;
      if (file === undefined) throw new UsageError("Which file? fairnight mercato importa <file> --zona <name> (or --fonte airroi).");
      noExtra(more);
      let bedrooms: number | undefined;
      if (values.camere !== undefined) {
        bedrooms = Number(values.camere);
        if (!Number.isInteger(bedrooms) || bedrooms < 0) throw new UsageError(`--camere must be a whole number of bedrooms, got "${values.camere}"`);
      }
      let guests: number | undefined;
      if (values.ospiti !== undefined) {
        guests = Number(values.ospiti);
        if (!Number.isInteger(guests) || guests < 1) throw new UsageError(`--ospiti must be a whole number of guests, got "${values.ospiti}"`);
      }
      return importFile(dir, io, {
        file,
        area: values.zona,
        ...(values.fonte !== undefined ? { source: values.fonte } : {}),
        ...(values.annunci !== undefined ? { listingsFile: values.annunci } : {}),
        filter: {
          ...(values.tipo !== undefined ? { roomType: values.tipo } : {}),
          ...(bedrooms !== undefined ? { bedrooms } : {}),
          ...(guests !== undefined ? { guests } : {}),
          ...(values.quartiere !== undefined ? { neighbourhood: values.quartiere } : {}),
        },
        dryRun: values["dry-run"] ?? false,
      });
    }
    case "collega":
    case "connect":
      noExtra(extra);
      return connectAirRoi(dir, io);
    case "prezzo-base":
    case "base-price":
      noExtra(extra);
      return basePriceCommand(dir, io, { ...(values.listing !== undefined ? { listing: values.listing } : {}), apply: values.applica ?? false });
    case "stato":
    case "status":
      noExtra(extra);
      return marketStatus(dir, io);
    case "cancella":
    case "delete":
      noExtra(extra);
      return deleteMarketData(dir, io, {
        ...(values.zona !== undefined ? { area: values.zona } : {}),
        ...(values.fonte !== undefined ? { source: values.fonte } : {}),
      });
    default:
      throw new UsageError(
        sub === undefined ? "Which zone data command? importa, prezzo-base, collega, stato or cancella." : `Unknown command "mercato ${sub}". Use importa, prezzo-base, collega, stato or cancella.`,
      );
  }
}
