/**
 * `fairnight import <file.csv> --listing <name>`: store past nightly prices.
 * Importing the same file twice changes nothing; a newer file replaces the
 * price of the nights it contains.
 */
import path from "node:path";
import type { Db } from "./db.js";
import { parsePricesCsv, type PriceIssue } from "./prices-csv.js";

export interface ImportReport {
  listing: string;
  file: string;
  imported: number;
  issues: PriceIssue[];
  first: string | null;
  last: string | null;
  dryRun: boolean;
}

export function importPrices(
  db: Db,
  listing: string,
  file: string,
  text: string,
  opts: { now: Date; dryRun?: boolean },
): ImportReport {
  const parsed = parsePricesCsv(text);
  const dates = parsed.rows.map((r) => r.date).sort();
  const report: ImportReport = {
    listing,
    file: path.basename(file),
    imported: parsed.rows.length,
    issues: parsed.issues,
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    dryRun: opts.dryRun ?? false,
  };
  if (report.dryRun || parsed.rows.length === 0) return report;

  const upsert = db.prepare(
    `INSERT INTO price_history (listing, date, price, source, imported_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (listing, date) DO UPDATE SET price = excluded.price, source = excluded.source, imported_at = excluded.imported_at`,
  );
  const at = opts.now.toISOString();
  db.transaction(() => {
    for (const row of parsed.rows) upsert.run(listing, row.date, row.price, report.file, at);
  })();
  return report;
}
