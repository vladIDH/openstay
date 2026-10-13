/**
 * The zone data commands: `fairnight mercato importa | collega | stato | cancella`.
 *
 * Sources, all optional and all chosen by the host:
 * - a CSV file of the host's own zone figures;
 * - the Inside Airbnb files the host downloaded (never downloaded here);
 * - AirROI zone metrics with the host's own key, switched off until AirROI
 *   confirms its terms in writing (market.airroi.enabled).
 * Nothing is scraped. Zone data stays in the local database; AirROI data is
 * kept at most 30 days and deleted on request.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { DEFAULT_MARKET, formatAmount } from "fairnight";
import {
  AIRROI_ATTRIBUTION,
  AIRROI_MAX_DAYS,
  AirRoiClient,
  INSIDE_AIRBNB_ATTRIBUTION,
  INSIDE_AIRBNB_ESTIMATE_NOTE,
  InsideAirbnbCalendar,
  InsideAirbnbListings,
  monthlyToDays,
  parseMarketCsv,
  type ComparableFilter,
} from "fairnight-market";
import { addDays } from "./channel.js";
import { AIRROI_CREDENTIALS_FILE, airroiKeySource, loadAirRoiKey, saveAirRoiKey } from "./airroi-credentials.js";
import { isAreaName, loadHostConfig, SetupError, type HostConfig } from "./config.js";
import { openDb } from "./db.js";
import { CONFIG_FILE, configPath, dbPath, localToday, type Io } from "./io.js";
import { deleteMarket, listMarketAreas, purgeExpiredMarket, saveMarket } from "./market-store.js";

export const FILE_SOURCES = ["csv", "insideairbnb"] as const;
export type FileSource = (typeof FILE_SOURCES)[number];

export const AIRROI_OFF =
  "AirROI is switched off (market.airroi.enabled is false in fairnight.config.json): in attesa di conferma scritta da AirROI sui termini d'uso. Nothing was asked, sent or saved.";

/** How many nights ahead AirROI's monthly figures are spread over. */
const AIRROI_DAYS = 365;

function airroiEnabled(config: HostConfig): boolean {
  return config.market?.airroi?.enabled === true;
}

function checkArea(area: string | undefined): string {
  if (area === undefined) throw new SetupError("Which zone? Add --zona <name>, e.g. --zona adeje.");
  if (!isAreaName(area)) throw new SetupError(`--zona must use lowercase letters, digits and dashes (like "adeje"), got "${area}".`);
  return area;
}

/** Feed a text file to a reader by chunks; .gz files are unpacked on the way. */
async function streamText(file: string, onChunk: (chunk: string) => void): Promise<void> {
  if (!existsSync(file) || !statSync(file).isFile()) throw new SetupError(`Cannot read ${file}: no such file.`);
  const raw = createReadStream(file);
  const stream = file.toLowerCase().endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  stream.setEncoding("utf8");
  try {
    for await (const chunk of stream) onChunk(chunk as string);
  } catch (e) {
    throw new SetupError(`Cannot read ${file}: ${(e as Error).message}`);
  }
}

async function readText(file: string): Promise<string> {
  let text = "";
  await streamText(file, (c) => (text += c));
  return text;
}

/** The first bytes of a file (unpacked if .gz), without reading the rest. */
async function readHead(file: string): Promise<string> {
  if (!existsSync(file) || !statSync(file).isFile()) throw new SetupError(`Cannot read ${file}: no such file.`);
  const raw = createReadStream(file);
  const stream = file.toLowerCase().endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  stream.setEncoding("utf8");
  try {
    for await (const chunk of stream) return (chunk as string).slice(0, 200);
    return "";
  } catch (e) {
    throw new SetupError(`Cannot read ${file}: ${(e as Error).message}`);
  } finally {
    raw.destroy();
  }
}

/** Inside Airbnb calendar files are recognised by their header (listing_id first). */
async function detectSource(file: string): Promise<FileSource> {
  const raw = await readHead(file);
  const head = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // byte-order mark
  return /^"?listing_id"?,/i.test(head) ? "insideairbnb" : "csv";
}

function usersOf(config: HostConfig, area: string): string[] {
  return config.listings.filter((l) => l.marketArea === area).map((l) => l.name);
}

function afterImport(io: Io, config: HostConfig, area: string): void {
  const users = usersOf(config, area);
  if (users.length === 0) {
    io.out(`No listing uses zone "${area}" yet: add "marketArea": "${area}" to a listing in ${CONFIG_FILE}, and switch on its factor "market".`);
    return;
  }
  for (const name of users) {
    const l = config.listings.find((x) => x.name === name);
    const on = l?.pricing.factors.market?.enabled === true;
    io.out(`${name}: uses zone "${area}"; zone demand factor ${on ? "on" : 'off (set factors.market.enabled to true to use it)'}.`);
  }
}

// ---------------------------------------------------------------- importa (files)

export interface FileImportOptions {
  file: string;
  area: string | undefined;
  source?: string;
  listingsFile?: string;
  filter: ComparableFilter;
  dryRun: boolean;
}

export async function importFile(dir: string, io: Io, options: FileImportOptions): Promise<number> {
  const config = loadHostConfig(dir);
  const area = checkArea(options.area);
  const file = path.resolve(io.cwd, options.file);
  if (options.source !== undefined && !(FILE_SOURCES as readonly string[]).includes(options.source)) {
    throw new SetupError(`--fonte must be csv, insideairbnb or airroi, got "${options.source}".`);
  }
  const source = (options.source as FileSource | undefined) ?? (await detectSource(file));
  const today = localToday(io.now());
  const verb = options.dryRun ? "would import" : "imported";

  if (source === "csv") {
    if (options.listingsFile !== undefined || Object.keys(options.filter).length > 0) {
      throw new SetupError("--annunci, --tipo, --camere and --quartiere are for Inside Airbnb files only.");
    }
    const r = parseMarketCsv(await readText(file));
    for (const issue of r.issues.slice(0, 20)) io.out(`  line ${issue.line}: ${issue.message}`);
    if (r.issues.length > 20) io.out(`  … and ${r.issues.length - 20} more lines with problems`);
    if (r.days.length === 0) {
      io.err(`No zone night could be read from ${file}: nothing was imported.`);
      return 1;
    }
    const first = r.days[0]?.date as string;
    const last = r.days.at(-1)?.date as string;
    io.out(`Zone "${area}": ${verb} ${r.days.length} nights from ${path.basename(file)} (${first} → ${last}).`);
    if (!options.dryRun) {
      const db = openDb(dbPath(dir));
      try {
        saveMarket(db, {
          area,
          source: "csv",
          attribution: `your file "${path.basename(file)}"`,
          estimated: false,
          readOn: today,
          importedAt: io.now().toISOString(),
          file: path.basename(file),
          days: r.days,
        });
      } finally {
        db.close();
      }
      afterImport(io, config, area);
    }
    return 0;
  }

  // Inside Airbnb
  let only: Set<string> | undefined;
  if (options.listingsFile !== undefined) {
    const listingsPath = path.resolve(io.cwd, options.listingsFile);
    const reader = new InsideAirbnbListings(options.filter);
    await streamText(listingsPath, (c) => reader.feed(c));
    only = reader.end();
    io.out(`${only.size} comparable listings of ${reader.seen} in ${path.basename(listingsPath)}.`);
    if (only.size === 0) {
      io.err("No listing matches --tipo, --camere and --quartiere: nothing was imported.");
      return 1;
    }
  } else if (Object.keys(options.filter).length > 0) {
    throw new SetupError("--tipo, --camere and --quartiere need the listings file too: add --annunci listings.csv.gz.");
  }
  const calendar = new InsideAirbnbCalendar(only);
  await streamText(file, (c) => calendar.feed(c));
  const s = calendar.end();
  if (s.days.length === 0) {
    io.err(`No night could be read from ${file}: nothing was imported.`);
    return 1;
  }
  const first = s.days[0]?.date as string;
  const last = s.days.at(-1)?.date as string;
  io.out(`Zone "${area}": ${verb} ${s.days.length} nights (${first} → ${last}) from ${s.listings} listings of Inside Airbnb.`);
  if (s.alwaysClosed > 0) io.out(`  ${s.alwaysClosed} listings closed on every night were left out (they look inactive).`);
  if (s.badLines > 0) io.out(`  ${s.badLines} lines could not be read and were skipped.`);
  io.out(`  ${INSIDE_AIRBNB_ESTIMATE_NOTE}`);
  io.out(`  Source: ${INSIDE_AIRBNB_ATTRIBUTION}. Keep the files on your computer: Inside Airbnb asks not to republish the data.`);
  if (!options.dryRun) {
    const db = openDb(dbPath(dir));
    try {
      saveMarket(db, {
        area,
        source: "insideairbnb",
        attribution: INSIDE_AIRBNB_ATTRIBUTION,
        estimated: true,
        readOn: today,
        importedAt: io.now().toISOString(),
        file: path.basename(file),
        note: `${s.listings} listings, snapshot from ${first}`,
        days: s.days,
      });
    } finally {
      db.close();
    }
    afterImport(io, config, area);
  }
  return 0;
}

// ---------------------------------------------------------------- AirROI

function airroiClient(dir: string, io: Io): AirRoiClient {
  const { apiKey } = loadAirRoiKey(dir, io.env ?? {});
  return new AirRoiClient({
    apiKey,
    fetch: io.airroiFetch ?? ((url, init) => fetch(url, init)),
    ...(io.airroiBaseUrl ? { baseUrl: io.airroiBaseUrl } : {}),
    ...(io.sleep ? { sleep: io.sleep } : {}),
  });
}

export async function connectAirRoi(dir: string, io: Io): Promise<number> {
  if (!existsSync(configPath(dir))) throw new SetupError(`No ${CONFIG_FILE} in ${dir}. Run "fairnight init" in this folder first.`);
  const config = loadHostConfig(dir);
  if (!airroiEnabled(config)) {
    io.err(AIRROI_OFF);
    return 1;
  }
  if (!io.prompt) throw new SetupError('"fairnight mercato collega" needs a terminal to ask for the key.');
  io.out("Your own AirROI API key (airroi.com → API). Fairnight has no key of its own and no server: the key goes only from this computer to AirROI.");
  io.out("Every AirROI call is billed to your account. Fairnight asks only for zone metrics, never for price recommendations. Nothing you type is shown.");
  let apiKey: string;
  try {
    apiKey = (await io.prompt("AirROI API key: ", { hidden: true })).trim();
  } catch {
    throw new SetupError("Cancelled: nothing was saved.");
  }
  if (apiKey === "") throw new SetupError("The key was empty: nothing was saved.");
  const protection = saveAirRoiKey(dir, apiKey);
  io.out(`Key saved in ${AIRROI_CREDENTIALS_FILE}, ${protection}. Never share or commit this file.`);
  io.out("The key is checked by the first import, to avoid a billed call now.");
  if (io.env?.AIRROI_API_KEY) io.out("Note: AIRROI_API_KEY is set in this shell and takes precedence over the saved file.");
  io.out('Next: add the zone under market.airroi.areas in fairnight.config.json, then "fairnight mercato importa --fonte airroi --zona <name>".');
  return 0;
}

export async function importAirRoi(dir: string, io: Io, options: { area?: string }): Promise<number> {
  const config = loadHostConfig(dir);
  if (!airroiEnabled(config)) {
    io.err(AIRROI_OFF);
    return 1;
  }
  const areas = config.market?.airroi?.areas ?? {};
  const names = options.area !== undefined ? [checkArea(options.area)] : Object.keys(areas);
  if (names.length === 0) throw new SetupError("No AirROI zone in the config: add one under market.airroi.areas (country, region, locality, as AirROI names them).");
  for (const name of names) {
    if (!areas[name]) throw new SetupError(`Zone "${name}" is not under market.airroi.areas in ${CONFIG_FILE}.`);
  }
  const client = airroiClient(dir, io);
  const today = localToday(io.now());
  const db = openDb(dbPath(dir));
  try {
    purgeExpiredMarket(db, today);
    for (const name of names) {
      const a = areas[name] as NonNullable<typeof areas[string]>;
      const filter = { ...(a.roomType !== undefined ? { roomType: a.roomType } : {}), ...(a.bedrooms !== undefined ? { bedrooms: a.bedrooms } : {}) };
      const months = await client.marketMetrics(
        { country: a.country, region: a.region, locality: a.locality, ...(a.district !== undefined ? { district: a.district } : {}) },
        { filter },
      );
      const days = monthlyToDays(months, today, AIRROI_DAYS);
      if (days.length === 0) {
        io.err(`AirROI has no figures for zone "${name}" (${a.locality}, ${a.region}, ${a.country}): nothing was saved.`);
        continue;
      }
      const expiresOn = addDays(today, AIRROI_MAX_DAYS);
      saveMarket(db, {
        area: name,
        source: "airroi",
        attribution: AIRROI_ATTRIBUTION,
        estimated: false,
        readOn: today,
        importedAt: io.now().toISOString(),
        expiresOn,
        note: `monthly figures of ${months.length} months, each night uses the same month`,
        days,
      });
      io.out(`Zone "${name}": ${months.length} months from AirROI, spread over the next ${days.length} nights (${AIRROI_ATTRIBUTION}).`);
      io.out(`  Kept until ${expiresOn}, then deleted (AirROI's terms: at most ${AIRROI_MAX_DAYS} days). "fairnight mercato cancella --fonte airroi" deletes it now.`);
      afterImport(io, config, name);
    }
  } finally {
    db.close();
    io.out(`AirROI calls: ${client.calls}, billed to your AirROI account.`);
  }
  return 0;
}

// ---------------------------------------------------------------- stato

export function marketStatus(dir: string, io: Io): number {
  const config = loadHostConfig(dir);
  const today = localToday(io.now());
  const db = openDb(dbPath(dir));
  try {
    for (const area of purgeExpiredMarket(db, today)) io.out(`Zone "${area}": AirROI data older than ${AIRROI_MAX_DAYS} days, deleted.`);
    const areas = listMarketAreas(db, today);
    io.out(areas.length === 0 ? 'No zone data yet: "fairnight mercato importa <file> --zona <name>".' : "Zones:");
    for (const a of areas) {
      const figures = [
        a.averageOccupancy !== null ? `average occupancy ${formatAmount(a.averageOccupancy)}%${a.estimated ? " (estimated)" : ""}` : null,
        a.averagePrice !== null ? `average price ${formatAmount(a.averagePrice)}` : null,
      ].filter(Boolean);
      io.out(`- ${a.area}: ${a.source}, ${a.days} nights ${a.first} → ${a.last}, ${figures.join(", ")}; read ${a.readOn}.`);
      io.out(`  Source: ${a.attribution}.${a.note ? ` ${a.note}.` : ""}`);
      if (a.expiresOn) io.out(`  Kept until ${a.expiresOn}, then deleted.`);
      if (a.estimated) io.out(`  ${INSIDE_AIRBNB_ESTIMATE_NOTE}`);
      const users = usersOf(config, a.area);
      io.out(`  Used by: ${users.join(", ") || "no listing"}.`);
    }
    io.out("Listings:");
    const known = new Set(areas.map((a) => a.area));
    for (const l of config.listings) {
      const f = l.pricing.factors.market;
      const factor = f?.enabled
        ? `zone demand on (weight ${f.weight ?? DEFAULT_MARKET.weight}, at most +${f.maxRaisePercent ?? DEFAULT_MARKET.maxRaisePercent}% / -${f.maxLowerPercent ?? DEFAULT_MARKET.maxLowerPercent}%)`
        : "zone demand off";
      const zone = l.marketArea === undefined ? "no zone" : `zone ${l.marketArea}${known.has(l.marketArea) ? "" : " (NO DATA: nothing changes until you import it)"}`;
      io.out(`- ${l.name}: ${zone}, ${factor}.`);
    }
    const keySource = airroiKeySource(dir, io.env ?? {});
    if (airroiEnabled(config)) {
      io.out(`AirROI: on; key ${keySource === null ? 'not saved yet ("fairnight mercato collega")' : `from the ${keySource}`}.`);
    } else {
      io.out(`AirROI: off, in attesa di conferma scritta da AirROI sui termini d'uso.${keySource !== null ? " A key is saved but not used." : ""}`);
    }
    return 0;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------- cancella

export function deleteMarketData(dir: string, io: Io, options: { area?: string; source?: string }): number {
  if (options.area !== undefined) checkArea(options.area);
  if (options.source !== undefined && !["csv", "insideairbnb", "airroi"].includes(options.source)) {
    throw new SetupError(`--fonte must be csv, insideairbnb or airroi, got "${options.source}".`);
  }
  if (!existsSync(dbPath(dir))) {
    io.out("No database here: there is no zone data to delete.");
    return 0;
  }
  const db = openDb(dbPath(dir));
  try {
    const filter = { ...(options.area !== undefined ? { area: options.area } : {}), ...(options.source !== undefined ? { source: options.source } : {}) };
    const deleted = deleteMarket(db, filter);
    io.out(deleted.length === 0 ? "No zone data matched: nothing deleted." : `Deleted the data of ${deleted.length} zone${deleted.length === 1 ? "" : "s"}: ${deleted.join(", ")}.`);
    if (options.source === "airroi" || options.source === undefined) {
      if (existsSync(path.join(dir, AIRROI_CREDENTIALS_FILE))) io.out(`The AirROI key is still in ${AIRROI_CREDENTIALS_FILE}: delete that file to remove it too.`);
    }
    return 0;
  } finally {
    db.close();
  }
}
