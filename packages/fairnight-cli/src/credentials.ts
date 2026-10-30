/**
 * Smoobu credentials: an API key and its secret (HMAC signing).
 *
 * 1. The environment variables SMOOBU_API_KEY and SMOOBU_API_SECRET, when both
 *    are set, win.
 * 2. Otherwise the file smoobu-credentials.json in the Fairnight folder, written
 *    by `fairnight smoobu collega`, readable only by the user where the system
 *    allows it. Sealed when the host turned on `fairnight chiavi cifra` (chiavi.ts).
 * Neither value is ever printed, not even shortened, not even in an error.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Credentials } from "fairnight-smoobu";
import { isSealed, openSealed, writeCredentialsFile } from "./chiavi.js";
import { SetupError } from "./config.js";
import { stripBom, type Io } from "./io.js";
import { writePrivateFile } from "./private-file.js";

export { writePrivateFile };

export const CREDENTIALS_FILE = "smoobu-credentials.json";

export function credentialsPath(dir: string): string {
  return path.join(dir, CREDENTIALS_FILE);
}

export type CredentialSource = "environment" | "file";

export function loadCredentials(dir: string, env: Record<string, string | undefined> = {}, io: Io | Pick<Io, "env"> = { env }): { credentials: Credentials; source: CredentialSource } {
  const key = env.SMOOBU_API_KEY?.trim();
  const secret = env.SMOOBU_API_SECRET?.trim();
  if (key && secret) return { credentials: { apiKey: key, apiSecret: secret }, source: "environment" };
  if (key || secret) {
    throw new SetupError("Only one of SMOOBU_API_KEY and SMOOBU_API_SECRET is set: set both, or neither to use the saved credentials.");
  }
  const file = credentialsPath(dir);
  if (!existsSync(file)) {
    throw new SetupError('No Smoobu credentials yet: run "fairnight smoobu collega" (or set SMOOBU_API_KEY and SMOOBU_API_SECRET).');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(readFileSync(file, "utf8")));
  } catch {
    throw new SetupError(`${CREDENTIALS_FILE} cannot be read: run "fairnight smoobu collega" again.`);
  }
  const parsed = (isSealed(raw) ? openSealed(dir, CREDENTIALS_FILE, raw, io as Io) : raw) as { apiKey?: unknown; apiSecret?: unknown };
  if (typeof parsed.apiKey !== "string" || parsed.apiKey === "" || typeof parsed.apiSecret !== "string" || parsed.apiSecret === "") {
    throw new SetupError(`${CREDENTIALS_FILE} is incomplete: run "fairnight smoobu collega" again.`);
  }
  return { credentials: { apiKey: parsed.apiKey, apiSecret: parsed.apiSecret }, source: "file" };
}

/** Write the file and keep it to the current user: chmod 600, or an ACL on Windows. Returns how it was protected. */
export function saveCredentials(dir: string, credentials: Credentials, platform: NodeJS.Platform = process.platform): string {
  return writeCredentialsFile(dir, CREDENTIALS_FILE, { apiKey: credentials.apiKey, apiSecret: credentials.apiSecret }, platform);
}
