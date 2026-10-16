/**
 * `fairnight ospiti …`: guest registration (Fairguest) from the command line.
 *
 * - Without the passphrase: deadlines, list, new stay, confirm a communication,
 *   erase, retention. They read only the clear columns.
 * - With the passphrase (asked without echo, or FAIRGUEST_FRASE): show, correct,
 *   prepare, export. Personal data is never passed as a command-line argument,
 *   so it never ends up in the shell history: corrections are asked for.
 */
import type { KeyObject } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  addDays,
  ISTAT_REGIONS,
  monthSummary,
  rossFile,
  trentoCsv,
  umbriaDay,
  type IstatStay,
  type RossDay,
  ALLOGGIATI_PORTAL,
  alloggiatiFile,
  changePassphrase,
  createKeys,
  DEFAULT_ALLOGGIATI_ACCOUNT,
  DEFAULT_SCRYPT,
  isDate,
  isPaymentType,
  localDateTime,
  MOSSOS_PORTAL,
  mossosFile,
  NotAvailableError,
  parseGuest,
  passphraseProblem,
  PassphraseError,
  AlloggiatiError,
  registryFor,
  schedine,
  type AlloggiatiTables,
  type GuestSettings,
  type Kind,
  type PaymentType,
} from "fairguest";
import { loadHostConfig, SetupError, type HostConfig } from "../config.js";
import { getMeta, openDb, setMeta, type Db } from "../db.js";
import { UsageError } from "../errors.js";
import { DATA_DIR, dbPath, type Io } from "../io.js";
import { PAGE_HASHES } from "./page-hashes.js";
import { acceptedDays, applyIstatRetention, blockedDays, keepIstat, loadIstatCredentials, readIstat, recordIstatDay, rossClient, saveIstatCredentials } from "./istat.js";
import { MRZ_MODEL_SHA256, checkPage, pullRelay, relayOf, stayLink, type PullReport } from "./relay.js";
import { alloggiatiClient, downloadTables, dropOldReceipts, hasCredentials, loadCredentials, loadTables, receipts, saveCredentials, saveReceipt, TABLES_MAX_DAYS } from "./italy.js";
import {
  addManualStay,
  applyRetention,
  eraseStay,
  erasePerson,
  getStay,
  guestDeadlines,
  guestListings,
  guestsEnabled,
  listStays,
  markRecognized,
  openStay,
  people,
  peopleCount,
  prefillFromCalendar,
  readKeys,
  recordSubmission,
  retentionOf,
  submissions,
  unlockKeys,
  writeHostData,
  writeKeys,
  writePerson,
  type DeadlineRow,
  type OpenedStay,
  type StayRow,
  type SubmissionKind,
} from "./store.js";

export interface GuestOptions {
  listing?: string;
  da?: string;
  a?: string;
  tipo?: string;
  persona?: string;
  out?: string;
  applica?: boolean;
  json?: boolean;
  account?: string;
  prova?: boolean;
  verifica?: boolean;
  mese?: string;
  istat?: boolean;
}

export const GUEST_USAGE = `  fairnight ospiti                                 guest communications due, late or open (no passphrase) [--json]
  fairnight ospiti attiva                          turn on guest registration: choose the passphrase
  fairnight ospiti frase                           change the passphrase (the data stays as it is)
  fairnight ospiti elenco                          stays to register, with the link of their check-in form
  fairnight ospiti link <stay>                     the check-in link to send to the guest: works from anywhere, encrypted in the guest's browser
  fairnight ospiti scarica                         download what the guests sent through their links (no passphrase needed)
  fairnight ospiti verifica-pagina                 check that the relay serves exactly the page of this version
  fairnight ospiti nuovo --listing <name> --da DATE --a DATE   a stay that is in no calendar
  fairnight ospiti mostra <stay>                   the data of a stay and what is still missing
  fairnight ospiti correggi <stay> <field>         change one field (the value is asked) [--persona N]
  fairnight ospiti prepara <stay…>                 the file or message to send [--tipo checkin|prenotazione] [--out folder]
  fairnight ospiti inviato <stay> --tipo T         record that a communication went through (checkin|prenotazione|annullamento)
  fairnight ospiti tabelle                         Italy: download the Alloggiati Web code tables (municipalities, states, documents)
  fairnight ospiti credenziali [--account NAME]    Italy: save the Alloggiati Web user, password and key, sealed [--verifica]
  fairnight ospiti riconosciuto <stay>             Italy: you saw the guests in person or on a live video call
  fairnight ospiti invia [<stay>…]                 Italy: the schedine due; checks them with --prova, sends them with --applica
  fairnight ospiti ricevute                        Italy: download the Alloggiati Web receipts not saved yet (last 30 days)
  fairnight ospiti istat [--mese YYYY-MM]          Italy: the month's Istat movement; ROSS1000 sends with --applica, other regions get a file or the figures
  fairnight ospiti credenziali --istat             Italy: save the ROSS1000 user and password of the structure, sealed [--account NAME]
  fairnight ospiti esporta <stay>                  a guest's data as JSON, on request [--persona N] [--out file]
  fairnight ospiti cancella <stay>                 erase on request; shows what, erases with --applica [--persona N]
  fairnight ospiti pulisci                         apply the retention rules now`;

const KIND_WORDS: Record<string, SubmissionKind> = {
  checkin: "checkin",
  prenotazione: "reservation",
  reservation: "reservation",
  annullamento: "cancellation",
  cancellation: "cancellation",
};
const KIND_LABEL: Record<SubmissionKind, string> = { reservation: "reservation (RH)", checkin: "check-in (PV)", cancellation: "cancellation" };
const show = (dt: string) => dt.replace("T", " ");

function kindOf(raw: string | undefined, fallback: SubmissionKind | null): SubmissionKind {
  if (raw === undefined) {
    if (fallback) return fallback;
    throw new UsageError("Which communication? Add --tipo checkin, --tipo prenotazione or --tipo annullamento.");
  }
  const k = KIND_WORDS[raw];
  if (!k) throw new UsageError(`--tipo must be checkin, prenotazione or annullamento, got "${raw}"`);
  return k;
}

async function askPassphrase(io: Io, question = "Fairguest passphrase: "): Promise<string> {
  const fromEnv = io.env?.FAIRGUEST_FRASE;
  if (fromEnv) return fromEnv;
  if (!io.prompt) throw new SetupError("The Fairguest passphrase is needed: run the command in a terminal, or set FAIRGUEST_FRASE.");
  const answer = await io.prompt(question, { hidden: true });
  if (!answer) throw new SetupError("No passphrase given: nothing was done.");
  return answer;
}

async function askNewPassphrase(io: Io): Promise<string> {
  if (!io.prompt) throw new SetupError("Choosing a passphrase needs a terminal: it is asked twice, without echo.");
  const first = await io.prompt("New passphrase (at least 12 characters, a few words are easier to remember): ", { hidden: true });
  const problem = passphraseProblem(first);
  if (problem) throw new SetupError(problem);
  const second = await io.prompt("Type it again: ", { hidden: true });
  if (second !== first) throw new SetupError("The two passphrases differ: nothing was changed.");
  return first;
}

const LOST_WARNING = [
  "Write the passphrase down and keep it somewhere safe, away from this computer.",
  "If it is lost, the guests' data cannot be opened again: not by you, not by us, not by anyone.",
];

function settingsOf(config: HostConfig, row: StayRow): GuestSettings {
  const s = config.listings.find((l) => l.name === row.listing)?.fairguest;
  if (!s) throw new SetupError(`Listing "${row.listing}" has no "fairguest" block in fairnight.config.json any more.`);
  return s;
}

function stayOrFail(db: Db, id: string | undefined): StayRow {
  if (id === undefined) throw new UsageError("Which stay? Give its id (see \"fairnight ospiti elenco\").");
  const row = getStay(db, id);
  if (!row) throw new SetupError(`No stay "${id}". "fairnight ospiti elenco" lists them.`);
  return row;
}

function notErased(row: StayRow): void {
  if (row.erased_at) throw new SetupError(`The personal data of stay ${row.id} was erased on ${show(row.erased_at)}: there is nothing left to read.`);
}

function personIndex(raw: string | undefined, count: number): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > count) throw new UsageError(`--persona must be a guest number from 1 to ${count}, got "${raw}"`);
  return n - 1;
}

/** The form link of a stay, while it is valid (until check-out). */
export function formPath(row: StayRow, today: string): string | null {
  return row.code && !row.erased_at && !row.cancelled_at && today <= row.check_out ? `/checkin/${row.code}` : null;
}

export async function runGuests(dir: string, values: GuestOptions, rest: string[], io: Io): Promise<number> {
  const [sub = "scadenze", ...args] = rest;
  const config = loadHostConfig(dir);
  const db = openDb(dbPath(dir));
  try {
    if (sub === "attiva" || sub === "setup") return await activate(dir, db, config, args, io);
    if (!guestsEnabled(db)) throw new SetupError('Guest registration is not turned on in this folder: run "fairnight ospiti attiva" first.');
    if (guestListings(config.listings).length === 0) {
      io.out('No listing has a "fairguest" block in fairnight.config.json: add one to the listings whose guests you register (see the README).');
    }
    // Every command first catches up with the calendars and applies the retention rules.
    prefillFromCalendar(db, config.listings, io.now());
    const retention = applyRetention(db, config, io.now());
    for (const e of retention.erased) io.out(`Erased the personal data of stay ${e.id}: ${e.reason}.`);
    for (const r of dropOldReceipts(db, io.now())) io.out(`Deleted the Alloggiati Web receipt ${r}: kept the 5 years the law asks.`);
    applyIstatRetention(db, config, io.now());

    switch (sub) {
      case "scadenze":
      case "deadlines":
        return deadlines(db, config, args, values, io);
      case "frase":
      case "passphrase":
        return await passphrase(db, args, io);
      case "elenco":
      case "list":
        await pullQuietly(db, io, config);
        return list(db, args, values, io);
      case "link":
        return await link(db, config, args, io);
      case "scarica":
      case "download":
        return await download(db, config, args, io);
      case "verifica-pagina":
      case "check-page":
        return await verifyPage(config, args, io);
      case "nuovo":
      case "new":
        return newStay(db, config, args, values, io);
      case "mostra":
      case "show":
        return await showStay(db, config, args, io);
      case "correggi":
      case "correct":
        return await correct(db, config, args, values, io);
      case "prepara":
      case "prepare":
        return await prepare(dir, db, config, args, values, io);
      case "inviato":
      case "sent":
        return confirmSent(db, config, args, values, io);
      case "tabelle":
      case "tables":
        return await tables(dir, db, args, io);
      case "credenziali":
      case "credentials":
        return await credentials(db, args, values, io);
      case "riconosciuto":
      case "recognized":
        return recognized(db, config, args, io);
      case "invia":
      case "send":
        await pullQuietly(db, io, config);
        return await sendItaly(dir, db, config, args, values, io);
      case "ricevute":
      case "receipts":
        return await fetchReceipts(dir, db, config, args, io);
      case "istat":
        return await istatCommand(dir, db, config, args, values, io);
      case "esporta":
      case "export":
        return await exportStay(db, config, args, values, io);
      case "cancella":
      case "erase":
        return erase(db, config, args, values, io);
      case "pulisci":
      case "clean":
        return clean(db, config, args, retention.erased.length, retention.orphans, io);
      default:
        throw new UsageError(`Unknown command "ospiti ${sub}".`);
    }
  } finally {
    db.close();
  }
}

function noExtra(args: string[]): void {
  if (args.length > 0) throw new UsageError(`Unexpected argument "${args[0]}".`);
}

async function activate(dir: string, db: Db, config: HostConfig, args: string[], io: Io): Promise<number> {
  noExtra(args);
  if (readKeys(db)) throw new SetupError('Guest registration is already on in this folder. To change the passphrase: "fairnight ospiti frase".');
  const fromEnv = io.env?.FAIRGUEST_FRASE;
  const pass = fromEnv ?? (await askNewPassphrase(io));
  const problem = passphraseProblem(pass);
  if (problem) throw new SetupError(problem);
  writeKeys(db, createKeys(pass, io.scryptCost ?? DEFAULT_SCRYPT));
  io.out("Guest registration is on. The guests' data will be stored encrypted in data/fairnight.db.");
  for (const line of LOST_WARNING) io.out(line);
  const r = prefillFromCalendar(db, config.listings, io.now());
  if (guestListings(config.listings).some((l) => l.fairguest.country === "IT")) {
    try {
      await downloadTables(dir, db, io);
      io.out("Downloaded the Alloggiati Web code tables (municipalities, states, documents) from the portal.");
    } catch (e) {
      io.out(`The Alloggiati Web code tables could not be downloaded now (${(e as Error).message}): run "fairnight ospiti tabelle" later.`);
    }
    io.out('Italy: save the Alloggiati Web credentials with "fairnight ospiti credenziali".');
  }
  if (guestListings(config.listings).length === 0) io.out('Next: add a "fairguest" block to the listings whose guests you register, then "fairnight sync".');
  else io.out(`${r.created} stay${r.created === 1 ? "" : "s"} to register, from the calendars already read. Next: "fairnight ospiti".`);
  return 0;
}

async function passphrase(db: Db, args: string[], io: Io): Promise<number> {
  noExtra(args);
  const record = readKeys(db);
  if (!record) throw new SetupError('Guest registration is not turned on: run "fairnight ospiti attiva".');
  const old = await askPassphrase(io, "Current passphrase: ");
  try {
    unlockKeys(db, old);
  } catch (e) {
    if (e instanceof PassphraseError) throw new SetupError(e.message);
    throw e;
  }
  const next = await askNewPassphrase(io);
  writeKeys(db, changePassphrase(record, old, next, io.scryptCost ?? DEFAULT_SCRYPT));
  io.out("Passphrase changed. Only the key was re-encrypted: the guests' data is the same. The old passphrase no longer works.");
  for (const line of LOST_WARNING) io.out(line);
  return 0;
}

function deadlineLine(d: DeadlineRow): string {
  const state = d.state === "late" ? "LATE" : d.state === "open" ? "open" : "done";
  const when =
    d.state === "done"
      ? `done ${show(d.doneAt as string)}`
      : d.state === "late"
        ? `${Math.ceil(-d.hoursLeft)} h late`
        : `in ${d.hoursLeft < 1 ? "less than 1" : Math.floor(d.hoursLeft)} h`;
  return `${state.padEnd(4)}  due ${show(d.due)}  ${d.listing}  ${d.stay}  ${KIND_LABEL[d.kind]}, stay ${d.checkIn} → ${d.checkOut}, ${d.guestsRegistered} guest${d.guestsRegistered === 1 ? "" : "s"} registered · ${when}`;
}

function deadlines(db: Db, config: HostConfig, args: string[], values: GuestOptions, io: Io): number {
  noExtra(args);
  const rows = guestDeadlines(db, config, io.now());
  const late = rows.filter((r) => r.state === "late").length;
  if (values.json) {
    io.out(JSON.stringify({ now: localDateTime(io.now()), deadlines: rows }, null, 2));
    return late > 0 ? 1 : 0;
  }
  const pending = rows.filter((r) => r.state !== "done");
  const countries = new Set(guestListings(config.listings).map((l) => l.fairguest.country));
  const rules = [
    countries.has("ES") || countries.has("ES-CT") ? "Spain: 24 hours from the booking and from check-in (RD 933/2021, art. 6.3)" : "",
    countries.has("IT") ? "Italy: 24 hours from arrival, 6 for a stay of 24 hours or less (art. 109 TULPS)" : "",
  ].filter(Boolean);
  io.out(`Guest communications · now ${show(localDateTime(io.now()))}${rules.length ? ` · ${rules.join(" · ")}` : ""}`);
  if (pending.length === 0) io.out("Nothing to communicate.");
  for (const r of pending) io.out(deadlineLine(r));
  if (late > 0) io.out(`${late} communication${late === 1 ? " is" : "s are"} late: make ${late === 1 ? "it" : "them"} now, then "fairnight ospiti inviato <stay> --tipo …".`);
  if (pending.some((r) => r.country === "IT")) io.out('Italy: "fairnight ospiti invia" shows the schedine due; "--applica" sends them to Alloggiati Web.');
  for (const line of istatReminders(db, config, io)) io.out(line);
  return late > 0 ? 1 : 0;
}

function list(db: Db, args: string[], values: GuestOptions, io: Io): number {
  noExtra(args);
  const today = localDateTime(io.now()).slice(0, 10);
  const rows = listStays(db, values.listing ? { listing: values.listing } : {});
  const live = rows.filter((r) => !r.erased_at);
  if (live.length === 0) io.out("No stay to register.");
  for (const r of live) {
    const link = formPath(r, today);
    const state = r.cancelled_at ? `cancelled ${show(r.cancelled_at)}` : `${peopleCount(db, r.id)} guest${peopleCount(db, r.id) === 1 ? "" : "s"} registered`;
    io.out(`${r.id}  ${r.listing}  ${r.check_in} → ${r.check_out}  from ${r.source}  ${state}${link ? `  form ${link}` : ""}`);
  }
  const erased = rows.length - live.length;
  if (erased > 0) io.out(`${erased} more stay${erased === 1 ? "" : "s"} with the personal data already erased.`);
  if (live.some((r) => formPath(r, today))) {
    io.out('The forms open on this computer and the local network: "fairnight serve --lan", then http://<this computer>:4321 plus the form path, on a phone or tablet.');
    io.out('To send a guest a link that works from anywhere: "fairnight ospiti link <stay>".');
  }
  return 0;
}

function newStay(db: Db, config: HostConfig, args: string[], values: GuestOptions, io: Io): number {
  noExtra(args);
  if (!values.listing) throw new UsageError("Which listing? Add --listing <name>.");
  const listing = config.listings.find((l) => l.name === values.listing);
  if (!listing) throw new SetupError(`No listing called "${values.listing}".`);
  if (!listing.fairguest) throw new SetupError(`Listing "${listing.name}" has no "fairguest" block in fairnight.config.json.`);
  if (!isDate(values.da) || !isDate(values.a)) throw new UsageError("Give the dates: --da 2099-06-10 --a 2099-06-13 (check-in and check-out).");
  if (values.a <= values.da) throw new UsageError("Check-out (--a) must come after check-in (--da).");
  const row = addManualStay(db, listing.name, values.da, values.a, io.now());
  io.out(`Stay ${row.id}: ${listing.name}, ${row.check_in} → ${row.check_out}. Check-in form: ${formPath(row, localDateTime(io.now()).slice(0, 10))}`);
  return 0;
}

async function opened(db: Db, config: HostConfig, row: StayRow, io: Io): Promise<OpenedStay> {
  notErased(row);
  const pass = await askPassphrase(io);
  try {
    return openStay(db, row, settingsOf(config, row), unlockKeys(db, pass), localDateTime(io.now()).slice(0, 10));
  } catch (e) {
    if (e instanceof PassphraseError) throw new SetupError(e.message);
    throw e;
  }
}

const PAYMENT_WORDS = "platform, card, cash, transfer, mobile, voucher, at_destination, other";

async function showStay(db: Db, config: HostConfig, args: string[], io: Io): Promise<number> {
  const [id, ...extra] = args;
  noExtra(extra);
  const row = stayOrFail(db, id);
  const o = await opened(db, config, row, io);
  const s = o.stay;
  const registry = registryFor(o.settings.country);
  io.out(`Stay ${s.id} · ${row.listing} · ${registry.authority}`);
  io.out(`  ${s.checkIn}${s.checkInTime ? ` ${s.checkInTime}` : ""} → ${s.checkOut}${s.checkOutTime ? ` ${s.checkOutTime}` : ""} · reference ${s.reference} · contract ${s.contractDate} · ${s.people} people · payment ${s.payment?.type ?? "—"}`);
  if (o.people.length === 0 && s.guests[0]) io.out(`  holder from ${row.source}: ${s.guests[0].givenName} ${s.guests[0].surname1}`.trimEnd());
  o.people.forEach((p, i) => {
    const g = p.data.guest;
    const doc = g.document ? `${g.document.type} ${g.document.number}` : "no document";
    io.out(`  ${i + 1}. ${g.givenName} ${g.surname1}${g.surname2 ? ` ${g.surname2}` : ""} · born ${g.birthDate ?? "—"} · ${g.nationality ?? "—"} · ${doc} · added by ${p.addedBy}`);
  });
  // Italy has only the guests' communication (Alloggiati Web); Spain has the booking and the check-in.
  const kinds: Kind[] = o.settings.country === "IT" ? ["checkin"] : ["reservation", "checkin"];
  const label = (kind: Kind) => (o.settings.country === "IT" ? "schedine (Alloggiati Web)" : KIND_LABEL[kind]);
  for (const kind of kinds) {
    const problems = registry.validate(s, kind);
    io.out(problems.length === 0 ? `  ${label(kind)}: complete` : `  ${label(kind)}: missing or wrong`);
    for (const p of problems) io.out(`    - ${p.path}: ${p.message}`);
  }
  if (o.settings.country === "IT") io.out(row.recognized_at ? `  Guests recognized ${show(row.recognized_at)}.` : '  Guests not recognized yet: see them in person or on a live video call, then "fairnight ospiti riconosciuto".');
  for (const sub of submissions(db, row.id)) io.out(`  ${KIND_LABEL[sub.kind]}: ${sub.status} ${show(sub.at)} (${sub.channel})`);
  const rule = retentionOf(db, row, o.settings);
  io.out(`  Retention: ${rule.eraseFrom ? `erased from ${show(rule.eraseFrom)}` : "kept for now"}, ${rule.reason}.`);
  return 0;
}

const STAY_FIELDS: Record<string, "reference" | "people" | "payment" | "contractDate"> = {
  riferimento: "reference",
  reference: "reference",
  persone: "people",
  people: "people",
  pagamento: "payment",
  payment: "payment",
  "data-contratto": "contractDate",
  contractDate: "contractDate",
};
const GUEST_FIELDS = [
  "givenName",
  "surname1",
  "surname2",
  "birthDate",
  "sex",
  "nationality",
  "document.type",
  "document.number",
  "document.support",
  "document.issuedOn",
  "document.spanish",
  "document.issuedIn.country",
  "document.issuedIn.locality",
  "document.issuedIn.province",
  "birthPlace.country",
  "birthPlace.locality",
  "birthPlace.province",
  "address.country",
  "address.street",
  "address.locality",
  "address.postalCode",
  "address.municipalityCode",
  "phone",
  "phone2",
  "email",
  "kinship",
];

async function correct(db: Db, config: HostConfig, args: string[], values: GuestOptions, io: Io): Promise<number> {
  const [id, field, ...extra] = args;
  noExtra(extra);
  const row = stayOrFail(db, id);
  if (field === undefined) {
    throw new UsageError(`Which field? Stay: ${Object.keys(STAY_FIELDS).filter((k) => !/[A-Z]/.test(k)).join(", ")}. Guest (with --persona N): ${GUEST_FIELDS.join(", ")}.`);
  }
  if (!io.prompt) throw new SetupError("Corrections need a terminal: the new value is asked, never written on the command line.");
  const o = await opened(db, config, row, io);
  const today = localDateTime(io.now()).slice(0, 10);

  if (values.persona === undefined) {
    const key = STAY_FIELDS[field];
    if (!key) throw new UsageError(`Unknown stay field "${field}". Use riferimento, persone, pagamento or data-contratto, or --persona N for a guest's field.`);
    const raw = (await io.prompt(`New value for ${field}${key === "payment" ? ` (${PAYMENT_WORDS})` : ""}, empty to remove: `, { hidden: false })).trim();
    const host = { ...o.host };
    if (raw === "") host[key] = undefined;
    else if (key === "reference") {
      if (!/^[A-Za-z0-9 -]{1,20}$/.test(raw)) throw new SetupError("The reference is 1 to 20 letters, digits, spaces or dashes.");
      host.reference = raw;
    } else if (key === "people") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 999) throw new SetupError("The number of people is a whole number from 1 to 999.");
      host.people = n;
    } else if (key === "payment") {
      if (!isPaymentType(raw)) throw new SetupError(`Only the type of payment: ${PAYMENT_WORDS}. Never a card number or an IBAN.`);
      host.payment = raw as PaymentType;
    } else {
      if (!isDate(raw) || raw > today) throw new SetupError("The contract date is a date like 2099-05-20, not in the future.");
      host.contractDate = raw;
    }
    writeHostData(db, row.id, host);
    io.out(`Stay ${row.id}: ${field} ${raw === "" ? "removed" : "changed"}.`);
    return 0;
  }

  const index = personIndex(values.persona, o.people.length) as number;
  if (!GUEST_FIELDS.includes(field)) throw new UsageError(`Unknown guest field "${field}". Fields: ${GUEST_FIELDS.join(", ")}.`);
  const person = o.people[index] as OpenedStay["people"][number];
  const raw = (await io.prompt(`New value for ${field} of guest ${index + 1}, empty to remove: `, { hidden: false })).trim();
  const draft = JSON.parse(JSON.stringify(person.data.guest)) as Record<string, unknown>;
  const value: unknown = field === "document.spanish" ? raw === "true" || raw === "sì" || raw === "si" || raw === "yes" : raw;
  // Up to three levels, like document.issuedIn.locality: the objects on the way are created when missing.
  const keys = field.split(".");
  let target = draft;
  for (const k of keys.slice(0, -1)) {
    const next = { ...((target[k] as Record<string, unknown> | undefined) ?? {}) };
    target[k] = next;
    target = next;
  }
  target[keys[keys.length - 1] as string] = raw === "" ? undefined : value;
  const parsed = parseGuest(draft, today);
  if (!parsed.guest) {
    for (const p of parsed.problems) io.out(`  - ${p.path}: ${p.message}`);
    throw new SetupError("Nothing was changed.");
  }
  writePerson(db, person.id, { ...person.data, guest: parsed.guest });
  io.out(`Guest ${index + 1} of stay ${row.id}: ${field} ${raw === "" ? "removed" : "changed"}.`);
  return 0;
}

/** Next number of the Mossos file of an establishment: 001…999, then 001 again. */
function nextSequence(db: Db, establishment: string): number {
  const key = `fairguest_mossos_seq_${establishment}`;
  const next = (Number(getMeta(db, key) ?? "0") % 999) + 1;
  setMeta(db, key, String(next));
  return next;
}

async function prepare(dir: string, db: Db, config: HostConfig, args: string[], values: GuestOptions, io: Io): Promise<number> {
  if (args.length === 0) throw new UsageError("Which stays? fairnight ospiti prepara <stay> [<stay>…] --tipo checkin");
  const kind = kindOf(values.tipo, "checkin");
  if (kind === "cancellation") throw new UsageError("A cancellation is made on the authority's website; then record it with \"fairnight ospiti inviato <stay> --tipo annullamento\".");
  const rows = [...new Set(args)].map((id) => stayOrFail(db, id));
  rows.forEach(notErased);
  const countries = new Set(rows.map((r) => settingsOf(config, r).country));
  if (countries.size > 1) throw new UsageError("These stays go to different authorities: prepare SES and Mossos stays separately.");
  const country = [...countries][0];
  if (country === "IT") return await prepareItaly(dir, db, config, rows, values, io);
  if (country === "ES") {
    // Stop before asking for the passphrase: nothing can be prepared for SES yet.
    try {
      registryFor("ES").prepare([], kind, localDateTime(io.now()));
    } catch (e) {
      if (e instanceof NotAvailableError) {
        io.err(e.message);
        return 1;
      }
      throw e;
    }
  }
  const pass = await askPassphrase(io);
  let key;
  try {
    key = unlockKeys(db, pass);
  } catch (e) {
    if (e instanceof PassphraseError) throw new SetupError(e.message);
    throw e;
  }
  const stays = rows.map((r) => openStay(db, r, settingsOf(config, r), key, localDateTime(io.now()).slice(0, 10)));
  const registry = registryFor("ES-CT");
  let failed = false;
  for (const o of stays) {
    const problems = registry.validate(o.stay, kind);
    if (problems.length === 0) continue;
    failed = true;
    io.out(`${o.stay.id}: the ${KIND_LABEL[kind]} cannot be made yet:`);
    for (const p of problems) io.out(`  - ${p.path}: ${p.message}`);
  }
  if (failed) {
    io.out('Complete the data with the check-in form or "fairnight ospiti correggi", then prepare again. No file was written.');
    return 1;
  }
  const at = localDateTime(io.now());
  const folder = path.resolve(io.cwd, values.out ?? path.join(dir, DATA_DIR, "fairguest"));
  mkdirSync(folder, { recursive: true });
  const byEstablishment = new Map<string, OpenedStay[]>();
  for (const o of stays) byEstablishment.set(o.stay.establishment, [...(byEstablishment.get(o.stay.establishment) ?? []), o]);
  for (const [establishment, group] of byEstablishment) {
    const f = mossosFile(
      group.map((o) => o.stay),
      kind,
      at,
      nextSequence(db, establishment),
    );
    const file = path.join(folder, f.name);
    writeFileSync(file, f.bytes, { mode: 0o600 });
    chmodSync(file, 0o600);
    for (const o of group) recordSubmission(db, { stayId: o.stay.id, kind, channel: "mossos-file", status: "prepared", at, file });
    const lines = f.text.split("\r\n").length - 1;
    io.out(`Wrote ${file}: ${lines} traveller line${lines === 1 ? "" : "s"}, ${KIND_LABEL[kind]}, establishment ${establishment}.`);
  }
  io.out(`Upload it on ${MOSSOS_PORTAL} ("Envío de ficheros masivos"), then: fairnight ospiti inviato <stay> --tipo ${values.tipo ?? "checkin"}`);
  io.out("The file holds the guests' data in clear: it is deleted when you record the upload, or with the stay's data.");
  return 0;
}

function confirmSent(db: Db, config: HostConfig, args: string[], values: GuestOptions, io: Io): number {
  const [id, ...extra] = args;
  noExtra(extra);
  const row = stayOrFail(db, id);
  const settings = settingsOf(config, row);
  const kind = settings.country === "IT" ? kindOf(values.tipo, "checkin") : kindOf(values.tipo, null);
  if (settings.country === "IT" && kind !== "checkin") throw new UsageError("In Italy only the guests are communicated (Alloggiati Web): there is no booking or cancellation to record.");
  const at = localDateTime(io.now());
  const channel = settings.country === "ES-CT" ? "mossos-file" : settings.country === "IT" ? "alloggiati-web" : "ses-web";
  recordSubmission(db, { stayId: row.id, kind, channel, status: kind === "cancellation" ? "cancelled" : "accepted", at, detail: "confirmed by the host" });
  // The uploaded file is not needed any more.
  for (const s of submissions(db, row.id)) {
    if (s.kind === kind && s.file) {
      rmSync(s.file, { force: true });
      db.prepare("UPDATE guest_submissions SET file = NULL WHERE id = ?").run(s.id);
    }
  }
  io.out(`Stay ${row.id}: ${KIND_LABEL[kind]} recorded as done on ${show(at)}.`);
  for (const e of applyRetention(db, config, io.now()).erased) io.out(`Erased the personal data of stay ${e.id}: ${e.reason}.`);
  return 0;
}

async function exportStay(db: Db, config: HostConfig, args: string[], values: GuestOptions, io: Io): Promise<number> {
  const [id, ...extra] = args;
  noExtra(extra);
  const row = stayOrFail(db, id);
  const o = await opened(db, config, row, io);
  const index = personIndex(values.persona, o.people.length);
  const guests = index === null ? o.people.map((p) => p.data.guest) : [(o.people[index] as OpenedStay["people"][number]).data.guest];
  const data = {
    exportedAt: localDateTime(io.now()),
    controller: "the host of the listing (Fairguest runs on the host's computer)",
    purpose: "communication of travellers to the police, Real Decreto 933/2021",
    recipient: registryFor(o.settings.country).authority,
    stay: {
      id: o.stay.id,
      listing: row.listing,
      checkIn: o.stay.checkIn,
      checkOut: o.stay.checkOut,
      reference: o.stay.reference,
      ...(index === null ? { people: o.stay.people, payment: o.stay.payment?.type ?? null } : {}),
    },
    guests,
    communications: submissions(db, row.id).map((s) => ({ kind: s.kind, status: s.status, at: s.at, channel: s.channel })),
    retention: retentionOf(db, row, o.settings),
  };
  const json = JSON.stringify(data, null, 2);
  if (values.out) {
    const file = path.resolve(io.cwd, values.out);
    writeFileSync(file, json + "\n", { mode: 0o600 });
    io.out(`Wrote ${file}. It holds personal data in clear: give it to the guest and delete it.`);
  } else io.out(json);
  return 0;
}

function erase(db: Db, config: HostConfig, args: string[], values: GuestOptions, io: Io): number {
  const [id, ...extra] = args;
  noExtra(extra);
  const row = stayOrFail(db, id);
  notErased(row);
  const settings = settingsOf(config, row);
  const list = people(db, row.id);
  const index = personIndex(values.persona, list.length);
  const what = index === null ? `all the personal data of stay ${row.id} (${list.length} guest${list.length === 1 ? "" : "s"}, the booking details, the check-in link and any file)` : `guest ${index + 1} of stay ${row.id}`;
  if (settings.professional) {
    const rule = retentionOf(db, row, settings);
    io.out(`Note: as a professional host you must keep the register until ${show(rule.eraseFrom ?? "")} (RD 933/2021, art. 5.3). The GDPR (art. 17.3.b) lets you refuse an erasure request for that reason; erasing anyway is your decision.`);
  }
  if (!values.applica) {
    io.out(`Would erase ${what}. Nothing was erased: add --applica to do it. It cannot be undone.`);
    return 0;
  }
  if (index === null) eraseStay(db, row.id, io.now());
  else erasePerson(db, (list[index] as { id: string }).id);
  io.out(`Erased ${what}.`);
  return 0;
}

function clean(db: Db, config: HostConfig, args: string[], erasedNow: number, orphans: string[], io: Io): number {
  noExtra(args);
  if (erasedNow === 0) io.out("Nothing to erase today.");
  for (const row of listStays(db).filter((r) => !r.erased_at)) {
    const s = config.listings.find((l) => l.name === row.listing)?.fairguest;
    if (!s) continue;
    const rule = retentionOf(db, row, s);
    io.out(`${row.id}  ${row.listing}  ${row.check_in} → ${row.check_out}  ${rule.eraseFrom ? `erased from ${show(rule.eraseFrom)}` : "kept for now"}: ${rule.reason}`);
  }
  if (orphans.length > 0) {
    io.out(`${orphans.length} stay${orphans.length === 1 ? "" : "s"} of listings without a "fairguest" block: no rule applies. Put the block back, or erase them with "fairnight ospiti cancella <stay> --applica": ${orphans.join(", ")}`);
  }
  io.out("Backups of data/fairnight.db are not touched: erasing works only on this file.");
  return 0;
}

// ---------------------------------------------------------------- Italy, Alloggiati Web

const ALLOGGIATI_CHANNEL = "alloggiati-web";

async function tables(dir: string, db: Db, args: string[], io: Io): Promise<number> {
  noExtra(args);
  const t = await downloadTables(dir, db, io);
  io.out(`Downloaded the Alloggiati Web code tables: ${t.municipalities.length} municipalities, ${t.states.length} states, ${t.documents.length} document types (saved in data/fairguest/alloggiati).`);
  return 0;
}

/** The saved tables, downloaded again when older than a month (municipalities change). */
async function freshTables(dir: string, db: Db, io: Io): Promise<AlloggiatiTables> {
  const saved = loadTables(dir, db);
  const today = localDateTime(io.now()).slice(0, 10);
  if (saved && addDays(saved.at.slice(0, 10), TABLES_MAX_DAYS) > today) return saved.tables;
  try {
    const t = await downloadTables(dir, db, io);
    io.out("Downloaded the Alloggiati Web code tables from the portal.");
    return t;
  } catch (e) {
    if (saved) {
      io.out(`The Alloggiati Web code tables could not be updated (${(e as Error).message}): using those of ${saved.at.slice(0, 10)}.`);
      return saved.tables;
    }
    throw new SetupError(`The Alloggiati Web code tables are needed and could not be downloaded (${(e as Error).message}). Try again later with "fairnight ospiti tabelle".`);
  }
}

function accountOf(values: GuestOptions): string {
  const account = values.account ?? DEFAULT_ALLOGGIATI_ACCOUNT;
  if (!/^[a-z0-9-]{1,30}$/.test(account)) throw new UsageError(`--account must be a short name of lower-case letters, digits and dashes, got "${account}"`);
  return account;
}

const italyAccount = (s: GuestSettings) => s.alloggiati?.account ?? DEFAULT_ALLOGGIATI_ACCOUNT;

async function credentials(db: Db, args: string[], values: GuestOptions, io: Io): Promise<number> {
  noExtra(args);
  const account = accountOf(values);
  if (values.istat) return await istatCredentials(db, account, values, io);
  if (values.verifica) {
    // Asks the service for a token and checks it: no schedina is sent.
    const key = await unlockedKey(db, io);
    const c = loadCredentials(db, account, key);
    if (!c) throw new SetupError(`No Alloggiati Web credentials saved for account "${account}": "fairnight ospiti credenziali${account === DEFAULT_ALLOGGIATI_ACCOUNT ? "" : ` --account ${account}`}".`);
    const client = alloggiatiClient(io);
    const { token, expires } = await client.token(c);
    const check = await client.authenticationTest(c.user, token);
    if (!check.ok) throw new SetupError(`Alloggiati Web gave a token but did not accept it: ${[check.code, check.description, check.detail].filter(Boolean).join(" · ")}`);
    io.out(`Alloggiati Web accepted the credentials of account "${account}" (token valid until ${expires || "unknown"}). Nothing was sent.`);
    return 0;
  }
  if (!io.prompt) throw new SetupError("The credentials are asked in a terminal (password and key without echo), never written on the command line.");
  const before = hasCredentials(db, account);
  io.out(`Alloggiati Web, account "${account}": the user and password of the portal, and the "Chiave Web Service" generated in the portal's user menu.`);
  const user = (await io.prompt("Utente: ", { hidden: false })).trim();
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(user)) throw new SetupError("The user is a code of letters and digits, as given by the Questura: nothing was saved.");
  const password = await io.prompt("Password: ", { hidden: true });
  const wsKey = (await io.prompt("Chiave Web Service: ", { hidden: true })).trim();
  if (!password || !wsKey) throw new SetupError("Password and key are both needed: nothing was saved.");
  saveCredentials(db, account, { user, password, wsKey });
  io.out(`Saved${before ? ", replacing the previous ones" : ""}. They are sealed with your Fairguest key and open only with the passphrase.`);
  io.out(`When the password changes, the key must be generated again on the portal and saved here again. To check them without sending anything: "fairnight ospiti credenziali --verifica${account === DEFAULT_ALLOGGIATI_ACCOUNT ? "" : ` --account ${account}`}".`);
  return 0;
}

export async function unlockedKey(db: Db, io: Io) {
  const pass = await askPassphrase(io);
  try {
    return unlockKeys(db, pass);
  } catch (e) {
    if (e instanceof PassphraseError) throw new SetupError(e.message);
    throw e;
  }
}

function italyRow(db: Db, config: HostConfig, id: string | undefined): { row: StayRow; settings: GuestSettings } {
  const row = stayOrFail(db, id);
  const settings = settingsOf(config, row);
  if (settings.country !== "IT") throw new UsageError(`Stay ${row.id} is not in Italy: this command is for Alloggiati Web.`);
  return { row, settings };
}

function recognized(db: Db, config: HostConfig, args: string[], io: Io): number {
  if (args.length === 0) throw new UsageError("Which stay? fairnight ospiti riconosciuto <stay>");
  for (const id of [...new Set(args)]) {
    const { row } = italyRow(db, config, id);
    notErased(row);
    markRecognized(db, row.id, io.now());
    io.out(`Stay ${row.id}: guests recognized on ${show(localDateTime(io.now()))}.`);
  }
  io.out("This records that you checked each guest against the identity document, in person or on a live video call (Consiglio di Stato, judgment 9101/2025). The check-in link fills in the data: it does not replace this.");
  return 0;
}

/** Stays that cannot go yet: not recognized, or with a missing field or code. */
function problemsOfItaly(o: OpenedStay, tables: AlloggiatiTables): { lines: string[]; problems: string[] } {
  const problems: string[] = [];
  if (!o.row.recognized_at) problems.push('the guests are not recognized yet: see them in person or on a live video call, then "fairnight ospiti riconosciuto"');
  const r = schedine(o.stay, tables);
  problems.push(...r.problems.map((p) => `${p.path}: ${p.message}`));
  return { lines: problems.length === 0 ? r.lines : [], problems };
}

async function prepareItaly(dir: string, db: Db, config: HostConfig, rows: StayRow[], values: GuestOptions, io: Io): Promise<number> {
  if (values.tipo !== undefined && kindOf(values.tipo, "checkin") !== "checkin") throw new UsageError("In Italy only the guests are communicated: there is no booking to prepare.");
  const tablesNow = await freshTables(dir, db, io);
  const key = await unlockedKey(db, io);
  const stays = rows.map((r) => openStay(db, r, settingsOf(config, r), key, localDateTime(io.now()).slice(0, 10)));
  let failed = false;
  const ready: { o: OpenedStay; lines: string[] }[] = [];
  for (const o of stays) {
    const r = problemsOfItaly(o, tablesNow);
    if (r.problems.length === 0) ready.push({ o, lines: r.lines });
    else {
      failed = true;
      io.out(`${o.stay.id}: the schedine cannot be made yet:`);
      for (const p of r.problems) io.out(`  - ${p}`);
    }
  }
  if (failed) {
    io.out('Complete the data with the check-in form or "fairnight ospiti correggi", then prepare again. No file was written.');
    return 1;
  }
  const at = localDateTime(io.now());
  const folder = path.resolve(io.cwd, values.out ?? path.join(dir, DATA_DIR, "fairguest"));
  mkdirSync(folder, { recursive: true });
  const byListing = new Map<string, { o: OpenedStay; lines: string[] }[]>();
  for (const r of ready) byListing.set(r.o.row.listing, [...(byListing.get(r.o.row.listing) ?? []), r]);
  for (const [listing, group] of byListing) {
    const f = alloggiatiFile(
      group.flatMap((g) => g.lines),
      `alloggiati-${listing}-${at.replace(/[-:]/g, "").replace("T", "-")}.txt`,
    );
    const file = path.join(folder, f.name);
    writeFileSync(file, f.bytes, { mode: 0o600 });
    chmodSync(file, 0o600);
    for (const g of group) recordSubmission(db, { stayId: g.o.stay.id, kind: "checkin", channel: "alloggiati-file", status: "prepared", at, file });
    io.out(`Wrote ${file}: ${group.reduce((n, g) => n + g.lines.length, 0)} schedine for ${listing}.`);
  }
  io.out(`Upload it on ${ALLOGGIATI_PORTAL} ("Invio File"; the portal takes arrivals of today and yesterday only), then: fairnight ospiti inviato <stay>`);
  io.out("The file holds the guests' data in clear: it is deleted when you record the upload, or with the stay's data.");
  return 0;
}

interface SendItem {
  o: OpenedStay;
  lines: string[];
}

async function sendItaly(dir: string, db: Db, config: HostConfig, args: string[], values: GuestOptions, io: Io): Promise<number> {
  const today = localDateTime(io.now()).slice(0, 10);
  const yesterday = addDays(today, -1);
  const done = (r: StayRow) => submissions(db, r.id).some((s) => s.kind === "checkin" && (s.status === "accepted" || s.status === "sent"));
  let rows: StayRow[];
  if (args.length > 0) {
    rows = [...new Set(args)].map((id) => italyRow(db, config, id).row);
    rows.forEach(notErased);
  } else {
    const italian = listStays(db).filter((r) => !r.erased_at && !r.cancelled_at && config.listings.find((l) => l.name === r.listing)?.fairguest?.country === "IT" && !done(r));
    for (const r of italian.filter((r) => r.check_in < yesterday && today <= addDays(r.check_out, 30))) {
      io.out(`${r.id}: arrived ${r.check_in}, too late for the web service (it takes arrivals of today and yesterday only). Ask the Questura how to communicate it.`);
    }
    rows = italian.filter((r) => r.check_in === today || r.check_in === yesterday);
  }
  for (const r of rows) {
    if (done(r)) throw new SetupError(`Stay ${r.id} was already communicated to Alloggiati Web: nothing is sent twice.`);
    if (r.check_in > today) throw new SetupError(`Stay ${r.id} arrives on ${r.check_in}: Alloggiati Web takes the schedine from the day of arrival.`);
    if (r.check_in < yesterday) throw new SetupError(`Stay ${r.id} arrived on ${r.check_in}: the web service takes arrivals of today and yesterday only. Ask the Questura how to communicate it.`);
  }
  if (rows.length === 0) {
    io.out("Nothing to send to Alloggiati Web now: no arrival today or yesterday still to communicate.");
    return 0;
  }
  const network = values.prova || values.applica;
  if (network && !io.prompt) {
    // Without a terminal (a scheduled task) only listings that allow it explicitly.
    const notAllowed = rows.filter((r) => !settingsOf(config, r).alloggiati?.autoSend);
    if (notAllowed.length > 0) {
      throw new SetupError(
        `Sending without a terminal is off for ${[...new Set(notAllowed.map((r) => r.listing))].join(", ")}: set "alloggiati": { "autoSend": true } in fairnight.config.json only if you accept the risks explained in docs/fairguest-italia.md.`,
      );
    }
  }
  const tablesNow = await freshTables(dir, db, io);
  const key = await unlockedKey(db, io);
  const ready: SendItem[] = [];
  let blocked = 0;
  for (const r of rows) {
    const o = openStay(db, r, settingsOf(config, r), key, localDateTime(io.now()).slice(0, 10));
    const check = problemsOfItaly(o, tablesNow);
    if (check.problems.length > 0) {
      blocked++;
      io.out(`${r.id} (${r.listing}, arrival ${r.check_in}): not ready`);
      for (const p of check.problems) io.out(`  - ${p}`);
      continue;
    }
    ready.push({ o, lines: check.lines });
    io.out(`${r.id} (${r.listing}, arrival ${r.check_in}): ${check.lines.length} schedin${check.lines.length === 1 ? "a" : "e"} ready`);
  }
  if (!network) {
    io.out(
      ready.length > 0
        ? 'Nothing was sent. "--prova" asks Alloggiati Web to check them without registering them; "--applica" checks them and sends them.'
        : "Nothing was sent.",
    );
    return blocked > 0 ? 1 : 0;
  }
  // One token per account; one call per account and apartment.
  const groups = new Map<string, { account: string; apartmentId: number | undefined; items: SendItem[] }>();
  for (const item of ready) {
    const s = item.o.settings;
    const id = `${italyAccount(s)}#${s.alloggiati?.apartmentId ?? ""}`;
    const g = groups.get(id) ?? { account: italyAccount(s), apartmentId: s.alloggiati?.apartmentId, items: [] };
    g.items.push(item);
    groups.set(id, g);
  }
  const client = alloggiatiClient(io);
  const tokens = new Map<string, { user: string; token: string }>();
  let failures = blocked;
  const at = localDateTime(io.now());
  for (const g of groups.values()) {
    let auth = tokens.get(g.account);
    if (!auth) {
      const c = loadCredentials(db, g.account, key);
      if (!c) {
        failures += g.items.length;
        io.out(`No Alloggiati Web credentials for account "${g.account}": "fairnight ospiti credenziali${g.account === DEFAULT_ALLOGGIATI_ACCOUNT ? "" : ` --account ${g.account}`}". Nothing was sent for ${g.items.map((i) => i.o.stay.id).join(", ")}.`);
        continue;
      }
      auth = { user: c.user, token: (await client.token(c)).token };
      tokens.set(g.account, auth);
    }
    // Always check first: only the stays whose schedine all pass are sent.
    const test = await client.test(auth.user, auth.token, g.items.flatMap((i) => i.lines), g.apartmentId);
    if (!test.result.ok) throw new AlloggiatiError(`Alloggiati Web refused the check: ${[test.result.code, test.result.description, test.result.detail].filter(Boolean).join(" · ")}`);
    const passing: SendItem[] = [];
    let offset = 0;
    for (const item of g.items) {
      const outcomes = test.lines.slice(offset, offset + item.lines.length);
      offset += item.lines.length;
      const bad = outcomes.map((x, i) => ({ x, i })).filter(({ x }) => !x.ok);
      if (outcomes.length === item.lines.length && bad.length === 0) passing.push(item);
      else {
        failures++;
        io.out(`${item.o.stay.id}: Alloggiati Web found errors${values.applica ? ", not sent" : ""}:`);
        for (const { x, i } of bad) io.out(`  - guest ${i + 1}: ${[x.code, x.description, x.detail].filter(Boolean).join(" · ")}`);
        if (outcomes.length !== item.lines.length) io.out("  - the service did not answer for every schedina");
      }
    }
    if (!values.applica) {
      for (const item of passing) io.out(`${item.o.stay.id}: Alloggiati Web checked ${item.lines.length} schedin${item.lines.length === 1 ? "a" : "e"}: correct. Not sent (--prova).`);
      continue;
    }
    if (passing.length === 0) continue;
    const sent = await client.send(auth.user, auth.token, passing.flatMap((i) => i.lines), g.apartmentId);
    offset = 0;
    for (const item of passing) {
      const outcomes = sent.lines.slice(offset, offset + item.lines.length);
      offset += item.lines.length;
      const okCount = outcomes.filter((x) => x.ok).length;
      if (sent.result.ok && okCount === item.lines.length) {
        // What Istat still needs, kept apart (no name, no document) before the guests' data goes.
        if (item.o.settings.istat) for (const p of keepIstat(db, item.o, tablesNow)) io.out(`${item.o.stay.id}: Istat record incomplete, ${p}`);
        recordSubmission(db, { stayId: item.o.stay.id, kind: "checkin", channel: ALLOGGIATI_CHANNEL, status: "accepted", at, batch: g.account, detail: `${okCount} schedine accepted` });
        io.out(`${item.o.stay.id}: sent to Alloggiati Web, ${okCount} schedin${okCount === 1 ? "a" : "e"} accepted.`);
      } else {
        failures++;
        const detail = outcomes.map((x, i) => (x.ok ? `guest ${i + 1} accepted` : `guest ${i + 1} refused: ${[x.code, x.description, x.detail].filter(Boolean).join(" · ")}`)).join("; ");
        recordSubmission(db, { stayId: item.o.stay.id, kind: "checkin", channel: ALLOGGIATI_CHANNEL, status: "rejected", at, batch: g.account, detail: detail || "no answer per schedina" });
        io.out(`${item.o.stay.id}: Alloggiati Web did not accept everything: ${detail || "no answer per schedina"}. Check on the portal which guests are registered before trying again.`);
      }
    }
  }
  if (values.applica) {
    for (const e of applyRetention(db, config, io.now()).erased) io.out(`Erased the personal data of stay ${e.id}: ${e.reason}.`);
    io.out('The receipt of today can be downloaded from tomorrow: "fairnight ospiti ricevute".');
  }
  return failures > 0 ? 1 : 0;
}

async function fetchReceipts(dir: string, db: Db, config: HostConfig, args: string[], io: Io): Promise<number> {
  noExtra(args);
  const today = localDateTime(io.now()).slice(0, 10);
  const first = addDays(today, -30);
  const have = new Set(receipts(db).map((r) => `${r.account}#${r.day}`));
  const wanted = new Map<string, { account: string; day: string }>();
  for (const row of listStays(db)) {
    const s = config.listings.find((l) => l.name === row.listing)?.fairguest;
    if (s?.country !== "IT") continue;
    for (const sub of submissions(db, row.id)) {
      if (sub.channel !== ALLOGGIATI_CHANNEL || sub.status !== "accepted") continue;
      const day = sub.at.slice(0, 10);
      const account = sub.batch ?? italyAccount(s);
      if (day >= today || day < first || have.has(`${account}#${day}`)) continue;
      wanted.set(`${account}#${day}`, { account, day });
    }
  }
  if (wanted.size === 0) {
    io.out("No Alloggiati Web receipt to download (the service keeps them for the last 30 days, today excluded).");
    return 0;
  }
  const key = await unlockedKey(db, io);
  const client = alloggiatiClient(io);
  let missing = 0;
  const tokens = new Map<string, { user: string; token: string }>();
  for (const { account, day } of [...wanted.values()].sort((a, b) => a.day.localeCompare(b.day))) {
    let auth = tokens.get(account);
    if (!auth) {
      const c = loadCredentials(db, account, key);
      if (!c) {
        missing++;
        io.out(`No credentials for account "${account}": the receipt of ${day} was not downloaded.`);
        continue;
      }
      auth = { user: c.user, token: (await client.token(c)).token };
      tokens.set(account, auth);
    }
    const r = await client.receipt(auth.user, auth.token, day);
    if (!r.pdf) {
      missing++;
      io.out(`The receipt of ${day} (account ${account}) is not available: ${[r.result.code, r.result.description, r.result.detail].filter(Boolean).join(" · ") || "no reason given"}.`);
      continue;
    }
    io.out(`Saved ${saveReceipt(dir, db, account, day, r.pdf, io.now())}: keep it 5 years (it is deleted by itself after that).`);
  }
  return missing > 0 ? 1 : 0;
}

// ---------------------------------------------------------------- the check-in link (relay)

function reportPull(r: PullReport, io: Io): void {
  if (r.guests > 0) io.out(`Downloaded ${r.guests} guest${r.guests === 1 ? "" : "s"} sent through the check-in link${r.stays > 1 ? ` (${r.stays} stays)` : ""}. They stay encrypted; "fairnight ospiti mostra <stay>" opens them.`);
  for (const e of r.errors) io.out(`Check-in link: ${e}`);
}

/** Before the commands that show or send guests: what came through the links, without stopping on a network error. */
async function pullQuietly(db: Db, io: Io, config: HostConfig): Promise<void> {
  reportPull(await pullRelay(db, io, config), io);
}

async function link(db: Db, config: HostConfig, args: string[], io: Io): Promise<number> {
  const [id, ...extra] = args;
  noExtra(extra);
  const row = stayOrFail(db, id);
  notErased(row);
  if (row.cancelled_at) throw new SetupError(`Stay ${row.id} is cancelled: no link.`);
  const today = localDateTime(io.now()).slice(0, 10);
  if (today > row.check_out) throw new SetupError(`Stay ${row.id} ended on ${row.check_out}: no link.`);
  if (row.check_in > addDays(today, 110)) throw new SetupError(`Stay ${row.id} starts on ${row.check_in}: a link can be made from 110 days before.`);
  const listing = config.listings.find((l) => l.name === row.listing);
  const settings = settingsOf(config, row);
  const url = await stayLink(db, io, config, row, {
    title: listing?.pricing.name ?? row.listing,
    country: settings.country,
    residence: settings.country === "IT" && !!settings.istat,
    ...(settings.touristTax?.residentsExempt ? { taxTown: settings.touristTax.name } : {}),
  });
  io.out(url);
  io.out("");
  io.out("Send it to the guest the way you usually write to them. It works from any phone, until two days after check-out.");
  io.out("Whoever has the link can add guests to this stay, not read them: the details are encrypted in the guest's browser with your key, and the relay cannot open them.");
  io.out('Then "fairnight ospiti scarica" downloads them (also by itself with "fairnight serve" running, and before "elenco" and "invia").');
  if (settings.country === "IT") io.out("Italy: the link does not replace recognizing the guests in person or on a live video call (fairnight ospiti riconosciuto).");
  return 0;
}

async function download(db: Db, config: HostConfig, args: string[], io: Io): Promise<number> {
  noExtra(args);
  const r = await pullRelay(db, io, config);
  reportPull(r, io);
  if (r.guests === 0 && r.errors.length === 0) io.out("Nothing new through the check-in links.");
  if (r.closed > 0) io.out(`Deleted ${r.closed} mailbox${r.closed === 1 ? "" : "es"} of stays that are over.`);
  return r.errors.length > 0 ? 1 : 0;
}

async function verifyPage(config: HostConfig, args: string[], io: Io): Promise<number> {
  noExtra(args);
  const relay = relayOf(config);
  const results = await checkPage(io, config, { ...PAGE_HASHES, "/ocr/mrz.traineddata": MRZ_MODEL_SHA256 });
  for (const r of results) io.out(`${r.ok ? "same     " : "DIFFERENT"}  ${r.path}${r.ok ? "" : r.got ? `  (sha256 ${r.got})` : r.redirect ? `  (redirect, ${r.redirect}: the link would lose its box)` : "  (not served)"}`);
  const bad = results.filter((r) => !r.ok).length;
  if (bad === 0) io.out(`${relay} serves exactly the page of this version of Fairguest.`);
  else io.out(`${relay} serves ${bad} file${bad === 1 ? "" : "s"} different from this version: do not send its links until you know why (an update of the relay, or someone changed it).`);
  return bad > 0 ? 1 : 0;
}

// ---------------------------------------------------------------- Italy, Istat

const monthOf = (day: string) => day.slice(0, 7);
const previousMonth = (day: string) => addDays(`${monthOf(day)}-01`, -1).slice(0, 7);
const lastDayOf = (month: string) => addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);

/** In the first half of the month: the previous month's Istat figures to send, per listing. */
function istatReminders(db: Db, config: HostConfig, io: Io): string[] {
  const today = localDateTime(io.now()).slice(0, 10);
  if (Number(today.slice(8, 10)) > 15) return [];
  const month = previousMonth(today);
  const out: string[] = [];
  for (const l of guestListings(config.listings)) {
    const istat = l.fairguest.istat;
    if (l.fairguest.country !== "IT" || !istat) continue;
    const region = ISTAT_REGIONS[istat.region];
    if (region.mode === "ross1000") {
      const done = acceptedDays(db, l.name);
      let missing = 0;
      for (let d = `${month}-01`; d <= lastDayOf(month); d = addDays(d, 1)) if (!done.has(d)) missing++;
      if (missing === 0) continue;
      out.push(`Istat ${region.name} (${l.name}): ${missing} day${missing === 1 ? "" : "s"} of ${month} not sent yet, ${region.deadline}: fairnight ospiti istat --mese ${month} --applica`);
    } else out.push(`Istat ${region.name} (${l.name}): the figures of ${month}, ${region.deadline}: fairnight ospiti istat --mese ${month}`);
  }
  return out;
}

async function istatCredentials(db: Db, account: string, values: GuestOptions, io: Io): Promise<number> {
  if (values.verifica) throw new UsageError('ROSS1000 has no call to check the credentials alone: the first "fairnight ospiti istat --applica" tells.');
  if (!io.prompt) throw new SetupError("The credentials are asked in a terminal (the password without echo), never written on the command line.");
  io.out(`ROSS1000, account "${account}": the user and the transmission password of the structure (with SPID/CIE, ask the region's tourism office for a transmission password).`);
  const user = (await io.prompt("Utente: ", { hidden: false })).trim();
  const password = await io.prompt("Password: ", { hidden: true });
  if (!user || !password) throw new SetupError("User and password are both needed: nothing was saved.");
  saveIstatCredentials(db, account, { user, password });
  io.out("Saved, sealed with your Fairguest key: they open only with the passphrase.");
  return 0;
}

/** The Istat records of the stays of a listing that touch the period, kept when still missing. */
function istatRecords(db: Db, config: HostConfig, listing: string, from: string, to: string, key: KeyObject, tables: AlloggiatiTables, io: Io) {
  const records = new Map<string, IstatStay>();
  const missing = new Map<string, string>();
  const today = localDateTime(io.now()).slice(0, 10);
  for (const row of listStays(db, { listing, fromCheckOut: from }).filter((r) => r.check_in <= to && !r.cancelled_at)) {
    let r = readIstat(db, row.id, key);
    if (!r && !row.erased_at) {
      const o = openStay(db, row, settingsOf(config, row), key, today);
      const problems = keepIstat(db, o, tables);
      if (problems.length > 0) missing.set(row.id, problems.join("; "));
      r = readIstat(db, row.id, key);
    }
    if (r) records.set(row.id, r);
    else if (!missing.has(row.id)) missing.set(row.id, "the guests' data is no longer there and no Istat record was kept");
  }
  return { records, missing };
}

async function istatCommand(dir: string, db: Db, config: HostConfig, args: string[], values: GuestOptions, io: Io): Promise<number> {
  noExtra(args);
  const today = localDateTime(io.now()).slice(0, 10);
  const month = values.mese ?? monthOf(today);
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw new UsageError(`--mese is a month like 2099-06, got "${month}"`);
  const from = `${month}-01`;
  const last = lastDayOf(month);
  const to = last < today ? last : addDays(today, -1);
  if (to < from) throw new UsageError(`The month ${month} has no day to communicate yet: Istat takes the days that are over.`);
  const listings = guestListings(config.listings).filter((l) => l.fairguest.country === "IT" && l.fairguest.istat);
  if (listings.length === 0) {
    io.out('No listing in Italy has an "istat" block in fairnight.config.json (region and code): see docs/fairguest-italia.md.');
    return 0;
  }
  const tablesNow = await freshTables(dir, db, io);
  const key = await unlockedKey(db, io);
  const folder = path.resolve(io.cwd, values.out ?? path.join(dir, DATA_DIR, "fairguest", "istat"));
  const at = localDateTime(io.now());
  let failures = 0;
  for (const l of listings) {
    const istat = l.fairguest.istat as NonNullable<GuestSettings["istat"]>;
    const region = ISTAT_REGIONS[istat.region];
    io.out(`${l.name} · Istat ${region.name} · ${month} (${from} → ${to}) · ${region.deadline}`);
    const { records, missing } = istatRecords(db, config, l.name, from, to, key, tablesNow, io);
    for (const [id, why] of missing) io.out(`  ${id}: ${why}`);
    const stays = [...records.values()];
    const rowsOf = listStays(db, { listing: l.name, fromCheckOut: from }).filter((r) => r.check_in <= to && !r.cancelled_at);
    const missingOn = (day: string) => rowsOf.some((r) => missing.has(r.id) && (r.check_in === day || r.check_out === day));
    mkdirSync(folder, { recursive: true });

    if (region.mode === "ross1000") {
      const done = acceptedDays(db, l.name);
      const closed = blockedDays(db, l.name, from, to);
      const ready: RossDay[] = [];
      const incomplete: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (done.has(d)) continue;
        if (missingOn(d)) {
          incomplete.push(d);
          continue;
        }
        const occupied = rowsOf.some((r) => r.check_in <= d && d < r.check_out);
        const arrivals = stays.filter((s) => s.checkIn === d).flatMap((s) => s.guests);
        const departures = stays.filter((s) => s.checkOut === d).flatMap((s) => s.guests.map((g) => ({ id: g.id, type: g.type, arrival: s.checkIn })));
        ready.push({ day: d, open: occupied || !closed.has(d), roomsOccupied: occupied ? (l.fairguest.rooms ?? 1) : 0, rooms: l.fairguest.rooms ?? 1, beds: l.fairguest.beds ?? 1, arrivals, departures });
      }
      if (incomplete.length > 0) io.out(`  Not ready: ${incomplete.join(", ")} (a stay without its guests' data). Complete them, then run again.`);
      if (ready.length === 0) {
        io.out(incomplete.length === 0 ? "  Every day of the period is already accepted by ROSS1000." : "  Nothing ready to send.");
        failures += incomplete.length > 0 ? 1 : 0;
        continue;
      }
      const file = path.join(folder, `ross1000-${l.name}-${month}.xml`);
      writeFileSync(file, rossFile(istat.code, ready), { mode: 0o600 });
      io.out(`  ${ready.length} day${ready.length === 1 ? "" : "s"} ready (${ready.reduce((n, d) => n + d.arrivals.length, 0)} arrivals, ${ready.reduce((n, d) => n + d.departures.length, 0)} departures). File for the portal: ${file}`);
      if (!values.applica) {
        io.out('  Not sent: "--applica" sends them to ROSS1000; or upload the file in the portal ("Importa file gestionale").');
        continue;
      }
      const c = loadIstatCredentials(db, istat.account, key);
      if (!c) {
        failures++;
        io.out(`  No ROSS1000 credentials for account "${istat.account}": "fairnight ospiti credenziali --istat${istat.account === DEFAULT_ALLOGGIATI_ACCOUNT ? "" : ` --account ${istat.account}`}". Nothing was sent.`);
        continue;
      }
      const outcomes = await rossClient(io, region.endpoint as string).send(c.user, c.password, istat.code, ready);
      for (const o of outcomes) {
        recordIstatDay(db, l.name, o.day, o.ok, at, o.errors.length ? o.errors.join("; ") : null);
        if (!o.ok) {
          failures++;
          io.out(`  ${o.day}: refused: ${o.errors.join("; ") || "no answer for this day"}`);
        }
      }
      const okDays = outcomes.filter((o) => o.ok).length;
      io.out(`  ROSS1000 accepted ${okDays} of ${outcomes.length} days.`);
      rmSync(file, { force: true });
      continue;
    }
    const complete = stays.filter((s) => !rowsOf.some((r) => missing.has(r.id) && r.check_in === s.checkIn && r.check_out === s.checkOut));
    if (region.mode === "trento-file") {
      const arriving = complete.filter((s) => s.checkIn >= from && s.checkIn <= to);
      const file = path.join(folder, `istat-trento-${l.name}-${month}.csv`);
      writeFileSync(file, trentoCsv(istat.code, arriving), { mode: 0o600 });
      io.out(`  Wrote ${file}: ${arriving.length} stay${arriving.length === 1 ? "" : "s"}. Upload it on ${region.portal} (menu import › upload): the portal takes arrivals of this month and the previous one.`);
    } else if (region.mode === "umbria-file") {
      const sub = path.join(folder, `umbria-${l.name}-${month}`);
      mkdirSync(sub, { recursive: true });
      let n = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (missingOn(d)) continue;
        const f = umbriaDay(istat.code, l.fairguest.rooms ?? 1, complete, d);
        writeFileSync(path.join(sub, f.name), f.text, { mode: 0o600 });
        n++;
      }
      io.out(`  Wrote ${n} daily file${n === 1 ? "" : "s"} in ${sub}: on Turismatica, «Inserimento tramite upload da file .txt», one per day.`);
    } else if (region.mode === "alloggiati-file") {
      io.out(`  ${region.name}: SPOT Easy takes the Alloggiati Web file. Make it with "fairnight ospiti prepara <stay>" and upload it on ${region.portal}.`);
    } else {
      const rows = monthSummary(complete, month);
      io.out(`  ${region.portal} takes the figures only by hand. ${month}:`);
      if (rows.length === 0) io.out("  no guest this month.");
      for (const r of rows) io.out(`  ${r.description.padEnd(28)} arrivals ${String(r.arrivals).padStart(3)} · nights ${String(r.nights).padStart(4)}`);
      const nights = (d: string) => (rowsOf.some((r) => r.check_in <= d && d < r.check_out) ? 1 : 0);
      let occupied = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) occupied += nights(d);
      io.out(`  Nights the listing was occupied: ${occupied}.`);
    }
  }
  return failures > 0 ? 1 : 0;
}
