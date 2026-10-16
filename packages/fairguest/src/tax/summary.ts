/**
 * The summary of a month or a quarter for the town's declaration: one row per
 * stay with nights in the period, then the totals. No names, no documents:
 * dates, how many guests, how many pay and why the others do not.
 * As CSV (semicolons and decimal commas, what Excel opens in Italy and Spain)
 * and as PDF.
 */
import { pdfFile, textWidth, type PdfText } from "./pdf.js";
import { formatCents, stayTax, type TaxClass, type TaxRule } from "./rules.js";
import { verifyTexts } from "./verify.js";

export interface SummaryStay {
  id: string;
  listing: string;
  checkIn: string;
  checkOut: string;
  classes: (TaxClass | null)[];
  /** What the guest paid online for the tax (the whole stay), in cents. */
  paidCents: number;
}

export interface SummaryRow {
  id: string;
  listing: string;
  checkIn: string;
  checkOut: string;
  /** Nights of the stay inside the period. */
  nights: number;
  guests: number;
  /** At the full rate. */
  paying: number;
  /** At a reduced rate by age. */
  reduced: number;
  exemptAge: number;
  exemptResident: number;
  exemptOther: number;
  unknown: number;
  personNights: number;
  /** Person-nights beyond the cap on nights. */
  overCap: number;
  dueCents: number;
  paidCents: number;
}

export interface TaxSummary {
  rule: TaxRule;
  period: { from: string; to: string; label: string };
  rows: SummaryRow[];
  totals: Omit<SummaryRow, "id" | "listing" | "checkIn" | "checkOut">;
  /** Stays with guests not opened yet: the figures are not final. */
  incomplete: number;
}

export function taxSummary(rule: TaxRule, period: { from: string; to: string; label: string }, stays: SummaryStay[]): TaxSummary {
  const rows: SummaryRow[] = [];
  for (const s of [...stays].sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.id.localeCompare(b.id))) {
    const t = stayTax(rule, s.checkIn, s.checkOut, s.classes, period);
    if (t.nights.length === 0) continue;
    rows.push({
      id: s.id,
      listing: s.listing,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      nights: t.nights.length,
      guests: s.classes.length,
      paying: t.guests.pays,
      reduced: t.guests.reduced,
      exemptAge: t.guests["exempt-age"],
      exemptResident: t.guests["exempt-resident"],
      exemptOther: t.guests["exempt-other"],
      unknown: t.guests.unknown,
      personNights: t.personNights,
      overCap: t.exemptPersonNights.cap,
      dueCents: t.totalCents,
      paidCents: s.paidCents,
    });
  }
  const sum = (k: keyof SummaryRow) => rows.reduce((n, r) => n + (r[k] as number), 0);
  const totals = {
    nights: sum("nights"),
    guests: sum("guests"),
    paying: sum("paying"),
    reduced: sum("reduced"),
    exemptAge: sum("exemptAge"),
    exemptResident: sum("exemptResident"),
    exemptOther: sum("exemptOther"),
    unknown: sum("unknown"),
    personNights: sum("personNights"),
    overCap: sum("overCap"),
    dueCents: sum("dueCents"),
    paidCents: sum("paidCents"),
  };
  return { rule, period, rows, totals, incomplete: rows.filter((r) => r.unknown > 0).length };
}

export type SummaryLang = "it" | "es" | "en";

const WORDS: Record<SummaryLang, { title: string; town: string; period: string; rate: string; cols: string[]; exemptCol: string; total: string; incomplete: (n: number) => string; note: string; source: string; none: string }> = {
  it: {
    title: "Imposta di soggiorno · riepilogo",
    town: "Comune",
    period: "Periodo",
    rate: "Tariffa per persona a notte",
    cols: ["Soggiorno", "Annuncio", "Arrivo", "Partenza", "Notti", "Ospiti", "Paganti", "Ridotti", "Esenti età", "Esenti residenti", "Esenti altro", "Da aprire", "Pernottamenti tassati", "Oltre il tetto", "Imposta dovuta", "Pagata online"],
    exemptCol: "Esenti età/res./altro",
    total: "Totale",
    incomplete: (n) => `${n} soggiorni hanno ospiti arrivati col link e non ancora aperti: le cifre non sono definitive.`,
    note: "Pagata online: quanto l'ospite ha pagato con Stripe per l'intero soggiorno, direttamente sul conto dell'host.",
    source: "Fonte della tariffa",
    none: "Nessun soggiorno nel periodo.",
  },
  es: {
    title: "Impuesto turístico · resumen",
    town: "Municipio",
    period: "Periodo",
    rate: "Tarifa por persona y noche",
    cols: ["Estancia", "Anuncio", "Llegada", "Salida", "Noches", "Huéspedes", "Pagan", "Reducidos", "Exentos edad", "Exentos residentes", "Exentos otros", "Por abrir", "Pernoctaciones gravadas", "Sobre el tope", "Impuesto debido", "Pagado online"],
    exemptCol: "Exentos edad/res./otros",
    total: "Total",
    incomplete: (n) => `${n} estancias tienen huéspedes llegados por el enlace y aún sin abrir: las cifras no son definitivas.`,
    note: "Pagado online: lo que el huésped pagó con Stripe por toda la estancia, directamente en la cuenta del anfitrión.",
    source: "Fuente de la tarifa",
    none: "Ninguna estancia en el periodo.",
  },
  en: {
    title: "Tourist tax · summary",
    town: "Town",
    period: "Period",
    rate: "Rate per person per night",
    cols: ["Stay", "Listing", "Check-in", "Check-out", "Nights", "Guests", "Paying", "Reduced", "Exempt age", "Exempt residents", "Exempt other", "Not opened", "Taxed person-nights", "Over the cap", "Tax due", "Paid online"],
    exemptCol: "Exempt age/res./other",
    total: "Total",
    incomplete: (n) => `${n} stays have guests from the link not opened yet: the figures are not final.`,
    note: "Paid online: what the guest paid with Stripe for the whole stay, straight to the host's account.",
    source: "Source of the rate",
    none: "No stay in the period.",
  },
};

function rowCells(r: Omit<SummaryRow, "id" | "listing" | "checkIn" | "checkOut">, decimal: "," | "."): string[] {
  return [r.nights, r.guests, r.paying, r.reduced, r.exemptAge, r.exemptResident, r.exemptOther, r.unknown, r.personNights, r.overCap].map(String).concat([formatCents(r.dueCents, decimal), formatCents(r.paidCents, decimal)]);
}

/** Lines of at most `width` points, broken at spaces (long addresses at any character). */
function wrap(text: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) <= width) line = next;
    else {
      if (line) out.push(line);
      line = word;
      while (textWidth(line, size) > width) {
        let cut = line.length - 1;
        while (cut > 1 && textWidth(line.slice(0, cut), size) > width) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
  }
  if (line) out.push(line);
  return out;
}

const csvCell = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV with a byte-order mark, so Excel reads the accents. */
export function summaryCsv(s: TaxSummary, lang: SummaryLang): string {
  const w = WORDS[lang];
  const decimal = lang === "en" ? "." : ",";
  const lines = [w.cols.map(csvCell).join(";")];
  for (const r of s.rows) lines.push([r.id, r.listing, r.checkIn, r.checkOut, ...rowCells(r, decimal)].map(csvCell).join(";"));
  lines.push([w.total, "", s.period.from, s.period.to, ...rowCells(s.totals, decimal)].map(csvCell).join(";"));
  // What the host still has to check with the town, under the figures.
  for (const v of verifyTexts(s.rule, lang)) {
    lines.push("");
    lines.push(csvCell(v.title.toUpperCase()));
    for (const line of [v.quote, v.explain, v.note, v.url]) if (line) lines.push(csvCell(line));
  }
  return String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n";
}

/** The same summary as an A4 PDF, landscape-free: the columns that matter to the town. */
export function summaryPdf(s: TaxSummary, lang: SummaryLang, generatedOn: string): Uint8Array {
  const w = WORDS[lang];
  const decimal = lang === "en" ? "." : ",";
  const money = (c: number) => `${formatCents(c, decimal)} ${s.rule.currency === "EUR" ? "€" : s.rule.currency}`;
  const pages: PdfText[][] = [];
  let page: PdfText[] = [];
  let y = 0;
  const newPage = () => {
    page = [];
    pages.push(page);
    y = 56;
  };
  newPage();
  page.push({ x: 40, y, text: w.title, size: 16, bold: true });
  y += 24;
  page.push({ x: 40, y, text: `${w.town}: ${s.rule.name}`, size: 11 });
  y += 15;
  page.push({ x: 40, y, text: `${w.period}: ${s.period.label} (${s.period.from} – ${s.period.to})`, size: 11 });
  y += 15;
  const seasons = (s.rule.seasons ?? []).map((x) => `${x.from}/${x.to} ${money(Math.round(x.rate * 100))}`).join(", ");
  page.push({ x: 40, y, text: `${w.rate}: ${money(Math.round(s.rule.rate * 100))}${seasons ? ` (${seasons})` : ""}`, size: 11 });
  y += 26;
  // Columns: stay, check-in, check-out, nights, guests, paying, exempt (age+resident+other), person-nights, due, paid.
  const bands = (s.rule.ageBands ?? []).length > 0;
  const head = [w.cols[0], w.cols[2], w.cols[3], w.cols[4], w.cols[5], bands ? `${w.cols[6]} (${w.cols[7]})` : w.cols[6], w.exemptCol, w.cols[12], w.cols[14], w.cols[15]] as string[];
  const paying = (r: { paying: number; reduced: number }) => (bands ? `${r.paying} (${r.reduced})` : String(r.paying));
  const xs = [40, 118, 178, 266, 300, 340, 400, 462, 512, 556];
  const right = [false, false, false, true, true, true, true, true, true, true];
  const header = () => {
    head.forEach((h, i) => {
      // Long headings on two lines.
      const words = h.split(" ");
      const half = Math.ceil(words.length / 2);
      const lines = h.length > 12 && words.length > 1 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : [h];
      lines.forEach((l, j) => page.push({ x: xs[i] as number, y: y + j * 9, text: l, size: 7, bold: true, right: right[i] as boolean }));
    });
    y += 24;
  };
  header();
  if (s.rows.length === 0) {
    page.push({ x: 40, y, text: w.none, size: 10 });
    y += 14;
  }
  for (const r of s.rows) {
    if (y > 780) {
      newPage();
      header();
    }
    const cells = [r.id, r.checkIn, r.checkOut, String(r.nights), String(r.guests), paying(r), `${r.exemptAge}/${r.exemptResident}/${r.exemptOther}`, String(r.personNights), money(r.dueCents), money(r.paidCents)];
    cells.forEach((c, i) => page.push({ x: xs[i] as number, y, text: c, size: 8, right: right[i] as boolean }));
    y += 13;
  }
  y += 4;
  const t = s.totals;
  const totals = [w.total, "", "", String(t.nights), String(t.guests), paying(t), `${t.exemptAge}/${t.exemptResident}/${t.exemptOther}`, String(t.personNights), money(t.dueCents), money(t.paidCents)];
  totals.forEach((c, i) => page.push({ x: xs[i] as number, y, text: c, size: 8.5, bold: true, right: right[i] as boolean }));
  y += 24;
  if (y > 760) newPage();
  if (s.incomplete > 0) {
    page.push({ x: 40, y, text: w.incomplete(s.incomplete), size: 8.5, bold: true });
    y += 13;
  }
  page.push({ x: 40, y, text: w.note, size: 8 });
  y += 12;
  for (const v of verifyTexts(s.rule, lang)) {
    if (y > 700) newPage();
    y += 8;
    page.push({ x: 40, y, text: v.title.toUpperCase(), size: 9.5, bold: true });
    y += 14;
    for (const [text, size] of [[v.quote, 8.5], [v.explain, 8], [v.note ?? "", 8], [v.url, 7]] as [string, number][]) {
      for (const line of wrap(text, size, 515)) {
        page.push({ x: 40, y, text: line, size });
        y += size + 3.5;
      }
    }
  }
  if (s.rule.source) {
    page.push({ x: 40, y, text: `${w.source}: ${s.rule.source.title} (${s.rule.source.checkedOn})`, size: 8 });
    y += 11;
    page.push({ x: 40, y, text: s.rule.source.url.slice(0, 120), size: 7 });
    y += 11;
  }
  page.push({ x: 40, y: 815, text: `Fairguest · ${generatedOn}`, size: 7 });
  return pdfFile(pages, `${w.title} ${s.rule.name} ${s.period.label}`);
}
