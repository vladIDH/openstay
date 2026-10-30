/**
 * `fairnight pilota`: the autopilot from the command line, and the changes to
 * fairnight.config.json that the guided setup and the page also make.
 *
 *   giro [--pianificato]   one run now (the computer's daily task adds --pianificato)
 *   prova [--listing L]    what a run would write, writing nothing
 *   stato                  each listing: on or off, paused, last run, daily task
 *   accendi L / spegni L   turn it on (after showing the preview) or off
 *   riprendi L             clear a pause
 *   registro [--listing L] [--out file.csv]   the nights written, with the reason
 *   conferma L --da D [--a D]   these nights pass the daily cap at their full price
 *   revoca L --da D [--a D]     take a confirmation back
 *   conferme [--listing L]      confirmations, old ones too
 *   pianifica [--ora 06:00] / togli           the daily task of this computer
 */
import { appendFileSync, copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatAmount, type PriceStep } from "fairnight";
import { daysBetween, weekday } from "./channel.js";
import { loadHostConfig, PILOT_TIME, SetupError, type HostListing } from "./config.js";
import { openDb, type Db } from "./db.js";
import { UsageError } from "./errors.js";
import { configPath, DATA_DIR, dbPath, localToday, stripBom, type Io } from "./io.js";
import type { Language } from "./lingua.js";
import { installSchedule, isScheduled, PILOT_LOG, removeSchedule } from "./pianifica.js";
import {
  ConfirmError,
  confirmationHistory,
  confirmNights,
  moment,
  nightsBetween,
  pluralOf,
  removeConfirmations,
  textOf,
  type Confirmation,
} from "./pilota-conferme.js";
import { priceOne } from "./price.js";
import {
  channelOf,
  DEFAULT_MAX_CHANGE,
  DEFAULT_PILOT_TIME,
  lastRun,
  limitsOf,
  maxChangeOf,
  pilotDaysOf,
  pilotOn,
  pilotState,
  resumeListing,
  runPilot,
  type Limited,
  type PilotListingResult,
  type PilotNight,
  type PilotRunResult,
} from "./pilota.js";

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------- the config file

/** Change the autopilot of one listing in fairnight.config.json, keeping the previous file as .bak. */
export function writeListingPilot(dir: string, name: string, pilot: { enabled: boolean; maxDailyChangePercent?: number; days?: number }): void {
  editConfig(dir, (raw) => {
    const listing = (raw.listings as Obj[]).find((l) => l.name === name);
    if (!listing) throw new SetupError(`No listing called "${name}".`);
    const before = typeof listing.pilot === "object" && listing.pilot !== null ? (listing.pilot as Obj) : {};
    listing.pilot = { ...before, ...pilot };
  });
}

/** The time of the daily run, kept in the config so the setup can show it. */
export function writePilotTime(dir: string, time: string): void {
  editConfig(dir, (raw) => {
    raw.pilot = { time };
  });
}

function editConfig(dir: string, change: (raw: Obj) => void): void {
  const file = configPath(dir);
  const raw = JSON.parse(stripBom(readFileSync(file, "utf8"))) as Obj;
  change(raw);
  copyFileSync(file, `${file}.bak`);
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n", "utf8");
  loadHostConfig(dir); // still valid, or the error says why
}

// ---------------------------------------------------------------- what the host reads

/** The engine steps that moved the price, in the engine's words: "Saturday +10%, gap of 2 nights -12%". */
export function reasonOf(steps: readonly PriceStep[]): string {
  const moved = steps.filter((s) => s.factor !== "base" && s.factor !== "rounding" && s.before !== s.after);
  if (moved.length === 0) return "base price";
  return moved.map((s) => (s.percent !== undefined ? `${s.label} ${s.percent >= 0 ? "+" : ""}${s.percent}%` : s.label)).join(", ");
}

const LIMITED: Record<Limited, (n: PilotNight, l: HostListing | undefined) => string> = {
  cap: (n, l) => `held to ${l ? maxChangeOf(l) : DEFAULT_MAX_CHANGE}% a day, the engine wants ${formatAmount(n.target)}`,
  floor: () => "raised to the lowest price",
  ceiling: () => "lowered to the highest price",
};

function nightLine(n: PilotNight, listing: HostListing | undefined): string {
  const money = (v: number | null) => (v === null ? "—" : formatAmount(v));
  const held = n.confirmation ? ` (full price, confirmed by ${n.confirmation.by})` : n.limited ? ` (${LIMITED[n.limited](n, listing)})` : "";
  const check = n.verified === false ? "  ✗ does not match on the channel" : "";
  return `  ${n.date} ${weekday(n.date)}  ${money(n.oldPrice).padStart(7)} → ${formatAmount(n.newPrice).padStart(7)}  min ${n.oldMinStay ?? "—"} → ${n.newMinStay}  ${reasonOf(n.steps)}${held}${check}`;
}

const STATUS_LINE: Record<PilotListingResult["status"], (r: PilotListingResult, label: string) => string> = {
  written: (r, label) =>
    `${r.nights.length} night${r.nights.length === 1 ? "" : "s"} written to ${label}, ` +
    (r.wrong.length === 0 && r.refused.length === 0 ? "read back: every night matches." : `${r.wrong.length} do not match, ${r.refused.length} refused.`),
  nothing: (_, label) => `${label} already has the right prices: nothing to write.`,
  preview: (r, label) => `would write ${r.nights.length} night${r.nights.length === 1 ? "" : "s"} to ${label} (preview: nothing written).`,
  off: () => 'autopilot off (turn it on with "fairnight pilota accendi").',
  paused: (r) => `PAUSED: ${r.error ?? "too many failures"}. Nothing written; "fairnight pilota riprendi" starts it again.`,
  "not-read": (r) => `NOT WRITTEN: a calendar could not be read today (${r.error}). Prices from old bookings could be wrong.`,
  "no-limits": () => "NOT WRITTEN: the autopilot needs a lowest and a highest price (factors.limits).",
  "no-channel": () => "not linked to Smoobu or Beds24: prices are only shown on the calendar page.",
  error: (r, label) => `STOPPED: ${r.error}. ${r.nights.length > 0 ? `${r.nights.length} nights were being written to ${label}.` : ""}`.trim(),
};

export function formatRun(r: PilotRunResult, listings: HostListing[]): string[] {
  if (r.skipped === "done-today") return ["Today's autopilot run is already done."];
  if (r.skipped === "busy") return ["Another autopilot run is going on: nothing done."];
  const lines: string[] = [];
  for (const f of r.notRead) lines.push(`Not read: ${f.listing} · ${f.feed} (${f.error ?? "error"}).`);
  for (const res of r.listings) {
    const listing = listings.find((l) => l.name === res.listing);
    const label = res.feed === "smoobu" ? "Smoobu" : res.feed === "beds24" ? "Beds24" : "";
    lines.push(`${res.listing}: ${STATUS_LINE[res.status](res, label)}`);
    for (const n of res.nights) lines.push(nightLine(n, listing));
    if (res.leftAlone > 0) lines.push(`  ${res.leftAlone} night${res.leftAlone === 1 ? "" : "s"} left alone: free here but not on ${label} (or the other way round).`);
    for (const s of res.skipped) lines.push(`  skipped ${s.date}: ${s.why}`);
    for (const s of res.refused) lines.push(`  refused ${s.date}: ${s.why}`);
    if (res.pausedNow) lines.push(`  PAUSED now: ${res.pausedNow}. "fairnight pilota riprendi ${res.listing}" starts it again.`);
  }
  return lines;
}

const failedRun = (r: PilotRunResult) => r.listings.some((l) => l.status === "error" || l.status === "not-read" || l.wrong.length > 0 || l.refused.length > 0);

// ---------------------------------------------------------------- the commands

/** Lines of a scheduled run also go to data/pilota.log (kept under 512 KB): nobody sees its window. */
function teeToLog(dir: string, io: Io): Io {
  const file = path.join(dir, DATA_DIR, PILOT_LOG);
  if (existsSync(file) && statSync(file).size > 512 * 1024) {
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.slice(text.length - 256 * 1024), "utf8");
  }
  const stamp = () => io.now().toISOString();
  return {
    ...io,
    out: (line) => {
      io.out(line);
      appendFileSync(file, `${stamp()} ${line}\n`, "utf8");
    },
    err: (line) => {
      io.err(line);
      appendFileSync(file, `${stamp()} ERROR ${line}\n`, "utf8");
    },
  };
}

function oneListing(dir: string, name: string | undefined, verb: string): HostListing {
  if (name === undefined) throw new UsageError(`"fairnight pilota ${verb}" needs the name of a listing, like "fairnight pilota ${verb} loft".`);
  const config = loadHostConfig(dir);
  const found = config.listings.find((l) => l.name === name);
  if (!found) throw new SetupError(`No listing called "${name}". Listings: ${config.listings.map((l) => l.name).join(", ")}.`);
  return found;
}

export interface PilotCommandValues {
  pianificato?: boolean;
  ora?: string;
  listing?: string;
  out?: string;
  da?: string;
  a?: string;
}

/**
 * Confirm the nights from `from` to `to` for one listing, with the price of each
 * as the host sees it now. Used by the command and by the page. Throws ConfirmError.
 */
export function confirmRange(db: Db, listing: HostListing, from: unknown, to: unknown, today: string, who: { by: string; via: "page" | "command" }, at: string): number {
  const nights = nightsBetween(from, to);
  const first = nights[0] as string;
  if (first < today) throw new ConfirmError("past");
  const prices = new Map(priceOne(db, listing, today, daysBetween(today, first) + nights.length).nights.map((n) => [n.date, n.price]));
  return confirmNights(db, listing.name, nights, who, at, (date) => prices.get(date) ?? null);
}

/** Who is at the computer, for the log: the name of the user, without the Windows domain. */
export const whoOf = (io: Io) => io.system?.user.split("\\").at(-1) ?? "host";

function confirmCommand(dir: string, listing: HostListing, values: PilotCommandValues, io: Io, remove: boolean): number {
  const verb = remove ? "revoca" : "conferma";
  if (values.da === undefined) throw new UsageError(`"fairnight pilota ${verb}" needs the night: --da 2026-11-10, and --a 2026-11-12 for several.`);
  const lang: Language = loadHostConfig(dir).language ?? "en";
  const last = values.a ?? values.da;
  const db = openDb(dbPath(dir));
  try {
    const at = io.now().toISOString();
    const n = remove
      ? removeConfirmations(db, listing.name, nightsBetween(values.da, last), whoOf(io), at)
      : confirmRange(db, listing, values.da, last, localToday(io.now()), { by: whoOf(io), via: "command" }, at);
    if (n === 0) io.out(textOf(lang, remove ? "unconfirm_none" : "confirm_none"));
    else io.out(pluralOf(lang, remove ? "unconfirm_done" : "confirm_done", n, { listing: listing.name }));
    return 0;
  } catch (e) {
    if (e instanceof ConfirmError) throw new UsageError(textOf(lang, `confirm_err_${e.code}`));
    throw e;
  } finally {
    db.close();
  }
}

function confirmationLine(c: Confirmation, today: string, lang: Language): string {
  const base = textOf(lang, "history_line", { listing: c.listing, date: c.date, by: c.by, when: moment(c.at) });
  if (c.removedAt !== null) return `${base} · ${textOf(lang, "history_removed", { by: c.removedBy ?? "", when: moment(c.removedAt) })}`;
  return c.date < today ? `${base} · ${textOf(lang, "history_expired")}` : base;
}

function confirmations(dir: string, values: PilotCommandValues, io: Io): number {
  const lang: Language = loadHostConfig(dir).language ?? "en";
  const db = openDb(dbPath(dir));
  try {
    const all = confirmationHistory(db, values.listing);
    if (all.length === 0) io.out(textOf(lang, "history_none"));
    for (const c of all) io.out(confirmationLine(c, localToday(io.now()), lang));
  } finally {
    db.close();
  }
  return 0;
}

export async function runPilotCommand(dir: string, values: PilotCommandValues, rest: string[], io: Io): Promise<number> {
  const [sub = "giro", name, ...extra] = rest;
  if (extra.length > 0) throw new UsageError(`Unexpected: ${extra.join(" ")}`);
  const noName = () => {
    if (name !== undefined) throw new UsageError(`Unexpected: ${name}`);
  };
  switch (sub) {
    case "giro":
    case "run": {
      noName();
      const scheduled = values.pianificato ?? false;
      const out = scheduled ? teeToLog(dir, io) : io;
      const config = loadHostConfig(dir);
      try {
        const r = await runPilot(dir, out, { trigger: scheduled ? "scheduled" : "manual", dryRun: false, onlyIfDue: scheduled }, config);
        for (const line of formatRun(r, config.listings)) out.out(line);
        return failedRun(r) ? 1 : 0;
      } catch (e) {
        out.err((e as Error).message);
        throw e;
      }
    }
    case "prova":
    case "preview": {
      noName();
      const config = loadHostConfig(dir);
      const only = values.listing !== undefined ? [oneListing(dir, values.listing, "prova").name] : undefined;
      const r = await runPilot(dir, io, { trigger: "manual", dryRun: true, includeOff: true, ...(only ? { only } : {}) }, config);
      for (const line of formatRun(r, config.listings)) io.out(line);
      io.out("Preview: nothing was written.");
      return 0;
    }
    case "stato":
    case "status":
      noName();
      return status(dir, io);
    case "accendi":
    case "on":
      return turnOn(dir, oneListing(dir, name, "accendi"), io);
    case "spegni":
    case "off": {
      const l = oneListing(dir, name, "spegni");
      writeListingPilot(dir, l.name, { enabled: false });
      io.out(`Autopilot off for ${l.name}: Fairnight writes nothing more to ${channelOf(l)?.label ?? "the channel"} on its own.`);
      return 0;
    }
    case "riprendi":
    case "resume": {
      const l = oneListing(dir, name, "riprendi");
      const db = openDb(dbPath(dir));
      try {
        io.out(resumeListing(db, l.name) ? `Autopilot of ${l.name} resumed: it runs again from the next run.` : `${l.name} was not paused.`);
      } finally {
        db.close();
      }
      return 0;
    }
    case "registro":
    case "log":
      noName();
      return log(dir, values, io);
    case "conferma":
    case "confirm":
      return confirmCommand(dir, oneListing(dir, name, "conferma"), values, io, false);
    case "revoca":
    case "unconfirm":
      return confirmCommand(dir, oneListing(dir, name, "revoca"), values, io, true);
    case "conferme":
    case "confirmations":
      noName();
      return confirmations(dir, values, io);
    case "pianifica":
    case "schedule": {
      noName();
      const time = values.ora ?? loadHostConfig(dir).pilot?.time ?? DEFAULT_PILOT_TIME;
      if (!PILOT_TIME.test(time)) throw new UsageError(`--ora must be a time like 06:00, got "${time}"`);
      const where = installSchedule(dir, io, time, localToday(io.now()));
      writePilotTime(dir, time);
      io.out(`Daily run set up at ${time} (${where}). If the computer is off then, it runs when it is back on.`);
      return 0;
    }
    case "togli":
    case "unschedule":
      noName();
      io.out(removeSchedule(dir, io) ? "Daily run removed from this computer." : "There was no daily run on this computer.");
      return 0;
    default:
      throw new UsageError(`Unknown: fairnight pilota ${sub}. Use giro, prova, stato, accendi, spegni, riprendi, registro, conferma, revoca, conferme, pianifica or togli.`);
  }
}

/** Show the preview of one listing, ask, and turn it on. */
async function turnOn(dir: string, listing: HostListing, io: Io): Promise<number> {
  if (!io.prompt) throw new SetupError('"fairnight pilota accendi" shows what it would write and asks first: it needs a terminal.');
  if (channelOf(listing) === null) throw new SetupError(`${listing.name} is not linked to Smoobu or Beds24: the autopilot has nowhere to write.`);
  const limits = limitsOf(listing);
  if (limits === null) throw new SetupError(`${listing.name} has no lowest and highest price (factors.limits): the autopilot needs both.`);
  const config = loadHostConfig(dir);
  const r = await runPilot(dir, io, { trigger: "manual", dryRun: true, includeOff: true, only: [listing.name] }, config);
  for (const line of formatRun(r, config.listings)) io.out(line);
  const res = r.listings[0];
  if (!res || res.status !== "preview") {
    io.out("Not turned on: the preview did not work.");
    return 1;
  }
  io.out(
    `Every day Fairnight would write ${listing.name}'s next ${pilotDaysOf(listing)} nights to ${channelOf(listing)?.label}, ` +
      `moving a price at most ${maxChangeOf(listing)}% a day, never under ${formatAmount(limits.floor)} or over ${formatAmount(limits.ceiling)}.`,
  );
  const answer = (await io.prompt("Turn the autopilot on? [y/N]: ", { hidden: false })).trim().toLowerCase();
  if (!["y", "yes", "s", "si", "sì"].includes(answer)) {
    io.out("Left off.");
    return 0;
  }
  writeListingPilot(dir, listing.name, { enabled: true });
  io.out(`Autopilot on for ${listing.name}.`);
  if (isScheduled(dir, io) === false) io.out('This computer does not run it every day yet: "fairnight pilota pianifica" sets that up.');
  return 0;
}

function status(dir: string, io: Io): number {
  const config = loadHostConfig(dir);
  const db = openDb(dbPath(dir));
  try {
    for (const l of config.listings) {
      const channel = channelOf(l);
      if (channel === null) {
        io.out(`${l.name}: not linked to Smoobu or Beds24.`);
        continue;
      }
      const s = pilotState(db, l.name);
      const state = s.paused_at ? `PAUSED since ${s.paused_at} (${s.paused_reason})` : pilotOn(l) ? "on" : "off";
      const limits = limitsOf(l);
      io.out(
        `${l.name} → ${channel.label}: ${state} · at most ${maxChangeOf(l)}% a day · next ${pilotDaysOf(l)} nights · ` +
          (limits ? `between ${formatAmount(limits.floor)} and ${formatAmount(limits.ceiling)}` : "no lowest and highest price: it will not write") +
          (s.failures > 0 && !s.paused_at ? ` · ${s.failures} failed run${s.failures === 1 ? "" : "s"} in a row` : ""),
      );
    }
    const last = lastRun(db);
    io.out(last.at ? `Last run: ${last.at}.` : "No run yet.");
    const scheduled = isScheduled(dir, io);
    if (scheduled !== null) io.out(scheduled ? `Daily run: set up at ${config.pilot?.time ?? DEFAULT_PILOT_TIME}.` : 'Daily run: not set up ("fairnight pilota pianifica").');
  } finally {
    db.close();
  }
  return 0;
}

interface ChangeRow {
  started_at: string;
  listing: string;
  feed: string;
  date: string;
  old_price: number | null;
  new_price: number;
  target_price: number;
  old_min_stay: number | null;
  new_min_stay: number;
  limited: string | null;
  steps: string;
  verified: number | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function log(dir: string, values: PilotCommandValues, io: Io): number {
  const db = openDb(dbPath(dir));
  let rows: ChangeRow[];
  let confirmed: Confirmation[];
  const lang: Language = loadHostConfig(dir).language ?? "en";
  try {
    confirmed = confirmationHistory(db, values.listing);
    rows = db
      .prepare(
        `SELECT r.started_at, c.listing, c.feed, c.date, c.old_price, c.new_price, c.target_price, c.old_min_stay, c.new_min_stay, c.limited, c.steps, c.verified, c.confirmed_by, c.confirmed_at
         FROM pilot_changes c JOIN pilot_runs r ON r.id = c.run_id
         ${values.listing !== undefined ? "WHERE c.listing = ?" : ""}
         ORDER BY r.started_at DESC, c.listing, c.date`,
      )
      .all(...(values.listing !== undefined ? [values.listing] : [])) as ChangeRow[];
  } finally {
    db.close();
  }
  const reason = (r: ChangeRow) => reasonOf(JSON.parse(r.steps) as PriceStep[]);
  if (values.out !== undefined) {
    const file = path.resolve(dir, values.out);
    const head = "run,listing,channel,date,old_price,new_price,engine_price,old_min_stay,new_min_stay,held_back,read_back,reason,confirmed_by,confirmed_at";
    const body = rows.map((r) =>
      [r.started_at, r.listing, r.feed, r.date, r.old_price, r.new_price, r.target_price, r.old_min_stay, r.new_min_stay, r.limited, r.verified === null ? "" : r.verified ? "ok" : "no", reason(r), r.confirmed_by, r.confirmed_at]
        .map(csvCell)
        .join(","),
    );
    writeFileSync(file, [head, ...body].join("\n") + "\n", "utf8");
    io.out(`${rows.length} night${rows.length === 1 ? "" : "s"} written to ${file}.`);
    return 0;
  }
  for (const c of confirmed.slice(0, 200)) io.out(confirmationLine(c, localToday(io.now()), lang));
  if (rows.length === 0) {
    io.out("The autopilot has written nothing yet.");
    return 0;
  }
  let run = "";
  for (const r of rows.slice(0, 200)) {
    if (r.started_at !== run) {
      run = r.started_at;
      io.out(`Run of ${run}:`);
    }
    const money = (v: number | null) => (v === null ? "—" : formatAmount(v));
    const confirmedBy = r.confirmed_by ? ` (confirmed by ${r.confirmed_by}, ${moment(r.confirmed_at ?? "")})` : "";
    io.out(`  ${r.listing} ${r.date}  ${money(r.old_price)} → ${money(r.new_price)}${r.limited ? ` (${r.limited}; engine ${money(r.target_price)})` : ""}${confirmedBy}  ${reason(r)}`);
  }
  if (rows.length > 200) io.out(`… and ${rows.length - 200} more: --out file.csv writes them all.`);
  return 0;
}
