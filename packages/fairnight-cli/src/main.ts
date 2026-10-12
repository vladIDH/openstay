/**
 * Command line entry: parses the arguments and runs one command.
 * Returns the exit code instead of exiting, so tests can call it directly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ConfigError } from "fairnight";
import { loadHostConfig, selectListings, SetupError, type HostListing } from "./config.js";
import { openDb } from "./db.js";
import { importPrices } from "./import.js";
import { initFolder } from "./init.js";
import { dbPath, localToday, stripBom, type Io } from "./io.js";
import { defaultExportPath, EXPORT_FORMATS, toCsv, writeExport } from "./export.js";
import { formatTable, lastSync, priceOne } from "./price.js";
import { startServer } from "./serve.js";
import { syncListings } from "./sync.js";

export const USAGE = `Fairnight: dynamic prices for short-term rentals, on your own computer.

Usage:
  fairnight init [folder]                          create a folder with an example config and an empty database
  fairnight sync [--listing <name>]                read the iCal calendars written in the config
  fairnight import <file.csv> --listing <name>     store past nightly prices (columns: date, price) [--dry-run]
  fairnight price [--listing <name>]               price every night [--days 365] [--today YYYY-MM-DD] [--explain] [--json]
  fairnight export [--listing <name>]              write date, price and minimum stay to CSV [--days 365] [--format csv] [--out <file>]
  fairnight serve                                  open the calendar page [--port 4321] [--lan to open it from a phone]

Every command works in the current folder; use --dir <folder> to point at another one.`;

class UsageError extends Error {}

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
      default:
        throw new UsageError(`Unknown command "${command}".`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(e.message);
      io.err(USAGE);
      return 2;
    }
    if (e instanceof ConfigError || e instanceof SetupError) {
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
    const reports = await syncListings(db, listings, { fetch: io.fetch, now: io.now() });
    let failed = 0;
    for (const r of reports) {
      if (!r.ok) {
        failed++;
        io.out(`${r.listing} · ${r.feed}: NOT READ — ${r.error}. Nothing was changed for this calendar.`);
        continue;
      }
      io.out(
        `${r.listing} · ${r.feed}: ${r.seen} events · ${r.added} new · ${r.changed} changed · ${r.removed} removed · ${r.restored} back`,
      );
      for (const s of r.skipped) io.out(`    skipped: ${s}`);
    }
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
  values: { listing?: string; days?: string; today?: string; explain?: boolean; json?: boolean },
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
    const results = listings.map((l) => ({ listing: l, result: priceOne(db, l, today, days) }));
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
