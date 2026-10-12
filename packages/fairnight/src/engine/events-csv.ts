/**
 * Parser for the host's events file: one event per line, three columns.
 *
 *   date,name,impact
 *   2026-12-31,New Year's Eve,5
 *
 * Takes the TEXT of the file (reading the file is the caller's job). Accepts a
 * header line or none, comma or semicolon separators, and quoted names
 * ("Fiesta, big one"). Bad lines are reported with their line number and
 * never stop the good ones from being read.
 */
import { isIsoDate } from "./dates.js";
import type { HostEvent, Impact } from "./types.js";

export interface EventsCsvIssue {
  line: number;
  message: string;
}

export interface EventsCsvResult {
  events: HostEvent[];
  issues: EventsCsvIssue[];
}

/** Split one CSV line, honouring double quotes ("" inside quotes is a quote). */
export function splitCsvLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === separator) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

export function parseEventsCsv(text: string): EventsCsvResult {
  const events: HostEvent[] = [];
  const issues: EventsCsvIssue[] = [];
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // drop a byte-order mark
  const lines = body.split(/\r?\n/);
  let headerChecked = false;

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    if (raw.trim() === "") return;
    const separator = raw.includes(";") && !raw.includes(",") ? ";" : ",";
    const cells = splitCsvLine(raw, separator);

    if (!headerChecked) {
      headerChecked = true;
      if (!isIsoDate(cells[0])) {
        const looksLikeHeader = /^(date|data|fecha)$/i.test(cells[0] ?? "");
        if (looksLikeHeader) return;
      }
    }

    if (cells.length !== 3) {
      issues.push({ line: lineNo, message: `expected 3 columns (date, name, impact), found ${cells.length}` });
      return;
    }
    const [date, name, impactText] = cells as [string, string, string];
    if (!isIsoDate(date)) {
      issues.push({ line: lineNo, message: `"${date}" is not a date like 2026-12-31` });
      return;
    }
    if (name === "") {
      issues.push({ line: lineNo, message: "the event name is empty" });
      return;
    }
    const impact = Number(impactText);
    if (!Number.isInteger(impact) || impact < 1 || impact > 5) {
      issues.push({ line: lineNo, message: `impact must be a whole number from 1 to 5, got "${impactText}"` });
      return;
    }
    events.push({ date, name, impact: impact as Impact });
  });

  return { events, issues };
}
