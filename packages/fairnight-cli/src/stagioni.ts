/**
 * The seasons `fairnight configura` proposes from the town of a listing.
 * They are only a proposal: the host sees every date and percentage and
 * confirms or changes them before anything is written.
 *
 * - Canary Islands: high season in winter (Christmas, then January to March,
 *   with a lighter start in November).
 * - Everywhere else (Italy and mainland Spain): summer, the shoulder months
 *   around it, and Christmas.
 */
import type { SeasonPeriod } from "fairnight";

export type SeasonRegion = "canarie" | "estate";

export const REGION_LABEL: Record<SeasonRegion, string> = {
  canarie: "Canarie: alta stagione in inverno",
  estate: "Italia e Spagna: alta stagione in estate, più Natale",
};

/** Islands, towns and resorts of the Canary Islands, written without accents. */
const CANARY_PLACES = [
  "canarie", "canarias", "canary", "tenerife", "gran canaria", "lanzarote", "fuerteventura", "la palma", "la gomera",
  "el hierro", "la graciosa", "adeje", "costa adeje", "arona", "los cristianos", "playa de las americas", "las americas",
  "santa cruz de tenerife", "la laguna", "san cristobal de la laguna", "puerto de la cruz", "los gigantes", "puerto de santiago",
  "guia de isora", "san miguel de abona", "granadilla", "el medano", "golf del sur", "la orotava", "icod", "garachico",
  "candelaria", "los realejos", "callao salvaje", "las palmas", "maspalomas", "playa del ingles", "san bartolome de tirajana",
  "mogan", "puerto rico", "puerto de mogan", "arguineguin", "telde", "agaete", "arrecife", "puerto del carmen",
  "playa blanca", "costa teguise", "teguise", "yaiza", "corralejo", "morro jable", "puerto del rosario", "caleta de fuste",
  "costa calma", "jandia", "los llanos de aridane", "santa cruz de la palma", "tazacorte", "valle gran rey", "san sebastian de la gomera",
];

/** A place name without accents, lowercase, words separated by single spaces. */
export const plainPlace = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** True when the town is in the Canary Islands. */
export function isCanaryPlace(city: string): boolean {
  const words = ` ${plainPlace(city)} `;
  return CANARY_PLACES.some((p) => words.includes(` ${p} `));
}

export function regionOf(city: string | undefined): SeasonRegion {
  if (city === undefined) return "estate";
  return isCanaryPlace(city) ? "canarie" : "estate";
}

export function proposedSeasons(region: SeasonRegion): SeasonPeriod[] {
  if (region === "canarie") {
    return [
      { name: "Natale e Capodanno", start: "12-20", end: "01-06", multiplier: 1.35 },
      { name: "Inverno", start: "01-07", end: "03-31", multiplier: 1.2 },
      { name: "Inizio inverno", start: "11-01", end: "12-19", multiplier: 1.1 },
    ];
  }
  return [
    { name: "Natale e Capodanno", start: "12-20", end: "01-06", multiplier: 1.25 },
    { name: "Giugno", start: "06-01", end: "06-30", multiplier: 1.1 },
    { name: "Luglio e agosto", start: "07-01", end: "08-31", multiplier: 1.25 },
    { name: "Settembre", start: "09-01", end: "09-30", multiplier: 1.1 },
  ];
}

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/** "12-20" → "20 dic". */
export function dayMonth(md: string): string {
  const [m, d] = md.split("-").map(Number) as [number, number];
  return `${d} ${MONTHS[m - 1]}`;
}

/** "12-20" → "20/12", the way the host types it. */
export const typedDayMonth = (md: string) => `${md.slice(3)}/${md.slice(0, 2)}`;

/** "20/12", "20-12", "20.12" or "20/12/2026" → "12-20"; null when it is not a real day. */
export function parseDayMonth(raw: string): string | null {
  const m = /^\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*\d{2,4})?\s*$/.exec(raw);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] as number;
  if (d > days) return null;
  return `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 1.25 → 25, 0.9 → -10. */
export const percentOf = (multiplier: number) => Math.round((multiplier - 1) * 100);

export const multiplierOf = (percent: number) => Math.round((1 + percent / 100) * 100) / 100;

/** "Luglio e agosto · dal 1 lug al 31 ago · +25%" (fixed-price seasons show the price). */
export function describeSeason(p: SeasonPeriod): string {
  const change =
    p.multiplier !== undefined ? `${percentOf(p.multiplier) >= 0 ? "+" : ""}${percentOf(p.multiplier)}%` : `prezzo fisso ${p.fixedPrice}`;
  return `${p.name} · dal ${dayMonth(p.start)} al ${dayMonth(p.end)} · ${change}`;
}
