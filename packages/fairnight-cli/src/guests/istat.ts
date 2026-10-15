/**
 * Istat in Italy on the host's computer: the guests' statistical records kept
 * sealed (no name, no document), the days sent to ROSS1000, the credentials,
 * and the files of the regions without a service.
 *
 * The record of a stay is taken while its guests' data is still there (when
 * Alloggiati Web accepts the schedine, or at `fairnight ospiti istat`), so the
 * Alloggiati Web erasure does not lose what Istat still needs. It goes away
 * when the region has the month: for ROSS1000 once both the arrival and the
 * departure day were accepted, otherwise from the 16th of the month after
 * check-out (the deadlines are by the 5th–10th).
 */
import type { KeyObject } from "node:crypto";
import {
  addDays,
  istatStay,
  ISTAT_REGIONS,
  localDateTime,
  open,
  publicKeyOf,
  Ross1000Client,
  seal,
  type AlloggiatiTables,
  type IstatStay,
  type Transport,
} from "fairguest";
import type { HostConfig } from "../config.js";
import { getMeta, setMeta, type Db } from "../db.js";
import type { Io } from "../io.js";
import { hasTable, readKeys, type OpenedStay, type StayRow } from "./store.js";

const istatPlace = (stayId: string) => `guest_stays/${stayId}/istat`;

export function writeIstat(db: Db, stayId: string, record: IstatStay): void {
  const keys = readKeys(db);
  if (!keys) throw new Error("Fairguest is not set up in this folder.");
  db.prepare("UPDATE guest_stays SET istat_data = ? WHERE id = ?").run(seal(publicKeyOf(keys), record, istatPlace(stayId)), stayId);
}

export function readIstat(db: Db, stayId: string, key: KeyObject): IstatStay | null {
  const row = db.prepare("SELECT istat_data FROM guest_stays WHERE id = ?").get(stayId) as { istat_data: string | null } | undefined;
  return row?.istat_data ? open<IstatStay>(key, row.istat_data, istatPlace(stayId)) : null;
}

/** The record of an opened stay, kept sealed; problems when something it needs is missing. */
export function keepIstat(db: Db, o: OpenedStay, tables: AlloggiatiTables): string[] {
  const r = istatStay(o.stay, tables);
  if (r.record) writeIstat(db, o.stay.id, r.record);
  return r.problems.map((p) => `${p.path}: ${p.message}`);
}

export function acceptedDays(db: Db, listing: string): Set<string> {
  if (!hasTable(db, "guest_istat_days")) return new Set();
  return new Set((db.prepare("SELECT day FROM guest_istat_days WHERE listing = ? AND status = 'accepted'").all(listing) as { day: string }[]).map((r) => r.day));
}

export function recordIstatDay(db: Db, listing: string, day: string, ok: boolean, at: string, detail: string | null): void {
  db.prepare(
    "INSERT INTO guest_istat_days (listing, day, status, at, detail) VALUES (?, ?, ?, ?, ?) ON CONFLICT (listing, day) DO UPDATE SET status = excluded.status, at = excluded.at, detail = excluded.detail",
  ).run(listing, day, ok ? "accepted" : "rejected", at, detail);
}

/** The 16th of the month after a day. */
const sixteenthAfter = (day: string) => `${addDays(`${day.slice(0, 7)}-28`, 4).slice(0, 7)}-16`;

/** Erase the Istat records the region no longer needs. Runs with the other retention rules. */
export function applyIstatRetention(db: Db, config: HostConfig, now: Date): number {
  if (!hasTable(db, "guest_istat_days")) return 0;
  const today = localDateTime(now).slice(0, 10);
  let erased = 0;
  for (const row of db.prepare("SELECT id, listing, check_in, check_out FROM guest_stays WHERE istat_data IS NOT NULL").all() as StayRow[]) {
    const s = config.listings.find((l) => l.name === row.listing)?.fairguest;
    const region = s?.istat ? ISTAT_REGIONS[s.istat.region] : null;
    const days = acceptedDays(db, row.listing);
    const sent = region?.mode === "ross1000" && days.has(row.check_in) && days.has(row.check_out);
    if (sent || today >= sixteenthAfter(row.check_out)) {
      db.prepare("UPDATE guest_stays SET istat_data = NULL WHERE id = ?").run(row.id);
      erased++;
    }
  }
  return erased;
}

const credentialsKey = (account: string) => `fairguest_istat_${account}`;
const credentialsPlace = (account: string) => `meta/istat/${account}`;

export function saveIstatCredentials(db: Db, account: string, c: { user: string; password: string }): void {
  const keys = readKeys(db);
  if (!keys) throw new Error("Fairguest is not set up in this folder.");
  setMeta(db, credentialsKey(account), seal(publicKeyOf(keys), c, credentialsPlace(account)));
}

export function loadIstatCredentials(db: Db, account: string, key: KeyObject): { user: string; password: string } | null {
  const sealed = getMeta(db, credentialsKey(account));
  return sealed ? open<{ user: string; password: string }>(key, sealed, credentialsPlace(account)) : null;
}

export function rossClient(io: Io, endpoint: string): Ross1000Client {
  const doFetch = io.istatFetch ?? ((url, init) => fetch(url, init));
  const transport: Transport = async (req) => {
    const res = await doFetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(120_000) });
    return { status: res.status, body: await res.text() };
  };
  return new Ross1000Client(transport, io.istatUrl ?? endpoint);
}

/** Days of the owner's blocks (closed), from the calendars: the structure is "NO" those days. */
export function blockedDays(db: Db, listing: string, from: string, to: string): Set<string> {
  const out = new Set<string>();
  const rows = db
    .prepare("SELECT check_in, check_out FROM calendar_events WHERE listing = ? AND kind = 'blocked' AND removed_at IS NULL AND check_out > ? AND check_in <= ?")
    .all(listing, from, to) as { check_in: string; check_out: string }[];
  for (const r of rows) for (let d = r.check_in < from ? from : r.check_in; d < r.check_out && d <= to; d = addDays(d, 1)) out.add(d);
  return out;
}
