/**
 * Reader for files of past nightly prices: two useful columns, date and price,
 * from a Booking/Airbnb export or written by hand.
 *
 * - Separators: comma, semicolon, tab or pipe (detected from the first line).
 * - Header: optional. If present, the date and price columns are found by name
 *   (date/data/fecha/datum…, price/prezzo/precio/rate/tariffa…); other columns
 *   are ignored. Without a header: date first, price second.
 * - Dates: 2026-11-03, 2026/11/03, or European day-first 03/11/2026,
 *   03-11-2026, 03.11.2026. A time after the date is ignored.
 * - Prices: "120", "92.50", "92,50", "€ 1.234,56", "1,234.56 EUR".
 *   A lone comma or dot followed by exactly three digits ("1.234") is read as a
 *   thousands separator. If prices use a decimal comma, use ";" as separator or
 *   put the price in quotes.
 */

export interface PriceRow {
  line: number;
  date: string;
  price: number;
}

export interface PriceIssue {
  line: number;
  message: string;
}

export interface PricesCsvResult {
  rows: PriceRow[];
  issues: PriceIssue[];
  separator: string;
}

const SEPARATORS = [";", "\t", ",", "|"] as const;
const DATE_HEADER = /^(date|data|fecha|datum|day|night|notte|giorno|d[ií]a|noche|nuit|jour)$/i;
const PRICE_HEADER = /(price|prezzo|precio|preis|prix|rate|tariff|tarifa|amount|importo|eur)/i;

function splitLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** The separator that splits the first line into the most cells (ties: ; then tab, comma, pipe). */
function detectSeparator(line: string): string {
  let best: string = ",";
  let bestCount = 1;
  for (const sep of SEPARATORS) {
    const n = splitLine(line, sep).length;
    if (n > bestCount) {
      best = sep;
      bestCount = n;
    }
  }
  return best;
}

function validDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDate(raw: string): string | null {
  const s = raw.trim().split(/[ T]/)[0] ?? "";
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return validDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

export function parsePrice(raw: string): number | null {
  // Keep digits, separators and a minus sign; drop currency symbols, codes and spaces.
  let s = raw.replace(/[^\d.,-]/g, "");
  if (s === "" || s.includes("-")) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the last one is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

export function parsePricesCsv(text: string): PricesCsvResult {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split(/\r?\n/);
  const rows: PriceRow[] = [];
  const issues: PriceIssue[] = [];
  const firstIndex = lines.findIndex((l) => l.trim() !== "");
  if (firstIndex < 0) return { rows, issues: [{ line: 1, message: "the file is empty" }], separator: "," };

  const separator = detectSeparator(lines[firstIndex] as string);
  const first = splitLine(lines[firstIndex] as string, separator);
  let dateCol = 0;
  let priceCol = 1;
  let start = firstIndex;
  if (parseDate(first[0] ?? "") === null) {
    // A header line: find the columns by name.
    dateCol = first.findIndex((c) => DATE_HEADER.test(c));
    priceCol = first.findIndex((c) => PRICE_HEADER.test(c));
    if (dateCol < 0 || priceCol < 0) {
      return {
        rows,
        issues: [{ line: firstIndex + 1, message: `cannot find a date and a price column in the header: ${first.join(" | ")}` }],
        separator,
      };
    }
    start = firstIndex + 1;
  }

  const byDate = new Map<string, number>();
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i] as string;
    if (raw.trim() === "") continue;
    const line = i + 1;
    const cells = splitLine(raw, separator);
    const rawDate = cells[dateCol];
    const rawPrice = cells[priceCol];
    if (rawDate === undefined || rawPrice === undefined) {
      issues.push({ line, message: `expected at least ${Math.max(dateCol, priceCol) + 1} columns, found ${cells.length}` });
      continue;
    }
    const date = parseDate(rawDate);
    if (!date) {
      issues.push({ line, message: `"${rawDate}" is not a date (use 2026-11-03 or 03/11/2026)` });
      continue;
    }
    const price = parsePrice(rawPrice);
    if (price === null) {
      issues.push({ line, message: `"${rawPrice}" is not a price` });
      continue;
    }
    const previous = byDate.get(date);
    if (previous !== undefined) {
      issues.push({ line, message: `${date} appears again: this price replaces the one on line ${rows[previous]?.line}` });
      rows[previous] = { line, date, price };
      continue;
    }
    byDate.set(date, rows.length);
    rows.push({ line, date, price });
  }
  return { rows, issues, separator };
}
