/**
 * Smoobu credentials: an API key and its secret (HMAC signing).
 *
 * 1. The environment variables SMOOBU_API_KEY and SMOOBU_API_SECRET, when both
 *    are set, win.
 * 2. Otherwise the file smoobu-credentials.json in the Fairnight folder, written
 *    by `fairnight smoobu collega`, readable only by the user where the system
 *    allows it.
 * Neither value is ever printed, not even shortened, not even in an error.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Credentials } from "fairnight-smoobu";
import { SetupError } from "./config.js";
import { stripBom } from "./io.js";

export const CREDENTIALS_FILE = "smoobu-credentials.json";

export function credentialsPath(dir: string): string {
  return path.join(dir, CREDENTIALS_FILE);
}

export type CredentialSource = "environment" | "file";

export function loadCredentials(dir: string, env: Record<string, string | undefined> = {}): { credentials: Credentials; source: CredentialSource } {
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
  let parsed: { apiKey?: unknown; apiSecret?: unknown };
  try {
    parsed = JSON.parse(stripBom(readFileSync(file, "utf8")));
  } catch {
    throw new SetupError(`${CREDENTIALS_FILE} cannot be read: run "fairnight smoobu collega" again.`);
  }
  if (typeof parsed.apiKey !== "string" || parsed.apiKey === "" || typeof parsed.apiSecret !== "string" || parsed.apiSecret === "") {
    throw new SetupError(`${CREDENTIALS_FILE} is incomplete: run "fairnight smoobu collega" again.`);
  }
  return { credentials: { apiKey: parsed.apiKey, apiSecret: parsed.apiSecret }, source: "file" };
}

/** Write the file and keep it to the current user: chmod 600, or an ACL on Windows. Returns how it was protected. */
export function saveCredentials(dir: string, credentials: Credentials, platform: NodeJS.Platform = process.platform): string {
  return writePrivateFile(credentialsPath(dir), { apiKey: credentials.apiKey, apiSecret: credentials.apiSecret }, platform);
}

/** Write a JSON file readable only by the current user where the system allows it. */
export function writePrivateFile(file: string, content: unknown, platform: NodeJS.Platform = process.platform): string {
  writeFileSync(file, JSON.stringify(content, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  if (platform === "win32") {
    try {
      const user = process.env.USERNAME;
      if (!user) throw new Error("no USERNAME");
      // Remove inherited permissions and give access to this user only.
      execFileSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:F`], { stdio: "ignore", windowsHide: true });
      return "readable only by your Windows user";
    } catch {
      return "saved with the folder's normal Windows permissions (could not restrict them further)";
    }
  }
  chmodSync(file, 0o600);
  return "readable only by you (permissions 600)";
}
