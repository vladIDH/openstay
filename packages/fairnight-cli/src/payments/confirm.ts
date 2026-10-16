/**
 * The host checked a point of the starting values with the town: write
 * "confirmed": true in the touristTax block of every listing of that place,
 * so the point is no longer flagged. A copy of the config is kept (.bak),
 * like when the base price is changed from the page.
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { SetupError, validateHostConfig } from "../config.js";
import { readRawConfig } from "../configura.js";
import { CONFIG_FILE, configPath } from "../io.js";

/** Returns the listings changed. */
export function confirmTaxPlace(dir: string, place: string): string[] {
  const raw = readRawConfig(dir);
  if (raw === null) throw new SetupError(`No ${CONFIG_FILE} in ${dir}.`);
  const changed: string[] = [];
  for (const l of (raw.listings as Record<string, unknown>[] | undefined) ?? []) {
    const tax = (l.fairguest as Record<string, unknown> | undefined)?.touristTax as Record<string, unknown> | undefined;
    if (tax?.place !== place || tax.confirmed === true) continue;
    tax.confirmed = true;
    changed.push(String(l.name));
  }
  if (changed.length === 0) return changed;
  const checked = validateHostConfig(raw);
  if (!checked.ok) throw new SetupError(`The config does not take it: ${checked.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
  const file = configPath(dir);
  copyFileSync(file, `${file}.bak`);
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n", "utf8");
  return changed;
}
