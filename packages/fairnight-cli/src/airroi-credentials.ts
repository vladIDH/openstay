/**
 * The host's own AirROI API key. Fairnight has no key of its own.
 *
 * 1. The environment variable AIRROI_API_KEY, when set, wins.
 * 2. Otherwise the file airroi-credentials.json in the Fairnight folder, written
 *    by `fairnight mercato collega`, readable only by the user where the system
 *    allows it.
 * The key is sent only to AirROI, and never printed, not even shortened, not
 * even in an error.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SetupError } from "./config.js";
import { writePrivateFile } from "./credentials.js";
import { stripBom } from "./io.js";

export const AIRROI_CREDENTIALS_FILE = "airroi-credentials.json";

export function airroiCredentialsPath(dir: string): string {
  return path.join(dir, AIRROI_CREDENTIALS_FILE);
}

export type AirRoiKeySource = "environment" | "file";

/** Where the key would come from, without reading it out: for `mercato stato`. */
export function airroiKeySource(dir: string, env: Record<string, string | undefined> = {}): AirRoiKeySource | null {
  if (env.AIRROI_API_KEY?.trim()) return "environment";
  return existsSync(airroiCredentialsPath(dir)) ? "file" : null;
}

export function loadAirRoiKey(dir: string, env: Record<string, string | undefined> = {}): { apiKey: string; source: AirRoiKeySource } {
  const fromEnv = env.AIRROI_API_KEY?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: "environment" };
  const file = airroiCredentialsPath(dir);
  if (!existsSync(file)) throw new SetupError('No AirROI key yet: run "fairnight mercato collega" (or set AIRROI_API_KEY).');
  let parsed: { apiKey?: unknown };
  try {
    parsed = JSON.parse(stripBom(readFileSync(file, "utf8")));
  } catch {
    throw new SetupError(`${AIRROI_CREDENTIALS_FILE} cannot be read: run "fairnight mercato collega" again.`);
  }
  if (typeof parsed.apiKey !== "string" || parsed.apiKey === "") {
    throw new SetupError(`${AIRROI_CREDENTIALS_FILE} is incomplete: run "fairnight mercato collega" again.`);
  }
  return { apiKey: parsed.apiKey, source: "file" };
}

export function saveAirRoiKey(dir: string, apiKey: string, platform: NodeJS.Platform = process.platform): string {
  return writePrivateFile(airroiCredentialsPath(dir), { apiKey }, platform);
}
