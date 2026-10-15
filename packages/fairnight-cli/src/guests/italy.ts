/**
 * Fairguest in Italy on the host's computer: the Alloggiati Web code tables,
 * the account credentials (sealed, never in clear), the receipts.
 *
 * - The tables come from the public page of the portal and are kept in
 *   data/fairguest/alloggiati/, never in the repository.
 * - Utente, password and the web-service key are sealed for the host's public
 *   key in the meta table, one entry per account: reading them needs the
 *   passphrase, like the guests' data.
 * - The receipts (one PDF per account and day) go to data/fairguest/ricevute/
 *   and are deleted after 5 years.
 */
import type { KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  addYears,
  ALLOGGIATI_SERVICE_URL,
  ALLOGGIATI_TABLE_URLS,
  AlloggiatiClient,
  localDateTime,
  open,
  parseAlloggiatiTables,
  publicKeyOf,
  RECEIPT_YEARS,
  seal,
  type AlloggiatiCredentials,
  type AlloggiatiTables,
  type Transport,
} from "fairguest";
import { getMeta, setMeta, type Db } from "../db.js";
import { DATA_DIR, type Io } from "../io.js";
import { hasTable, readKeys } from "./store.js";

const TABLE_FILES = { municipalities: "comuni.csv", states: "stati.csv", documents: "documenti.csv" } as const;
const TABLES_AT = "fairguest_alloggiati_tables_at";
/** Tables older than this are downloaded again before sending: municipalities change. */
export const TABLES_MAX_DAYS = 30;

export const tablesDir = (dir: string) => path.join(dir, DATA_DIR, "fairguest", "alloggiati");
export const receiptsDir = (dir: string) => path.join(dir, DATA_DIR, "fairguest", "ricevute");

/** Download the three public tables, check them, and save them. */
export async function downloadTables(dir: string, db: Db, io: Io): Promise<AlloggiatiTables> {
  const urls = io.alloggiatiTableUrls ?? ALLOGGIATI_TABLE_URLS;
  const text: Record<keyof typeof TABLE_FILES, string> = { municipalities: "", states: "", documents: "" };
  for (const key of Object.keys(TABLE_FILES) as (keyof typeof TABLE_FILES)[]) {
    const res = await io.fetch(urls[key], { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`The Alloggiati Web table ${TABLE_FILES[key]} could not be downloaded (HTTP ${res.status}).`);
    text[key] = await res.text();
  }
  const tables = parseAlloggiatiTables(text);
  const folder = tablesDir(dir);
  mkdirSync(folder, { recursive: true });
  for (const key of Object.keys(TABLE_FILES) as (keyof typeof TABLE_FILES)[]) writeFileSync(path.join(folder, TABLE_FILES[key]), text[key]);
  setMeta(db, TABLES_AT, localDateTime(io.now()));
  return tables;
}

/** The saved tables and the day they were downloaded, or null. */
export function loadTables(dir: string, db: Db): { tables: AlloggiatiTables; at: string } | null {
  const folder = tablesDir(dir);
  const at = hasTable(db, "meta") ? getMeta(db, TABLES_AT) : null;
  if (!at || !Object.values(TABLE_FILES).every((f) => existsSync(path.join(folder, f)))) return null;
  const read = (f: string) => readFileSync(path.join(folder, f), "utf8");
  return { tables: parseAlloggiatiTables({ municipalities: read(TABLE_FILES.municipalities), states: read(TABLE_FILES.states), documents: read(TABLE_FILES.documents) }), at };
}

const credentialsKey = (account: string) => `fairguest_alloggiati_${account}`;
const credentialsPlace = (account: string) => `meta/alloggiati/${account}`;

export function saveCredentials(db: Db, account: string, credentials: AlloggiatiCredentials): void {
  const record = readKeys(db);
  if (!record) throw new Error('Fairguest is not set up in this folder: run "fairnight ospiti attiva" first.');
  setMeta(db, credentialsKey(account), seal(publicKeyOf(record), credentials, credentialsPlace(account)));
}

export const hasCredentials = (db: Db, account: string): boolean => getMeta(db, credentialsKey(account)) !== null;

export function loadCredentials(db: Db, account: string, key: KeyObject): AlloggiatiCredentials | null {
  const sealed = getMeta(db, credentialsKey(account));
  return sealed ? open<AlloggiatiCredentials>(key, sealed, credentialsPlace(account)) : null;
}

/** The SOAP calls go through this; tests pass a fake service. */
export function alloggiatiClient(io: Io): AlloggiatiClient {
  const doFetch = io.alloggiatiFetch ?? ((url, init) => fetch(url, init));
  const transport: Transport = async (req) => {
    const res = await doFetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(60_000) });
    return { status: res.status, body: await res.text() };
  };
  return new AlloggiatiClient(transport, io.alloggiatiUrl ?? ALLOGGIATI_SERVICE_URL);
}

export interface ReceiptRow {
  account: string;
  day: string;
  file: string;
  fetched_at: string;
}

export const receipts = (db: Db): ReceiptRow[] =>
  hasTable(db, "guest_receipts") ? (db.prepare("SELECT account, day, file, fetched_at FROM guest_receipts ORDER BY day, account").all() as ReceiptRow[]) : [];

export function saveReceipt(dir: string, db: Db, account: string, day: string, pdf: Uint8Array, now: Date): string {
  const folder = receiptsDir(dir);
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `alloggiati-${account}-${day}.pdf`);
  writeFileSync(file, pdf);
  db.prepare("INSERT INTO guest_receipts (account, day, file, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT (account, day) DO UPDATE SET file = excluded.file, fetched_at = excluded.fetched_at").run(
    account,
    day,
    file,
    localDateTime(now),
  );
  return file;
}

/** Receipts are kept 5 years (DM 7/1/2013, art. 4-bis), then deleted. */
export function dropOldReceipts(db: Db, now: Date): string[] {
  const today = localDateTime(now).slice(0, 10);
  const dropped: string[] = [];
  for (const r of receipts(db)) {
    if (addYears(r.day, RECEIPT_YEARS) > today) continue;
    rmSync(r.file, { force: true });
    db.prepare("DELETE FROM guest_receipts WHERE account = ? AND day = ?").run(r.account, r.day);
    dropped.push(`${r.account} ${r.day}`);
  }
  return dropped;
}
