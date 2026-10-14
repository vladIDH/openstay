/**
 * The language of the calendar page: Italian, Spanish or English.
 *
 * `fairnight configura` proposes one from the town of the houses (Italy → it,
 * Spain and the Canary Islands → es) or, when the town says nothing clear,
 * from the language of the computer. The host confirms; with no answer the
 * field stays empty and the page starts in English.
 */
import { isCanaryPlace, plainPlace } from "./stagioni.js";

export const LANGUAGES = ["it", "es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const isLanguage = (v: unknown): v is Language => typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);

/** Countries, regions, islands and the towns hosts write most often, without accents. */
const ITALIAN_PLACES = [
  "italia", "italy", "roma", "milano", "napoli", "torino", "firenze", "venezia", "bologna", "genova", "palermo", "catania",
  "bari", "verona", "padova", "trieste", "cagliari", "lecce", "pisa", "siena", "lucca", "como", "bergamo", "brescia", "parma",
  "modena", "rimini", "riccione", "perugia", "assisi", "ancona", "pescara", "salerno", "amalfi", "positano", "sorrento",
  "capri", "ischia", "taormina", "siracusa", "trapani", "agrigento", "olbia", "alghero", "porto cervo", "matera", "polignano",
  "ostuni", "cinque terre", "portofino", "sanremo", "la spezia", "gardone", "garda", "sirmione", "bolzano", "trento",
  "cortina", "aosta", "courmayeur", "livigno", "sicilia", "sardegna", "puglia", "toscana", "liguria", "campania", "calabria",
  "lazio", "lombardia", "veneto", "piemonte", "umbria", "marche", "abruzzo", "basilicata", "trentino", "friuli", "emilia",
  "romagna", "molise", "salento", "costiera amalfitana", "lago di garda", "lago di como", "elba",
];

const SPANISH_PLACES = [
  "espana", "spain", "spagna", "madrid", "barcelona", "barcellona", "valencia", "sevilla", "siviglia", "malaga", "granada",
  "cordoba", "cadiz", "bilbao", "san sebastian", "donostia", "zaragoza", "alicante", "benidorm", "marbella", "estepona",
  "torremolinos", "fuengirola", "nerja", "murcia", "cartagena", "almeria", "salamanca", "toledo", "segovia", "santander",
  "oviedo", "gijon", "santiago de compostela", "vigo", "la coruna", "a coruna", "pamplona", "tarragona", "salou", "sitges",
  "girona", "cadaques", "lloret de mar", "palma", "palma de mallorca", "mallorca", "maiorca", "menorca", "minorca", "ibiza",
  "eivissa", "formentera", "baleares", "baleari", "andalucia", "andalusia", "cataluna", "catalunya", "catalogna", "galicia",
  "asturias", "cantabria", "pais vasco", "costa del sol", "costa brava", "costa blanca", "costa dorada", "torrevieja",
  "denia", "javea", "calpe", "altea",
];

const hasPlace = (city: string, places: readonly string[]) => {
  const words = ` ${plainPlace(city)} `;
  return places.some((p) => words.includes(` ${p} `));
};

/** The language a town suggests, or null when it says nothing clear. */
export function languageOfCity(city: string | undefined): Language | null {
  if (city === undefined || city.trim() === "") return null;
  if (isCanaryPlace(city) || hasPlace(city, SPANISH_PLACES)) return "es";
  if (hasPlace(city, ITALIAN_PLACES)) return "it";
  return null;
}

/**
 * The language of this computer: LC_ALL, LC_MESSAGES or LANG when the terminal
 * sets them (Mac, Linux), otherwise the one Node.js reads from the system.
 */
export function systemLocale(env: Record<string, string | undefined>): string {
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const v = env[key];
    if (v && v !== "C" && v !== "POSIX" && !v.startsWith("C.")) return v;
  }
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

/** it or es from a locale like "it_IT.UTF-8" or "es-ES"; null for anything else. */
export function languageOfLocale(locale: string): Language | null {
  const code = locale.slice(0, 2).toLowerCase();
  return code === "it" || code === "es" ? code : null;
}

/** First the towns (the first one that is clear), then the computer. */
export function proposedLanguage(cities: (string | undefined)[], locale: string): Language | null {
  for (const c of cities) {
    const l = languageOfCity(c);
    if (l !== null) return l;
  }
  return languageOfLocale(locale);
}
