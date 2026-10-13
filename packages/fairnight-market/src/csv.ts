/**
 * The generic zone file, for hosts who have zone figures from any source they
 * are allowed to use (their own research, a tourism office, a paid report…):
 *
 *   date,occupancy,average_price,comparables
 *   2026-11-01,72,118,40
 *   2026-11-02,65%,,38
 *
 * A header line is required, so the columns can come in any order and any of
 * occupancy or price may be missing. Header names are accepted in English,
 * Italian and Spanish. Occupancy is a percentage (0–100, "72" or "72%"). With a
 * semicolon separator, decimals may use a comma ("72,5"). Bad lines are
 * reported with their number and never stop the good ones.
 */
import type { MarketDay } from "fairnight";
import { guessSeparator, readCsv } from "./csv-records.js";

export interface MarketCsvIssue {
  line: number;
  message: string;
}

export interface MarketCsvResult {
  days: MarketDay[];
  issues: MarketCsvIssue[];
}

type Column = "date" | "occupancy" | "price" | "comparables";

const HEADERS: Record<Column, readonly string[]> = {
  date: ["date", "data", "fecha", "day", "giorno", "dia"],
  occupancy: ["occupancy", "occupancy_percent", "zone_occupancy", "occupazione", "occupazione_zona", "ocupacion", "ocupacion_zona"],
  price: ["price", "average_price", "avg_price", "adr", "prezzo", "prezzo_medio", "precio", "precio_medio"],
  comparables: ["comparables", "comparable_listings", "listings", "comparabili", "annunci", "alojamientos", "anuncios"],
};

const normaliseHeader = (h: string) =>
  h
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(v: string): boolean {
  if (!ISO.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** "118", "118.50", "€ 118", "1,234.50"; with decimalComma "118,50" and "1.234,50". */
export function parseAmount(raw: string, decimalComma: boolean): number | null {
  let s = raw.replace(/[€$£\s%]/g, "");
  if (s === "") return null;
  s = decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export function parseMarketCsv(text: string): MarketCsvResult {
  const separator = guessSeparator(text);
  const decimalComma = separator === ";";
  const records = readCsv(text, separator);
  const issues: MarketCsvIssue[] = [];
  const header = records.shift();
  if (!header) return { days: [], issues: [{ line: 1, message: "the file is empty" }] };

  const index: Partial<Record<Column, number>> = {};
  header.cells.forEach((h, i) => {
    const name = normaliseHeader(h);
    for (const [col, names] of Object.entries(HEADERS) as [Column, readonly string[]][]) {
      if (names.includes(name) && index[col] === undefined) index[col] = i;
    }
  });
  if (index.date === undefined) {
    return { days: [], issues: [{ line: header.line, message: "the first line must name the columns: date, occupancy, average_price, comparables" }] };
  }
  if (index.occupancy === undefined && index.price === undefined) {
    return { days: [], issues: [{ line: header.line, message: "no occupancy or average_price column: at least one of them is needed" }] };
  }

  const byDate = new Map<string, MarketDay>();
  for (const { cells, line } of records) {
    const date = cells[index.date] ?? "";
    if (!isIsoDay(date)) {
      issues.push({ line, message: `"${date}" is not a date like 2026-11-01` });
      continue;
    }
    const day: MarketDay = { date };
    let bad = false;
    if (index.occupancy !== undefined && (cells[index.occupancy] ?? "") !== "") {
      const raw = cells[index.occupancy] as string;
      const occ = parseAmount(raw, decimalComma);
      if (occ === null || occ < 0 || occ > 100) {
        issues.push({ line, message: `occupancy must be a percentage from 0 to 100, got "${raw}"` });
        bad = true;
      } else day.occupancyPercent = occ;
    }
    if (index.price !== undefined && (cells[index.price] ?? "") !== "") {
      const raw = cells[index.price] as string;
      const price = parseAmount(raw, decimalComma);
      if (price === null || price <= 0) {
        issues.push({ line, message: `average price must be a number above 0, got "${raw}"` });
        bad = true;
      } else day.averagePrice = price;
    }
    if (index.comparables !== undefined && (cells[index.comparables] ?? "") !== "") {
      const raw = cells[index.comparables] as string;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        issues.push({ line, message: `comparables must be a whole number, got "${raw}"` });
        bad = true;
      } else day.comparables = n;
    }
    if (bad) continue;
    if (day.occupancyPercent === undefined && day.averagePrice === undefined) {
      issues.push({ line, message: "neither occupancy nor average price on this line" });
      continue;
    }
    if (byDate.has(date)) issues.push({ line, message: `${date} appears more than once: this later line is kept` });
    byDate.set(date, day);
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { days, issues };
}
