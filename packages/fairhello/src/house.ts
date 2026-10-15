/**
 * The house file: casa/<listing>.md, written by the host (by hand or with
 * `fairnight risposte casa`). Plain Markdown:
 *
 *   # Seaview Loft
 *   ## Check-in
 *   From 16:00. The keys are in the key box by the door.
 *   ## Wifi
 *   Network "Loft". The password is on the router.
 *   ## Access codes
 *   Key box: 1234
 *
 * - Every "## " heading starts a section the assistant may use.
 * - The access codes section (Codici / Códigos / Access codes) is kept apart:
 *   it goes into a request only during the stay (see codesState in prompt.ts).
 * - HTML comments (<!-- … -->) are notes for the host, never read.
 * - Prices do not belong here: the assistant never writes them. They are
 *   reported as a warning so the host can take them out.
 */
import { findPrices } from "./text.js";

export interface HouseSection {
  heading: string;
  text: string;
}

export type HouseWarning = { kind: "prices"; heading: string; found: string[] } | { kind: "empty" } | { kind: "codes-twice" };

export interface House {
  title: string | null;
  sections: HouseSection[];
  /** The access codes, or null when the file has none. */
  codes: string | null;
  warnings: HouseWarning[];
}

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "Codici", "Codici d'accesso", "Códigos de acceso", "Access codes", "Door codes"… */
export function isCodesHeading(heading: string): boolean {
  const h = plain(heading);
  return /^(?:(?:codici|codice|codigos|codigo|codes|code)(?: (?:d accesso|di accesso|d ingresso|de acceso|de entrada))?|(?:access|door|entry|key|key box|keybox) codes?)$/.test(h);
}

export function parseHouse(markdown: string): House {
  const text = (markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown).replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n");
  let title: string | null = null;
  const sections: HouseSection[] = [];
  let codes: string | null = null;
  const warnings: HouseWarning[] = [];
  let current: HouseSection = { heading: "", text: "" };
  const flush = () => {
    const body = current.text.trim();
    if (isCodesHeading(current.heading)) {
      if (body) {
        if (codes !== null) warnings.push({ kind: "codes-twice" });
        codes = codes === null ? body : `${codes}\n${body}`;
      }
    } else if (body) sections.push({ heading: current.heading, text: body });
  };
  for (const line of text.split("\n")) {
    const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    const h2 = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h1 && title === null && sections.length === 0 && current.text.trim() === "") {
      title = h1[1] as string;
      continue;
    }
    if (h2) {
      flush();
      current = { heading: h2[1] as string, text: "" };
      continue;
    }
    current.text += `${line}\n`;
  }
  flush();
  for (const s of sections) {
    const found = findPrices(s.text);
    if (found.length > 0) warnings.push({ kind: "prices", heading: s.heading, found });
  }
  if (sections.length === 0) warnings.push({ kind: "empty" });
  return { title, sections, codes, warnings };
}

/** The sections as one text for the request (never the codes). */
export function houseText(house: House): string {
  return house.sections.map((s) => (s.heading ? `## ${s.heading}\n${s.text}` : s.text)).join("\n\n");
}
