/**
 * `fairnight ospiti …`: guest registration (Fairguest) from the command line.
 *
 * - Without the passphrase: deadlines, list, new stay, confirm a communication,
 *   erase, retention. They read only the clear columns.
 * - With the passphrase (asked without echo, or FAIRGUEST_FRASE): show, correct,
 *   prepare, export. Personal data is never passed as a command-line argument,
 *   so it never ends up in the shell history: corrections are asked for.
 */
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  changePassphrase,
  createKeys,
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
  registryFor,
  type GuestSettings,
  type Kind,
  type PaymentType,
} from "fairguest";
import { loadHostConfig, SetupError, type HostConfig } from "../config.js";
import { getMeta, openDb, setMeta, type Db } from "../db.js";
import { UsageError } from "../errors.js";
import { DATA_DIR, dbPath, type Io } from "../io.js";
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
}

export const GUEST_USAGE = `  fairnight ospiti                                 guest communications due, late or open (no passphrase) [--json]
  fairnight ospiti attiva                          turn on guest registration: choose the passphrase
  fairnight ospiti frase                           change the passphrase (the data stays as it is)
  fairnight ospiti elenco                          stays to register, with the link of their check-in form
  fairnight ospiti nuovo --listing <name> --da DATE --a DATE   a stay that is in no calendar
  fairnight ospiti mostra <stay>                   the data of a stay and what is still missing
  fairnight ospiti correggi <stay> <field>         change one field (the value is asked) [--persona N]
  fairnight ospiti prepara <stay…>                 the file or message to send [--tipo checkin|prenotazione] [--out folder]
  fairnight ospiti inviato <stay> --tipo T         record that a communication went through (checkin|prenotazione|annullamento)
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
    if (sub === "attiva" || sub === "setup") return await activate(db, config, args, io);
    if (!guestsEnabled(db)) throw new SetupError('Guest registration is not turned on in this folder: run "fairnight ospiti attiva" first.');
    if (guestListings(config.listings).length === 0) {
      io.out('No listing has a "fairguest" block in fairnight.config.json: add one to the listings whose guests you register (see the README).');
    }
    // Every command first catches up with the calendars and applies the retention rules.
    prefillFromCalendar(db, config.listings, io.now());
    const retention = applyRetention(db, config, io.now());
    for (const e of retention.erased) io.out(`Erased the personal data of stay ${e.id}: ${e.reason}.`);

    switch (sub) {
      case "scadenze":
      case "deadlines":
        return deadlines(db, config, args, values, io);
      case "frase":
      case "passphrase":
        return await passphrase(db, args, io);
      case "elenco":
      case "list":
        return list(db, args, values, io);
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

async function activate(db: Db, config: HostConfig, args: string[], io: Io): Promise<number> {
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
  io.out(`Guest communications · now ${show(localDateTime(io.now()))} · 24 hours from the booking and from check-in (RD 933/2021, art. 6.3)`);
  if (pending.length === 0) io.out("Nothing to communicate.");
  for (const r of pending) io.out(deadlineLine(r));
  if (late > 0) io.out(`${late} communication${late === 1 ? " is" : "s are"} late: make ${late === 1 ? "it" : "them"} now, then "fairnight ospiti inviato <stay> --tipo …".`);
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
    io.out('The forms open only on this computer and the local network: "fairnight serve --lan", then http://<this computer>:4321 plus the form path, on a phone or tablet.');
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
    return openStay(db, row, settingsOf(config, row), unlockKeys(db, pass));
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
  for (const kind of ["reservation", "checkin"] as Kind[]) {
    const problems = registry.validate(s, kind);
    io.out(problems.length === 0 ? `  ${KIND_LABEL[kind]}: complete` : `  ${KIND_LABEL[kind]}: missing or wrong`);
    for (const p of problems) io.out(`    - ${p.path}: ${p.message}`);
  }
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
  const [top, sub] = field.split(".") as [string, string | undefined];
  const value: unknown = field === "document.spanish" ? raw === "true" || raw === "sì" || raw === "si" || raw === "yes" : raw;
  if (sub === undefined) draft[top] = raw === "" ? undefined : value;
  else draft[top] = { ...((draft[top] as Record<string, unknown> | undefined) ?? {}), [sub]: raw === "" ? undefined : value };
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
  const stays = rows.map((r) => openStay(db, r, settingsOf(config, r), key));
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
  const kind = kindOf(values.tipo, null);
  const settings = settingsOf(config, row);
  const at = localDateTime(io.now());
  const channel = settings.country === "ES-CT" ? "mossos-file" : "ses-web";
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
