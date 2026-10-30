/**
 * Beds24 credentials: a refresh token, and the short token it last produced.
 *
 * 1. The environment variable BEDS24_REFRESH_TOKEN, when set, wins.
 * 2. Otherwise the file beds24-credentials.json in the Fairnight folder, written
 *    by `fairnight beds24 collega`, readable only by the user. Sealed when the
 *    host turned on `fairnight chiavi cifra` (chiavi.ts).
 * The short token is kept in the same file with its expiry, so a command does
 * not spend credits on a new token while the old one still works. It is only
 * reused with the refresh token that produced it.
 * No token is ever printed, not even shortened, not even in an error.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Beds24Token } from "fairnight-beds24";
import { isSealed, KeysError, openSealed, writeCredentialsFile } from "./chiavi.js";
import { SetupError } from "./config.js";
import { stripBom, type Io } from "./io.js";

export const BEDS24_CREDENTIALS_FILE = "beds24-credentials.json";

export function beds24CredentialsPath(dir: string): string {
  return path.join(dir, BEDS24_CREDENTIALS_FILE);
}

interface FileContent {
  refreshToken?: string;
  cachedToken?: Beds24Token & { for: string };
}

/** Which refresh token a cached short token belongs to, without storing it twice. */
const fingerprint = (refreshToken: string) => createHash("sha256").update(refreshToken).digest("hex").slice(0, 16);

function readRaw(dir: string): unknown {
  const file = beds24CredentialsPath(dir);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(stripBom(readFileSync(file, "utf8")));
  } catch {
    throw new SetupError(`${BEDS24_CREDENTIALS_FILE} cannot be read: run "fairnight beds24 collega" again.`);
  }
}

function readFile(dir: string, io: Io): FileContent | null {
  const raw = readRaw(dir);
  return isSealed(raw) ? openSealed<FileContent>(dir, BEDS24_CREDENTIALS_FILE, raw, io) : (raw as FileContent | null);
}

export interface Beds24Credentials {
  refreshToken: string;
  source: "environment" | "file";
  cachedToken: Beds24Token | null;
}

export function loadBeds24Credentials(dir: string, env: Record<string, string | undefined> = {}, io: Io | Pick<Io, "env"> = { env }): Beds24Credentials {
  const fromEnv = env.BEDS24_REFRESH_TOKEN?.trim();
  // A token from the environment needs no passphrase: the sealed file stays closed.
  const content = fromEnv && isSealed(readRaw(dir)) ? null : readFile(dir, io as Io);
  const refreshToken = fromEnv || content?.refreshToken;
  if (!refreshToken) {
    throw new SetupError('No Beds24 credentials yet: run "fairnight beds24 collega" (or set BEDS24_REFRESH_TOKEN).');
  }
  const cached = content?.cachedToken;
  return {
    refreshToken,
    source: fromEnv ? "environment" : "file",
    cachedToken: cached && cached.for === fingerprint(refreshToken) && cached.token && cached.expiresAt ? { token: cached.token, expiresAt: cached.expiresAt } : null,
  };
}

/** Save the refresh token from `collega`, with its first short token. */
export function saveBeds24Credentials(dir: string, refreshToken: string, token: Beds24Token): string {
  return writeCredentialsFile(dir, BEDS24_CREDENTIALS_FILE, { refreshToken, cachedToken: { ...token, for: fingerprint(refreshToken) } });
}

/** Keep a newly issued short token for the next commands. */
export function saveBeds24Token(dir: string, refreshToken: string, token: Beds24Token, io: Io | Pick<Io, "env"> = {}): void {
  try {
    const content = readFile(dir, io as Io) ?? {};
    writeCredentialsFile(dir, BEDS24_CREDENTIALS_FILE, { ...content, cachedToken: { ...token, for: fingerprint(refreshToken) } });
  } catch (e) {
    if (!(e instanceof KeysError)) throw e; // a closed file: the short token is only a saving, and is never left in clear
  }
}
