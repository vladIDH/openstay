/**
 * Everything the commands need from the outside world, passed in explicitly so
 * tests can run them with a fake network, a fixed clock and captured output.
 */
import path from "node:path";

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
}

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
