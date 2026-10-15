/**
 * The guest archive (Fairguest) inside the Fairnight database.
 *
 * - In clear: random ids, listing, dates, states. Everything that identifies a
 *   person is sealed for the host's public key (see packages/fairguest/crypto).
 * - Writing (prefill from Smoobu/Beds24, the check-in form) needs only the
 *   public key. Reading needs the passphrase.
 * - Retention runs without the passphrase: it looks only at dates and states.
 */
import { randomBytes, type KeyObject } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import {
  addHours,
  isPaymentType,
  localDateTime,
  open,
  parseGuest,
  publicKeyOf,
  registryFor,
  seal,
  unlock,
  type Country,
  type DeadlineInput,
  type Guest,
  type GuestSettings,
  type KeyRecord,
  type PaymentType,
  type Stay,
  type SubmissionRecord,
} from "fairguest";
import type { HostConfig, HostListing } from "../config.js";
import { getMeta, setMeta, type Db } from "../db.js";

export const KEYS_META = "fairguest_keys";

export interface StayRow {
  id: string;
  listing: string;
  source: string;
  source_uid: string | null;
  check_in: string;
  check_out: string;
  booked_at: string | null;
  seen_at: string;
  code: string | null;
  channel_data: string | null;
  host_data: string | null;
  cancelled_at: string | null;
  erased_at: string | null;
  /** Italy: when the host saw the guests in person or on a live video call. Absent on a read-only database of an older version. */
  recognized_at?: string | null;
}

/** What a channel manager knows about the guests of a booking. Sealed, never logged. */
export interface ChannelGuests {
  firstName: string | null;
  lastName: string | null;
  guests: number | null;
  reference: string | null;
}

interface ChannelData {
  reference?: string;
  holder?: { givenName?: string; surname1?: string };
  people?: number;
}

/** Corrections typed by the host: they win over what came from the channel. */
export interface HostData {
  reference?: string;
  people?: number;
  contractDate?: string;
  payment?: PaymentType;
}

export interface PersonData {
  guest: Guest;
  /** The payment type, asked once in the form (to the first guest). */
  payment?: PaymentType;
}

export type SubmissionKind = "reservation" | "checkin" | "cancellation";
export type SubmissionStatus = "prepared" | "sent" | "accepted" | "rejected" | "cancelled";

export interface SubmissionRow {
  id: number;
  stay_id: string;
  kind: SubmissionKind;
  channel: string;
  status: SubmissionStatus;
  at: string;
  batch: string | null;
  file: string | null;
  detail: string | null;
}

export const place = {
  channel: (id: string) => `guest_stays/${id}/channel`,
  host: (id: string) => `guest_stays/${id}/host`,
  person: (id: string) => `guest_people/${id}/data`,
};

export const newStayId = () => `fg${randomBytes(5).toString("hex")}`;
const newPersonId = () => `gp${randomBytes(6).toString("hex")}`;
const newCode = () => randomBytes(12).toString("base64url");

export function hasTable(db: Db, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

export function readKeys(db: Db): KeyRecord | null {
  if (!hasTable(db, "meta")) return null;
  const raw = getMeta(db, KEYS_META);
  return raw ? (JSON.parse(raw) as KeyRecord) : null;
}

export function writeKeys(db: Db, record: KeyRecord): void {
  setMeta(db, KEYS_META, JSON.stringify(record));
}

/** Fairguest is on when the tables exist and the host has created the keys. */
export const guestsEnabled = (db: Db): boolean => hasTable(db, "guest_stays") && readKeys(db) !== null;

export function unlockKeys(db: Db, passphrase: string): KeyObject {
  const record = readKeys(db);
  if (!record) throw new Error('Fairguest is not set up in this folder: run "fairnight ospiti attiva" first.');
  return unlock(record, passphrase);
}

function publicKey(db: Db): KeyObject {
  const record = readKeys(db);
  if (!record) throw new Error('Fairguest is not set up in this folder: run "fairnight ospiti attiva" first.');
  return publicKeyOf(record);
}

export const guestListings = (listings: HostListing[]) => listings.filter((l): l is HostListing & { fairguest: GuestSettings } => !!l.fairguest);

/** The columns every schema since 5 has: what read-only readers (the MCP server) may ask for. */
const BASE_COLUMNS = "id, listing, source, source_uid, check_in, check_out, booked_at, seen_at, code, channel_data, host_data, cancelled_at, erased_at";
const STAY_COLUMNS = `${BASE_COLUMNS}, recognized_at`;

export function getStay(db: Db, id: string): StayRow | null {
  return (db.prepare(`SELECT ${STAY_COLUMNS} FROM guest_stays WHERE id = ?`).get(id) as StayRow | undefined) ?? null;
}

export function listStays(db: Db, filter: { listing?: string; fromCheckOut?: string } = {}): StayRow[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.listing) {
    where.push("listing = ?");
    args.push(filter.listing);
  }
  if (filter.fromCheckOut) {
    where.push("check_out >= ?");
    args.push(filter.fromCheckOut);
  }
  return db.prepare(`SELECT ${STAY_COLUMNS} FROM guest_stays ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY check_in, id`).all(...args) as StayRow[];
}

export const peopleCount = (db: Db, stayId: string): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM guest_people WHERE stay_id = ?").get(stayId) as { n: number }).n;

interface EventRow {
  feed: string;
  uid: string;
  check_in: string;
  check_out: string;
  booked_at: string | null;
  removed_at: string | null;
}

/**
 * A guest stay for every booking of a Fairguest listing that ends today or
 * later, from the calendars already read (iCal, Smoobu, Beds24): only dates and
 * listing come from here. A booking that disappears gets cancelled_at; one that
 * comes back loses it. Stays already erased are never touched again.
 */
export function prefillFromCalendar(db: Db, listings: HostListing[], now: Date): { created: number; changed: number; cancelled: number } {
  const result = { created: 0, changed: 0, cancelled: 0 };
  if (!guestsEnabled(db)) return result;
  const at = localDateTime(now);
  const today = at.slice(0, 10);
  const events = db.prepare(
    "SELECT feed, uid, check_in, check_out, booked_at, removed_at FROM calendar_events WHERE listing = ? AND kind = 'reservation' AND check_out >= ? ORDER BY first_seen_at, id",
  );
  const bySource = db.prepare(`SELECT ${STAY_COLUMNS} FROM guest_stays WHERE listing = ? AND source = ? AND source_uid = ?`);
  const sameDates = db.prepare("SELECT id FROM guest_stays WHERE listing = ? AND check_in = ? AND check_out = ? AND cancelled_at IS NULL AND erased_at IS NULL");
  const insert = db.prepare(
    "INSERT INTO guest_stays (id, listing, source, source_uid, check_in, check_out, booked_at, seen_at, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const update = db.prepare("UPDATE guest_stays SET check_in = ?, check_out = ?, booked_at = ?, cancelled_at = ? WHERE id = ?");

  db.transaction(() => {
    for (const listing of guestListings(listings)) {
      for (const e of events.all(listing.name, today) as EventRow[]) {
        const row = bySource.get(listing.name, e.feed, e.uid) as StayRow | undefined;
        if (row) {
          if (row.erased_at) continue;
          const cancelledAt = e.removed_at ? (row.cancelled_at ?? at) : null;
          if (row.check_in !== e.check_in || row.check_out !== e.check_out || row.booked_at !== e.booked_at || row.cancelled_at !== cancelledAt) {
            if (cancelledAt && !row.cancelled_at) result.cancelled++;
            else result.changed++;
            update.run(e.check_in, e.check_out, e.booked_at, cancelledAt, row.id);
          }
          continue;
        }
        if (e.removed_at) continue;
        // The same booking seen through two sources (an iCal link and a channel manager): one stay.
        if (sameDates.get(listing.name, e.check_in, e.check_out)) continue;
        insert.run(newStayId(), listing.name, e.feed, e.uid, e.check_in, e.check_out, e.booked_at, at, newCode());
        result.created++;
      }
    }
  })();
  return result;
}

/**
 * The holder's name, number of guests and reference from Smoobu or Beds24,
 * sealed into the stay. Nothing of it goes to calendar_events or to the output.
 */
export function noteChannelGuests(
  db: Db,
  listing: HostListing,
  feed: string,
  bookings: readonly { uid: string; checkIn: string; checkOut: string; guests: ChannelGuests | null }[],
  now: Date,
): number {
  if (!listing.fairguest || !guestsEnabled(db)) return 0;
  prefillFromCalendar(db, [listing], now);
  const pub = publicKey(db);
  const find = db.prepare("SELECT id, erased_at FROM guest_stays WHERE listing = ? AND source = ? AND source_uid = ?");
  // The stay may have been created from an iCal link of the same booking first.
  const byDates = db.prepare("SELECT id, erased_at FROM guest_stays WHERE listing = ? AND check_in = ? AND check_out = ? AND cancelled_at IS NULL ORDER BY seen_at LIMIT 1");
  const write = db.prepare("UPDATE guest_stays SET channel_data = ? WHERE id = ?");
  let noted = 0;
  db.transaction(() => {
    for (const b of bookings) {
      if (!b.guests) continue;
      const row = (find.get(listing.name, feed, b.uid) ?? byDates.get(listing.name, b.checkIn, b.checkOut)) as { id: string; erased_at: string | null } | undefined;
      if (!row || row.erased_at) continue;
      const data: ChannelData = {};
      if (b.guests.reference) data.reference = b.guests.reference.slice(0, 20);
      if (b.guests.firstName || b.guests.lastName) {
        data.holder = {};
        if (b.guests.firstName) data.holder.givenName = b.guests.firstName;
        if (b.guests.lastName) data.holder.surname1 = b.guests.lastName;
      }
      if (b.guests.guests !== null && b.guests.guests > 0) data.people = b.guests.guests;
      if (Object.keys(data).length === 0) continue;
      write.run(seal(pub, data, place.channel(row.id)), row.id);
      noted++;
    }
  })();
  return noted;
}

/** A stay typed by hand (a booking that is in no calendar). */
export function addManualStay(db: Db, listing: string, checkIn: string, checkOut: string, now: Date): StayRow {
  const id = newStayId();
  db.prepare("INSERT INTO guest_stays (id, listing, source, source_uid, check_in, check_out, booked_at, seen_at, code) VALUES (?, ?, 'manual', ?, ?, ?, NULL, ?, ?)").run(
    id,
    listing,
    id,
    checkIn,
    checkOut,
    localDateTime(now),
    newCode(),
  );
  return getStay(db, id) as StayRow;
}

/** One guest, sealed with the public key: no passphrase needed (the check-in form uses this). */
export function addPerson(db: Db, stayId: string, data: PersonData, by: "host" | "form", now: Date): string {
  const id = newPersonId();
  db.prepare("INSERT INTO guest_people (id, stay_id, added_at, added_by, data) VALUES (?, ?, ?, ?, ?)").run(
    id,
    stayId,
    localDateTime(now),
    by,
    seal(publicKey(db), data, place.person(id)),
  );
  return id;
}

/** A guest who came through the check-in link: still sealed for the relay's place, opened only with the passphrase. */
export function addRelayPerson(db: Db, stayId: string, sealed: string, sealedPlace: string, now: Date): string {
  const id = newPersonId();
  db.prepare("INSERT INTO guest_people (id, stay_id, added_at, added_by, data, place) VALUES (?, ?, ?, 'form', ?, ?)").run(id, stayId, localDateTime(now), sealed, sealedPlace);
  return id;
}

export function people(db: Db, stayId: string): { id: string; added_at: string; added_by: string; data: string; place: string | null }[] {
  const withPlace = hasColumnOf(db, "guest_people", "place");
  return db.prepare(`SELECT id, added_at, added_by, data, ${withPlace ? "place" : "NULL AS place"} FROM guest_people WHERE stay_id = ? ORDER BY added_at, rowid`).all(stayId) as {
    id: string;
    added_at: string;
    added_by: string;
    data: string;
    place: string | null;
  }[];
}

const hasColumnOf = (db: Db, table: string, column: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);

/**
 * A guest from the link was written by a browser, not by our form handler:
 * it goes through the same reading as the form (unknown fields dropped).
 */
function fromRelay(raw: PersonData, today: string): PersonData {
  const guest = parseGuest((raw as { guest?: unknown }).guest, today).draft;
  const payment = (raw as { payment?: unknown }).payment;
  return isPaymentType(payment) ? { guest, payment } : { guest };
}

export interface OpenedStay {
  row: StayRow;
  settings: GuestSettings;
  stay: Stay;
  people: { id: string; addedBy: string; data: PersonData }[];
  channel: ChannelData;
  host: HostData;
}

/** Everything about a stay, decrypted with the private key, as the registry wants it. */
export function openStay(db: Db, row: StayRow, settings: GuestSettings, key: KeyObject, today = localDateTime(new Date()).slice(0, 10)): OpenedStay {
  const channel = row.channel_data ? open<ChannelData>(key, row.channel_data, place.channel(row.id)) : {};
  const host = row.host_data ? open<HostData>(key, row.host_data, place.host(row.id)) : {};
  const list = people(db, row.id).map((p) => ({
    id: p.id,
    addedBy: p.added_by,
    data: p.place ? fromRelay(open<PersonData>(key, p.data, p.place), today) : open<PersonData>(key, p.data, place.person(p.id)),
  }));
  const guests = list.map((p) => p.data.guest);
  if (guests.length === 0 && channel.holder?.givenName) {
    guests.push({ givenName: channel.holder.givenName, surname1: channel.holder.surname1 ?? "" });
  }
  const payment = host.payment ?? list.find((p) => p.data.payment)?.data.payment;
  const stay: Stay = {
    id: row.id,
    establishment: settings.establishment,
    reference: host.reference ?? channel.reference ?? row.id.toUpperCase(),
    contractDate: host.contractDate ?? row.booked_at?.slice(0, 10) ?? row.seen_at.slice(0, 10),
    checkIn: row.check_in,
    checkOut: row.check_out,
    people: host.people ?? channel.people ?? Math.max(list.length, 1),
    guests,
  };
  if (settings.establishmentName) stay.establishmentName = settings.establishmentName;
  if (settings.checkInTime) stay.checkInTime = settings.checkInTime;
  if (settings.checkOutTime) stay.checkOutTime = settings.checkOutTime;
  if (settings.rooms !== undefined) stay.rooms = settings.rooms;
  if (settings.internet !== undefined) stay.internet = settings.internet;
  if (payment) stay.payment = { type: payment };
  return { row, settings, stay, people: list, channel, host };
}

/** Italy: the host saw the guests (in person or on a live video call) and checked them against the documents. */
export function markRecognized(db: Db, stayId: string, now: Date): void {
  db.prepare("UPDATE guest_stays SET recognized_at = ? WHERE id = ?").run(localDateTime(now), stayId);
}

export function writeHostData(db: Db, stayId: string, data: HostData): void {
  db.prepare("UPDATE guest_stays SET host_data = ? WHERE id = ?").run(seal(publicKey(db), data, place.host(stayId)), stayId);
}

export function writePerson(db: Db, personId: string, data: PersonData): void {
  // Sealed again for its own row: a guest from the link becomes like any other.
  db.prepare(`UPDATE guest_people SET data = ?${hasColumnOf(db, "guest_people", "place") ? ", place = NULL" : ""} WHERE id = ?`).run(seal(publicKey(db), data, place.person(personId)), personId);
}

export function submissions(db: Db, stayId: string): SubmissionRow[] {
  return db.prepare("SELECT id, stay_id, kind, channel, status, at, batch, file, detail FROM guest_submissions WHERE stay_id = ? ORDER BY id").all(stayId) as SubmissionRow[];
}

export function recordSubmission(
  db: Db,
  s: { stayId: string; kind: SubmissionKind; channel: string; status: SubmissionStatus; at: string; file?: string | null; batch?: string | null; detail?: string | null },
): number {
  return Number(
    db
      .prepare("INSERT INTO guest_submissions (stay_id, kind, channel, status, at, batch, file, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(s.stayId, s.kind, s.channel, s.status, s.at, s.batch ?? null, s.file ?? null, s.detail ?? null).lastInsertRowid,
  );
}

/** Delete the files written for a stay (the Mossos .txt holds personal data in clear). */
function dropFiles(db: Db, stayId: string): void {
  for (const s of submissions(db, stayId)) {
    if (s.file && existsSync(s.file)) rmSync(s.file, { force: true });
  }
  db.prepare("UPDATE guest_submissions SET file = NULL WHERE stay_id = ?").run(stayId);
}

/**
 * Erase every personal datum of a stay: the guests, the sealed columns, the
 * check-in code and the files. What stays: id, listing, dates and the record of
 * the communications (without data), so the deadlines stay explainable.
 */
export function eraseStay(db: Db, stayId: string, now: Date, options: { keepIstat?: boolean } = {}): void {
  db.pragma("secure_delete = ON");
  db.transaction(() => {
    dropFiles(db, stayId);
    db.prepare("DELETE FROM guest_people WHERE stay_id = ?").run(stayId);
    db.prepare("UPDATE guest_stays SET channel_data = NULL, host_data = NULL, code = NULL, erased_at = ? WHERE id = ?").run(localDateTime(now), stayId);
    // Italy: the retention of Alloggiati Web keeps the Istat record (no name, no document) until the region has the month;
    // an erasure on request takes it too.
    if (!options.keepIstat && hasColumnOf(db, "guest_stays", "istat_data")) db.prepare("UPDATE guest_stays SET istat_data = NULL WHERE id = ?").run(stayId);
  })();
}

export function erasePerson(db: Db, personId: string): void {
  db.pragma("secure_delete = ON");
  db.prepare("DELETE FROM guest_people WHERE id = ?").run(personId);
}

/** Records of the SES test service (pre-ses): never a communication made, never a reason to erase. */
const isTestRecord = (r: SubmissionRow) => r.channel === "ses-prova";

/** A SES batch first taken ("sent") and later refused for this stay is not a communication made. */
const refusedLater = (rows: SubmissionRow[], r: SubmissionRow) =>
  r.channel.startsWith("ses-") && r.batch !== null && rows.some((y) => y.id > r.id && y.kind === r.kind && y.channel === r.channel && y.batch === r.batch && y.status === "rejected");

const asRecords = (rows: SubmissionRow[]): SubmissionRecord[] =>
  rows.filter((r) => r.kind !== "cancellation" && !isTestRecord(r) && !refusedLater(rows, r)).map((r) => ({ kind: r.kind as "reservation" | "checkin", status: r.status, at: r.at }));

/** The retention rule of each stay, from its country, the host's duty and the communications made. */
export function retentionOf(db: Db, row: StayRow, settings: GuestSettings) {
  return registryFor(settings.country).retention({ checkOut: row.check_out, cancelledAt: row.cancelled_at }, { professional: settings.professional }, asRecords(submissions(db, row.id)));
}

/**
 * Erase what the law no longer allows (or requires) to keep. Runs at every
 * `fairnight ospiti` command, at every sync and when the server starts.
 * Stays of listings without a fairguest block are left alone and reported.
 */
export function applyRetention(db: Db, config: HostConfig, now: Date): { erased: { id: string; reason: string }[]; orphans: string[] } {
  const out = { erased: [] as { id: string; reason: string }[], orphans: [] as string[] };
  if (!hasTable(db, "guest_stays")) return out;
  const at = localDateTime(now);
  const settings = new Map(guestListings(config.listings).map((l) => [l.name, l.fairguest]));
  for (const row of db.prepare(`SELECT ${STAY_COLUMNS} FROM guest_stays WHERE erased_at IS NULL`).all() as StayRow[]) {
    const s = settings.get(row.listing);
    if (!s) {
      out.orphans.push(row.id);
      continue;
    }
    const rule = retentionOf(db, row, s);
    if (rule.eraseFrom !== null && at >= rule.eraseFrom) {
      eraseStay(db, row.id, now, { keepIstat: true });
      out.erased.push({ id: row.id, reason: rule.reason });
    }
  }
  return out;
}

export interface DeadlineRow {
  stay: string;
  listing: string;
  country: Country;
  kind: SubmissionKind;
  due: string;
  from: string;
  state: "done" | "late" | "open";
  doneAt: string | null;
  checkIn: string;
  checkOut: string;
  guestsRegistered: number;
  /** Hours from now to the deadline; negative when late. */
  hoursLeft: number;
}

const DONE: SubmissionStatus[] = ["sent", "accepted"];

/**
 * Every communication each stay needs and whether it is done, from the clear
 * columns only: works on a read-only database and without the passphrase.
 */
export function guestDeadlines(db: Db, config: HostConfig, now: Date): DeadlineRow[] {
  if (!hasTable(db, "guest_stays")) return [];
  const at = localDateTime(now);
  const settings = new Map(guestListings(config.listings).map((l) => [l.name, l.fairguest]));
  const rows: DeadlineRow[] = [];
  for (const row of db.prepare(`SELECT ${BASE_COLUMNS} FROM guest_stays WHERE erased_at IS NULL ORDER BY check_in, id`).all() as StayRow[]) {
    const s = settings.get(row.listing);
    if (!s) continue;
    const subs = submissions(db, row.id);
    const doneAt = (kind: SubmissionKind) => subs.find((x) => x.kind === kind && DONE.includes(x.status) && !isTestRecord(x) && !refusedLater(subs, x))?.at ?? null;
    const base = { stay: row.id, listing: row.listing, country: s.country, checkIn: row.check_in, checkOut: row.check_out, guestsRegistered: peopleCount(db, row.id) };
    const push = (kind: SubmissionKind, due: string, from: string) => {
      const done = doneAt(kind);
      const hoursLeft = (Date.parse(`${due}:00Z`) - Date.parse(`${at}:00Z`)) / 3_600_000;
      rows.push({ ...base, kind, due, from, doneAt: done, state: done ? "done" : hoursLeft < 0 ? "late" : "open", hoursLeft: Math.round(hoursLeft * 10) / 10 });
    };
    if (row.cancelled_at) {
      // A cancelled booking needs a communication only if the reservation had been communicated.
      if (doneAt("reservation")) push("cancellation", addHours(row.cancelled_at, 24), `the cancellation (seen ${row.cancelled_at.replace("T", " ")})`);
      continue;
    }
    const input: DeadlineInput = { checkIn: row.check_in, checkOut: row.check_out, bookedAt: row.booked_at, seenAt: row.seen_at };
    if (s.checkInTime) input.checkInTime = s.checkInTime;
    if (s.checkOutTime) input.checkOutTime = s.checkOutTime;
    for (const d of registryFor(s.country).deadlines(input)) push(d.kind, d.due, d.from);
  }
  return rows.sort((a, b) => a.due.localeCompare(b.due) || a.stay.localeCompare(b.stay));
}
