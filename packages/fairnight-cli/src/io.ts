/**
 * Everything the commands need from the outside world, passed in explicitly so
 * tests can run them with a fake network, a fixed clock and captured output.
 */
import path from "node:path";
import type { ScryptParams } from "fairguest";

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface Io {
  /** Folder the commands work in, unless --dir says otherwise. */
  cwd: string;
  out(line: string): void;
  err(line: string): void;
  fetch: FetchLike;
  now(): Date;
  /** Environment variables (SMOOBU_API_KEY, SMOOBU_API_SECRET, BEDS24_REFRESH_TOKEN, AIRROI_API_KEY). Default: none. */
  env?: Record<string, string | undefined>;
  /** The language of this computer, like "it-IT" (only for tests). Default: from LANG or the system. */
  locale?: string;
  /** Ask the user for a line of text; with hidden, nothing typed is shown. */
  prompt?(question: string, options: { hidden: boolean }): Promise<string>;
  /** Network access for the Smoobu API (method, headers, body). Default: global fetch. */
  smoobuFetch?: SmoobuFetchLike;
  /** Only for tests: a fake Smoobu server instead of https://login.smoobu.com. */
  smoobuBaseUrl?: string;
  /** Network access for the Beds24 API. Default: global fetch. */
  beds24Fetch?: SmoobuFetchLike;
  /** Only for tests: a fake Beds24 server instead of https://beds24.com/api/v2. */
  beds24BaseUrl?: string;
  /** Network access for the AirROI API. Default: global fetch. */
  airroiFetch?: SmoobuFetchLike;
  /** Only for tests: a fake AirROI server instead of https://api.airroi.com. */
  airroiBaseUrl?: string;
  /** Network access for the Alloggiati Web service (Italy). Default: global fetch. */
  alloggiatiFetch?: SmoobuFetchLike;
  /** Only for tests: a fake Alloggiati Web service instead of the Polizia di Stato's. */
  alloggiatiUrl?: string;
  /** Only for tests: where the Alloggiati Web code tables are downloaded from (file name → URL). */
  alloggiatiTableUrls?: { municipalities: string; states: string; documents: string };
  /** Network access for the relay of the guests' check-in link. Default: global fetch. */
  relayFetch?: RelayFetchLike;
  /** Open a link in the default browser (`fairnight apri`). Default: nothing is opened. */
  openUrl?(url: string): void;
  /** Waiting (rate limits, retries). Default: real time. */
  sleep?(ms: number): Promise<void>;
  /** Only for tests: a cheaper scrypt for the Fairguest passphrase. */
  scryptCost?: ScryptParams;
}

export type RelayFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

export type SmoobuFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export const CONFIG_FILE = "fairnight.config.json";
export const DATA_DIR = "data";
export const DB_FILE = "fairnight.db";

export function configPath(dir: string): string {
  return path.join(dir, CONFIG_FILE);
}

export function dbPath(dir: string): string {
  return path.join(dir, DATA_DIR, DB_FILE);
}

/** Today's date on the host's machine (local time), as YYYY-MM-DD. */
export function localToday(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Read a text file, dropping a byte-order mark if there is one. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
