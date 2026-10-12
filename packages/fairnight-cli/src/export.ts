/**
 * `fairnight export`: a CSV with date, price and minimum stay of every night
 * for sale, to upload by hand to a channel or a channel manager.
 *
 * Only the plain CSV format exists. Smoobu does not publish a CSV format for
 * importing rates (its "Import prices" tool reads from a connected channel),
 * so there is no Smoobu variant: see the README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatAmount } from "fairnight";
import type { PricingResult } from "fairnight";

export const EXPORT_FORMATS = ["csv"] as const;

/** RFC 4180 CSV (CRLF line ends), which spreadsheets and upload forms read everywhere. */
export function toCsv(result: PricingResult): string {
  const lines = ["date,price,min_stay"];
  for (const n of result.nights) {
    if (n.price === null || n.minStay === null) continue;
    lines.push(`${n.date},${formatAmount(n.price)},${n.minStay}`);
  }
  return lines.join("\r\n") + "\r\n";
}

/** Default file: <folder>/exports/<listing>-<today>.csv */
export function defaultExportPath(dir: string, listing: string, today: string): string {
  return path.join(dir, "exports", `${listing}-${today}.csv`);
}

export function writeExport(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}
