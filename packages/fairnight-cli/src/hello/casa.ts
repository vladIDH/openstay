/**
 * `fairnight risposte casa`: writes casa/<listing>.md from a few questions,
 * in the language of the calendar page. The host can change the file later
 * with any text editor; this command never overwrites it.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findPrices, parseHouse } from "fairhello";
import { loadHostConfig, selectListings, SetupError } from "../config.js";
import type { Io } from "../io.js";
import { housePath } from "./settings.js";
import { HELLO_WORDS } from "./texts.js";

export async function guidedHouse(dir: string, io: Io, listingName: string | undefined): Promise<number> {
  const config = loadHostConfig(dir);
  const w = HELLO_WORDS[config.language ?? "en"].house;
  if (!io.prompt) throw new SetupError("The house file is written with questions: run the command in a terminal, or write casa/<listing>.md by hand.");
  const listings = selectListings(config, listingName);
  if (listings.length > 1) throw new SetupError(`Which listing? Add --listing (${listings.map((l) => l.name).join(", ")}).`);
  const listing = listings[0];
  if (!listing) throw new SetupError("No listing in fairnight.config.json.");
  const file = housePath(dir, listing.name);
  const shown = path.relative(dir, file);
  if (existsSync(file)) {
    io.out(w.exists(shown));
    return 1;
  }
  io.out(w.intro);
  const ask = async (q: string) => (await io.prompt?.(q, { hidden: false }))?.trim() ?? "";
  const title = (await ask(w.titleAsk)) || listing.pricing.name || listing.name;
  const parts = [`# ${title}`, ""];
  for (const q of w.questions) {
    const answer = await ask(q.ask);
    if (answer) parts.push(`## ${q.heading}`, answer, "");
  }
  const codes = await ask(w.codesAsk);
  if (codes) {
    parts.push(
      "<!-- Given to the guest only from the day of check-in to the day of check-out (and after the guest registration, if you use it). -->",
      `## ${w.codesHeading}`,
      codes,
      "",
    );
  }
  const text = parts.join("\n");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
  io.out(w.written(shown));
  for (const warning of parseHouse(text).warnings) {
    if (warning.kind === "prices") io.out(`Note: "${warning.heading}" contains ${findPrices(text).join(", ")}. The assistant never writes prices: better to take them out.`);
  }
  return 0;
}
