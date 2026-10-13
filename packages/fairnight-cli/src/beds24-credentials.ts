/**
 * Beds24 credentials: a refresh token, and the short token it last produced.
 *
 * 1. The environment variable BEDS24_REFRESH_TOKEN, when set, wins.
 * 2. Otherwise the file beds24-credentials.json in the Fairnight folder, written
 *    by `fairnight beds24 collega`, readable only by the user.
 * The short token is kept in the same file with its expiry, so a command does
 * not spend credits on a new token while the old one still works. It is only
 * reused with the refresh token that produced it.
 * No token is ever printed, not even shortened, not even in an error.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Beds24Token } from "fairnight-beds24";
import { SetupError } from "./config.js";
import { writePrivateFile } from "./credentials.js";
import { stripBom } from "./io.js";

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

function readFile(dir: string): FileContent | null {
  const file = beds24CredentialsPath(dir);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(stripBom(readFileSync(file, "utf8"))) as FileContent;
  } catch {
    throw new SetupError(`${BEDS24_CREDENTIALS_FILE} cannot be read: run "fairnight beds24 collega" again.`);
  }
}

export interface Beds24Credentials {
  refreshToken: string;
  source: "environment" | "file";
  cachedToken: Beds24Token | null;
}

export function loadBeds24Credentials(dir: string, env: Record<string, string | undefined> = {}): Beds24Credentials {
  const content = readFile(dir);
  const fromEnv = env.BEDS24_REFRESH_TOKEN?.trim();
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
  return writePrivateFile(beds24CredentialsPath(dir), { refreshToken, cachedToken: { ...token, for: fingerprint(refreshToken) } });
}

/** Keep a newly issued short token for the next commands. */
export function saveBeds24Token(dir: string, refreshToken: string, token: Beds24Token): void {
  const content = readFile(dir) ?? {};
  writePrivateFile(beds24CredentialsPath(dir), { ...content, cachedToken: { ...token, for: fingerprint(refreshToken) } });
}
